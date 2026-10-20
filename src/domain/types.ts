import type { MaterialCost } from '../learning/types'

export type TaskStatus = 'todo' | 'pending' | 'approved' | 'rejected'
export type LedgerKind = 'task' | 'bonus' | 'penalty' | 'purchase'
export type Stage = 'egg' | 'baby' | 'adult'
export type Expression = 'happy' | 'normal' | 'low' | 'eating'
export type ShopKind = 'food' | 'decor' | 'coloring'

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
export interface ColoringProgress {
  pageId: string
  fills: Record<string, string>
  updatedAt: number
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
  /** v3：寵物會大便；未設定視為開 */
  petPoopOn?: boolean
}
