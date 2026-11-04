import type { GardenPlot } from './types'

// v8.3 小菜園（純函式）。日期都由呼叫端給，方便測換日。
// 規則：種子免費；一塊田一天最多長一階；不會枯萎、不澆水就只是等著；不顯示倒數。
//
// 種下那天還沒「長過」（grewOn 是空字串），當天澆水就長一階，孩子第一次就看得到變化。
// 小芽 → 葉子 → 長好只有兩階，所以最快是「今天澆、明天澆」，第二天就能收。

export const GARDEN_SIZE = 6
export const GARDEN_CROPS = ['carrot', 'watermelon', 'grape', 'apple', 'peach', 'banana'] as const
export type GardenCrop = (typeof GARDEN_CROPS)[number]
export const CROP_LABELS: Record<GardenCrop, string> = { carrot: '紅蘿蔔', watermelon: '西瓜', grape: '葡萄', apple: '蘋果', peach: '桃子', banana: '香蕉' }
/** 一次收成幾個 */
export const HARVEST_QTY = 2

export type Garden = (GardenPlot | null)[]

export const isGardenCrop = (s: string): s is GardenCrop => (GARDEN_CROPS as readonly string[]).includes(s)

const isPlot = (p: unknown): p is GardenPlot => {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return typeof o.crop === 'string' && isGardenCrop(o.crop) && (o.stage === 0 || o.stage === 1 || o.stage === 2) && typeof o.grewOn === 'string'
}

/** 舊存檔沒有這個欄位、或資料長度不對：一律整理成 6 塊田，認不得的田當空田 */
export function normalizeGarden(raw: unknown): Garden {
  const src = Array.isArray(raw) ? raw : []
  return Array.from({ length: GARDEN_SIZE }, (_, i) => (isPlot(src[i]) ? src[i] : null))
}

export type PlotState = 'empty' | 'thirsty' | 'sleeping' | 'ready'

/** 這塊田現在的樣子：沒種、澆水會長、今天長過了在睡覺、可以收 */
export function plotState(plot: GardenPlot | null, date: string): PlotState {
  if (!plot) return 'empty'
  if (plot.stage === 2) return 'ready'
  return plot.grewOn === date ? 'sleeping' : 'thirsty'
}

/** 種下：只能種在空田，種子一定是清單裡的。不成立回傳 null */
export function plantSeed(raw: unknown, index: number, crop: string): Garden | null {
  const garden = normalizeGarden(raw)
  if (index < 0 || index >= GARDEN_SIZE || garden[index] || !isGardenCrop(crop)) return null
  garden[index] = { crop, stage: 0, grewOn: '' }
  return garden
}

/** grew 長了一階；asleep 今天長過了；ready 已經長好；empty 沒種東西 */
export type WaterOutcome = 'grew' | 'asleep' | 'ready' | 'empty'

/** 澆水。只有 grew 會改資料，其他情況回傳原樣（一樣給孩子水滴和開心動畫，由畫面決定） */
export function waterPlot(raw: unknown, index: number, date: string): { garden: Garden; outcome: WaterOutcome } {
  const garden = normalizeGarden(raw)
  const plot = garden[index]
  const state = plotState(plot ?? null, date)
  if (!plot || state === 'empty') return { garden, outcome: 'empty' }
  if (state === 'ready') return { garden, outcome: 'ready' }
  if (state === 'sleeping') return { garden, outcome: 'asleep' }
  garden[index] = { ...plot, stage: plot.stage === 0 ? 1 : 2, grewOn: date }
  return { garden, outcome: 'grew' }
}

/** 收成：只有長好的能收，田變空。不成立回傳 null */
export function harvestPlot(raw: unknown, index: number): { garden: Garden; crop: GardenCrop; qty: number } | null {
  const garden = normalizeGarden(raw)
  const plot = garden[index]
  if (!plot || plot.stage !== 2 || !isGardenCrop(plot.crop)) return null
  garden[index] = null
  return { garden, crop: plot.crop, qty: HARVEST_QTY }
}

export const hasReadyCrop = (raw: unknown): boolean => normalizeGarden(raw).some((p) => p?.stage === 2)

/** 進菜園時寵物說哪一句（lines.ts 的 key）：有長好的先講；有能澆的請孩子澆；還有空田就請孩子種；都睡了就明天見 */
export function gardenIntroLine(raw: unknown, date: string): string {
  const states = normalizeGarden(raw).map((p) => plotState(p, date))
  if (states.includes('ready')) return 'pet.play.garden.ready'
  if (states.includes('thirsty')) return 'pet.play.garden.water'
  if (states.includes('empty')) return 'pet.play.garden.intro'
  return 'pet.play.garden.tomorrow'
}

/** 田上要畫哪張圖 */
export function plantArt(plot: GardenPlot): string {
  if (plot.stage === 0) return 'ui-plant-sprout'
  if (plot.stage === 1) return 'ui-plant-leafy'
  return `ui-plant-${plot.crop}`
}
