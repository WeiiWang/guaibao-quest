import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { balanceOf } from '../domain/points'
import { ADULT_AT_FEED_COUNT, BABY_AT_FEED_COUNT } from '../domain/constants'
import { HAT_IDS } from '../domain/hats'
import { makeRng } from '../learning/rng'

const T0 = new Date(2026, 9, 27, 9, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000
let n = 0
let repo: Repo

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`wardrobe-${n++}`), () => T0, makeRng(7))
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
  await repo.seedShop()
})

const stars = (amount: number, at = T0) => repo.db.ledger.add({ id: `s${Math.random()}`, at, delta: amount, reason: 'test', kind: 'bonus' })
const setStage = async (stage: 'egg' | 'baby' | 'adult') =>
  repo.db.pets.update('pet', { stage, feedCount: stage === 'egg' ? 0 : stage === 'baby' ? BABY_AT_FEED_COUNT : ADULT_AT_FEED_COUNT })
const album = async () => (await repo.getAlbum()) ?? []
const ids = async () => (await album()).map((c) => c.id).sort()

describe('帽子：購買', () => {
  it('商店有 6 頂帽子，kind = hat', async () => {
    const hats = await repo.db.shopItems.where('kind').equals('hat').toArray()
    expect(hats.map((h) => h.id).sort()).toEqual([...HAT_IDS].sort())
  })
  it('星星夠就能買：扣星星、背包多 1 頂；已擁有不能再買；不夠有提示', async () => {
    await stars(300)
    const r = await repo.buyItem('hat-crown', T0)
    expect(r.ok).toBe(true)
    expect(balanceOf(await repo.db.ledger.toArray())).toBe(50)
    expect((await repo.db.inventory.get('hat-crown'))?.qty).toBe(1)
    expect(await repo.buyItem('hat-crown', T0)).toMatchObject({ ok: false, error: '已經擁有了' })
    expect(await repo.buyItem('hat-chef', T0)).toMatchObject({ ok: false, error: '還差 100 點' })
  })
  it('5 秒內可以退回：還星星、扣庫存', async () => {
    await stars(100)
    const r = await repo.buyItem('hat-party', T0)
    if (!r.ok) throw new Error('buy')
    const u = await repo.undoPurchase(r.ledgerId, T0 + 1000)
    expect(u).toMatchObject({ ok: true, refunded: 80 })
    expect(balanceOf(await repo.db.ledger.toArray())).toBe(100)
    expect((await repo.db.inventory.get('hat-party'))?.qty).toBe(0)
  })
})

describe('帽子：穿戴', () => {
  it('沒買過不能戴；買了之後戴上、拿下；pet.hat 記著', async () => {
    await setStage('adult')
    expect(await repo.setHat('hat-crown')).toMatchObject({ ok: false, reason: 'notOwned' })
    await stars(100)
    await repo.buyItem('hat-party', T0)
    expect(await repo.setHat('hat-party')).toEqual({ ok: true, hat: 'hat-party' })
    expect((await repo.db.pets.get('pet'))?.hat).toBe('hat-party')
    expect(await repo.setHat(null)).toEqual({ ok: true, hat: null })
    expect((await repo.db.pets.get('pet'))?.hat).toBeUndefined()
  })
  it('換一頂：只會戴一頂', async () => {
    await setStage('adult')
    await repo.db.inventory.bulkPut([{ id: 'hat-cap', itemId: 'hat-cap', qty: 1 }, { id: 'hat-straw', itemId: 'hat-straw', qty: 1 }])
    await repo.setHat('hat-cap')
    await repo.setHat('hat-straw')
    expect((await repo.db.pets.get('pet'))?.hat).toBe('hat-straw')
  })
  it('蛋不能戴；不是帽子的東西不能戴', async () => {
    await repo.db.inventory.put({ id: 'hat-cap', itemId: 'hat-cap', qty: 1 })
    expect(await repo.setHat('hat-cap')).toMatchObject({ ok: false, reason: 'egg' })
    await setStage('baby')
    expect(await repo.setHat('banana')).toMatchObject({ ok: false, reason: 'unknown' })
    expect(await repo.setHat('hat-cap')).toMatchObject({ ok: true })
  })
  it('餵食時 pet.hat 不會被洗掉；ownedHats 依目錄順序', async () => {
    await setStage('baby')
    await repo.db.inventory.bulkPut([{ id: 'hat-crown', itemId: 'hat-crown', qty: 1 }, { id: 'hat-party', itemId: 'hat-party', qty: 1 }, { id: 'banana', itemId: 'banana', qty: 3 }])
    await repo.setHat('hat-crown')
    await repo.feedPet('banana', T0)
    expect((await repo.db.pets.get('pet'))?.hat).toBe('hat-crown')
    expect(await repo.ownedHats()).toEqual(['hat-party', 'hat-crown'])
  })
  it('退回剛買的帽子：正戴著就拿下', async () => {
    await setStage('adult')
    await stars(100)
    const r = await repo.buyItem('hat-party', T0)
    if (!r.ok) throw new Error('buy')
    await repo.setHat('hat-party')
    await repo.undoPurchase(r.ledgerId, T0 + 500)
    expect((await repo.db.pets.get('pet'))?.hat).toBeUndefined()
  })
})

describe('成長相簿：事件', () => {
  it('孵化的當下新增一張卡（標新、時間 = 現在、幼猴的圖）', async () => {
    await repo.db.pets.update('pet', { feedCount: BABY_AT_FEED_COUNT - 1 })
    await repo.db.inventory.put({ id: 'banana', itemId: 'banana', qty: 2 })
    const r = await repo.feedPet('banana', T0)
    expect(r.ok && r.evolvedTo).toBe('baby')
    const cards = await album()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ id: 'hatch', kind: 'hatch', caption: '阿悟孵出來了！', at: T0, fresh: true, art: 'pet-baby-cheer' })
  })
  it('長大的當下再新增一張；沒有進化就不新增', async () => {
    await repo.db.pets.update('pet', { stage: 'baby', feedCount: ADULT_AT_FEED_COUNT - 1 })
    await repo.db.inventory.put({ id: 'banana', itemId: 'banana', qty: 3 })
    await repo.db.settings.update('main', { album: [{ id: 'hatch', at: 1, kind: 'hatch', art: 'pet-baby-cheer', caption: 'x' }] })
    await repo.feedPet('banana', T0)
    expect(await ids()).toEqual(['grow', 'hatch'])
    await repo.feedPet('banana', T0 + 60_000)
    expect(await ids()).toEqual(['grow', 'hatch'])
  })
})

describe('成長相簿：補建與同步', () => {
  it('舊玩家（已經是成猴、有新招、通關過花果山、有帽子）第一次載入：一次補齊，都不標新', async () => {
    await setStage('adult')
    await repo.db.pets.update('pet', { tricks: ['count', 'flip'] })
    await repo.db.progress.put({
      chapterId: 'huaguoshan',
      run: 1,
      stations: [1, 2, 3, 4, 5].map((i) => ({ done: true, independent: 4, total: 5, completedAt: T0 - (6 - i) * DAY })),
      chestClaimed: false,
      completedRuns: 1,
      updatedAt: T0,
    })
    await stars(100)
    await repo.buyItem('hat-party', T0 - DAY)
    const added = await repo.syncAlbum(T0)
    expect(added.map((c) => c.id).sort()).toEqual(['chapter:huaguoshan', 'grow', 'hat:first', 'hatch', 'trick:count', 'trick:flip'])
    expect(added.every((c) => !c.fresh)).toBe(true)
    const byId = Object.fromEntries((await album()).map((c) => [c.id, c]))
    expect(byId.hatch.approx).toBe(true)
    expect(byId['chapter:huaguoshan']).toMatchObject({ at: T0 - DAY, caption: '我們一起通關了花果山！' })
    expect(byId['chapter:huaguoshan'].approx).toBeUndefined()
    expect(byId['hat:first']).toMatchObject({ hat: 'hat-party', caption: '阿悟有第一頂帽子了：派對帽！' })
    expect((await repo.getSettings())?.albumInit).toBe(true)
  })
  it('重複同步不會重複新增', async () => {
    await setStage('adult')
    await repo.syncAlbum(T0)
    const again = await repo.syncAlbum(T0 + DAY)
    expect(again).toEqual([])
    expect(await album()).toHaveLength(2)
  })
  it('補建之後新發生的：新招、通關、第一頂帽子標新；孵化、長大安靜補上', async () => {
    await repo.syncAlbum(T0) // 蛋：什麼都沒有，但 albumInit 設好了
    expect(await album()).toEqual([])
    await setStage('adult')
    await repo.db.pets.update('pet', { tricks: ['rhythm'] })
    await stars(100)
    await repo.buyItem('hat-cap', T0)
    const added = await repo.syncAlbum(T0 + DAY)
    const byId = Object.fromEntries(added.map((c) => [c.id, c]))
    expect(byId['trick:rhythm']).toMatchObject({ fresh: true, at: T0 + DAY })
    expect(byId['hat:first']).toMatchObject({ fresh: true, at: T0 })
    expect(byId.hatch.fresh).toBeUndefined()
    expect(byId.grow.fresh).toBeUndefined()
  })
  it('每日冒險的進度列不是章節、沒通關的章節不算', async () => {
    await repo.syncAlbum(T0)
    await repo.db.progress.put({ chapterId: 'daily:math', run: 1, stations: [], chestClaimed: false, completedRuns: 3, updatedAt: T0 })
    await repo.db.progress.put({ chapterId: 'huaguoshan', run: 1, stations: [{ done: true, independent: 4, total: 5, completedAt: T0 }, { done: false, independent: 0, total: 0 }], chestClaimed: false, completedRuns: 0, updatedAt: T0 })
    expect(await repo.syncAlbum(T0)).toEqual([])
  })
  it('買了第一頂帽子才有那張卡；第二頂不再新增；退回唯一一頂就收回那張卡', async () => {
    await repo.syncAlbum(T0)
    await stars(300)
    const r1 = await repo.buyItem('hat-party', T0)
    if (!r1.ok) throw new Error('buy')
    expect((await repo.syncAlbum(T0)).map((c) => c.id)).toEqual(['hat:first'])
    await repo.buyItem('hat-cap', T0 + 1000)
    expect(await repo.syncAlbum(T0 + 2000)).toEqual([])
    // 退回第二頂不影響
    expect((await album()).filter((c) => c.kind === 'hat')).toHaveLength(1)
    // 只剩一頂時退回它
    await repo.db.inventory.put({ id: 'hat-cap', itemId: 'hat-cap', qty: 0 })
    await repo.undoPurchase(r1.ledgerId, T0 + 3000)
    expect((await album()).some((c) => c.id === 'hat:first')).toBe(false)
  })
  it('看過新卡：拿掉 fresh 旗標，其他欄位不變', async () => {
    await repo.db.pets.update('pet', { feedCount: BABY_AT_FEED_COUNT - 1 })
    await repo.db.inventory.put({ id: 'banana', itemId: 'banana', qty: 1 })
    await repo.feedPet('banana', T0)
    await repo.seeAlbumCard('hatch')
    const c = (await album())[0]
    expect(c.fresh).toBeUndefined()
    expect(c).toMatchObject({ id: 'hatch', caption: '阿悟孵出來了！' })
  })
  it('PM 補建相簿：清掉重來、不標新', async () => {
    await setStage('adult')
    await repo.syncAlbum(T0)
    await repo.db.settings.update('main', { album: [] })
    const added = await repo.rebuildAlbum(T0)
    expect(added).toBe(2)
    expect((await album()).every((c) => !c.fresh)).toBe(true)
  })
})
