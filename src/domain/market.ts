import { FOOD_IDS } from './constants'
import { dayNumber } from './parentTips'
import type { AgeBand } from './types'

// v8.4 超市（純函式）：購物清單怎麼輪、購物車放得下多少、價錢怎麼算、投幣與找零。
// 這是孩子的數學練習：價錢、付了多少、找多少都要算對，所以全部在這裡、全部有單元測試。
// 沒有輸：買錯、多拿、投不夠都只是等著或多一個選擇，不扣任何東西。硬幣是玩具硬幣，不是星星。

// v8.5 新玩具：toys >= 1 貨架和清單多四種不是食物的商品；toys >= 2 可以換成「當老闆」（寵物來買，孩子刷條碼、收錢、找錢）。
// toys === 0 時清單與貨架跟 v8.4 一模一樣。

export type MarketFood = (typeof FOOD_IDS)[number]

/** v8.5 不是食物的新商品（圖是 ui-mkt-<id>）：氣球、皮球、牙刷、肥皂 */
export const MARKET_GOODS = ['balloon', 'ball', 'toothbrush', 'soap'] as const
export type MarketGood = (typeof MARKET_GOODS)[number]
/** 貨架上的東西：食物或新商品 */
export type MarketItem = MarketFood | MarketGood
export const isMarketGood = (id: string): id is MarketGood => (MARKET_GOODS as readonly string[]).includes(id)

/** 貨架上的東西：3 歲 8 種食物（少一點比較好找），其他 10 種（全部）；toys >= 1 再多四種新商品（排在最後一排） */
export function marketShelf(band: AgeBand, toys = 0): readonly MarketItem[] {
  // 3 歲拿掉最像的兩樣（飯糰、蛋糕），留下一眼就認得的蔬果、餅乾、牛奶
  const foods: readonly MarketFood[] = band === '3' ? FOOD_IDS.filter((f) => f !== 'riceball' && f !== 'cake') : FOOD_IDS
  return toys >= 1 ? [...foods, ...MARKET_GOODS] : foods
}

/** 清單上的一行：要哪一種、要幾個（1 或 2） */
export interface MarketLine {
  id: MarketItem
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

/** 新商品的單價（6–7 歲）：皮球最貴，氣球、牙刷便宜 */
export const MARKET_GOOD_PRICE: Record<MarketGood, number> = { balloon: 2, ball: 4, toothbrush: 2, soap: 3 }

/** 一樣東西多少錢（6–7 歲的單價；不認得的當 0） */
export const marketPrice = (id: string): number => (isMarketGood(id) ? MARKET_GOOD_PRICE[id] : (MARKET_PRICE[id as MarketFood] ?? 0))

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
export function marketList(date: string, round: number, band: AgeBand, toys = 0): MarketLine[] {
  // 食物照 v8.4 的規則輪（新商品不參加輪替，所以有沒有新玩具，食物那幾行都一樣）
  const shelf = marketShelf(band)
  const n = shelf.length
  const day = dayNumber(date)
  // 隔天往後挪 3 格（跟 8、10 都互質，一段時間會輪遍貨架），下一回挪 1 格
  const seed = day * 3 + round
  const start = ((seed % n) + n) % n
  const kinds = MARKET_KINDS[band]
  const lines: MarketLine[] = []
  for (let k = 0; k < kinds; k++) lines.push({ id: shelf[(start + k * STRIDE) % n], qty: 1 })
  // v8.5 有新商品時：每張清單的最後一行換成一樣新商品（四種照日期和回數輪流），孩子拿到新玩具的下一張清單就買得到
  if (toys >= 1) lines[kinds - 1] = { id: MARKET_GOODS[(((day + round) % MARKET_GOODS.length) + MARKET_GOODS.length) % MARKET_GOODS.length], qty: 1 }
  if (band === '4-5' && seed % 2 === 0) lines[seed % kinds].qty = 2
  if (band === '6-7') {
    const cheapest = lines.reduce((a, b) => (marketPrice(b.id) < marketPrice(a.id) ? b : a))
    if (marketListTotal(lines) + marketPrice(cheapest.id) <= MARKET_MAX_BILL) cheapest.qty = 2
  }
  return lines
}

/** 清單全部照單買要多少錢（6–7 歲的單價） */
export const marketListTotal = (lines: readonly MarketLine[]): number => lines.reduce((s, l) => s + marketPrice(l.id) * l.qty, 0)

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
export function marketCanAdd(band: AgeBand, cart: readonly string[], id: MarketItem): boolean {
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
  return cart.reduce((s, id) => s + marketPrice(id), 0)
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

// ---- v8.5 當老闆：換寵物來買，孩子刷條碼、收硬幣；6–7 歲要找零 ----

/** 寵物這一回要買的東西（一個一個攤開放在櫃台上）。用跟購物清單同一套輪替，往後錯開幾格，不會跟孩子剛買的那張一樣 */
export function bossOrder(date: string, round: number, band: AgeBand, toys = 0): MarketItem[] {
  return marketList(date, round + 5, band, toys).flatMap((l) => Array.from({ length: l.qty }, () => l.id))
}

/**
 * 寵物拿出來的硬幣：
 * - 3 歲：一枚（收下就完成）
 * - 4–5 歲：比價錢多兩枚 1 元（價錢是點點，孩子一枚對一個點，數到剛好就夠了，多的寵物留著）
 * - 6–7 歲：故意多給，湊到比價錢大的下一個 5 的倍數（10 元、5 元），孩子要找 1–5 元
 */
export function bossOffer(band: AgeBand, bill: number): Coin[] {
  if (band === '3') return [1]
  if (band === '4-5') return Array.from({ length: bill + 2 }, () => 1 as Coin)
  return marketChangeCoins((Math.floor(bill / 5) + 1) * 5)
}

/** 要收幾枚才算收好：3 歲 1 枚、4–5 歲跟點點一樣多、6–7 歲全部收下（再找錢） */
export function bossNeed(band: AgeBand, bill: number): number {
  if (band === '3') return 1
  if (band === '4-5') return bill
  return bossOffer(band, bill).length
}

/** 6–7 歲要找多少（其他年齡不找） */
export const bossChange = (band: AgeBand, bill: number): number => (band === '6-7' ? coinSum(bossOffer(band, bill)) - bill : 0)

/**
 * 找零的三個選項（一個對、兩個差一點），位置依價錢和回數輪流，不靠亂數。
 * 選錯只是寵物搖頭，可以再選。
 */
export function bossChangeOptions(change: number, round: number): number[] {
  const wrong = [change + 1, change > 1 ? change - 1 : change + 2]
  const opts = [change, ...wrong]
  const shift = (((change + round) % 3) + 3) % 3
  return [...opts.slice(shift), ...opts.slice(0, shift)]
}
