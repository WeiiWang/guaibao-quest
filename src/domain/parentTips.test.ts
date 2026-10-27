import { describe, expect, it } from 'vitest'
import { GENERIC_DAILY, GENERIC_PRACTICE, SKILL_TIPS, dayNumber, hasSkillTips, pickDailyTip, practiceTipsFor } from './parentTips'
import { SKILLS } from '../learning/types'

describe('在家這樣練', () => {
  it('現有的每個技能都有建議：2–3 句，每句是可以直接照做的完整句子', () => {
    for (const skill of SKILLS) {
      expect(hasSkillTips(skill), skill).toBe(true)
      const tips = practiceTipsFor(skill)
      expect(tips.length, skill).toBeGreaterThanOrEqual(2)
      expect(tips.length, skill).toBeLessThanOrEqual(3)
      for (const t of tips) expect(t.length, `${skill}: ${t}`).toBeGreaterThanOrEqual(15)
    }
  })
  it('新技能還沒寫建議時，顯示通用建議（不會空白）', () => {
    expect(hasSkillTips('brand-new-skill')).toBe(false)
    expect(practiceTipsFor('brand-new-skill')).toEqual(GENERIC_PRACTICE)
    expect(GENERIC_PRACTICE.length).toBeGreaterThanOrEqual(2)
  })
  it('每個技能的今日小提示至少 3 句，一句話（不超過 60 字）', () => {
    for (const [skill, t] of Object.entries(SKILL_TIPS)) {
      expect(t.daily.length, skill).toBeGreaterThanOrEqual(3)
      for (const d of t.daily) expect(d.length, `${skill}: ${d}`).toBeLessThanOrEqual(60)
    }
    for (const d of GENERIC_DAILY) expect(d.length).toBeLessThanOrEqual(60)
  })
})

describe('今日小提示的挑選', () => {
  it('依最近練的技能挑：只會從最近練過的技能裡挑', () => {
    for (let day = 1; day <= 40; day++) {
      const tip = pickDailyTip(['number', 'english'], `2026-10-${String(day % 28 || 1).padStart(2, '0')}`)
      expect(['number', 'english']).toContain(tip.skill)
      expect(SKILL_TIPS[tip.skill as string].daily).toContain(tip.text)
    }
  })
  it('同一天永遠同一句；隔天換（兩個技能 + 各 3 句輪流，6 天內不重複）', () => {
    expect(pickDailyTip(['number', 'classify'], '2026-10-27')).toEqual(pickDailyTip(['number', 'classify'], '2026-10-27'))
    const texts = new Set(Array.from({ length: 6 }, (_, i) => pickDailyTip(['number', 'classify'], `2026-10-${20 + i}`).text))
    expect(texts.size).toBe(6)
  })
  it('只看最近 3 個技能', () => {
    const skills = new Set(Array.from({ length: 30 }, (_, i) => pickDailyTip(['number', 'classify', 'pattern', 'english'], `2026-09-${String(i + 1).padStart(2, '0')}`).skill))
    expect(skills.has('english')).toBe(false)
    expect(skills.size).toBe(3)
  })
  it('最近沒有練習（或練的是還沒寫建議的新技能）：通用小提示', () => {
    expect(pickDailyTip([], '2026-10-27').skill).toBeNull()
    expect(GENERIC_DAILY).toContain(pickDailyTip([], '2026-10-27').text)
    expect(pickDailyTip(['brand-new-skill'], '2026-10-27').skill).toBeNull()
  })
  it('dayNumber：相鄰兩天差 1', () => {
    expect(dayNumber('2026-10-28') - dayNumber('2026-10-27')).toBe(1)
    expect(dayNumber('2026-11-01') - dayNumber('2026-10-31')).toBe(1)
  })
})
