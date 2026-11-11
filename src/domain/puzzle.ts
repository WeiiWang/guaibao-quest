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

/** 圖要裁哪一塊：中心點（佔原圖的比例）與放大倍數。沒給就是從正中間裁最大的一塊 */
export interface PuzzleFocus {
  cx: number
  cy: number
  zoom: number
}
export interface PuzzleScene {
  id: string
  focus?: PuzzleFocus
}

/**
 * v8.5 新玩具「新圖片」：6 張故事圖（public/art/*.jpg）。
 * 故事圖是 16:9、下半邊留給角色站（一大片草地或沙灘），整張拿來拼的話下面幾片都長得一樣；
 * 所以每張都指定裁主體那一塊（切成小片也認得出來）。
 */
export const PUZZLE_EXTRA: readonly PuzzleScene[] = [
  { id: 'story-nature-close-1', focus: { cx: 0.5, cy: 0.36, zoom: 1.25 } },
  { id: 'story-life-close-1', focus: { cx: 0.6, cy: 0.4, zoom: 1.3 } },
  { id: 'story-huaguoshan-close-2', focus: { cx: 0.62, cy: 0.45, zoom: 1.2 } },
  { id: 'story-english-open-1', focus: { cx: 0.6, cy: 0.38, zoom: 1.3 } },
  { id: 'story-shuiliandong-close-2', focus: { cx: 0.5, cy: 0.42, zoom: 1.3 } },
  { id: 'story-shuiliandong-open-2', focus: { cx: 0.5, cy: 0.45, zoom: 1.25 } },
]

/** 可以選的固定圖片：沒有新玩具時跟 v8.4 一模一樣；有了之後新的 6 張排在前面（一回來就看得到） */
export function puzzleScenes(toys: number): PuzzleScene[] {
  const base = PUZZLE_SCENES.map((id) => ({ id }))
  return toys >= 1 ? [...PUZZLE_EXTRA, ...base] : base
}

/**
 * 從 iw×ih 的原圖裁出 cols:rows 的一塊。沒有 focus：正中間最大的一塊（v8.4 的裁法）；
 * 有 focus：縮小 zoom 倍、中心移到 (cx, cy)，但不會裁到圖外面。
 */
export function cropRect(iw: number, ih: number, cols: number, rows: number, focus?: PuzzleFocus): Rect {
  const want = cols / rows
  let w = iw
  let h = iw / want
  if (h > ih) {
    h = ih
    w = ih * want
  }
  if (!focus) return { x: (iw - w) / 2, y: (ih - h) / 2, w, h }
  const z = Math.max(1, focus.zoom)
  w /= z
  h /= z
  const x = Math.max(0, Math.min(iw - w, focus.cx * iw - w / 2))
  const y = Math.max(0, Math.min(ih - h, focus.cy * ih - h / 2))
  return { x, y, w, h }
}

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
export function puzzleLayout(w: number, h: number, n: number, tab = 0): PuzzleLayout {
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
    // 凹凸形狀的拼圖片會凸出去一點（tab = 凸出去的長度佔邊長的比例）：靠畫面邊緣的那幾邊多留這麼多，凸出來的部分不會被切掉
    const pd = tab * p
    if (wide) {
      board = { x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh }
      const sideW = (w - bw) / 2 - GAP * 2
      areas = [
        { x: pd, y: 0, w: sideW - pd, h: h - pd },
        { x: w - sideW, y: 0, w: sideW - pd, h: h - pd },
      ]
    } else {
      board = { x: (w - bw) / 2, y: 0, w: bw, h: bh }
      areas = [{ x: pd, y: bh + GAP * 2, w: w - pd * 2, h: h - bh - GAP * 2 - pd }]
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

// ---------- v8.5 新玩具「拼圖形狀」：有凹有凸的拼圖片 ----------

/** 4 歲以上才換成凹凸形狀；3 歲維持方塊（形狀多了他們反而認不出來是哪一片） */
export const usesJigsaw = (toys: number, band: AgeBand): boolean => toys >= 2 && band !== '3'

/** 一邊的樣子：0 = 平的（圖的外緣），1 = 凸出去，-1 = 凹進來 */
export type EdgeKind = -1 | 0 | 1
export interface JigsawEdges {
  top: EdgeKind
  right: EdgeKind
  bottom: EdgeKind
  left: EdgeKind
}

/** 凸出去多長（佔一片邊長的比例） */
export const JIGSAW_TAB = 0.22

/**
 * 第 i 片四邊的凹凸：只看它在第幾欄第幾列（不用亂數），相鄰兩片剛好一凸一凹，圖的外緣是平的。
 * 左右相鄰：(欄 + 列) 是偶數時左邊那片凸出去；上下相鄰：(欄 + 列) 是偶數時上面那片凹進來。
 */
export function jigsawEdges(i: number, cols: number, rows: number): JigsawEdges {
  const c = i % cols
  const r = Math.floor(i / cols)
  const even = (a: number, b: number) => (a + b) % 2 === 0
  /** (c, r) 那片的右邊 */
  const v = (cc: number, rr: number): EdgeKind => (even(cc, rr) ? 1 : -1)
  /** (c, r) 那片的下邊 */
  const hz = (cc: number, rr: number): EdgeKind => (even(cc, rr) ? -1 : 1)
  const neg = (k: EdgeKind): EdgeKind => (k === 1 ? -1 : k === -1 ? 1 : 0)
  return {
    top: r > 0 ? neg(hz(c, r - 1)) : 0,
    right: c < cols - 1 ? v(c, r) : 0,
    bottom: r < rows - 1 ? hz(c, r) : 0,
    left: c > 0 ? neg(v(c - 1, r)) : 0,
  }
}

/** 一個凸起的輪廓（u = 沿著邊 0–1，v = 往外），接在 (0.38, 0) 之後：細脖子、圓頭 */
const KNOB: readonly [number, number][][] = [
  [[0.45, 0], [0.43, 0.06], [0.4, 0.09]],
  [[0.34, 0.14], [0.38, JIGSAW_TAB], [0.5, JIGSAW_TAB]],
  [[0.62, JIGSAW_TAB], [0.66, 0.14], [0.6, 0.09]],
  [[0.57, 0.06], [0.55, 0], [0.62, 0]],
]

/**
 * 一片的外框（SVG path）。座標是這一片自己的：左上角 (0, 0)、邊長 p；凸出去的部分會超出 0–p 最多 JIGSAW_TAB × p。
 * 順時針畫：上邊往右、右邊往下、下邊往左、左邊往上。
 */
export function jigsawPath(e: JigsawEdges, p: number): string {
  const f = (n: number) => String(Math.round(n * 100) / 100)
  // 每一邊：起點、沿著邊的方向、往外的方向
  const sides: { k: EdgeKind; ax: number; ay: number; dx: number; dy: number; ox: number; oy: number }[] = [
    { k: e.top, ax: 0, ay: 0, dx: 1, dy: 0, ox: 0, oy: -1 },
    { k: e.right, ax: p, ay: 0, dx: 0, dy: 1, ox: 1, oy: 0 },
    { k: e.bottom, ax: p, ay: p, dx: -1, dy: 0, ox: 0, oy: 1 },
    { k: e.left, ax: 0, ay: p, dx: 0, dy: -1, ox: -1, oy: 0 },
  ]
  const out = ['M0 0']
  for (const s of sides) {
    const at = (u: number, v: number) => `${f(s.ax + s.dx * u * p + s.ox * v * s.k * p)} ${f(s.ay + s.dy * u * p + s.oy * v * s.k * p)}`
    if (s.k !== 0) {
      out.push(`L${at(0.38, 0)}`)
      for (const seg of KNOB) out.push(`C${seg.map(([u, v]) => at(u, v)).join(' ')}`)
    }
    out.push(`L${at(1, 0)}`)
  }
  return out.join('') + 'Z'
}
