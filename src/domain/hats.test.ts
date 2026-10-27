import { describe, expect, it } from 'vitest'
import { SHOP_ITEMS } from './constants'
import { HATS, HAT_IDS, canWearHat, hatBuyLine, hatEggLine, hatEmptyLine, hatOffLine, hatOf, hatWearLine, isHatId } from './hats'
import { canBuy } from './shop'
import { staticLineList } from '../learning/lines'

describe('帽子目錄', () => {
  it('6 頂帽子，價格依 SPEC：皇冠 250、草帽 120、花 100、廚師 150、派對 80、棒球 90', () => {
    expect(Object.fromEntries(HATS.map((h) => [h.id, h.price]))).toEqual({
      'hat-crown': 250,
      'hat-straw': 120,
      'hat-flower': 100,
      'hat-chef': 150,
      'hat-party': 80,
      'hat-cap': 90,
    })
    expect(HATS.map((h) => h.emoji)).toEqual(['🥳', '🧢', '🌸', '👒', '👨‍🍳', '👑'])
  })
  it('依價格由低到高；都在商店目錄裡、kind 是 hat、素材名等於商品 id', () => {
    expect(HATS.map((h) => h.price)).toEqual([...HATS.map((h) => h.price)].sort((a, b) => a - b))
    for (const h of HATS) expect(SHOP_ITEMS.find((i) => i.id === h.id)).toMatchObject({ kind: 'hat', price: h.price, asset: h.id, name: h.name })
    expect(HAT_IDS).toHaveLength(6)
  })
  it('帽子只能擁有一頂（買過就不能再買），餘額不夠不能買', () => {
    const crown = SHOP_ITEMS.find((i) => i.id === 'hat-crown')!
    expect(canBuy(250, 0, crown)).toEqual({ ok: true })
    expect(canBuy(249, 0, crown)).toEqual({ ok: false, reason: 'insufficient', shortBy: 1 })
    expect(canBuy(999, 1, crown)).toEqual({ ok: false, reason: 'owned' })
  })
  it('辨識與蛋不能戴', () => {
    expect(isHatId('hat-crown')).toBe(true)
    expect(isHatId('banana')).toBe(false)
    expect(hatOf('hat-cap')?.name).toBe('棒球帽')
    expect(canWearHat('egg')).toBe(false)
    expect(canWearHat('baby')).toBe(true)
    expect(canWearHat('adult')).toBe(true)
  })
})

describe('帽子的句子和 STATIC_LINES 一字不差（預錄的媽媽聲才找得到）', () => {
  const texts = new Set(staticLineList().map((l) => l.text))
  it('買到、戴上（預設名字阿悟）', () => {
    for (const h of HATS) {
      expect(texts.has(hatBuyLine(h.name)), hatBuyLine(h.name)).toBe(true)
      expect(texts.has(hatWearLine('阿悟', h.name)), hatWearLine('阿悟', h.name)).toBe(true)
    }
  })
  it('拿下、蛋裡不能戴、還沒有帽子', () => {
    expect(texts.has(hatOffLine())).toBe(true)
    expect(texts.has(hatEggLine('阿悟'))).toBe(true)
    expect(texts.has(hatEmptyLine())).toBe(true)
  })
})
