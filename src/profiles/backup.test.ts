import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, deleteDb } from '../db/db'
import { BACKUP_FORMAT, BACKUP_VERSION, createBackup, decodeValue, encodeValue, parseBackup, restoreBackup, SCHEMA_VERSION, runPendingDbDeletes, backupFileName, type BackupDeps } from './backup'
import { ProfileManager } from './manager'
import { Registry, RegistryDB } from './registry'

let n = 0
let reg: Registry
let mgr: ProfileManager
let deps: BackupDeps
let names: number

/** 每個測試各自一組名冊與資料庫名稱 */
beforeEach(() => {
  n += 1
  names = 0
  reg = new Registry(new RegistryDB(`b${n}-registry`))
  mgr = new ProfileManager({ registry: reg, legacyDbName: `b${n}-legacy` })
  deps = { registry: reg, openDb: (x) => getDb(x), removeDb: deleteDb, newDbName: () => `b${n}-new${++names}` }
})

async function twoChildren() {
  const r = await mgr.setupFirstChild({ pin: '1234', childName: '小一', ageBand: '4-5' })
  if (!r.ok) throw new Error(r.error)
  const r2 = await mgr.addChild({ name: '小二', ageBand: '6-7', species: 'rabbit' })
  if (!r2.ok) throw new Error(r2.error)
  return { a: r.child, b: r2.child }
}

const snapshot = async (dbName: string) => {
  const d = getDb(dbName)
  const out: Record<string, unknown[]> = {}
  for (const t of d.tables) out[t.name] = await t.toArray()
  return out
}

/** 模擬換一台裝置：全新的名冊 */
function otherDevice() {
  const rdb = new RegistryDB(`b${n}-other-registry`)
  const r = new Registry(rdb)
  return { reg: r, deps: { ...deps, registry: r, newDbName: () => `b${n}-other${++names}` } }
}

describe('備份：內容', () => {
  it('Dexie schema 版本常數跟實際的資料庫一致（升版時這裡會提醒）', async () => {
    const d = getDb(`b${n}-probe`)
    await d.open()
    expect(d.verno).toBe(SCHEMA_VERSION)
  })

  it('包含名冊與每個孩子的所有表，不含暫存的刪除清單', async () => {
    const { a, b } = await twoChildren()
    await reg.db.meta.put({ key: 'pendingDeleteDbs', value: '[]' })
    const file = await createBackup('abc', deps, 1000)
    expect(file).toMatchObject({ format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, schemaVersion: SCHEMA_VERSION, createdAt: 1000, appVersion: 'abc' })
    expect(file.registry.children.map((c) => c.name)).toEqual(['小一', '小二'])
    expect(file.registry.meta.some((m) => m.key === 'pinHash')).toBe(true)
    expect(file.registry.meta.some((m) => m.key === 'pendingDeleteDbs')).toBe(false)
    const tables = getDb(a.dbName).tables.map((t) => t.name).sort()
    expect(Object.keys(file.data[a.id]).sort()).toEqual(tables)
    expect(Object.keys(file.data[b.id]).sort()).toEqual(tables)
    expect(file.data[a.id].settings).toHaveLength(1)
  })

  it('檔名不含孩子的名字', () => {
    expect(backupFileName(new Date(2026, 10, 3))).toBe('guaibao-backup-2026-11-03.json')
  })
})

describe('JSON 放不下的值', () => {
  it('Date、ArrayBuffer、TypedArray、NaN 都編碼得回來；undefined 欄位不留', () => {
    const v = { d: new Date(5000), b: new Uint8Array([1, 2, 3]).buffer, t: new Uint16Array([7, 8]), n: Number.NaN, i: Infinity, u: undefined, s: [1, 'x', null, { a: 1 }] }
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue(v)))) as typeof v
    expect(back.d.getTime()).toBe(5000)
    expect([...new Uint8Array(back.b)]).toEqual([1, 2, 3])
    expect(back.t).toBeInstanceOf(Uint16Array)
    expect([...back.t]).toEqual([7, 8])
    expect(back.n).toBeNaN()
    expect(back.i).toBe(Infinity)
    expect('u' in back).toBe(false)
    expect(back.s).toEqual([1, 'x', null, { a: 1 }])
  })

  it('TypedArray 只編碼自己那一段（不是整個底層 buffer）', () => {
    const whole = new Uint8Array([9, 1, 2, 9])
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue(whole.subarray(1, 3))))) as Uint8Array
    expect([...back]).toEqual([1, 2])
  })

  it('Blob 明確報錯，不會悄悄弄丟', () => {
    expect(() => encodeValue({ x: new Blob(['a']) })).toThrow(/Blob/)
  })
})

describe('驗證：沒過就不動資料', () => {
  const good = async () => JSON.parse(JSON.stringify(await createBackup('v', deps)))

  it('正常的備份通過，摘要有孩子與筆數', async () => {
    await twoChildren()
    const r = parseBackup(JSON.stringify(await good()))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.children.map((c) => c.name)).toEqual(['小一', '小二'])
      expect(r.summary.children[0].rows).toBeGreaterThan(0)
    }
  })

  it.each([
    ['不是 JSON', 'hello'],
    ['截斷的 JSON', '{"format":"guaibao-quest-backup","data":{'],
    ['別的 JSON', '{"a":1}'],
    ['陣列', '[]'],
    ['null', 'null'],
  ])('%s 被擋下來', (_n, text) => {
    const r = parseBackup(text)
    expect(r.ok).toBe(false)
  })

  it('比現在新的版本被擋下來，並說明要先更新', async () => {
    await twoChildren()
    for (const patch of [{ formatVersion: BACKUP_VERSION + 1 }, { schemaVersion: SCHEMA_VERSION + 1 }]) {
      const r = parseBackup(JSON.stringify({ ...(await good()), ...patch }))
      expect(r).toMatchObject({ ok: false })
      if (!r.ok) expect(r.error).toMatch(/較新版本/)
    }
  })

  it('不認識的表 = 新版本的資料，擋下來', async () => {
    const { a } = await twoChildren()
    const f = await good()
    f.data[a.id].futureTable = [{ id: 'x' }]
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false })
  })

  it('內容不完整都擋下來：沒有孩子、少孩子資料、少 PIN、缺主鍵、少設定', async () => {
    const { a } = await twoChildren()
    const bad: ((f: ReturnType<typeof JSON.parse>) => void)[] = [
      (f) => (f.registry.children = []),
      (f) => delete f.data[a.id],
      (f) => (f.registry.meta = f.registry.meta.filter((m: { key: string }) => m.key !== 'pinHash')),
      (f) => (f.data[a.id].settings = [{ noId: true }]),
      (f) => (f.data[a.id].settings = []),
      (f) => (f.data[a.id].ledger = 'x'),
      (f) => (f.registry.children[1] = { ...f.registry.children[0] }),
    ]
    for (const mutate of bad) {
      const f = await good()
      mutate(f)
      expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false })
    }
  })
})

describe('還原', () => {
  it('在另一台裝置（全新名冊）還原：孩子、PIN、所有表都一樣', async () => {
    const { a, b } = await twoChildren()
    await mgr.repoFor(a.dbName).grantBonus(7, '測試加點')
    const beforeA = await snapshot(a.dbName)
    const beforeB = await snapshot(b.dbName)
    const parsed = parseBackup(JSON.stringify(await createBackup('v', deps)))
    if (!parsed.ok) throw new Error(parsed.error)

    const other = otherDevice()
    const r = await restoreBackup(parsed.backup, other.deps)
    expect(r.ok).toBe(true)
    const list = await other.reg.list()
    expect(list.map((c) => [c.id, c.name])).toEqual([
      [a.id, '小一'],
      [b.id, '小二'],
    ])
    expect(await other.reg.pinHash()).toBe(await reg.pinHash())
    expect(await snapshot(list[0].dbName)).toEqual(beforeA)
    expect(await snapshot(list[1].dbName)).toEqual(beforeB)
    // 新裝置還原後，用舊的 PIN 驗證得過
    const mgr2 = new ProfileManager({ registry: other.reg, legacyDbName: `b${n}-other-legacy` })
    expect(await mgr2.verifyPin('1234')).toBe(true)
  })

  it('取代現有資料：舊孩子消失、舊資料庫等到下次啟動才刪', async () => {
    const { a, b } = await twoChildren()
    const parsed = parseBackup(JSON.stringify(await createBackup('v', deps)))
    if (!parsed.ok) throw new Error(parsed.error)
    // 備份之後又新增了一個孩子（還原後應該消失）、並改了第一個孩子的名字
    const r3 = await mgr.addChild({ name: '小三' })
    if (!r3.ok) throw new Error(r3.error)
    await mgr.renameChild(a.id, '改名')

    expect((await restoreBackup(parsed.backup, deps)).ok).toBe(true)
    const list = await reg.list()
    expect(list.map((c) => c.name)).toEqual(['小一', '小二'])
    expect(list.every((c) => ![a.dbName, b.dbName, r3.child.dbName].includes(c.dbName))).toBe(true)
    expect((await getDb(list[0].dbName).settings.get('main'))?.childName).toBe('小一')
    // 舊資料庫還在（畫面可能正開著），下次啟動才刪
    expect(await Dexie.exists(r3.child.dbName)).toBe(true)
    await mgr.bootstrap()
    expect(await Dexie.exists(r3.child.dbName)).toBe(false)
    expect(await Dexie.exists(a.dbName)).toBe(false)
    expect(await Dexie.exists(list[0].dbName)).toBe(true)
    expect(await reg.db.meta.get('pendingDeleteDbs')).toBeUndefined()
  })

  it('寫入失敗：現有資料完全不變，新資料庫清掉', async () => {
    const { a } = await twoChildren()
    const parsed = parseBackup(JSON.stringify(await createBackup('v', deps)))
    if (!parsed.ok) throw new Error(parsed.error)
    const before = await reg.list()
    const beforeData = await snapshot(a.dbName)
    // 第二個孩子寫到一半爆炸
    let calls = 0
    const failing: BackupDeps = {
      ...deps,
      openDb: (x) => {
        calls += 1
        if (calls === 2) throw new Error('disk full')
        return getDb(x)
      },
    }
    const r = await restoreBackup(parsed.backup, failing)
    expect(r).toMatchObject({ ok: false })
    expect(await reg.list()).toEqual(before)
    expect(await snapshot(a.dbName)).toEqual(beforeData)
    expect(await Dexie.exists(`b${n}-new1`)).toBe(false)
    expect(await reg.db.meta.get('pendingDeleteDbs')).toBeUndefined()
  })

  it('舊存檔沒有的表（備份比較舊）也能還原', async () => {
    const { a } = await twoChildren()
    const f = JSON.parse(JSON.stringify(await createBackup('v', deps)))
    delete f.data[a.id].playTime
    const parsed = parseBackup(JSON.stringify(f))
    if (!parsed.ok) throw new Error(parsed.error)
    expect((await restoreBackup(parsed.backup, deps)).ok).toBe(true)
  })

  it('刪除清單不會刪到正在用的資料庫', async () => {
    const { a } = await twoChildren()
    await reg.db.meta.put({ key: 'pendingDeleteDbs', value: JSON.stringify([a.dbName, `b${n}-nothing`]) })
    await runPendingDbDeletes(reg, deleteDb)
    expect(await Dexie.exists(a.dbName)).toBe(true)
    expect(await reg.db.meta.get('pendingDeleteDbs')).toBeUndefined()
  })
})
