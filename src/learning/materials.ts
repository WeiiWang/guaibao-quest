import { SHOP_ITEMS } from '../domain/constants'
import type { ShopItem } from '../domain/types'
import type { MaterialCost, MaterialId } from './types'
import { MATERIAL_IDS } from './types'

/** 家具的材料成本（工坊製作）。總量 3–10，約 1–3 站可做一件小的 */
export const DECOR_COSTS: Record<string, MaterialCost> = {
  'decor-ball': { wood: 2, stone: 0, flower: 1 },
  'decor-clock': { wood: 2, stone: 1, flower: 0 },
  'decor-plant': { wood: 1, stone: 0, flower: 3 },
  'decor-crate': { wood: 4, stone: 1, flower: 0 },
  'decor-poster': { wood: 2, stone: 0, flower: 2 },
  'decor-curtain': { wood: 1, stone: 0, flower: 4 },
  'decor-rug': { wood: 2, stone: 1, flower: 3 },
  'decor-shelf': { wood: 5, stone: 2, flower: 0 },
  'decor-frame': { wood: 2, stone: 3, flower: 1 },
  'decor-bed': { wood: 6, stone: 2, flower: 2 },
}

/** SHOP_ITEMS 加上家具的材料成本（寫入 db.shopItems 的就是這份） */
export const SHOP_CATALOG: ShopItem[] = SHOP_ITEMS.map((i) =>
  i.kind === 'decor' && DECOR_COSTS[i.id] ? { ...i, cost: DECOR_COSTS[i.id] } : i,
)

export type MaterialBalance = Record<MaterialId, number>

export function balanceOfMaterials(entries: { material: MaterialId; delta: number }[]): MaterialBalance {
  const b: MaterialBalance = { wood: 0, stone: 0, flower: 0 }
  for (const e of entries) b[e.material] += e.delta
  return b
}

export type CraftCheck =
  | { ok: true }
  | { ok: false; reason: 'owned' | 'nocost' | 'insufficient'; short: Partial<MaterialCost> }

export function canCraft(balance: MaterialBalance, ownedQty: number, item: ShopItem): CraftCheck {
  if (item.kind !== 'decor' || !item.cost) return { ok: false, reason: 'nocost', short: {} }
  if (ownedQty > 0) return { ok: false, reason: 'owned', short: {} }
  const short: Partial<MaterialCost> = {}
  for (const m of MATERIAL_IDS) if (balance[m] < item.cost[m]) short[m] = item.cost[m] - balance[m]
  if (Object.keys(short).length) return { ok: false, reason: 'insufficient', short }
  return { ok: true }
}
