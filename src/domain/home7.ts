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
/**
 * 幼體到成體的路上，孵化後每餵 20 次一份小獎（門檻 26、46；66 是長大本身）。
 * v7.3：孵化門檻 20 → 6、長大門檻 80 → 66（仍是孵化後 60 次）；
 * 這兩個數字要和 domain/constants.ts 的 BABY_AT_FEED_COUNT、ADULT_AT_FEED_COUNT 一致（這個檔案不 import 專案模組，home7.test.ts 會檢查）
 */
export const MILESTONE_EVERY = 20
export const BABY_FROM = 6
export const ADULT_AT = 66
/** 這次餵食從 before 加到 after 次，跨過了哪些里程碑門檻（40、60） */
export function milestonesCrossed(before: number, after: number): number[] {
  const out: number[] = []
  for (let t = BABY_FROM + MILESTONE_EVERY; t < ADULT_AT; t += MILESTONE_EVERY) if (before < t && after >= t) out.push(t)
  return out
}
/** 每個門檻的候選小禮物（依序挑第一個還沒有的）：第一個里程碑（26 次）是小擺飾、第二個（46 次）是壁紙 / 地板 */
export const MILESTONE_REWARDS: Record<number, readonly string[]> = {
  [BABY_FROM + MILESTONE_EVERY]: ['decor-ball', 'decor-plant', 'decor-clock', 'decor-bunting', 'decor-crate'],
  [BABY_FROM + 2 * MILESTONE_EVERY]: ['wall-mint', 'floor-oak', 'wall-pink', 'wall-clouds', 'floor-checker'],
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

// ---------- 手機掛畫（v7.1 D3） ----------
/** 視窗寬度 ≤ 這個值就算手機：掛畫一定要放在第一屏看得到的牆面 */
export const NARROW_MAX_W = 560
export const isNarrowView = (innerW: number): boolean => innerW <= NARROW_MAX_W
/** 掛畫可以縮到原來的幾倍（手機牆面擠，沒有空位時縮小畫框；不縮到看不清楚） */
export const ART_SCALES = [1, 0.8, 0.65, 0.55, 0.45] as const
export const MIN_ART_SCALE = ART_SCALES[ART_SCALES.length - 1]
export const clampArtScale = (s: number | undefined): number => (Number.isFinite(s) ? Math.min(1, Math.max(MIN_ART_SCALE, s as number)) : 1)
/** 第一屏左右各留的邊（房間寬的比例；手機約 12px），畫不貼著畫面邊緣 */
const EDGE = 0.012

/**
 * 手機的狀態卡與按鈕（固定像素大小）：左上的頭像 + 阿悟狀態卡（蛋 / 幼體還有成長提示，到 y≈176、x≈190），
 * 右邊的鎖頭、工坊 / 背包 / 更多一整排（距右緣 84px 內、到 y≈310）。房間寬 = 2.5 個視窗寬。
 */
export function hudBoxesPhone(viewW: number, roomH: number, adult = false): Box[] {
  const roomW = 2.5 * viewW
  const rw = (px: number) => px / roomW
  const rh = (px: number) => px / roomH
  return [
    { x: VIEW_L + rw(192) / 2, y: rh(adult ? 132 : 178) / 2, w: rw(192), h: rh(adult ? 132 : 178) },
    { x: VIEW_R - rw(84) / 2, y: rh(310) / 2, w: rw(84), h: rh(310) },
  ]
}

/**
 * 手機專用：在「剛進房間的第一屏」裡挑牆面空位，不用捲動就看得到。
 * 先試原大小，擠不下就依序縮小（ART_SCALES）；每一種大小都要同時避開窗戶、狀態卡 / 按鈕、牆上已有的東西，也不能貼著畫面邊緣。
 * 全部縮到最小還是沒空位（牆上已經掛滿）：改成跟已有的畫「錯開疊放」（每幅往下錯一點），但仍不蓋窗戶、不出第一屏。
 * 回傳中心點與縮放倍率（1 = 原大小）。
 */
export function pickWallSpotFit(
  art0: { w: number; h: number },
  wallsIn: readonly Box[],
  viewAspect: number,
  /** 視窗寬與房間高（像素，推估）：有給就用像素算「狀態卡與按鈕」佔的位置（它們的大小是固定像素，不跟房間縮放） */
  px?: { viewW: number; roomH: number; adult?: boolean },
): { x: number; y: number; scale: number } {
  // 畫面寬高比是推估的（不同手機的按鈕列高度略有不同，誤差約 ±7%）：窗戶與畫的寬度都往「寬高比較小」的一邊估，寧可多留空
  const SAFE = 0.92
  const art = { w: art0.w / SAFE, h: art0.h }
  const walls = wallsIn.map((k) => ({ ...k, w: k.w / SAFE }))
  const wins = windowBoxes(viewAspect * SAFE)
  const huds = px ? hudBoxesPhone(px.viewW, px.roomH, px.adult) : hudBoxes()
  const L = VIEW_L + EDGE
  const R = VIEW_R - EDGE
  const FLOOR = 0.62
  type Cand = { x: number; y: number; scale: number; score: number }
  const scan = (scale: number, strict: boolean): Cand | null => {
    const w = art.w * scale
    const h = art.h * scale
    const yMin = h / 2 + 0.03
    const yMax = FLOOR - 0.04 - h / 2
    let best: Cand | null = null
    for (let x = L + w / 2; x <= R - w / 2 + 1e-9; x += 0.004) {
      for (let y = yMin; y <= yMax + 1e-9; y += 0.015) {
        const box: Box = { x, y, w, h }
        if (wins.some((k) => overlap(box, k))) continue // 窗戶：絕對不蓋
        if (huds.some((k) => overlap(box, k))) continue // 狀態卡與按鈕：第一屏的畫要看得到，不被蓋住
        let hits = 0
        let cover = 0
        for (const k of walls) {
          if (!overlap(box, k, 0.006)) continue
          hits++
          cover += Math.max(0, Math.min(box.x + w / 2, k.x + k.w / 2) - Math.max(box.x - w / 2, k.x - k.w / 2)) * Math.max(0, Math.min(box.y + h / 2, k.y + k.h / 2) - Math.max(box.y - h / 2, k.y - k.h / 2))
        }
        if (strict && hits > 0) continue
        // 乾淨的位置：靠上靠左排整齊；擠滿了：蓋住最少的，其次往下錯開
        const score = strict ? (x - L) * 0.4 + y * 0.15 : cover * 2000 + hits + y * 0.15 + (x - L) * 0.05
        if (!best || score < best.score) best = { x, y, scale, score }
      }
    }
    return best
  }
  for (const sc of ART_SCALES) {
    const c = scan(sc, true)
    if (c) return { x: c.x, y: c.y, scale: c.scale }
  }
  const c = scan(MIN_ART_SCALE, false)
  if (c) return { x: c.x, y: c.y, scale: c.scale }
  return { x: VIEW_L + EDGE + (art.w * MIN_ART_SCALE) / 2, y: 0.3, scale: MIN_ART_SCALE }
}

/** 估計首頁房間的可視寬高比（掛畫時人不在首頁，從視窗大小推估；偏保守：寬高比取小一點，窗戶就估得寬一點） */
export function estimateViewAspect(innerW: number, innerH: number): number {
  return Math.max(0.6, (innerW / Math.max(300, innerH - 300)) * 0.95)
}

/** 手機（直向）的畫面寬高比：房間高 ≈ 視窗高 − 255（下方是食物列與四顆大按鈕；實測 640–932 高的手機差在 ±20 以內） */
export const phoneRoomH = (innerH: number): number => Math.max(300, innerH - 255)
export function estimatePhoneAspect(innerW: number, innerH: number): number {
  return Math.max(0.5, innerW / phoneRoomH(innerH))
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
