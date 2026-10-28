import { describe, expect, it } from 'vitest'
import { ADULT_AT_FEED_COUNT, BABY_AT_FEED_COUNT, DAILY_GROWTH_CAP, FOOD_EFFECTS, FULL_HUNGER, HOUR_MS } from './constants'
import { currentHunger, expressionFor, FEED_CAPPED_LINE, FEED_FULL_LINE, feed, feedsToNextStage, growthLeft, growthToday, stageForFeedCount } from './pet'
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
  it('成長門檻 6 / 66（孵化後再 60 次）', () => {
    expect(BABY_AT_FEED_COUNT).toBe(6)
    expect(ADULT_AT_FEED_COUNT).toBe(BABY_AT_FEED_COUNT + 60)
    expect(stageForFeedCount(5)).toBe('egg')
    expect(stageForFeedCount(6)).toBe('baby')
    expect(stageForFeedCount(65)).toBe('baby')
    expect(stageForFeedCount(66)).toBe('adult')
  })
  it('孵化與進化回報', () => {
    expect(feed(pet({ feedCount: 5 }), FOOD_EFFECTS.banana, T0).evolvedTo).toBe('baby')
    expect(feed(pet({ feedCount: 5 }), FOOD_EFFECTS.peach, T0).pet.stage).toBe('baby')
    expect(feed(pet({ stage: 'baby', feedCount: 65 }), FOOD_EFFECTS.banana, T0).evolvedTo).toBe('adult')
    expect(feed(pet({ feedCount: 3 }), FOOD_EFFECTS.banana, T0).evolvedTo).toBeNull()
  })
  it('距離下一階段次數', () => {
    expect(feedsToNextStage(pet({ feedCount: 2 }))).toBe(4)
    expect(feedsToNextStage(pet({ stage: 'baby', feedCount: 30 }))).toBe(36)
    expect(feedsToNextStage(pet({ stage: 'adult', feedCount: 90 }))).toBeNull()
  })
})

describe('v7.3 吃飽仍可餵與每日成長上限', () => {
  it('吃飽（≥ FULL_HUNGER）：成長只 +1（蛋糕也一樣），飽足維持在上限', () => {
    const r = feed(pet({ hunger: 100 }), FOOD_EFFECTS.cake, T0)
    expect(r.wasFull).toBe(true)
    expect(r.gain).toBe(1)
    expect(r.pet.feedCount).toBe(1)
    expect(r.pet.hunger).toBe(100)
  })
  it('沒吃飽：成長 = 食物的 feed 值', () => {
    const r = feed(pet({ hunger: FULL_HUNGER - 1 }), FOOD_EFFECTS.peach, T0)
    expect(r.wasFull).toBe(false)
    expect(r.gain).toBe(2)
  })
  it(`每天上限 ${DAILY_GROWTH_CAP}：累計、最後一次只加剩下的、到了 growthLeft = 0`, () => {
    let p = pet({ hunger: 100 })
    for (let i = 0; i < DAILY_GROWTH_CAP - 1; i++) p = feed(p, FOOD_EFFECTS.banana, T0).pet
    expect(growthToday(p, T0)).toBe(DAILY_GROWTH_CAP - 1)
    expect(growthLeft(p, T0)).toBe(1)
    const last = feed({ ...p, hunger: 10 }, FOOD_EFFECTS.cake, T0) // 蛋糕 +3，但只剩 1
    expect(last.gain).toBe(1)
    expect(growthLeft(last.pet, T0)).toBe(0)
  })
  it('跨日歸零（以本地日期為準）、舊存檔沒有 growth 欄位 = 0', () => {
    const p = feed(pet(), FOOD_EFFECTS.banana, T0).pet
    expect(growthToday(p, T0)).toBe(1)
    expect(growthToday(p, T0 + 24 * HOUR_MS)).toBe(0)
    expect(growthLeft(p, T0 + 24 * HOUR_MS)).toBe(DAILY_GROWTH_CAP)
    expect(growthToday(pet(), T0)).toBe(0)
  })
  it('阿悟說的兩句話與 learning/lines.ts 一字不差', async () => {
    const { allLines } = await import('../learning/lines')
    const lines = allLines([])
    const keyOf = (text: string) => Object.entries(lines).find(([, v]) => v === text)?.[0]
    expect(keyOf(FEED_FULL_LINE)).toMatch(/^pet\./)
    expect(keyOf(FEED_CAPPED_LINE)).toMatch(/^pet\./)
  })
})
