import type { AgeBand } from './types'

// v8.3 捉迷藏的規則（純函式）：幾個躲藏物、怎麼排、寵物躲哪、提示何時出現。沒有輸、沒有倒數。

export const HIDE_SPOTS = ['bush', 'box', 'barrel', 'tree', 'slide', 'tent'] as const
export type HideSpot = (typeof HIDE_SPOTS)[number]

/** 每個躲藏物固定一種驚喜（點開沒有寵物時出現） */
export type HideSurprise = 'bird' | 'stars' | 'frog' | 'flowers' | 'ball' | 'butterfly'
export const HIDE_SURPRISE: Record<HideSpot, HideSurprise> = {
  bush: 'bird',
  box: 'stars',
  barrel: 'frog',
  tree: 'flowers',
  slide: 'ball',
  tent: 'butterfly',
}

const COUNT: Record<AgeBand, number> = { '3': 4, '4-5': 5, '6-7': 6 }

/** 這個年齡檔草地上有哪些躲藏物（3 歲 4 個、4–5 歲 5 個、6–7 歲 6 個） */
export const hideSpotsFor = (band: AgeBand): readonly HideSpot[] => HIDE_SPOTS.slice(0, COUNT[band])

/** 下一輪躲哪裡：不連續同一處。rand 可注入（位置不是獎勵，可以隨機） */
export function nextHideSpot(spots: readonly HideSpot[], prev: HideSpot | null, rand: () => number = Math.random): HideSpot {
  const pool = spots.filter((s) => s !== prev)
  const from = pool.length ? pool : spots
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))]
}

/** 寵物露出多少：0 完全躲好、1 只露很小一點、2 露出耳朵、3 露出半個頭 */
export type PeekLevel = 0 | 1 | 2 | 3

export interface HidePlan {
  /** 點幾次沒找到後，有寵物的那個會微微晃；null = 不晃 */
  wiggleAfterMisses: number | null
  /** 找了多久（毫秒）之後露出多少，依時間排序 */
  peeks: readonly { afterMs: number; level: PeekLevel }[]
}

const PLANS: Record<AgeBand, HidePlan> = {
  '3': { wiggleAfterMisses: 2, peeks: [] },
  '4-5': {
    wiggleAfterMisses: null,
    peeks: [
      { afterMs: 12_000, level: 2 },
      { afterMs: 25_000, level: 3 },
    ],
  },
  '6-7': {
    wiggleAfterMisses: null,
    peeks: [
      { afterMs: 0, level: 1 },
      { afterMs: 18_000, level: 2 },
      { afterMs: 35_000, level: 3 },
    ],
  },
}

export const hidePlan = (band: AgeBand): HidePlan => PLANS[band]

/** 找了 elapsedMs 之後應該露出多少 */
export function peekLevelAt(plan: HidePlan, elapsedMs: number): PeekLevel {
  let level: PeekLevel = 0
  for (const p of plan.peeks) if (elapsedMs >= p.afterMs) level = p.level
  return level
}

export const shouldWiggle = (plan: HidePlan, misses: number): boolean => plan.wiggleAfterMisses !== null && misses >= plan.wiggleAfterMisses

/** 第 n 次（從 1 算）點空要不要講「不在這裡」：第一次講，之後每 3 次講一次，不要一直念 */
export const saysEmptyLine = (missNo: number): boolean => missNo >= 1 && (missNo - 1) % 3 === 0

export interface HideRect {
  x: number
  y: number
  size: number
}

/** 把 count 個分成 rows 排，多的放外側（5 個排 3 排 = 2、1、2） */
function rowCounts(count: number, rows: number): number[] {
  const base = Math.floor(count / rows)
  const out = Array<number>(rows).fill(base)
  const rest = count - base * rows
  const indexes = out.map((_, i) => i)
  const order = [...indexes.filter((i) => i % 2 === 0), ...indexes.filter((i) => i % 2 === 1)]
  for (let k = 0; k < rest; k++) out[order[k]]++
  return out
}

/**
 * 在 width × height 的草地上排 count 個躲藏物（一律正方形框，圖貼底）：試每一種排數，挑每個最大的。
 * 同一排錯開一點高度，看起來不像表格；每個都留在自己的格子裡，所以不會重疊。
 */
export function hideLayout(count: number, width: number, height: number, opts: { gap?: number; maxSize?: number } = {}): HideRect[] {
  const gap = opts.gap ?? 12
  const maxSize = opts.maxSize ?? 340
  if (count <= 0 || width <= 0 || height <= 0) return []
  let best = { rows: 1, size: -1 }
  for (let rows = 1; rows <= count; rows++) {
    const widest = Math.max(...rowCounts(count, rows))
    const size = Math.min(width / widest, height / rows) - gap
    if (size > best.size + 0.5) best = { rows, size }
  }
  const size = Math.max(1, Math.min(best.size, maxSize))
  const cellH = height / best.rows
  const spare = cellH - size
  const out: HideRect[] = []
  rowCounts(count, best.rows).forEach((n, r) => {
    const cellW = width / n
    for (let c = 0; c < n; c++) {
      const lift = n > 1 ? (c % 2 === 0 ? -0.3 : 0.3) * spare : 0
      out.push({ x: (c + 0.5) * cellW - size / 2, y: r * cellH + spare / 2 + lift, size })
    }
  })
  return out
}

// ---------- v8.5 越玩越多 ----------

/** 換你藏：寵物先看錯幾個再找到。第幾次換你藏（從 0 算）決定：1、2、1、2…，不用亂數 */
export const swapMissCount = (turn: number): 1 | 2 => (Math.max(0, Math.floor(turn)) % 2 === 0 ? 1 : 2)

/**
 * 換你藏：寵物找球的路線。前面是看錯的（不會是有球的那個、也不重複），最後一個一定是有球的。
 * 從哪個開始看也用第幾次決定，所以每次不太一樣，但同一次重算結果相同。
 */
export function swapSeekOrder(spots: readonly HideSpot[], ball: HideSpot, turn: number): HideSpot[] {
  const others = spots.filter((s) => s !== ball)
  const n = Math.min(swapMissCount(turn), others.length)
  const start = others.length ? Math.max(0, Math.floor(turn)) % others.length : 0
  const wrong = Array.from({ length: n }, (_, k) => others[(start + k) % others.length])
  return [...wrong, ball]
}

const LIGHT_RADIUS: Record<AgeBand, number> = { '3': 0.36, '4-5': 0.28, '6-7': 0.22 }

/** 手電筒的光圈半徑，占畫面短邊的比例。3 歲最大（手指不準也照得到） */
export const flashlightRadius = (band: AgeBand): number => LIGHT_RADIUS[band]

/** 晚上版發亮的眼睛：3 歲、4–5 歲黑暗中一直看得到；6–7 歲要光照到才看得到（真的要用手電筒找） */
export const eyesAlwaysGlow = (band: AgeBand): boolean => band !== '6-7'

/** 光圈有沒有照到某一點（照到光圈的八成以內才算，邊緣太暗不算） */
export function lightReaches(light: { x: number; y: number }, radius: number, target: { x: number; y: number }): boolean {
  return Math.hypot(light.x - target.x, light.y - target.y) <= radius * 0.8
}
