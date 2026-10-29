// 禮物（SPEC-v5 經濟）：學習掉落的食物、今日小禮物、圖鑑獎勵。全部是純函式。
// v7.4 H5：獎勵固定、不靠機率 —— 食物種類與每日小禮物都改成固定輪替，不再用亂數。
import { FOOD_IDS } from './constants'
import { favoriteFoodOf } from './favorite'
import type { Gift } from './types'
import { MATERIAL_IDS, type MaterialId } from '../learning/types'

/** 蛋糕是特別的東西（星星買得到），不會掉落 */
export const DROP_FOODS: readonly string[] = FOOD_IDS.filter((f) => f !== 'cake')

/**
 * 掉落食物的順序：每天從「今天最愛的食物」開始，依 DROP_FOODS 的順序輪下去
 * （今天第 1 個掉最愛的，第 2 個是清單裡的下一種…）。同一天任何裝置都一樣。
 * 今天已經掉過幾個，由呼叫端記著（settings.foodDrop），這裡只是純函式。
 */
export function dropFoodOrder(date: string): string[] {
  const at = DROP_FOODS.indexOf(favoriteFoodOf(date))
  // 最愛是蛋糕（不會掉落）時，從清單第一個開始
  const from = at < 0 ? 0 : at
  return DROP_FOODS.map((_, k) => DROP_FOODS[(from + k) % DROP_FOODS.length])
}

/** 今天第 n 個（0 起算）掉落的食物 */
export function dropFoodAt(date: string, n: number): string {
  const order = dropFoodOrder(date)
  return order[((n % order.length) + order.length) % order.length]
}

/** 今天從第 from 個開始，連續掉 count 個 */
export function dropFoods(date: string, from: number, count: number): string[] {
  return Array.from({ length: count }, (_, k) => dropFoodAt(date, from + k))
}

/** 掉落的食物依種類合併，保留第一次出現的順序（結算畫面「蘋果 ×2」只說一次；v7.4 H4） */
export function groupFoods(foods: readonly string[]): { id: string; n: number }[] {
  const out: { id: string; n: number }[] = []
  for (const f of foods) {
    const g = out.find((x) => x.id === f)
    if (g) g.n++
    else out.push({ id: f, n: 1 })
  }
  return out
}

export type GiftKind = 'food' | 'material' | 'sticker'

/** 每日小禮物的固定輪替：食物、材料、食物、貼紙（4 份一輪）。第 n 份（0 起算）用 n % 4 決定種類 */
export const DAILY_ROTATION: readonly GiftKind[] = ['food', 'material', 'food', 'sticker']
export const DAILY_MATERIAL_QTY = 2

/**
 * 貼紙禮物的送出順序（public/art 素材名，記錄在 settings.stickers）：全部是貼紙盤裡的貼紙。
 * 線 I（貼紙盤會成長）預設只開 8 張（阿悟、香蕉、蘋果、桃子、葡萄、蛋糕、火箭、恐龍），所以這裡只放「要解鎖」的那 10 張，
 * 不然貼紙禮物送出去孩子本來就有，又變成死獎勵。順序固定、不重複，送完改送食物。
 * 注意：這份清單要跟 src/domain/stickers.ts 的「預設 8 張以外的貼紙」同步（合併時對一下）。
 */
export const GIFT_STICKERS: readonly string[] = [
  'obj-star',
  'obj-flower',
  'obj-rabbit',
  'obj-chick',
  'obj-fish',
  'obj-shell',
  'decor-rainbow',
  'mat-flower',
  'pet-baby-happy',
  'pet-adult-cheer',
]

/** 下一張要送的貼紙：依固定順序，第一張還沒擁有的；全部都有了就是 null */
export function nextGiftSticker(owned: readonly string[]): string | null {
  return GIFT_STICKERS.find((s) => !owned.includes(s)) ?? null
}

/**
 * 今日小禮物：第 seq 份（0 起算）的內容。固定輪替，沒有機率：
 * - 食物：今天最愛的食物（蛋糕不會掉落，最愛是蛋糕時從清單第一個開始）
 * - 材料：每一輪換一種（木材、石頭、花朵），一次 2 個
 * - 貼紙：依 GIFT_STICKERS 的順序送下一張還沒擁有的；全部送完就改送食物
 */
export function dailyGiftAt(seq: number, date: string, at: number, ownedStickers: readonly string[] = []): Gift {
  const n = Math.max(0, Math.floor(seq))
  const kind = DAILY_ROTATION[n % DAILY_ROTATION.length]
  if (kind === 'material') {
    const round = Math.floor(n / DAILY_ROTATION.length)
    return { materialId: MATERIAL_IDS[round % MATERIAL_IDS.length], qty: DAILY_MATERIAL_QTY, at, from: 'daily' }
  }
  if (kind === 'sticker') {
    const s = nextGiftSticker(ownedStickers)
    if (s) return { stickerId: s, at, from: 'daily' }
  }
  return { foodId: dropFoodAt(date, 0), at, from: 'daily' }
}

export function giftKind(g: Gift): GiftKind {
  if (g.foodId) return 'food'
  if (g.materialId) return 'material'
  return 'sticker'
}

/** 禮物的素材圖名與缺圖時的 emoji 由 UI 決定；這裡只回傳識別字串（食物 id / 材料 id / 貼紙素材名） */
export function giftRef(g: Gift): string {
  return g.foodId ?? g.materialId ?? g.stickerId ?? ''
}

/** 圖鑑收集數對應「應該已經送過幾份」（step = 每幾個送一份，見 collectionStep） */
export const collectionRewardsDue = (known: number, step: number): number => Math.floor(known / Math.max(1, step))

/** 禮物材料 id 的型別守門（讀舊資料時用） */
export const isMaterialId = (v: unknown): v is MaterialId => typeof v === 'string' && (MATERIAL_IDS as readonly string[]).includes(v)
