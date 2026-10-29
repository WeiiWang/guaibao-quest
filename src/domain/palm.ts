/**
 * 繪圖板的手掌防護（v7.3.1）。
 *
 * 舊版只看接觸面積（寬 > 40px 就當手掌），但 iPhone 的 Safari 引擎（iPhone 上的 Chrome 也是）回報的手指接觸寬度
 * 常常超過 40px，結果每一下都被當成手掌丟掉：點區塊不填色、筆刷畫不出線。
 * 現在：
 * - 門檻提高到 PALM_MIN_PX（手掌通常遠大於此，指尖不會到）。
 * - 自動退場：畫布上沒有其他手指時，連續 PALM_TRUST_AFTER 下單獨的觸控都被判成手掌 → 認定這台裝置回報的面積偏大，
 *   這次使用期間不再用面積判斷，而且這一下照常畫。手指畫線中手掌壓上來（有其他手指在）的保護不受影響。
 */
export const PALM_MIN_PX = 100
export const PALM_TRUST_AFTER = 3

export interface PalmState {
  /** 連續被判成手掌的單獨觸控次數 */
  streak: number
  /** true = 這台裝置的面積不可信，不再用面積判斷 */
  off: boolean
}

export const PALM_INIT: PalmState = { streak: 0, off: false }

export interface PalmInput {
  pointerType: string
  width: number
  height: number
}

/** 判斷這一下是不是手掌（會更新 state）。alone = 畫布上沒有其他手指 */
export function palmCheck(state: PalmState, e: PalmInput, alone: boolean): boolean {
  if (state.off || e.pointerType !== 'touch') return false
  const big = Math.max(e.width, e.height) > PALM_MIN_PX
  if (!big) {
    if (alone) state.streak = 0
    return false
  }
  if (!alone) return true
  state.streak++
  if (state.streak >= PALM_TRUST_AFTER) {
    state.off = true
    return false
  }
  return true
}
