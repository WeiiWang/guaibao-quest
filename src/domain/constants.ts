import type { ShopItem, TaskTemplate } from './types'

/** 所有可調數值集中在這裡 */
export const DAILY_POINT_CAP = 100
export const HUNGER_MAX = 100
export const HUNGER_DECAY_PER_HOUR = 4
export const START_HUNGER = 80
export const HAPPY_MIN_HUNGER = 60
export const NORMAL_MIN_HUNGER = 30
export const BABY_AT_FEED_COUNT = 20
export const ADULT_AT_FEED_COUNT = 80
export const TASK_POINTS_MIN = 10
export const TASK_POINTS_MAX = 30
export const PARENT_IDLE_MS = 5 * 60 * 1000
export const PIN_MAX_FAILS = 5
export const PIN_LOCK_MS = 30 * 1000
export const DEFAULT_PET_NAME = '阿悟'
export const EATING_ANIM_MS = 1600
export const HOUR_MS = 60 * 60 * 1000

export const DEFAULT_TEMPLATES: TaskTemplate[] = [
  { id: 'tpl-homework', title: '寫功課', emoji: '📚', points: 30, repeatDaily: true, active: true, order: 1 },
  { id: 'tpl-toys', title: '收玩具', emoji: '🧸', points: 20, repeatDaily: true, active: true, order: 2 },
  { id: 'tpl-read', title: '看書 10 分鐘', emoji: '📖', points: 20, repeatDaily: true, active: true, order: 3 },
  { id: 'tpl-brush', title: '刷牙', emoji: '🪥', points: 10, repeatDaily: true, active: true, order: 4 },
  { id: 'tpl-dress', title: '自己穿衣服', emoji: '👕', points: 10, repeatDaily: true, active: true, order: 5 },
]

export const COLORING_PAGE_IDS = [
  'monkey',
  'banana-tree',
  'clouds',
  'nimbus',
  'house',
  'fish',
  'flower',
  'car',
  'sun-moon',
  'chick',
] as const

export const COLORING_NAMES: Record<string, string> = {
  monkey: '小猴子',
  'banana-tree': '香蕉樹',
  clouds: '雲朵彩虹',
  nimbus: '筋斗雲',
  house: '小房子',
  fish: '小魚',
  flower: '花朵',
  car: '小汽車',
  'sun-moon': '太陽月亮',
  chick: '小雞',
}

export const COLORING_PRICE = 30

/** 飼料效果 */
export const FOOD_EFFECTS: Record<string, { hunger: number; feed: number }> = {
  banana: { hunger: 25, feed: 1 },
  peach: { hunger: 50, feed: 2 },
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'banana', kind: 'food', name: '香蕉', price: 10, asset: 'banana' },
  { id: 'peach', kind: 'food', name: '桃子', price: 20, asset: 'peach' },
  { id: 'decor-clock', kind: 'decor', name: '時鐘', price: 40, asset: 'clock', slot: 'wall' },
  { id: 'decor-ball', kind: 'decor', name: '玩具球', price: 40, asset: 'ball', slot: 'floor' },
  { id: 'decor-plant', kind: 'decor', name: '小盆栽', price: 50, asset: 'plant', slot: 'floor' },
  { id: 'decor-crate', kind: 'decor', name: '木箱', price: 60, asset: 'crate', slot: 'floor' },
  { id: 'decor-poster', kind: 'decor', name: '香蕉海報', price: 70, asset: 'poster', slot: 'wall' },
  { id: 'decor-curtain', kind: 'decor', name: '小窗簾', price: 80, asset: 'curtain', slot: 'wall' },
  { id: 'decor-rug', kind: 'decor', name: '圓地毯', price: 90, asset: 'rug', slot: 'floor' },
  { id: 'decor-shelf', kind: 'decor', name: '書架', price: 150, asset: 'shelf', slot: 'floor' },
  { id: 'decor-frame', kind: 'decor', name: '星星畫框', price: 150, asset: 'frame', slot: 'wall' },
  { id: 'decor-bed', kind: 'decor', name: '小床', price: 200, asset: 'bed', slot: 'floor' },
  ...COLORING_PAGE_IDS.map(
    (p): ShopItem => ({
      id: `coloring-${p}`,
      kind: 'coloring',
      name: `著色頁：${COLORING_NAMES[p]}`,
      price: COLORING_PRICE,
      asset: p,
    }),
  ),
]

/** 舊版（v1）裝飾陣列遷移成擺放資料時用的預設位置（比例） */
export const LEGACY_DECOR_POSITIONS: Record<string, { x: number; y: number }> = {
  'decor-plant': { x: 0.12, y: 0.78 },
  'decor-rug': { x: 0.3, y: 0.88 },
  'decor-frame': { x: 0.42, y: 0.22 },
}
