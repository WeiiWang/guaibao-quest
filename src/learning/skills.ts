import { localDateStr } from '../domain/date'
import type { Attempt, Difficulty, SkillId, SkillState } from './types'
import { DIFFICULTIES, isIndependent, MAX_DIFFICULTY, SKILLS } from './types'

/** 難度判斷看最近幾題 */
export const RECENT_WINDOW = 5
/** 最近 5 題無提示答對 >= 這個數 → 升一級 */
export const PROMOTE_AT = 4
/** <= 這個數 → 降一級 */
export const DEMOTE_AT = 1
/** 新技能的前幾題全部無提示答對 → 直接升一級（快速通道） */
export const FAST_TRACK_N = 3
/** 一站內該技能無提示答對率 >= 這個比例，算「這站穩了」 */
export const STATION_PASS_RATE = 0.8
/** 連續幾站穩了 → 已掌握 */
export const MASTER_STREAK = 2
/** 掌握後第幾天複習：隔天、隔週、第 14 天（追蹤，followUp） */
export const REVIEW_OFFSET_DAYS = [1, 7, 14]
/** 複習連續答錯幾次 → 清掉這個難度的掌握 */
export const MISSES_TO_UNMASTER = 2

export function initialSkillState(skill: SkillId, now = 0, difficulty: Difficulty = 1): SkillState {
  return { skill, difficulty, recent: [], stationStreak: 0, mastered: {}, updatedAt: now, total: 0 }
}

const clampDiff = (n: number, max: Difficulty = MAX_DIFFICULTY): Difficulty => Math.min(max, Math.max(1, n)) as Difficulty

export interface ApplyOptions {
  /** 幼幼模式：2 選 1 猜中率高，所以升級要連續 5 題獨立答對、沒有快速通道 */
  gentle?: boolean
}

/**
 * 套用一次作答到技能狀態（純函式）。
 * - 複習題：只更新複習紀錄（答對 +1 次；答錯不算次數，改隔天重考，連續 2 次錯就清掉掌握）
 * - 「非目前難度」的題（例如站內救援抽的低 1 級）不影響難度判斷
 * - 最近 5 題 >= 4 無提示答對 → 升級；<= 1 → 降級；變更後清空 recent 與連續站數
 * - 新技能前 3 題全部無提示答對 → 直接升一級
 * - 升級時把舊難度記成「已掌握」，之後才有東西可以複習
 */
export function applyAttempt(state: SkillState, a: Attempt, opts: ApplyOptions = {}): SkillState {
  if (a.skill !== state.skill) return state
  if (a.review) return recordReview(state, a.difficulty, a.at, isIndependent(a))
  if (a.difficulty !== state.difficulty) return { ...state, updatedAt: a.at }
  const ind = isIndependent(a)
  const recent = [...state.recent, ind].slice(-RECENT_WINDOW)
  const total = state.total === undefined ? undefined : state.total + 1
  const max = MAX_DIFFICULTY
  const good = recent.filter(Boolean).length
  let target: Difficulty = state.difficulty
  if (recent.length >= RECENT_WINDOW) {
    const promoteAt = opts.gentle ? RECENT_WINDOW : PROMOTE_AT
    target = good >= promoteAt ? clampDiff(state.difficulty + 1, max) : good <= DEMOTE_AT ? clampDiff(state.difficulty - 1, max) : state.difficulty
  }
  if (!opts.gentle && total === FAST_TRACK_N && recent.length === FAST_TRACK_N && good === FAST_TRACK_N) {
    target = clampDiff(state.difficulty + 1, max)
  }
  if (target === state.difficulty) return { ...state, recent, ...(total === undefined ? {} : { total }), updatedAt: a.at }
  const mastered =
    target > state.difficulty && !state.mastered[state.difficulty]
      ? { ...state.mastered, [state.difficulty]: { masteredAt: a.at, reviews: 0 } }
      : state.mastered
  return { ...state, difficulty: target, recent: [], stationStreak: 0, mastered, ...(total === undefined ? {} : { total }), updatedAt: a.at }
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

/**
 * 複習結果。答對（獨立答對）：複習次數 +1。
 * 答錯：次數不加，記下今天複習過（所以排到隔天再考）；連續 2 次錯就清掉這個難度的掌握。
 * 沒有這個難度的掌握紀錄（例如題庫改版或已被清掉）就什麼都不做。
 */
export function recordReview(state: SkillState, level: Difficulty, now: number, correct = true): SkillState {
  const rec = state.mastered[level]
  if (!rec) return { ...state, updatedAt: now }
  if (correct) {
    return {
      ...state,
      mastered: { ...state.mastered, [level]: { ...rec, reviews: rec.reviews + 1, lastReviewAt: now, misses: 0 } },
      updatedAt: now,
    }
  }
  const misses = (rec.misses ?? 0) + 1
  if (misses >= MISSES_TO_UNMASTER) {
    const rest = { ...state.mastered }
    delete rest[level]
    return { ...state, mastered: rest, updatedAt: now }
  }
  return { ...state, mastered: { ...state.mastered, [level]: { ...rec, lastReviewAt: now, misses } }, updatedAt: now }
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
  // 優先複習「目前難度」與「目前難度 − 1」；太久以前的低難度排後面
  const near = (d: DueReview) => (d.level >= states[d.skill].difficulty - 1 ? 1 : 0)
  return out.sort((a, b) => near(b) - near(a) || b.overdueDays - a.overdueDays)
}
