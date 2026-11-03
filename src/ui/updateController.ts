/**
 * 更新不打斷：新版本的 service worker 裝好之後只是等著（waiting），不會自己接手，
 * 等到安全時機才套用（skipWaiting + 重新整理）。純邏輯，方便測試；真正接上 SW 的是 main.tsx。
 *
 * 安全時機：
 * - 開場畫面還開著（冷啟動，孩子還沒開始玩）
 * - 孩子回到首頁（關卡、著色的進度已經存好），或從背景回來時正停在首頁
 * 不是安全時機：關卡、著色、家長區、選孩子、離線內容包下載中。
 * 從首頁套用時會記下正在玩的孩子，重新整理後跳過開場畫面、直接回到他的首頁（孩子只看到畫面閃一下）。
 */

const RESUME_KEY = 'gq-update-resume'
const TRIED_KEY = 'gq-update-tried'
/** 套用失敗（SW 沒接手、頁面重整後還是舊版）時，這段時間內不再試，避免一直重整 */
const RETRY_COOLDOWN_MS = 10 * 60_000

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface UpdateResume {
  childId?: string
}

export interface UpdateDeps {
  storage: () => StorageLike | null
  now: () => number
}

const sessionStore = (): StorageLike | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function createUpdateController(deps: UpdateDeps = { storage: sessionStore, now: () => Date.now() }) {
  let ready = false
  let titleOpen = false
  let applied = false
  let apply: (() => void) | null = null
  let busy: () => boolean = () => false
  let resume: UpdateResume | null | undefined
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  const tryApply = (next?: UpdateResume): boolean => {
    if (!ready || applied || !apply || busy()) return false
    const st = deps.storage()
    try {
      const tried = Number(st?.getItem(TRIED_KEY) ?? 0)
      if (tried && deps.now() - tried < RETRY_COOLDOWN_MS) return false
      st?.setItem(TRIED_KEY, String(deps.now()))
      if (next) st?.setItem(RESUME_KEY, JSON.stringify(next))
    } catch {
      /* 讀寫不了 sessionStorage：照樣套用，只是回不到原本的孩子 */
    }
    applied = true
    apply()
    return true
  }

  return {
    /** main.tsx 接上真正的套用動作（skipWaiting + 重新整理） */
    setApply(fn: () => void) {
      apply = fn
    },
    /** 有事情正在進行、不能重新整理（例如離線內容包下載中）時回傳 true */
    setBusyCheck(fn: () => boolean) {
      busy = fn
    },
    /** 新版本裝好、在等待了 */
    markReady() {
      if (ready) return
      ready = true
      emit()
      if (titleOpen) tryApply()
    },
    isReady: () => ready,
    /** 開場畫面開著 = 孩子還沒開始玩，隨時可以套用 */
    setTitleOpen(open: boolean) {
      titleOpen = open
      if (open) tryApply()
    },
    /** 回到首頁（或從背景回來時正在首頁）：安全時機 */
    arrivedHome(childId?: string): boolean {
      return tryApply({ childId })
    },
    /** 這次載入是不是從首頁套用更新回來的（只讀一次就清掉；多次呼叫回傳同樣的值） */
    resumeInfo(): UpdateResume | null {
      if (resume !== undefined) return resume
      resume = null
      const st = deps.storage()
      try {
        const raw = st?.getItem(RESUME_KEY)
        if (raw) {
          st?.removeItem(RESUME_KEY)
          const v = JSON.parse(raw) as unknown
          resume = v && typeof v === 'object' ? (v as UpdateResume) : {}
        }
      } catch {
        /* 讀不到就當一般冷啟動 */
      }
      return resume
    },
    subscribe(cb: () => void) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

export const appUpdate = createUpdateController()
