import type { ColoringProgress, ColoringSticker, ColoringStroke } from './types'

/** 24 色色盤（柔和的馬卡龍系，前 12 色沿用 v2） */
export const PALETTE_24 = [
  '#e8a6a0', '#f0c18b', '#f1dd94', '#c9dc9a', '#b5d6a0', '#8fcfb7',
  '#9cc9e0', '#a9b3e3', '#c9aee0', '#e4aecb', '#b99a7c', '#9aa3a8',
  '#e96a6a', '#f29a4a', '#f7cf3c', '#8ccf4a', '#3fae6a', '#35b6b0',
  '#4a9fe0', '#5a62d6', '#9a5fd0', '#ee6aa8', '#7a4a2e', '#3d3a3a',
] as const

export const RECENT_MAX = 6
export const UNDO_LIMIT = 20
export const BRUSH_WIDTHS = { s: 5, m: 12, l: 26 } as const
export type BrushSize = keyof typeof BRUSH_WIDTHS

/** 特殊填色：彩虹漸層、亮片閃閃、條紋、點點（後三種帶底色） */
export type SpecialKind = 'rainbow' | 'glitter' | 'stripes' | 'dots'
export const SPECIAL_KINDS: { kind: SpecialKind; label: string }[] = [
  { kind: 'rainbow', label: '彩虹' },
  { kind: 'glitter', label: '亮片' },
  { kind: 'stripes', label: '條紋' },
  { kind: 'dots', label: '點點' },
]

const HEX = /^#[0-9a-fA-F]{6}$/

/** 填色值 → 解析。純色：'#rrggbb'；特殊：'rainbow'、'glitter:#rrggbb'、'stripes:#rrggbb'、'dots:#rrggbb' */
export type FillSpec = { type: 'solid'; color: string } | { type: 'special'; kind: SpecialKind; base: string }

export function makeSpecialFill(kind: SpecialKind, base: string): string {
  return kind === 'rainbow' ? 'rainbow' : `${kind}:${base}`
}

export function parseFill(value: string | undefined): FillSpec | null {
  if (!value) return null
  if (HEX.test(value)) return { type: 'solid', color: value }
  if (value === 'rainbow') return { type: 'special', kind: 'rainbow', base: '#ffffff' }
  const m = /^(glitter|stripes|dots):(#[0-9a-fA-F]{6})$/.exec(value)
  if (m) return { type: 'special', kind: m[1] as SpecialKind, base: m[2] }
  return null
}

/** 已填區域比例 0–1（只算這張頁面實際存在的區域；壞資料忽略） */
export function completionRatio(fills: Record<string, string> | undefined, regionIds: readonly string[]): number {
  if (!regionIds.length) return 0
  let n = 0
  for (const id of regionIds) if (parseFill(fills?.[id])) n++
  return n / regionIds.length
}

export const completionPercent = (fills: Record<string, string> | undefined, regionIds: readonly string[]) =>
  Math.round(completionRatio(fills, regionIds) * 100)

// ---------- 復原（undo） ----------
/** 一份可還原的畫面快照 */
export interface PaintDoc {
  fills: Record<string, string>
  strokes: ColoringStroke[]
  stickers: ColoringSticker[]
}
export const emptyDoc = (): PaintDoc => ({ fills: {}, strokes: [], stickers: [] })

export const docOf = (p: Pick<ColoringProgress, 'fills' | 'strokes' | 'stickers'> | undefined): PaintDoc => ({
  fills: p?.fills ?? {},
  strokes: p?.strokes ?? [],
  stickers: p?.stickers ?? [],
})

/** 把「變更前」的快照推進復原堆疊，超過上限丟掉最舊的 */
export function pushUndo<T>(past: readonly T[], snapshot: T, limit = UNDO_LIMIT): T[] {
  const next = [...past, snapshot]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/** 復原一步：回傳還原後的快照與剩餘堆疊；沒有可復原的回 null */
export function popUndo<T>(past: readonly T[]): { doc: T; past: T[] } | null {
  if (!past.length) return null
  return { doc: past[past.length - 1], past: past.slice(0, -1) }
}

/** 最近用過的顏色：新的放最前面、去重、最多 RECENT_MAX 個 */
export function pushRecent(recent: readonly string[], color: string, max = RECENT_MAX): string[] {
  return [color, ...recent.filter((c) => c !== color)].slice(0, max)
}

/** 畫面是否有任何內容（用來決定「完成」是否可按） */
export const docIsEmpty = (d: PaintDoc): boolean =>
  Object.keys(d.fills).length === 0 && d.strokes.length === 0 && d.stickers.length === 0

// ---------- 橡皮擦 ----------
/** 點 (x,y) 附近有沒有這條筆畫（半徑含筆寬的一半） */
export function strokeNear(s: ColoringStroke, x: number, y: number, extra = 6): boolean {
  const r = s.width / 2 + extra
  const r2 = r * r
  const pts = s.points
  if (pts.length === 1) return (pts[0][0] - x) ** 2 + (pts[0][1] - y) ** 2 <= r2
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2))
    const px = ax + t * dx
    const py = ay + t * dy
    if ((px - x) ** 2 + (py - y) ** 2 <= r2) return true
  }
  return false
}

/** 貼紙的大小換算（座標空間單位） */
export const STICKER_BASE = 72
export const STICKER_MIN_SCALE = 0.4
export const STICKER_MAX_SCALE = 3

export const clampScale = (s: number) => Math.min(STICKER_MAX_SCALE, Math.max(STICKER_MIN_SCALE, s))
export const clampStickerPos = (v: number) => Math.min(400, Math.max(0, v))
