import type { MaterialCost } from '../learning/types'

export type TaskStatus = 'todo' | 'pending' | 'approved' | 'rejected'
export type LedgerKind = 'task' | 'bonus' | 'penalty' | 'purchase'
export type Stage = 'egg' | 'baby' | 'adult'
export type Expression = 'happy' | 'normal' | 'low' | 'eating'
export type ShopKind = 'food' | 'decor' | 'coloring' | 'theme'

export interface Child {
  id: string
  name: string
  avatar: string
}
export interface TaskTemplate {
  id: string
  title: string
  emoji: string
  points: number
  repeatDaily: boolean
  active: boolean
  order: number
}
export interface TaskInstance {
  id: string
  templateId: string
  date: string // YYYY-MM-DD (本地日期)
  status: TaskStatus
  updatedAt: number
}
export interface PointLedger {
  id: string
  at: number
  delta: number
  reason: string
  kind: LedgerKind
  refId?: string
}
/** 房間裡的一坨便便（SPEC-v3 A3）；x 是中心點，占房間寬度的比例 */
export interface Poop {
  id: string
  x: number
  /** 出現時間（ms） */
  at: number
}
/** 連續餵食計數（決定大便機率）；間隔太久會重算 */
export interface FeedStreak {
  n: number
  at: number
}
export interface Pet {
  id: string
  name: string
  stage: Stage
  feedCount: number
  hunger: number
  hungerUpdatedAt: number
  mood: Expression
  /** v3：房間裡的便便。舊資料沒有這欄，讀取時當成空陣列（不升 Dexie 版本） */
  poops?: Poop[]
  /** v3：已排定、還沒發生的大便時間（ms）；離線期間到期的下次開啟時補上 */
  poopDue?: number[]
  /** v3：連續餵食計數 */
  feedStreak?: FeedStreak
}
export type DecorSlot = 'wall' | 'floor'
export type ThemeSlot = 'wall' | 'floor'
/** 套用中的房間主題（id 見 domain/theme.ts） */
export interface RoomThemeChoice {
  wall?: string
  floor?: string
}
export interface ShopItem {
  id: string
  kind: ShopKind
  name: string
  price: number
  asset: string
  /** 裝飾只能放牆面或地面 */
  slot?: DecorSlot
  /** 家具的材料成本（工坊製作用；v2 起家具不再用星星買） */
  cost?: MaterialCost
  /** kind === 'theme' 時：壁紙（wall）或地板（floor） */
  themeSlot?: ThemeSlot
}
/** 房間裡已擺放的裝飾；x、y 是中心點，佔房間寬/高的比例（0–1） */
export interface Placement {
  itemId: string
  x: number
  y: number
  /** 0 = 依 y 自動排序；>0 = 「移到最前」覆寫 */
  z: number
  flipped: boolean
  placedAt: number
}
export interface Inventory {
  id: string
  itemId: string
  qty: number
}
/**
 * 著色資料。同一張表存兩種東西（不升 Dexie 版本）：
 * - 進行中的作品：pageId = 著色頁 id（例 'monkey'）
 * - 畫廊作品：pageId = 'g:<galleryId>'，帶 png 與 basePageId
 * 新欄位全部 optional，舊資料讀到時當成沒有。
 */
export interface ColoringProgress {
  pageId: string
  /** regionId → 顏色（'#rrggbb'）或特殊填色（'rainbow'、'glitter:#rrggbb'…，見 domain/coloring.ts） */
  fills: Record<string, string>
  updatedAt: number
  strokes?: ColoringStroke[]
  stickers?: ColoringSticker[]
  // ----- 以下只有畫廊作品有 -----
  /** 畫了哪一張著色頁 */
  basePageId?: string
  /** 完成圖（PNG data URL） */
  png?: string
  createdAt?: number
}
export interface ColoringStroke {
  id: string
  color: string
  /** 筆刷粗細（著色頁座標空間，viewBox 400） */
  width: number
  /** 座標空間 0–400 */
  points: [number, number][]
}
export interface ColoringSticker {
  id: string
  /** public/art 素材名（不含副檔名） */
  art: string
  x: number
  y: number
  /** 1 = 預設大小（約 72 單位） */
  scale: number
  /** 角度 */
  rot: number
}
export interface Settings {
  id: string
  pinHash: string
  childName: string
  onboarded: boolean
  /** 「把香蕉拖給寵物吃」的一次性提示是否已顯示過 */
  feedHintShown?: boolean
  /** 每日遊玩分鐘上限；0 = 不限；未設定視為 20 */
  dailyLimitMin?: number
  /** 音效開關；未設定視為開 */
  soundOn?: boolean
  /** 語音唸題開關；未設定視為開 */
  voiceOn?: boolean
  /** 套用中的壁紙 / 地板；未設定用預設（奶油素色 + 原木） */
  roomTheme?: RoomThemeChoice
  /** v3：寵物會大便；未設定視為開 */
  petPoopOn?: boolean
  /** v4：孩子的年齡檔（家長設定）。未設定視為 4–5 歲。學習資料一律透過 getLearnerProfile() 讀，之後改成每個孩子各自一份 */
  ageBand?: AgeBand
  /** v4：中途離開關卡時保留的進度（題目清單與目前題號） */
  stageDraft?: StageDraft
}

/** 年齡檔：3 歲 = 幼幼模式；4–5 歲從難度 1；6–7 歲從難度 2 */
export type AgeBand = '3' | '4-5' | '6-7'

/** 離開關卡時存下來的進度；回到同一站時接著玩 */
export interface StageDraft {
  chapterId: string
  station: number
  run: number
  sessionId: string
  /** 這一站的題目（題目 id；review/followUp 標記） */
  plan: { id: string; review: boolean; followUp: boolean }[]
  savedAt: number
}
