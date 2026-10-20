// 便便（SPEC-v3 A3）：機率、上限、延遲、位置。純函式，亂數與時間由呼叫端注入。
import type { FeedStreak, Poop, Stage } from '../domain/types'

export type { FeedStreak, Poop }

export const POOP_CAP = 3
export const POOP_DELAY_MIN_MS = 20_000
export const POOP_DELAY_MAX_MS = 90_000
export const STREAK_WINDOW_MS = 10 * 60 * 1000
/** 兩坨便便最少要隔多遠（房間寬度比例），避免疊在一起 */
export const POOP_MIN_GAP = 0.05

/** 吃第 1 次 30%、第 2 次 45%、第 3 次（含）以上 60% */
export function poopChance(streak: number): number {
  if (streak <= 0) return 0
  if (streak === 1) return 0.3
  if (streak === 2) return 0.45
  return 0.6
}

export function nextStreak(prev: FeedStreak | undefined, now: number): FeedStreak {
  if (!prev || now - prev.at > STREAK_WINDOW_MS || now < prev.at) return { n: 1, at: now }
  return { n: prev.n + 1, at: now }
}

export const rollPoopDelay = (rng: () => number): number =>
  Math.round(POOP_DELAY_MIN_MS + rng() * (POOP_DELAY_MAX_MS - POOP_DELAY_MIN_MS))

export interface FeedPoopInput {
  stage: Stage
  streak: FeedStreak | undefined
  now: number
  /** 家長開關「寵物會大便」 */
  poopOn: boolean
  poopCount: number
  /** 已排定、還沒發生的便便數 */
  dueCount: number
  rng: () => number
}

/** 吃完東西後：更新連續餵食計數，並決定要不要排一次延遲大便。蛋不會大便。 */
export function planFeedPoop(i: FeedPoopInput): { streak: FeedStreak; due: number | null } {
  const streak = nextStreak(i.streak, i.now)
  if (!i.poopOn || i.stage === 'egg') return { streak, due: null }
  if (i.poopCount + i.dueCount >= POOP_CAP) return { streak, due: null }
  if (i.rng() >= poopChance(streak.n)) return { streak, due: null }
  return { streak, due: i.now + rollPoopDelay(i.rng) }
}

/** 便便離寵物中心多遠（房間寬度比例）。螢幕小的時候寵物佔比大，呼叫端用寵物寬度換算。 */
export interface PoopSpread {
  min: number
  max: number
  /** 便便可以出現的水平範圍（房間寬度比例，通常是目前看得到的範圍）；預設 0.06–0.94 */
  lo?: number
  hi?: number
}
export const DEFAULT_SPREAD: PoopSpread = { min: 0.04, max: 0.12 }

/** 挑便便的位置：以 centerX 為中心的左右兩側，避開既有便便 */
export function pickPoopX(existing: readonly Pick<Poop, 'x'>[], centerX: number, rng: () => number, spread: PoopSpread = DEFAULT_SPREAD): number {
  const lo = spread.lo ?? 0.06
  const hi = spread.hi ?? 0.94
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v))
  // 寵物靠近邊緣時，只往放得下的那一側
  const canL = centerX - spread.min >= lo
  const canR = centerX + spread.min <= hi
  let best = clamp(centerX)
  let bestGap = -1
  for (let k = 0; k < 8; k++) {
    const side = canL && !canR ? -1 : canR && !canL ? 1 : rng() < 0.5 ? -1 : 1
    const x = clamp(centerX + side * (spread.min + rng() * (spread.max - spread.min)))
    const gap = existing.length ? Math.min(...existing.map((p) => Math.abs(p.x - x))) : 1
    if (gap >= POOP_MIN_GAP) return x
    if (gap > bestGap) {
      bestGap = gap
      best = x
    }
  }
  return best
}

export interface DueResult {
  poops: Poop[]
  due: number[]
  /** 這次新長出來的 */
  added: Poop[]
}

/**
 * 把「到期的排定便便」變成真的便便（離線期間也會發生）。
 * 超過上限的直接丟掉（不累積）；便便的出現時間用它原本的到期時間。
 */
export function resolveDuePoops(
  poops: readonly Poop[],
  due: readonly number[],
  now: number,
  centerX: number,
  rng: () => number,
  newId: () => string,
  cap = POOP_CAP,
  spread: PoopSpread = DEFAULT_SPREAD,
): DueResult {
  const sorted = [...due].sort((a, b) => a - b)
  const out = [...poops]
  const added: Poop[] = []
  const rest: number[] = []
  for (const t of sorted) {
    if (t > now) {
      rest.push(t)
      continue
    }
    if (out.length >= cap) continue
    const p: Poop = { id: newId(), x: pickPoopX(out, centerX, rng, spread), at: t }
    out.push(p)
    added.push(p)
  }
  return { poops: out, due: rest, added }
}
