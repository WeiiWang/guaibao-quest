import { describe, expect, it } from 'vitest'
import { COLORING_PAGE_IDS } from '../../domain/constants'
import { COLORING_PAGES } from './pages'

describe('著色頁資料', () => {
  it('18 張（10 張原有 + 8 張西遊記），id 與商店常數一致', () => {
    expect(COLORING_PAGES.map((p) => p.id)).toEqual([...COLORING_PAGE_IDS])
  })
  it.each(COLORING_PAGES.map((p) => [p.id, p] as const))('%s：6–15 個區域、id 不重複、path 皆封閉', (_id, page) => {
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
