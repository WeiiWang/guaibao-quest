import { useSyncExternalStore } from 'react'

/**
 * 孵化 / 長大的全螢幕慶祝正在顯示嗎？（Celebration 元件掛上去就 +1、卸載就 -1）
 * 首頁的回憶卡提示要等慶祝關掉之後才跳，獎勵才會一個接一個出現、不會同時蓋在一起。
 */
let open = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function markCelebration(delta: 1 | -1): void {
  open = Math.max(0, open + delta)
  emit()
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export const useCelebrationOpen = (): boolean => useSyncExternalStore(subscribe, () => open > 0)
