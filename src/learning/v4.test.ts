import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { HUAGUOSHAN } from './chapter'
import { isTutorialId, needsTutorial, TUTORIAL_INTERACTIONS, tutorialQuestion } from './tutorial'
import { QUESTIONS, questionsFor } from './bank'
import { feedbackLines } from './feedbackLines'
import { allLines, gentleHintKey, questionKey, questionLines, pickLine, STATIC_LINES, wordKey } from './lines'
import { learnerProfileOf } from './profile'
import { makeRng } from './rng'
import { adaptPlan, displayQuestion, pickQuestion, planStation, seenFromAttempts, type PlannedQuestion } from './select'
import { applyAttempt, dueReviews, initialSkillState, MISSES_TO_UNMASTER, recordReview } from './skills'
import { buildReport } from './report'
import { say, registerLineAudio } from './speech'
import { MATH_SKILLS, SKILLS, type Attempt, type Difficulty, type SkillId, type SkillState } from './types'

const T0 = new Date(2026, 5, 10, 9, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000
let seq = 0
const att = (skill: SkillId, o: Partial<Attempt> = {}): Attempt => ({
  id: `v${++seq}`, at: T0, questionId: `${skill}-1-01`, skill, difficulty: 1, firstTryCorrect: true, hintsUsed: 0, durationMs: 1, sessionId: 's', ...o,
})
const wrong = (skill: SkillId, o: Partial<Attempt> = {}) => att(skill, { firstTryCorrect: false, hintsUsed: 1, ...o })
const states = (over: Partial<Record<SkillId, Partial<SkillState>>> = {}) =>
  Object.fromEntries(SKILLS.map((k) => [k, { ...initialSkillState(k), ...over[k] }])) as Record<SkillId, SkillState>
const seasoned = (skill: SkillId): SkillState => ({ ...initialSkillState(skill), total: 50 })

describe('年齡與學習檔案', () => {
  it('未設定 = 4–5 歲；3 歲是幼幼模式；6–7 歲從難度 2', () => {
    expect(learnerProfileOf(undefined)).toEqual({ ageBand: '4-5', configured: false, startDifficulty: 1, gentle: false })
    expect(learnerProfileOf({ ageBand: '3' })).toEqual({ ageBand: '3', configured: true, startDifficulty: 1, gentle: true })
    expect(learnerProfileOf({ ageBand: '4-5' })).toMatchObject({ startDifficulty: 1, gentle: false })
    expect(learnerProfileOf({ ageBand: '6-7' })).toMatchObject({ startDifficulty: 2, gentle: false })
  })
  it('initialSkillState 可以指定起始難度', () => {
    expect(initialSkillState('number', 0, 2)).toMatchObject({ difficulty: 2, total: 0, recent: [] })
  })
})

describe('升級、快速通道、掌握', () => {
  it('新技能前 3 題全部獨立答對 → 直接升一級，並把舊難度記成已掌握', () => {
    let s = initialSkillState('number')
    s = applyAttempt(s, att('number'))
    s = applyAttempt(s, att('number'))
    expect(s.difficulty).toBe(1)
    s = applyAttempt(s, att('number', { at: T0 + 5 }))
    expect(s.difficulty).toBe(2)
    expect(s.recent).toEqual([])
    expect(s.mastered[1]).toEqual({ masteredAt: T0 + 5, reviews: 0 })
  })
  it('前 3 題有一題沒獨立答對就不走快速通道；已經玩過的舊資料（沒有 total）也不會', () => {
    let s = initialSkillState('number')
    for (const a of [att('number'), wrong('number'), att('number')]) s = applyAttempt(s, a)
    expect(s.difficulty).toBe(1)
    let old: SkillState = { ...initialSkillState('number'), total: undefined }
    for (let i = 0; i < 3; i++) old = applyAttempt(old, att('number'))
    expect(old.difficulty).toBe(1)
    expect(old.total).toBeUndefined()
  })
  it('一般升級（最近 5 題 >= 4）也會寫入舊難度的掌握；降級不寫', () => {
    let s = seasoned('classify')
    for (const ok of [true, true, false, true, true]) s = applyAttempt(s, ok ? att('classify') : wrong('classify'))
    expect(s.difficulty).toBe(2)
    expect(s.mastered[1]).toBeDefined()
    let d = { ...seasoned('classify'), difficulty: 2 as Difficulty }
    for (const ok of [false, false, false, false, true]) d = applyAttempt(d, ok ? att('classify', { difficulty: 2 }) : wrong('classify', { difficulty: 2 }))
    expect(d.difficulty).toBe(1)
    expect(d.mastered[2]).toBeUndefined()
  })
  it('難度 4 是上限', () => {
    let s = { ...seasoned('pattern'), difficulty: 4 as Difficulty }
    for (let i = 0; i < 5; i++) s = applyAttempt(s, att('pattern', { difficulty: 4 }))
    expect(s.difficulty).toBe(4)
  })
  it('幼幼模式：沒有快速通道，要連續 5 題獨立答對才升級（4/5 不夠）', () => {
    let s = initialSkillState('number')
    for (let i = 0; i < 4; i++) s = applyAttempt(s, att('number'), { gentle: true })
    expect(s.difficulty).toBe(1)
    s = applyAttempt(s, wrong('number'), { gentle: true })
    expect(s.difficulty).toBe(1) // 4/5 在一般模式會升，幼幼模式不會
    let t = seasoned('number')
    for (let i = 0; i < 5; i++) t = applyAttempt(t, att('number'), { gentle: true })
    expect(t.difficulty).toBe(2)
  })
  it('站內救援抽的低 1 級題（非目前難度）不影響技能狀態', () => {
    const s = { ...seasoned('number'), difficulty: 2 as Difficulty, recent: [true, true] }
    const r = applyAttempt(s, wrong('number', { difficulty: 1 }))
    expect(r.recent).toEqual([true, true])
    expect(r.difficulty).toBe(2)
  })
})

describe('複習：答錯不算次數、隔天重考、連續 2 次錯清掉掌握', () => {
  const mastered = (): SkillState => ({ ...initialSkillState('number'), difficulty: 2, mastered: { 1: { masteredAt: T0, reviews: 0 } } })
  it('答錯：次數不加、記下今天複習過，所以今天不會再出、隔天又到期', () => {
    const r = applyAttempt(mastered(), wrong('number', { review: true, at: T0 + DAY }))
    expect(r.mastered[1]).toMatchObject({ reviews: 0, misses: 1, lastReviewAt: T0 + DAY })
    expect(dueReviews(states({ number: r }), T0 + DAY)).toEqual([])
    expect(dueReviews(states({ number: r }), T0 + 2 * DAY)).toHaveLength(1)
  })
  it('答對：次數 +1、misses 歸零；連續答錯 2 次 → 清掉這個難度的掌握', () => {
    let s = applyAttempt(mastered(), wrong('number', { review: true, at: T0 + DAY }))
    s = applyAttempt(s, att('number', { review: true, at: T0 + 2 * DAY }))
    expect(s.mastered[1]).toMatchObject({ reviews: 1, misses: 0 })
    let t = mastered()
    for (let i = 0; i < MISSES_TO_UNMASTER; i++) t = recordReview(t, 1, T0 + (i + 1) * DAY, false)
    expect(t.mastered[1]).toBeUndefined()
  })
  it('掌握紀錄不存在（被清掉或題庫改版）時複習結果不會報錯', () => {
    const s = initialSkillState('number')
    expect(applyAttempt(s, att('number', { review: true, difficulty: 3 })).mastered).toEqual({})
  })
  it('複習優先「目前難度」與「目前 −1」，太低的排後面', () => {
    const st = states({
      number: { difficulty: 3, mastered: { 1: { masteredAt: T0 - 30 * DAY, reviews: 0 }, 2: { masteredAt: T0 - 3 * DAY, reviews: 0 }, 3: { masteredAt: T0 - 2 * DAY, reviews: 0 } } },
    })
    const due = dueReviews(st, T0)
    expect(due.map((d) => d.level)).toEqual([2, 3, 1])
  })
})

describe('站中調整剩下的題', () => {
  const planOf = (stationIndex: number, st: Record<SkillId, SkillState>): PlannedQuestion[] =>
    planStation({ stationIndex, states: st, attempts: [], now: T0, rng: makeRng(3) })
  it('剛升級：剩下的同技能題改用新難度重抽，其他技能不動', () => {
    const plan = planOf(0, states())
    const st = states({ number: { difficulty: 2 } })
    const next = adaptPlan({ plan, from: 1, states: st, attempts: [], stationAttempts: [], rng: makeRng(9) })
    expect(next[0]).toBe(plan[0])
    for (let i = 1; i < plan.length; i++) {
      const sk = plan[i].question.skill
      expect(next[i].question.difficulty).toBe(sk === 'number' ? 2 : 1)
    }
    expect(new Set(next.map((p) => p.question.id)).size).toBe(plan.length)
  })
  it('同技能連續 2 題第一次就答錯：該技能的下一題從低 1 級抽，再下一題回到目前難度', () => {
    const st = states({ number: { difficulty: 3 }, classify: { difficulty: 3 }, pattern: { difficulty: 3 } })
    const plan = planOf(0, st) // number, classify, pattern, number, classify
    const answered = [wrong('number'), wrong('number')]
    // 假裝前兩題都是 number 錯（順序只看技能）
    const next = adaptPlan({ plan, from: 3, states: st, attempts: [], stationAttempts: answered, rng: makeRng(2) })
    expect(plan[3].question.skill).toBe('number')
    expect(next[3].question.difficulty).toBe(2)
    expect(next[4].question.difficulty).toBe(3) // classify 沒有連錯
    const second = adaptPlan({ plan, from: 3, states: st, attempts: [], stationAttempts: [wrong('number'), att('number')], rng: makeRng(2) })
    expect(second[3].question.difficulty).toBe(3)
  })
  it('難度 1 沒有更低的一級；複習題不會被換掉', () => {
    const st = states()
    const plan = planOf(0, st)
    plan[2] = { ...plan[2], review: true }
    const next = adaptPlan({ plan, from: 1, states: st, attempts: [], stationAttempts: [wrong('pattern'), wrong('pattern')], rng: makeRng(1) })
    expect(next[2]).toBe(plan[2])
    expect(next.every((p) => p.question.difficulty === 1)).toBe(true)
  })
})

describe('給孩子看的題目（洗牌與幼幼模式）', () => {
  const pick = (skill: SkillId, difficulty: Difficulty, type?: string) => questionsFor(skill, difficulty).find((q) => !type || q.type === type)!
  it('同一個 seed 順序永遠一樣；不同 seed 會變；答案和選項內容不變', () => {
    const q = pick('classify', 3)
    const a = displayQuestion(q, 'sess1')
    expect(displayQuestion(q, 'sess1').choices.map((c) => c.id)).toEqual(a.choices.map((c) => c.id))
    expect([...a.choices.map((c) => c.id)].sort()).toEqual([...q.choices.map((c) => c.id)].sort())
    const orders = new Set(Array.from({ length: 12 }, (_, i) => displayQuestion(q, `s${i}`).choices.map((c) => c.id).join()))
    expect(orders.size).toBeGreaterThan(3)
    expect(a.answer).toBe(q.answer)
  })
  it('數字選項維持由小到大；執行期洗牌後答案位置在三個位置都會出現', () => {
    const q = pick('number', 2, 'count')
    expect(displayQuestion(q, 'x').choices.map((c) => Number(c.label))).toEqual(q.choices.map((c) => Number(c.label)))
    // 物件選項：答案位置平均
    const odd = questionsFor('classify', 3).filter((x) => x.type === 'odd')
    const pos = [0, 0, 0, 0]
    for (let i = 0; i < 400; i++) {
      const d = displayQuestion(odd[i % odd.length], `seed${i}`)
      pos[d.choices.findIndex((c) => c.id === d.answer)]++
    }
    for (const p of pos) expect(p).toBeGreaterThan(60)
  })
  it('幼幼模式：選項縮成 2 個，一定含答案；數字題留最接近的', () => {
    for (const q of QUESTIONS.filter((x) => !x.gentle && x.choices.length === 3).slice(0, 60)) {
      const d = displayQuestion(q, 'g', true)
      expect(d.choices).toHaveLength(2)
      expect(d.choices.some((c) => c.id === q.answer)).toBe(true)
    }
    const c = pick('number', 1, 'count')
    const d = displayQuestion(c, 'g', true)
    const other = d.choices.find((x) => x.id !== c.answer)!
    const dist = (x: string) => Math.abs(Number(x) - Number(c.answer))
    expect(dist(other.id)).toBe(Math.min(...c.choices.filter((x) => x.id !== c.answer).map((x) => dist(x.id))))
  })
  it('拿給我（tapN）不洗牌、不縮選項', () => {
    const q = pick('number', 1, 'give')
    expect(displayQuestion(q, 'x', true)).toBe(q)
  })
})

describe('抽題：幼幼模式與舊資料', () => {
  it('一般模式不會抽到幼幼專用題；幼幼模式難度 1 抽得到（且 1–3 個）', () => {
    for (let i = 0; i < 30; i++) {
      const g = pickQuestion({ skill: 'number', difficulty: 1, seen: seenFromAttempts([]), rng: makeRng(i), gentle: true })!
      expect(Number(g.answer)).toBeLessThanOrEqual(3)
      const n = pickQuestion({ skill: 'classify', difficulty: 1, seen: seenFromAttempts([]), rng: makeRng(i) })!
      expect(n.gentle).toBeFalsy()
    }
    const plan = planStation({ stationIndex: 0, states: states(), attempts: [], now: T0, rng: makeRng(1), gentle: true })
    expect(plan.filter((p) => p.question.skill === 'classify').every((p) => p.question.gentle)).toBe(true)
    expect(plan.filter((p) => p.question.skill === 'pattern').every((p) => p.question.gentle)).toBe(true)
  })
  it('舊紀錄裡已經不存在的題目 id、舊的掌握紀錄都不會讓出題出錯', () => {
    const attempts = ['number-1-99', 'classify-3-14', 'pattern-2-77'].map((id) => att('number', { questionId: id }))
    const st = states({ number: { difficulty: 2, mastered: { 1: { masteredAt: T0 - 5 * DAY, reviews: 0 } } }, classify: { total: undefined, mastered: { 3: { masteredAt: T0 - 9 * DAY, reviews: 1 } } } })
    const plan = planStation({ stationIndex: 1, states: st, attempts, now: T0, rng: makeRng(5) })
    expect(plan).toHaveLength(5)
    expect(plan.some((p) => p.review)).toBe(true)
    for (const p of plan) expect(QUESTIONS.includes(p.question)).toBe(true)
  })
})

describe('報告', () => {
  it('難度 4 有說明，最高難度很穩時建議請孩子自己說想法', () => {
    const st = states({ number: { difficulty: 4 } })
    const r = buildReport(Array.from({ length: 5 }, () => att('number', { difficulty: 4 })), st, T0)
    expect(r.skills[0].levelLabel).toContain('加法')
    expect(r.skills[0].text).toContain('自己說說想法')
  })
})

describe('句子集中管理（key 架構）', () => {
  const all = allLines(QUESTIONS)
  it('每題的題目、提示、幼幼提示、逐個唸的詞都有穩定 key', () => {
    for (const q of QUESTIONS) {
      expect(all[questionKey(q.id, 'prompt')], q.id).toBe(q.prompt)
      expect(all[questionKey(q.id, 'hint')], q.id).toBe(q.hint)
      expect(all[gentleHintKey(q.id)], q.id).toContain(q.hint)
      for (const w of q.params?.words ?? []) if (w) expect(all[wordKey(w)]).toBe(w)
    }
    expect(questionLines(QUESTIONS[0]).map((l) => l.key)).toContain('q.number-1-01.prompt')
  })
  it('固定台詞每句有 key，輪流取用；數字與總數都在清單裡', () => {
    expect(pickLine('praise', 5)).toEqual({ key: 'praise.6', text: (STATIC_LINES.praise as string[])[5] })
    expect(pickLine('praise', 7)).toMatchObject({ key: 'praise.1' }) // 超過就從頭輪流
    expect(pickLine('hint.answer')).toEqual({ key: 'hint.answer', text: '答案在這裡，點點看。' })
    expect(all['num.7']).toBe('七')
    expect(all['count.total.5']).toBe('一共有五個')
    expect(Object.values(all).every((t) => typeof t === 'string' && t.length > 0)).toBe(true)
  })
  it('say(key, text)：沒有音檔或沒有語音支援時安靜地回傳 false；註冊音檔不會讓 node 環境出錯', () => {
    registerLineAudio({})
    expect(say('x', '你好')).toBe(false)
    expect(say('x', '你好', { enabled: false })).toBe(false)
    registerLineAudio({ x: 'a.mp3' }) // node 沒有 Audio：退回 speak，也是 false
    expect(say('x', '你好')).toBe(false)
    registerLineAudio({})
  })
})

describe('站型模板（L-B）', () => {
  const slotsOf = (stationIdx: number) => HUAGUOSHAN.stations[stationIdx].slots
  const interactionOf = (p: PlannedQuestion) => p.question.interaction ?? 'pick'
  it('章節 5 站都有站型：每站 5 個位置，第 1 站教學、第 5 站 Boss，每章最後一站是 Boss', () => {
    expect(HUAGUOSHAN.stations).toHaveLength(5)
    for (const st of HUAGUOSHAN.stations) expect(st.slots, st.name).toHaveLength(5)
    expect(HUAGUOSHAN.stations.map((s) => s.kind)).toEqual(['tutorial', 'normal', 'minigame', 'normal', 'boss'])
    expect(HUAGUOSHAN.stations[2].slots.filter((x) => x !== 'pick')).toHaveLength(2) // 小遊戲站兩題主互動
  })
  it('依站型排題：主互動位置抽指定互動、其他位置抽點選；三種技能維持 2/2/1；題目不重複', () => {
    for (let st = 0; st < 5; st++) {
      const plan = planStation({ stationIndex: st, states: states(), attempts: [], now: T0, rng: makeRng(st + 11), slots: slotsOf(st) })
      expect(plan).toHaveLength(5)
      expect(new Set(plan.map((p) => p.question.id)).size).toBe(5)
      expect(MATH_SKILLS.map((s) => plan.filter((p) => p.question.skill === s).length).sort().join()).toBe('1,2,2')
      expect(plan.every((p) => p.question.skill !== 'english')).toBe(true) // 數學站不會混進英文
      // 難度 1 的數感有「拿給我」、分類難度 1 沒有拖曳歸類（退回點選）
      slotsOf(st).forEach((want, i) => {
        if (want === 'tapN') expect(interactionOf(plan[i])).toBe('tapN')
        if (want === 'dragSort') expect(interactionOf(plan[i])).toBe('pick') // 難度 1 沒有歸類題
        if (want === 'pick') expect(interactionOf(plan[i])).toBe('pick')
      })
    }
  })
  it('技能在難度 2 時：拖曳歸類位置出歸類題、拿給我位置出拿給我', () => {
    const st = states({ number: { difficulty: 2 }, classify: { difficulty: 2 } })
    const plan = planStation({ stationIndex: 2, states: st, attempts: [], now: T0, rng: makeRng(3), slots: slotsOf(2) })
    expect(plan.map(interactionOf)).toEqual(['pick', 'tapN', 'pick', 'dragSort', 'pick'])
    expect(plan[1].question).toMatchObject({ skill: 'number', difficulty: 2 })
    expect(plan[3].question).toMatchObject({ skill: 'classify', difficulty: 2, type: 'bins' })
  })
  it('該技能目前難度沒有這種互動（數感難度 3 沒有拿給我）就退回點選，不會出錯', () => {
    const st = states({ number: { difficulty: 3 } })
    const plan = planStation({ stationIndex: 0, states: st, attempts: [], now: T0, rng: makeRng(2), slots: slotsOf(0) })
    expect(plan.every((p) => interactionOf(p) === 'pick')).toBe(true)
  })
  it('沒給站型時照舊（不限互動）；站中換題保持同一種互動', () => {
    const st = states({ number: { difficulty: 2 }, classify: { difficulty: 2 } })
    const plan = planStation({ stationIndex: 2, states: st, attempts: [], now: T0, rng: makeRng(3), slots: slotsOf(2) })
    const up = { ...st, number: { ...st.number, difficulty: 3 as Difficulty } }
    const next = adaptPlan({ plan, from: 1, states: up, attempts: [], stationAttempts: [], rng: makeRng(5) })
    // 數感升到 3：拿給我（難度 3 沒有）退回點選，其他仍保持
    expect(next[1].question.skill).toBe('number')
    expect(next[1].question.difficulty).toBe(3)
    expect(next[3].question.type).toBe('bins') // 分類沒變
  })
  it('教學：只有拿給我與拖曳歸類需要；看過就不再教；練習題不在題庫、id 以 tutorial- 開頭', () => {
    expect(needsTutorial('tapN', new Set())).toBe(true)
    expect(needsTutorial('dragSort', new Set(['tapN']))).toBe(true)
    expect(needsTutorial('tapN', new Set(['tapN']))).toBe(false)
    expect(needsTutorial('pick', new Set())).toBe(false)
    expect(needsTutorial(undefined, new Set())).toBe(false)
    for (const it of TUTORIAL_INTERACTIONS) {
      const q = tutorialQuestion(it)
      expect(isTutorialId(q.id)).toBe(true)
      expect(QUESTIONS.some((x) => x.id === q.id)).toBe(false)
      expect(q.interaction).toBe(it)
    }
  })
})

describe('句子清單匯出腳本', () => {
  it('node scripts/export-speech-lines.mjs 輸出 key → 文字 的 JSON，含題目、提示、固定台詞、數字', () => {
    const r = spawnSync(process.execPath, ['scripts/export-speech-lines.mjs'], { encoding: 'utf8', cwd: process.cwd() })
    expect(r.status, r.stderr).toBe(0)
    const lines = JSON.parse(r.stdout) as Record<string, string>
    expect(lines['q.number-1-01.prompt']).toBeTruthy()
    expect(lines['q.classify-2-01.hint']).toBeTruthy()
    expect(lines['praise.1']).toBe('答對了！')
    expect(lines['num.3']).toBe('三')
    expect(Object.keys(lines).length).toBeGreaterThan(1200)
    // 每個 key 都是穩定的：和 allLines 一致
    // v7.2：另外加上商店／工坊的回饋句（feedbackLines）
    expect(lines).toEqual({ ...allLines(QUESTIONS), ...feedbackLines() })
  }, 60_000) // 匯出腳本用 Vite 載入商品清單（feedbackLines），每次執行要幾秒，CI 上會超過預設 5 秒
})
