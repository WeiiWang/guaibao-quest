// v8 線 O：「手感」類功能（答對自動前進、結算編排）在自動化測試（navigator.webdriver）裡預設關掉，
// 既有 e2e 才能在答對後從容檢查畫面、點「下一題」。要測這些功能的 e2e 用 localStorage 旗標打開。

/** 自動化瀏覽器（Playwright / WebDriver）？ */
const automated = (): boolean => typeof navigator !== 'undefined' && navigator.webdriver === true

const flag = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/** 答對後自動前進（含點畫面提前）。自動化瀏覽器除非設了 gq-autoadvance-test 否則關閉 */
export const autoAdvanceOn = (): boolean => !automated() || flag('gq-autoadvance-test')

/** 結算編排（數字跳動、依序出現）。自動化瀏覽器除非設了 gq-choreo-test 否則直接顯示最後的樣子 */
export const choreoOn = (): boolean => !automated() || flag('gq-choreo-test')
