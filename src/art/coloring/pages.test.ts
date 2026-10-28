import { describe, expect, it } from 'vitest'
import { COLORING_PAGE_IDS } from '../../domain/constants'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { COLORING_PAGES, FREE_PAGE_IDS, isFreePage, pageName } from './pages'
import { AVAILABLE_RASTER, RASTER_DEFS, rasterSrc } from './rasterDefs'

describe('著色頁資料', () => {
  it('18 張向量頁（10 張原有 + 8 張西遊記）+ 素材已備妥的點陣頁，id 與商店常數一致', () => {
    expect(COLORING_PAGES.map((p) => p.id)).toEqual([...COLORING_PAGE_IDS])
    expect(COLORING_PAGES.filter((p) => p.kind !== 'raster')).toHaveLength(18)
  })
  it('點陣頁：有線稿網址與分級，區塊在執行時才算（regions 為空）', () => {
    for (const p of COLORING_PAGES.filter((x) => x.kind === 'raster')) {
      expect(p.src).toBe(`art/coloring/${p.id}.png`)
      expect(['easy', 'hard']).toContain(p.tier)
      expect(p.regions).toEqual([])
    }
  })
  it('manifest 裡的每一張都有 PNG 檔、名單裡的 id 不重複', () => {
    expect(new Set(RASTER_DEFS.map((d) => d.id)).size).toBe(RASTER_DEFS.length)
    for (const d of AVAILABLE_RASTER) expect(existsSync(join(process.cwd(), 'public', rasterSrc(d.id)))).toBe(true)
  })
  it('空白畫紙 3 張存檔欄位', () => {
    expect([...FREE_PAGE_IDS]).toEqual(['free-1', 'free-2', 'free-3'])
    expect(isFreePage('free-2')).toBe(true)
    expect(isFreePage('monkey')).toBe(false)
    expect(pageName('free-3')).toBe('空白畫紙 3')
    expect(pageName('monkey')).toBe('小猴子')
  })
  it.each(COLORING_PAGES.filter((p) => p.kind !== 'raster').map((p) => [p.id, p] as const))('%s：6–15 個區域、id 不重複、path 皆封閉', (_id, page) => {
    expect(page.regions.length).toBeGreaterThanOrEqual(6)
    expect(page.regions.length).toBeLessThanOrEqual(15)
    expect(new Set(page.regions.map((r) => r.id)).size).toBe(page.regions.length)
    for (const r of page.regions) {
      const m = (r.d.match(/M/g) ?? []).length
      const z = (r.d.match(/Z/g) ?? []).length
      expect(m).toBe(1)
      expect(z).toBe(1)
      expect(r.d).not.toContain('NaN')
    }
  })
})
