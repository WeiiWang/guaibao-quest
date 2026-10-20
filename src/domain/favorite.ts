import { FOOD_IDS } from './constants'

/** 字串 → 32 位元雜湊（FNV-1a），純函式、跨裝置一致 */
function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 前一天的日期字串（YYYY-MM-DD，本地日期語意；用 UTC 運算避免夏令時間干擾） */
function prevDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d - 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

const rawPick = (date: string, foods: readonly string[]) => hash32(`gb-fav:${date}`) % foods.length

/**
 * 阿悟「今天最喜歡」的食物：依日期決定，同一天任何時候、任何裝置都一樣。
 * 若跟前一天撞到同一種，往後順延一種，避免連兩天一樣。
 */
export function favoriteFoodOf(date: string, foods: readonly string[] = FOOD_IDS): string {
  const today = rawPick(date, foods)
  const yesterday = rawPick(prevDate(date), foods)
  return foods[today === yesterday ? (today + 1) % foods.length : today]
}

/** 這個食物是不是今天最喜歡的（吃到時愛心加倍、說「最喜歡了！」由寵物端處理） */
export function isFavoriteFood(foodId: string, date: string, foods: readonly string[] = FOOD_IDS): boolean {
  return favoriteFoodOf(date, foods) === foodId
}
