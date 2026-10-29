import { useLayoutEffect, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../components/Icon'
import type { StickerDef } from '../../../domain/stickers'

/** 畫板提供的換算（D1）：螢幕位置 → 貼紙位置（座標空間 0–400，放大時已換算；在畫板外 / 放大鈕 / 小地圖上 = null）；貼紙在螢幕上的大小 */
export interface DropApi {
  pointAt: (clientX: number, clientY: number) => [number, number] | null
  stickerPx: (scale: number) => number
}

/** 手指移動超過這麼多 css px，才當成「拖曳」；沒超過就是點一下 */
export const DRAG_SLOP = 10

interface Props {
  /** v7.4 I4：已解鎖的貼紙（已依「新的在前」排好） */
  stickers: readonly StickerDef[]
  /** 標「新」的貼紙素材名 */
  fresh?: readonly string[]
  dropApi: MutableRefObject<DropApi | null>
  /** 點一下：照舊自動偏移避開既有貼紙 */
  onTap: (art: string) => void
  /** 拖進畫布放開：貼在放開的位置 */
  onDrop: (art: string, at: [number, number]) => void
  /** 拖曳開始 / 結束（拖曳中畫板不接受別的手勢） */
  onDragChange: (dragging: boolean) => void
}

interface Drag {
  id: number
  art: string
  sx: number
  sy: number
  on: boolean
}

/**
 * 貼紙托盤：點一下 = 貼上（自動偏移）；按住拖到畫布上放開 = 貼在那裡，拖曳時有半透明預覽跟著手指，
 * 放在畫布外 = 取消。拖曳用 pointer 事件（觸控、滑鼠、筆都一樣）；按鈕的 touch-action 只留「托盤自己捲動的方向」，
 * 另一個方向的移動才會變成拖曳（橫向托盤往上拖、直向托盤往旁邊拖），不會跟捲動打架。
 */
export function StickerTray({ stickers, fresh = [], dropApi, onTap, onDrop, onDragChange }: Props) {
  const drag = useRef<Drag | null>(null)
  const swallowClick = useRef(false)
  const ghostRef = useRef<HTMLDivElement>(null)
  const last = useRef<[number, number]>([0, 0])
  const [ghost, setGhost] = useState<{ art: string; px: number } | null>(null)

  const place = (x: number, y: number) => {
    last.current = [x, y]
    const el = ghostRef.current
    if (!el) return
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
    el.dataset.over = dropApi.current?.pointAt(x, y) ? '1' : '0'
  }
  useLayoutEffect(() => {
    if (ghost) place(...last.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghost])

  const end = () => {
    const was = drag.current
    drag.current = null
    if (was?.on) {
      setGhost(null)
      onDragChange(false)
    }
  }

  const onDown = (e: RPointerEvent<HTMLButtonElement>, art: string) => {
    if (drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    drag.current = { id: e.pointerId, art, sx: e.clientX, sy: e.clientY, on: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
  const onMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (!d.on) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= DRAG_SLOP) return
      d.on = true
      onDragChange(true)
      last.current = [e.clientX, e.clientY]
      setGhost({ art: d.art, px: dropApi.current?.stickerPx(1.2) ?? 84 })
    }
    place(e.clientX, e.clientY)
  }
  const onUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (d.on) {
      const at = dropApi.current?.pointAt(e.clientX, e.clientY) ?? null
      // 拖曳之後瀏覽器還會補一個 click：吃掉它，不然會多貼一張
      swallowClick.current = true
      window.setTimeout(() => {
        swallowClick.current = false
      }, 0)
      end()
      if (at) onDrop(d.art, at)
    } else end()
  }
  const onCancel = (e: RPointerEvent<HTMLButtonElement>) => {
    if (drag.current?.id === e.pointerId) end() // 瀏覽器接手去捲動托盤：取消，不貼
  }

  return (
    <>
      <div className="pt-stickers-tray sd-tray" data-testid="sticker-tray">
        {stickers.map((s) => (
          <button
            key={s.art}
            className="pt-sticker-btn sd-btn"
            onPointerDown={(e) => onDown(e, s.art)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onCancel}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
              if (swallowClick.current) {
                swallowClick.current = false
                return
              }
              onTap(s.art)
            }}
            aria-label={`貼上${s.label}${fresh.includes(s.art) ? '（新的）' : ''}`}
            data-testid={`add-sticker-${s.art}`}
            data-new={fresh.includes(s.art) ? '1' : '0'}
          >
            <Icon name={s.art} emoji={s.emoji} alt={s.label} size="100%" />
            {fresh.includes(s.art) && <b className="i74-new" data-testid={`new-${s.art}`} aria-hidden>新</b>}
          </button>
        ))}
      </div>
      {ghost &&
        createPortal(
          <div className="sd-ghost" ref={ghostRef} data-testid="sticker-ghost" data-art={ghost.art} data-over="0" style={{ width: ghost.px, height: ghost.px }} aria-hidden>
            <Icon name={ghost.art} emoji={stickers.find((s) => s.art === ghost.art)?.emoji} alt="" size="100%" />
          </div>,
          document.body,
        )}
    </>
  )
}
