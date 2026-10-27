import { makeRng, type Rng } from './rng'
import { planStation, seedOf, type PlannedQuestion } from './select'
import { mustSubject } from './subject'
import type { Attempt, DailyBadge, DailyState, Question, SkillId, SkillState, SubjectId } from './types'

/**
 * 每日冒險：每天每個科目一份 5 題的新冒險。
 * - 題目由「科目 + 日期 + 今天第幾次」決定亂數種子，所以同一天同一次永遠抽到一樣的題（中途離開再回來不會變）
 * - 避開昨天（上一個玩過的日子）與今天先前幾次的題面；題庫真的不夠換才重複
 * - 用各技能目前的自適應難度，到期的複習題優先（最多 2 題）
 * - 沒有連續天數，也沒有倒數：漏幾天不會有任何損失
 */

/** 只保留最近幾天的紀錄（避開昨天的題面只需要前一天） */
export const KEEP_DAYS = 14
/** 每日冒險最多放幾題複習題 */
export const DAILY_MAX_REVIEWS = 2

export const emptyDaily = (): DailyState => ({ days: {}, badges: [] })

/** YYYY-MM-DD → 從 1970 起算的第幾天 */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

/** 要避開的題：上一個玩過的日子（早於 date）的題，加上今天先前幾次的題 */
export function avoidIdsFor(state: DailyState | undefined, date: string): Set<string> {
  const out = new Set<string>()
  if (!state) return out
  const earlier = Object.keys(state.days).filter((d) => d < date).sort()
  const last = earlier[earlier.length - 1]
  if (last) for (const id of state.days[last].ids) out.add(id)
  for (const id of state.days[date]?.ids ?? []) out.add(id)
  return out
}

export interface PlanDailyOptions {
  subject: SubjectId
  /** 本地日期 YYYY-MM-DD */
  date: string
  /** 今天第幾次（1 起算） */
  play: number
  states: Record<SkillId, SkillState>
  attempts: Attempt[]
  now: number
  /** 避開的題（avoidIdsFor） */
  avoid?: ReadonlySet<string>
  gentle?: boolean
  bank?: Question[]
  /** 測試用：指定亂數；沒給就用 科目 + 日期 + 次數 當種子 */
  rng?: Rng
}

/** 規劃一次每日冒險的 5 題（純函式：相同輸入永遠得到相同題目） */
export function planDaily(o: PlanDailyOptions): PlannedQuestion[] {
  const subject = mustSubject(o.subject)
  return planStation({
    stationIndex: dayNumber(o.date) + o.play,
    states: o.states,
    attempts: o.attempts,
    now: o.now,
    rng: o.rng ?? makeRng(seedOf(`daily:${o.subject}:${o.date}:${o.play}`)),
    gentle: o.gentle,
    bank: o.bank,
    skills: subject.skills,
    slots: subject.dailySlots,
    exclude: o.avoid,
    maxReviews: DAILY_MAX_REVIEWS,
  })
}

const prune = (days: DailyState['days']): DailyState['days'] =>
  Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).slice(-KEEP_DAYS))

/** 開始新的一次：今天的次數 +1，記下排進去的題 */
export function startPlay(state: DailyState | undefined, date: string, ids: string[]): { state: DailyState; play: number } {
  const cur = state ?? emptyDaily()
  const day = cur.days[date] ?? { plays: 0, done: 0, ids: [] }
  const play = day.plays + 1
  return {
    play,
    state: { ...cur, days: prune({ ...cur.days, [date]: { ...day, plays: play, ids: [...new Set([...day.ids, ...ids])] } }) },
  }
}

/** 完成一次：今天完成數 +1；這個科目今天第一次完成才有徽章 */
export function finishPlay(
  state: DailyState | undefined,
  date: string,
  subject: SubjectId,
  ids: string[],
  at: number,
): { state: DailyState; badge: DailyBadge | null } {
  const cur = state ?? emptyDaily()
  const day = cur.days[date] ?? { plays: 0, done: 0, ids: [] }
  const first = day.done === 0 && !cur.badges.some((b) => b.date === date && b.subject === subject)
  const badge: DailyBadge | null = first ? { date, subject, at } : null
  return {
    badge,
    state: {
      days: prune({ ...cur.days, [date]: { plays: Math.max(day.plays, day.done + 1), done: day.done + 1, ids: [...new Set([...day.ids, ...ids])] } }),
      badges: badge ? [...cur.badges, badge] : cur.badges,
    },
  }
}

export interface DailyInfo {
  date: string
  /** 今天開始過幾次 */
  plays: number
  /** 今天完成幾次 */
  done: number
  /** 今天已經拿到徽章 */
  badgeToday: boolean
  /** 累計徽章數（圖鑑之後會用） */
  badgeTotal: number
}

export function dailyInfo(state: DailyState | undefined, date: string): DailyInfo {
  const day = state?.days[date]
  return {
    date,
    plays: day?.plays ?? 0,
    done: day?.done ?? 0,
    badgeToday: !!state?.badges.some((b) => b.date === date),
    badgeTotal: state?.badges.length ?? 0,
  }
}
