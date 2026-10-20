import type { PlayTime } from './types'

export const DAILY_LIMIT_OPTIONS = [15, 20, 30, 45, 0] as const
/** 0 = 不限 */
export const DEFAULT_DAILY_LIMIT_MIN = 20
export const EXTEND_MINUTES = 10

export interface LearningSettings {
  dailyLimitMin: number
  soundOn: boolean
  voiceOn: boolean
}

export function learningSettingsOf(s: { dailyLimitMin?: number; soundOn?: boolean; voiceOn?: boolean } | undefined): LearningSettings {
  return {
    dailyLimitMin: s?.dailyLimitMin ?? DEFAULT_DAILY_LIMIT_MIN,
    soundOn: s?.soundOn ?? true,
    voiceOn: s?.voiceOn ?? true,
  }
}

export const limitLabel = (min: number) => (min === 0 ? '不限' : `${min} 分鐘`)

/** 剩餘秒數；不限時為 null */
export function remainingSeconds(limitMin: number, pt: Pick<PlayTime, 'seconds' | 'bonusSeconds'> | undefined): number | null {
  if (limitMin === 0) return null
  return Math.max(0, limitMin * 60 + (pt?.bonusSeconds ?? 0) - (pt?.seconds ?? 0))
}

export const isLockedByTime = (limitMin: number, pt: Pick<PlayTime, 'seconds' | 'bonusSeconds'> | undefined): boolean =>
  remainingSeconds(limitMin, pt) === 0
