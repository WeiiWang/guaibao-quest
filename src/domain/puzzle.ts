// v8.4 拼圖屋的規則（純函式）：片數依年齡、固定的洗牌、桌面排版、吸附距離、什麼時候說話。
import type { AgeBand } from './types'

/** 每個年齡檔可以選的片數（第一個是預設） */
export const PUZZLE_SIZES: Record<AgeBand, readonly number[]> = {
  '3': [4],
  '4-5': [6, 9],
  '6-7': [9, 16],
}

/** 片數 → 幾欄幾列。每片都是正方形，底板的長寬比跟著格子走（6 片是 3×2 的橫長方形），圖先裁成這個比例 */
export function gridOf(pieces: number): { cols: number; rows: number } {
  if (pieces === 6) return { cols: 3, rows: 2 }
  const g = Math.max(1, Math.round(Math.sqrt(pieces)))
  return { cols: g, rows: g }
}

/** 固定的場景圖（public/art/*.jpg），接在孩子自己的作品後面 */
export const PUZZLE_SCENES = [
  'scene-play-garden',
  'scene-place-playground',
  'scene-play-bakery',
  'scene-stage-nature',
  'scene-play-sky',
  'scene-place-shop',
  'scene-stage-shuiliandong',
  'scene-play-orchard',
] as const

/** 字串雜湊（FNV-1a），給固定洗牌用 */
export function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 固定的洗牌：同一張圖、同一天、同樣片數一定一樣（不用 Math.random）。
 * 回傳 order[k] = 放在第 k 個桌面位置的是哪一片；保證不是原本的順序。
 */
export function shuffleOrder(n: number, seedKey: string): number[] {
  const rand = seeded(hashStr(seedKey))
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  if (n > 1 && a.every((v, i) => v === i)) a.push(a.shift()!)
  return a
}

/** 每片打散時的小歪斜（度），固定、看起來像隨手丟在桌上；拼上去就擺正 */
export const tiltOf = (piece: number, seedKey: string): number => ((hashStr(`${seedKey}#${piece}`) % 15) - 7)

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface PuzzleLayout {
  /** 底板（長寬比 = 欄:列） */
  board: Rect
  /** 一片的邊長 */
  piece: number
  /** 打散的位置（左上角），至少 n 個；位置不夠時後面的會疊在前面的上面 */
  spots: { x: number; y: number }[]
}

const GAP = 8

/** 一個區域能排幾個 piece 大小的格子（左上角） */
function pack(r: Rect, p: number): { x: number; y: number }[] {
  const cols = Math.floor((r.w + GAP) / (p + GAP))
  const rows = Math.floor((r.h + GAP) / (p + GAP))
  if (cols <= 0 || rows <= 0) return []
  // 置中、平均分配多出來的空間
  const sx = cols > 1 ? (r.w - cols * p) / (cols - 1) : 0
  const sy = rows > 1 ? (r.h - rows * p) / (rows - 1) : 0
  const ox = cols > 1 ? r.x : r.x + (r.w - p) / 2
  const oy = rows > 1 ? r.y : r.y + (r.h - p) / 2
  const out: { x: number; y: number }[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: ox + i * (p + Math.min(sx, p)), y: oy + j * (p + Math.min(sy, p)) })
  return out
}

/**
 * 桌面排版：底板在中間（橫向）或上面（直向），碎片排在旁邊空的地方，彼此不重疊、也不壓在底板上。
 * 從大的底板開始試，放不下所有碎片就縮小一點；縮到底還不夠才讓碎片疊在一起。
 */
export function puzzleLayout(w: number, h: number, n: number): PuzzleLayout {
  const { cols, rows } = gridOf(n)
  const wide = w >= h * 1.1
  // 一片的邊長上限：底板在橫向最多佔一半寬、整個高；直向佔整個寬、一半多一點的高
  const maxP = wide ? Math.min(h / rows, (w * 0.5) / cols) : Math.min(w / cols, (h * 0.55) / rows)
  const minP = maxP * 0.55
  let best: PuzzleLayout | null = null
  for (let p = maxP; p >= minP - 0.5; p -= Math.max(2, maxP * 0.03)) {
    const bw = p * cols
    const bh = p * rows
    let board: Rect
    let areas: Rect[]
    if (wide) {
      board = { x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh }
      const sideW = (w - bw) / 2 - GAP * 2
      areas = [
        { x: 0, y: 0, w: sideW, h },
        { x: w - sideW, y: 0, w: sideW, h },
      ]
    } else {
      board = { x: (w - bw) / 2, y: 0, w: bw, h: bh }
      areas = [{ x: 0, y: bh + GAP * 2, w, h: h - bh - GAP * 2 }]
    }
    const spots = areas.flatMap((a) => pack(a, p))
    best = { board, piece: p, spots }
    if (spots.length >= n) break
  }
  const out = best!
  // 位置不夠：重複使用（疊起來），桌上仍然拿得到
  const base = out.spots.length ? out.spots : [{ x: 0, y: out.board.y + out.board.h + GAP }]
  const spots = Array.from({ length: Math.max(n, base.length) }, (_, i) => {
    const s = base[i % base.length]
    const k = Math.floor(i / base.length)
    return { x: s.x + k * out.piece * 0.18, y: s.y + k * out.piece * 0.18 }
  })
  return { ...out, spots }
}

/** 第 i 片在底板上的正確位置（左上角） */
export function slotOf(board: Rect, n: number, i: number): { x: number; y: number } {
  const { cols } = gridOf(n)
  const p = board.w / cols
  return { x: board.x + (i % cols) * p, y: board.y + Math.floor(i / cols) * p }
}

/** 放開時離正確位置多近就吸過去（以一片的邊長為單位）：3 歲寬鬆一點 */
export const SNAP_RATIO: Record<AgeBand, number> = { '3': 0.55, '4-5': 0.4, '6-7': 0.32 }

export function snaps(dx: number, dy: number, piece: number, band: AgeBand): boolean {
  return Math.hypot(dx, dy) <= piece * SNAP_RATIO[band]
}

/**
 * 拼上一片要不要說「拼上去了」：每片都說太吵。第一片說，之後每 4 片說一次；最後一片不說（接著要說拼好了）。
 * placed = 這一片拼上去後一共拼好幾片。
 */
export function saySnap(placed: number, total: number): boolean {
  if (placed >= total) return false
  return placed === 1 || placed % 4 === 0
}
