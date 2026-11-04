import { FOOD_IDS } from './constants'
import type { AgeBand } from './types'

// v8.3 線 U：泡泡派對、接水果、翻翻配對的規則（純函式）。
// 這裡的種子只決定「長什麼樣、掉哪裡、牌怎麼排」，跟獎勵無關（獎勵在 playground.ts，固定輪替）。

/** 可重現的小亂數：同一個種子永遠同一串 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shuffled = <T,>(items: readonly T[], rand: () => number): T[] => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ---------- 泡泡派對 ----------

/** 戳滿幾顆算玩完（之後還能繼續戳） */
export const BUBBLE_GOAL: Record<AgeBand, number> = { '3': 15, '4-5': 20, '6-7': 25 }
/** 每幾顆有一顆大彩虹泡泡（固定節奏，不靠機率） */
export const BUBBLE_BIG_EVERY = 12
/** 飄著的泡泡最多幾顆：到了就先不冒新的 */
export const BUBBLE_MAX = 12
/** 大泡泡噴出幾顆小泡泡 */
export const BUBBLE_MINIS = 6
/** 含小泡泡，畫面上絕對不超過幾顆（避免掉幀） */
export const BUBBLE_MAX_ALL = 20
/** 少於這麼多顆就馬上補，孩子戳得快時天空不會空掉 */
export const BUBBLE_MIN = 3

export interface BubbleTune {
  /** 泡泡直徑（vmin，CSS 另有 px 下限確保 ≥ 56px） */
  sizeVmin: number
  /** 從底飄到頂要多久 */
  riseMs: number
  /** 多久冒一顆 */
  gapMs: number
}

export const BUBBLE_TUNE: Record<AgeBand, BubbleTune> = {
  '3': { sizeVmin: 21, riseMs: 11000, gapMs: 900 },
  '4-5': { sizeVmin: 17, riseMs: 9000, gapMs: 750 },
  '6-7': { sizeVmin: 14, riseMs: 7500, gapMs: 600 },
}

export type BubbleContent = { kind: 'food'; id: string } | { kind: 'star' } | { kind: 'none' }

export interface BubbleSpec {
  n: number
  big: boolean
  /** 水平位置 0–1 */
  x: number
  /** 靜止時的高度 0–1（動作減少模式不飄，停在這裡） */
  restY: number
  /** 搖擺一次多久 */
  swayMs: number
  content: BubbleContent
}

const frac = (v: number) => v - Math.floor(v)

/** 第 n 顆泡泡（從 0 算）長什麼樣。用黃金比例撒開，不會連續擠在同一邊 */
export function bubbleSpec(n: number): BubbleSpec {
  const big = n % BUBBLE_BIG_EVERY === BUBBLE_BIG_EVERY - 1
  const cycle = n % 4
  const content: BubbleContent = big || cycle === 3 ? { kind: 'none' } : cycle === 2 ? { kind: 'star' } : { kind: 'food', id: FOOD_IDS[n % FOOD_IDS.length] }
  return {
    n,
    big,
    x: 0.1 + 0.8 * frac(0.37 + n * 0.618034),
    restY: 0.22 + 0.5 * frac(0.11 + n * 0.754878),
    swayMs: 2200 + (n % 5) * 300,
    content,
  }
}

/** 這一刻要不要冒新泡泡 */
export function bubbleShouldSpawn(alive: number, sinceLastMs: number, tune: BubbleTune): boolean {
  if (alive >= BUBBLE_MAX) return false
  return alive < BUBBLE_MIN || sinceLastMs >= tune.gapMs
}

/** 大泡泡戳破後要噴幾顆：不能讓畫面超過總上限 */
export function bubbleMiniCount(alive: number): number {
  return Math.max(0, Math.min(BUBBLE_MINIS, BUBBLE_MAX_ALL - alive))
}

export interface Circle {
  x: number
  y: number
  r: number
}

/** 手指點到哪一顆：點在圓內（加上手指寬容距離 slop）裡，離圓心最近的那顆；都沒有回 -1 */
export function pickCircle(circles: readonly Circle[], x: number, y: number, slop: number): number {
  let best = -1
  let bestD = Infinity
  circles.forEach((c, i) => {
    const d = Math.hypot(c.x - x, c.y - y)
    if (d <= c.r + slop && d < bestD) {
      best = i
      bestD = d
    }
  })
  return best
}

// ---------- 接水果 ----------

/** 一回固定幾顆 */
export const CATCH_TOTAL = 15
/** 水果只用這幾種 */
export const CATCH_FRUITS = ['apple', 'banana', 'grape', 'peach', 'watermelon'] as const
/** 水果的水平範圍：左右留邊，籃子一定接得到 */
export const CATCH_X_MIN = 0.1
export const CATCH_X_MAX = 0.9

export interface CatchTune {
  /** 水果從上掉到地要多久 */
  fallMs: number
  /** 兩次掉落的間隔 */
  gapMs: number
  /** 籃子寬（vmin，px 下限見 basketMinPx） */
  basketVmin: number
  basketMinPx: number
  /** 吸力範圍（以畫面寬為 1）；0 = 沒有吸力 */
  magnet: number
  /** 每幾次掉落有一次同時兩顆；0 = 不會 */
  pairEvery: number
  /** 下一顆離上一顆最遠多少（3 歲不用跑太遠） */
  maxStep: number
}

export const CATCH_TUNE: Record<AgeBand, CatchTune> = {
  '3': { fallMs: 5200, gapMs: 2300, basketVmin: 34, basketMinPx: 170, magnet: 0.26, pairEvery: 0, maxStep: 0.32 },
  '4-5': { fallMs: 3700, gapMs: 1600, basketVmin: 28, basketMinPx: 140, magnet: 0, pairEvery: 0, maxStep: 0.5 },
  '6-7': { fallMs: 2500, gapMs: 1100, basketVmin: 22, basketMinPx: 116, magnet: 0, pairEvery: 4, maxStep: 0.8 },
}

export interface CatchDrop {
  i: number
  /** 這回開始後第幾毫秒開始掉 */
  at: number
  x: number
  foodId: string
}

/** 一回的掉落表：只由年齡與種子決定，一定剛好 CATCH_TOTAL 顆 */
export function catchPlan(band: AgeBand, seed: number): CatchDrop[] {
  const tune = CATCH_TUNE[band]
  const rand = seededRandom(seed)
  const span = CATCH_X_MAX - CATCH_X_MIN
  const fruitAt = Math.floor(rand() * CATCH_FRUITS.length)
  const out: CatchDrop[] = []
  let x = CATCH_X_MIN + span * rand()
  let wave = 0
  while (out.length < CATCH_TOTAL) {
    const at = wave * tune.gapMs
    const push = (px: number) => out.push({ i: out.length, at, x: px, foodId: CATCH_FRUITS[(fruitAt + out.length) % CATCH_FRUITS.length] })
    const lo = Math.max(CATCH_X_MIN, x - tune.maxStep)
    const hi = Math.min(CATCH_X_MAX, x + tune.maxStep)
    x = lo + (hi - lo) * rand()
    push(x)
    wave++
    if (tune.pairEvery && wave % tune.pairEvery === 0 && out.length < CATCH_TOTAL) {
      // 同時兩顆：放在離第一顆夠遠的那一邊
      const other = x < 0.5 ? x + 0.35 + (CATCH_X_MAX - x - 0.35) * rand() : x - 0.35 - (x - 0.35 - CATCH_X_MIN) * rand()
      push(other)
    }
  }
  return out
}

/** 水果掉到哪了：0 = 剛出現，1 = 碰到地面。微微加速，比較像真的在掉 */
export function catchFall(t: number, drop: CatchDrop, tune: CatchTune): number {
  const p = Math.min(1, Math.max(0, (t - drop.at) / tune.fallMs))
  return p * (0.72 + 0.28 * p)
}

/** 3 歲的吸力：掉到下半段、離籃子夠近時，慢慢往籃子靠。離得越近靠得越多，邊界上是 0，不會突然跳 */
export function catchMagnetX(x: number, basketX: number, fall: number, tune: CatchTune): number {
  if (!tune.magnet || fall <= 0.4) return x
  const dx = basketX - x
  const dist = Math.abs(dx)
  if (dist >= tune.magnet) return x
  return x + dx * ((fall - 0.4) / 0.6) * (1 - dist / tune.magnet)
}

/** 籃子中心的合法範圍：不能跑出畫面 */
export function catchClampBasket(x: number, halfWidth: number): number {
  return Math.min(1 - halfWidth, Math.max(halfWidth, x))
}

/**
 * 水果這一步有沒有碰到籃口那段高度：看「上一步到這一步」走過的整段，不是只看現在的位置。
 * 卡頓時一步可以走很遠，只看現在會讓水果穿過籃子。
 */
export const catchAtRim = (prevY: number, y: number, rimTop: number, rimBottom: number): boolean => y >= rimTop && prevY <= rimBottom

export const catchHit = (fruitX: number, basketX: number, halfHit: number): boolean => Math.abs(fruitX - basketX) <= halfHit

/** 一回結束寵物說什麼。一顆都沒接到就不說「接到好多」，安靜陪著就好 */
export function catchEndLine(caught: number, broke: boolean): string | null {
  if (caught === 0) return null
  return broke ? 'pet.play.catch.more' : 'pet.play.catch.done'
}

// ---------- 翻翻配對 ----------

export const MEMORY_CARDS: Record<AgeBand, number> = { '3': 4, '4-5': 8, '6-7': 12 }
/** 牌裡代表「寵物圖」的 id，其餘都是 FOOD_IDS */
export const MEMORY_PET = 'pet'
/** 翻回去前讓孩子看清楚的時間 */
export const MEMORY_MISS_MS = 1100
/** 配對成功後等翻牌動作做完 */
export const MEMORY_MATCH_MS = 420

/** 一局的牌：寵物一對 + 食物，洗過 */
export function memoryDeck(band: AgeBand, seed: number): string[] {
  const rand = seededRandom(seed)
  const pairs = MEMORY_CARDS[band] / 2
  const foods = shuffled(FOOD_IDS, rand).slice(0, pairs - 1)
  const faces = [MEMORY_PET, ...foods]
  return shuffled([...faces, ...faces], rand)
}

export interface MemoryState {
  deck: readonly string[]
  /** 翻開、還沒定案的牌（最多兩張） */
  up: readonly number[]
  /** 已配對的牌 */
  matched: readonly number[]
  /** 兩張都翻開、等動作做完：這時不能翻第三張 */
  locked: boolean
  /** 連續翻錯幾次（配對成功歸零） */
  missStreak: number
}

export type MemoryEvent = 'none' | 'first' | 'match' | 'miss' | 'win'

export const memoryStart = (deck: readonly string[]): MemoryState => ({ deck, up: [], matched: [], locked: false, missStreak: 0 })

/** 點一張牌。動作中、已翻開、已配對的牌都不算數（event = 'none'） */
export function memoryFlip(s: MemoryState, i: number): { state: MemoryState; event: MemoryEvent } {
  if (s.locked || i < 0 || i >= s.deck.length || s.up.includes(i) || s.matched.includes(i)) return { state: s, event: 'none' }
  if (s.up.length === 0) return { state: { ...s, up: [i] }, event: 'first' }
  const first = s.up[0]
  const up = [first, i]
  if (s.deck[first] !== s.deck[i]) return { state: { ...s, up, locked: true, missStreak: s.missStreak + 1 }, event: 'miss' }
  const matched = [...s.matched, first, i]
  return { state: { ...s, up, matched, locked: true, missStreak: 0 }, event: matched.length === s.deck.length ? 'win' : 'match' }
}

/** 動作做完：翻開的牌歸位（配對好的留在 matched），可以再翻 */
export const memorySettle = (s: MemoryState): MemoryState => ({ ...s, up: [], locked: false })

/** 這次翻錯要不要說話：連續翻錯只說第一次，免得一直念 */
export const memorySayMiss = (s: MemoryState): boolean => s.missStreak === 1

export interface MemoryLayout {
  cols: number
  rows: number
  cardW: number
  cardH: number
}

const LAYOUTS: Record<number, readonly (readonly [number, number])[]> = {
  4: [[2, 2]],
  8: [
    [4, 2],
    [2, 4],
  ],
  12: [
    [4, 3],
    [3, 4],
  ],
}
/** 卡片寬高比的範圍：可以略胖或略瘦來填滿畫面，但不能變成長條 */
const CARD_MIN_RATIO = 0.74
const CARD_MAX_RATIO = 1.3

/** 依可用空間挑排法，讓卡片的短邊最大（圖是方的，短邊決定看起來多大） */
export function memoryLayout(cards: number, width: number, height: number, gap: number): MemoryLayout {
  const options = LAYOUTS[cards] ?? [[Math.ceil(Math.sqrt(cards)), Math.ceil(cards / Math.ceil(Math.sqrt(cards)))]]
  let best: (MemoryLayout & { score: number }) | null = null
  for (const [cols, rows] of options) {
    const cellW = Math.max(0, (width - gap * (cols - 1)) / cols)
    const cellH = Math.max(0, (height - gap * (rows - 1)) / rows)
    const cardW = Math.min(cellW, cellH * CARD_MAX_RATIO)
    const cardH = Math.min(cellH, cellW / CARD_MIN_RATIO)
    const score = Math.min(cardW, cardH)
    if (!best || score > best.score) best = { cols, rows, cardW: Math.floor(cardW), cardH: Math.floor(cardH), score }
  }
  const { cols, rows, cardW, cardH } = best!
  return { cols, rows, cardW, cardH }
}
