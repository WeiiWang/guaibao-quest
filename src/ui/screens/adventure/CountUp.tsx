import { useEffect, useState } from 'react'

interface Props {
  /** 最後的數字 */
  to: number
  /** 開始前等多久（ms）：跟著獎勵依序出現 */
  delay?: number
  /** 跳到最後數字花多久（ms） */
  ms?: number
  /** false = 不跳動，直接顯示最後的數字（動畫略過、減少動態效果、自動化測試） */
  run?: boolean
}

/** 數字從 0 跳到 to（整數、每跳一格彈一下）。run = false 時直接是最後的數字 */
export function CountUp({ to, delay = 0, ms = 600, run = true }: Props) {
  const [n, setN] = useState(run ? 0 : to)
  useEffect(() => {
    if (!run) {
      setN(to)
      return
    }
    setN(0)
    let raf = 0
    let t0 = 0
    const tick = (ts: number) => {
      if (!t0) t0 = ts
      const p = Math.min(1, (ts - t0) / ms)
      setN(Math.round(to * (1 - (1 - p) * (1 - p))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    const id = window.setTimeout(() => {
      raf = requestAnimationFrame(tick)
    }, delay)
    return () => {
      window.clearTimeout(id)
      cancelAnimationFrame(raf)
    }
  }, [to, delay, ms, run])
  return (
    <span key={n} className={`o8-count ${run && n !== to ? 'ticking' : ''}`} data-n={n}>
      {n}
    </span>
  )
}
