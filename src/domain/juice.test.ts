import { describe, expect, it } from 'vitest'
import { FOOD_IDS } from './constants'
import {
  JUICE_BLENDER_MAX,
  JUICE_CUSTOMERS,
  JUICE_FRUITS,
  JUICE_PEEK_MS,
  JUICE_PER_ROUND,
  juiceBubbleShown,
  juiceCanAdd,
  juiceColor,
  juiceCustomer,
  juiceKinds,
  juiceMatches,
  juiceOrder,
} from './juice'
import type { AgeBand } from './types'

const BANDS: AgeBand[] = ['3', '4-5', '6-7']
const DATES = Array.from({ length: 120 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 1 + i))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
})

describe('果汁攤：客人', () => {
  it('熊、小雞、牛、兔子固定順序，下一回接著輪', () => {
    expect([0, 1, 2].map((i) => juiceCustomer(0, i))).toEqual(['bear', 'chick', 'cow'])
    expect([0, 1, 2].map((i) => juiceCustomer(1, i))).toEqual(['rabbit', 'bear', 'chick'])
    expect([0, 1, 2].map((i) => juiceCustomer(2, i))).toEqual(['cow', 'rabbit', 'bear'])
  })
  it('同一回 3 位客人不重複', () => {
    for (let r = 0; r < 12; r++) expect(new Set([0, 1, 2].map((i) => juiceCustomer(r, i))).size).toBe(JUICE_PER_ROUND)
    expect(JUICE_CUSTOMERS).toHaveLength(4)
  })
})

describe('果汁攤：點單', () => {
  it('水果都是食物裡的水果', () => {
    for (const f of JUICE_FRUITS) expect(FOOD_IDS).toContain(f)
  })
  it('種類數：3 歲 1、4–5 歲 2、6–7 歲 2 或 3', () => {
    expect(juiceKinds('3', 4)).toBe(1)
    expect(juiceKinds('4-5', 5)).toBe(2)
    expect(juiceKinds('6-7', 0)).toBe(3)
    expect(juiceKinds('6-7', 1)).toBe(2)
    for (const b of BANDS)
      for (const d of DATES)
        for (let r = 0; r < 3; r++)
          for (let i = 0; i < 3; i++) {
            const o = juiceOrder(d, r, i, b)
            if (b === '3') expect(o).toHaveLength(1)
            if (b === '4-5') expect(o).toHaveLength(2)
            if (b === '6-7') expect([2, 3]).toContain(o.length)
            expect(new Set(o).size).toBe(o.length)
            for (const f of o) expect(JUICE_FRUITS).toContain(f)
          }
  })
  it('6–7 歲一回裡 2 種、3 種都會出現', () => {
    const lens = new Set([0, 1, 2].map((i) => juiceOrder('2026-11-06', 0, i, '6-7').length))
    expect(lens).toEqual(new Set([2, 3]))
  })
  it('同一天同一位永遠一樣；連續兩位不一樣', () => {
    for (const b of BANDS) {
      expect(juiceOrder('2026-11-06', 1, 2, b)).toEqual(juiceOrder('2026-11-06', 1, 2, b))
      for (const d of DATES)
        for (let i = 0; i < 2; i++) expect(juiceOrder(d, 0, i, b)).not.toEqual(juiceOrder(d, 0, i + 1, b))
    }
  })
  it('隔天換、下一回也換', () => {
    for (const b of BANDS) {
      expect(juiceOrder('2026-11-06', 0, 0, b)).not.toEqual(juiceOrder('2026-11-07', 0, 0, b))
      expect(juiceOrder('2026-11-06', 0, 0, b)).not.toEqual(juiceOrder('2026-11-06', 1, 0, b))
    }
  })
  it('一段時間下來每種水果都會被點到（3 歲也是）', () => {
    for (const b of BANDS) expect(new Set(DATES.slice(0, 10).flatMap((d) => juiceOrder(d, 0, 0, b))).size).toBe(JUICE_FRUITS.length)
  })
})

describe('果汁攤：做對了沒', () => {
  it('種類一樣就對，順序、重複都不管', () => {
    expect(juiceMatches(['apple', 'banana'], ['banana', 'apple'])).toBe(true)
    expect(juiceMatches(['apple', 'banana'], ['banana', 'apple', 'apple'])).toBe(true)
    expect(juiceMatches(['apple'], ['apple'])).toBe(true)
  })
  it('少了、多了、換了都不對', () => {
    expect(juiceMatches(['apple', 'banana'], ['apple'])).toBe(false)
    expect(juiceMatches(['apple'], ['apple', 'grape'])).toBe(false)
    expect(juiceMatches(['apple', 'banana'], ['apple', 'grape'])).toBe(false)
    expect(juiceMatches(['apple'], [])).toBe(false)
  })
  it('果汁機最多 4 塊', () => {
    expect(juiceCanAdd(Array(JUICE_BLENDER_MAX - 1).fill('apple'))).toBe(true)
    expect(juiceCanAdd(Array(JUICE_BLENDER_MAX).fill('apple'))).toBe(false)
  })
})

describe('果汁攤：顏色', () => {
  it('空的沒有顏色', () => {
    expect(juiceColor([])).toBeNull()
  })
  it('一種水果就是它的顏色；兩種是平均', () => {
    expect(juiceColor(['banana'])).toBe('rgb(255 222 89)')
    expect(juiceColor(['banana', 'grape'])).toBe('rgb(199 149 142)')
    expect(juiceColor(['grape', 'banana'])).toBe(juiceColor(['banana', 'grape']))
  })
  it('放兩塊香蕉比較黃', () => {
    expect(juiceColor(['banana', 'banana', 'grape'])).toBe('rgb(217 173 124)')
  })
})

describe('果汁攤：點單泡泡', () => {
  it('3、4–5 歲一直在', () => {
    expect(juiceBubbleShown('3', 999_999)).toBe(true)
    expect(juiceBubbleShown('4-5', 999_999)).toBe(true)
  })
  it('6–7 歲看 4 秒收起來', () => {
    expect(juiceBubbleShown('6-7', 0)).toBe(true)
    expect(juiceBubbleShown('6-7', JUICE_PEEK_MS - 1)).toBe(true)
    expect(juiceBubbleShown('6-7', JUICE_PEEK_MS)).toBe(false)
  })
})
