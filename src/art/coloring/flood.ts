/**
 * v7.4 I1：空白畫紙的填色桶（對「筆畫層」做 flood fill）。
 *
 * 填色存成一筆 kind 'fill' 的筆畫（點下去的位置 + 顏色）。畫板、小地圖、完成圖匯出重畫整層筆畫時，
 * 輪到這一筆就對「畫布上目前已經有的內容」（它之前的筆畫與填色）重新算一次，所以：
 * 存檔只多一個點、復原就是少一筆、橡皮擦（destination-out）擦過的地方在重畫時一樣會被擦掉、重新載入結果一致。
 *
 * 做法：
 * 1. 以點下去那格的顏色當「種子色」，顏色差在容差內的像素算同一塊（透明對透明；填過色的區塊也能再換色）。
 * 2. 防漏：把「不同色的像素（= 線）」向外撐 GAP_UNITS 個座標單位再去 flood，手畫的圈沒有完全接起來（缺口 ≤ 約 6 單位）也封得住；
 *    撐完仍然漏到畫布邊緣就改用更大的 GAP_UNITS_BIG（缺口 ≤ 約 16 單位）；點的位置太靠近線（種子被撐掉了）就依序退回更小的值。
 * 3. 填色範圍 = 區塊往外長回 g 格（補回被撐掉的那一圈），但不蓋到線；線邊緣半透明的反鋸齒像素，把顏色墊在它底下，不留白邊。
 *
 * 全部在畫布像素上算（canvas.width 是實際像素），防漏距離依解析度換算成像素，所以不同解析度結果近似。
 */
import type { ColoringStroke } from '../../domain/types'
import { toUnit, VIEWBOX } from './render'

/** 顏色容差（每個通道，含透明度） */
export const FLOOD_TOL = 48
/** 防漏：把線往外撐幾個座標單位（0–400 的單位） */
export const GAP_UNITS = 3
export const GAP_UNITS_BIG = 8
/** 橡皮擦點掉填色用的 color 值 */
export const FILL_CLEAR = 'clear'

const HEX = /^#[0-9a-fA-F]{6}$/

/** 兩個顏色（含透明度）是不是「同一塊」：兩個都幾乎透明就算同一塊，不比 rgb */
function same(d: Uint8ClampedArray, i: number, sr: number, sg: number, sb: number, sa: number): boolean {
  const a = d[i + 3]
  if (a <= FLOOD_TOL && sa <= FLOOD_TOL) return true
  if (Math.abs(a - sa) > FLOOD_TOL) return false
  return Math.abs(d[i] - sr) <= FLOOD_TOL && Math.abs(d[i + 1] - sg) <= FLOOD_TOL && Math.abs(d[i + 2] - sb) <= FLOOD_TOL
}

/** 方形結構元素的膨脹（水平、垂直各掃一次，O(N)）：src 裡 1 的格子向外長 g 格 */
export function dilate(src: Uint8Array, w: number, g: number): Uint8Array {
  if (g <= 0) return src.slice()
  const tmp = new Uint8Array(w * w)
  const out = new Uint8Array(w * w)
  for (let y = 0; y < w; y++) {
    const base = y * w
    let cnt = 0
    for (let x = 0; x <= Math.min(g, w - 1); x++) cnt += src[base + x]
    for (let x = 0; x < w; x++) {
      tmp[base + x] = cnt > 0 ? 1 : 0
      const add = x + g + 1
      const del = x - g
      if (add < w) cnt += src[base + add]
      if (del >= 0) cnt -= src[base + del]
    }
  }
  for (let x = 0; x < w; x++) {
    let cnt = 0
    for (let y = 0; y <= Math.min(g, w - 1); y++) cnt += tmp[y * w + x]
    for (let y = 0; y < w; y++) {
      out[y * w + x] = cnt > 0 ? 1 : 0
      const add = y + g + 1
      const del = y - g
      if (add < w) cnt += tmp[add * w + x]
      if (del >= 0) cnt -= tmp[del * w + x]
    }
  }
  return out
}

/** 從種子往四個方向 flood（掃描線法）：blocked = 1 的格子是牆。回傳區塊、有沒有碰到畫布邊緣（= 漏出去） */
export function floodRegion(blocked: Uint8Array, w: number, sx: number, sy: number): { reg: Uint8Array; leaks: boolean; count: number } | null {
  if (blocked[sy * w + sx]) return null
  const reg = new Uint8Array(w * w)
  const stack: number[] = [sy * w + sx]
  let leaks = false
  let count = 0
  while (stack.length) {
    const idx = stack.pop() as number
    const y = (idx / w) | 0
    let x0 = idx - y * w
    if (reg[idx] || blocked[idx]) continue
    let x1 = x0
    const row = y * w
    while (x0 > 0 && !blocked[row + x0 - 1] && !reg[row + x0 - 1]) x0--
    while (x1 < w - 1 && !blocked[row + x1 + 1] && !reg[row + x1 + 1]) x1++
    if (x0 === 0 || x1 === w - 1 || y === 0 || y === w - 1) leaks = true
    for (let x = x0; x <= x1; x++) reg[row + x] = 1
    count += x1 - x0 + 1
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= w) continue
      const nrow = ny * w
      let inRun = false
      for (let x = x0; x <= x1; x++) {
        const ok = !blocked[nrow + x] && !reg[nrow + x]
        if (ok && !inRun) stack.push(nrow + x)
        inRun = ok
      }
    }
  }
  return { reg, leaks, count }
}

export interface FloodResult {
  /** 要上色的格子（1 = 填） */
  fill: Uint8Array
  /** 用到的防漏距離（像素） */
  gap: number
  leaks: boolean
}

/**
 * 在 RGBA 像素 d（w × w）上，從 (sx, sy) 算出要填的範圍。
 * barrier：不同色的像素（線）；依序試 GAP_UNITS、GAP_UNITS_BIG（前一個漏出去才試下一個）、再退回小距離（種子太靠近線）。
 */
export function computeFill(d: Uint8ClampedArray, w: number, sx: number, sy: number): FloodResult | null {
  const si = (sy * w + sx) * 4
  const sr = d[si]
  const sg = d[si + 1]
  const sb = d[si + 2]
  const sa = d[si + 3]
  const bar0 = new Uint8Array(w * w)
  for (let i = 0, p = 0; p < w * w; p++, i += 4) bar0[p] = same(d, i, sr, sg, sb, sa) ? 0 : 1
  const unit = w / VIEWBOX.size
  const ladder = [Math.max(1, Math.round(GAP_UNITS * unit)), Math.max(2, Math.round(GAP_UNITS_BIG * unit)), Math.max(1, Math.round(unit)), 0]
  let firstLeak: { reg: Uint8Array; g: number } | null = null
  const tried = new Set<number>()
  for (const g of ladder) {
    if (tried.has(g) || (firstLeak && g < firstLeak.g)) continue // 已經漏了：更小的距離只會漏得更多
    tried.add(g)
    const bl = g > 0 ? dilate(bar0, w, g) : bar0
    const r = floodRegion(bl, w, sx, sy)
    if (!r) continue // 種子被撐掉了：試更小的距離
    if (!r.leaks) return finish(bar0, w, r.reg, g, false)
    if (!firstLeak) firstLeak = { reg: r.reg, g }
  }
  return firstLeak ? finish(bar0, w, firstLeak.reg, firstLeak.g, true) : null
}

function finish(bar0: Uint8Array, w: number, reg: Uint8Array, g: number, leaks: boolean): FloodResult {
  if (g <= 0) return { fill: reg, gap: 0, leaks }
  const grown = dilate(reg, w, g)
  for (let i = 0; i < grown.length; i++) if (bar0[i]) grown[i] = 0 // 只補回被撐掉的那一圈，不蓋到線
  return { fill: grown, gap: g, leaks }
}

/** 填色：把 fill 範圍畫上 rgb；線邊緣的半透明像素把顏色墊在底下（existing over fill），不留白邊 */
function paint(img: ImageData, w: number, fill: Uint8Array, rgb: [number, number, number]) {
  const d = img.data
  const ring = dilate(fill, w, 2)
  for (let p = 0, i = 0; p < w * w; p++, i += 4) {
    if (fill[p]) {
      d[i] = rgb[0]
      d[i + 1] = rgb[1]
      d[i + 2] = rgb[2]
      d[i + 3] = 255
    } else if (ring[p] && d[i + 3] > 0) {
      const a = d[i + 3] / 255
      d[i] = Math.round(d[i] * a + rgb[0] * (1 - a))
      d[i + 1] = Math.round(d[i + 1] * a + rgb[1] * (1 - a))
      d[i + 2] = Math.round(d[i + 2] * a + rgb[2] * (1 - a))
      d[i + 3] = 255
    }
  }
}

const hexRgb = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]

/**
 * 重畫一筆 kind 'fill'：讀目前畫布、flood fill、寫回去。畫布是「只有筆畫」的透明圖層（畫板的筆刷層、匯出時的圖層、小地圖）。
 * color = '#rrggbb' 上色；'clear' = 把那一塊清成透明（橡皮擦點一下色塊）。
 * 回傳 true = 有改動。
 */
export function floodFillStroke(ctx: CanvasRenderingContext2D, s: ColoringStroke): boolean {
  const c = ctx.canvas
  const w = c.width
  if (!s.points.length || w < 4 || c.height !== w) return false
  const clear = s.color === FILL_CLEAR
  if (!clear && !HEX.test(s.color)) return false
  const sx = Math.min(w - 1, Math.max(0, Math.round(toUnit(s.points[0][0]) * w)))
  const sy = Math.min(w - 1, Math.max(0, Math.round(toUnit(s.points[0][1]) * w)))
  const img = ctx.getImageData(0, 0, w, w)
  const d = img.data
  const si = (sy * w + sx) * 4
  const rgb = clear ? ([0, 0, 0] as [number, number, number]) : hexRgb(s.color)
  if (clear) {
    if (d[si + 3] <= FLOOD_TOL) return false // 點在空白：沒有東西可清
  } else if (d[si + 3] >= 250 && Math.abs(d[si] - rgb[0]) <= 2 && Math.abs(d[si + 1] - rgb[1]) <= 2 && Math.abs(d[si + 2] - rgb[2]) <= 2) return false // 已經是這個顏色
  const r = computeFill(d, w, sx, sy)
  if (!r) return false
  if (clear) {
    for (let p = 0, i = 0; p < w * w; p++, i += 4) if (r.fill[p]) d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0
  } else paint(img, w, r.fill, rgb)
  ctx.putImageData(img, 0, 0)
  return true
}
