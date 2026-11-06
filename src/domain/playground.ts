import { FOOD_IDS } from './constants'

// v8.3 遊樂場：玩法清單與「玩完送食物」的規則（純函式）。獎勵固定，不靠機率。

export const PLAY_GAME_IDS = ['bubbles', 'hide', 'catch', 'memory', 'music', 'bath', 'bakery', 'garden', 'talk'] as const
/** v8.4 小鎮的 8 個地方：一樣用 GameShell 與同一個每日獎勵上限 */
export const TOWN_GAME_IDS = ['doctor', 'bedtime', 'market', 'juice', 'blocks', 'puzzle', 'drive', 'photo'] as const
export type TownGameId = (typeof TOWN_GAME_IDS)[number]
export type PlayGameId = (typeof PLAY_GAME_IDS)[number] | TownGameId

const ALL_IDS: readonly string[] = [...PLAY_GAME_IDS, ...TOWN_GAME_IDS]

export const isPlayGameId = (s: string): s is PlayGameId => ALL_IDS.includes(s)
export const isTownGame = (id: PlayGameId): id is TownGameId => (TOWN_GAME_IDS as readonly string[]).includes(id)

export interface PlayGameMeta {
  id: PlayGameId
  label: string
  /** 3D 圖示：public/art/<icon>.png */
  icon: string
  /** 圖還沒生好時的退路 */
  emoji: string
  tone: 'mint' | 'lavender' | 'bubblegum' | 'butter' | 'sky'
}

export const PLAY_GAMES: readonly PlayGameMeta[] = [
  { id: 'bubbles', label: '泡泡派對', icon: 'ui-game-bubbles', emoji: '🫧', tone: 'sky' },
  { id: 'hide', label: '捉迷藏', icon: 'ui-game-hide', emoji: '🌳', tone: 'mint' },
  { id: 'catch', label: '接水果', icon: 'ui-game-catch', emoji: '🧺', tone: 'butter' },
  { id: 'memory', label: '翻翻配對', icon: 'ui-game-memory', emoji: '🃏', tone: 'bubblegum' },
  { id: 'music', label: '音樂會', icon: 'ui-game-music', emoji: '🎵', tone: 'lavender' },
  { id: 'bath', label: '洗澎澎', icon: 'ui-game-bath', emoji: '🛁', tone: 'sky' },
  { id: 'bakery', label: '點心屋', icon: 'ui-game-bakery', emoji: '🍰', tone: 'bubblegum' },
  { id: 'garden', label: '小菜園', icon: 'ui-game-garden', emoji: '🌱', tone: 'mint' },
  { id: 'talk', label: '學我說話', icon: 'ui-game-talk', emoji: '🎤', tone: 'lavender' },
]

/** 小鎮街上的 8 棟建築（順序就是街上由左到右） */
export const TOWN_GAMES: readonly PlayGameMeta[] = [
  { id: 'doctor', label: '寵物醫院', icon: 'ui-town-doctor', emoji: '🏥', tone: 'mint' },
  { id: 'market', label: '超市', icon: 'ui-town-market', emoji: '🛒', tone: 'butter' },
  { id: 'juice', label: '果汁攤', icon: 'ui-town-juice', emoji: '🧃', tone: 'bubblegum' },
  { id: 'photo', label: '照相館', icon: 'ui-town-photo', emoji: '📷', tone: 'bubblegum' },
  { id: 'blocks', label: '積木工地', icon: 'ui-town-blocks', emoji: '🧱', tone: 'butter' },
  { id: 'puzzle', label: '拼圖屋', icon: 'ui-town-puzzle', emoji: '🧩', tone: 'lavender' },
  { id: 'drive', label: '開車兜風', icon: 'ui-town-drive', emoji: '🚗', tone: 'sky' },
  { id: 'bedtime', label: '晚安小屋', icon: 'ui-town-bedtime', emoji: '🌙', tone: 'lavender' },
]

/** 遊樂場一天最多送幾個食物 */
export const PLAY_DAILY_CAP = 3

/** 學我說話不送禮物：不鼓勵為了獎勵開麥克風。小菜園的獎勵是收成本身 */
const NO_REWARD: readonly PlayGameId[] = ['talk', 'garden']

/** 這一天第 n 份（從 0 算）送哪個食物：依日期決定起點，再固定輪替 */
export function playRewardFood(date: string, n: number, foods: readonly string[] = FOOD_IDS): string {
  const day = Number(date.replaceAll('-', ''))
  return foods[(day + n) % foods.length]
}

export interface PlayDaily {
  date: string
  done: string[]
}

/** 玩完一個玩法：回傳新的當日紀錄與要送的食物（沒得送就沒有 foodId，紀錄也不用寫） */
export function settlePlayGame(daily: PlayDaily | undefined, date: string, gameId: PlayGameId): { daily: PlayDaily; foodId: string | null } {
  const cur: PlayDaily = daily?.date === date ? daily : { date, done: [] }
  if (NO_REWARD.includes(gameId) || cur.done.includes(gameId) || cur.done.length >= PLAY_DAILY_CAP) return { daily: cur, foodId: null }
  return { daily: { date, done: [...cur.done, gameId] }, foodId: playRewardFood(date, cur.done.length) }
}
