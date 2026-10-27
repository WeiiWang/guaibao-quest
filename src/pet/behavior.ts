// 自主行為排程（SPEC-v3 A2）：閒置 15–40 秒後隨機挑一個行為；同一個不連續出現；
// 佈置模式、拖曳中、餵食/大便/反應動畫中、頁面隱藏、睡覺、全螢幕慶祝時都暫停。純邏輯，時間與亂數由呼叫端注入。
import type { Stage } from '../domain/types'
import { NORMAL_MIN_HUNGER } from '../domain/constants'
import type { TimeOfDay } from './daynight'
import type { BehaviorId } from './plan'

export const IDLE_MIN_MS = 15_000
export const IDLE_MAX_MS = 40_000
/** 被擋住（佈置中、動畫中…）時，解除後至少再等這麼久才開始新行為 */
export const BLOCKED_COOLDOWN_MS = 3_000

export interface PickContext {
  stage: Stage
  /** 目前飽足度 0–100 */
  hunger: number
  poopCount: number
  tod: TimeOfDay
  /** 房間裡有玩具球且在可視範圍 */
  hasBall: boolean
  /** v5：阿悟已經學會的新招（domain/tricks.ts 的 id） */
  tricks?: readonly string[]
}

interface Def {
  weight: number
  stages: readonly Stage[]
  /** 飢餓（< 30）時還能不能做 */
  hungry: boolean
  /** 晚上醒著時還能不能做（唱歌、跳舞太吵就不做） */
  night: boolean
  when?: (c: PickContext) => boolean
  /** 飢餓時的權重（沒給就用 weight） */
  hungryWeight?: number
}

const BABY_ADULT: readonly Stage[] = ['baby', 'adult']

const DEFS: Record<BehaviorId, Def> = {
  sing: { weight: 3, stages: BABY_ADULT, hungry: false, night: false },
  dance: { weight: 2, stages: BABY_ADULT, hungry: false, night: false },
  walk: { weight: 4, stages: BABY_ADULT, hungry: true, night: false, hungryWeight: 1 },
  yawn: { weight: 2, stages: BABY_ADULT, hungry: true, night: true, hungryWeight: 1 },
  sneeze: { weight: 1.5, stages: BABY_ADULT, hungry: false, night: true },
  gaze: { weight: 2, stages: BABY_ADULT, hungry: false, night: true },
  wave: { weight: 1.5, stages: BABY_ADULT, hungry: false, night: false },
  // 飢餓時才會摸肚子
  rubTummy: { weight: 5, stages: BABY_ADULT, hungry: true, night: true, when: (c) => c.hunger < NORMAL_MIN_HUNGER },
  // 房間有便便才會捏鼻子
  pinchNose: { weight: 3, stages: BABY_ADULT, hungry: true, night: false, when: (c) => c.poopCount > 0 },
  ballPlay: { weight: 3, stages: BABY_ADULT, hungry: false, night: false, when: (c) => c.hasBall },
  // v5：新招只有學會了才會自己表演；偶爾（權重低）
  trickCount: { weight: 1.2, stages: BABY_ADULT, hungry: false, night: false, when: (c) => !!c.tricks?.includes('count') },
  trickTidy: { weight: 1.2, stages: BABY_ADULT, hungry: false, night: false, when: (c) => !!c.tricks?.includes('tidy') },
  trickRhythm: { weight: 1.2, stages: BABY_ADULT, hungry: false, night: false, when: (c) => !!c.tricks?.includes('rhythm') },
  trickHello: { weight: 1.2, stages: BABY_ADULT, hungry: false, night: false, when: (c) => !!c.tricks?.includes('hello') },
  trickFlip: { weight: 1.2, stages: BABY_ADULT, hungry: false, night: false, when: (c) => !!c.tricks?.includes('flip') },
  trickBow: { weight: 1.2, stages: BABY_ADULT, hungry: false, night: false, when: (c) => !!c.tricks?.includes('bow') },
  eggWobble: { weight: 3, stages: ['egg'], hungry: true, night: true },
  eggSparkle: { weight: 2, stages: ['egg'], hungry: true, night: false },
}

export const isHungry = (hunger: number) => hunger < NORMAL_MIN_HUNGER

/** 目前情境下可以做的行為與權重 */
export function candidates(c: PickContext): { id: BehaviorId; weight: number }[] {
  const hungry = isHungry(c.hunger)
  const out: { id: BehaviorId; weight: number }[] = []
  for (const id of Object.keys(DEFS) as BehaviorId[]) {
    const d = DEFS[id]
    if (!d.stages.includes(c.stage)) continue
    if (hungry && !d.hungry) continue
    if (c.tod === 'night' && !d.night) continue
    if (d.when && !d.when(c)) continue
    // 蛋不會餓到摸肚子；摸肚子只給有手的階段（stages 已限制）
    out.push({ id, weight: hungry && d.hungryWeight !== undefined ? d.hungryWeight : d.weight })
  }
  return out
}

/** 依權重隨機挑一個；排除上一個（除非只剩它）。沒有候選回 null。 */
export function pickBehavior(c: PickContext, last: BehaviorId | null, rng: () => number): BehaviorId | null {
  let list = candidates(c)
  if (list.length === 0) return null
  const others = list.filter((x) => x.id !== last)
  if (others.length > 0) list = others
  const total = list.reduce((s, x) => s + x.weight, 0)
  let r = rng() * total
  for (const x of list) {
    r -= x.weight
    if (r < 0) return x.id
  }
  return list[list.length - 1].id
}

export interface Gate {
  edit: boolean
  dragging: boolean
  /** 有場景在播（餵食、大便、反應、行為） */
  busy: boolean
  hidden: boolean
  asleep: boolean
  /** 全螢幕慶祝等覆蓋畫面 */
  overlay: boolean
}

export const isBlocked = (g: Gate) => g.edit || g.dragging || g.busy || g.hidden || g.asleep || g.overlay

export interface SchedulerOptions {
  rng: () => number
  minMs?: number
  maxMs?: number
}

/** 行為排程器：每秒呼叫 tick；沒互動滿一段隨機時間就回傳一個要執行的行為 */
export class BehaviorScheduler {
  nextAt = 0
  last: BehaviorId | null = null
  private readonly rng: () => number
  private readonly minMs: number
  private readonly maxMs: number

  constructor(o: SchedulerOptions, now: number) {
    this.rng = o.rng
    this.minMs = o.minMs ?? IDLE_MIN_MS
    this.maxMs = o.maxMs ?? IDLE_MAX_MS
    this.reset(now)
  }

  /** 有互動或行為結束：重新計時 */
  reset(now: number): void {
    this.nextAt = now + this.minMs + this.rng() * (this.maxMs - this.minMs)
  }

  /** 回傳要執行的行為（沒有就 null）。被擋住時不會累積「欠著的行為」。 */
  tick(now: number, gate: Gate, ctx: PickContext): BehaviorId | null {
    if (isBlocked(gate)) {
      this.nextAt = Math.max(this.nextAt, now + BLOCKED_COOLDOWN_MS)
      return null
    }
    if (now < this.nextAt) return null
    const id = pickBehavior(ctx, this.last, this.rng)
    // 沒有可做的行為：晚點再試
    if (id === null) {
      this.reset(now)
      return null
    }
    this.last = id
    return id
  }
}
