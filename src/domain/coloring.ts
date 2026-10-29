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
/** 粗筆上限 18（原 26 一筆就蓋掉線稿） */
export const BRUSH_WIDTHS = { s: 5, m: 11, l: 18 } as const
/** 橡皮擦寬度（座標空間單位）：比畫筆大，孩子才擦得到 */
export const ERASER_WIDTHS = { s: 14, m: 28, l: 48 } as const
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
  /** 空白畫紙的背景（parseBg 可解析的字串）；著色頁沒有 */
  bg?: string
}
export const emptyDoc = (): PaintDoc => ({ fills: {}, strokes: [], stickers: [] })

export const docOf = (p: Pick<ColoringProgress, 'fills' | 'strokes' | 'stickers' | 'bg'> | undefined): PaintDoc => {
  const d: PaintDoc = { fills: p?.fills ?? {}, strokes: p?.strokes ?? [], stickers: p?.stickers ?? [] }
  if (p?.bg) d.bg = p.bg
  return d
}

/** 兩份作品內容一樣嗎（填色、筆畫、貼紙、背景都一樣）；用來判斷完成後有沒有再動過 */
export const sameDoc = (a: Pick<ColoringProgress, 'fills' | 'strokes' | 'stickers' | 'bg'>, b: Pick<ColoringProgress, 'fills' | 'strokes' | 'stickers' | 'bg'>): boolean =>
  JSON.stringify([a.fills ?? {}, a.strokes ?? [], a.stickers ?? [], a.bg ?? '']) === JSON.stringify([b.fills ?? {}, b.strokes ?? [], b.stickers ?? [], b.bg ?? ''])

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
  Object.keys(d.fills).length === 0 && d.strokes.length === 0 && d.stickers.length === 0 && !d.bg

// ---------- 橡皮擦 ----------
/** 點 (x,y) 附近有沒有這條筆畫（半徑含筆寬的一半） */
export function strokeNear(s: ColoringStroke, x: number, y: number, extra = 6): boolean {
  // 印章筆的圖案比筆寬大（半徑約 0.9 倍筆寬，至少 7）
  const r = (s.kind === 'stamp' ? Math.max(7, s.width * 0.9) : s.width / 2) + extra
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

// ---------- 鏡像 ----------
/** 鏡像軸：座標空間（0–400）的正中間 */
export const MIRROR_X = 200
export const mirrorX = (x: number): number => 2 * MIRROR_X - x
/** 左右對稱的另一筆：獨立的 stroke（新的 id，所以筆刷的隨機圖樣也各自獨立） */
export function mirrorStroke(s: ColoringStroke, id: string): ColoringStroke {
  return { ...s, id, twin: true, points: s.points.map(([x, y]) => [mirrorX(x), y] as [number, number]) }
}

// ---------- 空白畫紙的背景 ----------
/** 背景場景。bg 字串：場景名、'#rrggbb'（填色工具換的純色）、'grid:#rrggbb'（方格紙 + 底色） */
export type BgScene = 'white' | 'meadow' | 'sea' | 'night' | 'grid'
export const BG_SCENES: { scene: BgScene; label: string }[] = [
  { scene: 'white', label: '純白' },
  { scene: 'meadow', label: '草地天空' },
  { scene: 'sea', label: '海底' },
  { scene: 'night', label: '夜空' },
  { scene: 'grid', label: '方格紙' },
]
export type BgSpec = { type: 'scene'; scene: BgScene } | { type: 'solid'; color: string } | { type: 'grid'; color: string }
/** 沒設定背景 = 純白 */
export function parseBg(bg: string | undefined): BgSpec {
  if (!bg) return { type: 'scene', scene: 'white' }
  if (HEX.test(bg)) return { type: 'solid', color: bg.toLowerCase() }
  const g = /^grid:(#[0-9a-fA-F]{6})$/.exec(bg)
  if (g) return { type: 'grid', color: g[1].toLowerCase() }
  if (BG_SCENES.some((b) => b.scene === bg)) return { type: 'scene', scene: bg as BgScene }
  return { type: 'scene', scene: 'white' }
}
/** 在畫紙上用填色工具：換背景色。方格紙會保留格線，其他場景變成純色 */
export function bgWithColor(bg: string | undefined, color: string): string {
  const cur = parseBg(bg)
  return cur.type === 'grid' || (cur.type === 'scene' && cur.scene === 'grid') ? `grid:${color}` : color
}

/** 貼紙的大小換算（座標空間單位） */
export const STICKER_BASE = 72
export const STICKER_MIN_SCALE = 0.4
export const STICKER_MAX_SCALE = 3

export const clampScale = (s: number) => Math.min(STICKER_MAX_SCALE, Math.max(STICKER_MIN_SCALE, s))
export const clampStickerPos = (v: number) => Math.min(400, Math.max(0, v))

/** 新貼紙的位置：從畫面中央開始，一圈一圈往外找第一個「離既有貼紙夠遠」的位置（固定順序，不用亂數） */
export function freeStickerSpot(existing: readonly { x: number; y: number }[], gap = 70): [number, number] {
  const cands: [number, number][] = [[200, 200]]
  for (const r of [100, 170]) for (let i = 0; i < 8; i++) cands.push([200 + Math.round(r * Math.cos((i * Math.PI) / 4 - Math.PI / 2)), 200 + Math.round(r * Math.sin((i * Math.PI) / 4 - Math.PI / 2))])
  const ok = (c: [number, number]) => existing.every((e) => Math.hypot(e.x - c[0], e.y - c[1]) >= gap)
  const hit = cands.find(ok)
  if (hit) return hit
  // 滿了：挑離最近貼紙最遠的位置
  const far = (c: [number, number]) => Math.min(...existing.map((e) => Math.hypot(e.x - c[0], e.y - c[1])))
  return cands.reduce((best, c) => (far(c) > far(best) ? c : best), cands[0])
}


/** 著色頁難度星等（v7.2）：依可填色的區塊數，≤20 一顆、21–60 兩顆、>60 三顆 */
export function difficultyStars(regions: number): 1 | 2 | 3 {
  return regions <= 20 ? 1 : regions <= 60 ? 2 : 3
}
