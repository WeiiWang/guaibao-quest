// 禮物（SPEC-v5 經濟）：學習掉落的食物、今日小禮物、圖鑑獎勵。純函式，亂數由呼叫端注入。
import { FOOD_IDS } from './constants'
import { favoriteFoodOf } from './favorite'
import type { Gift } from './types'
import { MATERIAL_IDS, type MaterialId } from '../learning/types'

/** 蛋糕是特別的東西（星星買得到），不會掉落 */
export const DROP_FOODS: readonly string[] = FOOD_IDS.filter((f) => f !== 'cake')

/** 掉落權重：便宜的常見、貴的少見；今天最愛的食物乘以 FAVORITE_BOOST */
const BASE_WEIGHT: Record<string, number> = {
  carrot: 3,
  cookie: 3,
  banana: 3,
  apple: 3,
  grape: 2,
  milk: 2,
  peach: 2,
  riceball: 1,
  watermelon: 1,
}
export const FAVORITE_BOOST = 3

/** 今日小禮物的比例：食物 60%、材料 30%、貼紙 10% */
export const DAILY_FOOD_P = 0.6
export const DAILY_MATERIAL_P = 0.9 // 累積機率：到這裡為止是食物 + 材料
export const DAILY_MATERIAL_QTY = 2
/** 貼紙禮物的素材（public/art，只記錄） */
export const GIFT_STICKERS = ['obj-star', 'obj-flower', 'obj-shell', 'obj-rabbit', 'obj-chick', 'obj-fish', 'decor-rainbow', 'mat-flower'] as const
/** 圖鑑每收集滿這麼多個，送一份禮物 */
export const COLLECTION_STEP = 6

/** 每種食物的掉落權重（含今天最愛的加權）。蛋糕一律 0 */
export function dropWeights(date: string): { id: string; weight: number }[] {
  const fav = favoriteFoodOf(date)
  return DROP_FOODS.map((id) => ({ id, weight: (BASE_WEIGHT[id] ?? 1) * (id === fav ? FAVORITE_BOOST : 1) }))
}

/** 學習過關掉落的食物：依權重隨機挑一個（今天最愛的機率較高，不掉蛋糕） */
export function rollStationDrop(rng: () => number, date: string): string {
  const list = dropWeights(date)
  const total = list.reduce((s, x) => s + x.weight, 0)
  let r = rng() * total
  for (const x of list) {
    r -= x.weight
    if (r < 0) return x.id
  }
  return list[list.length - 1].id
}

const pickFrom = <T>(arr: readonly T[], rng: () => number): T => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]

/** 今日小禮物：食物 60%、材料（任一種 2 個）30%、貼紙 10% */
export function rollDailyGift(rng: () => number, date: string, at: number): Gift {
  const r = rng()
  if (r < DAILY_FOOD_P) return { foodId: rollStationDrop(rng, date), at, from: 'daily' }
  if (r < DAILY_MATERIAL_P) return { materialId: pickFrom(MATERIAL_IDS, rng), qty: DAILY_MATERIAL_QTY, at, from: 'daily' }
  return { stickerId: pickFrom(GIFT_STICKERS, rng), at, from: 'daily' }
}

export type GiftKind = 'food' | 'material' | 'sticker'
export function giftKind(g: Gift): GiftKind {
  if (g.foodId) return 'food'
  if (g.materialId) return 'material'
  return 'sticker'
}

/** 禮物的素材圖名與缺圖時的 emoji 由 UI 決定；這裡只回傳識別字串（食物 id / 材料 id / 貼紙素材名） */
export function giftRef(g: Gift): string {
  return g.foodId ?? g.materialId ?? g.stickerId ?? ''
}

/** 圖鑑收集數對應「應該已經送過幾份」 */
export const collectionRewardsDue = (known: number): number => Math.floor(known / COLLECTION_STEP)

/** 禮物材料 id 的型別守門（讀舊資料時用） */
export const isMaterialId = (v: unknown): v is MaterialId => typeof v === 'string' && (MATERIAL_IDS as readonly string[]).includes(v)
