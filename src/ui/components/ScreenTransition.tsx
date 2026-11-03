import { useEffect, useState, type CSSProperties } from 'react'
import '../shell.css'
import './transition.css'

/**
 * 兒童端換畫面的雲朵轉場（約 0.5 秒）。
 *
 * 重點：**邏輯完全不延遲**。呼叫端照舊立刻切換畫面狀態；這個元件只是在新畫面上面疊一層雲播放
 * （pointer-events: none，不擋點擊），播完自己從 DOM 拿掉。
 * 第一幀就要蓋住畫面（不能先閃到新畫面再蓋）：偵測到 screenKey 變了，是在 render 當下用「state 衍生」的寫法
 * 直接更新 state，讓遮罩跟新畫面在同一次 commit 出現，而不是等 useEffect（那會晚一幀）。
 * 動畫只動 transform / opacity，沒有 blur。
 *
 * screenKey：
 * - 字串：畫面的識別；跟上次不同就播一次。
 * - null：不播（家長區、開發預覽頁），而且不更新「上次」——從家長區回到原本的畫面時，key 沒變，也不會播。
 * prefers-reduced-motion 時不播。
 */

/** 5 列：偶數列 4 朵、奇數列 5 朵（錯開半格，邊緣也蓋得到）；vx/vy = 離中心的方向（散開時往外飄），越外圍越晚動 */
const CLOUDS = [0, 1, 2, 3, 4].flatMap((row) =>
  (row % 2 === 0 ? [12.5, 37.5, 62.5, 87.5] : [0, 25, 50, 75, 100]).map((x0, col) => {
    // 固定的「亂數」（不用 Math.random：每次轉場長一樣，也不會干擾 e2e 固定 Math.random 的測試）
    const n = row * 7 + col * 3
    const jx = ((n * 37) % 11) - 5
    const jy = ((n * 53) % 7) - 3
    const x = x0 + jx
    const y = 8 + row * 21 + jy
    const vx = x - 50
    const vy = y - 50
    const dist = Math.hypot(vx / 50, vy / 50)
    return { x, y, vx, vy, k: 0.9 + ((n * 29) % 9) / 24, delay: Math.round(dist * 60), flip: n % 3 === 0 }
  }),
)

/** 轉場整體長度（毫秒）：雲 460ms + 最大延遲 ≈ 540ms；超過這個時間還沒收到 animationend 就強制拿掉 */
export const TRANSITION_MS = 540
const FALLBACK_MS = 900

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** 兒童端畫面 → 轉場識別。家長區與開發預覽頁回 null（不播）；關卡換下一站要播，所以站號也算 */
export function screenTransitionKey(s: { name: string; chapterId?: string; station?: number; ceremony?: boolean }): string | null {
  switch (s.name) {
    case 'parent':
    case 'hatpreview':
    case 'backdrop':
      return null
    case 'stage':
      return `stage:${s.chapterId ?? ''}:${s.station ?? 0}:${s.ceremony ? 'c' : ''}`
    default:
      return s.name
  }
}

interface St {
  last: string | null
  run: number
  done: number
}

export function ScreenTransition({ screenKey }: { screenKey: string | null }) {
  const [st, setSt] = useState<St>({ last: screenKey, run: 0, done: 0 })
  if (screenKey !== null && screenKey !== st.last) {
    // render 中更新自己的 state：React 會在 commit 前立刻重畫，遮罩因此和新畫面同一幀出現
    setSt({ last: screenKey, run: prefersReducedMotion() ? st.run : st.run + 1, done: st.done })
  }
  const playing = st.run > st.done

  useEffect(() => {
    if (!playing) return
    const t = window.setTimeout(() => setSt((s) => ({ ...s, done: s.run })), FALLBACK_MS)
    return () => window.clearTimeout(t)
  }, [playing, st.run])

  if (!playing) return null
  return (
    <div
      key={st.run}
      className="gq-st"
      data-testid="screen-transition"
      data-run={st.run}
      aria-hidden
      onAnimationEnd={(e) => {
        if (e.target instanceof HTMLElement && e.target.classList.contains('gq-st-veil')) setSt((s) => ({ ...s, done: s.run }))
      }}
    >
      <i className="gq-st-veil" />
      {CLOUDS.map((c, i) => (
        <i
          key={i}
          className={`gq-cloud gq-st-cloud ${c.flip ? 'flip' : ''}`}
          style={{ left: `${c.x}%`, top: `${c.y}%`, ['--vx' as string]: c.vx, ['--vy' as string]: c.vy, ['--k' as string]: c.k, animationDelay: `${c.delay}ms` } as CSSProperties}
        />
      ))}
    </div>
  )
}
