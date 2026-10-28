// v7 線 C：首頁、寵物與方便性的純函式（沒有 React、沒有資料庫），方便單元測試。
// 這個檔案不 import 任何專案模組（只用 import type 與常數），scripts/export-speech-lines.mjs 可以直接載入。
import type { AgeBand, Placement } from './types'

// ---------- 歡迎禮物（C2） ----------
export const WELCOME_STARS = 20
/** 歡迎禮物的食物（阿悟是猴子：香蕉） */
export const WELCOME_FOOD = 'banana'
export const WELCOME_REASON = '歡迎禮物'

// ---------- 蛋的外觀（C3） ----------
/** 蛋孵化進度的外觀分段：0–33% 原蛋、33–66% 小裂紋、66–90% 發光、90% 以上快破了 */
export type EggLook = 'pet-egg' | 'pet-egg-s1' | 'pet-egg-s2' | 'pet-egg-crack'
export function eggLook(progress: number): EggLook {
  if (progress >= 0.9) return 'pet-egg-crack'
  if (progress >= 2 / 3) return 'pet-egg-s2'
  if (progress >= 1 / 3) return 'pet-egg-s1'
  return 'pet-egg'
}
/** 這個外觀的備援順序：新圖還沒生成時往前一階段找，最後一定是 pet-egg */
export function eggArtChain(progress: number): string[] {
  const order: EggLook[] = ['pet-egg-crack', 'pet-egg-s2', 'pet-egg-s1', 'pet-egg']
  return order.slice(order.indexOf(eggLook(progress)))
}

// ---------- 成長里程碑（C3） ----------
/** 幼體到成體的路上，每餵 20 次一份小獎（門檻 40、60；80 是長大本身） */
export const MILESTONE_EVERY = 20
export const BABY_FROM = 20
export const ADULT_AT = 80
/** 這次餵食從 before 加到 after 次，跨過了哪些里程碑門檻（40、60） */
export function milestonesCrossed(before: number, after: number): number[] {
  const out: number[] = []
  for (let t = BABY_FROM + MILESTONE_EVERY; t < ADULT_AT; t += MILESTONE_EVERY) if (before < t && after >= t) out.push(t)
  return out
}
/** 每個門檻的候選小禮物（依序挑第一個還沒有的）：40 次是小擺飾、60 次是壁紙 / 地板 */
export const MILESTONE_REWARDS: Record<number, readonly string[]> = {
  40: ['decor-ball', 'decor-plant', 'decor-clock', 'decor-bunting', 'decor-crate'],
  60: ['wall-mint', 'floor-oak', 'wall-pink', 'wall-clouds', 'floor-checker'],
}
/** 候選都有了就改送一個食物（蛋糕不掉落，這裡是特別的獎勵） */
export const MILESTONE_FALLBACK_FOOD = 'cake'
export function pickMilestoneReward(threshold: number, owned: ReadonlySet<string>): { itemId: string; kind: 'item' | 'food' } {
  const pick = (MILESTONE_REWARDS[threshold] ?? []).find((id) => !owned.has(id))
  return pick ? { itemId: pick, kind: 'item' } : { itemId: MILESTONE_FALLBACK_FOOD, kind: 'food' }
}

// ---------- 家具數量與換色（C4） ----------
/** 同一件家具最多擺幾個 */
export const MAX_DECOR_COPIES = 3
/** 第 1 個的擺放 key 就是商品 id（舊存檔相容）；第 2、3 個是 `<id>~2`、`<id>~3` */
export const placementKey = (baseId: string, copy: number): string => (copy <= 1 ? baseId : `${baseId}~${copy}`)
export const baseIdOf = (key: string): string => {
  const i = key.indexOf('~')
  return i < 0 ? key : key.slice(0, i)
}
export const copyOf = (key: string): number => {
  const i = key.indexOf('~')
  return i < 0 ? 1 : Number(key.slice(i + 1)) || 1
}
/** 擁有 qty 個、已擺了 placedKeys：下一個空的擺放 key；都擺滿了回 null */
export function nextFreeKey(baseId: string, qty: number, placedKeys: readonly string[]): string | null {
  const n = Math.min(MAX_DECOR_COPIES, Math.max(0, qty))
  for (let c = 1; c <= n; c++) {
    const k = placementKey(baseId, c)
    if (!placedKeys.includes(k)) return k
  }
  return null
}
/** 還沒擺出來的個數（背包擁有 qty 個，已擺 placedKeys 中屬於這件的那些） */
export function unplacedCount(baseId: string, qty: number, placedKeys: readonly string[]): number {
  const placed = placedKeys.filter((k) => baseIdOf(k) === baseId).length
  return Math.max(0, Math.min(MAX_DECOR_COPIES, qty) - placed)
}
/** 工坊：家具能不能再做一個（壁紙、地板仍是一種一件） */
export const canMakeMore = (qty: number): boolean => qty < MAX_DECOR_COPIES

/** 四種色調（CSS filter）；0 / 沒有 = 原色 */
export const DECOR_TINTS: readonly { name: string; filter: string }[] = [
  { name: '原色', filter: 'none' },
  { name: '粉紅', filter: 'hue-rotate(300deg) saturate(1.15)' },
  { name: '天藍', filter: 'hue-rotate(165deg) saturate(1.1)' },
  { name: '嫩綠', filter: 'hue-rotate(75deg) saturate(1.1)' },
  { name: '紫色', filter: 'hue-rotate(235deg) saturate(1.05) brightness(1.03)' },
]
export const tintFilter = (tint: number | undefined): string | undefined => {
  const t = Math.trunc(tint ?? 0)
  return t > 0 && t < DECOR_TINTS.length ? DECOR_TINTS[t].filter : undefined
}
export const nextTint = (tint: number | undefined): number => (((Math.trunc(tint ?? 0) || 0) + 1) % DECOR_TINTS.length)

// ---------- 掛畫自動挑位置（C4 / P7） ----------
const WIN_LEFTS = [0.22, 0.7] as const // 與 RoomBackdrop 的窗戶位置一致（佔房間寬度）
const WIN_TOP = 0.12
const WIN_H = 0.3
const WIN_ASPECT = 1.2
const VIEW_L = 0.1 // 剛進房間時的畫面範圍（房間寬 = 2.5 個畫面寬，寵物在 0.3）
const VIEW_R = 0.5
export interface Box {
  x: number
  y: number
  w: number
  h: number
}
const overlap = (a: Box, b: Box, pad = 0): boolean => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad

/**
 * 掛畫要避開的區塊（佔房間寬 / 高的比例）：兩扇窗戶（含窗簾、窗台）、剛進房間時左上的狀態卡與右上的按鈕。
 * 窗戶的寬 = 高 × 1.2 × 房間高，換成房間寬的比例要知道「畫面寬高比」（viewAspect = 可視寬 / 可視高）。
 */
export function wallKeepOut(viewAspect: number): Box[] {
  return [...windowBoxes(viewAspect), ...hudBoxes()]
}
/** 兩扇窗戶（含窗簾、窗台）：硬性不能蓋 */
export function windowBoxes(viewAspect: number): Box[] {
  const a = Math.max(0.6, viewAspect)
  const roomWPerH = 2.5 * a // 房間寬 = 這麼多個房間高
  const ww = (WIN_H * WIN_ASPECT) / roomWPerH
  return WIN_LEFTS.map((l) => ({ x: l + ww / 2, y: WIN_TOP + WIN_H / 2 + 0.02, w: ww * 1.36, h: WIN_H + 0.12 }))
}
/** 剛進房間時蓋在牆上的介面：盡量避開，但擠不下時可以讓一點（畫在介面後面） */
export function hudBoxes(): Box[] {
  const boxes: Box[] = []
  // 剛進房間時畫面左上的狀態卡（約畫面寬 24%、高 20%）與右上的工坊 / 背包 / 更多（約畫面寬 15%、高 42%）
  const vw = VIEW_R - VIEW_L
  boxes.push({ x: VIEW_L + (vw * 0.26) / 2, y: 0.11, w: vw * 0.26, h: 0.22 })
  boxes.push({ x: VIEW_R - (vw * 0.16) / 2, y: 0.22, w: vw * 0.16, h: 0.44 })
  return boxes
}

/**
 * 掛畫自動挑空的牆面位置：不蓋到窗戶、狀態卡、按鈕與已經掛在牆上的東西；優先靠近剛進房間時的畫面，
 * 找不到空位時（牆擠滿了）退而求其次挑「重疊最少」的位置。回傳中心點（比例）。
 * art：這幅畫的大小（佔房間寬 / 高）；walls：牆上已有的東西（中心點與大小，比例）。
 */
export function pickWallSpot(art: { w: number; h: number }, walls: readonly Box[], viewAspect: number): { x: number; y: number } {
  const wins = windowBoxes(viewAspect)
  const huds = hudBoxes()
  const FLOOR = 0.62
  const yMin = art.h / 2 + 0.02
  const yMax = FLOOR - 0.04 - art.h / 2
  const ys: number[] = []
  if (yMax <= yMin) ys.push((yMin + yMax) / 2)
  else for (let y = yMin; y <= yMax + 1e-9; y += 0.02) ys.push(Math.min(yMax, y))
  let best: { x: number; y: number; score: number } | null = null
  for (let x = art.w / 2 + 0.01; x <= 0.99 - art.w / 2; x += 0.005) {
    for (const y of ys) {
      const box: Box = { x, y, w: art.w, h: art.h }
      let hits = 0
      for (const k of wins) if (overlap(box, k)) hits += 10 // 窗戶：絕對不蓋
      for (const w of walls) if (overlap(box, w, 0.008)) hits += 1
      let hud = 0
      for (const k of huds) if (overlap(box, k)) hud += 1
      // 越靠近剛進房間時的畫面中段越好；越靠上（離天花板近）略微加分，一欄才疊得下兩幅
      const dist = Math.abs(x - (VIEW_L + (VIEW_R - VIEW_L) * 0.62)) + Math.abs(y - yMin) * 0.15
      // 不在剛進房間的畫面裡（要捲動才看得到）略微扣分
      const outside = x - art.w / 2 < VIEW_L || x + art.w / 2 > VIEW_R ? 0.2 : 0
      const score = hits * 10 + hud * 0.5 + dist + outside
      if (!best || score < best.score) best = { x, y, score }
    }
  }
  return best ? { x: best.x, y: best.y } : { x: 0.45, y: 0.3 }
}

/** 估計首頁房間的可視寬高比（掛畫時人不在首頁，從視窗大小推估；偏保守：寬高比取小一點，窗戶就估得寬一點） */
export function estimateViewAspect(innerW: number, innerH: number): number {
  return Math.max(0.6, (innerW / Math.max(300, innerH - 300)) * 0.95)
}

// ---------- 蛋的進度環（C3） ----------
/** 進度（0–1）：蛋 = 孵化進度；幼體 = 長大進度；成體 = 1 */
export function growProgress(pet: { stage: string; feedCount: number }): number {
  if (pet.stage === 'egg') return Math.min(1, Math.max(0, pet.feedCount / BABY_FROM))
  if (pet.stage === 'baby') return Math.min(1, Math.max(0, (pet.feedCount - BABY_FROM) / (ADULT_AT - BABY_FROM)))
  return 1
}

// ---------- 年齡（C2） ----------
export const AGE_CHOICES: { band: AgeBand; label: string; say: string; emoji: string }[] = [
  { band: '3', label: '3 歲', say: '三歲', emoji: '🧒' },
  { band: '4-5', label: '4–5 歲', say: '四到五歲', emoji: '👦' },
  { band: '6-7', label: '6–7 歲', say: '六到七歲', emoji: '🧑' },
]

// ---------- 選孩子畫面的專屬顏色（C2） ----------
export const CHILD_COLORS: readonly { bg: string; deep: string; soft: string }[] = [
  { bg: '#ffe0b8', deep: '#f0a94a', soft: '#fff1dc' },
  { bg: '#cfeee0', deep: '#4fb58f', soft: '#e8f8f1' },
  { bg: '#ffd3e2', deep: '#ee7aa2', soft: '#ffeaf2' },
  { bg: '#d6e8ff', deep: '#5a9be6', soft: '#eaf3ff' },
  { bg: '#e6dcff', deep: '#8f78e0', soft: '#f3eeff' },
  { bg: '#fff2a8', deep: '#d9b21c', soft: '#fff9d6' },
]
export const childColorOf = (order: number): (typeof CHILD_COLORS)[number] => CHILD_COLORS[((Math.trunc(order) % CHILD_COLORS.length) + CHILD_COLORS.length) % CHILD_COLORS.length]

// ---------- 新句子（會唸出來；scripts/export-speech-lines.mjs 會匯出） ----------
// key 規則：阿悟本人說的話 `pet.` 開頭（語音生成工具用阿悟聲）；介面旁白 `ui.` 開頭（媽媽聲）。
export const HOME_LINES: Record<string, string | string[]> = {
  // 阿悟收下一整袋禮物
  'pet.gift.thanks': ['哇，好多禮物！', '謝謝你，我最喜歡了！'],
  'ui.gift.bag': '禮物都收下囉！',
  // 禮物袋（沒有東西時不會出現）
  'ui.gift.bagHint': '點一下，收下禮物',
  // 佈置模式：還沒有家具
  'ui.edit.workshop': '去工坊做家具吧',
  'ui.edit.allPlaced': '家具都擺好了，去工坊再做一些吧',
  'ui.edit.tint': '換個顏色吧',
  'ui.edit.full': '這個最多擺三個喔',
  // onboarding 年齡頁
  'ui.onboard.age': '你幾歲了？',
  'ui.onboard.age3': '三歲',
  'ui.onboard.age45': '四到五歲',
  'ui.onboard.age67': '六到七歲',
  // 歡迎禮物
  'pet.welcome': '歡迎你！這是給你的禮物！',
  // 成長里程碑
  'pet.milestone': '我又長大一點了，送你一個小禮物！',
  // 工坊：再做一個
  'ui.workshop.more': '再做一個',
}

/** 展開成 key → 文字（陣列用 `<key>.<序號>`，和 lines.ts 的規則一致） */
export function homeLineMap(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(HOME_LINES)) {
    if (Array.isArray(v)) v.forEach((t, i) => (out[`${k}.${i + 1}`] = t))
    else out[k] = v
  }
  return out
}

export const GIFT_BAG_DONE_LINE = HOME_LINES['ui.gift.bag'] as string
export const GIFT_THANKS_LINES = HOME_LINES['pet.gift.thanks'] as string[]
export const WELCOME_LINE = HOME_LINES['pet.welcome'] as string
export const MILESTONE_LINE = HOME_LINES['pet.milestone'] as string

/** 這些 placement 裡，屬於 baseId 的個數 */
export const placedOf = (baseId: string, placements: readonly Pick<Placement, 'itemId'>[]): number => placements.filter((p) => baseIdOf(p.itemId) === baseId).length
