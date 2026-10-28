import { describe, expect, it } from 'vitest'
import { AVAILABLE_RASTER } from '../art/coloring/rasterDefs'
import { FOOD_EFFECTS, FOOD_IDS, foodHearts, SHOP_ITEMS } from './constants'
import { canBuy } from './shop'
import { hashPin, checkPin, isValidPin } from './pin'
import { sha256Hex } from './sha256'

const item = (id: string) => SHOP_ITEMS.find((i) => i.id === id)!

describe('購買', () => {
  it('餘額足夠可買', () => {
    expect(canBuy(10, 0, item('banana'))).toEqual({ ok: true })
  })
  it('餘額不足回傳差額', () => {
    expect(canBuy(4, 0, item('banana'))).toEqual({ ok: false, reason: 'insufficient', shortBy: 6 })
  })
  it('飼料可重複購買、裝飾與著色頁只能一份', () => {
    expect(canBuy(100, 5, item('banana'))).toEqual({ ok: true })
    expect(canBuy(500, 1, item('decor-plant'))).toEqual({ ok: false, reason: 'owned' })
    expect(canBuy(500, 1, item('coloring-fish'))).toEqual({ ok: false, reason: 'owned' })
  })
  it('商店內容符合規格', () => {
    expect(SHOP_ITEMS.filter((i) => i.kind === 'decor')).toHaveLength(24)
    expect(SHOP_ITEMS.filter((i) => i.kind === 'food')).toHaveLength(10)
    expect(SHOP_ITEMS.filter((i) => i.kind === 'theme' && i.themeSlot === 'wall')).toHaveLength(5)
    expect(SHOP_ITEMS.filter((i) => i.kind === 'theme' && i.themeSlot === 'floor')).toHaveLength(3)
    expect(SHOP_ITEMS.filter((i) => i.kind === 'decor').every((i) => i.slot === 'wall' || i.slot === 'floor')).toBe(true)
    expect(SHOP_ITEMS.filter((i) => i.kind === 'coloring')).toHaveLength(18 + AVAILABLE_RASTER.length)
    expect(SHOP_ITEMS.filter((i) => i.kind === 'decor').every((i) => i.price >= 40 && i.price <= 300)).toBe(true)
  })
  it('食物：10 種、價格與飽足值都遞增（蛋糕最貴、飽足最多並會跳舞）', () => {
    const foods = SHOP_ITEMS.filter((i) => i.kind === 'food')
    expect(foods.map((f) => f.id)).toEqual([...FOOD_IDS])
    for (let i = 1; i < foods.length; i++) {
      expect(foods[i].price).toBeGreaterThan(foods[i - 1].price)
      expect(FOOD_EFFECTS[foods[i].id].hunger).toBeGreaterThan(FOOD_EFFECTS[foods[i - 1].id].hunger)
    }
    expect(foods.at(-1)?.id).toBe('cake')
    expect(FOOD_EFFECTS.cake).toMatchObject({ hunger: 100, special: 'dance' })
    expect(Object.keys(FOOD_EFFECTS).sort()).toEqual([...FOOD_IDS].sort())
  })
  it('飽足值換算愛心 1–5 顆', () => {
    expect(foodHearts('carrot')).toBe(1)
    expect(foodHearts('banana')).toBe(2)
    expect(foodHearts('peach')).toBe(3)
    expect(foodHearts('cake')).toBe(5)
    expect(foodHearts('???')).toBe(0)
  })
  it('商品 id 不重複', () => {
    const ids = SHOP_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('PIN / SHA-256', () => {
  it('SHA-256 標準測試向量', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('a'.repeat(100))).toBe('2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e')
  })
  it('PIN 驗證', () => {
    const h = hashPin('1234')
    expect(checkPin('1234', h)).toBe(true)
    expect(checkPin('1235', h)).toBe(false)
    expect(isValidPin('123')).toBe(false)
    expect(isValidPin('12a4')).toBe(false)
    expect(isValidPin('1234')).toBe(true)
  })
})
