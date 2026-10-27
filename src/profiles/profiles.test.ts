import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { activeDbName, db, deleteDb, getDb, GuaibaoDB, setActiveDb, DEFAULT_DB_NAME } from '../db/db'
import { Repo } from '../db/repo'
import { hashPin } from '../domain/pin'
import { ProfileManager, dbNameForChild } from './manager'
import { Registry, RegistryDB } from './registry'

let n = 0
let reg: Registry
let mgr: ProfileManager
let legacy: string

/** 每個測試各自一組名冊與舊資料庫，互不干擾 */
beforeEach(() => {
  n += 1
  legacy = `t${n}-legacy`
  reg = new Registry(new RegistryDB(`t${n}-registry`))
  mgr = new ProfileManager({ registry: reg, legacyDbName: legacy })
})

/** 做出「升級前的舊玩家」：舊資料庫已經 onboard 過，名冊還不存在 */
async function seedLegacyPlayer(opts: { name?: string; pin?: string; ageBand?: '3' | '4-5' | '6-7' } = {}) {
  const repo = new Repo(getDb(legacy), undefined, undefined, { get: async () => undefined, set: async () => undefined })
  await repo.onboard({ pin: opts.pin ?? '1234', childName: opts.name ?? '小明', petName: '小悟' })
  if (opts.ageBand) await repo.setAgeBand(opts.ageBand)
  return repo
}

describe('registry migration（舊玩家升級）', () => {
  it('舊資料庫變成第一個孩子；名字、年齡、PIN 都帶過來', async () => {
    await seedLegacyPlayer({ name: '小明', pin: '4321', ageBand: '6-7' })
    const list = await mgr.bootstrap()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: '小明', ageBand: '6-7', dbName: legacy, order: 0 })
    expect(await reg.pinHash()).toBe(hashPin('4321'))
    expect(await mgr.verifyPin('4321')).toBe(true)
    expect(await mgr.verifyPin('1234')).toBe(false)
  })

  it('舊資料庫完全不動（資料、settings.pinHash 都還在）', async () => {
    const old = await seedLegacyPlayer({ name: '小明' })
    await old.db.ledger.add({ id: 'x', at: 1, delta: 7, reason: 'r', kind: 'bonus' })
    await mgr.bootstrap()
    const s = await old.getSettings()
    expect(s?.pinHash).toBe(hashPin('1234'))
    expect(s?.childName).toBe('小明')
    expect(await old.db.ledger.count()).toBe(1)
    expect((await old.db.pets.get('pet'))?.name).toBe('小悟')
  })

  it('沒設定過年齡的舊玩家：名冊的年齡是 undefined', async () => {
    await seedLegacyPlayer()
    const [c] = await mgr.bootstrap()
    expect(c.ageBand).toBeUndefined()
  })

  it('重複與並行呼叫只會建立一個孩子', async () => {
    await seedLegacyPlayer()
    await Promise.all([mgr.bootstrap(), mgr.bootstrap(), mgr.bootstrap()])
    await mgr.bootstrap()
    expect(await reg.list()).toHaveLength(1)
  })

  it('全新安裝（舊資料庫沒有玩家）：回傳空陣列，名冊不建立任何孩子', async () => {
    expect(await mgr.bootstrap()).toEqual([])
    expect(await reg.list()).toEqual([])
  })

  it('全新安裝第一個孩子沿用舊資料庫名稱，並設定共用 PIN', async () => {
    await mgr.bootstrap()
    const r = await mgr.setupFirstChild({ pin: '2468', childName: '小花', petName: '' })
    expect(r.ok).toBe(true)
    const list = await reg.list()
    expect(list).toHaveLength(1)
    expect(list[0].dbName).toBe(legacy)
    expect(await mgr.verifyPin('2468')).toBe(true)
    const s = await mgr.repoFor(legacy).getSettings()
    expect(s?.onboarded).toBe(true)
    expect(s?.childName).toBe('小花')
  })
})

describe('新增與刪除孩子', () => {
  beforeEach(async () => {
    await seedLegacyPlayer({ name: '大寶', pin: '1234', ageBand: '6-7' })
    await mgr.bootstrap()
  })

  it('新增孩子：各自的資料庫、名字、年齡、寵物名；不需要再設 PIN', async () => {
    const r = await mgr.addChild({ name: '二寶', ageBand: '3', petName: '小猴' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.child.dbName).toBe(dbNameForChild(r.child.id))
    expect(r.child.dbName).not.toBe(legacy)
    const repo = mgr.repoFor(r.child.dbName)
    const s = await repo.getSettings()
    expect(s).toMatchObject({ onboarded: true, childName: '二寶', ageBand: '3' })
    expect((await repo.db.pets.get('pet'))?.name).toBe('小猴')
    expect((await repo.getLearnerProfile()).gentle).toBe(true)
    // 共用 PIN 不變，新孩子可用同一組 PIN
    expect(await repo.verifyPin('1234')).toBe(true)
    expect(await repo.verifyPin('0000')).toBe(false)
    expect((await reg.list()).map((c) => c.name)).toEqual(['大寶', '二寶'])
  })

  it('新增孩子要有名字；年齡必須是支援的值', async () => {
    expect((await mgr.addChild({ name: '  ' })).ok).toBe(false)
    expect((await mgr.addChild({ name: 'x', ageBand: '9' as never })).ok).toBe(false)
    expect(await reg.list()).toHaveLength(1)
  })

  it('各自資料互不影響：A 的星星、寵物、設定不會出現在 B', async () => {
    const r = await mgr.addChild({ name: '二寶', ageBand: '3' })
    if (!r.ok) throw new Error('addChild failed')
    const a = mgr.repoFor(legacy)
    const b = mgr.repoFor(r.child.dbName)
    await a.db.ledger.add({ id: 'a1', at: 1, delta: 5, reason: 'a', kind: 'bonus' })
    await a.db.inventory.put({ id: 'banana', itemId: 'banana', qty: 3 })
    await a.db.pets.update('pet', { feedCount: 9 })
    expect(await a.db.ledger.count()).toBe(1)
    expect(await b.db.ledger.count()).toBe(0)
    expect((await b.db.inventory.get('banana'))?.qty ?? 0).toBe(0)
    expect((await b.db.pets.get('pet'))?.feedCount).toBe(0)
    expect((await a.getLearnerProfile()).ageBand).toBe('6-7')
    expect((await b.getLearnerProfile()).ageBand).toBe('3')
  })

  it('改名與改年齡：名冊與該孩子的資料庫同步（getLearnerProfile 讀得到）', async () => {
    const [c] = await reg.list()
    expect((await mgr.renameChild(c.id, ' 大寶寶 ')).ok).toBe(true)
    expect((await mgr.setChildAge(c.id, '4-5')).ok).toBe(true)
    expect((await reg.get(c.id))?.name).toBe('大寶寶')
    expect((await reg.get(c.id))?.ageBand).toBe('4-5')
    const repo = mgr.repoFor(c.dbName)
    expect((await repo.getSettings())?.childName).toBe('大寶寶')
    expect((await repo.getLearnerProfile()).ageBand).toBe('4-5')
    expect((await mgr.renameChild(c.id, '   ')).ok).toBe(false)
  })

  it('syncChild：名冊與資料庫不一致時以名冊為準', async () => {
    const [c] = await reg.list()
    await reg.db.children.update(c.id, { ageBand: '3', name: '改過了' })
    await mgr.syncChild(c.id)
    const s = await mgr.repoFor(c.dbName).getSettings()
    expect(s?.ageBand).toBe('3')
    expect(s?.childName).toBe('改過了')
  })

  it('刪除孩子需要 PIN：PIN 錯不會刪', async () => {
    const r = await mgr.addChild({ name: '二寶' })
    if (!r.ok) throw new Error('addChild failed')
    const bad = await mgr.removeChild(r.child.id, '0000')
    expect(bad.ok).toBe(false)
    expect(await reg.list()).toHaveLength(2)
    expect(await Dexie.exists(r.child.dbName)).toBe(true)
  })

  it('刪除孩子：名冊與他的資料庫都刪掉，另一個孩子不受影響', async () => {
    const r = await mgr.addChild({ name: '二寶' })
    if (!r.ok) throw new Error('addChild failed')
    await mgr.repoFor(legacy).db.ledger.add({ id: 'k', at: 1, delta: 2, reason: 'k', kind: 'bonus' })
    const del = await mgr.removeChild(r.child.id, '1234')
    expect(del.ok).toBe(true)
    expect((await reg.list()).map((c) => c.name)).toEqual(['大寶'])
    expect(await Dexie.exists(r.child.dbName)).toBe(false)
    expect(await mgr.repoFor(legacy).db.ledger.count()).toBe(1)
  })

  it('不能刪掉最後一個孩子（即使 PIN 正確）', async () => {
    const [c] = await reg.list()
    const r = await mgr.removeChild(c.id, '1234')
    expect(r.ok).toBe(false)
    expect(await reg.list()).toHaveLength(1)
    expect(await Dexie.exists(legacy)).toBe(true)
  })

  it('刪到只剩一個後，剩下的也不能刪', async () => {
    const r = await mgr.addChild({ name: '二寶' })
    if (!r.ok) throw new Error('addChild failed')
    const [first] = await reg.list()
    expect((await mgr.removeChild(first.id, '1234')).ok).toBe(true)
    expect((await mgr.removeChild(r.child.id, '1234')).ok).toBe(false)
    expect(await reg.list()).toHaveLength(1)
  })

  it('beforeDelete 在 PIN 與最後一個的檢查之後才呼叫', async () => {
    const calls: string[] = []
    const [c] = await reg.list()
    await mgr.removeChild(c.id, '1234', { beforeDelete: async () => void calls.push('last') }) // 最後一個：不呼叫
    await mgr.removeChild(c.id, '0000', { beforeDelete: async () => void calls.push('badpin') }) // PIN 錯：不呼叫
    expect(calls).toEqual([])
    const r = await mgr.addChild({ name: '二寶' })
    if (!r.ok) throw new Error('addChild failed')
    await mgr.removeChild(r.child.id, '1234', { beforeDelete: async () => void calls.push('ok') })
    expect(calls).toEqual(['ok'])
  })

  it('PIN 共用：改 PIN 後，每個孩子都用新 PIN；舊資料庫的 pinHash 同步保留', async () => {
    const r = await mgr.addChild({ name: '二寶' })
    if (!r.ok) throw new Error('addChild failed')
    const b = mgr.repoFor(r.child.dbName)
    expect((await b.changePin('1234', '8888')).ok).toBe(true)
    expect(await mgr.repoFor(legacy).verifyPin('8888')).toBe(true)
    expect(await mgr.repoFor(legacy).verifyPin('1234')).toBe(false)
    expect(await mgr.verifyPin('8888')).toBe(true)
    // 刪除要用新 PIN
    expect((await mgr.removeChild(r.child.id, '1234')).ok).toBe(false)
    expect((await mgr.removeChild(r.child.id, '8888')).ok).toBe(true)
  })

  it('重設只清目前這個孩子；名冊與 PIN 還在，可用簡化 onboarding 重新開始（不問 PIN）', async () => {
    const r = await mgr.addChild({ name: '二寶', ageBand: '3' })
    if (!r.ok) throw new Error('addChild failed')
    const b = mgr.repoFor(r.child.dbName)
    await b.db.ledger.add({ id: 'b1', at: 1, delta: 4, reason: 'b', kind: 'bonus' })
    expect((await b.resetAll('0000')).ok).toBe(false)
    expect((await b.resetAll('1234')).ok).toBe(true)
    expect(await b.db.ledger.count()).toBe(0)
    expect((await b.getSettings())?.onboarded).toBeUndefined()
    // 另一個孩子、名冊、PIN 都沒動
    expect(await mgr.repoFor(legacy).db.pets.count()).toBe(1)
    expect(await reg.list()).toHaveLength(2)
    expect(await mgr.verifyPin('1234')).toBe(true)
    // 簡化 onboarding：不給 PIN，名字、寵物重新設定，年齡沿用名冊
    expect((await mgr.onboardExisting(r.child.id, { childName: '二寶二號', petName: '新猴' })).ok).toBe(true)
    const s = await b.getSettings()
    expect(s).toMatchObject({ onboarded: true, childName: '二寶二號', ageBand: '3' })
    expect((await reg.get(r.child.id))?.name).toBe('二寶二號')
    expect(await b.verifyPin('1234')).toBe(true)
  })
})

describe('db 代理（切換目前孩子）', () => {
  it('db 指向目前的孩子；切換後讀寫各自的資料庫，互不影響', async () => {
    const a = `t${n}-a`
    const b = `t${n}-b`
    const before = activeDbName()
    try {
      setActiveDb(a)
      await db.ledger.add({ id: 'a1', at: 1, delta: 3, reason: 'a', kind: 'bonus' })
      expect(db.name).toBe(a)
      setActiveDb(b)
      expect(db.name).toBe(b)
      expect(await db.ledger.count()).toBe(0)
      await db.transaction('rw', db.ledger, async () => {
        await db.ledger.add({ id: 'b1', at: 1, delta: 9, reason: 'b', kind: 'bonus' })
      })
      setActiveDb(a)
      expect((await db.ledger.toArray()).map((x) => x.id)).toEqual(['a1'])
      expect(getDb(a)).toBe(getDb(a))
      expect(getDb(b).ledger).not.toBe(getDb(a).ledger)
    } finally {
      setActiveDb(before)
      await deleteDb(a)
      await deleteDb(b)
    }
  })

  it('預設就是舊玩家的資料庫名稱 guaibao-quest', () => {
    expect(activeDbName()).toBe(DEFAULT_DB_NAME)
    expect(new GuaibaoDB().name).toBe('guaibao-quest')
  })

  it('預設的 repo 透過代理讀目前的孩子', async () => {
    const { repo } = await import('../db/repo')
    const a = `t${n}-ra`
    const b = `t${n}-rb`
    const before = activeDbName()
    try {
      setActiveDb(a)
      await repo.onboard({ pin: '1234', childName: 'A童', petName: '' })
      setActiveDb(b)
      expect(await repo.getSettings()).toBeUndefined()
      await repo.onboard({ pin: '1234', childName: 'B童', petName: '' })
      expect((await repo.getSettings())?.childName).toBe('B童')
      setActiveDb(a)
      expect((await repo.getSettings())?.childName).toBe('A童')
    } finally {
      setActiveDb(before)
      await deleteDb(a)
      await deleteDb(b)
    }
  })
})
