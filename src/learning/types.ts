/** 學習系統的型別（題目、作答、進度） */

export type SkillId = 'number' | 'classify' | 'pattern'
export type Difficulty = 1 | 2 | 3 | 4
export const SKILLS: SkillId[] = ['number', 'classify', 'pattern']
export const DIFFICULTIES: Difficulty[] = [1, 2, 3, 4]
export const MAX_DIFFICULTY: Difficulty = 4

export const SKILL_NAMES: Record<SkillId, string> = {
  number: '數感',
  classify: '分類',
  pattern: '規律',
}

/**
 * 題型
 * - count：數一數有幾個（選項是數字）
 * - compare：兩堆哪堆比較多（選項是兩堆物件）
 * - diff：藍色那堆比橘色那堆多幾個（選項是數字）
 * - kind：依種類找出（水果/動物/交通工具/玩具）
 * - same：找出跟範例同一類（或同一個顏色）的
 * - color：依顏色找出
 * - odd：找出和別的不同類的那一個
 * - dual：雙屬性（黃色的水果）
 * - next：序列的下一個
 * - missing：序列中間缺的那一個
 * - attr：屬性規律（顏色或種類輪流出現）的下一個
 * - grow：成長規律（1、2、3 個 → 4 個）
 * - add：加法情境題（3 顆桃子再放 2 顆）
 * - seqnum：數序缺數
 * - give：拿給我 N 個（點選或拖曳放進籃子）
 * - bins：拖曳歸類（物件放進對的籃子）
 */
export type QuestionType =
  | 'count'
  | 'compare'
  | 'diff'
  | 'kind'
  | 'same'
  | 'color'
  | 'odd'
  | 'dual'
  | 'next'
  | 'missing'
  | 'attr'
  | 'grow'
  | 'add'
  | 'seqnum'
  | 'give'
  | 'bins'

/**
 * 互動方式。每種互動自己判斷對錯，再對應成 firstTryCorrect / hintsUsed，
 * 所以作答紀錄、升降級、材料計算、報告都不用分互動。
 * - pick：點選選項卡（預設，舊題庫沒有這個欄位）
 * - tapN：拿給我 N 個（點選或拖曳放進籃子，按「好了」確認）
 * - dragSort：拖曳歸類（點選物件再點籃子也可以）
 */
export type Interaction = 'pick' | 'tapN' | 'dragSort'

/** 題幹上的物件。obj 為 null 代表空格 */
export interface Visual {
  obj: string | null
  /** 同一種物件的個數（數量題用）；序列題不填 */
  count?: number
  /** 數序題：顯示的數字（空格時為 null） */
  label?: string | null
  /** 兩堆比較時用顏色區分：blue / orange */
  tone?: 'blue' | 'orange'
}

/** 選項：物件卡片（obj，可含 count 代表一堆）或數字卡片（label） */
export interface Choice {
  id: string
  obj?: string
  count?: number
  label?: string
  /** 比多少：用顏色區分兩堆 */
  tone?: 'blue' | 'orange'
}

/** 拖曳歸類的籃子 */
export interface Bin {
  id: string
  /** 籃子上的字（語音也唸這個） */
  label: string
  /** 籃子的代表圖（物件 id；挑沒有出現在要分類的東西裡的那個） */
  obj?: string
  /** 依顏色分的籃子：色票（CSS 顏色） */
  swatch?: string
}

/** 各題型自己的參數（產生器寫入，介面據此畫提示與互動） */
export interface QuestionParams {
  /** odd：另外三個同類選項的 id；提示時亮起 */
  same?: string[]
  /** odd / kind / same：這一類（或屬性）的名字，例如「水果」 */
  groupName?: string
  /** color / dual：色票（CSS 顏色）與顏色名稱 */
  swatch?: string
  colorWord?: string
  /** count：快閃辨識。題幹的物件只亮一下就蓋起來，再點選數字（亮的時間 ms） */
  flash?: number
  /** pattern：核心單位長度（AB=2、AAB=3、ABC=3） */
  core?: number
  /** pattern / attr / grow / seqnum：提示時逐個唸出的字（每個題幹格一個；空格不唸） */
  words?: string[]
  /** give：要拿的個數、桌上放幾個、物件 */
  n?: number
  pool?: number
  obj?: string
  /** bins：籃子與每個物件該放哪個籃子（依 items 順序） */
  bins?: Bin[]
  targets?: string[]
}

export interface Question {
  id: string
  skill: SkillId
  difficulty: Difficulty
  type: QuestionType
  /** 互動方式；沒寫就是 pick */
  interaction?: Interaction
  /** 語音與字幕文字 */
  prompt: string
  items: Visual[]
  choices: Choice[]
  /** 正確選項的 id（give 題是要拿的個數；bins 題是 'sorted'） */
  answer: string
  /** 提示（語音與字幕） */
  hint: string
  params?: QuestionParams
  /** 只給幼幼模式（3 歲）用的題：2 選 1、物件限定常見的那幾個；一般模式抽題時排除 */
  gentle?: boolean
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
  /** 互動方式（舊紀錄沒有；視為 pick） */
  interaction?: Interaction
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
  /** 已完成幾次複習（隔天、隔週、第 14 天）。複習答錯不算 */
  reviews: number
  lastReviewAt?: number
  /** 連續幾次複習沒答對（2 次就清掉這個難度的掌握） */
  misses?: number
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
  /** 目前為止算進難度判斷的題數；用來做「前 3 題全部獨立答對就升級」。舊資料沒有這個欄位 = 不是新技能 */
  total?: number
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
