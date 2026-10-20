import { describe, expect, it } from 'vitest'
import { FOOD_EFFECTS, HOUR_MS } from './constants'
import { currentHunger, expressionFor, feed, feedsToNextStage, stageForFeedCount } from './pet'
import type { Pet } from './types'

const T0 = 5_000_000
const pet = (over: Partial<Pet> = {}): Pet => ({
  id: 'pet', name: '阿悟', stage: 'egg', feedCount: 0, hunger: 80, hungerUpdatedAt: T0, mood: 'happy', ...over,
})

describe('飢餓衰減', () => {
  it('每小時 -4', () => {
    expect(currentHunger(pet(), T0 + HOUR_MS)).toBe(76)
    expect(currentHunger(pet(), T0 + 5 * HOUR_MS)).toBe(60)
  })
  it('最低 0 且不會變負', () => {
    expect(currentHunger(pet(), T0 + 1000 * HOUR_MS)).toBe(0)
  })
  it('時鐘倒退不增加飢餓度', () => {
    expect(currentHunger(pet(), T0 - HOUR_MS)).toBe(80)
  })
  it('表情門檻', () => {
    expect(expressionFor(100)).toBe('happy')
    expect(expressionFor(60)).toBe('happy')
    expect(expressionFor(59)).toBe('normal')
    expect(expressionFor(30)).toBe('normal')
    expect(expressionFor(29)).toBe('low')
    expect(expressionFor(0)).toBe('low')
  })
})

describe('餵食與成長', () => {
  it('香蕉 +25 飢餓、+1 次數；上限 100', () => {
    const r = feed(pet({ hunger: 90 }), FOOD_EFFECTS.banana, T0)
    expect(r.pet.hunger).toBe(100)
    expect(r.pet.feedCount).toBe(1)
  })
  it('餵食先結算衰減再加', () => {
    const r = feed(pet({ hunger: 40 }), FOOD_EFFECTS.peach, T0 + 5 * HOUR_MS)
    expect(r.pet.hunger).toBe(70)
    expect(r.pet.hungerUpdatedAt).toBe(T0 + 5 * HOUR_MS)
    expect(r.pet.feedCount).toBe(2)
  })
  it('飢餓度 0 時餵食恢復', () => {
    const r = feed(pet({ hunger: 0 }), FOOD_EFFECTS.banana, T0)
    expect(r.pet.hunger).toBe(25)
    expect(r.pet.mood).toBe('low')
    expect(feed(r.pet, FOOD_EFFECTS.peach, T0).pet.mood).toBe('happy')
  })
  it('成長門檻 20 / 80', () => {
    expect(stageForFeedCount(19)).toBe('egg')
    expect(stageForFeedCount(20)).toBe('baby')
    expect(stageForFeedCount(79)).toBe('baby')
    expect(stageForFeedCount(80)).toBe('adult')
  })
  it('孵化與進化回報', () => {
    expect(feed(pet({ feedCount: 19 }), FOOD_EFFECTS.banana, T0).evolvedTo).toBe('baby')
    expect(feed(pet({ feedCount: 19 }), FOOD_EFFECTS.peach, T0).pet.stage).toBe('baby')
    expect(feed(pet({ stage: 'baby', feedCount: 79 }), FOOD_EFFECTS.banana, T0).evolvedTo).toBe('adult')
    expect(feed(pet({ feedCount: 3 }), FOOD_EFFECTS.banana, T0).evolvedTo).toBeNull()
  })
  it('距離下一階段次數', () => {
    expect(feedsToNextStage(pet({ feedCount: 5 }))).toBe(15)
    expect(feedsToNextStage(pet({ stage: 'baby', feedCount: 30 }))).toBe(50)
    expect(feedsToNextStage(pet({ stage: 'adult', feedCount: 90 }))).toBeNull()
  })
})
