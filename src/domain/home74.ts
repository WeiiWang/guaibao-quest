// v7.4 線 J：首頁與 UI 一致性的純函式（沒有 React、沒有資料庫），方便單元測試。
// 這個檔案只 import type 與 home7 / room 的純常數；句子（J74_LINES）會複製一份到 src/learning/lines.ts 的 STATIC_LINES，
// 兩邊要一字不差（home74.test.ts 會檢查），scripts/export-speech-lines.mjs 才匯出得到。
import { WELCOME_STARS, windowBoxes } from './home7'
import { PET_X, ROOM_WIDTH_FACTOR } from './room'
import type { Gift } from './types'

// ---------- 新句子（會唸出來） ----------
// 阿悟本人說的話 key 以 `pet.` 開頭（阿悟聲）；介面旁白 `ui.` 開頭（媽媽聲）。
export const J74_LINES: Record<string, string> = {
  // J3：隔天回來阿悟餓了，第一句話改成溫暖的（每次開啟 App 第一次進首頁、阿悟餓的時候說一次）
  'pet.hungry.back': '你回來了！我肚子有點餓餓的',
  // J2：「我的東西」各分頁與成長相簿的空狀態（阿悟說的話）。帽子與家具沿用 ui.hat.empty、ui.edit.workshop
  'pet.empty.food': '還沒有食物，我們去冒險找吧！',
  'pet.empty.material': '還沒有材料，我們去冒險找材料吧！',
  'pet.empty.sticker': '還沒有貼紙，去畫畫、收小禮物就會有喔',
  'pet.empty.album': '我們一起去冒險，回憶卡就會出現囉',
}

export const HUNGRY_BACK_LINE = J74_LINES['pet.hungry.back']
/** 阿悟餓的時候，狀態卡上平常顯示的短句（不是「好餓，無精打采…」那種負面的話） */
export const HUNGRY_MOOD_TEXT = '肚子有點餓餓的'

export type BagTab = 'food' | 'material' | 'hat' | 'sticker' | 'furniture'
export const BAG_TABS: readonly { id: BagTab; label: string; emoji: string }[] = [
  { id: 'food', label: '食物', emoji: '🍌' },
  { id: 'material', label: '材料', emoji: '🪵' },
  { id: 'hat', label: '帽子', emoji: '👒' },
  { id: 'sticker', label: '貼紙', emoji: '⭐' },
  { id: 'furniture', label: '家具', emoji: '🪑' },
]

/** 每個分頁空的時候：阿悟說的那一句（key 在 STATIC_LINES；句子由呼叫端用 sayText 唸）與「去做」的去處 */
export type EmptyGoto = 'map' | 'shop-hat' | 'coloring' | 'workshop'
export const BAG_EMPTY: Record<BagTab, { line: string; button: string; goto: EmptyGoto }> = {
  food: { line: J74_LINES['pet.empty.food'], button: '去冒險找食物', goto: 'map' },
  material: { line: J74_LINES['pet.empty.material'], button: '去冒險找材料', goto: 'map' },
  hat: { line: '還沒有帽子，去商店的衣櫃買一頂吧', button: '去商店買帽子', goto: 'shop-hat' }, // 同 domain/hats.ts 的 hatEmptyLine（ui.hat.empty）
  sticker: { line: J74_LINES['pet.empty.sticker'], button: '去畫畫', goto: 'coloring' },
  furniture: { line: '去工坊做家具吧', button: '去工坊做家具', goto: 'workshop' }, // 同 ui.edit.workshop
}
export const ALBUM_EMPTY = { line: J74_LINES['pet.empty.album'], button: '去冒險', goto: 'map' as EmptyGoto }

// ---------- J4：禮物袋打開時，把內容一項一項飛出來 ----------
export interface RevealItem {
  /** 同一種東西合併成一項：star / food:<id> / mat:<id> / sticker:<id> */
  id: string
  kind: 'star' | 'food' | 'material' | 'sticker'
  /** 食物 id、材料 id、貼紙素材名；星星沒有 */
  ref?: string
  qty: number
}

/**
 * 一袋禮物攤開來要顯示什麼：同一種東西合併成一項（香蕉 +2），順序固定：星星、食物、材料、貼紙（各自依第一次出現的順序）。
 * 歡迎禮物（from 'welcome'）的 20 顆星星在發放時就已經入帳，不在 Gift 裡；打開袋子時把它算進來，孩子才看得到「星星 +20」。
 */
export function giftReveal(gifts: readonly Gift[], max = 6): RevealItem[] {
  const stars = gifts.some((g) => g.from === 'welcome') ? WELCOME_STARS : 0
  const rank = { star: 0, food: 1, material: 2, sticker: 3 } as const
  const map = new Map<string, RevealItem>()
  if (stars > 0) map.set('star', { id: 'star', kind: 'star', qty: stars })
  for (const g of gifts) {
    let it: RevealItem
    if (g.foodId) it = { id: `food:${g.foodId}`, kind: 'food', ref: g.foodId, qty: 1 }
    else if (g.materialId) it = { id: `mat:${g.materialId}`, kind: 'material', ref: g.materialId, qty: Math.max(1, g.qty ?? 1) }
    else if (g.stickerId) it = { id: `sticker:${g.stickerId}`, kind: 'sticker', ref: g.stickerId, qty: 1 }
    else continue
    const cur = map.get(it.id)
    if (cur) cur.qty += it.qty
    else map.set(it.id, it)
  }
  const arr = [...map.values()]
  return arr.map((v, i) => ({ v, i })).sort((a, b) => rank[a.v.kind] - rank[b.v.kind] || a.i - b.i).map((x) => x.v).slice(0, max)
}

/** 數字跳動：t（0–1）時顯示到幾。最後一格一定剛好是 qty；qty 1 沒有計數，直接是 1 */
export function countUpValue(qty: number, t: number): number {
  if (qty <= 1) return qty
  if (t >= 1) return qty
  const e = 1 - (1 - Math.max(0, t)) ** 2 // ease-out
  return Math.min(qty, Math.max(1, Math.round(qty * e)))
}

// ---------- J5：狀態卡不壓窗簾 ----------
/** 狀態卡離房間左緣、離窗簾的空隙（px） */
export const HUD_LEFT = 14
export const HUD_GAP = 8
/** 狀態卡（名字、心情、飽足條、進度）最窄需要的寬度；放不下就改成縮小版徽章 */
export const HUD_MIN_CARD = 150
/** 縮小版徽章（進度環 + 飽足條）的寬度 */
export const HUD_BADGE_W = 52

/**
 * 剛進房間時（捲動位置 = 寵物置中），第一扇窗戶（含窗簾）左緣到狀態卡左緣之間還剩多少寬度（px）。
 * 房間寬 = 可視寬 × ROOM_WIDTH_FACTOR，剛進房間捲到寵物（PET_X）置中；窗戶位置來自 home7 的 windowBoxes（和 RoomBackdrop 一致）。
 */
export function hudRoomLeft(viewW: number, viewH: number): number {
  if (viewW <= 0 || viewH <= 0) return Infinity
  const roomW = viewW * ROOM_WIDTH_FACTOR
  const scroll0 = Math.max(0, PET_X * roomW - viewW / 2)
  const win = windowBoxes(viewW / viewH)[0]
  const left = (win.x - win.w / 2) * roomW - scroll0
  return left - HUD_LEFT - HUD_GAP
}
export type HudLayout = { mode: 'card'; maxW: number | undefined } | { mode: 'badge'; maxW: undefined }
export function hudLayout(viewW: number, viewH: number): HudLayout {
  const avail = hudRoomLeft(viewW, viewH)
  if (avail >= HUD_MIN_CARD) return { mode: 'card', maxW: Number.isFinite(avail) ? Math.floor(avail) : undefined }
  return { mode: 'badge', maxW: undefined }
}
