/** 著色頁用的封閉 path 產生器（座標空間 400×400） */
const f = (n: number) => String(Math.round(n * 10) / 10)

export const circle = (cx: number, cy: number, r: number) =>
  `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`

/** 可旋轉的橢圓（rot 單位：度） */
export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): string {
  const t = (rot * Math.PI) / 180
  const dx = rx * Math.cos(t)
  const dy = rx * Math.sin(t)
  const a = `${f(cx - dx)} ${f(cy - dy)}`
  const b = `${f(cx + dx)} ${f(cy + dy)}`
  return `M${a}A${f(rx)} ${f(ry)} ${f(rot)} 1 0 ${b}A${f(rx)} ${f(ry)} ${f(rot)} 1 0 ${a}Z`
}

export function rect(x: number, y: number, w: number, h: number, r = 0): string {
  if (r <= 0) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`
  return (
    `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}` +
    `V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}` +
    `H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}` +
    `V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`
  )
}

export const poly = (points: [number, number][]) =>
  `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`

/** 葉片：從 (x1,y1) 到 (x2,y2)，w 為寬度 */
export function leaf(x1: number, y1: number, x2: number, y2: number, w: number): string {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const nx = (-(y2 - y1) / len) * w
  const ny = ((x2 - x1) / len) * w
  return `M${f(x1)} ${f(y1)}Q${f(mx + nx)} ${f(my + ny)} ${f(x2)} ${f(y2)}Q${f(mx - nx)} ${f(my - ny)} ${f(x1)} ${f(y1)}Z`
}

/** 雲朵：由底線與五個圓弧凸起組成 */
export function cloud(x: number, y: number, w: number, h: number): string {
  const p = (px: number, py: number) => `${f(x + px * w)} ${f(y + py * h)}`
  const arc = (r: number, px: number, py: number) => `A${f(r * w)} ${f(r * w)} 0 0 1 ${p(px, py)}`
  return (
    `M${p(0.12, 1)}${arc(0.2, 0.1, 0.55)}${arc(0.2, 0.36, 0.2)}${arc(0.2, 0.68, 0.2)}` +
    `${arc(0.2, 0.93, 0.6)}${arc(0.18, 0.88, 1)}Z`
  )
}

export function star(cx: number, cy: number, R: number, r: number): string {
  const pts: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 === 0 ? R : r
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)])
  }
  return poly(pts)
}

/** 彩虹色帶（半圓環） */
export function band(cx: number, cy: number, r: number, w: number): string {
  return (
    `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + r)} ${f(cy)}H${f(cx + r - w)}` +
    `A${f(r - w)} ${f(r - w)} 0 0 0 ${f(cx - r + w)} ${f(cy)}Z`
  )
}

/** 太陽光芒（三角形） */
export function ray(cx: number, cy: number, r1: number, r2: number, deg: number, half = 9): string {
  const pt = (rad: number, d: number): [number, number] => {
    const a = (d * Math.PI) / 180
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]
  }
  return poly([pt(r1, deg - half), pt(r2, deg), pt(r1, deg + half)])
}

/** 從 (x1,y1) 到 (x2,y2) 的直條（旋轉長方形），w 為寬度 */
export function bar(x1: number, y1: number, x2: number, y2: number, w: number): string {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const nx = (-(y2 - y1) / len) * (w / 2)
  const ny = ((x2 - x1) / len) * (w / 2)
  return poly([
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
  ])
}

/** 直條上的一段（t0–t1 為 0–1 的位置），可以比整條更寬，用來畫金箍棒的環 */
export function barAt(x1: number, y1: number, x2: number, y2: number, t0: number, t1: number, w: number): string {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  return bar(lerp(x1, x2, t0), lerp(y1, y2, t0), lerp(x1, x2, t1), lerp(y1, y2, t1), w)
}

/** 火焰：底邊中心 (x,y)、半寬 w、高 h */
export function flame(x: number, y: number, w: number, h: number): string {
  return (
    `M${f(x - w)} ${f(y)}Q${f(x - w)} ${f(y - h * 0.4)} ${f(x - w * 0.25)} ${f(y - h * 0.62)}` +
    `Q${f(x - w * 0.1)} ${f(y - h * 0.82)} ${f(x + w * 0.1)} ${f(y - h)}` +
    `Q${f(x + w)} ${f(y - h * 0.55)} ${f(x + w)} ${f(y)}Z`
  )
}

/** 水滴 / 桃子形：頂點在上，圓肚在下 */
export function drop(cx: number, cy: number, r: number): string {
  return (
    `M${f(cx)} ${f(cy - r * 1.5)}Q${f(cx + r * 0.2)} ${f(cy - r * 0.7)} ${f(cx + r)} ${f(cy)}` +
    `A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}Q${f(cx - r * 0.2)} ${f(cy - r * 0.7)} ${f(cx)} ${f(cy - r * 1.5)}Z`
  )
}
