/**
 * 錯誤紀錄（localStorage，最近 5 筆）與「舊 chunk 找不到」的處理。純邏輯，storage 可注入，方便測試。
 * 紀錄給家長區「設定 → 錯誤紀錄」看；不含孩子的資料（只有錯誤訊息、堆疊、發生在哪一層）。
 */

export const ERROR_LOG_KEY = 'gq-error-log'
export const ERROR_LOG_MAX = 5
/** 同樣訊息的錯誤在這段時間內只記一筆 */
const DEDUPE_MS = 3000
const DUP_FAST_MS = 300
const CHUNK_RELOAD_KEY = 'gq-chunk-reload'
/** 同一個 session 內，這段時間內只自動重新整理一次，避免真的壞掉時無限重整 */
const CHUNK_RELOAD_COOLDOWN_MS = 60_000

export interface ErrorEntry {
  /** 發生時間（毫秒） */
  t: number
  msg: string
  stack?: string
  /** 哪一層接到的：child（兒童端）、parent、app（整個 App）、window（React 之外） */
  where?: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function local(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function session(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function readErrorLog(storage: StorageLike | null = local()): ErrorEntry[] {
  if (!storage) return []
  try {
    const v = JSON.parse(storage.getItem(ERROR_LOG_KEY) ?? '[]') as unknown
    if (!Array.isArray(v)) return []
    return v
      .filter((e): e is ErrorEntry => !!e && typeof e === 'object' && typeof (e as ErrorEntry).t === 'number' && typeof (e as ErrorEntry).msg === 'string')
      .slice(-ERROR_LOG_MAX)
  } catch {
    return []
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

/** 記一筆（最新的在最後，只留最近 5 筆）；寫不進去（無痕模式、容量滿）就算了，絕不再丟錯 */
export function recordError(err: unknown, where?: string, extra?: string, storage: StorageLike | null = local(), now = Date.now()): ErrorEntry {
  const stack = [err instanceof Error ? err.stack?.slice(0, 900) : undefined, extra?.slice(0, 600)].filter(Boolean).join('\n') || undefined
  const entry: ErrorEntry = { t: now, msg: errorMessage(err).slice(0, 300), stack, where }
  if (storage) {
    try {
      let list = readErrorLog(storage)
      const last = list[list.length - 1]
      // 同一個錯誤常常被記好幾次：React 開發模式（StrictMode）會讓邊界接到兩次，還會把錯誤再丟給 window。
      // 0.3 秒內同樣的訊息、或 3 秒內「其中一筆是 window」的同樣訊息，只留一筆，而且邊界那筆（知道是哪一層）優先；
      // 間隔比較久、兩筆都是邊界接到的（真的又壞了一次）不合併
      if (last && last.msg === entry.msg) {
        const dt = Math.abs(entry.t - last.t)
        const involvesWindow = where === 'window' || last.where === 'window'
        if (dt < DUP_FAST_MS || (involvesWindow && dt < DEDUPE_MS)) {
          if (where === 'window') return last
          list = list.slice(0, -1)
        }
      }
      storage.setItem(ERROR_LOG_KEY, JSON.stringify([...list, entry].slice(-ERROR_LOG_MAX)))
    } catch {
      /* 寫不進去就算了 */
    }
  }
  return entry
}

export function clearErrorLog(storage: StorageLike | null = local()): void {
  try {
    storage?.removeItem(ERROR_LOG_KEY)
  } catch {
    /* ignore */
  }
}

/** 新版本部署後，舊頁面要載入的 chunk 檔名已經不存在：各瀏覽器的訊息不同 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : typeof err === 'string' ? err : ''
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|Loading CSS chunk|ChunkLoadError/i.test(msg)
}

/**
 * 動態載入失敗時重新整理一次（拿到新版）。同一個 session 一分鐘內只做一次；回傳是否真的重新整理。
 * reload 可注入（測試用）。
 */
export function reloadOnceForChunkError(reload: () => void = () => location.reload(), storage: StorageLike | null = session(), now = Date.now()): boolean {
  try {
    const last = Number(storage?.getItem(CHUNK_RELOAD_KEY) ?? 0)
    if (last && now - last < CHUNK_RELOAD_COOLDOWN_MS) return false
    storage?.setItem(CHUNK_RELOAD_KEY, String(now))
  } catch {
    /* 讀寫不了 sessionStorage：寧可重整一次 */
  }
  reload()
  return true
}

/** React 之外的錯誤（事件處理器、Promise）也記一筆；chunk 找不到順便重新整理。main.tsx 啟動時呼叫一次 */
export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e) => {
    if (/ResizeObserver loop/i.test(e.message ?? '')) return
    if (isChunkLoadError(e.error ?? e.message)) {
      recordError(e.error ?? e.message, 'window')
      reloadOnceForChunkError()
      return
    }
    // 載入圖片、聲音失敗也會觸發 error（target 不是 window）：那不是程式錯誤，不記
    if (e.target && e.target !== window) return
    recordError(e.error ?? e.message, 'window')
  })
  window.addEventListener('unhandledrejection', (e) => {
    // 播放聲音被瀏覽器擋（還沒碰過畫面）、被新的播放打斷，是正常情況，不算錯誤
    const name = (e.reason as { name?: string } | null)?.name
    if (name === 'NotAllowedError' || name === 'AbortError') return
    recordError(e.reason, 'window')
    if (isChunkLoadError(e.reason)) reloadOnceForChunkError()
  })
  // Vite：動態 import 的預載失敗（新版部署後舊 chunk 不見了）
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault()
    recordError((e as Event & { payload?: unknown }).payload ?? 'vite:preloadError', 'window')
    reloadOnceForChunkError()
  })
}
