/**
 * 離線內容包：一鍵把全部語音、圖、音樂下載到 service worker 用的同一個 Cache，離線時才真的讀得到。
 *
 * 跟 service worker 的約定（vite.config.ts）：
 * - 寫進的 Cache 名稱與網址（含音訊的 ?v=）都來自 build 時產生的 offline-pack.json，跟 runtimeCaching 同一份常數。
 * - 下載時網址多帶 ?gqpack=1，SW 的路由會放行（不攔截），才不會同一個檔案被 SW 和這裡各寫一次，也才拿得到新內容（CacheFirst 只會回舊的）。
 * - 語音走 <audio>，Safari 會發 Range 請求；SW 開了 rangeRequests，從完整的 200 切 206 回去。
 *
 * 續傳：每個檔案寫進 Cache 就算完成；重新開始時掃一次 Cache，只下載還缺的。中斷（關 App、螢幕鎖定、斷線）不會白費。
 * 併發限制 4 個（iPad 記憶體與 Safari 的連線數都有限）；一次讀完一個檔案才寫，單檔最大幾百 KB。
 */
import { appUpdate } from './updateController'

export interface PackFile {
  cache: string
  /** 相對於網站根目錄的路徑（音訊含 ?v=） */
  path: string
  size: number
  /** 內容雜湊：只有檔名不會隨內容改變的檔案（圖、清單）才有；語音與音訊的網址本身就含雜湊 */
  hash?: string
}

interface PackManifest {
  version: number
  groups: { cache: string; files: ([string, number] | [string, number, string])[] }[]
}

export type PackPhase = 'unsupported' | 'checking' | 'unavailable' | 'ready' | 'running' | 'paused' | 'done'
export type PackProblem = 'network' | 'quota' | 'partial' | null

export interface PackState {
  phase: PackPhase
  totalFiles: number
  totalBytes: number
  doneFiles: number
  doneBytes: number
  problem: PackProblem
  /** 這次失敗的檔案數（再按一次會重試） */
  failed: number
  /** navigator.storage.estimate 的結果；不支援時是 null */
  storage: { usage: number; quota: number } | null
}

const HASHES_KEY = 'gq-pack-hashes'
export const PACK_CONCURRENCY = 4
const MAX_TRIES = 3
/** 連續這麼多個檔案失敗就當作斷線了，暫停（不要把 4000 個檔案都試一遍） */
const GIVE_UP_AFTER = 12

/** offline-pack.json → 檔案清單 */
export function flattenManifest(m: PackManifest): PackFile[] {
  return m.groups.flatMap((g) => g.files.map(([path, size, hash]) => ({ cache: g.cache, path, size, hash })))
}

/** 還要下載哪些：Cache 裡沒有的，或雜湊跟上次下載時不一樣的（圖換了新版） */
export function missingFiles(files: PackFile[], cached: (f: PackFile) => boolean, hashes: Record<string, string>): PackFile[] {
  return files.filter((f) => !cached(f) || (f.hash !== undefined && hashes[f.path] !== f.hash))
}

export const packUrl = (path: string, base: string): string => `${base}${path}`
/** 下載用的網址：多帶 gqpack，SW 不攔截 */
export const packFetchUrl = (path: string, base: string): string => `${base}${path}${path.includes('?') ? '&' : '?'}gqpack=1`

/**
 * 併發上限 limit 的工作池。worker 丟錯就停掉整個池（尚未開始的不做），等進行中的結束後把錯誤丟出去。
 * shouldStop 回傳 true 時也會停（暫停用），不算錯誤。
 */
export async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>, shouldStop: () => boolean = () => false): Promise<void> {
  let next = 0
  let failure: { e: unknown } | null = null
  const lane = async () => {
    while (!failure && !shouldStop() && next < items.length) {
      const item = items[next++]
      try {
        await worker(item)
      } catch (e) {
        failure ??= { e }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  if (failure) throw (failure as { e: unknown }).e
}

const isQuota = (e: unknown) => (e as { name?: string } | null)?.name === 'QuotaExceededError'

// ---------- 單例狀態（下載在畫面之外繼續跑：家長離開分頁、5 分鐘閒置回小孩模式都不會中斷） ----------

const initial = (): PackState => ({ phase: 'checking', totalFiles: 0, totalBytes: 0, doneFiles: 0, doneBytes: 0, problem: null, failed: 0, storage: null })
let state: PackState = initial()
const listeners = new Set<() => void>()
let emitTimer: number | undefined

function set(patch: Partial<PackState>, now = true) {
  state = { ...state, ...patch }
  // 進度更新很頻繁，最多每 200ms 通知畫面一次
  if (now) {
    window.clearTimeout(emitTimer)
    emitTimer = undefined
    listeners.forEach((l) => l())
  } else if (emitTimer === undefined) {
    emitTimer = window.setTimeout(() => {
      emitTimer = undefined
      listeners.forEach((l) => l())
    }, 200)
  }
}

export const packState = (): PackState => state
export function subscribePack(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

let stopRequested = false
let running = false
/** 使用者按了下載、還沒完成也沒按暫停：斷線或切到背景又回來時自動接著下載 */
let wantRun = false

const supported = () => typeof window !== 'undefined' && 'caches' in window && 'serviceWorker' in navigator

function readHashes(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(HASHES_KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writeHashes(h: Record<string, string>) {
  try {
    localStorage.setItem(HASHES_KEY, JSON.stringify(h))
  } catch {
    /* 寫不進去：下次會多下載幾張圖，不影響離線 */
  }
}

async function readStorage(): Promise<PackState['storage']> {
  try {
    const e = await navigator.storage?.estimate?.()
    return e && typeof e.quota === 'number' ? { usage: e.usage ?? 0, quota: e.quota } : null
  } catch {
    return null
  }
}

async function loadFiles(base: string): Promise<PackFile[] | null> {
  try {
    const res = await fetch(`${base}offline-pack.json`)
    if (!res.ok) return null
    return flattenManifest((await res.json()) as PackManifest)
  } catch {
    return null
  }
}

/** 掃 Cache：回傳還缺的檔案。keys() 一次拿整個 Cache 的網址，比逐一 match 快很多 */
async function scan(files: PackFile[], base: string): Promise<PackFile[]> {
  const urls = new Map<string, Set<string>>()
  for (const name of new Set(files.map((f) => f.cache))) {
    const c = await caches.open(name)
    urls.set(name, new Set((await c.keys()).map((r) => r.url)))
  }
  const abs = (p: string) => new URL(packUrl(p, base), location.href).href
  return missingFiles(files, (f) => urls.get(f.cache)?.has(abs(f.path)) ?? false, readHashes())
}

/** 重新檢查目前狀態（打開分頁時呼叫）。下載中不動作 */
export async function refreshPack(base = import.meta.env.BASE_URL): Promise<void> {
  if (running) return
  if (!supported()) return set({ phase: 'unsupported' })
  set({ phase: 'checking' })
  const [files, storage] = await Promise.all([loadFiles(base), readStorage()])
  if (!files) return set({ phase: 'unavailable', storage })
  const missing = await scan(files, base)
  const totalBytes = files.reduce((n, f) => n + f.size, 0)
  const missingBytes = missing.reduce((n, f) => n + f.size, 0)
  set({
    // 平常邊玩邊快取也會讓「還缺的」變少，所以要看內容包真的跑過（有雜湊紀錄）才算「繼續下載」
    phase: missing.length === 0 ? 'done' : Object.keys(readHashes()).length > 0 ? 'paused' : 'ready',
    totalFiles: files.length,
    totalBytes,
    doneFiles: files.length - missing.length,
    doneBytes: totalBytes - missingBytes,
    storage,
    failed: 0,
    problem: missing.length === 0 ? null : state.problem,
  })
}

async function downloadOne(f: PackFile, base: string, cache: Cache): Promise<void> {
  let lastError: unknown
  for (let i = 0; i < MAX_TRIES; i++) {
    if (stopRequested) return
    try {
      const res = await fetch(packFetchUrl(f.path, base), { cache: 'no-cache' })
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      if (blob.size !== f.size) throw new Error(`大小不符 ${blob.size}/${f.size}`)
      // 重新包一個乾淨的回應：不留 Vary、ETag 這些會影響 Cache 比對的標頭
      const headers = new Headers({ 'Content-Type': res.headers.get('Content-Type') ?? blob.type, 'Content-Length': String(blob.size) })
      await cache.put(new Request(new URL(packUrl(f.path, base), location.href).href), new Response(blob, { status: 200, headers }))
      return
    } catch (e) {
      if (isQuota(e)) throw e
      lastError = e
      if (i < MAX_TRIES - 1) await new Promise((r) => window.setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastError
}

/** 開始或繼續下載。已經在跑就不動作 */
export async function startPack(base = import.meta.env.BASE_URL): Promise<void> {
  if (running || !supported()) return
  running = true
  wantRun = true
  stopRequested = false
  try {
    // 空間快滿時瀏覽器才會清，這裡再要求一次持久儲存（家長剛按了按鈕，算有使用者操作）
    await navigator.storage?.persist?.().catch(() => false)
    set({ phase: 'running', problem: null, failed: 0 })
    const files = await loadFiles(base)
    if (!files) {
      wantRun = false
      return set({ phase: 'unavailable' })
    }
    const missing = await scan(files, base)
    const totalBytes = files.reduce((n, f) => n + f.size, 0)
    let doneBytes = totalBytes - missing.reduce((n, f) => n + f.size, 0)
    let doneFiles = files.length - missing.length
    set({ totalFiles: files.length, totalBytes, doneFiles, doneBytes })

    const hashes = readHashes()
    let hashDirty = 0
    let failed = 0
    let streak = 0
    const opened = new Map<string, Cache>()
    for (const name of new Set(missing.map((f) => f.cache))) opened.set(name, await caches.open(name))
    const worker = async (f: PackFile) => {
      try {
        await downloadOne(f, base, opened.get(f.cache)!)
      } catch (e) {
        if (isQuota(e)) throw e
        failed += 1
        streak += 1
        if (streak >= GIVE_UP_AFTER) throw new Error('network', { cause: e })
        return
      }
      if (stopRequested) return
      streak = 0
      doneFiles += 1
      doneBytes += f.size
      if (f.hash) {
        hashes[f.path] = f.hash
        if (++hashDirty >= 25) {
          writeHashes(hashes)
          hashDirty = 0
        }
      }
      set({ doneFiles, doneBytes }, false)
    }
    let problem: PackProblem = null
    try {
      await runPool(missing, PACK_CONCURRENCY, worker, () => stopRequested)
    } catch (e) {
      problem = isQuota(e) ? 'quota' : 'network'
    }
    writeHashes(hashes)
    const storage = await readStorage()
    if (problem === 'quota') wantRun = false
    if (!problem && failed > 0) problem = 'partial'
    if (!problem && doneFiles >= files.length) wantRun = false
    set({ phase: doneFiles >= files.length ? 'done' : 'paused', problem, failed, storage, doneFiles, doneBytes })
  } catch {
    set({ phase: 'paused', problem: 'network' })
  } finally {
    running = false
  }
}

/** 暫停：進行中的幾個檔案做完就停。之後按繼續會接著下載 */
export function pausePack(): void {
  wantRun = false
  stopRequested = true
}

export const isPackRunning = (): boolean => running

/** 下載中不套用新版本（重新整理會中斷下載） */
appUpdate.setBusyCheck(isPackRunning)

// 斷線又回來、或從背景回來：使用者沒按暫停的話就自動接著下載
if (typeof window !== 'undefined') {
  const resume = () => {
    if (wantRun && !running && navigator.onLine !== false && document.visibilityState === 'visible') void startPack()
  }
  window.addEventListener('online', resume)
  document.addEventListener('visibilitychange', resume)
}
