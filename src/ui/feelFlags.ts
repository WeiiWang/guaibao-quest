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

/** v8.1 線 P 有聲繪本（自動演出與地圖上的故事入口）。自動化瀏覽器除非設了 gq-story-test 否則不演，既有 e2e 不受影響 */
export const storyOn = (): boolean => !automated() || flag('gq-story-test')

/** v8.2 線 S 走進地方時的招呼語音。自動化瀏覽器除非設了 gq-place-test 否則不說，既有 e2e 的語音紀錄不受影響 */
export const placeVoiceOn = (): boolean => !automated() || flag('gq-place-test')

/** 測試用：今天沒有「最喜歡的食物」。最喜歡的食物依日期決定，寫死餵香蕉的 e2e 每 10 天會碰上一次。只在自動化瀏覽器有效 */
export const noFavoriteForTest = (): boolean => automated() && flag('gq-no-favorite-test')
