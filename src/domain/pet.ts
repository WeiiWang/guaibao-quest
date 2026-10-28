import { localDateStr } from './date'
import {
  ADULT_AT_FEED_COUNT,
  BABY_AT_FEED_COUNT,
  DAILY_GROWTH_CAP,
  FULL_HUNGER,
  HAPPY_MIN_HUNGER,
  HOUR_MS,
  HUNGER_DECAY_PER_HOUR,
  HUNGER_MAX,
  NORMAL_MIN_HUNGER,
} from './constants'
import type { Expression, Pet, Stage } from './types'

/** 飢餓度隨時間衰減（每小時 -4，最低 0；時鐘倒退視為 0 經過） */
export function currentHunger(pet: Pick<Pet, 'hunger' | 'hungerUpdatedAt'>, now: number): number {
  const hours = Math.max(0, now - pet.hungerUpdatedAt) / HOUR_MS
  return Math.max(0, Math.min(HUNGER_MAX, pet.hunger - hours * HUNGER_DECAY_PER_HOUR))
}

export function stageForFeedCount(feedCount: number): Stage {
  if (feedCount >= ADULT_AT_FEED_COUNT) return 'adult'
  if (feedCount >= BABY_AT_FEED_COUNT) return 'baby'
  return 'egg'
}

/** 不含 eating（eating 是餵食動畫中的暫態） */
export function expressionFor(hunger: number): Exclude<Expression, 'eating'> {
  if (hunger >= HAPPY_MIN_HUNGER) return 'happy'
  if (hunger >= NORMAL_MIN_HUNGER) return 'normal'
  return 'low'
}

export function moodAt(pet: Pet, now: number): Exclude<Expression, 'eating'> {
  return expressionFor(currentHunger(pet, now))
}

/** 阿悟說的話（key 在 learning/lines.ts 的 pet.bubble，pet.test.ts 檢查兩邊一字不差） */
export const FEED_FULL_LINE = '好飽喔，但是好開心！'
export const FEED_CAPPED_LINE = '肚子撐撐的，明天再吃好不好？'

export interface FeedResult {
  pet: Pet
  evolvedTo: Stage | null
  /** 餵之前就吃飽了（飽足 ≥ FULL_HUNGER）：仍然餵，成長只 +1 */
  wasFull: boolean
  /** 這次實際加了幾點成長 */
  gain: number
}

/** 今天已經靠餵食得到幾點成長（跨日 = 0） */
export function growthToday(pet: Pick<Pet, 'growth'>, now: number): number {
  return pet.growth && pet.growth.date === localDateStr(now) ? Math.max(0, pet.growth.n) : 0
}

/** 今天還能長幾點（到上限 = 0，這時餵食要拒絕，食物不扣） */
export function growthLeft(pet: Pick<Pet, 'growth'>, now: number): number {
  return Math.max(0, DAILY_GROWTH_CAP - growthToday(pet, now))
}

/**
 * 餵一份食物（呼叫前要先確認 growthLeft > 0）。
 * - 沒吃飽：成長 +food.feed；吃飽了（飽足 ≥ FULL_HUNGER）：食物照扣、成長只 +1，飽足維持在上限
 * - 成長不會超過今天剩下的額度（最後一次不足就只加剩下的）
 */
export function feed(
  pet: Pet,
  food: { hunger: number; feed: number },
  now: number,
): FeedResult {
  const wasFull = currentHunger(pet, now) >= FULL_HUNGER
  const hunger = Math.min(HUNGER_MAX, currentHunger(pet, now) + food.hunger)
  const gain = Math.min(wasFull ? 1 : food.feed, growthLeft(pet, now))
  const feedCount = pet.feedCount + gain
  const stage = stageForFeedCount(feedCount)
  return {
    pet: {
      ...pet,
      hunger,
      hungerUpdatedAt: now,
      feedCount,
      stage,
      mood: expressionFor(hunger),
      growth: { date: localDateStr(now), n: growthToday(pet, now) + gain },
    },
    evolvedTo: stage !== pet.stage ? stage : null,
    wasFull,
    gain,
  }
}

/** 距離下一階段還要餵幾次（成體回 null） */
export function feedsToNextStage(pet: Pick<Pet, 'feedCount' | 'stage'>): number | null {
  if (pet.stage === 'egg') return BABY_AT_FEED_COUNT - pet.feedCount
  if (pet.stage === 'baby') return ADULT_AT_FEED_COUNT - pet.feedCount
  return null
}
