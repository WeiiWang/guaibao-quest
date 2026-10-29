/** 貼紙：用 public/art 的 3D 公仔素材。缺圖時用 emoji 備援。目錄與解鎖規則在 domain/stickers.ts（v7.4 I4）。 */
import { STICKER_CATALOG, stickerEmoji as emojiOf } from '../../../domain/stickers'

export const STICKERS: { art: string; emoji: string; label: string }[] = STICKER_CATALOG.map((s) => ({ ...s }))
export const stickerEmoji = (art: string): string | undefined => emojiOf(art)
