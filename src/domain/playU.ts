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

export type BubbleContent = { kind: 'food'; id: string } | { kind: 'star' } | { kind: 'animal'; id: string } | { kind: 'none' }

/** v8.5 動物泡泡：每幾顆有一顆裡面是小動物（固定節奏，不靠機率） */
export const BUBBLE_ANIMAL_EVERY = 5
/** 輪流出現的小動物（圖是 obj-<id>） */
export const BUBBLE_ANIMALS = ['bear', 'rabbit', 'chick', 'cow', 'fish', 'octopus'] as const

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

/**
 * 第 n 顆泡泡（從 0 算）長什麼樣。用黃金比例撒開，不會連續擠在同一邊。
 * toys ≥ 1（v8.5 動物泡泡）：每 5 顆的最後一顆裡面是小動物，六種輪流；其他的泡泡跟原本一模一樣。
 */
export function bubbleSpec(n: number, toys = 0): BubbleSpec {
  const big = n % BUBBLE_BIG_EVERY === BUBBLE_BIG_EVERY - 1
  const cycle = n % 4
  const animal = toys >= 1 && !big && n % BUBBLE_ANIMAL_EVERY === BUBBLE_ANIMAL_EVERY - 1
  const content: BubbleContent = animal
    ? { kind: 'animal', id: BUBBLE_ANIMALS[Math.floor(n / BUBBLE_ANIMAL_EVERY) % BUBBLE_ANIMALS.length] }
    : big || cycle === 3
      ? { kind: 'none' }
      : cycle === 2
        ? { kind: 'star' }
        : { kind: 'food', id: FOOD_IDS[n % FOOD_IDS.length] }
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

/** v8.5 泡泡棒：現在還能再吹幾顆。跟大泡泡噴的小泡泡用同一個總上限，畫面上絕對不超過 */
export function bubbleWandRoom(alive: number): number {
  return Math.max(0, BUBBLE_MAX_ALL - alive)
}

export interface WandPuffs {
  /** 這一段路上要吹出泡泡的位置（照順序） */
  points: { x: number; y: number }[]
  /** 還沒用掉的距離，帶到下一段 */
  carry: number
}

/**
 * v8.5 泡泡棒沿路吹泡泡：手指每走 step 這麼遠吹一顆。只看走了多遠，不看時間也不靠機率，
 * 所以慢慢拖和快快拖吹出來的一樣密；手指不動就不吹。
 */
export function wandPuffs(from: { x: number; y: number }, to: { x: number; y: number }, carry: number, step: number): WandPuffs {
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  if (!(step > 0) || dist === 0) return { points: [], carry }
  const points: { x: number; y: number }[] = []
  let at = step - carry
  while (at <= dist) {
    const k = at / dist
    points.push({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k })
    at += step
  }
  return { points, carry: dist - (at - step) }
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
/** v8.5 金色水果：草莓和橘子加入（圖是 obj-strawberry、obj-orange） */
export const CATCH_FRUITS_MORE = [...CATCH_FRUITS, 'strawberry', 'orange'] as const
/** v8.5 每幾顆有一顆金色的（第 5、10、15 顆）。只是好看，一樣算一顆 */
export const CATCH_GOLD_EVERY = 5
/** v8.5 水果雨一次掉幾顆 */
export const CATCH_RAIN = 8
/** 水果雨開始前停一下（讓寵物說「水果雨來囉」） */
export const CATCH_RAIN_DELAY_MS = 900
/** 水果雨從一邊到另一邊，每顆晚這麼久：籃子掃過去可以接到一串 */
export const CATCH_RAIN_STAGGER_MS = 140
/** 水果雨至少掉這麼久：大孩子的速度拿來一次掉 8 顆會來不及看 */
export const CATCH_RAIN_MIN_FALL_MS = 3400
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
  /** v8.5 金色的（只是好看，不改計分） */
  gold?: boolean
}

/**
 * 一回的掉落表：只由年齡與種子決定，一定剛好 CATCH_TOTAL 顆。
 * toys ≥ 1（v8.5 金色水果）：多草莓和橘子，第 5、10、15 顆是金色的；掉的位置與時間跟原本一樣。
 */
export function catchPlan(band: AgeBand, seed: number, toys = 0): CatchDrop[] {
  const tune = CATCH_TUNE[band]
  const rand = seededRandom(seed)
  const span = CATCH_X_MAX - CATCH_X_MIN
  const kinds: readonly string[] = toys >= 1 ? CATCH_FRUITS_MORE : CATCH_FRUITS
  // 起點照原本的算法抽（0–4），有新水果時掉的位置才不會跟著變
  const fruitAt = Math.floor(rand() * CATCH_FRUITS.length)
  const out: CatchDrop[] = []
  let x = CATCH_X_MIN + span * rand()
  let wave = 0
  while (out.length < CATCH_TOTAL) {
    const at = wave * tune.gapMs
    const push = (px: number) => {
      const i = out.length
      const drop: CatchDrop = { i, at, x: px, foodId: kinds[(fruitAt + i) % kinds.length] }
      if (toys >= 1 && (i + 1) % CATCH_GOLD_EVERY === 0) drop.gold = true
      out.push(drop)
    }
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

/** v8.5 水果雨掉多快：照年齡的速度，但不會比 CATCH_RAIN_MIN_FALL_MS 快；其他（籃子、吸力）不變 */
export const catchRainTune = (band: AgeBand): CatchTune => ({ ...CATCH_TUNE[band], fallMs: Math.max(CATCH_TUNE[band].fallMs, CATCH_RAIN_MIN_FALL_MS) })

/**
 * v8.5 水果雨：8 顆平均撒開（每顆一格，格子裡用種子抖一下），從一邊到另一邊一顆接一顆，幾乎一起掉。
 * 編號接在主回合後面（CATCH_TOTAL 起），at 是水果雨開始後第幾毫秒。接幾個都好，不算個人紀錄。
 */
export function catchRainPlan(seed: number): CatchDrop[] {
  const rand = seededRandom(seed ^ 0x5bd1e995)
  const span = CATCH_X_MAX - CATCH_X_MIN
  const cell = span / CATCH_RAIN
  const fromLeft = rand() < 0.5
  const fruitAt = Math.floor(rand() * CATCH_FRUITS_MORE.length)
  return Array.from({ length: CATCH_RAIN }, (_, k) => {
    const slot = fromLeft ? k : CATCH_RAIN - 1 - k
    return {
      i: CATCH_TOTAL + k,
      at: CATCH_RAIN_DELAY_MS + k * CATCH_RAIN_STAGGER_MS,
      x: CATCH_X_MIN + cell * (slot + 0.2 + 0.6 * rand()),
      foodId: CATCH_FRUITS_MORE[(fruitAt + k) % CATCH_FRUITS_MORE.length],
    }
  })
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

/** v8.5 牌組：水果（原本的）、動物（玩完 1 次）、點心（玩完 3 次） */
export type MemoryDeckId = 'fruit' | 'animal' | 'snack'
export const MEMORY_DECK_IDS: readonly MemoryDeckId[] = ['fruit', 'animal', 'snack']
/** 動物牌的牌面 id 就是圖的名字（obj-*） */
export const MEMORY_ANIMALS: readonly string[] = BUBBLE_ANIMALS.map((a) => `obj-${a}`)
/** 點心牌用的食物（圖是 food-*）。最多的那一檔要 5 種 */
export const MEMORY_SNACKS: readonly string[] = ['cake', 'cookie', 'milk', 'riceball', 'carrot']

/** 有幾個新玩具時可以選哪些牌組。沒有新玩具只有原本那一組（畫面上就不出現選單） */
export function memoryDeckChoices(toys: number): MemoryDeckId[] {
  return MEMORY_DECK_IDS.slice(0, toys >= 2 ? 3 : toys >= 1 ? 2 : 1)
}

/** 上次選的牌組還能不能用（還沒有那個新玩具、或存的是亂七八糟的東西，就回到水果） */
export function memoryDeckOr(saved: string | null | undefined, toys: number): MemoryDeckId {
  return memoryDeckChoices(toys).find((d) => d === saved) ?? 'fruit'
}

const deckPool = (deck: MemoryDeckId): readonly string[] => (deck === 'animal' ? MEMORY_ANIMALS : deck === 'snack' ? MEMORY_SNACKS : FOOD_IDS)

/** 一局的牌：寵物一對 + 這個牌組的牌面（預設是原本的食物），洗過 */
export function memoryDeck(band: AgeBand, seed: number, deck: MemoryDeckId = 'fruit'): string[] {
  const rand = seededRandom(seed)
  const pairs = MEMORY_CARDS[band] / 2
  const picked = shuffled(deckPool(deck), rand).slice(0, pairs - 1)
  const faces = [MEMORY_PET, ...picked]
  return shuffled([...faces, ...faces], rand)
}

/** v8.5 魔法棒：全部翻開給你看多久 */
export const MEMORY_PEEK_MS = 1200
/** 一回可以偷看幾次：3 歲不限，其他年齡 1 次 */
export const memoryPeeks = (band: AgeBand): number => (band === '3' ? Infinity : 1)

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

/** 現在能不能用魔法棒：兩張牌正在翻、已經全部配完、這一回的次數用完了都不行 */
export function memoryCanPeek(s: MemoryState, used: number, band: AgeBand): boolean {
  return !s.locked && s.matched.length < s.deck.length && used < memoryPeeks(band)
}

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
