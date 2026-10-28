/**
 * v7.3 F3：繪圖板的完成獎勵與新句子。
 *
 * 規則（不用機率、不加碼、不連續獎勵，避免成癮設計）：
 * - 每張著色頁（含連連看拿去塗的頁）第一次「算數的完成」給固定 5 顆星星，寫進點數流水帳，理由「完成作品」；
 *   算數 = 著色頁完成度 ≥ 60%，或連連看、空白畫紙有內容（和畫框收藏的「完成一幅」同一個判斷，見 frames.countsAsFinished）。
 * - 受每日點數上限約束（和任務、家長加點共用同一條上限）；上限滿了就不給，也不補發，之後同一張再完成時才會再試。
 * - 同一張不重複給：有效的獎勵靠流水帳裡的 refId 判斷。空白畫紙的 3 個欄位會一直重複使用（再畫一張新的），
 *   所以空白畫紙改成「每個欄位每天一次」。
 */
import { localDateStr } from './date'

export const PAINT_STARS = 5
export const PAINT_REWARD_REASON = '完成作品'
/** 同一張只給一次的鍵（存在流水帳的 refId）：空白畫紙加上日期，其他一張一次 */
export const paintRewardKey = (pageId: string, now: number, free: boolean): string => (free ? `art:${pageId}:${localDateStr(now)}` : `art:${pageId}`)

/** 完成度 100%（著色頁才有，空白畫紙與連連看沒有「全部塗滿」） */
export const isFullyPainted = (pct: number, loose: boolean): boolean => !loose && pct >= 100

// ---------- 新句子（會唸出來；src/learning/lines.ts 有同一份，paintReward.test.ts 會檢查兩邊一字不差；阿悟說的話 key 以 pet. 開頭） ----------
export const PAINT_LINES: Record<string, string | string[]> = {
  'pet.paint.more': '還有這些地方喔',
  'pet.paint.full': '全部塗滿了！',
  'pet.paint.stars': '得到五顆星星囉！',
}
export const PAINT_MORE_LINE = PAINT_LINES['pet.paint.more'] as string
export const PAINT_FULL_LINE = PAINT_LINES['pet.paint.full'] as string
export const PAINT_STARS_LINE = PAINT_LINES['pet.paint.stars'] as string
