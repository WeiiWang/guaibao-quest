import { STICKER_BASE } from '../../domain/coloring'
import { coloringSvgString, toUnit, VIEWBOX, type ExportInput } from './render'

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })

/** 貼紙缺圖時畫的備援 emoji（key = 素材名） */
export type EmojiOf = (art: string) => string | undefined

/**
 * 把作品畫成 PNG data URL：線稿與填色（SVG）→ 筆刷 → 貼紙。
 * 失敗（例如瀏覽器不能把 SVG 畫進 canvas）時丟出錯誤，由呼叫端處理。
 */
export async function renderArtworkPng(input: ExportInput, emojiOf: EmojiOf = () => undefined, size = 720): Promise<string> {
  const svg = coloringSvgString(input.pageId, input.fills)
  if (!svg) throw new Error('找不到著色頁')
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('不能建立畫布')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, size, size)
  const base = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  if (!base) throw new Error('不能轉成圖片')
  ctx.drawImage(base, 0, 0, size, size)

  const px = (v: number) => toUnit(v) * size
  const unit = size / VIEWBOX.size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of input.strokes) {
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width * unit
    if (s.points.length === 1) {
      ctx.beginPath()
      ctx.arc(px(s.points[0][0]), px(s.points[0][1]), (s.width * unit) / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    s.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(px(x), px(y)) : ctx.lineTo(px(x), px(y))))
    ctx.stroke()
  }

  const imgs = await Promise.all(input.stickers.map((st) => loadImage(`${import.meta.env.BASE_URL}art/${st.art}.png`)))
  input.stickers.forEach((st, i) => {
    const d = STICKER_BASE * st.scale * unit
    ctx.save()
    ctx.translate(px(st.x), px(st.y))
    ctx.rotate((st.rot * Math.PI) / 180)
    const img = imgs[i]
    if (img) ctx.drawImage(img, -d / 2, -d / 2, d, d)
    else {
      const e = emojiOf(st.art)
      if (e) {
        ctx.font = `${d * 0.8}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(e, 0, 0)
      }
    }
    ctx.restore()
  })
  return canvas.toDataURL('image/png')
}
