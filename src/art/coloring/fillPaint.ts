/**
 * 點陣頁的填色層：把「區塊 → 填色值」畫成像素。純函式（只操作一塊 RGBA 資料），單元測試與瀏覽器共用。
 * 填色值見 domain/coloring.ts：純色、rainbow、glitter / stripes / dots（帶底色）。
 * 圖樣用「整張畫的絕對座標」算，所以相鄰區塊的條紋、點點會接得起來，也不需要任何隨機。
 */
import { parseFill, type FillSpec } from '../../domain/coloring'
import type { RegionInfo, RegionMap } from './regions'

export interface RgbaBuf {
  width: number
  height: number
  data: Uint8ClampedArray
}

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
const WHITE: [number, number, number] = [255, 255, 255]

const RAINBOW_STOPS: [number, number, number][] = ['#ff7a7a', '#ffb347', '#ffe45c', '#7fdc8a', '#6fb7ff', '#b58cff'].map(hex)
function rainbowAt(t: number): [number, number, number] {
  const f = Math.min(0.9999, Math.max(0, t)) * (RAINBOW_STOPS.length - 1)
  const i = Math.floor(f)
  return mix(RAINBOW_STOPS[i], RAINBOW_STOPS[i + 1], f - i)
}

/** 圖樣的尺寸（工作解析度 768 的像素）：由向量版的 416 座標空間換算而來 */
const SC = 768 / 416
const STRIPE = Math.round(18 * SC) // 條紋週期（沿 45° 方向）
const DOT = Math.round(20 * SC) // 點點的格子
const DOT_R = 3.4 * SC
const GLIT = Math.round(30 * SC) // 亮片的格子

/** 四角星：|dx|^½ + |dy|^½ ≤ r^½ */
const inStar = (dx: number, dy: number, r: number) => Math.sqrt(Math.abs(dx)) + Math.sqrt(Math.abs(dy)) <= Math.sqrt(r)

type PixelFn = (x: number, y: number, region: RegionInfo) => [number, number, number]

function pixelFn(spec: FillSpec): PixelFn {
  if (spec.type === 'solid') {
    const c = hex(spec.color)
    return () => c
  }
  const base = hex(spec.base)
  switch (spec.kind) {
    case 'rainbow':
      return (x, y, r) => {
        const w = r.maxX - r.minX + 1
        const h = r.maxY - r.minY + 1
        return rainbowAt((x - r.minX + (y - r.minY)) / Math.max(1, w + h))
      }
    case 'stripes': {
      const light = mix(base, WHITE, 0.6)
      return (x, y) => ((((x + y) % STRIPE) + STRIPE) % STRIPE < STRIPE / 2 ? base : light)
    }
    case 'dots':
      return (x, y) => {
        const gx = x % DOT
        const gy = y % DOT
        const q = DOT / 4
        const near = (cx: number, cy: number) => (gx - cx) ** 2 + (gy - cy) ** 2 <= DOT_R * DOT_R
        return near(q, q) || near(q * 3, q * 3) ? mix(base, WHITE, 0.85) : base
      }
    default: {
      // glitter：底色 + 四角星閃點
      const gold: [number, number, number] = [255, 246, 176]
      return (x, y) => {
        const gx = x % GLIT
        const gy = y % GLIT
        const s = GLIT / 30
        if (inStar(gx - 7 * s, gy - 8 * s, 5 * s)) return WHITE
        if (inStar(gx - 22 * s, gy - 20 * s, 4 * s)) return gold
        if (inStar(gx - 24 * s, gy - 5 * s, 2.4 * s)) return WHITE
        if (inStar(gx - 9 * s, gy - 24 * s, 2.6 * s)) return mix(gold, WHITE, 0.5)
        if ((gx - 16 * s) ** 2 + (gy - 14 * s) ** 2 <= (1.2 * s) ** 2) return WHITE
        return base
      }
    }
  }
}

/**
 * 把一個區塊畫進 buf。spec 為 null = 清成透明（沒有填色）。
 * limit：只畫圓內的像素（填色漣漪動畫用，從點擊位置向外擴散）。
 * 回傳畫到的外框（給 putImageData 的 dirty rect）。
 */
export function paintRegion(
  buf: RgbaBuf,
  map: RegionMap,
  label: number,
  value: string | undefined,
  limit?: { x: number; y: number; r: number },
): void {
  const info = map.regions[label - 1]
  if (!info) return
  const spec = parseFill(value)
  const fn = spec ? pixelFn(spec) : null
  const { paint, size } = map
  const { data } = buf
  const r2 = limit ? limit.r * limit.r : 0
  // 外擴後的區塊會比外框大 PAINT_DILATE，所以掃描範圍也要放寬
  const x0 = Math.max(0, info.minX - 3)
  const x1 = Math.min(size - 1, info.maxX + 3)
  const y0 = Math.max(0, info.minY - 3)
  const y1 = Math.min(size - 1, info.maxY + 3)
  for (let y = y0; y <= y1; y++) {
    const row = y * size
    for (let x = x0; x <= x1; x++) {
      if (paint[row + x] !== label) continue
      if (limit && (x - limit.x) ** 2 + (y - limit.y) ** 2 > r2) continue
      const o = (row + x) * 4
      if (fn) {
        const c = fn(x, y, info)
        data[o] = c[0]
        data[o + 1] = c[1]
        data[o + 2] = c[2]
        data[o + 3] = 255
      } else {
        data[o + 3] = 0
      }
    }
  }
}

/** 區塊的外框（含外擴），給 putImageData 的 dirty rect 用 */
export function regionRect(map: RegionMap, label: number): { x: number; y: number; w: number; h: number } {
  const info = map.regions[label - 1]
  if (!info) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.max(0, info.minX - 3)
  const y = Math.max(0, info.minY - 3)
  return { x, y, w: Math.min(map.size - 1, info.maxX + 3) - x + 1, h: Math.min(map.size - 1, info.maxY + 3) - y + 1 }
}

/** 整張填色層（沒有填色的地方是透明）。fills 的 key 是 regionId（`r<label>`），不認得的 key 忽略 */
export function paintAll(map: RegionMap, fills: Record<string, string>): RgbaBuf {
  const buf: RgbaBuf = { width: map.size, height: map.size, data: new Uint8ClampedArray(map.size * map.size * 4) }
  for (const r of map.regions) if (fills[r.id]) paintRegion(buf, map, r.label, fills[r.id])
  return buf
}

/** 漣漪要擴散到多大才能蓋滿這個區塊（從 (x,y) 到外框最遠角落） */
export function rippleMax(map: RegionMap, label: number, x: number, y: number): number {
  const i = map.regions[label - 1]
  if (!i) return 0
  const dx = Math.max(Math.abs(x - i.minX), Math.abs(x - i.maxX))
  const dy = Math.max(Math.abs(y - i.minY), Math.abs(y - i.maxY))
  return Math.hypot(dx, dy) + 4
}
