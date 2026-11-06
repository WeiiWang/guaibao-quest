import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { useArtStatus } from '../../artProbe'
import { Art } from '../../components/Art'
import { reducedMotion } from '../playground/playU'
import './y-shared.css'

// 線 Y（超市、果汁攤）共用的小工具：缺圖時的手繪退路、玩具硬幣、拖曳層、飛過去的小動畫

/** 有 3D 圖就用圖；圖沒生好時畫 fallback（不是 emoji，也不會是一塊字）。還在探測時先留空位，不閃 */
export function ArtOr({ name, fallback, className = '' }: { name: string; fallback: ReactNode; className?: string }) {
  const st = useArtStatus(name)
  if (st === 'ok') return <Art name={name} alt="" className={`ys-art ${className}`} />
  return (
    <span className={`ys-art ys-fallback ${className}`} aria-hidden data-fallback={st === 'no' ? '1' : undefined}>
      {st === 'no' ? fallback : null}
    </span>
  )
}

/** 玩具硬幣：金色圓片，中間是大大的數字（圖沒好時自己畫；面額一定看得到） */
export function CoinFace({ value }: { value: number }) {
  return <ArtOr name={`ui-coin-${value}`} className="ys-coin-art" fallback={<span className={`ys-coin ys-coin-${value}`}>{value}</span>} />
}

/** 從 from 飛到 to 的小東西（純畫面，飛完自己消失）。動作減少時不飛 */
export interface Flyer {
  key: number
  node: ReactNode
  from: { x: number; y: number }
  to: { x: number; y: number }
  size: number
}

export function useFlyers(ms = 420) {
  const [flyers, setFlyers] = useState<Flyer[]>([])
  const next = useRef(1)
  const timers = useRef(new Set<number>())
  useEffect(() => {
    const ids = timers.current
    return () => {
      for (const id of ids) window.clearTimeout(id)
      ids.clear()
    }
  }, [])
  const fly = useCallback(
    (node: ReactNode, from: Element | DOMRect | null | undefined, to: Element | DOMRect | null | undefined, size = 72) => {
      if (!from || !to || reducedMotion()) return
      const a = from instanceof Element ? from.getBoundingClientRect() : from
      const b = to instanceof Element ? to.getBoundingClientRect() : to
      const key = next.current++
      setFlyers((f) => [...f, { key, node, size, from: { x: a.left + a.width / 2, y: a.top + a.height / 2 }, to: { x: b.left + b.width / 2, y: b.top + b.height / 2 } }])
      const id = window.setTimeout(() => {
        timers.current.delete(id)
        setFlyers((f) => f.filter((x) => x.key !== key))
      }, ms)
      timers.current.add(id)
    },
    [ms],
  )
  const layer = (
    <>
      {flyers.map((f) => (
        <span
          key={f.key}
          className="ys-flyer"
          data-testid="ys-flyer"
          aria-hidden
          style={{ left: f.to.x, top: f.to.y, width: f.size, height: f.size, '--ys-dx': `${f.from.x - f.to.x}px`, '--ys-dy': `${f.from.y - f.to.y}px`, animationDuration: `${ms}ms` } as CSSProperties}
        >
          {f.node}
        </span>
      ))}
    </>
  )
  return { fly, layer }
}

/** 手指移動超過這個距離才算拖（手指很大，太小會把點一下變成拖） */
const DRAG_SLOP = 10

interface Ghost<T> {
  pid: number
  item: T
  x: number
  y: number
  back?: { x: number; y: number }
}

interface DragOpts<T> {
  /** 點一下（沒有拖）。el 是被點的那個元素 */
  onTap: (item: T, el: HTMLElement) => void
  /** 放開在 (x, y)：回傳 true = 收下了，ghost 消失；false = 飛回原位 */
  onDrop: (item: T, x: number, y: number, el: HTMLElement) => boolean
  /** 拖著時手上的樣子 */
  render: (item: T) => ReactNode
  /** 現在可以拖嗎（不行時按下去什麼都不做） */
  enabled?: (item: T) => boolean
}

/**
 * 從托盤拖東西到目標（購物車、果汁機、客人）。每根手指一筆，可以多指。
 * 拖的時候手上有一個 ghost（畫在固定定位的層），放在目標外會溫和地飛回去。
 */
export function useDragLayer<T>(opts: DragOpts<T>) {
  const latest = useRef(opts)
  useEffect(() => {
    latest.current = opts
  })
  const drags = useRef(new Map<number, { item: T; sx: number; sy: number; moved: boolean }>())
  const [ghosts, setGhosts] = useState<Ghost<T>[]>([])
  const layerRef = useRef<HTMLDivElement>(null)
  const timers = useRef(new Set<number>())
  useEffect(() => {
    const ids = timers.current
    return () => {
      for (const id of ids) window.clearTimeout(id)
      ids.clear()
    }
  }, [])

  const ghostEl = (pid: number) => layerRef.current?.querySelector<HTMLElement>(`[data-ypid="${pid}"]`)

  const bind = (item: T) => ({
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (latest.current.enabled && !latest.current.enabled(item)) return
      e.currentTarget.setPointerCapture?.(e.pointerId)
      drags.current.set(e.pointerId, { item, sx: e.clientX, sy: e.clientY, moved: false })
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const d = drags.current.get(e.pointerId)
      if (!d) return
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return
        d.moved = true
        setGhosts((g) => [...g, { pid: e.pointerId, item: d.item, x: e.clientX, y: e.clientY }])
        return
      }
      const el = ghostEl(e.pointerId)
      if (el) el.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      const d = drags.current.get(e.pointerId)
      if (!d) return
      drags.current.delete(e.pointerId)
      const el = e.currentTarget
      if (!d.moved) {
        latest.current.onTap(d.item, el)
        return
      }
      const pid = e.pointerId
      if (latest.current.onDrop(d.item, e.clientX, e.clientY, el)) {
        setGhosts((g) => g.filter((x) => x.pid !== pid))
        return
      }
      const home = el.getBoundingClientRect()
      setGhosts((g) => g.map((x) => (x.pid === pid ? { ...x, back: { x: home.left + home.width / 2, y: home.top + home.height / 2 } } : x)))
      const id = window.setTimeout(
        () => {
          timers.current.delete(id)
          setGhosts((g) => g.filter((x) => x.pid !== pid))
        },
        reducedMotion() ? 0 : 340,
      )
      timers.current.add(id)
    },
    onPointerCancel: (e: RPointerEvent<HTMLElement>) => {
      const pid = e.pointerId
      if (!drags.current.delete(pid)) return
      setGhosts((g) => g.filter((x) => x.pid !== pid))
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      // 鍵盤或輔助工具按下去（沒有 pointer 事件）
      if (e.detail === 0) latest.current.onTap(item, e.currentTarget)
    },
  })

  const clear = useCallback(() => {
    drags.current.clear()
    setGhosts([])
  }, [])

  const layer = (
    <div ref={layerRef} className="ys-ghosts" aria-hidden>
      {ghosts.map((g) => (
        <span
          key={g.pid}
          className="ys-ghost"
          data-ypid={g.pid}
          data-back={g.back ? '1' : undefined}
          data-testid="ys-ghost"
          style={{ transform: `translate(${g.back?.x ?? g.x}px, ${g.back?.y ?? g.y}px) translate(-50%, -50%)${g.back ? ' scale(0.6)' : ''}` }}
        >
          {latest.current.render(g.item)}
        </span>
      ))}
    </div>
  )
  return { bind, layer, clear }
}

/** 點 (x, y) 在不在元素上（手指大，多給一點邊） */
export function hitEl(el: Element | null | undefined, x: number, y: number, slop = 36): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop
}

/** 輕輕晃一下（放不下、還不能按的時候）：只動 transform，動作減少時不晃 */
export function wiggle(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement) || typeof el.animate !== 'function' || reducedMotion()) return
  el.dataset.wiggles = String(Number(el.dataset.wiggles ?? 0) + 1)
  el.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(0)' }], { duration: 380, easing: 'ease-out' })
}

/** 跳一下（打勾、收到東西） */
export function bop(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement) || typeof el.animate !== 'function' || reducedMotion()) return
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' })
}

/** 打勾的小圓 */
export function Check({ on }: { on: boolean }) {
  return (
    <span className="ys-check" data-on={on ? '1' : '0'} aria-hidden>
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path d="M5 12.5l4.5 4.5L19 7.500" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
