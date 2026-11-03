import { describe, expect, it } from 'vitest'
import { GUIDE_HUNGER_LOW, homeGuideTarget } from './homeGuide'

describe('首頁引導只指一件事', () => {
  it('沒有食物：一定是冒險，就算很餓、就算是新手', () => {
    expect(homeGuideTarget({ hasFood: false, hunger: 10, firstFood: true })).toBe('adventure')
    expect(homeGuideTarget({ hasFood: false, hunger: 100, firstFood: false })).toBe('adventure')
  })
  it('有食物而且飽足偏低：指食物', () => {
    expect(homeGuideTarget({ hasFood: true, hunger: GUIDE_HUNGER_LOW - 1, firstFood: false })).toBe('food')
    expect(homeGuideTarget({ hasFood: true, hunger: 0, firstFood: false })).toBe('food')
  })
  it('有食物但吃得飽：指冒險', () => {
    expect(homeGuideTarget({ hasFood: true, hunger: GUIDE_HUNGER_LOW, firstFood: false })).toBe('adventure')
    expect(homeGuideTarget({ hasFood: true, hunger: 90, firstFood: false })).toBe('adventure')
  })
  it('新手剛拿到第一份食物：就算吃得飽也指食物（教他餵食）', () => {
    expect(homeGuideTarget({ hasFood: true, hunger: 90, firstFood: true })).toBe('food')
  })
})
