import { describe, expect, it } from 'vitest'
import { QUESTIONS, questionsFor } from './bank'
import { makeRng } from './rng'
import { pickQuestion, planStation, seenFromAttempts } from './select'
import {
  applyAttempt,
  applyStationResult,
  daysBetween,
  dueReviews,
  initialSkillState,
  recordReview,
} from './skills'
import { stationRewardQty, summarize } from './scoring'
import { buildReport } from './report'
import { isLockedByTime, learningSettingsOf, remainingSeconds } from './playtime'
import { canCraft, balanceOfMaterials, DECOR_COSTS, SHOP_CATALOG } from './materials'
import { chineseNumber, countAloud, isSpeechSupported, pickZhTwVoice, speak } from './speech'
import { isIndependent, SKILLS, type Attempt, type Difficulty, type SkillId, type SkillState } from './types'
import { SHOP_ITEMS } from '../domain/constants'

const T0 = new Date(2026, 5, 10, 9, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

let seq = 0
function att(skill: SkillId, o: Partial<Attempt> = {}): Attempt {
  seq++
  return {
    id: `a${seq}`,
    at: T0,
    questionId: `${skill}-1-01`,
    skill,
    difficulty: 1,
    firstTryCorrect: true,
    hintsUsed: 0,
    durationMs: 3000,
    sessionId: 's1',
    ...o,
  }
}
const wrongThenRight = (skill: SkillId, o: Partial<Attempt> = {}) => att(skill, { firstTryCorrect: false, hintsUsed: 1, ...o })
const allStates = (over: Partial<Record<SkillId, Partial<SkillState>>> = {}) =>
  Object.fromEntries(SKILLS.map((k) => [k, { ...initialSkillState(k), ...over[k] }])) as Record<SkillId, SkillState>

describe('計分', () => {
  it('提示後答對不算獨立答對', () => {
    expect(isIndependent({ firstTryCorrect: true, hintsUsed: 0 })).toBe(true)
    expect(isIndependent({ firstTryCorrect: false, hintsUsed: 1 })).toBe(false)
    expect(isIndependent({ firstTryCorrect: false, hintsUsed: 2 })).toBe(false)
    const s = summarize([att('number'), wrongThenRight('number'), att('pattern'), wrongThenRight('classify', { hintsUsed: 2 })])
    expect(s).toMatchObject({ total: 4, independent: 2 })
    expect(s.bySkill.number).toEqual({ total: 2, independent: 1 })
    expect(s.bySkill.classify).toEqual({ total: 1, independent: 0 })
  })
  it('一站材料 2–4 個，依無提示答對數', () => {
    expect([0, 1, 2, 3, 4, 5].map(stationRewardQty)).toEqual([2, 2, 3, 3, 4, 4])
  })
})

describe('難度調整', () => {
  const feed = (state: SkillState, results: boolean[], difficulty: Difficulty = state.difficulty) =>
    results.reduce((s, ok) => applyAttempt(s, ok ? att(s.skill, { difficulty }) : wrongThenRight(s.skill, { difficulty })), state)
  it('最近 5 題無提示答對 >= 4 → 升一級；變更後清空 recent', () => {
    const s = feed(initialSkillState('number'), [true, true, true, false, true])
    expect(s.difficulty).toBe(2)
    expect(s.recent).toEqual([])
  })
  it('<= 1 → 降一級，最低 1、最高 3', () => {
    expect(feed(initialSkillState('number'), [false, false, false, false, false]).difficulty).toBe(1)
    const at2 = { ...initialSkillState('number'), difficulty: 2 as Difficulty }
    expect(feed(at2, [false, true, false, false, false]).difficulty).toBe(1)
    const at3 = { ...initialSkillState('number'), difficulty: 3 as Difficulty }
    expect(feed(at3, [true, true, true, true, true]).difficulty).toBe(3)
  })
  it('2–3 題答對維持原級；未滿 5 題不調整', () => {
    expect(feed(initialSkillState('pattern'), [true, true, true, true]).difficulty).toBe(1)
    expect(feed(initialSkillState('pattern'), [true, false, true, false, false]).difficulty).toBe(1)
  })
  it('提示後答對不算進升級條件', () => {
    const s = [1, 2, 3, 4, 5].reduce((st) => applyAttempt(st, wrongThenRight('number')), initialSkillState('number'))
    expect(s.difficulty).toBe(1)
    const up = feed(initialSkillState('number'), [true, true, true, true, true])
    expect(up.difficulty).toBe(2)
    const stillOne = [true, true, true].reduce((st) => applyAttempt(st, att('number')), initialSkillState('number'))
    const withHints = [1, 2].reduce((st) => applyAttempt(st, wrongThenRight('number')), stillOne)
    expect(withHints.difficulty).toBe(1)
  })
  it('其他難度的題與複習題不影響目前難度的判斷', () => {
    const base = initialSkillState('number')
    expect(applyAttempt(base, att('number', { difficulty: 3 })).recent).toEqual([])
    expect(applyAttempt(base, att('classify')).recent).toEqual([])
  })
})

describe('掌握與複習排程', () => {
  const station = (skill: SkillId, results: boolean[]) => results.map((ok) => (ok ? att(skill) : wrongThenRight(skill)))
  it('連續 2 站 >= 80% 無提示答對 → 已掌握；中間一站不及格則歸零', () => {
    let s = initialSkillState('number')
    s = applyStationResult(s, station('number', [true, true]), T0)
    expect(s.stationStreak).toBe(1)
    expect(s.mastered[1]).toBeUndefined()
    s = applyStationResult(s, station('number', [true, false]), T0)
    expect(s.stationStreak).toBe(0)
    s = applyStationResult(s, station('number', [true, true]), T0)
    s = applyStationResult(s, station('number', [true, true]), T0 + 1)
    expect(s.mastered[1]).toEqual({ masteredAt: T0 + 1, reviews: 0 })
  })
  it('該技能這站沒出題就不變', () => {
    const s = initialSkillState('number')
    expect(applyStationResult(s, station('pattern', [true, true]), T0)).toBe(s)
  })
  it('隔天、隔週、第 14 天複習；第 3 次標記 followUp；之後不再出', () => {
    let s: SkillState = { ...initialSkillState('classify'), mastered: { 1: { masteredAt: T0, reviews: 0 } } }
    expect(dueReviews(allStates({ classify: s }), T0)).toEqual([])
    expect(dueReviews(allStates({ classify: s }), T0 + DAY)).toMatchObject([{ skill: 'classify', level: 1, followUp: false }])
    s = recordReview(s, 1, T0 + DAY)
    expect(dueReviews(allStates({ classify: s }), T0 + 2 * DAY)).toEqual([])
    expect(dueReviews(allStates({ classify: s }), T0 + 7 * DAY)).toHaveLength(1)
    s = recordReview(s, 1, T0 + 7 * DAY)
    expect(dueReviews(allStates({ classify: s }), T0 + 13 * DAY)).toEqual([])
    expect(dueReviews(allStates({ classify: s }), T0 + 14 * DAY)).toMatchObject([{ followUp: true }])
    s = recordReview(s, 1, T0 + 14 * DAY)
    expect(dueReviews(allStates({ classify: s }), T0 + 40 * DAY)).toEqual([])
  })
  it('複習題作答只更新複習次數，不動難度', () => {
    const s: SkillState = { ...initialSkillState('number'), difficulty: 2, mastered: { 1: { masteredAt: T0, reviews: 0 } } }
    const r = applyAttempt(s, att('number', { review: true, difficulty: 1, at: T0 + DAY }))
    expect(r.difficulty).toBe(2)
    expect(r.recent).toEqual([])
    expect(r.mastered[1]?.reviews).toBe(1)
  })
  it('daysBetween 以本地日曆日計算', () => {
    const late = new Date(2026, 5, 10, 23, 59).getTime()
    const early = new Date(2026, 5, 11, 0, 1).getTime()
    expect(daysBetween(late, early)).toBe(1)
    expect(daysBetween(T0, T0 + 3 * 3_600_000)).toBe(0)
  })
})

describe('抽題與關卡規劃', () => {
  it('重玩時優先抽沒做過的題面；題庫用完才重複', () => {
    const pool = questionsFor('number', 1)
    const rng = makeRng(7)
    const attempts: Attempt[] = []
    const got = new Set<string>()
    for (let i = 0; i < pool.length; i++) {
      const q = pickQuestion({ skill: 'number', difficulty: 1, seen: seenFromAttempts(attempts), rng })!
      expect(got.has(q.id), `第 ${i} 次抽到重複題 ${q.id}`).toBe(false)
      got.add(q.id)
      attempts.push(att('number', { questionId: q.id, at: T0 + i }))
    }
    expect(got.size).toBe(pool.length)
    const again = pickQuestion({ skill: 'number', difficulty: 1, seen: seenFromAttempts(attempts), rng })!
    expect(pool.map((p) => p.id)).toContain(again.id)
  })
  it('exclude 的題不會被抽到；全排除回傳 null', () => {
    const ids = new Set(questionsFor('pattern', 2).map((q) => q.id))
    expect(pickQuestion({ skill: 'pattern', difficulty: 2, seen: seenFromAttempts([]), rng: makeRng(1), exclude: ids })).toBeNull()
  })
  it('一站 5 題：三種技能混合、題目不重複、依各技能目前難度', () => {
    for (let st = 0; st < 6; st++) {
      const states = allStates({ number: { difficulty: 2 }, pattern: { difficulty: 3 } })
      const plan = planStation({ stationIndex: st, states, attempts: [], now: T0, rng: makeRng(st + 1) })
      expect(plan).toHaveLength(5)
      expect(new Set(plan.map((p) => p.question.id)).size).toBe(5)
      expect(new Set(plan.map((p) => p.question.skill)).size).toBe(3)
      for (const p of plan) {
        expect(p.review).toBe(false)
        expect(p.question.difficulty).toBe(states[p.question.skill].difficulty)
      }
      for (let i = 1; i < plan.length; i++) expect(plan[i].question.skill).not.toBe(plan[i - 1].question.skill)
    }
  })
  it('第二輪的題面和第一輪不同（同一技能難度還有沒做過的題）', () => {
    const states = allStates()
    const first = planStation({ stationIndex: 0, states, attempts: [], now: T0, rng: makeRng(3) })
    const attempts = first.map((p, i) => att(p.question.skill, { questionId: p.question.id, difficulty: p.question.difficulty, at: T0 + i }))
    const second = planStation({ stationIndex: 0, states, attempts, now: T0, rng: makeRng(4) })
    const firstIds = new Set(first.map((p) => p.question.id))
    expect(second.every((p) => !firstIds.has(p.question.id))).toBe(true)
  })
  it('有到期複習時，換成 1 題複習題（掌握的難度、不同題面）；沒到期則沒有', () => {
    const states = allStates({ number: { difficulty: 2, mastered: { 1: { masteredAt: T0, reviews: 0 } } } })
    const none = planStation({ stationIndex: 0, states, attempts: [], now: T0, rng: makeRng(1) })
    expect(none.some((p) => p.review)).toBe(false)
    const seenQ = questionsFor('number', 1)[0]
    const attempts = [att('number', { questionId: seenQ.id })]
    const plan = planStation({ stationIndex: 0, states, attempts, now: T0 + DAY, rng: makeRng(1) })
    const reviews = plan.filter((p) => p.review)
    expect(reviews).toHaveLength(1)
    expect(reviews[0].question).toMatchObject({ skill: 'number', difficulty: 1 })
    expect(reviews[0].question.id).not.toBe(seenQ.id)
    expect(reviews[0].followUp).toBe(false)
    expect(plan).toHaveLength(5)
    expect(new Set(plan.map((p) => p.question.id)).size).toBe(5)
  })
  it('題庫總量足夠多輪抽題不出錯', () => {
    const attempts: Attempt[] = []
    for (let r = 0; r < 12; r++) {
      const plan = planStation({ stationIndex: r, states: allStates(), attempts, now: T0, rng: makeRng(r) })
      plan.forEach((p, i) => attempts.push(att(p.question.skill, { questionId: p.question.id, at: T0 + r * 10 + i })))
    }
    expect(QUESTIONS.length).toBeGreaterThan(100)
  })
})

describe('學習報告', () => {
  it('數字與 attempts 一致：回合數、各技能題數與無提示答對率、每日長條', () => {
    const day = (n: number) => T0 - n * DAY
    const attempts = [
      att('number', { sessionId: 'a', at: day(0) }),
      att('number', { sessionId: 'a', at: day(0) }),
      wrongThenRight('number', { sessionId: 'a', at: day(0) }),
      wrongThenRight('pattern', { sessionId: 'b', at: day(2) }),
      wrongThenRight('pattern', { sessionId: 'b', at: day(2) }),
      att('pattern', { sessionId: 'b', at: day(2) }),
      att('classify', { sessionId: 'old', at: day(10) }), // 不在最近 7 天
    ]
    const r = buildReport(attempts, allStates(), T0 + 1000)
    expect(r.sessions).toBe(2)
    expect(r.totalAttempts).toBe(6)
    const by = Object.fromEntries(r.skills.map((s) => [s.skill, s]))
    expect(by.number).toMatchObject({ total: 3, independent: 2 })
    expect(by.number.rate).toBeCloseTo(2 / 3)
    expect(by.pattern).toMatchObject({ total: 3, independent: 1 })
    expect(by.classify).toMatchObject({ total: 0, independent: 0, rate: null })
    expect(r.weakest).toBe('pattern')
    expect(r.daily).toHaveLength(7)
    expect(r.daily.reduce((n, d) => n + d.count, 0)).toBe(6)
    expect(r.daily[6].count).toBe(3)
    expect(r.daily[4].count).toBe(3)
    expect(r.summary).toContain('2 回合')
    expect(by.pattern.text).toContain('加強')
  })
  it('全部很穩或資料不足時不標需要加強；沒資料有白話說明', () => {
    const none = buildReport([], allStates(), T0)
    expect(none.weakest).toBeNull()
    expect(none.summary).toContain('還沒有')
    const good = Array.from({ length: 5 }, () => att('number'))
    const r = buildReport(good, allStates(), T0)
    expect(r.weakest).toBeNull()
    expect(r.skills[0].text).toContain('很穩')
  })
})

describe('遊玩時間', () => {
  it('預設 20 分鐘、音效語音預設開', () => {
    expect(learningSettingsOf(undefined)).toEqual({ dailyLimitMin: 20, soundOn: true, voiceOn: true })
    expect(learningSettingsOf({ dailyLimitMin: 0, soundOn: false })).toEqual({ dailyLimitMin: 0, soundOn: false, voiceOn: true })
  })
  it('剩餘秒數含家長延長；不限為 null；用完才鎖', () => {
    expect(remainingSeconds(20, { seconds: 600, bonusSeconds: 0 })).toBe(600)
    expect(remainingSeconds(20, { seconds: 1200, bonusSeconds: 0 })).toBe(0)
    expect(isLockedByTime(20, { seconds: 1200, bonusSeconds: 0 })).toBe(true)
    expect(isLockedByTime(20, { seconds: 1200, bonusSeconds: 600 })).toBe(false)
    expect(remainingSeconds(0, { seconds: 99999, bonusSeconds: 0 })).toBeNull()
    expect(isLockedByTime(0, { seconds: 99999, bonusSeconds: 0 })).toBe(false)
    expect(isLockedByTime(15, undefined)).toBe(false)
  })
})

describe('材料與家具', () => {
  it('每件家具都有成本，且 SHOP_CATALOG 只在家具上加 cost', () => {
    const decor = SHOP_ITEMS.filter((i) => i.kind === 'decor')
    expect(decor.length).toBe(24)
    for (const d of decor) {
      expect(DECOR_COSTS[d.id], d.id).toBeDefined()
      expect(SHOP_CATALOG.find((i) => i.id === d.id)?.cost).toEqual(DECOR_COSTS[d.id])
    }
    expect(SHOP_CATALOG.filter((i) => i.kind !== 'decor' && i.kind !== 'theme').every((i) => !i.cost)).toBe(true)
  })
  it('canCraft：材料不足回報差多少；已擁有不能再做', () => {
    const plant = SHOP_CATALOG.find((i) => i.id === 'decor-plant')!
    const bal = balanceOfMaterials([{ material: 'wood', delta: 1 }, { material: 'flower', delta: 1 }])
    expect(canCraft(bal, 0, plant)).toMatchObject({ ok: false, reason: 'insufficient', short: { flower: 2 } })
    expect(canCraft({ wood: 9, stone: 9, flower: 9 }, 0, plant)).toEqual({ ok: true })
    expect(canCraft({ wood: 9, stone: 9, flower: 9 }, 1, plant)).toMatchObject({ ok: false, reason: 'owned' })
  })
})

describe('語音', () => {
  it('node 環境（無 Web Speech API）不拋錯、回報不支援、speak 回傳 false', () => {
    expect(isSpeechSupported()).toBe(false)
    expect(speak('數一數')).toBe(false)
  })
  it('挑選 zh-TW 語音，沒有則退而求其次', () => {
    expect(pickZhTwVoice([{ lang: 'en-US', name: 'a' }, { lang: 'zh_TW', name: 'b' }])?.name).toBe('b')
    expect(pickZhTwVoice([{ lang: 'zh-CN', name: 'c' }])?.name).toBe('c')
    expect(pickZhTwVoice([{ lang: 'en-US', name: 'a' }])).toBeUndefined()
  })
  it('數數語音稿', () => {
    expect(chineseNumber(12)).toBe('十二')
    expect(chineseNumber(20)).toBe('二十')
    expect(countAloud(3)).toBe('一、二、三')
  })
})
