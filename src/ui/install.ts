/** iPad 安裝（加到主畫面）的偵測與「只提示一次」的紀錄。 */

const SEEN_KEY = 'gq-install-hint-seen'

/** 已經從主畫面開啟（不是瀏覽器分頁） */
export function isStandalone(): boolean {
  try {
    const nav = navigator as Navigator & { standalone?: boolean }
    return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

/** iPadOS 13 之後 Safari 預設回報桌面版 UA（Macintosh），要用觸控點數分辨 */
export function isIos(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
}

/** 家長區要不要顯示一次安裝提示：沒安裝、還沒看過。自動化瀏覽器預設不顯示（gq-install-hint-test 才開），既有 e2e 不受影響 */
export function shouldShowInstallHint(): boolean {
  try {
    if (isStandalone()) return false
    if (navigator.webdriver && localStorage.getItem('gq-install-hint-test') !== '1') return false
    return localStorage.getItem(SEEN_KEY) !== '1'
  } catch {
    return false
  }
}

export function markInstallHintSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* 寫不進去頂多再看一次 */
  }
}
