/**
 * 開場畫面要不要出現（純函式，方便測試）。
 * - 每次冷啟動出現一次（新安裝也一樣）；App 用 useState 記著，所以重新整理才會再出現。
 * - 自動化瀏覽器（navigator.webdriver）預設跳過，既有 e2e 才不會壞；localStorage 設 gq-title-test=1 才開（比照語音包的 gq-voice-pack-test）。
 * - 網址帶 hash（#hatpreview、#map 這類開發直達頁）不擋。
 */
export interface TitleEnv {
  webdriver: boolean
  testFlag: boolean
  hash: string
}

export function shouldShowTitle(env: TitleEnv): boolean {
  if (env.hash.replace(/^#\/?/, '') !== '') return false
  if (env.webdriver && !env.testFlag) return false
  return true
}

export function readTitleEnv(): TitleEnv {
  let webdriver = false
  let testFlag = false
  let hash = ''
  try {
    webdriver = !!navigator.webdriver
  } catch {
    /* 讀不到就當一般瀏覽器 */
  }
  try {
    testFlag = localStorage.getItem('gq-title-test') === '1'
  } catch {
    /* 讀不到 localStorage 就當沒設 */
  }
  try {
    hash = location.hash
  } catch {
    /* ignore */
  }
  return { webdriver, testFlag, hash }
}

/**
 * 外殼動畫（落蛋等編排）要不要整個跳過：自動化瀏覽器沒開 gq-title-test 時跳過，既有 e2e 才能立刻等到 room。
 */
export function skipShellMotion(): boolean {
  const e = readTitleEnv()
  return e.webdriver && !e.testFlag
}
