import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { balanceOf, earnedOn } from '../domain/points'
import { localDateStr } from '../domain/date'

const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime()
let n = 0
let repo: Repo

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`h7-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})
const give = (id: string, qty = 1) => repo.db.inventory.put({ id, itemId: id, qty })
const setFeed = async (feedCount: number, stage: 'egg' | 'baby' | 'adult' = 'baby') => {
  const pet = (await repo.db.pets.get('pet'))!
  await repo.db.pets.put({ ...pet, feedCount, stage, hunger: 0, hungerUpdatedAt: T0 })
}

describe('歡迎禮物（只送一次）', () => {
  it('onboard 本身不送（舊孩子與測試都不受影響）；grantWelcomeGift 送 20 星 + 1 個香蕉，理由「歡迎禮物」', async () => {
    expect(await repo.balance()).toBe(0)
    expect(await repo.grantWelcomeGift(T0)).toBe(true)
    expect(await repo.balance()).toBe(20)
    const l = (await repo.db.ledger.toArray())[0]
    expect(l).toMatchObject({ delta: 20, reason: '歡迎禮物', kind: 'bonus' })
    expect((await repo.db.inventory.get('banana'))?.qty).toBe(1)
    const gifts = await repo.getPendingGifts()
    expect(gifts).toHaveLength(1)
    expect(gifts[0]).toMatchObject({ foodId: 'banana', from: 'welcome' })
  })
  it('再叫一次不會重複送', async () => {
    await repo.grantWelcomeGift(T0)
    expect(await repo.grantWelcomeGift(T0 + 1000)).toBe(false)
    expect(await repo.balance()).toBe(20)
    expect((await repo.db.inventory.get('banana'))?.qty).toBe(1)
    expect((await repo.db.ledger.toArray()).length).toBe(1)
  })
  it('歡迎禮物不佔每日 100 點上限', async () => {
    await repo.grantWelcomeGift(T0)
    const ledger = await repo.db.ledger.toArray()
    expect(earnedOn(ledger, localDateStr(T0))).toBe(0)
    expect(balanceOf(ledger)).toBe(20)
    expect(await repo.grantBonus(100, 'x', T0)).toMatchObject({ ok: true, granted: 100 })
  })
})

describe('禮物袋：一次全部收下', () => {
  it('佇列清空、回傳全部；東西本來就在背包裡，不會重複加', async () => {
    await repo.grantWelcomeGift(T0)
    await repo.db.settings.update('main', {
      pendingGifts: [
        { foodId: 'banana', at: T0, from: 'welcome' },
        { foodId: 'apple', at: T0, from: 'station' }, // 舊存檔佇列中的站點禮物
        { foodId: 'grape', at: T0, from: 'daily' },
        { stickerId: 'obj-star', at: T0, from: 'collection' },
      ],
    })
    await give('apple', 2)
    const got = await repo.collectAllGifts()
    expect(got.map((g) => g.from)).toEqual(['welcome', 'station', 'daily', 'collection'])
    expect(await repo.getPendingGifts()).toEqual([])
    expect((await repo.db.inventory.get('apple'))?.qty).toBe(2)
    expect(await repo.collectAllGifts()).toEqual([])
  })
})

describe('成長里程碑（幼體到成體每餵 20 次）', () => {
  it('餵到 26 次：送小擺飾 + 一張標「新」的回憶卡；只送一次', async () => {
    await give('banana', 5)
    await setFeed(25)
    const r = await repo.feedPet('banana', T0)
    expect(r.ok).toBe(true)
    expect((await repo.db.inventory.get('decor-ball'))?.qty).toBe(1)
    const s = (await repo.getSettings())!
    expect(s.milestonesGiven).toEqual([26])
    const card = s.album?.find((c) => c.id === 'milestone:26')
    expect(card).toMatchObject({ kind: 'milestone', reward: 'decor-ball', fresh: true })
    expect(card?.caption).toContain('長大一點')
    expect(card?.art).toBe('pet-baby-cheer') // 舊存檔（猴子）維持原檔名
    await repo.feedPet('banana', T0 + 1)
    expect((await repo.db.inventory.get('decor-ball'))?.qty).toBe(1)
    expect((await repo.getSettings())!.album?.filter((c) => c.kind === 'milestone')).toHaveLength(1)
  })
  it('v7.5 虎虎：里程碑回憶卡用虎虎的圖、名字', async () => {
    const pet = (await repo.db.pets.get('pet'))!
    await repo.db.pets.put({ ...pet, species: 'tiger', name: '虎虎' })
    await give('banana', 5)
    await setFeed(25)
    await repo.feedPet('banana', T0)
    const card = (await repo.getSettings())!.album?.find((c) => c.id === 'milestone:26')
    expect(card).toMatchObject({ art: 'pet-tiger-baby-cheer' })
    expect(card?.caption).toContain('虎虎又長大一點了')
  })
  it('餵到 46 次：送壁紙；蛋與成體不送', async () => {
    await give('banana', 5)
    await setFeed(45)
    await repo.feedPet('banana', T0)
    expect((await repo.db.inventory.get('wall-mint'))?.qty).toBe(1)
    await setFeed(10, 'egg')
    await repo.feedPet('banana', T0 + 5)
    expect((await repo.getSettings())!.milestonesGiven).toEqual([46])
  })
})

describe('家具：最多 3 個、可換色', () => {
  const mats = async () => {
    await repo.db.materialLedger.add({ id: 'm1', at: T0, material: 'wood', delta: 99, kind: 'station', reason: 't' })
    await repo.db.materialLedger.add({ id: 'm2', at: T0, material: 'stone', delta: 99, kind: 'station', reason: 't' })
    await repo.db.materialLedger.add({ id: 'm3', at: T0, material: 'flower', delta: 99, kind: 'station', reason: 't' })
  }
  it('同一件家具能再做，做到 3 個就不能再做；壁紙仍是一件', async () => {
    await repo.seedShop()
    await mats()
    for (let i = 0; i < 3; i++) expect((await repo.craftFurniture('decor-ball')).ok).toBe(true)
    expect((await repo.db.inventory.get('decor-ball'))?.qty).toBe(3)
    const r = await repo.craftFurniture('decor-ball')
    expect(r.ok).toBe(false)
    expect(await repo.craftFurniture('wall-mint')).toMatchObject({ ok: true })
    expect(await repo.craftFurniture('wall-mint')).toMatchObject({ ok: false, error: '已經做過了' })
  })
  it('擺第 1、2、3 個用不同的 key；第 4 個擺不下；收回後再擺補第一個空位', async () => {
    await give('decor-ball', 3)
    const k1 = await repo.placeNewDecor('decor-ball', 0.3, 0.8)
    const k2 = await repo.placeNewDecor('decor-ball', 0.5, 0.8)
    const k3 = await repo.placeNewDecor('decor-ball', 0.7, 0.8)
    expect([k1, k2, k3].map((k) => (k.ok ? k.key : ''))).toEqual(['decor-ball', 'decor-ball~2', 'decor-ball~3'])
    expect((await repo.placeNewDecor('decor-ball', 0.2, 0.8)).ok).toBe(false)
    expect(await repo.db.placements.count()).toBe(3)
    await repo.removeDecor('decor-ball~2')
    const again = await repo.placeNewDecor('decor-ball', 0.4, 0.8)
    expect(again).toMatchObject({ ok: true, key: 'decor-ball~2' })
  })
  it('只有 1 個時第 2 個擺不下', async () => {
    await give('decor-lamp', 1)
    expect((await repo.placeNewDecor('decor-lamp', 0.3, 0.8)).ok).toBe(true)
    expect((await repo.placeNewDecor('decor-lamp', 0.5, 0.8)).ok).toBe(false)
    expect((await repo.placeDecor('decor-lamp~2', 0.5, 0.8)).ok).toBe(false)
  })
  it('換色：存在 tint 欄位；0 = 原色；移動後保留；舊資料沒有這欄也正常', async () => {
    await give('decor-ball', 2)
    await repo.placeNewDecor('decor-ball', 0.3, 0.8)
    expect((await repo.db.placements.get('decor-ball'))?.tint).toBeUndefined()
    expect((await repo.tintDecor('decor-ball', 3)).ok).toBe(true)
    expect((await repo.db.placements.get('decor-ball'))?.tint).toBe(3)
    await repo.moveDecor('decor-ball', 0.4, 0.8)
    expect((await repo.db.placements.get('decor-ball'))?.tint).toBe(3)
    expect((await repo.tintDecor('decor-ball', 0)).ok).toBe(true)
    expect((await repo.db.placements.get('decor-ball'))?.tint).toBeUndefined()
    expect((await repo.tintDecor('decor-ball', 9)).ok).toBe(false)
    expect((await repo.tintDecor('decor-ball~2', 1)).ok).toBe(false) // 還沒擺
  })
})

describe('新句子與語音清單一致', () => {
  it('home7.ts 的每一句都在 allLines（會被 export-speech-lines 匯出）', async () => {
    const { allLines } = await import('../learning/lines')
    const { homeLineMap } = await import('../domain/home7')
    const all = allLines([])
    for (const [k, t] of Object.entries(homeLineMap())) expect(all[k], k).toBe(t)
  })
})
