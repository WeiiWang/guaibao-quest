import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

/**
 * 拖曳工具（Pointer Events，滑鼠、觸控、手寫筆共用）。
 * - 可拖的東西要設 touch-action: none，手指拖曳才不會被當成捲動
 * - 沒有移動（小於 10px）就算「點一下」→ onTap：所以每個拖曳互動都有「點選物件再點目標」的替代操作
 * - 放開時用 elementsFromPoint 找最上面帶 data-drop 的元素，id 交給 onDrop（找不到 = null，彈回去）
 * - 鍵盤：Enter / 空白鍵等同點一下
 */
export interface DragKitOptions {
  /** 這個東西現在能不能拖／點 */
  disabled?: boolean
  onTap: (id: string) => void
  onDrop: (id: string, dropId: string | null) => void
  /** 拖曳中跟著手指的東西 */
  renderGhost: (id: string) => ReactNode
}

interface Active {
  id: string
  pointerId: number
  startX: number
  startY: number
  moved: boolean
}

export const DRAG_THRESHOLD = 10

export function useDragKit({ disabled, onTap, onDrop, renderGhost }: DragKitOptions) {
  const active = useRef<Active | null>(null)
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null)
  const [overDrop, setOverDrop] = useState<string | null>(null)

  const dropAt = (x: number, y: number): string | null => {
    const el = document.elementsFromPoint(x, y).find((e) => (e as HTMLElement).dataset?.drop !== undefined) as HTMLElement | undefined
    return el?.dataset.drop ?? null
  }

  const finish = useCallback(() => {
    active.current = null
    setGhost(null)
    setOverDrop(null)
  }, [])

  // 元件卸載時收尾
  useEffect(() => () => void (active.current = null), [])

  const bind = (id: string) => ({
    'data-drag-id': id,
    style: { touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' } as CSSProperties,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (disabled || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* 某些環境不支援 capture，照樣能用 */
      }
      active.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const a = active.current
      if (!a || a.pointerId !== e.pointerId) return
      if (!a.moved && Math.hypot(e.clientX - a.startX, e.clientY - a.startY) < DRAG_THRESHOLD) return
      a.moved = true
      setGhost({ id: a.id, x: e.clientX, y: e.clientY })
      setOverDrop(dropAt(e.clientX, e.clientY))
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const a = active.current
      if (!a || a.pointerId !== e.pointerId) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      const moved = a.moved
      const target = moved ? dropAt(e.clientX, e.clientY) : null
      finish()
      if (moved) onDrop(a.id, target)
      else onTap(a.id)
    },
    onPointerCancel: () => finish(),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (disabled) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onTap(id)
      }
    },
    // 鍵盤或輔助技術觸發的 click（detail 為 0）也算點一下；滑鼠/觸控的 click 已經在 pointerup 處理
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (e.detail === 0 && !disabled) onTap(id)
    },
  })

  const ghostNode = ghost ? (
    <div className="drag-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden>
      {renderGhost(ghost.id)}
    </div>
  ) : null

  return { bind, ghostNode, draggingId: ghost?.id ?? null, overDrop }
}
