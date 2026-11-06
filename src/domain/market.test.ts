import { describe, expect, it } from 'vitest'
import { FOOD_IDS } from './constants'
import {
  MARKET_CART_MAX,
  MARKET_KINDS,
  MARKET_MAX_BILL,
  MARKET_MIN_BILL,
  MARKET_PRICE,
  coinSum,
  countIn,
  marketBill,
  marketCanAdd,
  marketChangeCoins,
  marketCoinsFor,
  marketExtras,
  marketLineDone,
  marketList,
  marketListDone,
  marketListTotal,
  marketListUnits,
  marketPay,
  marketShelf,
  type MarketFood,
} from './market'
import type { AgeBand } from './types'

const BANDS: AgeBand[] = ['3', '4-5', '6-7']
/** 一年份的日期 */
const DATES = Array.from({ length: 366 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
})
const expand = (lines: { id: MarketFood; qty: number }[]) => lines.flatMap((l) => Array<MarketFood>(l.qty).fill(l.id))

describe('超市：貨架', () => {
  it('3 歲 8 種、其他 10 種，都是食物', () => {
    expect(marketShelf('3')).toHaveLength(8)
    expect(marketShelf('4-5')).toHaveLength(10)
    expect(marketShelf('6-7')).toHaveLength(10)
    for (const b of BANDS) for (const f of marketShelf(b)) expect(FOOD_IDS).toContain(f)
  })
  it('單價 1–5 元', () => {
    for (const f of FOOD_IDS) {
      expect(MARKET_PRICE[f]).toBeGreaterThanOrEqual(1)
      expect(MARKET_PRICE[f]).toBeLessThanOrEqual(5)
    }
  })
})

describe('超市：購物清單', () => {
  it('種類數依年齡：2、3、4，不重複，都在貨架上，數量 1 或 2', () => {
    for (const b of BANDS)
      for (const d of DATES.slice(0, 60))
        for (let r = 0; r < 6; r++) {
          const l = marketList(d, r, b)
          expect(l).toHaveLength(MARKET_KINDS[b])
          expect(new Set(l.map((x) => x.id)).size).toBe(l.length)
          for (const x of l) {
            expect(marketShelf(b)).toContain(x.id)
            expect([1, 2]).toContain(x.qty)
          }
        }
  })
  it('3 歲每種都只要 1 個', () => {
    for (const d of DATES) expect(marketList(d, 0, '3').every((l) => l.qty === 1)).toBe(true)
  })
  it('4–5 歲最多 4 個（付錢最多 5 點），而且有時候會要 2 個', () => {
    let twos = 0
    for (const d of DATES)
      for (let r = 0; r < 3; r++) {
        const l = marketList(d, r, '4-5')
        expect(marketListUnits(l)).toBeLessThanOrEqual(4)
        if (l.some((x) => x.qty === 2)) twos++
      }
    expect(twos).toBeGreaterThan(100)
  })
  it('6–7 歲總價在 5–20，照單買一定放得進購物車', () => {
    for (const d of DATES)
      for (let r = 0; r < 4; r++) {
        const l = marketList(d, r, '6-7')
        const total = marketListTotal(l)
        expect(total).toBeGreaterThanOrEqual(MARKET_MIN_BILL)
        expect(total).toBeLessThanOrEqual(MARKET_MAX_BILL)
        expect(marketListUnits(l)).toBeLessThanOrEqual(MARKET_CART_MAX['6-7'])
        // 一個一個放進去都放得下
        const cart: MarketFood[] = []
        for (const id of expand(l)) {
          expect(marketCanAdd('6-7', cart, id)).toBe(true)
          cart.push(id)
        }
        expect(marketBill('6-7', cart)).toBe(total)
      }
  })
  it('同一天同一回永遠一樣（不靠亂數）', () => {
    for (const b of BANDS) expect(marketList('2026-11-06', 2, b)).toEqual(marketList('2026-11-06', 2, b))
  })
  it('下一回換下一張、隔天也換', () => {
    for (const b of BANDS)
      for (const d of DATES.slice(0, 40)) {
        expect(marketList(d, 0, b)).not.toEqual(marketList(d, 1, b))
        expect(marketList(d, 1, b)).not.toEqual(marketList(d, 2, b))
      }
    for (const b of BANDS) expect(marketList('2026-11-06', 0, b)).not.toEqual(marketList('2026-11-07', 0, b))
  })
  it('一段時間下來貨架上每一種都會被點到', () => {
    for (const b of BANDS) {
      const seen = new Set(DATES.slice(0, 30).flatMap((d) => marketList(d, 0, b).map((l) => l.id)))
      expect(seen.size).toBe(marketShelf(b).length)
    }
  })
})

describe('超市：打勾與清單外的東西', () => {
  const list = [
    { id: 'apple' as const, qty: 2 },
    { id: 'milk' as const, qty: 1 },
  ]
  it('買夠了才打勾', () => {
    expect(marketLineDone(list[0], ['apple'])).toBe(false)
    expect(marketLineDone(list[0], ['apple', 'milk', 'apple'])).toBe(true)
    expect(marketListDone(list, ['apple', 'apple'])).toBe(false)
    expect(marketListDone(list, ['apple', 'milk', 'apple'])).toBe(true)
    expect(countIn(['apple', 'milk', 'apple'], 'apple')).toBe(2)
  })
  it('清單外的、多拿的都算 extra（只算多出來的那幾個）', () => {
    expect(marketExtras(list, ['apple', 'milk', 'apple'])).toEqual([])
    expect(marketExtras(list, ['cake', 'apple'])).toEqual([0])
    expect(marketExtras(list, ['milk', 'milk', 'apple', 'apple', 'apple'])).toEqual([1, 4])
  })
})

describe('超市：購物車放得下嗎', () => {
  it('3 歲 6 個、4–5 歲 5 個', () => {
    expect(marketCanAdd('3', Array(5).fill('apple'), 'apple')).toBe(true)
    expect(marketCanAdd('3', Array(6).fill('apple'), 'apple')).toBe(false)
    expect(marketCanAdd('4-5', Array(4).fill('cake'), 'cake')).toBe(true)
    expect(marketCanAdd('4-5', Array(5).fill('carrot'), 'carrot')).toBe(false)
  })
  it('6–7 歲總價不能超過 20', () => {
    expect(marketCanAdd('6-7', ['cake', 'cake', 'cake'], 'cake')).toBe(true) // 20
    expect(marketCanAdd('6-7', ['cake', 'cake', 'cake', 'cake'], 'carrot')).toBe(false) // 21
    expect(marketCanAdd('6-7', ['cake', 'cake', 'cake', 'grape'], 'carrot')).toBe(true) // 20
    expect(marketCanAdd('6-7', Array(6).fill('carrot'), 'carrot')).toBe(false) // 6 個滿了
  })
})

describe('超市：價錢', () => {
  it('3 歲投一枚就好', () => {
    expect(marketBill('3', ['apple', 'cake', 'milk'])).toBe(1)
  })
  it('4–5 歲一樣 1 元（點點 1–5）', () => {
    expect(marketBill('4-5', ['apple'])).toBe(1)
    expect(marketBill('4-5', ['apple', 'apple', 'milk'])).toBe(3)
    expect(marketBill('4-5', Array(5).fill('cake'))).toBe(5)
  })
  it('6–7 歲是單價加起來', () => {
    expect(marketBill('6-7', ['apple', 'apple', 'milk'])).toBe(3 + 3 + 3)
    expect(marketBill('6-7', ['carrot', 'watermelon', 'banana', 'grape'])).toBe(1 + 5 + 2 + 4)
  })
})

describe('超市：投幣與找零', () => {
  it('硬幣加起來', () => {
    expect(coinSum([])).toBe(0)
    expect(coinSum([10, 5, 1, 1])).toBe(17)
  })
  it('4–5 歲只有 1 元；3 歲、6–7 歲有 1、5、10', () => {
    expect(marketCoinsFor('4-5')).toEqual([1])
    expect(marketCoinsFor('3')).toEqual([1, 5, 10])
    expect(marketCoinsFor('6-7')).toEqual([1, 5, 10])
  })
  it('3 歲投哪一枚都算付好了，不找錢', () => {
    expect(marketPay('3', 1, [])).toEqual({ paid: 0, enough: false, change: 0 })
    expect(marketPay('3', 1, [10])).toEqual({ paid: 10, enough: true, change: 0 })
    expect(marketPay('3', 1, [1])).toEqual({ paid: 1, enough: true, change: 0 })
  })
  it('4–5 歲投到跟點點一樣多才算', () => {
    expect(marketPay('4-5', 3, [1, 1]).enough).toBe(false)
    expect(marketPay('4-5', 3, [1, 1, 1])).toEqual({ paid: 3, enough: true, change: 0 })
  })
  it('6–7 歲投不夠就等；剛好不找；投多找零', () => {
    expect(marketPay('6-7', 12, [10])).toEqual({ paid: 10, enough: false, change: 0 })
    expect(marketPay('6-7', 12, [10, 1, 1])).toEqual({ paid: 12, enough: true, change: 0 })
    expect(marketPay('6-7', 12, [10, 5])).toEqual({ paid: 15, enough: true, change: 3 })
    expect(marketPay('6-7', 7, [10])).toEqual({ paid: 10, enough: true, change: 3 })
    expect(marketPay('6-7', 20, [10, 10])).toEqual({ paid: 20, enough: true, change: 0 })
  })
  it('找零用最少的硬幣，加起來剛好', () => {
    expect(marketChangeCoins(0)).toEqual([])
    expect(marketChangeCoins(3)).toEqual([1, 1, 1])
    expect(marketChangeCoins(5)).toEqual([5])
    expect(marketChangeCoins(9)).toEqual([5, 1, 1, 1, 1])
    expect(marketChangeCoins(17)).toEqual([10, 5, 1, 1])
    for (let c = 0; c <= 30; c++) expect(coinSum(marketChangeCoins(c))).toBe(c)
  })
  it('每一種價錢、每一種付法，付的 − 找的 = 價錢', () => {
    for (let bill = MARKET_MIN_BILL; bill <= MARKET_MAX_BILL; bill++)
      for (const coins of [[10, 10], [10, 5, 5], [10, 10, 1], [5, 5, 5, 5, 1], Array(bill).fill(1)]) {
        const p = marketPay('6-7', bill, coins)
        if (!p.enough) continue
        expect(p.paid - coinSum(marketChangeCoins(p.change))).toBe(bill)
      }
  })
})
