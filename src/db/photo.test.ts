import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { PHOTO_MAX, isPhotoWork } from '../domain/photo'
import { PAINT_REWARD_REASON } from '../domain/paintReward'

// v8.4 線 AA 照相館：照片進畫廊（coloring 表的 g: 列），但不算「畫完一幅」（畫框收藏、畫畫星星）

const T0 = new Date(2026, 10, 6, 9, 0, 0).getTime()
const jpeg = 'data:image/jpeg;base64,/9j/AAAA'
const png = 'data:image/png;base64,AAAA'
let n = 0
let db: GuaibaoDB
let repo: Repo
let seed = 0
const doc = () => ({ fills: {}, strokes: [{ id: `s${seed++}`, color: '#e96a6a', width: 12, points: [[10, 10], [80, 80]] as [number, number][] }], stickers: [] })

beforeEach(async () => {
  db = new GuaibaoDB(`photo-${n++}`)
  repo = new Repo(db, () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

describe('照相館：存照片', () => {
  it('照片存成畫廊作品（g:photo-<時間戳>），畫廊讀得到、新的在前', async () => {
    const a = await repo.savePhoto(jpeg, T0)
    const b = await repo.savePhoto(jpeg, T0 + 1000)
    expect(a).toMatchObject({ saved: true, count: 1, galleryId: `photo-${T0}` })
    expect(b).toMatchObject({ saved: true, count: 2 })
    const list = await repo.listGallery()
    expect(list.map((w) => w.pageId)).toEqual([`g:photo-${T0 + 1000}`, `g:photo-${T0}`])
    expect(list[0]).toMatchObject({ basePageId: 'photo', png: jpeg, createdAt: T0 + 1000 })
    expect(list.every((w) => isPhotoWork(w.pageId))).toBe(true)
  })
  it('同一毫秒拍兩張不會互相覆蓋', async () => {
    await repo.savePhoto(jpeg, T0)
    const b = await repo.savePhoto(jpeg, T0)
    expect(b.saved).toBe(true)
    expect(await repo.photoCount()).toBe(2)
  })
  it('不是圖片的資料不存', async () => {
    expect((await repo.savePhoto('hello', T0)).saved).toBe(false)
    expect(await repo.photoCount()).toBe(0)
  })
  it(`最多 ${PHOTO_MAX} 張：滿了不存、舊的也不刪`, async () => {
    for (let i = 0; i < PHOTO_MAX; i++) expect((await repo.savePhoto(jpeg, T0 + i)).saved).toBe(true)
    const r = await repo.savePhoto(jpeg, T0 + 999)
    expect(r).toEqual({ saved: false, count: PHOTO_MAX })
    expect(await repo.photoCount()).toBe(PHOTO_MAX)
    expect(await db.coloring.get(`g:photo-${T0}`)).toBeTruthy()
    // 家長在畫廊刪掉一張，就又可以存
    await repo.deleteGalleryWork(`photo-${T0}`)
    expect((await repo.savePhoto(jpeg, T0 + 1000)).saved).toBe(true)
  })
  it('畫畫的作品不佔照片的名額', async () => {
    await repo.completeColoring('free-1', doc(), png, T0, { counts: true })
    expect(await repo.photoCount()).toBe(0)
  })
  it('照片可以掛到房間、從房間拿下、刪除時連房間的畫框一起拿掉', async () => {
    const r = await repo.savePhoto(jpeg, T0)
    const h = await repo.hangArtwork(r.galleryId!)
    expect(h.ok).toBe(true)
    expect(await db.placements.get(`art-${r.galleryId}`)).toBeTruthy()
    await repo.deleteGalleryWork(r.galleryId!)
    expect(await db.placements.get(`art-${r.galleryId}`)).toBeUndefined()
    expect(await db.coloring.get(`g:${r.galleryId}`)).toBeUndefined()
  })
})

describe('照相館：照片不算進畫框解鎖與畫畫獎勵', () => {
  it('拍很多張照片：畫框累計幅數不變、沒有星星', async () => {
    for (let i = 0; i < 5; i++) await repo.savePhoto(jpeg, T0 + i)
    expect(await repo.framesDone()).toBe(0)
    const stars = (await db.ledger.toArray()).filter((l) => l.reason === PAINT_REWARD_REASON)
    expect(stars).toHaveLength(0)
  })
  it('有照片之後畫完第一幅，照樣解鎖第一個畫框、拿到畫畫星星', async () => {
    for (let i = 0; i < 3; i++) await repo.savePhoto(jpeg, T0 + i)
    const r = await repo.completeColoring('free-1', doc(), png, T0 + 10, { counts: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.counted).toBe(true)
    expect(r.framesDone).toBe(1)
    expect(r.newFrames).toEqual(['wood'])
    expect(r.stars).toBeGreaterThan(0)
  })
  it('照片不會被當成「同一張畫沒再畫」（重複完成的判斷只看同一頁的畫）', async () => {
    await repo.savePhoto(jpeg, T0)
    const empty = { fills: {}, strokes: [], stickers: [] }
    const r = await repo.completeColoring('photo', empty, png, T0)
    // 'photo' 不是著色頁：照片的 basePageId 不會撞到任何一張著色頁
    expect(r.ok).toBe(false)
  })
})
