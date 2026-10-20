/**
 * 全域時間來源。所有領域邏輯都吃注入的 now，
 * 只有 UI/repo 的預設值會呼叫這個 now()。
 * dev 模式下可由 localStorage 的偏移量往後推（見 debug.ts）。
 */
const KEY = 'gq-debug-offset-ms'
let offset = 0

if (import.meta.env.DEV) {
  try {
    offset = Number(localStorage.getItem(KEY)) || 0
  } catch {
    offset = 0
  }
}

export function now(): number {
  return Date.now() + offset
}

/** 僅供 dev 除錯使用；正式 build 的呼叫端會被 tree-shake 掉 */
export function shiftClock(ms: number): void {
  offset += ms
  try {
    localStorage.setItem(KEY, String(offset))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('gq-time'))
}
