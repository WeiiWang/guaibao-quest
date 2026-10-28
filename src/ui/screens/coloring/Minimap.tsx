import { useEffect, useRef } from 'react'
import { drawBackground } from '../../../art/coloring/backgrounds'
import { drawStroke } from '../../../art/coloring/brushes'
import { isFreePage } from '../../../art/coloring/pages'
import type { PaintDoc } from '../../../domain/coloring'
import { centerOn, minimapRect, type View } from '../../../domain/viewport'
import { PageThumb } from '../../components/ColoringThumb'

const SIZE = 104

/** 小地圖：放大時出現在右下角，顯示目前看到哪一塊；拖曳小框可以移動視窗 */
export function Minimap({ pageId, doc, view, onView }: { pageId: string; doc: PaintDoc; view: View; onView: (v: View) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const bgRef = useRef<HTMLCanvasElement>(null)
  const free = isFreePage(pageId)
  const r = minimapRect(view)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = SIZE * dpr
    c.height = SIZE * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, SIZE, SIZE)
    for (const s of doc.strokes) drawStroke(ctx, s, SIZE) // 筆刷圖層（橡皮擦只擦這一層）
  }, [doc.strokes])
  useEffect(() => {
    const c = bgRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx || !free) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = SIZE * dpr
    c.height = SIZE * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawBackground(ctx, doc.bg, SIZE)
  }, [doc.bg, free])

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    onView(centerOn(view, (e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height))
  }
  const drag = useRef(false)
  return (
    <div
      className="pb-mini"
      data-pb-ui
      data-testid="pb-minimap"
      style={{ width: SIZE, height: SIZE, touchAction: 'none' }}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = true
        move(e)
      }}
      onPointerMove={(e) => drag.current && move(e)}
      onPointerUp={() => (drag.current = false)}
      onPointerCancel={() => (drag.current = false)}
      aria-label="小地圖，拖一拖可以移動畫面"
      role="img"
    >
      {!free && <PageThumb pageId={pageId} fills={doc.fills} className="pb-mini-base" />}
      {free && <canvas ref={bgRef} className="pb-mini-strokes" />}
      <canvas ref={ref} className="pb-mini-strokes" />
      <i className="pb-mini-view" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
    </div>
  )
}
