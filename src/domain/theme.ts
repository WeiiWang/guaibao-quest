import type { Inventory, RoomThemeChoice, ThemeSlot } from './types'
import type { MaterialCost } from '../learning/types'

/** 房間主題（壁紙 / 地板）。外觀由 RoomBackdrop 的 CSS 畫出，id 同時是 CSS class 名稱。 */
export interface ThemeDef {
  id: string
  slot: ThemeSlot
  name: string
  /** 預設主題：不需製作、永遠擁有 */
  isDefault?: boolean
  /** 工坊用的材料成本；預設主題沒有 */
  cost?: MaterialCost
}

const c = (wood: number, stone: number, flower: number): MaterialCost => ({ wood, stone, flower })

export const THEME_DEFS: ThemeDef[] = [
  { id: 'wall-cream', slot: 'wall', name: '奶油素色', isDefault: true },
  { id: 'wall-mint', slot: 'wall', name: '薄荷條紋', cost: c(1, 0, 3) },
  { id: 'wall-pink', slot: 'wall', name: '粉色點點', cost: c(1, 0, 4) },
  { id: 'wall-clouds', slot: 'wall', name: '雲朵', cost: c(0, 3, 3) },
  { id: 'wall-banana', slot: 'wall', name: '香蕉圖案', cost: c(2, 0, 5) },
  { id: 'wall-stars', slot: 'wall', name: '星空藍', cost: c(0, 4, 4) },
  { id: 'floor-wood', slot: 'floor', name: '原木', isDefault: true },
  { id: 'floor-oak', slot: 'floor', name: '白橡木', cost: c(4, 1, 0) },
  { id: 'floor-checker', slot: 'floor', name: '粉彩格子地墊', cost: c(3, 0, 4) },
  { id: 'floor-grass', slot: 'floor', name: '草地', cost: c(2, 0, 7) },
]

export const DEFAULT_THEME: Required<RoomThemeChoice> = { wall: 'wall-cream', floor: 'floor-wood' }

export const themeDef = (id: string): ThemeDef | undefined => THEME_DEFS.find((t) => t.id === id)
export const themesOf = (slot: ThemeSlot): ThemeDef[] => THEME_DEFS.filter((t) => t.slot === slot)

/** 是否擁有：預設主題永遠擁有；其他看背包（qty ≥ 1） */
export function ownsTheme(id: string, inventory: readonly Pick<Inventory, 'itemId' | 'qty'>[]): boolean {
  const def = themeDef(id)
  if (!def) return false
  if (def.isDefault) return true
  return inventory.some((v) => v.itemId === id && v.qty > 0)
}

/**
 * 解析要顯示的主題：settings 存的值若不存在或（理論上）沒擁有，就退回預設。
 * 這樣即使資料被改壞，房間也不會壞版。
 */
export function resolveTheme(
  chosen: RoomThemeChoice | undefined,
  inventory: readonly Pick<Inventory, 'itemId' | 'qty'>[],
): Required<RoomThemeChoice> {
  const pick = (slot: ThemeSlot): string => {
    const id = chosen?.[slot]
    const def = id ? themeDef(id) : undefined
    return def && def.slot === slot && ownsTheme(def.id, inventory) ? def.id : DEFAULT_THEME[slot]
  }
  return { wall: pick('wall'), floor: pick('floor') }
}

export type ApplyThemeCheck = { ok: true; slot: ThemeSlot } | { ok: false; error: string }

/** 套用前檢查：存在且已擁有 */
export function checkApplyTheme(id: string, inventory: readonly Pick<Inventory, 'itemId' | 'qty'>[]): ApplyThemeCheck {
  const def = themeDef(id)
  if (!def) return { ok: false, error: '找不到這個主題' }
  if (!ownsTheme(id, inventory)) return { ok: false, error: '還沒做出這個，先到工坊製作吧' }
  return { ok: true, slot: def.slot }
}

/** 工坊列表排序：預設最前面，其他依材料總量由少到多，再依原本順序 */
export function sortThemesByCost(list: readonly ThemeDef[]): ThemeDef[] {
  const total = (t: ThemeDef) => (t.cost ? t.cost.wood + t.cost.stone + t.cost.flower : -1)
  return list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => total(a.t) - total(b.t) || a.i - b.i)
    .map((x) => x.t)
}
