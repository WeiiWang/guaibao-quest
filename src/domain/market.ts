import { FOOD_IDS } from './constants'
import { dayNumber } from './parentTips'
import type { AgeBand } from './types'

// v8.4 超市（純函式）：購物清單怎麼輪、購物車放得下多少、價錢怎麼算、投幣與找零。
// 這是孩子的數學練習：價錢、付了多少、找多少都要算對，所以全部在這裡、全部有單元測試。
// 沒有輸：買錯、多拿、投不夠都只是等著或多一個選擇，不扣任何東西。硬幣是玩具硬幣，不是星星。

export type MarketFood = (typeof FOOD_IDS)[number]

/** 貨架上的食物：3 歲 8 種（少一點比較好找），其他 10 種（全部） */
export function marketShelf(band: AgeBand): readonly MarketFood[] {
  // 3 歲拿掉最像的兩樣（飯糰、蛋糕），留下一眼就認得的蔬果、餅乾、牛奶
  return band === '3' ? FOOD_IDS.filter((f) => f !== 'riceball' && f !== 'cake') : FOOD_IDS
}

/** 清單上的一行：要哪一種、要幾個（1 或 2） */
export interface MarketLine {
  id: MarketFood
  qty: number
}

/** 清單有幾種：3 歲 2 種、4–5 歲 3 種、6–7 歲 4 種 */
export const MARKET_KINDS: Record<AgeBand, number> = { '3': 2, '4-5': 3, '6-7': 4 }

/** 購物車最多放幾個：4–5 歲 5 個（價錢用點點，最多 5 點）；其他 6 個 */
export const MARKET_CART_MAX: Record<AgeBand, number> = { '3': 6, '4-5': 5, '6-7': 6 }

/** 6–7 歲的單價（1–5 元）。越大越貴，孩子看得懂：西瓜、蛋糕最貴，紅蘿蔔最便宜 */
export const MARKET_PRICE: Record<MarketFood, number> = {
  carrot: 1,
  cookie: 2,
  banana: 2,
  apple: 3,
  grape: 4,
  milk: 3,
  peach: 4,
  riceball: 3,
  watermelon: 5,
  cake: 5,
}

/** 6–7 歲一次最多付多少（價錢是 5–20） */
export const MARKET_MAX_BILL = 20
export const MARKET_MIN_BILL = 5

/** 玩具硬幣的面額 */
export const MARKET_COINS = [1, 5, 10] as const
export type Coin = (typeof MARKET_COINS)[number]

/** 這個年齡檔可以投哪些硬幣：4–5 歲只有 1 元（點點一個對一個）；3 歲、6–7 歲三種都有 */
export const marketCoinsFor = (band: AgeBand): readonly Coin[] => (band === '4-5' ? [1] : MARKET_COINS)

/** 走清單時的步長：跟 8、10 都互質，所以一張清單裡不會重複，一天一天換也會走遍整個貨架 */
const STRIDE = 3

/**
 * 今天第 round 張購物清單（round 從 0 起算，每買完一次 +1）。依日期與 round 固定輪替，不用亂數：
 * 同一天同一回永遠同一張，下一回換下一張。
 * - 3 歲：2 種，每種 1 個（先練「找到一樣的」）
 * - 4–5 歲：3 種，偶數回有一種要 2 個（總數 ≤ 4，付錢時最多 5 點）
 * - 6–7 歲：4 種，最便宜的那種要 2 個（總價不超過 20 才加）；總價固定在 5–20
 */
export function marketList(date: string, round: number, band: AgeBand): MarketLine[] {
  const shelf = marketShelf(band)
  const n = shelf.length
  // 隔天往後挪 3 格（跟 8、10 都互質，一段時間會輪遍貨架），下一回挪 1 格
  const seed = dayNumber(date) * 3 + round
  const start = ((seed % n) + n) % n
  const kinds = MARKET_KINDS[band]
  const lines: MarketLine[] = []
  for (let k = 0; k < kinds; k++) lines.push({ id: shelf[(start + k * STRIDE) % n], qty: 1 })
  if (band === '4-5' && seed % 2 === 0) lines[seed % kinds].qty = 2
  if (band === '6-7') {
    const cheapest = lines.reduce((a, b) => (MARKET_PRICE[b.id] < MARKET_PRICE[a.id] ? b : a))
    if (marketListTotal(lines) + MARKET_PRICE[cheapest.id] <= MARKET_MAX_BILL) cheapest.qty = 2
  }
  return lines
}

/** 清單全部照單買要多少錢（6–7 歲的單價） */
export const marketListTotal = (lines: readonly MarketLine[]): number => lines.reduce((s, l) => s + MARKET_PRICE[l.id] * l.qty, 0)

/** 清單上的東西總共幾個 */
export const marketListUnits = (lines: readonly MarketLine[]): number => lines.reduce((s, l) => s + l.qty, 0)

/** 購物車裡某種有幾個 */
export const countIn = (cart: readonly string[], id: string): number => cart.filter((c) => c === id).length

/** 清單上這一行買夠了沒（打勾） */
export const marketLineDone = (line: MarketLine, cart: readonly string[]): boolean => countIn(cart, line.id) >= line.qty

/** 清單全部買齊了沒 */
export const marketListDone = (lines: readonly MarketLine[], cart: readonly string[]): boolean => lines.every((l) => marketLineDone(l, cart))

/**
 * 購物車裡「清單外」的東西（拿錯的、多拿的），結帳時寵物會問「這個也想要嗎？」。
 * 回傳的是在 cart 裡的索引，同一種多拿的只算多出來的那幾個（從後面算）。
 */
export function marketExtras(lines: readonly MarketLine[], cart: readonly string[]): number[] {
  const want = new Map(lines.map((l) => [l.id as string, l.qty]))
  const seen = new Map<string, number>()
  const out: number[] = []
  cart.forEach((id, i) => {
    const n = (seen.get(id) ?? 0) + 1
    seen.set(id, n)
    if (n > (want.get(id) ?? 0)) out.push(i)
  })
  return out
}

/** 這個東西還放得進購物車嗎（放不下的會彈回貨架，不是做錯） */
export function marketCanAdd(band: AgeBand, cart: readonly string[], id: MarketFood): boolean {
  if (cart.length >= MARKET_CART_MAX[band]) return false
  if (band === '6-7') return marketBill(band, [...cart, id]) <= MARKET_MAX_BILL
  return true
}

/**
 * 要付多少：
 * - 3 歲：不算錢（回傳 1：隨便投一枚就好）
 * - 4–5 歲：一樣東西 1 元，用點點表示（1–5）
 * - 6–7 歲：每樣的單價加起來（5–20）
 */
export function marketBill(band: AgeBand, cart: readonly string[]): number {
  if (band === '3') return 1
  if (band === '4-5') return Math.max(1, Math.min(MARKET_CART_MAX['4-5'], cart.length))
  return cart.reduce((s, id) => s + (MARKET_PRICE[id as MarketFood] ?? 0), 0)
}

/** 投了這些硬幣，一共付了多少 */
export const coinSum = (coins: readonly number[]): number => coins.reduce((s, c) => s + c, 0)

export interface PayState {
  /** 付了多少 */
  paid: number
  /** 付夠了沒（夠了就收下、不能再投） */
  enough: boolean
  /** 要找多少（付夠才有意義） */
  change: number
}

/** 目前的付款狀態。3 歲投一枚就算付好了，不找錢（不是數學題） */
export function marketPay(band: AgeBand, bill: number, coins: readonly number[]): PayState {
  const paid = coinSum(coins)
  if (band === '3') return { paid, enough: coins.length >= 1, change: 0 }
  const enough = paid >= bill
  return { paid, enough, change: enough ? paid - bill : 0 }
}

/** 找零用哪些硬幣：先用大的（10 → 5 → 1），硬幣數最少 */
export function marketChangeCoins(change: number): Coin[] {
  const out: Coin[] = []
  let left = Math.max(0, Math.floor(change))
  for (const c of [10, 5, 1] as const) {
    while (left >= c) {
      out.push(c)
      left -= c
    }
  }
  return out
}
