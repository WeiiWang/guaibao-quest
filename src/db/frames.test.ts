import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'

const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime()
let n = 0
let repo: Repo
const png = 'data:image/png;base64,AAAA'
let seed = 0
/** 每次內容不同的作品（不然會被當成「同一張沒再畫」） */
const doc = () => ({ fills: {}, strokes: [{ id: `s${seed++}`, color: '#e96a6a', width: 12, points: [[10, 10], [80, 80]] as [number, number][] }], stickers: [], bg: 'night' })
const finish = (counts: boolean, page = 'free-1', d = doc()) => repo.completeColoring(page, d, png, T0 + seed, { counts })

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`frames-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

describe('畫框收藏：累計與解鎖', () => {
  it('沒說算不算（舊呼叫方式）就不累計', async () => {
    const r = await repo.completeColoring('free-1', doc(), png, T0)
    expect(r.ok && r.counted).toBe(false)
    expect(await repo.framesDone()).toBe(0)
  })
  it('第 1、3、6、10、15 幅解鎖木、銀、金、彩虹、星星框；作品自動戴上目前最高級的', async () => {
    const got: string[][] = []
    for (let i = 1; i <= 16; i++) {
      const r = await finish(true)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      got.push(r.newFrames)
      expect(r.framesDone).toBe(Math.min(i, i))
    }
    expect(got[0]).toEqual(['wood'])
    expect(got[1]).toEqual([])
    expect(got[2]).toEqual(['silver'])
    expect(got[5]).toEqual(['gold'])
    expect(got[9]).toEqual(['rainbow'])
    expect(got[14]).toEqual(['star'])
    expect(got[15]).toEqual([])
    expect(await repo.framesDone()).toBe(16)
    const list = await repo.listGallery()
    expect(list[0].frame).toBe('star')
    expect(list.at(-1)?.frame).toBe('wood')
  })
  it('完成度不夠（不算）：不累計、不解鎖、作品維持預設畫框', async () => {
    const r = await finish(false)
    expect(r.ok && r.counted).toBe(false)
    if (!r.ok) return
    expect(r.newFrames).toEqual([])
    expect(r.frame).toBeUndefined()
    expect(await repo.framesDone()).toBe(0)
    expect((await repo.db.coloring.get(`g:${r.galleryId}`))?.frame).toBeUndefined()
  })
  it('同一張畫沒再畫就重複按完成，不會重複累計', async () => {
    const d = doc()
    const a = await finish(true, 'free-1', d)
    const b = await finish(true, 'free-1', d)
    expect(a.ok && a.counted).toBe(true)
    expect(b.ok && b.counted).toBe(false)
    expect(await repo.framesDone()).toBe(1)
    expect(await repo.listGallery()).toHaveLength(2) // 畫廊照舊每次都多一張，行為不變
    const c = await finish(true, 'free-1', doc())
    expect(c.ok && c.counted).toBe(true)
    expect(await repo.framesDone()).toBe(2)
  })
})

describe('畫廊選畫框', () => {
  it('只能選已解鎖的；選了存在作品上；換回預設會移除欄位', async () => {
    const r = await finish(true)
    if (!r.ok) throw new Error('x')
    const id = r.galleryId
    expect((await repo.setArtworkFrame(id, 'silver')).ok).toBe(false) // 3 幅才解鎖
    expect((await repo.setArtworkFrame(id, 'wood')).ok).toBe(true)
    expect((await repo.db.coloring.get(`g:${id}`))?.frame).toBe('wood')
    expect((await repo.setArtworkFrame(id, undefined)).ok).toBe(true)
    const w = await repo.db.coloring.get(`g:${id}`)
    expect(w && 'frame' in w).toBe(false)
    expect((await repo.setArtworkFrame('nope', 'wood')).ok).toBe(false)
    expect((await repo.setArtworkFrame(id, 'plastic' as never)).ok).toBe(false)
  })
  it('舊存檔相容：沒有 frame 欄位的作品與沒有 framesDone 的設定照樣運作，掛畫不受影響', async () => {
    await repo.db.coloring.put({ pageId: 'g:old1', basePageId: 'monkey', fills: {}, png, createdAt: T0, updatedAt: T0 })
    expect(await repo.framesDone()).toBe(0)
    expect((await repo.listGallery())[0].frame).toBeUndefined()
    const h = await repo.hangArtwork('old1', T0)
    expect(h.ok).toBe(true)
    expect((await repo.setArtworkFrame('old1', 'wood')).ok).toBe(false)
  })
  it('刪除作品不影響累計（收藏不倒退）', async () => {
    const r = await finish(true)
    if (!r.ok) return
    await repo.deleteGalleryWork(r.galleryId)
    expect(await repo.framesDone()).toBe(1)
    const r2 = await finish(true)
    expect(r2.ok && r2.framesDone).toBe(2)
  })
})

describe('手機掛畫（D3）：掛在第一屏、必要時縮小，縮放倍率會保留', () => {
  afterEach(() => vi.unstubAllGlobals())
  const seedWorks = async (k: number) => {
    for (let i = 0; i < k; i++) await repo.db.coloring.put({ pageId: `g:w${i}`, basePageId: 'monkey', fills: {}, png, createdAt: T0 + i, updatedAt: T0 + i })
  }
  it('手機 390×844：連掛 3 幅都在第一屏（房間寬 0.1–0.5）、有縮小、不重疊；搬動後縮放倍率還在', async () => {
    vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 })
    await seedWorks(3)
    for (let i = 0; i < 3; i++) expect((await repo.hangArtwork(`w${i}`, T0)).ok).toBe(true)
    const ps = (await repo.db.placements.toArray()).filter((p) => p.itemId.startsWith('art-'))
    expect(ps).toHaveLength(3)
    for (const p of ps) {
      expect(p.scale).toBeLessThan(1)
      expect(p.scale).toBeGreaterThanOrEqual(0.45)
      expect(p.x).toBeGreaterThan(0.1)
      expect(p.x).toBeLessThan(0.5)
    }
    expect(new Set(ps.map((p) => p.y)).size).toBe(3) // 直向排開，互不重疊
    const first = ps[0]
    expect((await repo.moveDecor(first.itemId, 0.3, 0.2)).ok).toBe(true)
    expect((await repo.db.placements.get(first.itemId))?.scale).toBe(first.scale)
  })
  it('平板寬度（820、1180）不縮小，沒有 scale 欄位', async () => {
    for (const w of [820, 1180]) {
      vi.stubGlobal('window', { innerWidth: w, innerHeight: w === 820 ? 1180 : 820 })
      await repo.db.placements.clear()
      await seedWorks(1)
      await repo.hangArtwork('w0', T0)
      const p = await repo.db.placements.get('art-w0')
      expect(p).toBeDefined()
      expect(p && 'scale' in p).toBe(false)
    }
  })
})
