import { describe, expect, it } from 'vitest'
import { FOOD_IDS } from './constants'
import { favoriteFoodOf, isFavoriteFood } from './favorite'

const dayStr = (i: number) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

describe('阿悟今天最喜歡的食物', () => {
  it('同一天永遠是同一種，而且一定是有效的食物', () => {
    for (let i = 0; i < 60; i++) {
      const d = dayStr(i)
      expect(favoriteFoodOf(d)).toBe(favoriteFoodOf(d))
      expect(FOOD_IDS).toContain(favoriteFoodOf(d))
    }
  })
  it('一天只有一種是最喜歡的', () => {
    const d = '2026-10-20'
    expect(FOOD_IDS.filter((f) => isFavoriteFood(f, d))).toHaveLength(1)
    expect(isFavoriteFood(favoriteFoodOf(d), d)).toBe(true)
  })
  it('一年內每種食物都輪得到，分布不會太偏', () => {
    const count = new Map<string, number>()
    for (let i = 0; i < 365; i++) count.set(favoriteFoodOf(dayStr(i)), (count.get(favoriteFoodOf(dayStr(i))) ?? 0) + 1)
    expect(count.size).toBe(FOOD_IDS.length)
    for (const n of count.values()) {
      expect(n).toBeGreaterThan(15)
      expect(n).toBeLessThan(70)
    }
  })
  it('連續兩天幾乎不會是同一種（順延規則）', () => {
    let same = 0
    for (let i = 1; i < 365; i++) if (favoriteFoodOf(dayStr(i)) === favoriteFoodOf(dayStr(i - 1))) same++
    expect(same).toBeLessThanOrEqual(8)
  })
  it('可以指定食物清單', () => {
    expect(['a', 'b']).toContain(favoriteFoodOf('2026-10-20', ['a', 'b']))
    expect(favoriteFoodOf('2026-10-20', ['only'])).toBe('only')
  })
})
