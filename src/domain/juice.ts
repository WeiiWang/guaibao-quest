import { dayNumber } from './parentTips'
import type { AgeBand } from './types'

// v8.4 果汁攤（純函式）：客人順序、點什麼、果汁機最多放幾個、做對了沒、果汁什麼顏色。
// 沒有輸：做錯客人也會喝，只是表情好笑、再點一次；沒有倒數。

/** 客人固定順序：熊 → 小雞 → 牛 → 兔子，一直輪 */
export const JUICE_CUSTOMERS = ['bear', 'chick', 'cow', 'rabbit'] as const
export type JuiceCustomer = (typeof JUICE_CUSTOMERS)[number]

/** 適合打果汁的水果（public/art/food-*.png 都有） */
export const JUICE_FRUITS = ['banana', 'apple', 'grape', 'peach', 'watermelon'] as const
export type JuiceFruit = (typeof JUICE_FRUITS)[number]

/** 一回幾位客人 */
export const JUICE_PER_ROUND = 3

/** 果汁機最多放幾塊水果（再丟會彈回來） */
export const JUICE_BLENDER_MAX = 4

/** 6–7 歲點單泡泡看多久收起來（毫秒）；點客人會再出現同樣久 */
export const JUICE_PEEK_MS = 4000

/** 第 round 回（從 0 起算）的第 i 位客人是誰：接著上一回往下輪，同一回 3 位不會重複 */
export const juiceCustomer = (round: number, i: number): JuiceCustomer => JUICE_CUSTOMERS[(round * JUICE_PER_ROUND + i) % JUICE_CUSTOMERS.length]

/** 點幾種水果：3 歲 1 種、4–5 歲 2 種、6–7 歲 2 或 3 種（輪流） */
export function juiceKinds(band: AgeBand, seed: number): number {
  if (band === '3') return 1
  if (band === '4-5') return 2
  return seed % 2 === 0 ? 3 : 2
}

/**
 * 今天第 round 回第 i 位客人點什麼（不重複的水果，依日期、回數、第幾位固定輪替，不用亂數）。
 * 跟果汁機裡放的順序無關，所以回傳排好的順序（照 JUICE_FRUITS）。
 */
export function juiceOrder(date: string, round: number, i: number, band: AgeBand): JuiceFruit[] {
  const n = JUICE_FRUITS.length
  const seed = dayNumber(date) * 7 + round * JUICE_PER_ROUND + i
  const kinds = juiceKinds(band, seed)
  const start = ((seed * 2) % n + n) % n
  // 步長 2 跟 5 互質：連續幾位客人的第一種水果不會一樣
  const picked = new Set<JuiceFruit>()
  for (let k = 0; picked.size < kinds; k++) picked.add(JUICE_FRUITS[(start + k * 2) % n])
  return JUICE_FRUITS.filter((f) => picked.has(f))
}

/** 做對了沒：果汁機裡的水果「種類」跟點單一樣就對（同一種放兩塊也算對，順序不管） */
export function juiceMatches(order: readonly string[], blended: readonly string[]): boolean {
  const a = new Set(order)
  const b = new Set(blended)
  return a.size === b.size && [...a].every((f) => b.has(f))
}

/** 還丟得進果汁機嗎 */
export const juiceCanAdd = (blender: readonly string[]): boolean => blender.length < JUICE_BLENDER_MAX

/** 每種水果打成汁的顏色（RGB） */
export const JUICE_COLORS: Record<JuiceFruit, readonly [number, number, number]> = {
  banana: [255, 222, 89],
  apple: [240, 82, 82],
  grape: [142, 76, 194],
  peach: [255, 166, 128],
  watermelon: [255, 99, 132],
}

/** 混出來的果汁顏色：每一塊水果平均（放兩塊香蕉就比較黃）。空的回傳 null */
export function juiceColor(blended: readonly string[]): string | null {
  const cs = blended.map((f) => JUICE_COLORS[f as JuiceFruit]).filter(Boolean)
  if (!cs.length) return null
  const avg = [0, 1, 2].map((k) => Math.round(cs.reduce((s, c) => s + c[k], 0) / cs.length))
  return `rgb(${avg[0]} ${avg[1]} ${avg[2]})`
}

/** 這位客人的點單泡泡現在要不要顯示：3、4–5 歲一直在；6–7 歲看 4 秒收起來，點客人再出現 4 秒 */
export function juiceBubbleShown(band: AgeBand, sinceShownMs: number): boolean {
  if (band !== '6-7') return true
  return sinceShownMs < JUICE_PEEK_MS
}
