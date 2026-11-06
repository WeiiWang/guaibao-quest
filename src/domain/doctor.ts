import type { AgeBand } from './types'

// v8.4 寵物醫院（純函式）。寵物帶一個小毛病來，用對的工具照順序看完就好了；沒有失敗、沒有扣分。
// 座標是寵物框（正方形）裡的比例：(0,0) 左上、(1,1) 右下。三種寵物的圖都是大頭、站在框裡，位置取大概。

export type Ailment = 'sneeze' | 'tummy' | 'knee' | 'throat'
export type DoctorTool = 'thermo' | 'stetho' | 'light' | 'bandage' | 'spoon'

/** 依日期輪替的順序 */
export const AILMENTS: readonly Ailment[] = ['sneeze', 'tummy', 'knee', 'throat']

/** 托盤上的順序（畫面也照這個排） */
export const DOCTOR_TOOLS: readonly DoctorTool[] = ['thermo', 'stetho', 'light', 'bandage', 'spoon']

/**
 * 每種毛病要用的工具（照順序）：先檢查、再處理。
 * 擦傷：量體溫看有沒有發燒 → 貼 OK 繃；喉嚨癢：手電筒照喉嚨 → 甜藥水；
 * 打噴嚏：量體溫 → 甜藥水；肚子咕嚕：聽診器聽肚子 → 甜藥水
 */
export const AILMENT_STEPS: Record<Ailment, readonly DoctorTool[]> = {
  sneeze: ['thermo', 'spoon'],
  tummy: ['stetho', 'spoon'],
  knee: ['thermo', 'bandage'],
  throat: ['light', 'spoon'],
}

export type DoctorSpot = 'head' | 'mouth' | 'chest' | 'knee'

/** 每個工具用在哪裡：體溫計量額頭、手電筒照嘴巴、湯匙餵到嘴邊、聽診器聽胸口、OK 繃貼膝蓋 */
export const TOOL_SPOT: Record<DoctorTool, DoctorSpot> = {
  thermo: 'head',
  stetho: 'chest',
  light: 'mouth',
  bandage: 'knee',
  spoon: 'mouth',
}

export const SPOT_POS: Record<DoctorSpot, { x: number; y: number }> = {
  head: { x: 0.5, y: 0.3 },
  mouth: { x: 0.5, y: 0.5 },
  chest: { x: 0.5, y: 0.69 },
  knee: { x: 0.41, y: 0.87 },
}

/** 每個工具用完寵物說的話（照順序用對時才說；3–5 歲用了別的工具也會說，只是不算看完一步） */
export const TOOL_LINE: Record<DoctorTool, string> = {
  thermo: 'pet.play.doctor.thermo',
  stetho: 'pet.play.doctor.heart',
  light: 'pet.play.doctor.ahh',
  bandage: 'pet.play.doctor.bandage',
  spoon: 'pet.play.doctor.medicine',
}

/** 檢查用的工具沒有「治好」的意思，用錯也可以說它的台詞；OK 繃和藥水只在該用的時候說（不然「不痛了」「好好喝」對不上） */
export const isExamTool = (t: DoctorTool): boolean => t === 'thermo' || t === 'stetho' || t === 'light'

/** 從 1970-01-01 起算的第幾天（本地日期字串 YYYY-MM-DD）：跨月也是連續的，輪替不會跳 */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000)
}

/** 這一天第 round 次看病（從 0 算）是哪個毛病：每天換起點，同一天再看一次換下一個 */
export function ailmentFor(date: string, round: number): Ailment {
  const n = AILMENTS.length
  return AILMENTS[(((dayNumber(date) + round) % n) + n) % n]
}

/**
 * 該用的工具過多久發亮（毫秒）；null = 不發亮。
 * 3 歲一開始就亮；4–5 歲先讓孩子聽症狀想一想；6–7 歲自己選
 */
export function glowDelay(band: AgeBand): number | null {
  if (band === '3') return 0
  if (band === '4-5') return 4000
  return null
}

export interface Visit {
  ailment: Ailment
  /** 看到第幾步（= AILMENT_STEPS[ailment] 的索引） */
  step: number
  /** OK 繃貼上了：留在身上 */
  bandaged: boolean
}

export const newVisit = (ailment: Ailment): Visit => ({ ailment, step: 0, bandaged: false })

export const visitDone = (v: Visit): boolean => v.step >= AILMENT_STEPS[v.ailment].length

/** 現在該用哪個工具（看完了就沒有） */
export const expectedTool = (v: Visit): DoctorTool | null => AILMENT_STEPS[v.ailment][v.step] ?? null

/**
 * - step：用對了，往下一步
 * - done：用對了，而且看完了
 * - play：不是這一步的工具，寵物照樣有反應（3–5 歲；看完之後也是）
 * - wrong：6–7 歲選錯，寵物說「好癢喔，不是這裡啦」，沒有扣分
 */
export type ToolOutcome = 'step' | 'done' | 'play' | 'wrong'

export function applyDoctorTool(v: Visit, tool: DoctorTool, band: AgeBand): { visit: Visit; outcome: ToolOutcome } {
  const want = expectedTool(v)
  if (want === null) return { visit: v, outcome: 'play' }
  if (tool !== want) return { visit: v, outcome: band === '6-7' ? 'wrong' : 'play' }
  const next: Visit = { ...v, step: v.step + 1, bandaged: v.bandaged || tool === 'bandage' }
  return { visit: next, outcome: visitDone(next) ? 'done' : 'step' }
}

/** 放開的位置算不算放在寵物身上（框裡、稍微往外一點也算） */
export const onPetBox = (p: { x: number; y: number }): boolean => p.x >= -0.08 && p.x <= 1.08 && p.y >= -0.08 && p.y <= 1.08
