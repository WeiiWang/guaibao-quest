import { useCallback, useEffect, useRef, useState } from 'react'
import type { ColoringSticker, ColoringStroke } from '../../../domain/types'
import { clampScale, clampStickerPos, STICKER_BASE, strokeNear, type PaintDoc } from '../../../domain/coloring'
import { fromUnit, toUnit, VIEWBOX } from '../../../art/coloring/render'
import { newId } from '../../../db/repo'
import { ColoringSvg } from '../../components/ColoringThumb'
import { Icon } from '../../components/Icon'
import { stickerEmoji } from './stickers'

export type PaintTool = 'fill' | 'brush' | 'sticker' | 'eraser'

interface Props {
  pageId: string
  doc: PaintDoc
  tool: PaintTool
  color: string
  brushWidth: number
  selected: string | null
  popped: { id: string; n: number } | null
  onFill: (regionId: string) => void
  onClearRegion: (regionId: string) => void
  onStroke: (s: ColoringStroke) => void
  onEraseStrokes: (ids: string[]) => void
  onSelect: (id: string | null) => void
  /** 貼紙手勢進行中（連續更新，不進復原堆疊） */
  onStickersLive: (next: ColoringSticker[]) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}

function drawStroke(ctx: CanvasRenderingContext2D, s: ColoringStroke, px: number) {
  const k = px / VIEWBOX.size
  const p = (v: number) => toUnit(v) * px
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineWidth = s.width * k
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (s.points.length === 1) {
    ctx.beginPath()
    ctx.arc(p(s.points[0][0]), p(s.points[0][1]), (s.width * k) / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.beginPath()
  s.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(p(x), p(y)) : ctx.lineTo(p(x), p(y))))
  ctx.stroke()
}

/** 畫板：SVG 線稿與填色 → 筆刷 canvas → 貼紙層。座標空間與著色頁相同（0–400）。 */
export function PaintBoard(props: Props) {
  const { pageId, doc, tool, color, brushWidth, selected, popped } = props
  const boardRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [px, setPx] = useState(0)
  const [erasing, setErasing] = useState<Set<string>>(new Set())
  const live = useRef<ColoringStroke | null>(null)
  const erased = useRef<Set<string>>(new Set())
  const moved = useRef(false)
  const docRef = useRef(doc)
  docRef.current = doc

  // 量畫板大小，決定 canvas 解析度
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const update = () => setPx(Math.round(el.getBoundingClientRect().width))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 重畫所有筆刷
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !px) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = px * dpr
    c.height = px * dpr
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    for (const s of doc.strokes) if (!erasing.has(s.id)) drawStroke(ctx, s, px)
  }, [doc.strokes, px, erasing])

  const pointOf = useCallback((e: { clientX: number; clientY: number }): [number, number] => {
    const r = boardRef.current!.getBoundingClientRect()
    return [fromUnit((e.clientX - r.left) / r.width), fromUnit((e.clientY - r.top) / r.height)]
  }, [])

  // ---- 筆刷 / 橡皮擦 ----
  const eraseAt = (x: number, y: number) => {
    let changed = false
    for (const s of docRef.current.strokes) {
      if (!erased.current.has(s.id) && strokeNear(s, x, y, 4)) {
        erased.current.add(s.id)
        changed = true
      }
    }
    if (changed) setErasing(new Set(erased.current))
    return changed
  }

  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = pointOf(e)
    moved.current = false
    if (tool === 'brush') {
      live.current = { id: newId(), color, width: brushWidth, points: [[x, y]] }
      const ctx = canvasRef.current!.getContext('2d')!
      drawStroke(ctx, live.current, px)
    } else if (tool === 'eraser') {
      erased.current = new Set()
      eraseAt(x, y)
    }
  }
  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons === 0 && e.pointerType === 'mouse') return
    const [x, y] = pointOf(e)
    if (tool === 'brush' && live.current) {
      const pts = live.current.points
      const [lx, ly] = pts[pts.length - 1]
      if ((lx - x) ** 2 + (ly - y) ** 2 < 2) return
      moved.current = true
      pts.push([x, y])
      const ctx = canvasRef.current!.getContext('2d')!
      drawStroke(ctx, { ...live.current, points: [[lx, ly], [x, y]] }, px)
    } else if (tool === 'eraser') {
      moved.current = true
      eraseAt(x, y)
    }
  }
  const onCanvasUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = pointOf(e)
    if (tool === 'brush' && live.current) {
      props.onStroke(live.current)
      live.current = null
    } else if (tool === 'eraser') {
      if (erased.current.size) props.onEraseStrokes([...erased.current])
      else if (!moved.current) {
        // 沒碰到筆刷：把點到的那一塊填色清掉
        const hit = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.hasAttribute('data-region'))
        const id = hit?.getAttribute('data-region')
        if (id) props.onClearRegion(id)
      }
      erased.current = new Set()
      setErasing(new Set())
    }
    void x
    void y
  }

  // ---- 貼紙 ----
  const gesture = useRef<
    | { kind: 'move'; id: string; dx: number; dy: number }
    | { kind: 'xform'; id: string; cx: number; cy: number; d0: number; a0: number; s0: number; r0: number }
    | null
  >(null)

  const updateSticker = (id: string, patch: Partial<ColoringSticker>) =>
    props.onStickersLive(docRef.current.stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const onStickerDown = (e: React.PointerEvent<HTMLDivElement>, st: ColoringSticker) => {
    if (tool !== 'sticker') return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    props.onSelect(st.id)
    props.onGestureStart()
    const [x, y] = pointOf(e)
    gesture.current = { kind: 'move', id: st.id, dx: st.x - x, dy: st.y - y }
  }
  const onHandleDown = (e: React.PointerEvent<HTMLElement>, st: ColoringSticker) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    props.onGestureStart()
    const r = boardRef.current!.getBoundingClientRect()
    const cx = r.left + toUnit(st.x) * r.width
    const cy = r.top + toUnit(st.y) * r.height
    gesture.current = {
      kind: 'xform',
      id: st.id,
      cx,
      cy,
      d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      a0: (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI,
      s0: st.scale,
      r0: st.rot,
    }
  }
  const onGestureMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (!g) return
    if (g.kind === 'move') {
      const [x, y] = pointOf(e)
      updateSticker(g.id, { x: clampStickerPos(x + g.dx), y: clampStickerPos(y + g.dy) })
    } else {
      const d = Math.hypot(e.clientX - g.cx, e.clientY - g.cy) || 1
      const a = (Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * 180) / Math.PI
      updateSticker(g.id, { scale: clampScale((g.s0 * d) / g.d0), rot: Math.round(g.r0 + (a - g.a0)) })
    }
  }
  const onGestureUp = () => {
    if (!gesture.current) return
    gesture.current = null
    props.onGestureEnd()
  }

  const canvasOn = tool === 'brush' || tool === 'eraser'
  return (
    <div className={`pt-board tool-${tool}`} ref={boardRef} data-testid="paint-board">
      <ColoringSvg
        pageId={pageId}
        fills={doc.fills}
        onRegion={tool === 'fill' ? props.onFill : undefined}
        popped={popped}
        className="pt-svg"
      />
      <canvas
        ref={canvasRef}
        className="pt-canvas"
        data-testid="brush-canvas"
        style={{ pointerEvents: canvasOn ? 'auto' : 'none', touchAction: 'none' }}
        onPointerDown={onCanvasDown}
        onPointerMove={onCanvasMove}
        onPointerUp={onCanvasUp}
        onPointerCancel={onCanvasUp}
      />
      <div className="pt-stickers" onPointerDown={() => tool === 'sticker' && props.onSelect(null)}>
        {doc.stickers.map((st) => {
          const on = tool === 'sticker'
          return (
            <div
              key={st.id}
              className={`pt-sticker ${selected === st.id && on ? 'sel' : ''}`}
              data-testid="sticker"
              data-art={st.art}
              style={{
                left: `${toUnit(st.x) * 100}%`,
                top: `${toUnit(st.y) * 100}%`,
                width: `${((STICKER_BASE * st.scale) / VIEWBOX.size) * 100}%`,
                transform: `translate(-50%, -50%) rotate(${st.rot}deg)`,
                pointerEvents: on ? 'auto' : 'none',
                touchAction: 'none',
              }}
              onPointerDown={(e) => onStickerDown(e, st)}
              onPointerMove={onGestureMove}
              onPointerUp={onGestureUp}
              onPointerCancel={onGestureUp}
            >
              <Icon name={st.art} emoji={stickerEmoji(st.art)} alt="" className="pt-sticker-art" size="100%" />
              {selected === st.id && on && (
                <i
                  className="pt-handle"
                  data-testid="sticker-handle"
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => onHandleDown(e, st)}
                  onPointerMove={onGestureMove}
                  onPointerUp={onGestureUp}
                  onPointerCancel={onGestureUp}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
