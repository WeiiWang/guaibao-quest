import { artName, FOOD_EMOJI, OBJ_EMOJI } from '../../art/items'
import type { ShopItem } from '../../domain/types'
import type { FoodMeta } from './usePetLife'

/** 咬一口噴出的碎屑顏色（沒列到的食物用預設色） */
const CRUMB_COLOR: Record<string, string> = {
  banana: '#ffe066',
  peach: '#ffb199',
  apple: '#ff7b7b',
  grape: '#a67ad9',
  riceball: '#f4f1ea',
  milk: '#ffffff',
  watermelon: '#ff6f7d',
  carrot: '#ff9f43',
  cookie: '#d9a066',
  cake: '#ffc2d9',
}
const DEFAULT_CRUMB = '#f3c98b'

export function foodMeta(item: Pick<ShopItem, 'id' | 'kind' | 'asset'>): FoodMeta {
  return {
    art: artName(item),
    emoji: FOOD_EMOJI[item.asset],
    color: CRUMB_COLOR[item.asset] ?? DEFAULT_CRUMB,
    celebrate: item.asset === 'cake',
  }
}

/** 對話泡泡裡的小圖缺圖時用的 emoji（學習物件 obj-*、食物 food-*） */
export function bubbleEmoji(name: string): string | undefined {
  return OBJ_EMOJI[name] ?? FOOD_EMOJI[name.replace(/^food-/, '')]
}
