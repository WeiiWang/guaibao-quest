import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { playSound, type SoundName } from '../../../learning/audioEngine'
import './v-shared.css'

// 線 V（點心屋、小菜園）共用的小工具

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 音效：有些音效沒有合成音備援（v8.5 的 boing、splash、munch、squeak 也是），音檔還沒載好時會沒聲音；
 * 這時用 pop 頂一下，孩子的第一次澆水不會是安靜的。
 * 自動化瀏覽器裡把叫過的名字記在 window.__pgSfx（新音效還沒有檔案，e2e 只能驗「有沒有叫到」）。
 */
export function playSfx(name: SoundName) {
  if (typeof navigator !== 'undefined' && navigator.webdriver) {
    const w = window as unknown as { __pgSfx?: string[] }
    ;(w.__pgSfx ??= []).push(name)
  }
  if (!playSound(name)) playSound('pop')
}

/** 排程計時器，元件卸載時全部清掉 */
export function useTimers() {
  const live = useRef(new Set<number>())
  useEffect(() => {
    const ids = live.current
    return () => {
      for (const id of ids) window.clearTimeout(id)
      ids.clear()
    }
  }, [])
  return useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      live.current.delete(id)
      fn()
    }, ms)
    live.current.add(id)
    return id
  }, [])
}

/**
 * 不用字的手勢示範：一個圓圓的指尖從 from 走到 to（兩個一樣就是原地點）。不擋操作。
 * 位置直接量元素，旋轉或改尺寸時重量。減少動態時只停在目的地閃亮。
 */
export function GestureHint({ from, to }: { from: () => Element | null; to: () => Element | null }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      const a = from()?.getBoundingClientRect()
      const b = to()?.getBoundingClientRect()
      if (!el || !a || !b) return
      const ax = a.left + a.width / 2
      const ay = a.top + a.height / 2
      el.style.left = `${ax}px`
      el.style.top = `${ay}px`
      el.style.setProperty('--pg-hint-dx', `${b.left + b.width / 2 - ax}px`)
      el.style.setProperty('--pg-hint-dy', `${b.top + b.height / 2 - ay}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [from, to])
  return <span ref={ref} className="pg-gard-hint" aria-hidden data-testid="gesture-hint" />
}
