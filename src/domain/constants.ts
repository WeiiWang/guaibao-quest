import { THEME_DEFS } from './theme'
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
/** 飽足 ≥ 這個值就吃不下了：餵食不扣食物，阿悟搖頭說「我吃飽了～」 */
export const FULL_HUNGER = 95
/** 輕點餵食的最短間隔（ms）：小孩狂點只算一次 */
export const TAP_FEED_GAP_MS = 800
/** 剛買的東西可以在這段時間內退回（畫面上的「退回」按鈕存在多久） */
export const PURCHASE_UNDO_MS = 5000
/** 送給新使用者的免費著色頁（著色本一開始就有東西可畫，不是死路） */
export const FREE_COLORING_PAGES = ['monkey', 'banana-tree'] as const
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
  // v3：西遊記主題
  'staff',
  'wukong-cloud',
  'peach-garden',
  'water-curtain',
  'dragon-fish',
  'tang-horse',
  'flower-fruit-mountain',
  'flame-mountain',
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
  staff: '金箍棒',
  'wukong-cloud': '筋斗雲上的阿悟',
  'peach-garden': '蟠桃園',
  'water-curtain': '水簾洞',
  'dragon-fish': '龍宮小魚',
  'tang-horse': '唐僧的馬',
  'flower-fruit-mountain': '花果山',
  'flame-mountain': '火焰山',
}

export const COLORING_PRICE = 30
/** 西遊記主題著色頁（較複雜）售價 */
export const COLORING_PRICE_JOURNEY = 40
const JOURNEY_PAGES: readonly string[] = [
  'staff',
  'wukong-cloud',
  'peach-garden',
  'water-curtain',
  'dragon-fish',
  'tang-horse',
  'flower-fruit-mountain',
  'flame-mountain',
]

/**
 * 飼料效果：hunger = 增加的飽足值（滿 100）、feed = 算幾次餵食（影響成長）。
 * special：吃到時的特別反應，由寵物行為端（RoomView）解讀；目前只有蛋糕 'dance'（阿悟跳舞）。
 */
export interface FoodEffect {
  hunger: number
  feed: number
  special?: 'dance'
}
export const FOOD_EFFECTS: Record<string, FoodEffect> = {
  carrot: { hunger: 15, feed: 1 },
  cookie: { hunger: 20, feed: 1 },
  banana: { hunger: 25, feed: 1 },
  apple: { hunger: 30, feed: 1 },
  grape: { hunger: 35, feed: 1 },
  milk: { hunger: 40, feed: 1 },
  peach: { hunger: 50, feed: 2 },
  riceball: { hunger: 60, feed: 2 },
  watermelon: { hunger: 75, feed: 2 },
  cake: { hunger: 100, feed: 3, special: 'dance' },
}

/** 食物 id，依價格由低到高（商店與房間飼料列的順序） */
export const FOOD_IDS = ['carrot', 'cookie', 'banana', 'apple', 'grape', 'milk', 'peach', 'riceball', 'watermelon', 'cake'] as const

/** 飽足值換成幾顆小愛心（1–5）：每 20 點一顆，進位 */
export const foodHearts = (foodId: string): number => Math.min(5, Math.ceil((FOOD_EFFECTS[foodId]?.hunger ?? 0) / 20))

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'carrot', kind: 'food', name: '胡蘿蔔', price: 6, asset: 'carrot' },
  { id: 'cookie', kind: 'food', name: '餅乾', price: 8, asset: 'cookie' },
  { id: 'banana', kind: 'food', name: '香蕉', price: 10, asset: 'banana' },
  { id: 'apple', kind: 'food', name: '蘋果', price: 12, asset: 'apple' },
  { id: 'grape', kind: 'food', name: '葡萄', price: 15, asset: 'grape' },
  { id: 'milk', kind: 'food', name: '牛奶', price: 18, asset: 'milk' },
  { id: 'peach', kind: 'food', name: '桃子', price: 20, asset: 'peach' },
  { id: 'riceball', kind: 'food', name: '飯糰', price: 25, asset: 'riceball' },
  { id: 'watermelon', kind: 'food', name: '西瓜', price: 35, asset: 'watermelon' },
  { id: 'cake', kind: 'food', name: '蛋糕', price: 60, asset: 'cake' },
  // 家具：star 價格只是參考，v2 起改由工坊用材料製作（成本見 learning/materials.ts）
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
  { id: 'decor-bunting', kind: 'decor', name: '三角彩旗', price: 80, asset: 'bunting', slot: 'wall' },
  { id: 'decor-wallshelf', kind: 'decor', name: '牆上層板', price: 100, asset: 'wallshelf', slot: 'wall' },
  { id: 'decor-monstera', kind: 'decor', name: '龜背芋', price: 100, asset: 'monstera', slot: 'floor' },
  { id: 'decor-lamp', kind: 'decor', name: '落地燈', price: 100, asset: 'lamp', slot: 'floor' },
  { id: 'decor-beanbag', kind: 'decor', name: '懶骨頭', price: 120, asset: 'beanbag', slot: 'floor' },
  { id: 'decor-fishbowl', kind: 'decor', name: '魚缸', price: 120, asset: 'fishbowl', slot: 'floor' },
  { id: 'decor-table', kind: 'decor', name: '桌椅', price: 140, asset: 'table', slot: 'floor' },
  { id: 'decor-cloudlamp', kind: 'decor', name: '雲朵夜燈', price: 140, asset: 'cloudlamp', slot: 'floor' },
  { id: 'decor-rainbow', kind: 'decor', name: '彩虹', price: 160, asset: 'rainbow', slot: 'wall' },
  { id: 'decor-tent', kind: 'decor', name: '帳篷', price: 180, asset: 'tent', slot: 'floor' },
  { id: 'decor-car', kind: 'decor', name: '小汽車', price: 180, asset: 'car', slot: 'floor' },
  { id: 'decor-dino', kind: 'decor', name: '恐龍', price: 200, asset: 'dino', slot: 'floor' },
  { id: 'decor-piano', kind: 'decor', name: '小鋼琴', price: 240, asset: 'piano', slot: 'floor' },
  { id: 'decor-rocket', kind: 'decor', name: '火箭', price: 280, asset: 'rocket', slot: 'floor' },
  // 壁紙 / 地板：同樣在工坊用材料製作（成本見 domain/theme.ts），price 只是參考
  ...THEME_DEFS.filter((t) => !t.isDefault).map(
    (t): ShopItem => ({ id: t.id, kind: 'theme', name: t.name, price: 0, asset: t.id, themeSlot: t.slot, cost: t.cost }),
  ),
  ...COLORING_PAGE_IDS.map(
    (p): ShopItem => ({
      id: `coloring-${p}`,
      kind: 'coloring',
      name: `著色頁：${COLORING_NAMES[p]}`,
      price: JOURNEY_PAGES.includes(p) ? COLORING_PRICE_JOURNEY : COLORING_PRICE,
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
