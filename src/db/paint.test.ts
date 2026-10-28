import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { FREE_RASTER_PAGES, SHOP_ITEMS } from '../domain/constants'
import { AVAILABLE_RASTER, RASTER_PRICE } from '../art/coloring/rasterDefs'
import { bgWithColor, docIsEmpty, docOf, emptyDoc, parseBg } from '../domain/coloring'

const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime()
let n = 0
let repo: Repo
const png = 'data:image/png;base64,AAAA'

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`paint-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})
const qty = async (id: string) => (await repo.db.inventory.get(id))?.qty ?? 0

describe('v7 繪圖板：存檔相容', () => {
  it('舊存檔（向量頁的 fills、沒有 kind 的 strokes、沒有 bg）原樣讀回，不會被補上新欄位', async () => {
    const old = {
      fills: { body: '#e8a6a0' },
      strokes: [{ id: 's1', color: '#3d3a3a', width: 12, points: [[10, 10], [50, 50]] as [number, number][] }],
      stickers: [],
    }
    await repo.db.coloring.put({ pageId: 'fish', ...old, updatedAt: T0 })
    const doc = await repo.getColoringDoc('fish')
    expect(doc).toEqual(old)
    expect(doc.strokes[0].kind).toBeUndefined()
    expect('bg' in doc).toBe(false)
  })

  it('新筆畫（kind、stamp）與空白畫紙背景存進去、讀得回來', async () => {
    const doc = {
      fills: {},
      strokes: [
        { id: 'a', color: '#e96a6a', kind: 'crayon' as const, width: 12, points: [[1, 2], [3, 4]] as [number, number][] },
        { id: 'b', color: '#4a9fe0', kind: 'stamp' as const, stamp: 'paw', width: 26, points: [[9, 9]] as [number, number][] },
      ],
      stickers: [],
      bg: 'meadow',
    }
    await repo.saveColoringDoc('free-1', doc, T0)
    expect(await repo.getColoringDoc('free-1')).toEqual(doc)
    // 只更新填色不會洗掉 bg 與筆刷
    await repo.saveColoring('free-1', { r1: '#111111' }, T0 + 1)
    const back = await repo.getColoringDoc('free-1')
    expect(back.bg).toBe('meadow')
    expect(back.strokes).toHaveLength(2)
  })

  it('點陣頁：fills 的 key 是 r<label>，存讀不受影響', async () => {
    const doc = { fills: { r1: '#e8a6a0', r7: 'rainbow', r12: 'dots:#4a9fe0' }, strokes: [], stickers: [] }
    await repo.saveColoringDoc('line-awu-banana', doc, T0)
    expect(await repo.getColoringDoc('line-awu-banana')).toEqual(doc)
  })

  it('docOf / docIsEmpty：背景算內容，沒設背景的空畫面是空的', () => {
    expect(docIsEmpty(emptyDoc())).toBe(true)
    expect(docIsEmpty({ ...emptyDoc(), bg: 'sea' })).toBe(false)
    expect(docOf(undefined)).toEqual(emptyDoc())
    expect(docOf({ fills: {}, bg: '#aabbcc' }).bg).toBe('#aabbcc')
  })
})

describe('空白畫紙：完成、畫廊、掛到房間、再畫一張', () => {
  const doc = {
    fills: {},
    strokes: [{ id: 's', color: '#e96a6a', kind: 'rainbow' as const, width: 12, points: [[10, 10], [80, 80]] as [number, number][] }],
    stickers: [],
    bg: 'night',
  }

  it('可以完成：畫廊作品帶 bg，basePageId 是 free-N，名稱是「我的畫：空白畫紙 N」', async () => {
    const r = await repo.completeColoring('free-2', doc, png, T0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const list = await repo.listGallery()
    expect(list[0]).toMatchObject({ basePageId: 'free-2', bg: 'night', strokes: doc.strokes })
    const h = await repo.hangArtwork(r.galleryId, T0)
    expect(h.ok).toBe(true)
    expect((await repo.db.shopItems.get(`art-${r.galleryId}`))?.name).toBe('我的畫：空白畫紙 2')
  })

  it('不存在的畫紙欄位（free-9）被拒絕', async () => {
    expect((await repo.completeColoring('free-9', doc, png)).ok).toBe(false)
  })

  it('再畫一張新的：清掉存檔欄位，畫廊裡完成的作品還在', async () => {
    await repo.saveColoringDoc('free-1', doc, T0)
    const r = await repo.completeColoring('free-1', doc, png, T0)
    expect(r.ok).toBe(true)
    await repo.resetFreeCanvas('free-1')
    expect(await repo.db.coloring.get('free-1')).toBeUndefined()
    expect(docIsEmpty(await repo.getColoringDoc('free-1'))).toBe(true)
    expect((await repo.listGallery())).toHaveLength(1)
    // 不會誤刪著色頁的存檔
    await repo.saveColoringDoc('monkey', doc, T0)
    await repo.resetFreeCanvas('monkey')
    expect(await repo.db.coloring.get('monkey')).toBeDefined()
  })
})

describe('點陣線稿頁：免費送與價格', () => {
  it('新手與既有玩家各送一次（簡單版前 2 張），之後不再補', async () => {
    expect([...FREE_RASTER_PAGES]).toEqual(['line-awu-banana', 'line-awu-bath'])
    expect(await repo.grantFreeRaster()).toBe(true)
    for (const p of FREE_RASTER_PAGES) expect(await qty(`coloring-${p}`)).toBe(1)
    await repo.db.inventory.put({ id: 'coloring-line-awu-bath', itemId: 'coloring-line-awu-bath', qty: 0 })
    expect(await repo.grantFreeRaster()).toBe(false)
    expect(await qty('coloring-line-awu-bath')).toBe(0)
  })

  it('既有玩家（已經領過向量免費頁）也能再領到點陣免費頁', async () => {
    expect(await repo.grantFreeColoring()).toBe(true)
    expect(await repo.grantFreeRaster()).toBe(true)
  })

  it('已經買過的不會變成 2 份', async () => {
    await repo.db.inventory.put({ id: 'coloring-line-awu-banana', itemId: 'coloring-line-awu-banana', qty: 1 })
    await repo.grantFreeRaster()
    expect(await qty('coloring-line-awu-banana')).toBe(1)
  })

  it('商店：每張備妥的點陣頁都有商品，價格依簡單 / 挑戰分級（30–60 星）', () => {
    for (const d of AVAILABLE_RASTER) {
      const item = SHOP_ITEMS.find((i) => i.id === `coloring-${d.id}`)
      expect(item).toBeDefined()
      expect(item!.price).toBe(RASTER_PRICE[d.tier])
      expect(item!.price).toBeGreaterThanOrEqual(30)
      expect(item!.price).toBeLessThanOrEqual(60)
      expect(item!.asset).toBe(d.id)
    }
  })
})

describe('背景', () => {
  it('parseBg：沒設定 = 純白；場景名、純色、方格 + 底色；壞字串退回純白', () => {
    expect(parseBg(undefined)).toEqual({ type: 'scene', scene: 'white' })
    expect(parseBg('sea')).toEqual({ type: 'scene', scene: 'sea' })
    expect(parseBg('#AABBCC')).toEqual({ type: 'solid', color: '#aabbcc' })
    expect(parseBg('grid:#ffeecc')).toEqual({ type: 'grid', color: '#ffeecc' })
    expect(parseBg('javascript:alert(1)')).toEqual({ type: 'scene', scene: 'white' })
    expect(parseBg('grid:red')).toEqual({ type: 'scene', scene: 'white' })
  })
  it('bgWithColor：填色工具換背景色；方格紙保留格線', () => {
    expect(bgWithColor(undefined, '#e96a6a')).toBe('#e96a6a')
    expect(bgWithColor('meadow', '#e96a6a')).toBe('#e96a6a')
    expect(bgWithColor('grid', '#e96a6a')).toBe('grid:#e96a6a')
    expect(bgWithColor('grid:#ffffff', '#4a9fe0')).toBe('grid:#4a9fe0')
  })
})
