import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { emptyDoc } from '../domain/coloring'
import { balanceOf } from '../domain/points'
import { dotsItemId, dotsPoints } from '../art/dots/dots'

const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime()
let n = 0
let repo: Repo
const png = 'data:image/png;base64,AAAA'
const P = 'dots:obj-star:e'

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`dots-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

describe('連連看：進度存檔（coloring 表同名的列，不升 Dexie 版本）', () => {
  it('沒玩過 = 0 點、沒完成', async () => {
    expect(await repo.getDotsProgress(P)).toEqual({ at: 0, done: false })
  })
  it('中途離開再進來：接著連（同一個 pageId）', async () => {
    await repo.saveDotsProgress(P, 4)
    expect(await repo.getDotsProgress(P)).toEqual({ at: 4, done: false })
    await repo.saveDotsProgress(P, 7)
    expect(await repo.getDotsProgress(P)).toEqual({ at: 7, done: false })
    const row = await repo.db.coloring.get(P)
    expect(row?.dotsAt).toBe(7)
    expect(row?.dotsDone).toBeUndefined()
  })
  it('連到最後一點 = 完成；點數超過上限會被夾住；壞的 pageId 不寫入', async () => {
    await repo.saveDotsProgress(P, dotsPoints('obj-star', 'e').length)
    expect(await repo.getDotsProgress(P)).toEqual({ at: 10, done: true })
    await repo.saveDotsProgress('dots:obj-fish:e', 99)
    expect((await repo.getDotsProgress('dots:obj-fish:e')).at).toBe(10)
    await repo.saveDotsProgress('dots:nope:e', 3)
    expect(await repo.db.coloring.get('dots:nope:e')).toBeUndefined()
  })
  it('拿去塗色、完成：畫板的存檔不會蓋掉連線進度', async () => {
    await repo.saveDotsProgress(P, 10)
    await repo.saveColoringDoc(P, { ...emptyDoc(), fills: { shape: '#ff0000' } })
    const row = await repo.db.coloring.get(P)
    expect(row?.fills).toEqual({ shape: '#ff0000' })
    expect(row?.dotsDone).toBe(true)
    expect(row?.dotsAt).toBe(10)
    const r = await repo.completeColoring(P, { ...emptyDoc(), fills: { shape: '#ff0000' } }, png, T0, { counts: true })
    expect(r.ok).toBe(true)
    expect(await repo.getDotsProgress(P)).toEqual({ at: 10, done: true })
  })
  it('再玩一次：進度歸零、塗的顏色清掉，畫廊裡完成過的作品還在', async () => {
    await repo.saveDotsProgress(P, 10)
    await repo.completeColoring(P, { ...emptyDoc(), fills: { shape: '#ff0000' } }, png, T0, { counts: true })
    await repo.resetDots(P)
    expect(await repo.getDotsProgress(P)).toEqual({ at: 0, done: false })
    expect((await repo.getColoringDoc(P)).fills).toEqual({})
    expect((await repo.listGallery()).length).toBe(1)
  })
})

describe('連連看：完成計入畫廊與畫框收藏', () => {
  it('連完直接按完成：存進畫廊、算一幅（累計 +1、解鎖木框）；作品的 basePageId 是連連看頁', async () => {
    const r = await repo.completeColoring(P, emptyDoc(), png, T0, { counts: true })
    expect(r.ok && r.counted).toBe(true)
    if (!r.ok) return
    expect(r.newFrames).toEqual(['wood'])
    expect(await repo.framesDone()).toBe(1)
    const g = await repo.listGallery()
    expect(g[0].basePageId).toBe(P)
  })
  it('同一張沒再畫就重複按完成不會重複累計；可以掛到房間', async () => {
    const a = await repo.completeColoring(P, emptyDoc(), png, T0, { counts: true })
    const b = await repo.completeColoring(P, emptyDoc(), png, T0, { counts: true })
    expect(a.ok && a.counted).toBe(true)
    expect(b.ok && b.counted).toBe(false)
    expect(await repo.framesDone()).toBe(1)
    if (!a.ok) return
    const h = await repo.hangArtwork(a.galleryId)
    expect(h.ok).toBe(true)
  })
  it('不是連連看的 pageId 與不存在的頁面：completeColoring 照舊拒絕', async () => {
    expect((await repo.completeColoring('dots:nope:e', emptyDoc(), png, T0)).ok).toBe(false)
  })
})

describe('連連看：取得（每種難度前 3 張免費，其他 20 星）', () => {
  const lock = 'dots:obj-apple:e'
  it('前 3 張免費、其他要換', async () => {
    expect(await repo.dotsUnlocked('dots:obj-star:e')).toBe(true)
    expect(await repo.dotsUnlocked('dots:food-banana:h')).toBe(true)
    expect(await repo.dotsUnlocked(lock)).toBe(false)
    expect(await repo.dotsUnlocked('dots:nope:e')).toBe(false)
  })
  it('星星不夠：不扣、不開', async () => {
    const r = await repo.unlockDots(lock)
    expect(r.ok).toBe(false)
    expect(await repo.dotsUnlocked(lock)).toBe(false)
  })
  it('夠了：扣 20 點（帳上有一筆購買）、背包有紀錄、重複換不再扣', async () => {
    await repo.db.ledger.add({ id: 'seed', at: T0, delta: 50, reason: '測試', kind: 'bonus' })
    const before = balanceOf(await repo.db.ledger.toArray())
    const r = await repo.unlockDots(lock)
    expect(r.ok && !r.already).toBe(true)
    expect(balanceOf(await repo.db.ledger.toArray())).toBe(before - 20)
    expect((await repo.db.inventory.get(dotsItemId(lock)))?.qty).toBe(1)
    expect(await repo.dotsUnlocked(lock)).toBe(true)
    const again = await repo.unlockDots(lock)
    expect(again.ok && again.already).toBe(true)
    expect(balanceOf(await repo.db.ledger.toArray())).toBe(before - 20)
    // 同一張的其他難度是另一個商品，要另外換
    expect(await repo.dotsUnlocked('dots:obj-apple:m')).toBe(false)
  })
  it('免費的頁面不收費', async () => {
    const r = await repo.unlockDots('dots:obj-star:e')
    expect(r.ok && r.already).toBe(true)
  })
})
