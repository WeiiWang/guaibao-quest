// v7 B1：答對時 3–5 顆小星光從答對的卡片飛向頂端進度點，進度點彈一下。
// 全用 DOM + Web Animations API（不經過 React 狀態，動畫期間不會被重新渲染打斷）；遵守 prefers-reduced-motion。

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** 讓目標彈一下（進度點） */
export function popTarget(el: Element | null | undefined): void {
  if (!el) return
  el.classList.remove('q7-pop')
  void (el as HTMLElement).offsetWidth
  el.classList.add('q7-pop')
  window.setTimeout(() => el.classList.remove('q7-pop'), 700)
}

/** 星光顆數：3–5 顆（連續答對越多越多；固定規則，不用機率） */
export const sparkCount = (combo: number): number => Math.min(5, 3 + Math.max(0, combo - 1))

export interface SparkOptions {
  count?: number
  /** 飛行時間（ms） */
  duration?: number
}

/**
 * 從 from（答對的卡片）飛出 count 顆星光到 target（進度點）。回傳實際放出的顆數（reduced-motion 時不飛，回傳 0，只彈目標）。
 * 星光掛在 document.body 上（position:fixed），結束後自己移除。
 */
export function flySparks(from: Element | null, target: Element | null, opts: SparkOptions = {}): number {
  const count = opts.count ?? 3
  const duration = opts.duration ?? 900
  if (!from || !target) {
    popTarget(target)
    return 0
  }
  if (reduced()) {
    popTarget(target)
    return 0
  }
  const f = from.getBoundingClientRect()
  const t = target.getBoundingClientRect()
  const sx = f.left + f.width / 2
  const sy = f.top + f.height / 2
  const tx = t.left + t.width / 2
  const ty = t.top + t.height / 2
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span')
    el.className = 'q7-spark'
    el.setAttribute('data-testid', 'q7-spark')
    el.setAttribute('aria-hidden', 'true')
    el.textContent = i % 2 ? '✦' : '★'
    // 起點散開一點，終點都是進度點
    const spread = (i - (count - 1) / 2) * 34
    el.style.left = `${sx + spread - 14}px`
    el.style.top = `${sy - 14}px`
    document.body.appendChild(el)
    const dx = tx - (sx + spread)
    const dy = ty - sy
    const delay = i * 90
    const anim = el.animate(
      [
        { transform: 'translate(0,0) scale(0.4) rotate(0deg)', opacity: 0, offset: 0 },
        { transform: `translate(${dx * 0.25}px, ${dy * 0.25 - 60}px) scale(1.25) rotate(120deg)`, opacity: 1, offset: 0.35, easing: 'ease-in' },
        { transform: `translate(${dx}px, ${dy}px) scale(0.5) rotate(300deg)`, opacity: 0.9, offset: 1 },
      ],
      { duration, delay, easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'both' },
    )
    const last = i === count - 1
    void anim.finished.then(
      () => {
        el.remove()
        if (last) popTarget(target)
      },
      () => {
        el.remove()
        if (last) popTarget(target)
      },
    )
  }
  return count
}
