import { useEffect, useRef } from 'react'
import { drawStampShape, drawStroke, previewStroke } from '../../../art/coloring/brushes'
import type { BrushKind } from '../../../domain/types'

/** 筆刷圖示：用和畫板同一套 drawStroke 畫一小段示範筆觸，所以圖示就是這支筆真正畫出來的樣子 */
export function BrushPreview({ kind, color, stamp, w = 74, h = 38 }: { kind: BrushKind; color: string; stamp?: string; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = w * dpr
    c.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    // 示範筆觸是 360×140 左右的一條 S 形：縮放到剛好塞進 w×h
    const px = (w * 416) / 372
    ctx.save()
    ctx.translate(0, h / 2 - px * 0.5)
    ctx.beginPath()
    ctx.rect(0, -px, w, px * 3)
    ctx.clip()
    const s = previewStroke(kind, color, stamp)
    // 圖示上的筆比較細，不然 w×h 塞不下
    drawStroke(ctx, { ...s, width: kind === 'stamp' ? 26 : 34 }, px)
    ctx.restore()
  }, [kind, color, stamp, w, h])
  return <canvas ref={ref} className="pb-brush-ico" style={{ width: w, height: h }} aria-hidden />
}

/** 印章圖案按鈕上的小圖 */
export function StampShape({ stamp, color, size = 40 }: { stamp: string; color: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = size * dpr
    c.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    drawStampShape(ctx, stamp, size / 2, size / 2, size * 0.38, color)
  }, [stamp, color, size])
  return <canvas ref={ref} className="pb-stamp-ico" style={{ width: size, height: size }} aria-hidden />
}
