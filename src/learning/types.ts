/** 學習系統的型別（題目、作答、進度） */

export type SkillId = 'number' | 'classify' | 'pattern'
export type Difficulty = 1 | 2 | 3
export const SKILLS: SkillId[] = ['number', 'classify', 'pattern']
export const DIFFICULTIES: Difficulty[] = [1, 2, 3]

export const SKILL_NAMES: Record<SkillId, string> = {
  number: '數感',
  classify: '分類',
  pattern: '規律',
}

/**
 * 題型
 * - count：數一數有幾個（選項是數字）
 * - compare：兩堆哪堆比較多（選項是兩堆物件）
 * - diff：左邊比右邊多幾個（選項是數字）
 * - kind：依種類找出（水果/動物/大自然）
 * - color：依顏色找出
 * - odd：找出和別的不同類的那一個
 * - next：序列的下一個
 * - missing：序列中間缺的那一個
 */
export type QuestionType = 'count' | 'compare' | 'diff' | 'kind' | 'color' | 'odd' | 'next' | 'missing'

/** 題幹上的物件。obj 為 null 代表「？」空格 */
export interface Visual {
  obj: string | null
  /** 同一種物件的個數（數量題用）；序列題不填 */
  count?: number
}

/** 選項：物件卡片（obj，可含 count 代表一堆）或數字卡片（label） */
export interface Choice {
  id: string
  obj?: string
  count?: number
  label?: string
}

export interface Question {
  id: string
  skill: SkillId
  difficulty: Difficulty
  type: QuestionType
  /** 語音與字幕文字 */
  prompt: string
  items: Visual[]
  choices: Choice[]
  /** 正確選項的 id */
  answer: string
  /** 提示（語音與字幕） */
  hint: string
  version: number
}

/** 一次作答紀錄 */
export interface Attempt {
  id: string
  at: number
  questionId: string
  skill: SkillId
  difficulty: Difficulty
  /** 第一次點選就答對 */
  firstTryCorrect: boolean
  /** 用了幾次提示（第一次錯 = 1，第二次錯 = 2） */
  hintsUsed: number
  durationMs: number
  sessionId: string
  /** 複習題 */
  review?: boolean
  /** 第 14 天短版異題追蹤 */
  followUp?: boolean
}

/** 無提示的獨立答對 = 第一次就對、也沒看提示 */
export const isIndependent = (a: Pick<Attempt, 'firstTryCorrect' | 'hintsUsed'>): boolean =>
  a.firstTryCorrect && a.hintsUsed === 0

export type MaterialId = 'wood' | 'stone' | 'flower'
export const MATERIAL_IDS: MaterialId[] = ['wood', 'stone', 'flower']
export const MATERIAL_NAMES: Record<MaterialId, string> = { wood: '木材', stone: '石頭', flower: '花朵' }
export type MaterialCost = Record<MaterialId, number>

export type MaterialKind = 'station' | 'chest' | 'craft'
export interface MaterialLedgerEntry {
  id: string
  at: number
  material: MaterialId
  delta: number
  kind: MaterialKind
  reason: string
  refId?: string
}

/** 單一難度的複習紀錄 */
export interface MasteryRecord {
  masteredAt: number
  /** 已完成幾次複習（隔天、隔週、第 14 天） */
  reviews: number
  lastReviewAt?: number
}

export interface SkillState {
  skill: SkillId
  difficulty: Difficulty
  /** 最近（至多 5 題）的「無提示答對」結果，新的在後 */
  recent: boolean[]
  /** 連續幾站該技能的無提示答對率 >= 80% */
  stationStreak: number
  mastered: Partial<Record<Difficulty, MasteryRecord>>
  updatedAt: number
}

export interface StationState {
  done: boolean
  independent: number
  total: number
  completedAt?: number
}

/** 每章進度：目前這一輪的每站狀態 */
export interface Progress {
  chapterId: string
  /** 第幾輪（重玩一章時 +1） */
  run: number
  stations: StationState[]
  chestClaimed: boolean
  /** 歷史累計完成過幾輪 */
  completedRuns: number
  updatedAt: number
}

export interface PlayTime {
  /** YYYY-MM-DD */
  date: string
  seconds: number
  /** 家長延長的秒數 */
  bonusSeconds: number
}
