import { useCallback, useEffect, useRef, useState } from 'react'
import './wHelpers.css'

// 線 W（捉迷藏、音樂會）共用的小工具

/** 一包會在元件卸載時自動清掉的計時器 */
export function useTimers() {
  const live = useRef(new Set<number>())
  useEffect(() => {
    const set = live.current
    return () => {
      for (const id of set) window.clearTimeout(id)
      set.clear()
    }
  }, [])
  const after = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      live.current.delete(id)
      fn()
    }, ms)
    live.current.add(id)
    return id
  }, [])
  const cancel = useCallback((id: number | null | undefined) => {
    if (id == null) return
    window.clearTimeout(id)
    live.current.delete(id)
  }, [])
  return { after, cancel }
}

const readReduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** 使用者要不要減少動態（進入時讀一次就夠：玩一回中間不會切換） */
export function useReducedMotion(): boolean {
  const [reduced] = useState(readReduced)
  return reduced
}

/** 第一次的手勢示範：一隻手指點一點（不用識字） */
export function TapHint() {
  return (
    <span className="pg-hide-hand" aria-hidden data-testid="tap-hint">
      <span className="pg-hide-hand-ring" />
      <svg viewBox="0 0 48 64" width="100%" height="100%">
        <path
          d="M19 6a5 5 0 0 1 10 0v21l3-1a5 5 0 0 1 3 .3l4 2c3 1.5 5 4.6 5 8v9c0 8-6.5 15-15 15h-3c-5 0-9-2.5-11.5-6.500L6 40.500a4.6 4.6 0 0 1 7-5.800l6 5.300z"
          fill="#fff8ec"
          stroke="#6a5a4e"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
