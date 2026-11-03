// 備份與還原：把名冊與每個孩子資料庫的所有表存成一個 JSON 檔，可以在另一台裝置還原。
// 純邏輯（不碰 React / DOM）；資料庫與名冊都可以注入，方便測試。Dexie 版本與結構完全不動。
//
// 還原為什麼安全（中途斷電、寫入失敗都不會弄壞現有資料）：
// 1. 先把備份完整解析、驗證過才開始動資料。
// 2. 每個孩子寫進「全新名字」的資料庫，寫完比對筆數。這一步失敗就刪掉新資料庫，現有資料一個字都沒動。
// 3. 全部寫好之後，用名冊的一次交易切換到新資料庫（同一個交易記下舊資料庫要刪）。
// 4. 舊資料庫在下次啟動時才刪（bootstrap → runPendingDbDeletes），那時候沒有畫面開著它們。
import { DEFAULT_DB_NAME, getDb, GuaibaoDB, deleteDb } from '../db/db'
import { newId, type Result } from '../db/repo'
import { registry as defaultRegistry, type ChildProfile, type Registry } from './registry'

export const BACKUP_FORMAT = 'guaibao-quest-backup'
/** 備份檔格式版本：改了檔案結構才加一 */
export const BACKUP_VERSION = 1
/** 這版程式的 Dexie schema 版本（db.ts 的最高 version；單元測試會核對）。比這個新的備份不能還原 */
export const SCHEMA_VERSION = 3
/** 名冊 meta 裡記「下次啟動要刪的舊資料庫」的 key；不會進備份檔 */
const PENDING_DELETE_KEY = 'pendingDeleteDbs'
/** 超過這個大小的檔案不可能是我們的備份（避免選錯檔把記憶體撐爆） */
export const MAX_BACKUP_BYTES = 300 * 1024 * 1024

type Row = Record<string, unknown>

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  /** 建立時間（毫秒） */
  createdAt: number
  /** 建立這份備份的 App 版本（只顯示用） */
  appVersion: string
  schemaVersion: number
  registry: { children: ChildProfile[]; meta: { key: string; value: string }[] }
  /** 孩子 id → 表名 → 所有列 */
  data: Record<string, Record<string, Row[]>>
}

export interface BackupSummary {
  createdAt: number
  appVersion: string
  children: { id: string; name: string; rows: number }[]
}

export interface BackupDeps {
  registry: Registry
  openDb: (name: string) => GuaibaoDB
  removeDb: (name: string) => Promise<void>
  /** 產生新的資料庫名稱（一定不能跟現有的撞） */
  newDbName: () => string
}

const defaults = (): BackupDeps => ({
  registry: defaultRegistry,
  openDb: (name) => getDb(name),
  removeDb: deleteDb,
  newDbName: () => `${DEFAULT_DB_NAME}-${newId()}`,
})

// ---------- JSON 放不下的值 ----------
// 現在的資料都是純 JSON，但 IndexedDB 可以存更多型別；備份不能悄悄弄丟東西，所以這些都編碼起來，Blob 則明確報錯。

const TAG = '__gq'
type TypedArrayName = 'Uint8Array' | 'Uint8ClampedArray' | 'Int16Array' | 'Uint16Array' | 'Int32Array' | 'Uint32Array' | 'Float32Array' | 'Float64Array'
const TYPED: Record<TypedArrayName, { new (b: ArrayBuffer): ArrayBufferView }> = {
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
}

function toBase64(buf: ArrayBufferLike, offset = 0, length = buf.byteLength): string {
  const bytes = new Uint8Array(buf, offset, length)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out.buffer
}

export function encodeValue(v: unknown): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : { [TAG]: 'num', v: String(v) }
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return undefined
  if (typeof v === 'bigint') throw new Error('備份不支援 bigint')
  if (Array.isArray(v)) return v.map((x) => encodeValue(x) ?? null)
  if (v instanceof Date) return { [TAG]: 'date', v: v.toISOString() }
  if (v instanceof ArrayBuffer) return { [TAG]: 'bin', t: 'ArrayBuffer', v: toBase64(v) }
  if (ArrayBuffer.isView(v)) return { [TAG]: 'bin', t: v.constructor.name, v: toBase64(v.buffer, v.byteOffset, v.byteLength) }
  if (typeof Blob !== 'undefined' && v instanceof Blob) throw new Error('備份不支援 Blob')
  const out: Row = {}
  for (const [k, x] of Object.entries(v as Row)) {
    const e = encodeValue(x)
    if (e !== undefined) out[k] = e
  }
  return out
}

export function decodeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeValue)
  if (v === null || typeof v !== 'object') return v
  const o = v as Row
  if (typeof o[TAG] === 'string') {
    if (o[TAG] === 'num') return Number(o.v)
    if (o[TAG] === 'date') return new Date(String(o.v))
    if (o[TAG] === 'bin') {
      const buf = fromBase64(String(o.v))
      if (o.t === 'ArrayBuffer') return buf
      const C = TYPED[o.t as TypedArrayName]
      if (!C) throw new Error(`不認識的資料型別 ${String(o.t)}`)
      return new C(buf)
    }
    throw new Error(`不認識的資料型別 ${o[TAG]}`)
  }
  const out: Row = {}
  for (const [k, x] of Object.entries(o)) out[k] = decodeValue(x)
  return out
}

// ---------- 備份 ----------

/** 讀出全部孩子與所有表，組成備份內容 */
export async function createBackup(appVersion: string, deps: BackupDeps = defaults(), now = Date.now()): Promise<BackupFile> {
  const children = await deps.registry.list()
  const meta = (await deps.registry.db.meta.toArray()).filter((m) => m.key !== PENDING_DELETE_KEY)
  const data: BackupFile['data'] = {}
  for (const c of children) {
    const d = deps.openDb(c.dbName)
    const tables: Record<string, Row[]> = {}
    for (const t of d.tables) tables[t.name] = (await t.toArray()).map((r) => encodeValue(r) as Row)
    data[c.id] = tables
  }
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, createdAt: now, appVersion, schemaVersion: SCHEMA_VERSION, registry: { children, meta }, data }
}

export const backupFileName = (now = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `guaibao-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`
}

// ---------- 驗證 ----------

export type ParseResult = { ok: true; backup: BackupFile; summary: BackupSummary } | { ok: false; error: string }

const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)

/** 解析並驗證備份檔的文字內容。這裡沒過就不會動到任何資料。錯誤訊息是寫給家長看的 */
export function parseBackup(text: string): ParseResult {
  const notOurs: ParseResult = { ok: false, error: '這不是乖寶任務的備份檔，請確認選對檔案。' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '這個檔案讀不出來，可能不是備份檔，或下載時沒有完整存好。' }
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) return notOurs
  const tooNew: ParseResult = { ok: false, error: '這份備份是較新版本的 App 做的。請先更新 App（重新開啟幾次）再還原。' }
  if (typeof raw.formatVersion !== 'number' || typeof raw.schemaVersion !== 'number') return notOurs
  if (raw.formatVersion > BACKUP_VERSION || raw.schemaVersion > SCHEMA_VERSION) return tooNew
  const broken = (why: string): ParseResult => ({ ok: false, error: `備份檔內容不完整（${why}），無法還原。` })
  const reg = raw.registry
  if (!isObj(reg) || !Array.isArray(reg.children) || !Array.isArray(reg.meta) || !isObj(raw.data)) return broken('名冊')
  if (reg.children.length === 0) return broken('沒有孩子')
  const seen = new Set<string>()
  for (const c of reg.children) {
    if (!isObj(c) || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || typeof c.order !== 'number' || seen.has(c.id)) return broken('孩子名單')
    seen.add(c.id)
  }
  for (const m of reg.meta) if (!isObj(m) || typeof m.key !== 'string' || typeof m.value !== 'string') return broken('名冊設定')
  if (!reg.meta.some((m) => (m as Row).key === 'pinHash')) return broken('家長 PIN')

  // 用一個沒打開的資料庫物件拿 schema（表名與主鍵），不會建立資料庫
  const schema = new Map(new GuaibaoDB('__gq_schema_probe__').tables.map((t) => [t.name, t.schema.primKey.keyPath as string]))
  const data: BackupFile['data'] = {}
  const summary: BackupSummary['children'] = []
  try {
    for (const c of reg.children as ChildProfile[]) {
      const tables = raw.data[c.id]
      if (!isObj(tables)) return broken(`${c.name} 的資料`)
      const out: Record<string, Row[]> = {}
      let rows = 0
      for (const [name, list] of Object.entries(tables)) {
        const key = schema.get(name)
        if (key === undefined) return tooNew // 不認識的表 = 新版本才有的東西，硬還原會弄丟
        if (!Array.isArray(list)) return broken(name)
        for (const r of list) if (!isObj(r) || r[key] === undefined || r[key] === null) return broken(name)
        out[name] = list.map((r) => decodeValue(r) as Row)
        rows += list.length
      }
      if (!out.settings?.length) return broken(`${c.name} 的設定`)
      data[c.id] = out
      summary.push({ id: c.id, name: c.name, rows })
    }
  } catch {
    return broken('資料格式')
  }
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    formatVersion: raw.formatVersion,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '',
    schemaVersion: raw.schemaVersion,
    registry: { children: reg.children as ChildProfile[], meta: reg.meta as BackupFile['registry']['meta'] },
    data,
  }
  return { ok: true, backup, summary: { createdAt: backup.createdAt, appVersion: backup.appVersion, children: summary } }
}

// ---------- 還原 ----------

/**
 * 用備份取代這台裝置上的全部孩子（含家長 PIN）。回傳 ok 之後要重新載入頁面。
 * 失敗時現有資料完全不變。backup 必須是 parseBackup 驗證過的。
 */
export async function restoreBackup(backup: BackupFile, deps: BackupDeps = defaults()): Promise<Result> {
  const fresh: string[] = []
  const children: ChildProfile[] = []
  const cleanup = async () => {
    for (const name of fresh) await deps.removeDb(name).catch(() => undefined)
  }
  try {
    for (const c of backup.registry.children) {
      const dbName = deps.newDbName()
      fresh.push(dbName)
      const d = deps.openDb(dbName)
      const tables = backup.data[c.id] ?? {}
      await d.transaction('rw', d.tables, async () => {
        for (const t of d.tables) {
          const rows = tables[t.name]
          if (rows?.length) await t.bulkPut(rows)
        }
      })
      // 寫完核對筆數：對不上就當失敗，不切換
      for (const t of d.tables) {
        const want = tables[t.name]?.length ?? 0
        if ((await t.count()) !== want) throw new Error(`${t.name} 筆數不符`)
      }
      children.push({ ...c, dbName })
    }
    const rdb = deps.registry.db
    await rdb.transaction('rw', [rdb.children, rdb.meta], async () => {
      const oldNames = (await rdb.children.toArray()).map((c) => c.dbName)
      const pending = parsePending((await rdb.meta.get(PENDING_DELETE_KEY))?.value)
      await rdb.children.clear()
      await rdb.children.bulkPut(children)
      await rdb.meta.clear()
      await rdb.meta.bulkPut(backup.registry.meta.filter((m) => m.key !== PENDING_DELETE_KEY))
      await rdb.meta.put({ key: PENDING_DELETE_KEY, value: JSON.stringify([...new Set([...pending, ...oldNames])]) })
    })
  } catch (e) {
    await cleanup()
    const quota = (e as { name?: string } | null)?.name === 'QuotaExceededError' || (e as { inner?: { name?: string } } | null)?.inner?.name === 'QuotaExceededError'
    return { ok: false, error: quota ? '裝置空間不夠，還原沒有完成。原本的資料沒有變動。' : '還原沒有完成，原本的資料沒有變動。請再試一次。' }
  }
  return { ok: true }
}

function parsePending(v: string | undefined): string[] {
  if (!v) return []
  try {
    const a = JSON.parse(v) as unknown
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 啟動時呼叫：刪掉上次還原換下來的舊資料庫（這時候還沒有畫面打開它們）。失敗就留著下次再試，不影響使用 */
export async function runPendingDbDeletes(reg: Registry, removeDb: (name: string) => Promise<void>): Promise<void> {
  const rdb = reg.db
  const row = await rdb.meta.get(PENDING_DELETE_KEY)
  if (!row) return
  const inUse = new Set((await rdb.children.toArray()).map((c) => c.dbName))
  const left: string[] = []
  for (const name of parsePending(row.value)) {
    if (inUse.has(name)) continue
    try {
      await removeDb(name)
    } catch {
      left.push(name)
    }
  }
  if (left.length) await rdb.meta.put({ key: PENDING_DELETE_KEY, value: JSON.stringify(left) })
  else await rdb.meta.delete(PENDING_DELETE_KEY)
}
