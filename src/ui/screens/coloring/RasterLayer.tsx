import { useLayoutEffect, useRef, useState } from 'react'
import { paintAll, paintRegion, regionRect, rippleMax, type RgbaBuf } from '../../../art/coloring/fillPaint'
import { labelOfId } from '../../../art/coloring/regions'
import { rasterHdUrl, rasterUrl, type RasterArt } from '../../../art/coloring/rasterArt'
import { toUnit } from '../../../art/coloring/render'

export interface Ripple {
  id: string
  n: number
  /** 點擊位置（著色頁座標空間 0–400） */
  at?: [number, number]
}

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
const RIPPLE_MS = 420

interface State {
  art: RasterArt
  buf: RgbaBuf
  img: ImageData
  drawn: Record<string, string>
  stop: (() => void) | null
}

/**
 * 點陣頁的填色層：768×768 的 canvas（填色）+ 線稿 PNG 疊在最上面。
 * 填色只重畫「有變動的區塊」；剛填的那一塊從點擊位置向外擴散成漣漪（減少動態時直接填滿）。
 */
export function RasterLayer({ art, fills, ripple, flashIds }: { art: RasterArt; fills: Record<string, string>; ripple: Ripple | null; flashIds?: readonly string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const flashRef = useRef<HTMLCanvasElement>(null)
  const st = useRef<State | null>(null)
  // v7.3 F2：顯示用 2048 高解析線稿；載不到（沒有 -hd 檔）就退回 1024 那份
  const [hdFailed, setHdFailed] = useState(false)
  const lineSrc = (!hdFailed && rasterHdUrl(art.pageId)) || rasterUrl(art.pageId) || ''

  useLayoutEffect(() => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const s = st.current
    const flush = (label: number) => {
      if (!s) return
      const r = regionRect(art.map, label)
      if (r.w > 0) ctx.putImageData(s.img, 0, 0, r.x, r.y, r.w, r.h)
    }
    if (!s || s.art !== art) {
      s?.stop?.()
      const buf = paintAll(art.map, fills)
      const img = new ImageData(buf.data as Uint8ClampedArray<ArrayBuffer>, buf.width, buf.height)
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.putImageData(img, 0, 0)
      st.current = { art, buf, img, drawn: { ...fills }, stop: null }
      return
    }
    s.stop?.() // 上一個漣漪還沒播完：直接畫到最後
    s.stop = null
    const changed = new Set<string>()
    for (const k of Object.keys(fills)) if (fills[k] !== s.drawn[k]) changed.add(k)
    for (const k of Object.keys(s.drawn)) if (!(k in fills)) changed.add(k)
    const cur = s
    for (const id of changed) {
      const label = labelOfId(id)
      if (!label || !art.map.regions[label - 1]) continue
      const at = ripple && ripple.id === id ? ripple.at : undefined
      if (at && fills[id] && !reduced()) {
        // 漣漪：半徑隨時間變大，圓內的像素畫上新顏色
        const x = toUnit(at[0]) * art.map.size
        const y = toUnit(at[1]) * art.map.size
        const max = rippleMax(art.map, label, x, y)
        const t0 = performance.now()
        let raf = 0
        const finish = () => {
          cancelAnimationFrame(raf)
          paintRegion(cur.buf, art.map, label, fills[id])
          flush(label)
          cur.stop = null
        }
        const step = (now: number) => {
          const f = Math.min(1, (now - t0) / RIPPLE_MS)
          if (f >= 1) return finish()
          const eased = 1 - (1 - f) ** 3
          paintRegion(cur.buf, art.map, label, fills[id], { x, y, r: max * eased })
          flush(label)
          raf = requestAnimationFrame(step)
        }
        cur.stop = finish
        raf = requestAnimationFrame(step)
      } else {
        paintRegion(cur.buf, art.map, label, fills[id])
        flush(label)
      }
    }
    cur.drawn = { ...fills }
  }, [art, fills, ripple])

  useLayoutEffect(
    () => () => {
      st.current?.stop?.()
    },
    [],
  )

  // v7.3 F3：「還沒塗」的區塊閃動。把這些區塊（含往線條底下鋪的那幾像素）畫成一層半透明的暖色，CSS 負責閃 2 秒
  useLayoutEffect(() => {
    const c = flashRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    if (!flashIds?.length) return
    const want = new Set<number>()
    for (const id of flashIds) {
      const l = labelOfId(id)
      if (l) want.add(l)
    }
    const { paint, size } = art.map
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let i = 0, j = 0; i < paint.length; i++, j += 4) {
      if (want.has(paint[i])) {
        d[j] = 255
        d[j + 1] = 176
        d[j + 2] = 46
        d[j + 3] = 215
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [art, flashIds])

  return (
    <div className="pb-raster" data-testid="raster-layer" data-regions={art.map.regions.length} data-build-ms={Math.round(art.buildMs)}>
      <canvas ref={canvasRef} className="pb-fill" width={art.map.size} height={art.map.size} />
      <canvas ref={flashRef} className="f73-flash" data-testid="flash-layer" data-on={flashIds?.length ? '1' : '0'} data-n={flashIds?.length ?? 0} width={art.map.size} height={art.map.size} aria-hidden />
      <img className="pb-line" src={lineSrc} alt="" draggable={false} data-hd={lineSrc.endsWith('-hd.png') ? '1' : '0'} onError={() => setHdFailed(true)} />
    </div>
  )
}

