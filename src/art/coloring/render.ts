import { parseFill } from '../../domain/coloring'
import type { ColoringSticker, ColoringStroke } from '../../domain/types'
import { getColoringPage } from './pages'

/** 著色頁座標空間：內容在 0–400，viewBox 多留 8 的邊 */
export const VIEWBOX = { x: -8, y: -8, size: 416 }
export const LINE_COLOR = '#2b2420'

const idSafe = (hex: string) => hex.slice(1).toLowerCase()

/** 某個填色值在 SVG 裡要用的 fill 屬性值 */
export function fillAttr(value: string | undefined): string {
  const spec = parseFill(value)
  if (!spec) return '#ffffff'
  if (spec.type === 'solid') return spec.color
  if (spec.kind === 'rainbow') return 'url(#gq-rainbow)'
  return `url(#gq-${spec.kind}-${idSafe(spec.base)})`
}

const RAINBOW =
  `<linearGradient id="gq-rainbow" x1="0" y1="0" x2="1" y2="1">` +
  `<stop offset="0" stop-color="#ff7a7a"/><stop offset=".2" stop-color="#ffb347"/><stop offset=".4" stop-color="#ffe45c"/>` +
  `<stop offset=".6" stop-color="#7fdc8a"/><stop offset=".8" stop-color="#6fb7ff"/><stop offset="1" stop-color="#b58cff"/></linearGradient>`

function patternMarkup(kind: 'glitter' | 'stripes' | 'dots', base: string): string {
  const id = `gq-${kind}-${idSafe(base)}`
  if (kind === 'stripes') {
    return (
      `<pattern id="${id}" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<rect width="18" height="18" fill="${base}"/><rect width="9" height="18" fill="#fff" opacity=".6"/></pattern>`
    )
  }
  if (kind === 'dots') {
    return (
      `<pattern id="${id}" width="20" height="20" patternUnits="userSpaceOnUse">` +
      `<rect width="20" height="20" fill="${base}"/><circle cx="5" cy="5" r="3.4" fill="#fff" opacity=".85"/>` +
      `<circle cx="15" cy="15" r="3.4" fill="#fff" opacity=".85"/></pattern>`
    )
  }
  const spark = (x: number, y: number, r: number, c: string) =>
    `<path d="M${x} ${y - r}L${x + r * 0.28} ${y - r * 0.28}L${x + r} ${y}L${x + r * 0.28} ${y + r * 0.28}L${x} ${y + r}L${x - r * 0.28} ${y + r * 0.28}L${x - r} ${y}L${x - r * 0.28} ${y - r * 0.28}Z" fill="${c}"/>`
  return (
    `<pattern id="${id}" width="30" height="30" patternUnits="userSpaceOnUse"><rect width="30" height="30" fill="${base}"/>` +
    spark(7, 8, 5, '#fff') + spark(22, 20, 4, '#fff6b0') + spark(24, 5, 2.4, '#fff') + spark(9, 24, 2.6, '#fffbd0') +
    `<circle cx="16" cy="14" r="1.2" fill="#fff"/></pattern>`
  )
}

/** 這份填色資料用到的漸層 / 圖樣定義（只輸出用到的）。內容全由程式產生，顏色已驗證格式。 */
export function defsMarkup(fills: Record<string, string>): string {
  const seen = new Set<string>()
  let out = ''
  for (const v of Object.values(fills)) {
    const spec = parseFill(v)
    if (!spec || spec.type !== 'special') continue
    const key = spec.kind === 'rainbow' ? 'rainbow' : `${spec.kind}:${spec.base.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out += spec.kind === 'rainbow' ? RAINBOW : patternMarkup(spec.kind, spec.base.toLowerCase())
  }
  return out
}

/** 完整的 SVG 字串（匯出完成圖用；線稿 + 填色，不含筆刷與貼紙） */
export function coloringSvgString(pageId: string, fills: Record<string, string>): string | null {
  const page = getColoringPage(pageId)
  if (!page) return null
  const body =
    page.regions.map((r) => `<path d="${r.d}" fill="${fillAttr(fills[r.id])}"/>`).join('') +
    page.lines.map((d) => `<path d="${d}" fill="none"/>`).join('') +
    page.dots.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${LINE_COLOR}" stroke="none"/>`).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.size} ${VIEWBOX.size}" width="${VIEWBOX.size}" height="${VIEWBOX.size}">` +
    `<defs>${defsMarkup(fills)}</defs><rect x="${VIEWBOX.x}" y="${VIEWBOX.y}" width="${VIEWBOX.size}" height="${VIEWBOX.size}" fill="#fff"/>` +
    `<g stroke="${LINE_COLOR}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`
  )
}

/** 座標空間 (0–400) → 0–1 比例（相對整張 viewBox） */
export const toUnit = (v: number) => (v - VIEWBOX.x) / VIEWBOX.size
export const fromUnit = (u: number) => u * VIEWBOX.size + VIEWBOX.x

export interface ExportInput {
  pageId: string
  fills: Record<string, string>
  strokes: ColoringStroke[]
  stickers: ColoringSticker[]
}
