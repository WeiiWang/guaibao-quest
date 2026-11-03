/**
 * 全域按鈕手感的「放開彈回」。按下縮小是純 CSS（shell.css 的 button:active { scale }），
 * 放開時才彈一下要用 Web Animations（CSS 沒辦法「放開才觸發」）。只動獨立的 scale 屬性，不碰元件自己的 transform。
 *
 * 不影響的東西：
 * - 繪圖畫布、拖曳：只處理 <button>，而且 touch-action: none 的（拖曳用的）不處理。
 * - 自動化瀏覽器（navigator.webdriver）預設不裝（Playwright 點完要等元件「穩定」，彈跳會拖慢既有 e2e）；localStorage 設 gq-title-test=1 才開。
 * - prefers-reduced-motion：不彈。
 */
import { skipShellMotion } from './titleGate'

export function installPressFeel(): void {
  if (typeof document === 'undefined' || skipShellMotion()) return
  // iOS Safari 舊版要有 touchstart 監聽，:active 才會在觸控時生效
  document.addEventListener('touchstart', () => undefined, { passive: true })
  document.addEventListener(
    'pointerup',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('button') as HTMLButtonElement | null
      if (!el || el.disabled || typeof el.animate !== 'function') return
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      const cs = getComputedStyle(el)
      if (cs.touchAction === 'none') return
      // :active 這一刻還沒解除，讀得到按下時的縮放（沒縮 = none → 1）
      const from = parseFloat(cs.scale) || 1
      el.animate(
        [{ scale: String(from) }, { scale: '1.07' }, { scale: '0.98' }, { scale: '1' }],
        { duration: 340, easing: 'cubic-bezier(0.3, 0.9, 0.4, 1)' },
      )
    },
    { capture: true, passive: true },
  )
}
