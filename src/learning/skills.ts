import { localDateStr } from '../domain/date'
import type { Attempt, Difficulty, SkillId, SkillState } from './types'
import { DIFFICULTIES, isIndependent, SKILLS } from './types'

/** 難度判斷看最近幾題 */
export const RECENT_WINDOW = 5
/** 最近 5 題無提示答對 >= 這個數 → 升一級 */
export const PROMOTE_AT = 4
/** <= 這個數 → 降一級 */
export const DEMOTE_AT = 1
/** 一站內該技能無提示答對率 >= 這個比例，算「這站穩了」 */
export const STATION_PASS_RATE = 0.8
/** 連續幾站穩了 → 已掌握 */
export const MASTER_STREAK = 2
/** 掌握後第幾天複習：隔天、隔週、第 14 天（追蹤，followUp） */
export const REVIEW_OFFSET_DAYS = [1, 7, 14]

export function initialSkillState(skill: SkillId, now = 0): SkillState {
  return { skill, difficulty: 1, recent: [], stationStreak: 0, mastered: {}, updatedAt: now }
}

const clampDiff = (n: number): Difficulty => Math.min(3, Math.max(1, n)) as Difficulty

/**
 * 套用一次作答到技能狀態（純函式）。
 * - 複習題與「非目前難度」的題目不影響難度判斷（只更新複習次數）
 * - 最近 5 題 >= 4 無提示答對 → 升級；<= 1 → 降級；變更後清空 recent 與連續站數
 */
export function applyAttempt(state: SkillState, a: Attempt): SkillState {
  if (a.skill !== state.skill) return state
  if (a.review) return recordReview(state, a.difficulty, a.at)
  if (a.difficulty !== state.difficulty) return { ...state, updatedAt: a.at }
  const recent = [...state.recent, isIndependent(a)].slice(-RECENT_WINDOW)
  let difficulty = state.difficulty
  let stationStreak = state.stationStreak
  let nextRecent = recent
  if (recent.length >= RECENT_WINDOW) {
    const good = recent.filter(Boolean).length
    const target = good >= PROMOTE_AT ? clampDiff(difficulty + 1) : good <= DEMOTE_AT ? clampDiff(difficulty - 1) : difficulty
    if (target !== difficulty) {
      difficulty = target
      stationStreak = 0
      nextRecent = []
    }
  }
  return { ...state, difficulty, recent: nextRecent, stationStreak, updatedAt: a.at }
}

/**
 * 一站結束後更新「連續穩定站數」與掌握狀態。
 * 只看這一站中、屬於目前難度的非複習題；該技能沒出題就不變。
 */
export function applyStationResult(state: SkillState, stationAttempts: Attempt[], now: number): SkillState {
  const mine = stationAttempts.filter((a) => a.skill === state.skill && !a.review && a.difficulty === state.difficulty)
  if (mine.length === 0) return state
  const rate = mine.filter(isIndependent).length / mine.length
  const stationStreak = rate >= STATION_PASS_RATE ? state.stationStreak + 1 : 0
  let mastered = state.mastered
  if (stationStreak >= MASTER_STREAK && !mastered[state.difficulty]) {
    mastered = { ...mastered, [state.difficulty]: { masteredAt: now, reviews: 0 } }
  }
  return { ...state, stationStreak, mastered, updatedAt: now }
}

export function recordReview(state: SkillState, level: Difficulty, now: number): SkillState {
  const rec = state.mastered[level]
  if (!rec) return { ...state, updatedAt: now }
  return {
    ...state,
    mastered: { ...state.mastered, [level]: { ...rec, reviews: rec.reviews + 1, lastReviewAt: now } },
    updatedAt: now,
  }
}

/** 兩個時間點相差幾個「本地日曆日」 */
export function daysBetween(fromMs: number, toMs: number): number {
  const parse = (ms: number) => {
    const [y, m, d] = localDateStr(ms).split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((parse(toMs) - parse(fromMs)) / 86_400_000)
}

export interface DueReview {
  skill: SkillId
  level: Difficulty
  /** 第 14 天的短版異題追蹤 */
  followUp: boolean
  /** 已超過排程幾天（越大越優先） */
  overdueDays: number
}

/** 現在該複習的（技能, 難度）。每個掌握紀錄最多 3 次複習；同一天不重複複習。 */
export function dueReviews(states: Record<SkillId, SkillState>, now: number): DueReview[] {
  const out: DueReview[] = []
  for (const skill of SKILLS) {
    for (const level of DIFFICULTIES) {
      const rec = states[skill].mastered[level]
      if (!rec || rec.reviews >= REVIEW_OFFSET_DAYS.length) continue
      if (rec.lastReviewAt !== undefined && daysBetween(rec.lastReviewAt, now) < 1) continue
      const overdue = daysBetween(rec.masteredAt, now) - REVIEW_OFFSET_DAYS[rec.reviews]
      if (overdue >= 0) out.push({ skill, level, followUp: rec.reviews === REVIEW_OFFSET_DAYS.length - 1, overdueDays: overdue })
    }
  }
  return out.sort((a, b) => b.overdueDays - a.overdueDays)
}
