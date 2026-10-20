import { describe, expect, it } from 'vitest'
import { SHOP_ITEMS } from './constants'
import { checkApplyTheme, DEFAULT_THEME, ownsTheme, resolveTheme, sortThemesByCost, THEME_DEFS, themesOf } from './theme'

const inv = (...ids: string[]) => ids.map((itemId) => ({ itemId, qty: 1 }))

describe('房間主題', () => {
  it('壁紙 6 種、地板 4 種，各有一個預設；id 不重複', () => {
    expect(themesOf('wall')).toHaveLength(6)
    expect(themesOf('floor')).toHaveLength(4)
    expect(THEME_DEFS.filter((t) => t.isDefault).map((t) => t.id).sort()).toEqual(['floor-wood', 'wall-cream'])
    expect(new Set(THEME_DEFS.map((t) => t.id)).size).toBe(THEME_DEFS.length)
  })
  it('非預設主題都有材料成本，並出現在商品目錄（kind theme）', () => {
    for (const t of THEME_DEFS.filter((x) => !x.isDefault)) {
      expect(t.cost, t.id).toBeDefined()
      expect(SHOP_ITEMS.find((i) => i.id === t.id)).toMatchObject({ kind: 'theme', themeSlot: t.slot })
    }
  })
  it('預設主題永遠擁有；其他看背包', () => {
    expect(ownsTheme('wall-cream', [])).toBe(true)
    expect(ownsTheme('wall-mint', [])).toBe(false)
    expect(ownsTheme('wall-mint', inv('wall-mint'))).toBe(true)
    expect(ownsTheme('wall-mint', [{ itemId: 'wall-mint', qty: 0 }])).toBe(false)
    expect(ownsTheme('nope', inv('nope'))).toBe(false)
  })
  it('resolveTheme：沒設定用預設；設了但沒擁有、或 id 壞掉也退回預設', () => {
    expect(resolveTheme(undefined, [])).toEqual(DEFAULT_THEME)
    expect(resolveTheme({ wall: 'wall-stars' }, [])).toEqual(DEFAULT_THEME)
    expect(resolveTheme({ wall: 'wall-stars', floor: 'floor-grass' }, inv('wall-stars'))).toEqual({ wall: 'wall-stars', floor: 'floor-wood' })
    expect(resolveTheme({ wall: 'floor-oak', floor: 'wall-pink' }, inv('floor-oak', 'wall-pink'))).toEqual(DEFAULT_THEME) // 放錯位置
    expect(resolveTheme({ wall: 'zzz' }, [])).toEqual(DEFAULT_THEME)
  })
  it('checkApplyTheme：已擁有才能套用', () => {
    expect(checkApplyTheme('floor-oak', [])).toMatchObject({ ok: false })
    expect(checkApplyTheme('floor-oak', inv('floor-oak'))).toEqual({ ok: true, slot: 'floor' })
    expect(checkApplyTheme('wall-cream', [])).toEqual({ ok: true, slot: 'wall' })
    expect(checkApplyTheme('nope', [])).toMatchObject({ ok: false })
  })
  it('工坊排序：預設最前，其餘材料由少到多', () => {
    const sorted = sortThemesByCost(themesOf('wall'))
    expect(sorted[0].id).toBe('wall-cream')
    const totals = sorted.slice(1).map((t) => t.cost!.wood + t.cost!.stone + t.cost!.flower)
    expect([...totals].sort((a, b) => a - b)).toEqual(totals)
  })
})
