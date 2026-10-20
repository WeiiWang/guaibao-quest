import {
  ADULT_AT_FEED_COUNT,
  BABY_AT_FEED_COUNT,
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

export interface FeedResult {
  pet: Pet
  evolvedTo: Stage | null
}

export function feed(
  pet: Pet,
  food: { hunger: number; feed: number },
  now: number,
): FeedResult {
  const hunger = Math.min(HUNGER_MAX, currentHunger(pet, now) + food.hunger)
  const feedCount = pet.feedCount + food.feed
  const stage = stageForFeedCount(feedCount)
  return {
    pet: {
      ...pet,
      hunger,
      hungerUpdatedAt: now,
      feedCount,
      stage,
      mood: expressionFor(hunger),
    },
    evolvedTo: stage !== pet.stage ? stage : null,
  }
}

/** 距離下一階段還要餵幾次（成體回 null） */
export function feedsToNextStage(pet: Pick<Pet, 'feedCount' | 'stage'>): number | null {
  if (pet.stage === 'egg') return BABY_AT_FEED_COUNT - pet.feedCount
  if (pet.stage === 'baby') return ADULT_AT_FEED_COUNT - pet.feedCount
  return null
}
