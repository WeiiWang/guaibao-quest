// v7.4 線 H：3 歲題型池、句型輪替、6–7 歲首站與挑戰站難度、重玩避開最近答過的題
import { describe, expect, it } from 'vitest'
import { HUAGUOSHAN, SHUILIANDONG } from './chapter'
import { QUESTIONS, getQuestion } from './bank'
import { makeRng } from './rng'
import { adaptPlan, displayQuestion, planStation, promptPattern, recentQuestionIds, type PlannedQuestion } from './select'
import { initialSkillState } from './skills'
import { MATH2_SKILLS, MATH_SKILLS, SKILLS, type Attempt, type Difficulty, type SkillId, type SkillState } from './types'
import { ENGLISH_ISLAND, LIFE_TOWN, NATURE_FOREST } from './chapter'
import { CHALLENGE_MIN_DIFFICULTY, bumpStates, easyTypesToSkip } from '../db/quest7'
import { parseReplayId, replayChapterId, resolveStage } from './subject'

const T0 = new Date(2026, 5, 10, 9, 0, 0).getTime()
const states = (d: Difficulty = 1, over: Partial<Record<SkillId, Difficulty>> = {}) =>
  Object.fromEntries(SKILLS.map((k) => [k, { ...initialSkillState(k, 0, over[k] ?? d) }])) as Record<SkillId, SkillState>

describe('H2 3 歲（幼幼）數學第 1 章的題型池', () => {
  const plans = (station: number, seeds: number) =>
    Array.from({ length: seeds }, (_, s) =>
      planStation({ stationIndex: station, states: states(1), attempts: [], now: T0, rng: makeRng(s + 1), gentle: true, slots: HUAGUOSHAN.stations[station].slots, skills: MATH_SKILLS }),
    )
  it('前 3 站 15 題：平均至少 7 種題型；同一站同一題型不超過 2 題', () => {
    let totalKinds = 0
    const N = 60
    for (let seed = 0; seed < N; seed++) {
      const all: string[] = []
      for (let st = 0; st < 3; st++) {
        const p = planStation({ stationIndex: st, states: states(1), attempts: [], now: T0, rng: makeRng(seed * 7 + st + 1), gentle: true, slots: HUAGUOSHAN.stations[st].slots, skills: MATH_SKILLS })
        const counts = new Map<string, number>()
        for (const x of p) counts.set(x.question.type, (counts.get(x.question.type) ?? 0) + 1)
        for (const [t, n] of counts) expect(n, `seed ${seed} 站 ${st + 1} ${t}`).toBeLessThanOrEqual(2)
        all.push(...p.map((x) => x.question.type))
      }
      totalKinds += new Set(all).size
    }
    expect(totalKinds / N).toBeGreaterThanOrEqual(7)
  })
  it('「接下來是哪一個」不再佔 1/3：整體不超過 25%', () => {
    let next = 0
    let total = 0
    for (let st = 0; st < 5; st++)
      for (const p of plans(st, 40)) {
        for (const x of p) {
          total++
          if (x.question.type === 'next') next++
        }
      }
    expect(next / total).toBeLessThan(0.25)
  })
  it('新題型都出得到：比多少（compare）、顏色（color）、顏色配對（same）、缺一個（missing）', () => {
    const seen = new Set<string>()
    for (let st = 0; st < 5; st++) for (const p of plans(st, 40)) for (const x of p) seen.add(x.question.type)
    for (const t of ['count', 'give', 'compare', 'kind', 'same', 'color', 'next', 'missing']) expect(seen.has(t), t).toBe(true)
  })
  it('比多少的選項：幼幼模式縮成 2 個，顯示時兩堆都在', () => {
    const q = QUESTIONS.find((x) => x.gentle && x.type === 'compare')!
    const d = displayQuestion(q, 's', true)
    expect(d.choices).toHaveLength(2)
    expect(d.choices.map((c) => c.id).sort()).toEqual(['A', 'B'])
  })
  it('舊題目的 id 沒有被動到（新題接在後面編號）', () => {
    for (const id of ['number-1-g01', 'number-1-g24', 'classify-1-g24', 'pattern-1-g24']) expect(getQuestion(id), id).toBeDefined()
    expect(getQuestion('number-1-g25')?.type).toBe('compare')
    expect(getQuestion('classify-1-g25')?.type).toBe('color')
    expect(getQuestion('pattern-1-g25')?.type).toBe('missing')
    expect(getQuestion('number-1-g24')?.type).toBe('count')
  })
})

describe('H3 句型輪替：同一站不連續出同一句', () => {
  it('句型 = 最後一個逗號或句號後面那一段', () => {
    expect(promptPattern({ prompt: '吃完東西了，哪一個是對的做法呢？' })).toBe('哪一個是對的做法呢？')
    expect(promptPattern({ prompt: '和朋友相處，哪一個是好的做法呢？' })).toBe('哪一個是好的做法呢？')
    expect(promptPattern({ prompt: '哪一個是水果？' })).toBe('哪一個是水果？')
    expect(promptPattern({ prompt: '請拿三顆蘋果給阿悟。' })).toBe('請拿三顆蘋果給阿悟')
  })
  it('生活、英文、自然（難度 1–4、五站、各 40 種亂數）：相鄰兩題的句型一定不一樣', () => {
    let clash = 0
    let pairs = 0
    for (const [skill, ch] of [['life', LIFE_TOWN], ['english', ENGLISH_ISLAND], ['nature', NATURE_FOREST]] as const) {
      for (const d of [1, 2, 3, 4] as Difficulty[]) {
        for (let station = 0; station < 5; station++) {
          for (let seed = 0; seed < 40; seed++) {
            const p = planStation({ stationIndex: station, states: states(d), attempts: [], now: T0, rng: makeRng(seed + 3), skills: [skill], slots: ch.stations[station].slots })
            for (let i = 1; i < p.length; i++) {
              pairs++
              if (promptPattern(p[i].question) === promptPattern(p[i - 1].question)) clash++
            }
          }
        }
      }
    }
    expect(pairs).toBe(3 * 4 * 5 * 40 * 4)
    expect(clash).toBe(0)
  })
  it('adaptPlan 重抽時也守同一條規則', () => {
    const base = planStation({ stationIndex: 0, states: states(1), attempts: [], now: T0, rng: makeRng(4), skills: ['life'] })
    const next = adaptPlan({ plan: base, from: 1, states: states(2), attempts: [], stationAttempts: [], rng: makeRng(9) })
    for (let i = 1; i < next.length; i++) expect(promptPattern(next[i].question)).not.toBe(promptPattern(next[i - 1].question))
  })
})

describe('H3 6–7 歲：第 1 站不出「請你指出水果」、挑戰站從難度 3 起跳', () => {
  it('easyTypesToSkip：只有 6–7 歲、花果山第 1 站、分類難度 >= 2 才擋 kind', () => {
    expect(easyTypesToSkip('6-7', 'huaguoshan', 0, 2)?.has('kind')).toBe(true)
    expect(easyTypesToSkip('6-7', 'huaguoshan', 1, 2)).toBeUndefined()
    expect(easyTypesToSkip('6-7', 'huaguoshan', 0, 1)).toBeUndefined() // 分級結果就是從最簡單開始
    expect(easyTypesToSkip('4-5', 'huaguoshan', 0, 2)).toBeUndefined()
    expect(easyTypesToSkip('6-7', 'shuiliandong', 0, 2)).toBeUndefined()
    expect(easyTypesToSkip(undefined, 'huaguoshan', 0, 2)).toBeUndefined()
  })
  it('6–7 歲（難度 2）第 1 站：60 種亂數都不出 kind；沒擋的話確實會出（對照）', () => {
    const slots = HUAGUOSHAN.stations[0].slots
    let withSkip = 0
    let without = 0
    for (let seed = 0; seed < 60; seed++) {
      const o = { stationIndex: 0, states: states(2), attempts: [] as Attempt[], now: T0, rng: makeRng(seed + 1), slots, skills: MATH_SKILLS }
      withSkip += planStation({ ...o, skipTypes: new Set(['kind']) }).filter((x) => x.question.type === 'kind').length
      without += planStation({ ...o, rng: makeRng(seed + 1) }).filter((x) => x.question.type === 'kind').length
    }
    expect(withSkip).toBe(0)
    expect(without).toBeGreaterThan(0)
  })
  it('題庫真的不夠換時才放寬（不會丟錯）', () => {
    const only = QUESTIONS.filter((q) => q.skill === 'classify' && q.difficulty === 2 && q.type === 'kind')
    const bank = QUESTIONS.filter((q) => q.skill !== 'classify' || q.difficulty !== 2).concat(only)
    const p = planStation({ stationIndex: 0, states: states(2), attempts: [], now: T0, rng: makeRng(2), bank, skills: ['classify'], skipTypes: new Set(['kind']) })
    expect(p).toHaveLength(5)
  })
  it('bumpStates：預設比目前高 1 級（最高 4）；6–7 歲挑戰站最低從 3 起跳', () => {
    const s = states(1, { number: 1, classify: 2, pattern: 3, measure: 4 })
    expect(bumpStates(s).number.difficulty).toBe(2)
    expect(bumpStates(s).pattern.difficulty).toBe(4)
    expect(bumpStates(s).measure.difficulty).toBe(4)
    expect(CHALLENGE_MIN_DIFFICULTY).toBe(3)
    const b = bumpStates(s, CHALLENGE_MIN_DIFFICULTY)
    expect(b.number.difficulty).toBe(3)
    expect(b.classify.difficulty).toBe(3)
    expect(b.pattern.difficulty).toBe(4)
    expect(b.measure.difficulty).toBe(4)
    for (const k of [...MATH_SKILLS, ...MATH2_SKILLS]) expect(b[k].difficulty).toBeGreaterThanOrEqual(3)
  })
})

describe('H1 重玩：避開最近答過的題、replay 章節代號', () => {
  const att = (questionId: string, at: number): Pick<Attempt, 'questionId' | 'at'> => ({ questionId, at })
  it('recentQuestionIds：取最近的 n 題（新到舊、不重複）', () => {
    const list = [att('a', 1), att('b', 2), att('c', 3), att('a', 4)]
    expect([...recentQuestionIds(list, 2)].sort()).toEqual(['a', 'c'])
    expect(recentQuestionIds(list, 10).size).toBe(3)
    expect(recentQuestionIds([], 5).size).toBe(0)
  })
  it('planStation 帶 exclude：題庫夠換就完全避開；每一站 5 題都避開', () => {
    const first = planStation({ stationIndex: 0, states: states(1), attempts: [], now: T0, rng: makeRng(5), slots: HUAGUOSHAN.stations[0].slots, skills: MATH_SKILLS })
    const attempts: Attempt[] = first.map((p, i) => ({ id: `a${i}`, at: T0 + i, questionId: p.question.id, skill: p.question.skill, difficulty: 1, firstTryCorrect: true, hintsUsed: 0, durationMs: 1, sessionId: 's' }))
    const avoid = recentQuestionIds(attempts)
    for (let seed = 0; seed < 30; seed++) {
      const again: PlannedQuestion[] = planStation({ stationIndex: 0, states: states(1), attempts, now: T0 + 99, rng: makeRng(seed + 20), slots: HUAGUOSHAN.stations[0].slots, skills: MATH_SKILLS, exclude: avoid })
      expect(again.filter((p) => avoid.has(p.question.id))).toHaveLength(0)
    }
  })
  it('replay:<章節> 代號：解析、對應原本那一站、不存在的章節回傳 undefined', () => {
    expect(replayChapterId('huaguoshan')).toBe('replay:huaguoshan')
    expect(parseReplayId('replay:shuiliandong')?.id).toBe(SHUILIANDONG.id)
    expect(parseReplayId('huaguoshan')).toBeNull()
    expect(parseReplayId('replay:nope')).toBeNull()
    const info = resolveStage('replay:huaguoshan', 3, '2026-10-29')
    expect(info).toMatchObject({ replay: true, daily: false, subject: 'math', chapterName: '花果山' })
    expect(info?.def.index).toBe(3)
    expect(resolveStage('replay:huaguoshan', 9, '2026-10-29')).toBeUndefined()
    expect(resolveStage('replay:nope', 1, '2026-10-29')).toBeUndefined()
  })
})
