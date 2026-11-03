// v8 線 O：首頁引導一次只指一件事。純函式，不碰資料庫與畫面。

export type GuideTarget = 'food' | 'adventure'

/** 飽足低於這個值（滿分 100）才算「偏低」。比「低落」（30）寬一點：孩子還沒餓到無精打采，就先提醒 */
export const GUIDE_HUNGER_LOW = 50

export interface GuideInput {
  /** 背包裡有沒有至少一份食物 */
  hasFood: boolean
  /** 目前飽足（0–100） */
  hunger: number
  /** 還沒看過第一次的餵食提示（= 剛拿到第一份食物的新手） */
  firstFood: boolean
}

/**
 * 首頁現在該指哪裡：
 * - 有食物，而且（飽足偏低，或是新手剛拿到第一份食物）→ 食物
 * - 其他一律是冒險地圖
 * 手指、發光、提示條都只能出現在這個結果指的那一個地方。
 */
export function homeGuideTarget({ hasFood, hunger, firstFood }: GuideInput): GuideTarget {
  if (hasFood && (firstFood || hunger < GUIDE_HUNGER_LOW)) return 'food'
  return 'adventure'
}
