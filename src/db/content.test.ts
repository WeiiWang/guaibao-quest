import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { DECOR_COSTS, SHOP_CATALOG, craftableOf } from '../learning/materials'
import { THEME_DEFS } from '../domain/theme'
import { spriteSize } from '../art/items'

const T0 = new Date(2026, 5, 10, 9, 0, 0).getTime()
let n = 0
let repo: Repo

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`content-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

const give = (wood: number, stone: number, flower: number) =>
  repo.db.materialLedger.bulkPut([
    { id: 'g1', at: T0, material: 'wood', delta: wood, kind: 'station', reason: 't' },
    { id: 'g2', at: T0, material: 'stone', delta: stone, kind: 'station', reason: 't' },
    { id: 'g3', at: T0, material: 'flower', delta: flower, kind: 'station', reason: 't' },
  ])

describe('工坊：新家具與目錄', () => {
  it('24 件家具都有材料成本；能做的清單依材料總量由少到多', () => {
    const list = craftableOf('decor')
    expect(list).toHaveLength(24)
    expect(Object.keys(DECOR_COSTS)).toHaveLength(24)
    const totals = list.map((i) => i.cost!.wood + i.cost!.stone + i.cost!.flower)
    expect([...totals].sort((a, b) => a - b)).toEqual(totals)
  })
  it('每件家具都有合理的房內尺寸（高度 0.1–0.55 個房間高）', () => {
    for (const i of SHOP_CATALOG.filter((x) => x.kind === 'decor')) {
      const rows = spriteSize(i.asset).rows / 88
      expect(rows, i.id).toBeGreaterThan(0.1)
      expect(rows, i.id).toBeLessThan(0.55)
    }
  })
  it('新家具可以做、可以擺放（牆面類不能放地板）', async () => {
    await give(30, 30, 30)
    expect((await repo.craftFurniture('decor-rocket', T0)).ok).toBe(true)
    expect((await repo.placeDecor('decor-rocket', 0.5, 0.8, T0)).ok).toBe(true)
    expect((await repo.craftFurniture('decor-rainbow', T0)).ok).toBe(true)
    const r = await repo.placeDecor('decor-rainbow', 0.5, 0.95, T0)
    expect(r.ok).toBe(true)
    expect((await repo.db.placements.get('decor-rainbow'))!.y).toBeLessThan(0.62) // 被限制在牆面
  })
})

describe('壁紙 / 地板：工坊兌換、擁有與套用', () => {
  it('材料不足不能做，也不能套用沒擁有的', async () => {
    const wall = THEME_DEFS.find((t) => t.id === 'wall-stars')!
    await give(0, wall.cost!.stone - 1, wall.cost!.flower)
    const bad = await repo.craftFurniture('wall-stars', T0)
    expect(bad.ok).toBe(false)
    expect((await repo.applyTheme('wall-stars')).ok).toBe(false)
    expect(await repo.getRoomTheme()).toEqual({ wall: 'wall-cream', floor: 'floor-wood' })
  })
  it('兌換 → 擁有 → 套用 → 設定讀得回來；預設可切回', async () => {
    await give(20, 20, 20)
    expect((await repo.craftFurniture('wall-mint', T0)).ok).toBe(true)
    expect((await repo.db.inventory.get('wall-mint'))?.qty).toBe(1)
    const c = THEME_DEFS.find((t) => t.id === 'wall-mint')!.cost!
    expect(await repo.materialBalance()).toEqual({ wood: 20 - c.wood, stone: 20 - c.stone, flower: 20 - c.flower })
    expect((await repo.craftFurniture('wall-mint', T0)).ok).toBe(false) // 只能做一次
    expect((await repo.applyTheme('wall-mint')).ok).toBe(true)
    expect((await repo.getSettings())?.roomTheme).toEqual({ wall: 'wall-mint' })
    expect((await repo.craftFurniture('floor-oak', T0)).ok).toBe(true)
    expect((await repo.applyTheme('floor-oak')).ok).toBe(true)
    expect(await repo.getRoomTheme()).toEqual({ wall: 'wall-mint', floor: 'floor-oak' }) // 壁紙沒被地板覆蓋
    expect((await repo.applyTheme('wall-cream')).ok).toBe(true)
    expect(await repo.getRoomTheme()).toEqual({ wall: 'wall-cream', floor: 'floor-oak' })
  })
  it('壞掉的 settings 值會退回預設', async () => {
    await repo.db.settings.update('main', { roomTheme: { wall: 'nope', floor: 'wall-pink' } })
    expect(await repo.getRoomTheme()).toEqual({ wall: 'wall-cream', floor: 'floor-wood' })
  })
})

describe('著色：作品、畫廊與掛到房間', () => {
  const doc = {
    fills: { body: '#e8a6a0', head: 'rainbow' },
    strokes: [{ id: 's1', color: '#3d3a3a', width: 12, points: [[10, 10], [50, 50]] as [number, number][] }],
    stickers: [{ id: 'k1', art: 'obj-star', x: 200, y: 200, scale: 1.2, rot: 15 }],
  }
  const png = 'data:image/png;base64,AAAA'

  it('儲存作品（填色 + 筆刷 + 貼紙）後可原樣讀回；舊的只存 fills 不會洗掉筆刷', async () => {
    await repo.saveColoringDoc('monkey', doc, T0)
    expect(await repo.getColoringDoc('monkey')).toEqual(doc)
    await repo.saveColoring('monkey', { body: '#111111' }, T0 + 1)
    const back = await repo.getColoringDoc('monkey')
    expect(back.fills).toEqual({ body: '#111111' })
    expect(back.strokes).toHaveLength(1)
    expect(back.stickers).toHaveLength(1)
  })
  it('完成 → 進畫廊（新的在前）；不正確的完成圖與不存在的頁面被拒絕', async () => {
    expect((await repo.completeColoring('nope', doc, png)).ok).toBe(false)
    expect((await repo.completeColoring('monkey', doc, 'hello')).ok).toBe(false)
    const a = await repo.completeColoring('monkey', doc, png, T0)
    const b = await repo.completeColoring('fish', doc, png, T0 + 1000)
    expect(a.ok && b.ok).toBe(true)
    const list = await repo.listGallery()
    expect(list.map((w) => w.basePageId)).toEqual(['fish', 'monkey'])
    expect(list[0]).toMatchObject({ png, createdAt: T0 + 1000, strokes: doc.strokes, stickers: doc.stickers })
    // 進行中的作品不會被當成畫廊作品
    expect((await repo.db.coloring.get('monkey'))?.png).toBeUndefined()
  })
  it('掛到房間：寫入牆面裝飾 placement、背包與商品；重複掛不會多一份', async () => {
    const r = await repo.completeColoring('monkey', doc, png, T0)
    if (!r.ok) throw new Error('x')
    const h = await repo.hangArtwork(r.galleryId, T0)
    expect(h).toMatchObject({ ok: true, itemId: `art-${r.galleryId}`, already: false })
    const itemId = `art-${r.galleryId}`
    expect(await repo.db.placements.get(itemId)).toMatchObject({ itemId, z: 0, flipped: false })
    expect((await repo.db.placements.get(itemId))!.y).toBeLessThan(0.62)
    expect((await repo.db.inventory.get(itemId))?.qty).toBe(1)
    expect(await repo.db.shopItems.get(itemId)).toMatchObject({ kind: 'decor', slot: 'wall', asset: itemId })
    expect(await repo.hangArtwork(r.galleryId, T0 + 5)).toMatchObject({ ok: true, already: true })
    expect(await repo.db.placements.count()).toBe(1)
    // 可以移動、取下再放回（沿用家具的佈置流程）
    expect((await repo.moveDecor(itemId, 0.4, 0.2)).ok).toBe(true)
    expect((await repo.removeDecor(itemId)).ok).toBe(true)
    expect(await repo.db.placements.get(itemId)).toBeUndefined()
    expect((await repo.placeDecor(itemId, 0.3, 0.2, T0)).ok).toBe(true)
  })
  it('刪除畫廊作品會一併收掉房間裡的畫框；不存在的畫掛不上去', async () => {
    expect((await repo.hangArtwork('nope')).ok).toBe(false)
    const r = await repo.completeColoring('monkey', doc, png, T0)
    if (!r.ok) throw new Error('x')
    await repo.hangArtwork(r.galleryId, T0)
    await repo.deleteGalleryWork(r.galleryId)
    expect(await repo.listGallery()).toHaveLength(0)
    expect(await repo.db.placements.count()).toBe(0)
    expect(await repo.db.inventory.get(`art-${r.galleryId}`)).toBeUndefined()
    expect(await repo.db.shopItems.get(`art-${r.galleryId}`)).toBeUndefined()
  })
  it('沒擁有的畫框不能擺放', async () => {
    expect((await repo.placeDecor('art-xyz', 0.3, 0.2)).ok).toBe(false)
  })
})
