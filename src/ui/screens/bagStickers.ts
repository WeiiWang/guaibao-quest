import { STICKERS } from './coloring/stickers'

export interface BagSticker {
  art: string
  emoji: string
  label: string
}

/**
 * 「我的東西」貼紙分頁要顯示哪些貼紙。
 *
 * 【待替換】合併時改成線 I（繪圖板）的「已解鎖貼紙」純函式（src/domain/ 下）：貼紙盤預設只開 8 張，其餘由 settings.stickers 解鎖。
 * 在那之前：貼紙盤目前的預設清單（STICKERS，全部）加上 settings.stickers 裡有、但清單沒有的貼紙（用 emoji 或 ⭐ 顯示）。
 * 背包（Bag.tsx）只呼叫這一個函式，替換時不用動別的地方。
 */
export function bagStickers(settingsStickers: readonly string[] | undefined): BagSticker[] {
  const out: BagSticker[] = [...STICKERS]
  for (const art of settingsStickers ?? []) if (!out.some((s) => s.art === art)) out.push({ art, emoji: '⭐', label: '貼紙' })
  return out
}
