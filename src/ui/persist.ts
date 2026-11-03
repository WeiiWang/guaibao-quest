/**
 * 要求持久儲存（navigator.storage.persist）：避免 Safari / 瀏覽器在空間不夠時清掉孩子的進度。
 * 不提示使用者（瀏覽器自己決定要不要核准）；舊瀏覽器沒有這個 API 也沒事，任何錯誤都吞掉。
 * 啟動時呼叫一次，按下開場「開始」（有使用者操作）時再試一次——有些瀏覽器要先互動過才會核准。
 */
export function requestPersistentStorage(): void {
  try {
    const s = typeof navigator === 'undefined' ? undefined : navigator.storage
    if (!s || typeof s.persist !== 'function') return
    const ask = () => s.persist().catch(() => false)
    if (typeof s.persisted === 'function') {
      void s
        .persisted()
        .then((already) => (already ? true : ask()))
        .catch(() => false)
    } else {
      void ask()
    }
  } catch {
    /* 舊瀏覽器、無痕模式：略過 */
  }
}
