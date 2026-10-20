import { describe, expect, it } from 'vitest'
import { QUESTIONS, getQuestion, questionsFor } from './bank'
import { getObject, mustObject, OBJECTS } from './objects'
import { DIFFICULTIES, SKILLS, type Question } from './types'

const obj = (id: string | undefined) => mustObject(id as string)

/** 獨立的解題邏輯：不看 answer 欄位，從題幹算出正解，再和題庫的 answer 比對 */
function solve(q: Question): string[] {
  switch (q.type) {
    case 'count':
      return [String(q.items[0].count)]
    case 'compare': {
      const [a, b] = q.choices
      return [(a.count as number) > (b.count as number) ? a.id : b.id]
    }
    case 'diff':
      return [String((q.items[0].count as number) - (q.items[1].count as number))]
    case 'kind': {
      const target = Object.entries({ 水果: 'fruit', 動物: 'animal', 大自然: 'nature' }).find(([zh]) => q.prompt.includes(zh))![1]
      return q.choices.filter((c) => obj(c.obj).category === target).map((c) => c.id)
    }
    case 'color': {
      const color = q.prompt.match(/哪一個是(.+)色的/)![1]
      return q.choices.filter((c) => obj(c.obj).color === color).map((c) => c.id)
    }
    case 'odd': {
      const cats = q.choices.map((c) => obj(c.obj).category)
      return q.choices.filter((_, i) => cats.filter((x) => x === cats[i]).length === 1).map((c) => c.id)
    }
    case 'next':
    case 'missing': {
      // 把每個選項填進問號，只有一個能讓整個序列呈現固定週期
      const period = q.difficulty === 1 ? 2 : 3
      const blank = q.items.findIndex((i) => i.obj === null)
      return q.choices
        .filter((c) => {
          const seq = q.items.map((it, i) => (i === blank ? c.id : it.obj))
          return seq.every((v, i) => i < period || v === seq[i - period])
        })
        .map((c) => c.id)
    }
  }
}

describe('題庫完整性', () => {
  it('三技能 × 三難度，每格至少 12 題，共 >= 108 題', () => {
    for (const s of SKILLS) for (const d of DIFFICULTIES) expect(questionsFor(s, d).length, `${s}-${d}`).toBeGreaterThanOrEqual(12)
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(108)
  })
  it('id 不重複、可由 id 取回', () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length)
    expect(getQuestion(QUESTIONS[0].id)).toBe(QUESTIONS[0])
    expect(getQuestion('nope')).toBeUndefined()
  })
  it('欄位齊全、答案在選項內、選項 id 不重複、引用的物件存在', () => {
    for (const q of QUESTIONS) {
      const tag = q.id
      expect(q.prompt.length, tag).toBeGreaterThan(3)
      expect(q.hint.length, tag).toBeGreaterThan(3)
      expect(q.version, tag).toBeGreaterThanOrEqual(1)
      expect(q.id.startsWith(`${q.skill}-${q.difficulty}-`), tag).toBe(true)
      expect(q.choices.length, tag).toBeGreaterThanOrEqual(2)
      const ids = q.choices.map((c) => c.id)
      expect(new Set(ids).size, tag).toBe(ids.length)
      expect(ids, tag).toContain(q.answer)
      for (const c of q.choices) if (c.obj) expect(getObject(c.obj), `${tag} ${c.obj}`).toBeDefined()
      for (const it of q.items) if (it.obj) expect(getObject(it.obj), `${tag} ${it.obj}`).toBeDefined()
    }
  })
  it('每題恰好一個正解，且與獨立解題邏輯一致', () => {
    for (const q of QUESTIONS) expect(solve(q), q.id).toEqual([q.answer])
  })
  it('物件屬性表涵蓋 SPEC 的 10 個學習物件', () => {
    expect(OBJECTS.map((o) => o.id).sort()).toEqual(
      ['obj-apple', 'obj-banana', 'obj-chick', 'obj-fish', 'obj-flower', 'obj-grape', 'obj-peach', 'obj-rabbit', 'obj-shell', 'obj-star'].sort(),
    )
  })
})

describe('各難度符合規格範圍', () => {
  const of = (s: (typeof SKILLS)[number], d: (typeof DIFFICULTIES)[number]) => questionsFor(s, d)
  it('數感 1：數 1–5；2：數 6–10 或比較兩堆；3：11–20、多幾個 <= 3', () => {
    for (const q of of('number', 1)) {
      expect(q.type).toBe('count')
      expect(q.items[0].count).toBeGreaterThanOrEqual(1)
      expect(q.items[0].count).toBeLessThanOrEqual(5)
    }
    for (const q of of('number', 2)) {
      if (q.type === 'count') {
        expect(q.items[0].count).toBeGreaterThanOrEqual(6)
        expect(q.items[0].count).toBeLessThanOrEqual(10)
      } else expect(q.type).toBe('compare')
    }
    expect(of('number', 2).some((q) => q.type === 'compare')).toBe(true)
    for (const q of of('number', 3)) {
      if (q.type === 'count') {
        expect(q.items[0].count).toBeGreaterThanOrEqual(11)
        expect(q.items[0].count).toBeLessThanOrEqual(20)
      } else if (q.type === 'compare') {
        const [a, b] = q.choices.map((c) => c.count as number)
        expect(Math.abs(a - b)).toBeLessThanOrEqual(3)
        expect(Math.max(a, b)).toBeLessThanOrEqual(20)
      } else {
        expect(q.type).toBe('diff')
        expect(Number(q.answer)).toBeLessThanOrEqual(3)
        expect(Number(q.answer)).toBeGreaterThanOrEqual(1)
      }
    }
  })
  it('分類 1：2 選 1 的種類；2：3 選 1 的顏色/種類；3：找不同類', () => {
    for (const q of of('classify', 1)) {
      expect(q.type).toBe('kind')
      expect(q.choices).toHaveLength(2)
    }
    for (const q of of('classify', 2)) {
      expect(['color', 'kind']).toContain(q.type)
      expect(q.choices).toHaveLength(3)
    }
    expect(of('classify', 2).some((q) => q.type === 'color')).toBe(true)
    for (const q of of('classify', 3)) {
      expect(q.type).toBe('odd')
      expect(q.choices).toHaveLength(4)
    }
  })
  it('規律 1：AB；2：AAB/ABB；3：ABC 與補中間', () => {
    for (const q of of('pattern', 1)) expect(q.type).toBe('next')
    for (const q of of('pattern', 2)) expect(q.type).toBe('next')
    expect(of('pattern', 3).some((q) => q.type === 'missing')).toBe(true)
    for (const q of of('pattern', 3).filter((x) => x.type === 'missing')) {
      const blank = q.items.findIndex((i) => i.obj === null)
      expect(blank).toBeGreaterThan(0)
      expect(blank).toBeLessThan(q.items.length - 1)
    }
  })
  it('同一格內沒有重複的題面', () => {
    for (const s of SKILLS)
      for (const d of DIFFICULTIES) {
        const sigs = questionsFor(s, d).map((q) => JSON.stringify([q.prompt, q.items, q.choices.map((c) => c.id).sort()]))
        expect(new Set(sigs).size, `${s}-${d}`).toBe(sigs.length)
      }
  })
})
