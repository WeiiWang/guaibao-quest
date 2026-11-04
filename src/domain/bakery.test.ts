import { describe, expect, it } from 'vitest'
import { BAKERY_BASES, BAKERY_TOPPINGS, MAX_TOPPINGS, autoSpot, eatIntervalMs, onBase, snapToBase, sprinkleDots } from './bakery'

describe('點心屋：放在哪裡算放在點心上', () => {
  it('每種底座的中間都算，四個角都不算', () => {
    for (const b of BAKERY_BASES) {
      expect(onBase(b.id, 50, 50)).toBe(true)
      for (const [x, y] of [[0, 0], [100, 0], [0, 100], [100, 100]]) expect(onBase(b.id, x, y)).toBe(false)
    }
  })
  it('冰淇淋是一球加甜筒：甜筒旁邊的空白不算', () => {
    expect(onBase('icecream', 50, 90)).toBe(true)
    expect(onBase('icecream', 10, 85)).toBe(false)
  })
  it('稍微超出吸回邊上，離太遠回傳 null', () => {
    const s = snapToBase('cake', 50, 52 - 38 * 1.1)
    expect(s).not.toBeNull()
    expect(onBase('cake', s!.x, s!.y + 0.01)).toBe(true)
    expect(snapToBase('cake', 50, 50)).toEqual({ x: 50, y: 50 })
    expect(snapToBase('cake', 0, 0)).toBeNull()
    expect(snapToBase('cake', 50, 120)).toBeNull()
  })
})

describe('點心屋：固定的排列', () => {
  it('點一下放上去的位置都在點心上，也不靠亂數', () => {
    for (const b of BAKERY_BASES) {
      const seen = new Set<string>()
      for (let i = 0; i < MAX_TOPPINGS; i++) {
        const p = autoSpot(b.id, i)
        expect(onBase(b.id, p.x, p.y)).toBe(true)
        seen.add(`${p.x},${p.y}`)
        expect(autoSpot(b.id, i)).toEqual(p)
      }
      expect(seen.size).toBe(MAX_TOPPINGS)
    }
  })
  it('糖珠都在點心上，每層不一樣', () => {
    for (const b of BAKERY_BASES) {
      const a = sprinkleDots(b.id, 0)
      for (const d of a) expect(onBase(b.id, d.x, d.y)).toBe(true)
      expect(sprinkleDots(b.id, 1)).not.toEqual(a)
      expect(sprinkleDots(b.id, 0)).toEqual(a)
    }
  })
  it('吃的間隔：少的慢慢吃，30 個也不用等超過 3.5 秒', () => {
    expect(eatIntervalMs(0)).toBe(0)
    expect(eatIntervalMs(1)).toBe(420)
    expect(eatIntervalMs(MAX_TOPPINGS) * MAX_TOPPINGS).toBeLessThanOrEqual(3500)
  })
  it('裝飾有 10 種，id 不重複', () => {
    expect(new Set(BAKERY_TOPPINGS.map((t) => t.id)).size).toBe(10)
  })
})
