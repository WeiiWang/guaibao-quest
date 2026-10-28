import { DOTS_REFERENCE_OPACITY, dotsItem, parseDotsId, silhouettePath } from '../dots/dots'
import { STICKER_BASE } from '../../domain/coloring'
import { drawBackground } from './backgrounds'
import { drawStroke } from './brushes'
import { getColoringPage, isFreePage } from './pages'
import { drawRasterComposite, getRasterArt } from './rasterArt'
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
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('不能建立畫布')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, size, size)
  const page = getColoringPage(input.pageId)
  if (isFreePage(input.pageId)) {
    drawBackground(ctx, input.bg, size)
  } else if (page?.kind === 'raster') {
    const art = await getRasterArt(input.pageId)
    if (!art) throw new Error('找不到線稿')
    drawRasterComposite(ctx, art, input.fills, size, false)
  } else {
    const svg = coloringSvgString(input.pageId, input.fills)
    if (!svg) throw new Error('找不到著色頁')
    const base = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    if (!base) throw new Error('不能轉成圖片')
    ctx.drawImage(base, 0, 0, size, size)
    // v7.3 F4：連連看拿去塗色的頁，剪影裡有 25% 的原 3D 圖當參考（畫板上看到的什麼樣，完成圖就什麼樣）
    const dp = parseDotsId(input.pageId)
    const it = dp && dotsItem(dp.name)
    const ref = dp && it ? await loadImage(`${import.meta.env.BASE_URL}art/${dp.name}.png`) : null
    if (dp && it && ref) {
      ctx.save()
      const k = size / VIEWBOX.size
      ctx.scale(k, k)
      ctx.translate(-VIEWBOX.x, -VIEWBOX.y)
      ctx.clip(new Path2D(silhouettePath(dp.name)))
      ctx.globalAlpha = DOTS_REFERENCE_OPACITY
      ctx.drawImage(ref, it.img[0], it.img[1], it.img[2], it.img[3])
      ctx.restore()
    }
  }

  const px = (v: number) => toUnit(v) * size
  const unit = size / VIEWBOX.size
  // 筆刷：和畫板用同一個 drawStroke；畫在獨立的圖層再疊上去（橡皮擦只擦筆刷，不能擦掉線稿與填色）
  if (input.strokes.length) {
    const layer = document.createElement('canvas')
    layer.width = size
    layer.height = size
    const lctx = layer.getContext('2d')
    if (lctx) {
      for (const s of input.strokes) drawStroke(lctx, s, size)
      ctx.drawImage(layer, 0, 0)
    }
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

/**
 * 連連看連完、直接按「完成」存進畫廊的作品：淡紫底 + 3D 圖（位置與輪廓對齊）。
 * 要「拿去塗色」的作品走 renderArtworkPng（剪影 + 填色 + 筆刷 + 貼紙）。
 */
export async function renderDotsArtworkPng(name: string, size = 720): Promise<string> {
  const it = dotsItem(name)
  if (!it) throw new Error('找不到連連看頁')
  const img = await loadImage(`${import.meta.env.BASE_URL}art/${name}.png`)
  if (!img) throw new Error('找不到圖片')
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('不能建立畫布')
  const g = ctx.createLinearGradient(0, 0, 0, size)
  g.addColorStop(0, '#fbf8ff')
  g.addColorStop(1, '#ece3ff')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const px = (v: number) => toUnit(v) * size
  const unit = size / VIEWBOX.size
  const [x, y, w, h] = it.img
  // 腳下的淡淡影子
  ctx.fillStyle = 'rgba(120, 90, 190, 0.14)'
  ctx.beginPath()
  ctx.ellipse(px(200), px(y + h * 0.97), w * unit * 0.34, h * unit * 0.035, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.drawImage(img, px(x), px(y), w * unit, h * unit)
  return canvas.toDataURL('image/png')
}
