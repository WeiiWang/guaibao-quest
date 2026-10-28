import type { MaterialCost, MaterialId } from '../learning/types'

export type TaskStatus = 'todo' | 'pending' | 'approved' | 'rejected'
export type LedgerKind = 'task' | 'bonus' | 'penalty' | 'purchase'
export type Stage = 'egg' | 'baby' | 'adult'
export type Expression = 'happy' | 'normal' | 'low' | 'eating'
export type ShopKind = 'food' | 'decor' | 'coloring' | 'theme' | 'hat'

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
  /** v5：阿悟學會的新招（id 見 domain/tricks.ts）。舊資料沒有這欄 = 還沒學會任何一招（不升 Dexie 版本） */
  tricks?: string[]
  /** v6：戴著的帽子（商品 id，例 'hat-crown'）；沒有 = 沒戴。舊資料沒有這欄（不升 Dexie 版本） */
  hat?: string
}

/** v5：阿悟拿給孩子的禮物（食物、材料或貼紙）。東西在發放當下就已經寫進背包，這裡只是「待展示」的佇列 */
export interface Gift {
  /** 食物 id */
  foodId?: string
  /** 材料（今日小禮物才有） */
  materialId?: MaterialId
  qty?: number
  /** 貼紙（public/art 素材名；只記錄） */
  stickerId?: string
  at: number
  from: 'station' | 'daily' | 'collection' | 'welcome'
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
  /** v7：家具換色（1–4 = 四種色調；沒有 / 0 = 原色），用 CSS filter 呈現。舊資料沒有這欄 */
  tint?: number
  /** v7.1：掛畫的縮放（手機牆面擠時自動縮小，0.45–1；沒有 = 原大小）。只有畫廊作品用 */
  scale?: number
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
  /** 空白畫紙的背景（見 domain/coloring.ts 的 parseBg）；著色頁沒有 */
  bg?: string
  // ----- 以下只有畫廊作品有 -----
  /** 畫了哪一張著色頁 */
  basePageId?: string
  /** 完成圖（PNG data URL） */
  png?: string
  createdAt?: number
  /** v7.1：作品選用的畫框（見 domain/frames.ts 的 FrameId）；沒有 = 預設的簡單畫框（舊作品都是這樣） */
  frame?: string
}
/** 筆刷種類（v7）。舊資料沒有 kind，視為 'pen' */
/** 'erase' = 局部橡皮擦：在筆刷層用 destination-out 畫，只擦掉筆刷（不動線稿與填色）；資料仍是一條向量筆畫，可復原 */
export type BrushKind = 'pen' | 'crayon' | 'marker' | 'glitter' | 'rainbow' | 'neon' | 'stamp' | 'erase'
export interface ColoringStroke {
  id: string
  color: string
  /** v7：筆刷種類，沒有就是 'pen' */
  kind?: BrushKind
  /** v7：印章筆的圖案（star / heart / banana / flower / paw） */
  stamp?: string
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
  /** v4：已送過免費著色頁（只送一次，之後使用者的庫存怎麼變都不再補） */
  freeColoringGranted?: boolean
  /** v7：已送過點陣線稿免費頁（新手與既有玩家各送一次） */
  freeRasterGranted?: boolean
  /** v4：首次進首頁的引導（冒險地圖按鈕跳動 + 語音）是否已經顯示過 */
  homeGuideShown?: boolean
  /** v4：孩子的年齡檔（家長設定）。未設定視為 4–5 歲。學習資料一律透過 getLearnerProfile() 讀，之後改成每個孩子各自一份 */
  ageBand?: AgeBand
  /** v4：中途離開關卡時保留的進度（題目清單與目前題號） */
  stageDraft?: StageDraft
  /** v4：已經看過教學示範的互動（tapN / dragSort）；每種互動第一次出現時阿悟先示範一次 */
  seenIntros?: string[]
  /** v5：待展示的禮物（依序展示，收下後移除） */
  pendingGifts?: Gift[]
  /** v5：上一次送今日小禮物的日期（YYYY-MM-DD） */
  lastGiftDate?: string
  /** v5：收到的貼紙（public/art 素材名，不重複） */
  stickers?: string[]
  /** v5：圖鑑已經送過幾份「滿 6 個」的禮物 */
  collectionRewarded?: number
  /** v5：待慶祝的新招（依序跳全螢幕慶祝，關掉後移除） */
  pendingTricks?: string[]
  /** v6：家長（PM 預覽）直接解鎖的章節 id（正常是通關前一章才解鎖） */
  unlockedChapters?: string[]
  /** v7：6–7 歲的快速分級做過了（做完或略過都算；只問一次）。level = 分級結果的起跳難度 */
  placement?: { at: number; level?: 1 | 2 | 3 | 4; skipped?: boolean }
  /** v7.1：累計「完成一幅」的幅數（畫框收藏的解鎖門檻 1、3、6、10、15；沒有 = 0） */
  framesDone?: number
  /** v7：已經送過歡迎禮物（20 顆星星 + 1 個食物，只送一次；舊孩子沒有這欄也不補送） */
  welcomeGranted?: boolean
  /** v7：已經送過的成長里程碑（幼體 → 成體路上，每餵 20 次一份；存門檻 40、60） */
  milestonesGiven?: number[]
  /** v6：成長相簿的回憶卡（依時間排序顯示；不升 Dexie 版本） */
  album?: AlbumCard[]
  /** v6：相簿已經依現況補建過舊里程碑（只補一次；之後新里程碑才會有「新卡」提示） */
  albumInit?: boolean
}

/** v6：回憶卡的種類 */
export type AlbumKind = 'hatch' | 'grow' | 'trick' | 'chapter' | 'hat' | 'milestone'
/** v6：成長相簿的一張回憶卡。畫面用元件即時繪製（不截圖）：阿悟當時的姿勢圖、日期、一句話 */
export interface AlbumCard {
  /** 固定規則的 id（hatch、grow、trick:<招>、chapter:<章>、hat:first），同一件事不會重複 */
  id: string
  at: number
  kind: AlbumKind
  /** 阿悟的姿勢圖（public/art 素材名，例 pet-adult-cheer） */
  art: string
  caption: string
  /** 回憶當時戴的帽子（得到第一頂帽子那張才有） */
  hat?: string
  /** 還沒給孩子看過（首頁依序跳出來，看過後移除這個旗標） */
  fresh?: boolean
  /** 日期是估計的（補建的舊里程碑）：畫面顯示「以前」而不是日期 */
  approx?: boolean
  /** v7：成長里程碑送的小禮物（商品 id，例 'decor-ball'、'wall-mint'）；卡片上顯示它的圖 */
  reward?: string
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
