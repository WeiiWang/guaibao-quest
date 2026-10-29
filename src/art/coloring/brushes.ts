/**
 * 筆刷（v7）：PaintBoard 的即時預覽、存檔後重畫、匯出完成圖共用同一個 drawStroke，畫面與存檔一定一致。
 *
 * 規則：
 * - 所有隨機都來自 stroke.id（字串雜湊）加上「第幾個取樣點」，不用 Math.random，也不依賴呼叫順序，
 *   所以同一筆畫幾次、在哪個解析度畫，圖樣都一樣。
 * - 座標是著色頁座標空間（0–400，viewBox 多留 8 的邊）；px 是目標畫布的邊長（像素）。
 * - 取樣沿著折線的「累積弧長」每隔固定距離放一個點，與滑鼠事件分了幾段無關。
 */
import type { BrushKind, ColoringStroke } from '../../domain/types'
import { floodFillStroke } from './flood'
import { toUnit, VIEWBOX } from './render'

export type { BrushKind }

export const BRUSH_KINDS: { kind: BrushKind; label: string }[] = [
  { kind: 'pen', label: '鉛筆' },
  { kind: 'crayon', label: '蠟筆' },
  { kind: 'marker', label: '麥克筆' },
  { kind: 'glitter', label: '亮粉' },
  { kind: 'rainbow', label: '彩虹' },
  { kind: 'neon', label: '霓虹' },
  { kind: 'stamp', label: '印章' },
]
export const STAMPS: { key: string; label: string }[] = [
  { key: 'star', label: '星星' },
  { key: 'heart', label: '愛心' },
  { key: 'banana', label: '香蕉' },
  { key: 'flower', label: '花' },
  { key: 'paw', label: '腳印' },
]
export const DEFAULT_STAMP = 'star'

export const kindOf = (s: Pick<ColoringStroke, 'kind'>): BrushKind => s.kind ?? 'pen'

// ---------- 決定性亂數 ----------
/** 字串 → 32 位元種子（FNV-1a） */
export function seedOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
/** (種子, a, b) → [0,1)：純函式，不帶狀態 */
export function hash01(seed: number, a: number, b = 0): number {
  let h = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// ---------- 取樣 ----------
interface Sample {
  x: number
  y: number
  /** 第幾個取樣點 */
  i: number
  /** 到這個點為止的累積弧長（座標空間單位） */
  t: number
}
/** 沿折線每隔 spacing 取一個點；第一個點一定取。與點是怎麼分段進來的無關。 */
export function sampleAlong(points: readonly [number, number][], spacing: number): Sample[] {
  const out: Sample[] = []
  if (!points.length) return out
  out.push({ x: points[0][0], y: points[0][1], i: 0, t: 0 })
  let acc = 0 // 已走的弧長
  let next = spacing // 下一個取樣的弧長位置
  for (let k = 1; k < points.length; k++) {
    const [ax, ay] = points[k - 1]
    const [bx, by] = points[k]
    const len = Math.hypot(bx - ax, by - ay)
    if (len === 0) continue
    while (next <= acc + len) {
      const f = (next - acc) / len
      out.push({ x: ax + (bx - ax) * f, y: ay + (by - ay) * f, i: out.length, t: next })
      next += spacing
    }
    acc += len
  }
  return out
}

// ---------- 小工具 ----------
interface Ctx2 {
  ctx: CanvasRenderingContext2D
  /** 座標空間單位 → 像素 */
  k: number
  /** 座標空間 → 畫布 x / y */
  X: (v: number) => number
  Y: (v: number) => number
}
const makeCtx2 = (ctx: CanvasRenderingContext2D, px: number): Ctx2 => {
  const f = (v: number) => toUnit(v) * px
  return { ctx, k: px / VIEWBOX.size, X: f, Y: f }
}

/** 路徑：相鄰點的中點當端點、原本的點當控制點（quadratic），折線的稜角會變圓滑 */
function pathOf(c: Ctx2, points: readonly [number, number][]) {
  const { ctx } = c
  const n = points.length
  ctx.beginPath()
  ctx.moveTo(c.X(points[0][0]), c.Y(points[0][1]))
  if (n === 1) return
  for (let i = 1; i < n - 1; i++) {
    const [x, y] = points[i]
    const mx = (x + points[i + 1][0]) / 2
    const my = (y + points[i + 1][1]) / 2
    ctx.quadraticCurveTo(c.X(x), c.Y(y), c.X(mx), c.Y(my))
  }
  ctx.lineTo(c.X(points[n - 1][0]), c.Y(points[n - 1][1]))
}

function dot(c: Ctx2, x: number, y: number, r: number) {
  c.ctx.beginPath()
  c.ctx.arc(c.X(x), c.Y(y), Math.max(0.2, r * c.k), 0, Math.PI * 2)
  c.ctx.fill()
}

/** 通用：整條畫成一個 path（鉛筆、麥克筆、霓虹的各層用）；單點畫成圓 */
function strokePath(c: Ctx2, points: readonly [number, number][], width: number, cap: CanvasLineCap = 'round') {
  const { ctx } = c
  ctx.lineWidth = width * c.k
  ctx.lineCap = cap
  ctx.lineJoin = 'round'
  if (points.length === 1) {
    if (cap === 'square') {
      const [x, y] = points[0]
      const h = (width * c.k) / 2
      ctx.fillRect(c.X(x) - h, c.Y(y) - h, h * 2, h * 2)
    } else dot(c, points[0][0], points[0][1], width / 2)
    return
  }
  pathOf(c, points)
  ctx.stroke()
}

// ---------- 各種筆刷 ----------
function drawPen(c: Ctx2, s: ColoringStroke) {
  c.ctx.strokeStyle = s.color
  c.ctx.fillStyle = s.color
  strokePath(c, s.points, s.width)
}

/** 局部橡皮擦：把筆刷層上經過的地方擦成透明（呼叫端要確保 ctx 是「只有筆刷」的圖層） */
function drawErase(c: Ctx2, s: ColoringStroke) {
  const { ctx } = c
  ctx.globalCompositeOperation = 'destination-out'
  ctx.strokeStyle = '#000'
  ctx.fillStyle = '#000'
  strokePath(c, s.points, s.width)
}

function drawMarker(c: Ctx2, s: ColoringStroke) {
  const { ctx } = c
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.globalAlpha = 0.5 // 同一筆自己重疊不會變深（一個 path 一次畫完），不同筆重疊才變深
  strokePath(c, s.points, s.width * 1.15, 'square')
}

function drawCrayon(c: Ctx2, s: ColoringStroke) {
  const { ctx } = c
  const seed = seedOf(s.id)
  const r = Math.max(1.8, s.width / 2)
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  // 底：半透明的一整條（蠟筆在紙上不會 100% 蓋滿）
  ctx.globalAlpha = 0.5
  strokePath(c, s.points, s.width * 0.86)
  // 顆粒：沿路徑撒小點，大小與透明度各自抖動，邊緣比較稀疏
  const per = Math.max(10, Math.min(70, Math.round(r * r * 0.7 + 8)))
  const spacing = Math.max(1.2, r * 0.4)
  for (const p of sampleAlong(s.points, spacing)) {
    for (let j = 0; j < per; j++) {
      const ang = hash01(seed, p.i, j * 3) * Math.PI * 2
      const rad = Math.sqrt(hash01(seed, p.i, j * 3 + 1)) * r * 1.02
      const a = 0.3 + hash01(seed, p.i, j * 3 + 2) * 0.7
      if (hash01(seed, p.i * 7 + 3, j) < 0.1) continue // 紙的顆粒：偶爾留白
      ctx.globalAlpha = a
      dot(c, p.x + Math.cos(ang) * rad, p.y + Math.sin(ang) * rad, 0.55 + hash01(seed, j, p.i) * 1.1)
    }
  }
}

/** 四角星（閃點用） */
function sparkle(c: Ctx2, x: number, y: number, r: number) {
  const { ctx } = c
  const cx = c.X(x)
  const cy = c.Y(y)
  const R = r * c.k
  const q = R * 0.26
  ctx.beginPath()
  ctx.moveTo(cx, cy - R)
  ctx.lineTo(cx + q, cy - q)
  ctx.lineTo(cx + R, cy)
  ctx.lineTo(cx + q, cy + q)
  ctx.lineTo(cx, cy + R)
  ctx.lineTo(cx - q, cy + q)
  ctx.lineTo(cx - R, cy)
  ctx.lineTo(cx - q, cy - q)
  ctx.closePath()
  ctx.fill()
}

const GLITTER = ['#ffffff', '#fff6b0', '#ffe27a', '#ffd6f5', '#d8f0ff']
function drawGlitter(c: Ctx2, s: ColoringStroke) {
  const { ctx } = c
  const seed = seedOf(s.id)
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.globalAlpha = 0.88
  strokePath(c, s.points, s.width)
  const r = Math.max(2, s.width / 2)
  const spacing = Math.max(1.6, r * 0.55)
  ctx.globalAlpha = 1
  for (const p of sampleAlong(s.points, spacing)) {
    const n = 1 + (hash01(seed, p.i, 90) < 0.5 ? 1 : 0)
    for (let j = 0; j < n; j++) {
      const ang = hash01(seed, p.i, j * 4) * Math.PI * 2
      const rad = Math.sqrt(hash01(seed, p.i, j * 4 + 1)) * r * 1.05
      const size = 0.9 + hash01(seed, p.i, j * 4 + 2) * Math.max(1.8, r * 0.38)
      ctx.fillStyle = GLITTER[Math.floor(hash01(seed, p.i, j * 4 + 3) * GLITTER.length)]
      const x = p.x + Math.cos(ang) * rad
      const y = p.y + Math.sin(ang) * rad
      if (hash01(seed, p.i, j + 50) < 0.55) sparkle(c, x, y, size * 1.7)
      else dot(c, x, y, size * 0.55)
    }
  }
}

/** 彩虹：顏色依「路徑長度」轉色相 */
export const RAINBOW_PERIOD = 260 // 座標空間單位：走這麼長轉一圈色相
export const rainbowColor = (t: number) => `hsl(${Math.round(((t / RAINBOW_PERIOD) * 360) % 360)} 92% 62%)`
function drawRainbow(c: Ctx2, s: ColoringStroke) {
  const { ctx } = c
  const spacing = Math.max(1.5, s.width * 0.28)
  const sm = sampleAlong(s.points, spacing)
  ctx.lineWidth = s.width * c.k
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (sm.length === 1) {
    ctx.fillStyle = rainbowColor(0)
    dot(c, sm[0].x, sm[0].y, s.width / 2)
    return
  }
  // 取樣點之間用短線連起來，每一小段一個顏色
  for (let i = 1; i < sm.length; i++) {
    ctx.strokeStyle = rainbowColor(sm[i].t)
    ctx.beginPath()
    ctx.moveTo(c.X(sm[i - 1].x), c.Y(sm[i - 1].y))
    ctx.lineTo(c.X(sm[i].x), c.Y(sm[i].y))
    ctx.stroke()
  }
  // 最後一段到實際終點
  const last = s.points[s.points.length - 1]
  const tail = sm[sm.length - 1]
  if (tail.x !== last[0] || tail.y !== last[1]) {
    ctx.strokeStyle = rainbowColor(tail.t + spacing * 0.5)
    ctx.beginPath()
    ctx.moveTo(c.X(tail.x), c.Y(tail.y))
    ctx.lineTo(c.X(last[0]), c.Y(last[1]))
    ctx.stroke()
  }
}

/** 霓虹：外發光（幾層由寬到窄、越來越實的半透明線）+ 白色芯。不用 shadowBlur，才快又每次一樣 */
function drawNeon(c: Ctx2, s: ColoringStroke) {
  const { ctx } = c
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  const layers: [number, number][] = [
    [3.2, 0.09],
    [2.5, 0.13],
    [1.9, 0.2],
    [1.4, 0.34],
    [1.0, 0.95],
  ]
  for (const [m, a] of layers) {
    ctx.globalAlpha = a
    strokePath(c, s.points, s.width * m)
  }
  ctx.globalAlpha = 0.96
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  strokePath(c, s.points, Math.max(1.4, s.width * 0.36))
}

// ---------- 印章圖案（向量路徑，不靠字型） ----------
type StampDraw = (ctx: CanvasRenderingContext2D, r: number, color: string) => void
const STAMP_DRAW: Record<string, StampDraw> = {
  star(ctx, r, color) {
    ctx.fillStyle = color
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const rr = i % 2 === 0 ? r : r * 0.44
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
    }
    ctx.closePath()
    ctx.fill()
  },
  heart(ctx, r, color) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, r * 0.9)
    ctx.bezierCurveTo(-r * 1.25, r * 0.1, -r * 0.8, -r * 0.95, 0, -r * 0.36)
    ctx.bezierCurveTo(r * 0.8, -r * 0.95, r * 1.25, r * 0.1, 0, r * 0.9)
    ctx.closePath()
    ctx.fill()
  },
  banana(ctx, r, color) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(-r * 0.95, -r * 0.55)
    ctx.bezierCurveTo(-r * 0.7, r * 0.75, r * 0.55, r * 0.95, r * 1.0, -r * 0.1)
    ctx.bezierCurveTo(r * 0.55, r * 0.35, -r * 0.3, r * 0.3, -r * 0.62, -r * 0.62)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(80,50,20,0.65)'
    ctx.beginPath()
    ctx.arc(-r * 0.8, -r * 0.6, r * 0.14, 0, Math.PI * 2)
    ctx.fill()
  },
  flower(ctx, r, color) {
    ctx.fillStyle = color
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5 - Math.PI / 2
      ctx.beginPath()
      ctx.arc(Math.cos(a) * r * 0.56, Math.sin(a) * r * 0.56, r * 0.46, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#fff3b0'
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2)
    ctx.fill()
  },
  paw(ctx, r, color) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(0, r * 0.32, r * 0.62, r * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
    const toes: [number, number, number][] = [
      [-0.72, -0.12, 0.2],
      [-0.28, -0.56, 0.22],
      [0.28, -0.56, 0.22],
      [0.72, -0.12, 0.2],
    ]
    for (const [tx, ty, tr] of toes) {
      ctx.beginPath()
      ctx.ellipse(tx * r, ty * r, tr * r * 1.1, tr * r * 1.35, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  },
}

function drawStamp(c: Ctx2, s: ColoringStroke) {
  const { ctx } = c
  const seed = seedOf(s.id)
  const draw = STAMP_DRAW[s.stamp ?? DEFAULT_STAMP] ?? STAMP_DRAW[DEFAULT_STAMP]
  const r = Math.max(7, s.width * 0.9) // 圖案半徑（座標空間單位）
  const spacing = r * 2.3
  for (const p of sampleAlong(s.points, spacing)) {
    ctx.save()
    ctx.translate(c.X(p.x), c.Y(p.y))
    ctx.rotate(((hash01(seed, p.i, 5) - 0.5) * 40 * Math.PI) / 180)
    ctx.globalAlpha = 1
    draw(ctx, r * c.k, s.color)
    ctx.restore()
  }
}

/**
 * 畫一筆。ctx 的狀態（透明度、線寬…）呼叫前後都會還原，所以可以連續畫很多筆。
 * px：畫布邊長（像素），對應整個 viewBox（416 個座標單位）。
 */
export function drawStroke(ctx: CanvasRenderingContext2D, s: ColoringStroke, px: number): void {
  if (!s.points.length) return
  const c = makeCtx2(ctx, px)
  ctx.save()
  ctx.globalAlpha = 1
  switch (kindOf(s)) {
    case 'crayon':
      drawCrayon(c, s)
      break
    case 'marker':
      drawMarker(c, s)
      break
    case 'glitter':
      drawGlitter(c, s)
      break
    case 'rainbow':
      drawRainbow(c, s)
      break
    case 'neon':
      drawNeon(c, s)
      break
    case 'stamp':
      drawStamp(c, s)
      break
    case 'erase':
      drawErase(c, s)
      break
    case 'fill':
      floodFillStroke(ctx, s) // v7.4：填色桶（對這一筆之前的筆畫層重新 flood fill，見 flood.ts）
      break
    default:
      drawPen(c, s)
  }
  ctx.restore()
}

/** 畫一個印章圖案（筆刷盒的圖示用） */
export function drawStampShape(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, r: number, color: string): void {
  ctx.save()
  ctx.translate(x, y)
  ;(STAMP_DRAW[key] ?? STAMP_DRAW[DEFAULT_STAMP])(ctx, r, color)
  ctx.restore()
}

/** 筆刷圖示：一條 S 形的示範筆觸（座標空間 0–400 中的一小塊），用同一套 drawStroke 畫出來 */
export function previewStroke(kind: BrushKind, color: string, stamp?: string): ColoringStroke {
  const pts: [number, number][] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    pts.push([20 + t * 360, 200 + Math.sin(t * Math.PI * 2) * 70])
  }
  return { id: `preview-${kind}`, color, kind, stamp, width: kind === 'stamp' ? 30 : 46, points: pts }
}

/** 橡皮擦判斷用的有效半徑：印章要算圖案大小 */
export const strokeRadius = (s: ColoringStroke): number => (kindOf(s) === 'stamp' ? Math.max(7, s.width * 0.9) : s.width / 2)
