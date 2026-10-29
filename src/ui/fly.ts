import { peekArt } from './artProbe'
import { artFallbacks } from '../domain/species'

/**
 * 獲得星星 / 材料時，把物件「飛進」貨幣膠囊，到達時膠囊跳一下。
 * 全用 DOM + Web Animations API，不經過 React 狀態（動畫期間不會被重新渲染打斷）。
 */

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** 讓目標元素跳一下（數字彈跳） */
export function bump(el: Element | null | undefined) {
  if (!el) return
  el.classList.remove('bump')
  void (el as HTMLElement).offsetWidth
  el.classList.add('bump')
  window.setTimeout(() => el.classList.remove('bump'), 600)
}

export interface FlySource {
  /** 起點矩形（元素的 getBoundingClientRect） */
  rect: DOMRect | { left: number; top: number; width: number; height: number }
  /** 要飛的內容；不給就用 clone */
  node?: Node
  /** 飛行時隱藏的原元素（避免同時出現兩個） */
  hide?: HTMLElement
}

/** 建一個飛行用的圖示節點：有素材用素材，沒有用 emoji */
export function iconNode(name: string, emoji: string, px: number): HTMLElement {
  const box = document.createElement('span')
  box.style.cssText = `display:grid;place-items:center;width:${px}px;height:${px}px;font-size:${px * 0.78}px;line-height:1`
  // v7.5：兔兔、虎虎的寵物圖缺的時候用猴子的同一張，再退回 emoji
  const shown = artFallbacks(name).find((n) => peekArt(n) === 'ok')
  if (shown) {
    const img = document.createElement('img')
    img.src = `${import.meta.env.BASE_URL}art/${shown}.png`
    img.alt = ''
    img.style.cssText = 'width:100%;height:100%;object-fit:contain'
    box.appendChild(img)
  } else box.textContent = emoji
  return box
}

/** 一個物件飛向目標；回傳在抵達後 resolve 的 Promise */
export function flyOne(src: FlySource, target: Element | null, opts: { delay?: number; duration?: number; onArrive?: () => void } = {}): Promise<void> {
  const { delay = 0, duration = 850, onArrive } = opts
  if (!target) return Promise.resolve()
  const t = target.getBoundingClientRect()
  const arrive = () => {
    onArrive?.()
    bump(target)
  }
  if (reduced()) {
    arrive()
    return Promise.resolve()
  }
  const r = src.rect
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = `position:fixed;z-index:95;pointer-events:none;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;transform-origin:50% 50%;filter:drop-shadow(0 6px 5px rgba(0,0,0,.25))`
  el.appendChild(src.node ?? document.createElement('span'))
  document.body.appendChild(el)
  const dx = t.left + t.width / 2 - (r.left + r.width / 2)
  const dy = t.top + t.height / 2 - (r.top + r.height / 2)
  const s = Math.min(1, Math.max(0.25, 30 / Math.max(r.width, r.height)))
  const anim = el.animate(
    [
      { transform: 'translate(0,0) scale(1)', offset: 0, opacity: 1 },
      { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 70}px) scale(1.15)`, offset: 0.4, opacity: 1, easing: 'ease-in' },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, offset: 1, opacity: 0.9 },
    ],
    { duration, delay, easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'both' },
  )
  if (src.hide) {
    const h = src.hide
    window.setTimeout(() => (h.style.visibility = 'hidden'), delay)
  }
  return anim.finished.then(
    () => {
      el.remove()
      arrive()
    },
    () => el.remove(),
  )
}

/** 星星：從 (fromX, fromY) 灑出 n 顆飛進點數膠囊 */
export function flyStars(n: number, from: { x: number; y: number }) {
  const target = document.querySelector('[data-points-chip]')
  const count = Math.max(1, Math.min(n, 8))
  const size = 44
  const jobs: Promise<void>[] = []
  for (let i = 0; i < count; i++) {
    const jitter = (i - (count - 1) / 2) * 26
    jobs.push(
      flyOne(
        { rect: { left: from.x - size / 2 + jitter, top: from.y - size / 2, width: size, height: size }, node: iconNode('ui-star', '⭐', size) },
        target,
        { delay: i * 110, duration: 900 },
      ),
    )
  }
  return Promise.all(jobs)
}
