import type { AgeBand } from './types'

// v8.3 洗澎澎：抹泡泡 → 沖水 → 擦乾（純函式）。寵物身上切成格子，工具抹過的格子才算數；沒有失敗、沒有倒數。

export const BATH_COLS = 12
export const BATH_ROWS = 12
export const BATH_CELLS = BATH_COLS * BATH_ROWS

export type BathStep = 'soap' | 'rinse' | 'dry' | 'done'

export interface BathTuning {
  /** 這一步要完成幾成才進下一步 */
  goal: number
  /** 工具的半徑（寵物框邊長的比例） */
  radius: number
}

/** 3 歲手還不穩：範圍小、工具大。6–7 歲要抹得更仔細。規格的「約 7 成」是 4–5 歲這一檔 */
export function bathTuning(age: AgeBand): BathTuning {
  if (age === '3') return { goal: 0.6, radius: 0.2 }
  if (age === '6-7') return { goal: 0.8, radius: 0.13 }
  return { goal: 0.7, radius: 0.17 }
}

export interface BathPoint {
  /** 寵物框裡的位置：0..1（框外也可以，只是抹不到東西） */
  x: number
  y: number
}

export const cellCenter = (i: number): BathPoint => ({
  x: ((i % BATH_COLS) + 0.5) / BATH_COLS,
  y: (Math.floor(i / BATH_COLS) + 0.5) / BATH_ROWS,
})

/** 寵物的大致輪廓：頭一個橢圓、身體一個橢圓（三個物種的圖都是大頭、站在框的下半部） */
export function onPet({ x, y }: BathPoint): boolean {
  const inEllipse = (cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
  return inEllipse(0.5, 0.36, 0.42, 0.32) || inEllipse(0.5, 0.74, 0.27, 0.25)
}

export const BATH_MASK: readonly boolean[] = Array.from({ length: BATH_CELLS }, (_, i) => onPet(cellCenter(i)))
export const BATH_MASK_COUNT = BATH_MASK.filter(Boolean).length

export interface BathState {
  step: BathStep
  /** 現在有泡泡的格子 */
  soap: boolean[]
  /** 這一回抹過泡泡的格子（畫面用它留著元素，泡泡才有被沖走的動畫；沖水的進度也用它當分母） */
  soaped: boolean[]
  /** 現在濕濕的格子 */
  wet: boolean[]
}

const empty = () => new Array<boolean>(BATH_CELLS).fill(false)
/** 水柱的長度（寵物框邊長的比例）：bath.css 的 .pg-bath-water 要跟著 */
export const RINSE_DEPTH = 0.22

export const newBath = (): BathState => ({ step: 'soap', soap: empty(), soaped: empty(), wet: empty() })

const count = (a: readonly boolean[]) => a.reduce((n, v) => n + (v ? 1 : 0), 0)

/** 這一步完成了幾成（0..1） */
export function bathProgress(s: BathState): number {
  switch (s.step) {
    case 'soap':
      return count(s.soap) / BATH_MASK_COUNT
    case 'rinse': {
      const all = count(s.soaped)
      return all === 0 ? 0 : 1 - count(s.soap) / all
    }
    case 'dry':
      return 1 - count(s.wet) / BATH_MASK_COUNT
    case 'done':
      return 1
  }
}

/**
 * 工具現在碰得到哪些格子：海綿和毛巾是一個圓；蓮蓬頭的水往下流，噴頭底下一小段沖得到。
 * 水柱不能長到整隻：不然從托盤拖過來掃一趟就沖完了，沒得玩。
 */
export function brushHit(step: BathStep, cell: BathPoint, at: BathPoint, radius: number): boolean {
  if (step === 'rinse') return Math.abs(cell.x - at.x) <= radius && cell.y >= at.y - radius * 0.5 && cell.y <= at.y + RINSE_DEPTH
  return Math.hypot(cell.x - at.x, cell.y - at.y) <= radius
}

export interface StrokeResult {
  state: BathState
  /** 這一筆改變了幾格（給音效與回饋用） */
  changed: number
  /** 這一筆讓步驟往前了 */
  advanced: boolean
}

/** 工具從 from 移到 to：沿線補點（手指移得快時事件很稀，不補會跳格） */
export function bathStroke(s: BathState, from: BathPoint, to: BathPoint, tuning: BathTuning): StrokeResult {
  if (s.step === 'done') return { state: s, changed: 0, advanced: false }
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  const n = Math.max(1, Math.ceil(dist / (tuning.radius / 2)))
  const hit = new Array<boolean>(BATH_CELLS).fill(false)
  for (let k = 0; k <= n; k++) {
    const p = { x: from.x + ((to.x - from.x) * k) / n, y: from.y + ((to.y - from.y) * k) / n }
    for (let i = 0; i < BATH_CELLS; i++) if (BATH_MASK[i] && !hit[i] && brushHit(s.step, cellCenter(i), p, tuning.radius)) hit[i] = true
  }
  let changed = 0
  let wetted = false
  const next: BathState = { ...s }
  if (s.step === 'soap') {
    next.soap = [...s.soap]
    next.soaped = [...s.soaped]
    for (let i = 0; i < BATH_CELLS; i++)
      if (hit[i] && !s.soap[i]) {
        next.soap[i] = true
        next.soaped[i] = true
        changed++
      }
  } else if (s.step === 'rinse') {
    next.soap = [...s.soap]
    next.wet = [...s.wet]
    for (let i = 0; i < BATH_CELLS; i++)
      if (hit[i]) {
        if (s.soap[i]) {
          next.soap[i] = false
          changed++
        }
        if (!s.wet[i]) {
          next.wet[i] = true
          wetted = true
        }
      }
  } else {
    next.wet = [...s.wet]
    for (let i = 0; i < BATH_CELLS; i++)
      if (hit[i] && s.wet[i]) {
        next.wet[i] = false
        changed++
      }
  }
  if (changed === 0 && !wetted) return { state: s, changed: 0, advanced: false }
  if (bathProgress(next) < tuning.goal) return { state: next, changed, advanced: false }
  // 這一步夠了：剩下的一次清掉，進下一步
  if (s.step === 'soap') return { state: { ...next, step: 'rinse' }, changed, advanced: true }
  if (s.step === 'rinse') return { state: { ...next, step: 'dry', soap: empty(), wet: [...BATH_MASK] }, changed, advanced: true }
  return { state: { ...next, step: 'done', wet: empty() }, changed, advanced: true }
}

// ---------- v8.5 新玩具：沐浴球、泡泡造型 ----------

/**
 * 沐浴球的顏色：同一張圖轉色相（圖本身是粉紅色，色相約 330°），泡泡和水用對應的顏色（bath.css）。
 * 挑粉紅、橘、綠：原本的泡泡是淡紫、水是藍的，這三個顏色一丟進去就看得出來變了。
 */
export const BATH_BOMBS = [
  { id: 'pink', hue: 0, label: '粉紅色' },
  { id: 'orange', hue: 60, label: '橘色' },
  { id: 'green', hue: 150, label: '綠色' },
] as const
export type BathBombId = (typeof BATH_BOMBS)[number]['id']

/**
 * 沐浴球放開的地方算不算丟進去了：寵物洗澡的那一塊，四周多留一點（3 歲丟不準）。
 * 位置用寵物框的比例（跟 BathPoint 一樣）。
 */
export function bombInBath({ x, y }: BathPoint): boolean {
  return x >= -0.2 && x <= 1.2 && y >= -0.15 && y <= 1.2
}

/** 泡泡造型：抹滿後頭上先是一坨圓圓的泡泡，點了輪流變尖尖頭、兔耳朵、皇冠 */
export const FOAM_HATS = ['spike', 'bunny', 'crown'] as const
export type FoamHat = 'puff' | (typeof FOAM_HATS)[number]

/** 點一下換下一個造型（圓圓的只有一開始有，之後三種輪流） */
export function nextFoamHat(hat: FoamHat): FoamHat {
  return FOAM_HATS[(FOAM_HATS.indexOf(hat as (typeof FOAM_HATS)[number]) + 1) % FOAM_HATS.length]
}

/** 頭上那坨泡泡的位置（寵物框的比例）：頭頂正中間 */
export const FOAM_HAT_SPOT: BathPoint = { x: 0.5, y: 0.08 }

/** 蓮蓬頭這一筆有沒有沖到頭上的泡泡造型（沖到就沒了）。跟沖身上的泡泡用同一個水柱範圍 */
export function rinseHitsHat(from: BathPoint, to: BathPoint, tuning: BathTuning): boolean {
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  const n = Math.max(1, Math.ceil(dist / (tuning.radius / 2)))
  for (let k = 0; k <= n; k++) {
    const p = { x: from.x + ((to.x - from.x) * k) / n, y: from.y + ((to.y - from.y) * k) / n }
    if (brushHit('rinse', FOAM_HAT_SPOT, p, tuning.radius)) return true
  }
  return false
}
