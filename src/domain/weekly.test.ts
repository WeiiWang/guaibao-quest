import { describe, expect, it } from 'vitest'
import { buildWeekly, recentSkills, weekDays, weeklySkillText } from './weekly'
import { SUBJECTS } from '../learning/subject'
import { SKILLS, SKILL_NAMES, type Attempt, type Difficulty, type SkillId } from '../learning/types'
import { SKILL_TIPS } from './parentTips'
import { localDateStr } from './date'
import type { AlbumCard } from './types'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 9, 27, 18, 0, 0).getTime()
let n = 0
const att = (skill: SkillId, daysAgo: number, ind = true, extra: Partial<Attempt> = {}): Attempt => ({
  id: `a${n++}`,
  at: NOW - daysAgo * DAY,
  questionId: `q${n}`,
  skill,
  difficulty: 1,
  firstTryCorrect: ind,
  hintsUsed: ind ? 0 : 1,
  durationMs: 1000,
  sessionId: `s-${skill}-${daysAgo}`,
  ...extra,
})
const states = (over: Partial<Record<SkillId, { difficulty: Difficulty; mastered: Record<number, { masteredAt: number; reviews: number }> }>> = {}) =>
  Object.fromEntries(SKILLS.map((s) => [s, over[s] ?? { difficulty: 1 as Difficulty, mastered: {} }]))

describe('weekDays', () => {
  it('7 天，最後一天是今天', () => {
    const d = weekDays(NOW)
    expect(d).toHaveLength(7)
    expect(d[6]).toBe(localDateStr(NOW))
    expect(d[0]).toBe(localDateStr(NOW - 6 * DAY))
  })
})

describe('buildWeekly：本週彙總', () => {
  it('練習天數 = 有作答的不同日期；只算最近 7 天', () => {
    const attempts = [att('number', 0), att('number', 0), att('classify', 2), att('english', 6), att('number', 7), att('number', 30)]
    const r = buildWeekly(attempts, states(), [], NOW)
    expect(r.practiceDays).toBe(3)
    expect(r.attempts).toBe(4)
    expect(r.empty).toBe(false)
    expect(r.from).toBe(localDateStr(NOW - 6 * DAY))
    expect(r.to).toBe(localDateStr(NOW))
  })
  it('沒有紀錄：empty，仍給通用建議', () => {
    const r = buildWeekly([], states(), [], NOW)
    expect(r.empty).toBe(true)
    expect(r.practiceDays).toBe(0)
    expect(r.homeTips).toHaveLength(1)
    expect(r.homeTips[0].skill).toBe('generic')
    expect(r.homeTips[0].tips.length).toBeGreaterThanOrEqual(2)
  })
  it('科目清單從 SUBJECTS 讀：每個科目、每個技能都列出來（沒練的 practiced = false）', () => {
    const r = buildWeekly([att('number', 1)], states(), [], NOW)
    expect(r.subjects.map((s) => s.id)).toEqual(SUBJECTS.map((s) => s.id))
    for (const s of r.subjects) expect(s.skills.map((k) => k.skill)).toEqual(SUBJECTS.find((x) => x.id === s.id)!.skills)
    expect(r.subjects.find((s) => s.id === 'math')!.practiced).toBe(true)
    expect(r.subjects.filter((s) => s.id !== 'math').every((s) => !s.practiced)).toBe(true)
  })
  it('每個技能：題數、無提示答對、答對率；用技能中文名', () => {
    const attempts = [att('number', 0, true), att('number', 0, true), att('number', 1, false), att('number', 1, true)]
    const k = buildWeekly(attempts, states(), [], NOW).subjects[0].skills.find((x) => x.skill === 'number')!
    expect(k).toMatchObject({ total: 4, independent: 3, rate: 0.75, name: SKILL_NAMES.number })
  })
  it('本週新掌握的難度（白話）會標出來；之前掌握的不算', () => {
    const st = states({ number: { difficulty: 3, mastered: { 1: { masteredAt: NOW - 20 * DAY, reviews: 1 }, 2: { masteredAt: NOW - 1 * DAY, reviews: 0 } } } })
    const k = buildWeekly([att('number', 0)], st, [], NOW).subjects[0].skills.find((x) => x.skill === 'number')!
    expect(k.newlyMastered).toEqual(['數 6–10 個、比較多寡'])
    expect(k.text).toContain('新學會')
    expect(k.text).not.toMatch(/難度/)
  })
  it('白話說明：沒練、練得少、很穩、大致會、需要陪', () => {
    expect(weeklySkillText('數感', 0, 0, null, '數 1–5 個', [])).toContain('還沒有練習')
    expect(weeklySkillText('數感', 2, 2, 1, '數 1–5 個', [])).toContain('練得還不多')
    expect(weeklySkillText('數感', 10, 9, 0.9, '數 1–5 個', [])).toContain('很穩')
    expect(weeklySkillText('數感', 10, 6, 0.6, '數 1–5 個', [])).toContain('大致會了')
    expect(weeklySkillText('數感', 10, 2, 0.2, '數 1–5 個', [])).toContain('需要大人陪')
  })
  it('本週新招：只列本週（最近 7 天）、不是補建（approx）的回憶卡', () => {
    const card = (id: string, daysAgo: number, extra: Partial<AlbumCard> = {}): AlbumCard => ({ id, at: NOW - daysAgo * DAY, kind: 'trick', art: 'pet-adult-happy', caption: id, ...extra })
    const album = [card('trick:count', 1), card('trick:tidy', 20), card('trick:flip', 0, { approx: true }), { ...card('hatch', 1), kind: 'hatch' as const }, card('trick:hello', 6)]
    const r = buildWeekly([], states(), album, NOW)
    expect(r.tricks.map((c) => c.id)).toEqual(['trick:hello', 'trick:count'])
  })
  it('在家這樣練：只列本週練過的技能，需要加強的排最前面；每個 2–3 句', () => {
    const attempts = [
      ...Array.from({ length: 5 }, () => att('number', 0, true)),
      ...Array.from({ length: 5 }, (_, i) => att('classify', 1, i < 1)), // 20%：需要加強
      ...Array.from({ length: 5 }, () => att('english', 2, true)),
    ]
    const r = buildWeekly(attempts, states(), [], NOW)
    expect(r.homeTips[0].skill).toBe('classify')
    expect(r.homeTips.map((t) => t.skill).sort()).toEqual(['classify', 'english', 'number'])
    for (const t of r.homeTips) {
      expect(t.tips.length).toBeGreaterThanOrEqual(2)
      expect(t.tips.length).toBeLessThanOrEqual(3)
      expect(t.tips).toEqual(SKILL_TIPS[t.skill].practice)
    }
  })
  it('練過但還沒寫建議的新技能：顯示通用建議，不會空白', () => {
    const r = buildWeekly([att('number', 0, true, { skill: 'brand-new' as SkillId })], { ...states(), 'brand-new': { difficulty: 1 as Difficulty, mastered: {} } }, [], NOW)
    // 新技能不在任何科目的清單裡 → 週報不會出現；清單與建議都不能壞
    expect(r.homeTips.length).toBeGreaterThanOrEqual(1)
    expect(r.homeTips[0].tips.length).toBeGreaterThanOrEqual(2)
  })
})

describe('recentSkills：給今日小提示用', () => {
  it('最近 3 天有練的技能，近的、多的在前', () => {
    const a = [att('number', 0), att('number', 1), att('classify', 0, true, { at: NOW + 1000 }), att('english', 2), att('pattern', 10)]
    expect(recentSkills(a, NOW)).toEqual(['classify', 'number', 'english'])
  })
  it('最近 3 天都沒練就放寬到 14 天；都沒有就是空', () => {
    expect(recentSkills([att('pattern', 10)], NOW)).toEqual(['pattern'])
    expect(recentSkills([att('pattern', 40)], NOW)).toEqual([])
    expect(recentSkills([], NOW)).toEqual([])
  })
})
