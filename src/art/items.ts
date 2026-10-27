import type { ShopItem } from '../domain/types'

/**
 * 素材目錄：3D 公仔 PNG 放在 public/art/<name>.png。
 * 這裡只管「名稱對應」與「房間裡的相對尺寸」，不含任何圖像資料。
 */

/**
 * 房間內裝飾的相對尺寸：h = 佔房間高度的比例、aspect = 寬 / 高（依 public/art 實際圖片長寬比）。
 * 以阿悟成體（高 0.42、寬約 0.31 個房間高）當尺：床寬約 1.3 倍、球約 1/3 高、書架明顯比阿悟高。
 */
const DECOR_BOX: Record<string, { h: number; aspect: number }> = {
  bed: { h: 0.35, aspect: 512 / 448 },
  shelf: { h: 0.48, aspect: 451 / 512 },
  plant: { h: 0.25, aspect: 457 / 512 },
  rug: { h: 0.3, aspect: 512 / 430 },
  crate: { h: 0.16, aspect: 512 / 378 },
  ball: { h: 0.14, aspect: 504 / 512 },
  frame: { h: 0.17, aspect: 512 / 462 },
  clock: { h: 0.12, aspect: 506 / 512 },
  curtain: { h: 0.3, aspect: 512 / 454 },
  poster: { h: 0.21, aspect: 365 / 512 },
  // v3 新增（長寬比先給估計值，素材到齊後依實際圖片調整）
  lamp: { h: 0.5, aspect: 193 / 512 },
  tent: { h: 0.36, aspect: 472 / 512 },
  car: { h: 0.22, aspect: 512 / 379 },
  rocket: { h: 0.5, aspect: 414 / 512 },
  dino: { h: 0.26, aspect: 364 / 512 },
  table: { h: 0.3, aspect: 512 / 286 },
  beanbag: { h: 0.2, aspect: 512 / 406 },
  fishbowl: { h: 0.2, aspect: 512 / 464 },
  wallshelf: { h: 0.14, aspect: 512 / 332 },
  bunting: { h: 0.12, aspect: 512 / 207 },
  cloudlamp: { h: 0.16, aspect: 512 / 323 },
  rainbow: { h: 0.22, aspect: 512 / 314 },
  monstera: { h: 0.36, aspect: 459 / 512 },
  piano: { h: 0.32, aspect: 512 / 472 },
}
/** 掛到房間的畫廊作品（itemId / asset 為 art-<galleryId>）：方形畫框，牆面裝飾 */
const ARTWORK_BOX = { h: 0.2, aspect: 1 }
export const isArtworkId = (id: string) => id.startsWith('art-')
const FALLBACK_BOX = { h: 0.18, aspect: 1 }

/** 物件大小換算成「格」（ROOM_CELLS_H 格 = 房間高度）。domain 的 clamp 與 repo 驗證沿用格數。 */
const CELLS = 88
export function spriteSize(asset: string): { cols: number; rows: number } {
  const b = isArtworkId(asset) ? ARTWORK_BOX : (DECOR_BOX[asset] ?? FALLBACK_BOX)
  const rows = b.h * CELLS
  return { cols: rows * b.aspect, rows }
}

/** 商品對應的素材檔名（不含副檔名） */
export function artName(item: Pick<ShopItem, 'id' | 'kind' | 'asset'>): string {
  if (item.kind === 'food') return `food-${item.asset}`
  if (item.kind === 'decor') return item.id.startsWith('decor-') ? item.id : `decor-${item.asset}`
  return item.asset
}

/** 食物 / 裝飾缺圖時，小圖示用的備援 emoji */
export const FOOD_EMOJI: Record<string, string> = {
  banana: '🍌',
  peach: '🍑',
  apple: '🍎',
  grape: '🍇',
  riceball: '🍙',
  milk: '🥛',
  watermelon: '🍉',
  carrot: '🥕',
  cookie: '🍪',
  cake: '🍰',
}

/** 家具缺圖時的備援 emoji（key 是 ShopItem.asset） */
export const DECOR_EMOJI: Record<string, string> = {
  clock: '🕰️',
  ball: '⚽',
  plant: '🪴',
  crate: '📦',
  poster: '🖼️',
  curtain: '🪟',
  rug: '🟠',
  shelf: '📚',
  frame: '⭐',
  bed: '🛏️',
  lamp: '💡',
  tent: '⛺',
  car: '🚗',
  rocket: '🚀',
  dino: '🦖',
  table: '🪑',
  beanbag: '🛋️',
  fishbowl: '🐟',
  wallshelf: '📚',
  bunting: '🚩',
  cloudlamp: '☁️',
  rainbow: '🌈',
  monstera: '🌿',
  piano: '🎹',
}

/** 寵物在房間中的高度（佔房間高度比例，上限約 45%）；寬約為高的 0.85。窄螢幕另外限制寬度不超過可視寬的 42%。 */
export const PET_HEIGHT_FRAC = { egg: 0.3, baby: 0.35, adult: 0.42 } as const
/** 各階段圖片的實際寬高比（pet-egg 399×512、baby 約 425×512、adult 約 379×512） */
export const PET_ASPECT = { egg: 0.78, baby: 0.84, adult: 0.74 } as const

/** 平貼地面的裝飾（地毯）：圖層排在最後面，寵物與其他家具站在上面 */
export const isFlatDecor = (itemId: string) => itemId === 'decor-rug'

/** 材料缺圖時的備援 emoji */
export const MAT_EMOJI: Record<string, string> = { wood: '🪵', stone: '🪨', flower: '🌸' }

/** 學習物件缺圖時的備援 emoji（public/art/obj-*.png 還沒生成完時用） */
export const OBJ_EMOJI: Record<string, string> = {
  'obj-banana': '🍌',
  'obj-peach': '🍑',
  'obj-apple': '🍎',
  'obj-grape': '🍇',
  'obj-fish': '🐟',
  'obj-chick': '🐥',
  'obj-rabbit': '🐰',
  'obj-cow': '🐮',
  'obj-bear': '🐻',
  'obj-octopus': '🐙',
  'obj-flower': '🌸',
  'obj-shell': '🐚',
  'obj-star': '⭐',
  'decor-car': '🚗',
  'decor-rocket': '🚀',
  'decor-ball': '⚽',
  'decor-dino': '🦖',
  'decor-piano': '🎹',
}
