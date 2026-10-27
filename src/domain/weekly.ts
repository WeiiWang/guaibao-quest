// v6 線 C：家長週報。以「最近 7 天（含今天）」為一週：練習天數、各科目學會了什麼（白話）、阿悟本週學會的新招、在家這樣練。
// 科目與技能一律從 learning/subject.ts 的科目清單與 learning/types.ts 的技能清單讀，之後新增科目會自動列出來。
import { LEVEL_LABEL, MIN_ATTEMPTS_FOR_VERDICT } from '../learning/report'
import { SUBJECTS } from '../learning/subject'
import { isIndependent, SKILL_NAMES, type Attempt, type Difficulty, type SkillState } from '../learning/types'
import { localDateStr } from './date'
import { GENERIC_PRACTICE, practiceTipsFor } from './parentTips'
import type { AlbumCard } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export interface WeeklySkill {
  skill: string
  name: string
  /** 本週作答題數 */
  total: number
  independent: number
  /** 無提示答對率 0–1；沒作答為 null */
  rate: number | null
  difficulty: number
  /** 目前難度的白話（沒有對照就是空字串） */
  levelLabel: string
  /** 本週新掌握的難度（白話） */
  newlyMastered: string[]
  /** 一句白話：這個技能這週學到哪裡 */
  text: string
}

export interface WeeklySubject {
  id: string
  name: string
  /** 這科這週有沒有練 */
  practiced: boolean
  skills: WeeklySkill[]
}

export interface WeeklyTip {
  skill: string
  name: string
  tips: string[]
}

export interface WeeklyReport {
  /** 這一週的第一天與最後一天（YYYY-MM-DD） */
  from: string
  to: string
  /** 練習天數（有作答的日子）/ 7 */
  practiceDays: number
  attempts: number
  subjects: WeeklySubject[]
  /** 本週阿悟學會的新招（回憶卡，依時間） */
  tricks: AlbumCard[]
  /** 在家這樣練：本週練過的技能，先講需要加強的；一個都沒練就給通用建議 */
  homeTips: WeeklyTip[]
  /** 本週完全沒有練習 */
  empty: boolean
}

export const weekDays = (now: number): string[] => Array.from({ length: 7 }, (_, i) => localDateStr(now - (6 - i) * DAY_MS))

const labelOf = (skill: string, d: number): string => (LEVEL_LABEL as Record<string, Record<number, string> | undefined>)[skill]?.[d] ?? ''
const nameOf = (skill: string): string => (SKILL_NAMES as Record<string, string>)[skill] ?? skill

/** 一個技能這週學到哪裡，用白話寫（家長看得懂，不講「難度 3」之類的術語） */
export function weeklySkillText(name: string, total: number, independent: number, rate: number | null, levelLabel: string, newlyMastered: string[]): string {
  if (total === 0) return `${name}：這週還沒有練習。`
  const base = levelLabel ? `在練「${levelLabel}」` : '有練習'
  const score = `共 ${total} 題，其中 ${independent} 題不用提示就答對`
  if (newlyMastered.length > 0) return `${name}：新學會了「${newlyMastered.join('」、「')}」！${score}。`
  if (rate === null || total < MIN_ATTEMPTS_FOR_VERDICT) return `${name}：${base}，${score}。練得還不多，多玩幾站就看得出來。`
  if (rate >= 0.8) return `${name}：${base}，已經很穩了。${score}。`
  if (rate >= 0.5) return `${name}：${base}，大致會了，再練幾次會更穩。${score}。`
  return `${name}：${base}，還在摸索中，需要大人陪著玩。${score}。`
}

/** 由作答紀錄、技能狀態與相簿算出家長週報（純函式） */
export function buildWeekly(
  attempts: readonly Attempt[],
  states: Record<string, Pick<SkillState, 'difficulty' | 'mastered'> | undefined>,
  album: readonly AlbumCard[] | undefined,
  now: number,
): WeeklyReport {
  const days = weekDays(now)
  const inWeek = attempts.filter((a) => days.includes(localDateStr(a.at)))
  const startMs = Date.parse(`${days[0]}T00:00:00`)
  const practiceDays = new Set(inWeek.map((a) => localDateStr(a.at))).size

  const skillRow = (skill: string): WeeklySkill => {
    const mine = inWeek.filter((a) => a.skill === skill)
    const independent = mine.filter(isIndependent).length
    const rate = mine.length ? independent / mine.length : null
    const st = states[skill]
    const difficulty = st?.difficulty ?? 1
    const levelLabel = labelOf(skill, difficulty)
    const newlyMastered = Object.entries(st?.mastered ?? {})
      .filter(([, rec]) => rec && rec.masteredAt >= startMs)
      .map(([d]) => labelOf(skill, Number(d) as Difficulty))
      .filter(Boolean)
    const name = nameOf(skill)
    return { skill, name, total: mine.length, independent, rate, difficulty, levelLabel, newlyMastered, text: weeklySkillText(name, mine.length, independent, rate, levelLabel, newlyMastered) }
  }

  const subjects: WeeklySubject[] = SUBJECTS.map((s) => {
    const skills = s.skills.map(skillRow)
    return { id: s.id, name: s.name, practiced: skills.some((k) => k.total > 0), skills }
  })

  const tricks = (album ?? []).filter((c) => c.kind === 'trick' && !c.approx && c.at >= startMs && c.at <= now + DAY_MS).sort((a, b) => a.at - b.at)

  const practiced = subjects.flatMap((s) => s.skills).filter((k) => k.total > 0)
  // 先講需要加強的（有足夠題數且答對率低），其餘依練習題數多的在前
  const score = (k: WeeklySkill) => (k.rate !== null && k.total >= MIN_ATTEMPTS_FOR_VERDICT ? k.rate : 1.5 - Math.min(0.4, k.total / 100))
  const homeTips: WeeklyTip[] = practiced
    .slice()
    .sort((a, b) => score(a) - score(b) || b.total - a.total)
    .map((k) => ({ skill: k.skill, name: k.name, tips: practiceTipsFor(k.skill) }))
  if (homeTips.length === 0) homeTips.push({ skill: 'generic', name: '通用', tips: GENERIC_PRACTICE })

  return { from: days[0], to: days[6], practiceDays, attempts: inWeek.length, subjects, tricks, homeTips, empty: inWeek.length === 0 }
}

/** 最近練的技能（越近、越常練的排前面）：給「今日小提示」挑句子用。先看最近 3 天，沒有再看最近 14 天 */
export function recentSkills(attempts: readonly Attempt[], now: number): string[] {
  const within = (n: number) => {
    const ds = Array.from({ length: n }, (_, i) => localDateStr(now - i * DAY_MS))
    return attempts.filter((a) => ds.includes(localDateStr(a.at)))
  }
  let list = within(3)
  if (list.length === 0) list = within(14)
  const stat = new Map<string, { n: number; last: number }>()
  for (const a of list) {
    const cur = stat.get(a.skill) ?? { n: 0, last: 0 }
    stat.set(a.skill, { n: cur.n + 1, last: Math.max(cur.last, a.at) })
  }
  return [...stat.entries()].sort((a, b) => b[1].last - a[1].last || b[1].n - a[1].n).map(([k]) => k)
}
