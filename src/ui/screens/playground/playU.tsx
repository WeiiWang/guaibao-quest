import { useCallback, useEffect, useRef } from 'react'
import { playSound, type PlayOptions, type SoundName } from '../../../learning/audioEngine'
import { useLearnerProfile } from '../../learningHooks'
import type { AgeBand } from '../../../domain/types'

// 線 U 三個玩法共用的小工具：年齡、說話紀錄、玩完的時間點、手勢示範、寵物跳一下、再玩一次

/** 目前的年齡檔；未設定當 4-5（learnerProfileOf 已處理） */
export function useBand(): AgeBand {
  return useLearnerProfile().ageBand
}

export const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** 把寵物說的台詞 key 記在玩法根元素的 data-said（最多留 40 個） */
export function trackSaid(root: HTMLElement | null, key: string): void {
  if (root) root.dataset.said = [...(root.dataset.said ? root.dataset.said.split(' ') : []), key].slice(-40).join(' ')
}

/**
 * 寵物說話，同時把 key 記在玩法根元素的 data-said：
 * 語音還在錄（沒錄的安靜），e2e 也驗得到「該說的有說、不該一直說的沒一直說」。
 */
export function useTrackedSay(say: (key: string) => void) {
  const rootRef = useRef<HTMLDivElement>(null)
  const latest = useRef(say)
  useEffect(() => {
    latest.current = say
  }, [say])
  // 回傳的函式永遠是同一個：語音設定載入時不會讓玩法的循環重新開始
  const track = useCallback((key: string) => {
    trackSaid(rootRef.current, key)
    latest.current(key)
  }, [])
  return { rootRef, say: track }
}

/**
 * v8.5 播音效，同時把名字記在玩法根元素的 data-sfx（跟 data-said 一樣的用意）：
 * 新音效（boing、splash、squeak…）檔案還沒到時不會出聲，e2e 驗的是「該響的地方有叫到」。
 */
export function playTracked(root: HTMLElement | null, name: SoundName, opts?: PlayOptions): void {
  if (root) root.dataset.sfx = [...(root.dataset.sfx ? root.dataset.sfx.split(' ') : []), name].slice(-40).join(' ')
  playSound(name, opts)
}

/** 說完「玩完了」再送禮物，不然禮物的台詞會把它打斷。孩子這時候離開，禮物照送（已經玩完了，不能損失） */
export const FINISH_DELAY_MS = 1500

export function useFinishLater(finish: () => void) {
  const pending = useRef<number | null>(null)
  const latest = useRef(finish)
  useEffect(() => {
    latest.current = finish
  }, [finish])
  useEffect(
    () => () => {
      if (pending.current === null) return
      window.clearTimeout(pending.current)
      pending.current = null
      latest.current()
    },
    [],
  )
  return useCallback(() => {
    if (pending.current !== null) return
    pending.current = window.setTimeout(() => {
      pending.current = null
      latest.current()
    }, FINISH_DELAY_MS)
  }, [])
}

/** 寵物跳一下。掛在包住 Companion 的元素上，不動 Companion 自己的呼吸動作；動作減少時不跳 */
export function petHop(el: HTMLElement | null, height = '-20%'): void {
  if (!el || typeof el.animate !== 'function' || reducedMotion()) return
  el.dataset.hops = String(Number(el.dataset.hops ?? 0) + 1)
  el.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${height}) scale(0.98, 1.04)`, offset: 0.42 }, { transform: 'translateY(0)' }], { duration: 400, easing: 'ease-out' })
}

/** 手勢示範：一隻手，tap 是點點點、drag 是左右拖。不用字、不用 emoji，孩子一碰就消失 */
export function HandHint({ mode, className = '' }: { mode: 'tap' | 'drag'; className?: string }) {
  return (
    <span className={`pg-u-hand pg-u-hand-${mode} ${className}`} data-testid="play-hand" aria-hidden>
      <svg viewBox="0 0 64 80" width="100%" height="100%">
        <path
          d="M26 8c0-3.500 2.700-6 6-6s6 2.500 6 6v26l7 1.500c6 1.300 9 3.600 9 9.500v12c0 11-8 19-19 19h-3c-7 0-11-3-14-8L8 49c-2-3.300-1-6.600 1.600-8.200 2.700-1.600 5.800-.8 7.800 1.700L26 52z"
          fill="#ffe0c2"
          stroke="#b5835a"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

/** 大大的「再玩一次」：3 歲看箭頭、會認字的看字 */
export function AgainButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="pg-u-again" onClick={onClick} data-testid="play-again" aria-label="再玩一次">
      <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden>
        <path d="M38 24a14 14 0 1 1-4.500-10.300" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <path d="M36 4v12H24" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>再玩一次</span>
    </button>
  )
}
