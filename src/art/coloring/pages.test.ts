import { describe, expect, it } from 'vitest'
import { COLORING_PAGE_IDS } from '../../domain/constants'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COLORING_PAGES, FREE_PAGE_IDS, isFreePage, orderForList, pageName } from './pages'
import { AVAILABLE_RASTER, RASTER_DEFS, rasterSrc } from './rasterDefs'
import { rasterHdUrl, rasterUrl } from './rasterArt'

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

describe('v7.3 F5：著色本列表的排序', () => {
  const easy = COLORING_PAGES.filter((p) => (p.tier ?? 'easy') === 'easy')
  const rasterIds = easy.filter((p) => p.kind === 'raster').map((p) => p.id)
  const free = new Set(['coloring-line-awu-banana', 'coloring-line-awu-bath', 'coloring-monkey', 'coloring-banana-tree'])
  it('最漂亮的「阿悟抱香蕉」第一個；已擁有的向量頁排在已擁有的點陣頁後面', () => {
    const order = orderForList(easy, free)
    expect(order[0].id).toBe('line-awu-banana')
    expect(order.slice(0, 4).map((p) => p.id)).toEqual(['line-awu-banana', 'line-awu-bath', 'monkey', 'banana-tree'])
    expect(order).toHaveLength(easy.length)
  })
  it('已擁有的永遠在上鎖的前面；上鎖的也是點陣頁在前、向量頁在後', () => {
    const order = orderForList(easy, new Set(['coloring-line-train', 'coloring-clouds']))
    const lockedAt = order.findIndex((p) => !['line-train', 'clouds'].includes(p.id))
    expect(order.slice(0, lockedAt).map((p) => p.id)).toEqual(['line-train', 'clouds'])
    const locked = order.slice(lockedAt)
    const firstVec = locked.findIndex((p) => p.kind !== 'raster')
    expect(locked.slice(0, firstVec).every((p) => p.kind === 'raster')).toBe(true)
    expect(locked.slice(firstVec).every((p) => p.kind !== 'raster')).toBe(true)
  })
  it('什麼都沒擁有時：點陣頁在前、維持原本的相對順序', () => {
    const order = orderForList(easy, new Set())
    expect(order.slice(0, rasterIds.length).map((p) => p.id)).toEqual(rasterIds)
  })
  it('不改動傳進來的陣列', () => {
    const before = easy.map((p) => p.id)
    orderForList(easy, new Set(['coloring-line-train']))
    expect(easy.map((p) => p.id)).toEqual(before)
  })
})

describe('v7.3 F2：高解析線稿（-hd）', () => {
  const dims = (file: string) => {
    const b = readFileSync(file)
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), sig: b.subarray(1, 4).toString('latin1') }
  }
  it('每張點陣頁都有 2048 的 -hd.png，1024 那份（區塊表、縮圖用）維持不變', () => {
    for (const d of AVAILABLE_RASTER) {
      const base = dims(join(process.cwd(), 'public', rasterSrc(d.id)))
      const hd = dims(join(process.cwd(), 'public', rasterSrc(d.id).replace(/\.png$/, '-hd.png')))
      expect([base.w, base.h], d.id).toEqual([1024, 1024])
      expect([hd.w, hd.h], d.id).toEqual([2048, 2048])
      expect(hd.sig).toBe('PNG')
    }
  })
  it('rasterHdUrl：點陣頁指向 -hd.png（與 1024 那份同資料夾），向量頁沒有', () => {
    expect(rasterHdUrl('line-awu-banana')).toBe(rasterUrl('line-awu-banana')!.replace('.png', '-hd.png'))
    expect(rasterHdUrl('line-awu-banana')).toMatch(/art\/coloring\/line-awu-banana-hd\.png$/)
    expect(rasterHdUrl('monkey')).toBeNull()
  })
})
