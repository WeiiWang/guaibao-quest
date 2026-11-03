// v8.1 線 Q：節慶（純函式）。依日期決定現在是哪個節慶、掛哪張牆面掛飾、寵物說哪一句、送哪件紀念家具。
// 原則：不顯示倒數、不寫「限定」「快結束」；當年錯過，隔年還會再來。
import type { ShopItem } from './types'

export type FestivalId = 'cny' | 'children' | 'dragon' | 'moon' | 'xmas'

type MonthDay = readonly [month: number, day: number]

/**
 * 農曆節日的國曆日期（2026–2035，中原標準時間 UTC+8）：春節（正月初一）、端午（五月初五）、中秋（八月十五）。
 * 查表、不在執行時計算；season.test.ts 用 Node 的 Intl 中國曆核對。
 * 注意：Intl（ICU）有兩天算錯，表以正確的為準，見測試裡的 ICU_KNOWN_WRONG。
 */
export const LUNAR_TABLE: Readonly<Record<number, { cny: MonthDay; dragon: MonthDay; moon: MonthDay }>> = {
  2026: { cny: [2, 17], dragon: [6, 19], moon: [9, 25] },
  2027: { cny: [2, 6], dragon: [6, 9], moon: [9, 15] },
  2028: { cny: [1, 26], dragon: [5, 28], moon: [10, 3] },
  2029: { cny: [2, 13], dragon: [6, 16], moon: [9, 22] },
  2030: { cny: [2, 3], dragon: [6, 5], moon: [9, 12] },
  2031: { cny: [1, 23], dragon: [6, 24], moon: [10, 1] },
  2032: { cny: [2, 11], dragon: [6, 12], moon: [9, 19] },
  2033: { cny: [1, 31], dragon: [6, 1], moon: [9, 8] },
  2034: { cny: [2, 19], dragon: [6, 20], moon: [9, 27] },
  2035: { cny: [2, 8], dragon: [6, 10], moon: [9, 16] },
}

export interface FestivalDef {
  id: FestivalId
  /** 節日的國曆日期；農曆節日超出查表範圍回 null（那一年就不出現，不會算錯日子） */
  dateIn: (year: number) => MonthDay | null
  /** 節日前幾天開始出現 */
  before: number
  /** 節日後幾天還留著 */
  after: number
  /** 牆面掛飾 public/art/<art>.png */
  art: string
  /** 紀念家具（商品 id = 圖名） */
  keepsake: ShopItem
  /** 第一次看到當節掛飾時寵物說的話（寵物聲，key = pet.fest.<id>） */
  line: string
  /** 回憶卡上的一句話（旁白聲，key = play.fest.card.<id>）；不放寵物名字，才能預錄 */
  caption: string
}

const lunar = (k: 'cny' | 'dragon' | 'moon') => (year: number) => LUNAR_TABLE[year]?.[k] ?? null
const decor = (id: string, name: string): ShopItem => ({ id, kind: 'decor', name, price: 0, asset: id.replace('decor-', ''), slot: 'floor' })

export const FESTIVALS: readonly FestivalDef[] = [
  { id: 'cny', dateIn: lunar('cny'), before: 3, after: 7, art: 'ui-fest-cny', keepsake: decor('decor-fest-lion', '小舞獅'), line: '新年快樂！紅燈籠好漂亮！', caption: '我們一起過春節，收到小舞獅！' },
  { id: 'children', dateIn: () => [4, 4], before: 3, after: 3, art: 'ui-fest-children', keepsake: decor('decor-fest-balloon', '一束氣球'), line: '兒童節快樂！我們一起玩！', caption: '我們一起過兒童節，收到一束氣球！' },
  { id: 'dragon', dateIn: lunar('dragon'), before: 3, after: 2, art: 'ui-fest-dragon', keepsake: decor('decor-fest-dragonboat', '小龍舟'), line: '端午節到了！粽子香香的！', caption: '我們一起過端午節，收到小龍舟！' },
  { id: 'moon', dateIn: lunar('moon'), before: 3, after: 3, art: 'ui-fest-moon', keepsake: decor('decor-fest-rabbitlamp', '兔子燈'), line: '中秋節到了！月亮圓圓的！', caption: '我們一起過中秋節，收到兔子燈！' },
  { id: 'xmas', dateIn: () => [12, 25], before: 7, after: 3, art: 'ui-fest-xmas', keepsake: decor('decor-fest-tree', '聖誕樹'), line: '聖誕節到了！鈴鐺叮叮噹！', caption: '我們一起過聖誕節，收到聖誕樹！' },
]

export const FESTIVAL_BY_ID = Object.fromEntries(FESTIVALS.map((f) => [f.id, f])) as Record<FestivalId, FestivalDef>

/** 紀念家具的商品資料：不在 SHOP_ITEMS（不販售、工坊也做不了），送出時才寫進 db.shopItems */
export const FESTIVAL_DECOR: readonly ShopItem[] = FESTIVALS.map((f) => f.keepsake)
export const festivalDecorOf = (id: string): ShopItem | undefined => FESTIVAL_DECOR.find((i) => i.id === id)

/** 現在正在過的節慶：哪一個、算哪一年的（year 是節日當天的國曆年） */
export interface FestivalNow {
  id: FestivalId
  year: number
}

/** 一次節慶的 id（同一個孩子同一年同一個節慶只會有一個） */
export const festivalKey = (f: FestivalNow): string => `${f.id}:${f.year}`

/** 把本地日期換成連續的日數（避開夏令時間與跨月的計算） */
const dayNo = (y: number, m: number, d: number): number => Math.round(Date.UTC(y, m - 1, d) / 86_400_000)

/** ms 這個時間（裝置本地日期）在過哪個節慶；沒有回 null。各節慶的區間不重疊（season.test.ts 檢查） */
export function festivalAt(ms: number): FestivalNow | null {
  const t = new Date(ms)
  const y = t.getFullYear()
  const today = dayNo(y, t.getMonth() + 1, t.getDate())
  for (const f of FESTIVALS) {
    for (const year of [y - 1, y, y + 1]) {
      const md = f.dateIn(year)
      if (!md) continue
      const day = dayNo(year, md[0], md[1])
      if (today >= day - f.before && today <= day + f.after) return { id: f.id, year }
    }
  }
  return null
}

/**
 * 節慶用的日期（ms）；null = 這個環境不演節慶。override 是測試用的日期（localStorage 的 gq-fest-date，YYYY-MM-DD）。
 * - 正式使用者：一律用真實日期，override 寫什麼都沒用
 * - 自動化瀏覽器：預設不演（既有 e2e 不受真實日期影響，12 月跑也一樣），有 override 才演那一天
 * - 開發模式（vite dev）：真實日期，有 override 就用那一天
 */
export function festivalClock(now: number, env: { automated: boolean; dev: boolean; override: string | null }): number | null {
  const m = env.automated || env.dev ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(env.override ?? '') : null
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime()
  return env.automated ? null : now
}
