/**
 * 空白畫紙的背景（v7）：全部用 canvas 畫，不需要素材。畫板顯示與匯出完成圖共用 drawBackground。
 * 座標：整個畫布 = 0–1，所以任何解析度畫出來都一樣；星星、花朵的位置用固定公式，不用亂數。
 */
import { parseBg } from '../../domain/coloring'

const hash = (i: number, j = 0) => {
  let h = Math.imul(i + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(j + 0x7f4a7c15, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h ^= h >>> 12
  return ((h >>> 0) % 100000) / 100000
}

function gradient(ctx: CanvasRenderingContext2D, s: number, y0: number, y1: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(0, y0 * s, 0, y1 * s)
  for (const [o, c] of stops) g.addColorStop(o, c)
  ctx.fillStyle = g
  ctx.fillRect(0, y0 * s, s, (y1 - y0) * s)
}

function cloud(ctx: CanvasRenderingContext2D, s: number, x: number, y: number, w: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.beginPath()
  ctx.ellipse(x * s, y * s, w * s * 0.5, w * s * 0.2, 0, 0, Math.PI * 2)
  ctx.ellipse((x - w * 0.22) * s, (y - w * 0.1) * s, w * s * 0.26, w * s * 0.2, 0, 0, Math.PI * 2)
  ctx.ellipse((x + w * 0.14) * s, (y - w * 0.14) * s, w * s * 0.3, w * s * 0.24, 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawMeadow(ctx: CanvasRenderingContext2D, s: number) {
  gradient(ctx, s, 0, 0.7, [[0, '#8fd3ff'], [1, '#e6f7ff']])
  ctx.fillStyle = '#ffe27a'
  ctx.beginPath()
  ctx.arc(0.82 * s, 0.16 * s, 0.075 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,226,122,0.35)'
  ctx.beginPath()
  ctx.arc(0.82 * s, 0.16 * s, 0.11 * s, 0, Math.PI * 2)
  ctx.fill()
  cloud(ctx, s, 0.22, 0.17, 0.26)
  cloud(ctx, s, 0.58, 0.28, 0.2)
  // 遠山與草地
  ctx.fillStyle = '#b8e08a'
  ctx.beginPath()
  ctx.moveTo(0, 0.66 * s)
  ctx.bezierCurveTo(0.2 * s, 0.5 * s, 0.4 * s, 0.56 * s, 0.55 * s, 0.62 * s)
  ctx.bezierCurveTo(0.72 * s, 0.52 * s, 0.9 * s, 0.56 * s, s, 0.62 * s)
  ctx.lineTo(s, s)
  ctx.lineTo(0, s)
  ctx.fill()
  gradient(ctx, s, 0.66, 1, [[0, '#8fd05a'], [1, '#6bb83e']])
  for (let i = 0; i < 18; i++) {
    const x = 0.04 + hash(i, 1) * 0.92
    const y = 0.72 + hash(i, 2) * 0.25
    ctx.fillStyle = ['#ffffff', '#ffd0e8', '#fff2a0', '#ffb3b3'][i % 4]
    ctx.beginPath()
    ctx.arc(x * s, y * s, 0.009 * s, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawSea(ctx: CanvasRenderingContext2D, s: number) {
  gradient(ctx, s, 0, 1, [[0, '#7fd8f0'], [0.55, '#3aa3d6'], [1, '#1f5fa8']])
  // 光線
  ctx.fillStyle = 'rgba(255,255,255,0.1)'
  for (let i = 0; i < 4; i++) {
    const x = 0.1 + i * 0.24
    ctx.beginPath()
    ctx.moveTo((x - 0.04) * s, 0)
    ctx.lineTo((x + 0.05) * s, 0)
    ctx.lineTo((x + 0.2) * s, 0.8 * s)
    ctx.lineTo((x + 0.06) * s, 0.8 * s)
    ctx.fill()
  }
  // 沙地
  ctx.fillStyle = '#f2dca0'
  ctx.beginPath()
  ctx.moveTo(0, 0.9 * s)
  ctx.bezierCurveTo(0.3 * s, 0.84 * s, 0.6 * s, 0.95 * s, s, 0.88 * s)
  ctx.lineTo(s, s)
  ctx.lineTo(0, s)
  ctx.fill()
  // 海草
  ctx.strokeStyle = '#3fae6a'
  ctx.lineCap = 'round'
  ctx.lineWidth = 0.012 * s
  for (let i = 0; i < 7; i++) {
    const x = 0.06 + i * 0.15 + hash(i, 4) * 0.04
    const h = 0.1 + hash(i, 5) * 0.12
    ctx.beginPath()
    ctx.moveTo(x * s, 0.93 * s)
    ctx.bezierCurveTo((x - 0.03) * s, (0.93 - h * 0.5) * s, (x + 0.03) * s, (0.93 - h * 0.8) * s, x * s, (0.93 - h) * s)
    ctx.stroke()
  }
  // 泡泡
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = 0.004 * s
  for (let i = 0; i < 14; i++) {
    const x = 0.05 + hash(i, 6) * 0.9
    const y = 0.08 + hash(i, 7) * 0.75
    ctx.beginPath()
    ctx.arc(x * s, y * s, (0.008 + hash(i, 8) * 0.02) * s, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function drawNight(ctx: CanvasRenderingContext2D, s: number) {
  gradient(ctx, s, 0, 1, [[0, '#161a4a'], [0.6, '#2f3584'], [1, '#5a4fa0']])
  for (let i = 0; i < 46; i++) {
    const x = hash(i, 11)
    const y = hash(i, 12) * 0.75
    const r = 0.002 + hash(i, 13) * 0.004
    ctx.fillStyle = i % 5 === 0 ? '#ffe9a0' : '#ffffff'
    ctx.globalAlpha = 0.5 + hash(i, 14) * 0.5
    ctx.beginPath()
    ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  // 月亮
  ctx.fillStyle = '#fff3c0'
  ctx.beginPath()
  ctx.arc(0.78 * s, 0.2 * s, 0.09 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2a3080'
  ctx.beginPath()
  ctx.arc(0.815 * s, 0.185 * s, 0.08 * s, 0, Math.PI * 2)
  ctx.fill()
  // 剪影山丘
  ctx.fillStyle = '#1a1c52'
  ctx.beginPath()
  ctx.moveTo(0, 0.86 * s)
  ctx.bezierCurveTo(0.18 * s, 0.74 * s, 0.34 * s, 0.82 * s, 0.5 * s, 0.84 * s)
  ctx.bezierCurveTo(0.7 * s, 0.76 * s, 0.86 * s, 0.82 * s, s, 0.78 * s)
  ctx.lineTo(s, s)
  ctx.lineTo(0, s)
  ctx.fill()
}

function drawGrid(ctx: CanvasRenderingContext2D, s: number, base: string) {
  ctx.fillStyle = base
  ctx.fillRect(0, 0, s, s)
  const step = s / 20
  ctx.strokeStyle = 'rgba(80,130,200,0.28)'
  ctx.lineWidth = Math.max(1, s / 520)
  ctx.beginPath()
  for (let i = 1; i < 20; i++) {
    ctx.moveTo(i * step, 0)
    ctx.lineTo(i * step, s)
    ctx.moveTo(0, i * step)
    ctx.lineTo(s, i * step)
  }
  ctx.stroke()
}

/** 把背景畫滿 s × s 的畫布 */
export function drawBackground(ctx: CanvasRenderingContext2D, bg: string | undefined, s: number): void {
  const spec = parseBg(bg)
  ctx.save()
  ctx.globalAlpha = 1
  if (spec.type === 'solid') {
    ctx.fillStyle = spec.color
    ctx.fillRect(0, 0, s, s)
  } else if (spec.type === 'grid') drawGrid(ctx, s, spec.color)
  else
    switch (spec.scene) {
      case 'meadow':
        drawMeadow(ctx, s)
        break
      case 'sea':
        drawSea(ctx, s)
        break
      case 'night':
        drawNight(ctx, s)
        break
      case 'grid':
        drawGrid(ctx, s, '#ffffff')
        break
      default:
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, s, s)
    }
  ctx.restore()
}
