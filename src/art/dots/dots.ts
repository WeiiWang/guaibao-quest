/**
 * 連連看（點點連線，v7.2 E1）：資料與純邏輯。
 * 點位由 design/tools/gen_dots.py 從 public/art/<name>.png 的外輪廓產生（src/art/dots/dots.json，座標 0–400）。
 * 這個檔案不 import 專案其他模組（pages.ts 會 import 它），讓單元測試與腳本可以直接載入。
 *
 * 頁面 id：`dots:<圖名>:<關卡>`，例 `dots:obj-star:e`；進度存在 coloring 表同名的列（dotsAt / dotsDone）。
 */
import data from './dots.json'

export type DotsLevel = 'e' | 'm' | 'h' | 'a'
export type Pt = [number, number]

export interface DotsItemData {
  /** 3D 圖在 0–400 座標空間的位置與大小：[x, y, w, h]，和輪廓對齊 */
  img: [number, number, number, number]
  /** 稠密外輪廓（順時針、從最上方開始），剪影用 */
  outline: Pt[]
  levels: Record<DotsLevel, Pt[]>
}

export const DOTS_IDS: readonly string[] = (data as { order: string[] }).order
const ITEMS = (data as unknown as { items: Record<string, DotsItemData> }).items

export interface DotsLevelDef {
  id: DotsLevel
  /** 孩子看得到的名稱 */
  label: string
  /** 範圍說明（給卡片、晶片用） */
  range: string
  /** 幾個點 */
  n: number
  letters: boolean
  /** 建議年齡（說明用） */
  age: string
}

export const DOTS_LEVELS: readonly DotsLevelDef[] = [
  { id: 'e', label: '簡單', range: '1–10', n: 10, letters: false, age: '4–5 歲' },
  { id: 'm', label: '中等', range: '1–20', n: 20, letters: false, age: '6 歲' },
  { id: 'h', label: '挑戰', range: '1–30', n: 30, letters: false, age: '7 歲' },
  { id: 'a', label: '字母', range: 'A–Z', n: 26, letters: true, age: '7 歲' },
]
export const dotsLevel = (l: string | undefined): DotsLevelDef | undefined => DOTS_LEVELS.find((d) => d.id === l)
export const isDotsLevel = (l: unknown): l is DotsLevel => DOTS_LEVELS.some((d) => d.id === l)

/** 圖名 → 中文名（唸給孩子聽、卡片名稱） */
export const DOTS_NAMES: Record<string, string> = {
  'obj-star': '星星',
  'obj-fish': '小魚',
  'food-banana': '香蕉',
  'obj-apple': '蘋果',
  'obj-rabbit': '小兔子',
  'obj-chick': '小雞',
  'obj-bear': '小熊',
  'obj-octopus': '章魚',
  'food-watermelon': '西瓜',
  'obj-flower': '花',
  'food-cake': '蛋糕',
  'pet-adult-happy': '阿悟',
}

/** 每種難度各免費 3 張（依列表順序），其他用星星換 */
export const DOTS_FREE_COUNT = 3
export const DOTS_PRICE = 20

export const dotsPageId = (name: string, level: DotsLevel): string => `dots:${name}:${level}`
export const isDotsPageId = (id: string | undefined): boolean => !!id && parseDotsId(id) !== null
export function parseDotsId(id: string | undefined): { name: string; level: DotsLevel } | null {
  if (!id || !id.startsWith('dots:')) return null
  const [, name, level] = id.split(':')
  if (!name || !(name in ITEMS) || !isDotsLevel(level)) return null
  return { name, level }
}
/** 商品 / 庫存 id（買了就放進 inventory） */
export const dotsItemId = (pageId: string): string => `coloring-${pageId}`
export const isDotsFree = (name: string): boolean => DOTS_IDS.indexOf(name) >= 0 && DOTS_IDS.indexOf(name) < DOTS_FREE_COUNT

export const dotsItem = (name: string): DotsItemData | undefined => ITEMS[name]
export const dotsPoints = (name: string, level: DotsLevel): Pt[] => ITEMS[name]?.levels[level] ?? []
export const dotsPageName = (name: string, level: DotsLevel): string => `連連看：${DOTS_NAMES[name] ?? name}${level === 'a' ? '（字母）' : ''}`

/** 孩子年齡檔 → 預設難度：3 歲與 4–5 歲從簡單開始，6–7 歲從中等開始 */
export const defaultDotsLevel = (ageBand: string | undefined): DotsLevel => (ageBand === '6-7' ? 'm' : 'e')

/** 第 i 個點（0 起算）的標籤：數字 1…N，或字母 A…Z */
export const dotLabel = (level: DotsLevel, i: number): string => (level === 'a' ? String.fromCharCode(65 + i) : String(i + 1))

// ---------- 連線判定 ----------
export interface TapResult {
  /** 已連到第幾點（0…n） */
  at: number
  /** 這一下有沒有連上 */
  connected: boolean
  /** 連完最後一點（要自動封閉圖形） */
  closed: boolean
}
/** 點到第 i 個點：只有「下一個點」會前進；點錯不前進、不算錯 */
export function tapDot(at: number, n: number, i: number): TapResult {
  if (at >= n || i !== at) return { at, connected: false, closed: false }
  return { at: at + 1, connected: true, closed: at + 1 === n }
}

/**
 * 手指位置命中哪個點（座標 0–400，radius 同單位）。
 * 「下一個點」優先：它在範圍內就一定是它（點與點的點擊範圍重疊時不會被別的點搶走）；
 * 否則回最近的其他點（只用來讓它輕晃一下）；都不在範圍內回 null。
 */
export function hitDot(dots: readonly Pt[], p: Pt, at: number, radius: number): { index: number; next: boolean } | null {
  const d2 = (i: number) => (dots[i][0] - p[0]) ** 2 + (dots[i][1] - p[1]) ** 2
  const r2 = radius * radius
  if (at < dots.length && d2(at) <= r2) return { index: at, next: true }
  let best = -1
  for (let i = 0; i < dots.length; i++) if (d2(i) <= r2 && (best < 0 || d2(i) < d2(best))) best = i
  return best >= 0 ? { index: best, next: false } : null
}

// ---------- 幾何 ----------
export const polyLength = (pts: readonly Pt[], closed = true): number => {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  if (closed && pts.length > 2) s += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1])
  return s
}
/** 螢幕座標（y 向下）下，順時針 = 正 */
export const signedArea2 = (pts: readonly Pt[]): number => {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    s += x1 * y2 - x2 * y1
  }
  return s
}
export const isClockwise = (pts: readonly Pt[]): boolean => signedArea2(pts) > 0

const f = (v: number) => Math.round(v * 10) / 10
/** 閉合平滑曲線（通過各邊中點的二次貝茲），剪影用；點數少也不會有太尖的鋸齒 */
export function smoothClosedPath(pts: readonly Pt[]): string {
  const n = pts.length
  if (n < 3) return ''
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const m0 = mid(pts[n - 1], pts[0])
  let d = `M${f(m0[0])} ${f(m0[1])}`
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n])
    d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f(m[0])} ${f(m[1])}`
  }
  return `${d}Z`
}
export const silhouettePath = (name: string): string => smoothClosedPath(ITEMS[name]?.outline ?? [])

// ---------- 數字 / 字母標籤的位置 ----------
export interface LabelBox {
  x0: number
  x1: number
  y0: number
  y1: number
}
/** 標籤文字的大略外框（中心 c；寬 = 字數 × 0.62 個字高，高 = 1.2 個字高） */
export const labelBox = (c: Pt, text: string, font: number): LabelBox => {
  const hw = (Math.max(1, text.length) * font * 0.62) / 2
  return { x0: c[0] - hw, x1: c[0] + hw, y0: c[1] - font * 0.6, y1: c[1] + font * 0.6 }
}
const boxHit = (a: LabelBox, b: LabelBox, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad
const boxHitsCircle = (b: LabelBox, c: Pt, r: number) => {
  const dx = Math.max(b.x0 - c[0], 0, c[0] - b.x1)
  const dy = Math.max(b.y0 - c[1], 0, c[1] - b.y1)
  return dx * dx + dy * dy < r * r
}

/**
 * 每個點的標籤中心：優先放在輪廓外側，避開所有的點（含點的圓）與已放好的標籤，也不出畫面。
 * texts 是每個點的標籤文字（數字或字母）；font 與 r 用座標空間單位（0–400）。
 */
export function placeLabels(dots: readonly Pt[], texts: readonly string[], font: number, r: number): Pt[] {
  const n = dots.length
  const out: (Pt | null)[] = Array.from({ length: n }, () => null)
  const boxes: (LabelBox | null)[] = Array.from({ length: n }, () => null)
  const lo = -4
  const hi = 404
  const placeOne = (i: number) => {
    const prev = dots[(i - 1 + n) % n]
    const next = dots[(i + 1) % n]
    const tx = next[0] - prev[0]
    const ty = next[1] - prev[1]
    const tl = Math.hypot(tx, ty) || 1
    const nx = ty / tl // 順時針時 (ty, -tx) 指向外側
    const ny = -tx / tl
    let best: Pt = [dots[i][0] + nx * (r + font), dots[i][1] + ny * (r + font)]
    let bestScore = -Infinity
    for (const mult of [0.78, 1.05, 1.4, 1.8, 2.3]) {
      const dist = r + font * mult + 2
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2
        const dx = Math.cos(a)
        const dy = Math.sin(a)
        const c: Pt = [dots[i][0] + dx * dist, dots[i][1] + dy * dist]
        const box = labelBox(c, texts[i] ?? '', font)
        let score = (dx * nx + dy * ny) * 10 - mult * 14 // 偏好外側、靠近自己的點
        // 標籤要比任何別的點都更靠近自己的點，不然孩子會認錯是哪一個
        for (let j = 0; j < n; j++) if (j !== i && Math.hypot(c[0] - dots[j][0], c[1] - dots[j][1]) < dist * 1.25) score -= 120
        for (let j = 0; j < n; j++) if (boxHitsCircle(box, dots[j], r * 1.3 + 1.5)) score -= 400
        for (let j = 0; j < n; j++) {
          const o = boxes[j]
          if (j !== i && o && boxHit(box, o, 1)) score -= 400
        }
        if (box.x0 < lo || box.x1 > hi || box.y0 < lo || box.y1 > hi) score -= 600
        if (score > bestScore) {
          bestScore = score
          best = c
        }
      }
    }
    out[i] = best
    boxes[i] = labelBox(best, texts[i] ?? '', font)
  }
  for (let i = 0; i < n; i++) placeOne(i)
  // 再來回修兩輪：前面放的標籤沒看到後面的，擠到的就重放
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) placeOne(i)
  return out as Pt[]
}

// ---------- 當成著色頁用（剪影 = 一個可填色的區塊） ----------
export const DOTS_REGION_ID = 'shape'

// ---------- 新句子（會唸出來；src/learning/lines.ts 有同一份，dots.test.ts 會檢查兩邊一字不差） ----------
export const DOTS_LINES: Record<string, string | string[]> = {
  'ui.dots.start': '從數字一開始，一個一個連起來',
  'ui.dots.startAbc': '從字母 A 開始，一個一個連起來',
  'ui.dots.price': '這張要用20顆星星換喔',
  'ui.dots.opened': '換到囉，開始連吧！',
  // 阿悟連完之後說的話（順序同 DOTS_IDS，每張圖一句）
  'pet.dots.done': DOTS_IDS.map((id) => `哇，是${DOTS_NAMES[id] ?? id}！你連出來了！`),
}
