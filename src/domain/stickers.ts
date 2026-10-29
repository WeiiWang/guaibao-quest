/**
 * v7.4 I4：貼紙盤會成長。
 *
 * - 預設只開 8 張（3 歲最喜歡的）；刻意不放進每日禮物的貼紙清單（gifts.ts 的 GIFT_STICKERS），不然「貼紙禮物」又變成死獎勵。
 * - 其餘靠 settings.stickers 解鎖：每日禮物的貼紙（線 H 發）、朋友圖鑑的收集禮物（見 collectionGiftSticker）。
 * - 舊存檔相容：作品裡（進行中的、畫廊的）出現過的貼紙一律視為已解鎖，孩子的舊作不會出現「沒擁有的貼紙」。
 * - 「新」：已解鎖、不是預設、還沒在貼紙盤用過（settings.stickersSeen）、舊作也沒用過的貼紙。
 *
 * 給其他畫面共用（例如背包的「貼紙」分頁）：unlockedStickers(settings.stickers, usedStickerIds(作品們)) 回傳已解鎖的貼紙，依目錄順序。
 */
export interface StickerDef {
  art: string
  emoji: string
  label: string
}

/** 全部貼紙（目錄順序 = 貼紙盤的排列順序）。缺圖時用 emoji 備援 */
export const STICKER_CATALOG: readonly StickerDef[] = [
  { art: 'pet-adult-happy', emoji: '🐵', label: '阿悟' },
  { art: 'obj-banana', emoji: '🍌', label: '香蕉' },
  { art: 'obj-apple', emoji: '🍎', label: '蘋果' },
  { art: 'obj-peach', emoji: '🍑', label: '桃子' },
  { art: 'obj-grape', emoji: '🍇', label: '葡萄' },
  { art: 'food-cake', emoji: '🍰', label: '蛋糕' },
  { art: 'decor-rocket', emoji: '🚀', label: '火箭' },
  { art: 'decor-dino', emoji: '🦖', label: '恐龍' },
  // ---- 以下要解鎖 ----
  { art: 'pet-adult-cheer', emoji: '🙌', label: '歡呼阿悟' },
  { art: 'pet-baby-happy', emoji: '🐒', label: '小猴' },
  { art: 'obj-star', emoji: '⭐', label: '星星' },
  { art: 'obj-flower', emoji: '🌸', label: '花' },
  { art: 'obj-rabbit', emoji: '🐰', label: '兔子' },
  { art: 'obj-chick', emoji: '🐥', label: '小雞' },
  { art: 'obj-fish', emoji: '🐟', label: '小魚' },
  { art: 'obj-shell', emoji: '🐚', label: '貝殼' },
  { art: 'decor-rainbow', emoji: '🌈', label: '彩虹' },
  { art: 'mat-flower', emoji: '🌼', label: '小花' },
]

/** 預設開放的 8 張 */
export const DEFAULT_STICKER_COUNT = 8
export const DEFAULT_STICKERS: readonly string[] = STICKER_CATALOG.slice(0, DEFAULT_STICKER_COUNT).map((s) => s.art)

export const stickerDef = (art: string): StickerDef | undefined => STICKER_CATALOG.find((s) => s.art === art)
export const stickerEmoji = (art: string): string | undefined => stickerDef(art)?.emoji

/** 作品裡出現過的貼紙素材名（去重）。works = 進行中的作品與畫廊作品 */
export function usedStickerIds(works: readonly { stickers?: readonly { art: string }[] }[]): string[] {
  const out = new Set<string>()
  for (const w of works) for (const s of w.stickers ?? []) out.add(s.art)
  return [...out]
}

/**
 * 已解鎖的貼紙（依目錄順序）：預設 8 張 + settings.stickers（owned）+ 舊作用過的（used）。
 * 不在目錄裡的素材名忽略（舊資料或亂寫的）。
 */
export function unlockedStickers(owned: readonly string[] | undefined, used: readonly string[] = []): StickerDef[] {
  const open = new Set<string>([...DEFAULT_STICKERS, ...(owned ?? []), ...used])
  return STICKER_CATALOG.filter((s) => open.has(s.art))
}

/** 貼紙盤要標「新」的：已解鎖、不是預設、沒在 seen 裡、舊作也沒用過 */
export function newStickerIds(owned: readonly string[] | undefined, seen: readonly string[] | undefined, used: readonly string[] = []): string[] {
  const skip = new Set<string>([...DEFAULT_STICKERS, ...(seen ?? []), ...used])
  return unlockedStickers(owned, []).filter((s) => !skip.has(s.art)).map((s) => s.art)
}

/** 貼紙盤的排列：標「新」的排最前面（孩子一打開就看到），其餘維持目錄順序 */
export function trayOrder(unlocked: readonly StickerDef[], fresh: readonly string[]): StickerDef[] {
  const f = new Set(fresh)
  return [...unlocked.filter((s) => f.has(s.art)), ...unlocked.filter((s) => !f.has(s.art))]
}

/**
 * 朋友圖鑑的收集禮物：第 1、3、5… 份（rewardIndex 從 1 起算）送「下一張還沒擁有的貼紙」（依目錄順序、固定、不靠亂數），
 * 偶數份和貼紙都送完了就送食物（回傳 undefined，由呼叫端照舊給食物）。
 */
export function collectionGiftSticker(owned: readonly string[] | undefined, rewardIndex: number): string | undefined {
  if (rewardIndex % 2 === 0) return undefined
  const have = new Set<string>([...DEFAULT_STICKERS, ...(owned ?? [])])
  return STICKER_CATALOG.find((s) => !have.has(s.art))?.art
}
