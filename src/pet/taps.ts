// 連點偵測（SPEC-v3 A4）：點一下 → 嘻嘻；連點 3 次 → 搔癢大笑；連點 6 次 → 轉圈頭暈。純函式。

export type TapReaction = 'giggle' | 'tickle' | 'dizzy'

/** 兩次點擊間隔超過這個就不算連點 */
export const TAP_GAP_MS = 700
/** 3 次連點必須在這個時間內完成（SPEC：1.5 秒內連點 3 次） */
export const TICKLE_WITHIN_MS = 1500
export const TICKLE_TAPS = 3
export const DIZZY_TAPS = 6

export interface TapState {
  /** 目前這串連點的次數 */
  n: number
  /** 這串連點第一下的時間 */
  first: number
  last: number
}

export const initialTapState: TapState = { n: 0, first: 0, last: 0 }

/** 記一次點擊，回傳新的狀態與應該有的反應。頭暈（第 6 下）後重新計數；搔癢不重置，所以繼續點能升級成頭暈。 */
export function registerTap(prev: TapState, now: number): { state: TapState; reaction: TapReaction } {
  const continues = prev.n > 0 && now - prev.last <= TAP_GAP_MS && now >= prev.last
  const n = continues ? prev.n + 1 : 1
  const first = continues ? prev.first : now
  if (n >= DIZZY_TAPS) return { state: initialTapState, reaction: 'dizzy' }
  if (n === TICKLE_TAPS && now - first <= TICKLE_WITHIN_MS) {
    // 搔癢不重置：繼續點到 6 次還能升級成頭暈
    return { state: { n, first, last: now }, reaction: 'tickle' }
  }
  return { state: { n, first, last: now }, reaction: 'giggle' }
}
