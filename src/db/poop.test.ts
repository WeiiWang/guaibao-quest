import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { POOP_CAP, POOP_DELAY_MAX_MS, POOP_DELAY_MIN_MS } from '../pet/poop'

const T0 = new Date(2026, 9, 20, 10, 0, 0).getTime()
let n = 0
let rngValue = 0
let repo: Repo

/** 長大成幼體（會大便）、背包有 99 根香蕉；rng 固定回 rngValue */
async function setup() {
  rngValue = 0
  repo = new Repo(new GuaibaoDB(`poop-${n++}`), () => T0, () => rngValue)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
  await repo.db.pets.update('pet', { stage: 'baby', feedCount: 20 })
  await repo.db.inventory.put({ id: 'banana', itemId: 'banana', qty: 99 })
}
beforeEach(setup)

const pet = async () => (await repo.db.pets.get('pet'))!
/** 餵之前先讓阿悟餓著（飽足 ≥95 時不會吃，見 repo.test.ts 的「吃飽了」） */
const feedHungry = async (id: string, t: number) => {
  await repo.db.pets.update('pet', { hunger: 0, hungerUpdatedAt: t })
  return repo.feedPet(id, t)
}

describe('餵食後排定大便', () => {
  it('機率命中：排一個 20–90 秒後的大便，並記下連續餵食', async () => {
    rngValue = 0 // 0 < 0.3 → 命中；延遲取最小值
    await feedHungry('banana', T0)
    const p = await pet()
    expect(p.poopDue).toHaveLength(1)
    expect(p.poopDue![0] - T0).toBeGreaterThanOrEqual(POOP_DELAY_MIN_MS)
    expect(p.poopDue![0] - T0).toBeLessThanOrEqual(POOP_DELAY_MAX_MS)
    expect(p.feedStreak).toEqual({ n: 1, at: T0 })
    expect(p.poops ?? []).toHaveLength(0)
  })
  it('機率沒命中：不排', async () => {
    rngValue = 0.9
    await feedHungry('banana', T0)
    expect((await pet()).poopDue ?? []).toHaveLength(0)
  })
  it('連續吃第 3 次，機率提高到 60%（0.5 命中、第 1 次不命中）', async () => {
    rngValue = 0.5
    await feedHungry('banana', T0)
    expect((await pet()).poopDue ?? []).toHaveLength(0)
    await feedHungry('banana', T0 + 1000) // 第 2 次 45% → 0.5 仍不中
    expect((await pet()).poopDue ?? []).toHaveLength(0)
    await feedHungry('banana', T0 + 2000) // 第 3 次 60% → 中
    expect((await pet()).poopDue).toHaveLength(1)
  })
  it('蛋不會大便', async () => {
    await repo.db.pets.update('pet', { stage: 'egg', feedCount: 0 })
    await feedHungry('banana', T0)
    expect((await pet()).poopDue ?? []).toHaveLength(0)
  })
  it('家長關掉「寵物會大便」就不排', async () => {
    await repo.setPetPoopOn(false)
    await feedHungry('banana', T0)
    expect((await pet()).poopDue ?? []).toHaveLength(0)
  })
  it('房間（含已排定）達上限就不再排', async () => {
    for (let i = 0; i < 10; i++) await feedHungry('banana', T0 + i)
    const p = await pet()
    expect((p.poops?.length ?? 0) + (p.poopDue?.length ?? 0)).toBeLessThanOrEqual(POOP_CAP)
    expect(p.poopDue).toHaveLength(POOP_CAP)
  })
  it('餵食本身的結果不受影響（feedCount、hunger 照常）', async () => {
    const r = await feedHungry('banana', T0)
    expect(r.ok && r.pet.feedCount).toBe(21)
  })
})

describe('便便存取', () => {
  it('到期的才會長出來，而且存在資料庫（重新整理後還在）', async () => {
    rngValue = 0
    await feedHungry('banana', T0)
    const due = (await pet()).poopDue![0]
    expect(await repo.takeDuePoops(0.3, due - 1)).toEqual([])
    const added = await repo.takeDuePoops(0.3, due + 5)
    expect(added).toHaveLength(1)
    expect(added[0].at).toBe(due)
    // 重新開資料庫（模擬重新整理）還在
    const again = new Repo(new GuaibaoDB(`poop-${n - 1}`), () => T0)
    expect(await again.getPoops()).toHaveLength(1)
    expect((await again.db.pets.get('pet'))!.poopDue).toEqual([])
  })
  it('離線很久：一次補上，但最多 3 坨', async () => {
    await repo.db.pets.update('pet', { poopDue: [T0 + 1, T0 + 2, T0 + 3, T0 + 4] })
    const added = await repo.takeDuePoops(0.3, T0 + 10 * 3_600_000)
    expect(added).toHaveLength(POOP_CAP)
    expect(await repo.getPoops()).toHaveLength(POOP_CAP)
  })
  it('addPoop 有上限；clearPoop 清單顆；clearAllPoops 全清', async () => {
    const a = await repo.addPoop(0.3, T0)
    const b = await repo.addPoop(0.4, T0)
    const c = await repo.addPoop(0.5, T0)
    expect([a, b, c].every(Boolean)).toBe(true)
    expect(await repo.addPoop(0.6, T0)).toBeNull()
    expect(await repo.clearPoop(b!.id)).toBe(true)
    expect(await repo.clearPoop(b!.id)).toBe(false)
    expect((await repo.getPoops()).map((p) => p.id)).toEqual([a!.id, c!.id])
    await repo.clearAllPoops()
    expect(await repo.getPoops()).toEqual([])
  })
  it('x 會被限制在房間內', async () => {
    const p = await repo.addPoop(5, T0)
    expect(p!.x).toBeLessThanOrEqual(0.94)
  })
})

describe('相容舊資料', () => {
  it('舊的 Pet（沒有 poops / poopDue / feedStreak）照常運作，不需要升 Dexie 版本', async () => {
    const name = `legacy-${n++}`
    const old = new Dexie(name)
    old.version(1).stores({
      children: 'id', templates: 'id, order', instances: 'id, templateId, date, status', ledger: 'id, at, kind',
      pets: 'id', shopItems: 'id, kind', inventory: 'id, itemId', coloring: 'pageId', settings: 'id',
    })
    await old.table('pets').put({ id: 'pet', name: '阿悟', stage: 'baby', feedCount: 30, hunger: 50, hungerUpdatedAt: T0, mood: 'normal' })
    await old.table('inventory').put({ id: 'banana', itemId: 'banana', qty: 2 })
    old.close()
    const r = new Repo(new GuaibaoDB(name), () => T0, () => 0)
    expect(await r.getPoops()).toEqual([])
    expect(await r.takeDuePoops(0.3, T0)).toEqual([])
    expect((await r.feedPet('banana', T0)).ok).toBe(true)
    expect((await r.db.pets.get('pet'))!.poopDue).toHaveLength(1)
  })
})
