// v6 線 C：阿悟的帽子衣櫃。帽子用星星在商店「衣櫃」分頁購買；擁有紀錄放 inventory，戴著哪一頂放 pet.hat（不升 Dexie 版本）。
// 價格要讓孩子大約存 1–2 週（每天任務最多 100 顆星），讓「我想要那頂王冠」成為做生活任務的動力。
export interface HatDef {
  /** 商品 id，也是 public/art 的素材名 */
  id: string
  name: string
  price: number
  /** 缺圖時的備援 emoji */
  emoji: string
}

/** 依價格由低到高（商店與衣櫃的順序） */
export const HATS: HatDef[] = [
  { id: 'hat-party', name: '派對帽', price: 80, emoji: '🥳' },
  { id: 'hat-cap', name: '棒球帽', price: 90, emoji: '🧢' },
  { id: 'hat-flower', name: '花花帽', price: 100, emoji: '🌸' },
  { id: 'hat-straw', name: '草帽', price: 120, emoji: '👒' },
  { id: 'hat-chef', name: '廚師帽', price: 150, emoji: '👨‍🍳' },
  { id: 'hat-crown', name: '皇冠', price: 250, emoji: '👑' },
]

export const HAT_IDS: string[] = HATS.map((h) => h.id)
export const isHatId = (v: unknown): v is string => typeof v === 'string' && HAT_IDS.includes(v)
export const hatOf = (id: string | null | undefined): HatDef | undefined => HATS.find((h) => h.id === id)

/** 蛋裡面不能戴帽子；孵出來（幼猴、成猴）才可以 */
export const canWearHat = (stage: 'egg' | 'baby' | 'adult'): boolean => stage !== 'egg'

// ---------- 會唸出來的句子（要跟 src/learning/lines.ts 的 STATIC_LINES 一字不差，hats.test.ts 會檢查） ----------
export const hatBuyLine = (name: string): string => `買到${name}囉！`
export const hatWearLine = (petName: string, name: string): string => `${petName}戴上了${name}！`
export const hatOffLine = (): string => '好，帽子拿下來囉'
export const hatEggLine = (petName: string): string => `${petName}還在蛋裡，孵出來才能戴帽子`
export const hatEmptyLine = (): string => '還沒有帽子，去商店的衣櫃買一頂吧'
