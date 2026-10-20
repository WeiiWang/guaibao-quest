import type { ShopItem } from './types'

export type BuyCheck =
  | { ok: true }
  | { ok: false; reason: 'insufficient'; shortBy: number }
  | { ok: false; reason: 'owned' }

/** 飼料可重複購買；裝飾與著色頁只能擁有一份 */
export function canBuy(balance: number, ownedQty: number, item: ShopItem): BuyCheck {
  if (item.kind !== 'food' && ownedQty > 0) return { ok: false, reason: 'owned' }
  if (balance < item.price) return { ok: false, reason: 'insufficient', shortBy: item.price - balance }
  return { ok: true }
}
