import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from '../db/db'
import { Repo } from '../db/repo'
import { bestCombo, bumpStates, earnsBadge, placementLevel, placementQuestions, scaledIndependent } from '../db/quest7'
import { QUESTIONS, getQuestion } from './bank'
import { challengeVisible, CHAPTERS, ENGLISH_ISLAND, getChapter, HUAGUOSHAN, NATURE_FOREST, nodeWindow, SHUILIANDONG, chapterUnlocked } from './chapter'
import { allLines, isKidVariant, kidText, questionKey } from './lines'
import { makeRng } from './rng'
import { stationFoodQty } from './scoring'
import { answerKeyOf, ANSWER_WINDOW, displayQuestion, flipCellsOf, MAX_FLIP_PER_STATION, MAX_SAME_TYPE, planStation, recentAnswerKeys, type PlannedQuestion } from './select'
import { applyAttempt, initialSkillState, WRONG_RUN_DEMOTE } from './skills'
import { challengeChapterId, challengeSlots, parseChallengeId, resolveStage, skillsOfChapter } from './subject'
import { CHALLENGE_SIZE, SKILLS, type Attempt, type SkillId, type SkillState } from './types'

const states = (): Record<SkillId, SkillState> => Object.fromEntries(SKILLS.map((k) => [k, initialSkillState(k)])) as Record<SkillId, SkillState>

/** 連續玩 n 站（每題都記成作答），回傳每站的題目 */
function simulate(chapterId: string, n: number, seed = 1) {
  const ch = getChapter(chapterId)!
  const mix = skillsOfChapter(chapterId)!
  const rng = makeRng(seed)
  const attempts: Attempt[] = []
  const stations: PlannedQuestion[][] = []
  let at = 1
  for (let s = 0; s < n; s++) {
    const idx = s % ch.stations.length
    const plan = planStation({ stationIndex: idx, states: states(), attempts, now: 0, rng, slots: ch.stations[idx].slots, skills: mix.skills, tail: mix.tail, flipCells: [4, 4, 4, 6, 8][Math.min(idx, 4)] })
    stations.push(plan)
    for (const p of plan) attempts.push({ id: `a${at}`, at: at++, questionId: p.question.id, skill: p.question.skill, difficulty: p.question.difficulty, firstTryCorrect: true, hintsUsed: 0, durationMs: 1, sessionId: `s${s}` })
  }
  return { stations, attempts }
}

describe('B2 選題多樣性：模擬 20 站', () => {
  const COVER = [HUAGUOSHAN, SHUILIANDONG, ENGLISH_ISLAND, NATURE_FOREST]
  for (const ch of COVER) {
    it(`${ch.name}：每站同一題型 <= ${MAX_SAME_TYPE} 題（幾乎每站都守住）`, () => {
      const { stations } = simulate(ch.id, 20)
      let ok = 0
      for (const st of stations) {
        const c = new Map<string, number>()
        for (const p of st) c.set(p.question.type, (c.get(p.question.type) ?? 0) + 1)
        if ([...c.values()].every((v) => v <= MAX_SAME_TYPE)) ok++
      }
      expect(ok / stations.length).toBeGreaterThanOrEqual(0.9)
    })
    it(`${ch.name}：答案物件在最近 ${ANSWER_WINDOW} 題內不重複（絕大多數題都守住）`, () => {
      const { stations } = simulate(ch.id, 20)
      const keys = stations.flat().map((p) => answerKeyOf(p.question))
      let checked = 0
      let dup = 0
      keys.forEach((k, i) => {
        if (!k) return
        checked++
        if (keys.slice(Math.max(0, i - ANSWER_WINDOW), i).includes(k)) dup++
      })
      expect(checked).toBeGreaterThan(20)
      expect(1 - dup / checked).toBeGreaterThanOrEqual(0.9)
    })
  }
  it('翻牌每站最多 1 次；格數隨站數遞增（2×2 → 2×3 → 更大）', () => {
    const { stations } = simulate(SHUILIANDONG.id, 25)
    for (const st of stations) expect(st.filter((p) => p.question.type === 'flip').length).toBeLessThanOrEqual(MAX_FLIP_PER_STATION)
    const byStation = [0, 1, 2, 3, 4].map((k) => stations.filter((_, i) => i % 5 === k).flatMap((st) => st.filter((p) => p.question.type === 'flip').map((p) => flipCellsOf(p.question))))
    // 第 3 站有 4 格的牌、第 5 站的牌比第 3 站大
    expect(Math.max(...byStation[2])).toBeLessThanOrEqual(4)
    expect(Math.min(...byStation[4])).toBeGreaterThan(Math.max(...byStation[2]))
  })
  it('英文難度 1：看圖選字、中翻英都會出現，一站不再是 5 題聽英文', () => {
    const { stations } = simulate(ENGLISH_ISLAND.id, 10)
    let mixed = 0
    for (const st of stations) if (new Set(st.map((p) => p.question.type)).size >= 3) mixed++
    expect(mixed).toBe(stations.length)
    const types = new Set(stations.flat().map((p) => p.question.type))
    expect(types.has('pic2en') && types.has('zh2en') && types.has('hear')).toBe(true)
  })
  it('自然第 1 章：排進季節、動物的家、植物生長，不只有找動物', () => {
    const { stations } = simulate(NATURE_FOREST.id, 12)
    const types = new Set(stations.flat().map((p) => p.question.type))
    for (const t of ['natSeason', 'natHome', 'natPlant', 'natAnimal', 'natWeather']) expect(types.has(t as never), t).toBe(true)
  })
  it('題庫不夠時放寬規則而不是丟錯（只有 1 種題型的小題庫）', () => {
    const bank = QUESTIONS.filter((q) => q.skill === 'number' && q.difficulty === 1 && q.type === 'count' && !q.gentle).slice(0, 12)
    const plan = planStation({ stationIndex: 0, states: states(), attempts: [], now: 0, rng: makeRng(3), bank, skills: ['number'] })
    expect(plan).toHaveLength(5)
    expect(new Set(plan.map((p) => p.question.id)).size).toBe(5)
  })
  it('recentAnswerKeys 取最近 8 題、舊到新；找不到的題略過', () => {
    const q = QUESTIONS.find((x) => answerKeyOf(x))!
    const att = Array.from({ length: 12 }, (_, i) => ({ questionId: i === 3 ? 'gone' : q.id, at: i }))
    expect(recentAnswerKeys(att, getQuestion)).toHaveLength(ANSWER_WINDOW)
  })
})

describe('B3 降級保護與快速分級', () => {
  const at = (ok: boolean, difficulty: 1 | 2 | 3 | 4 = 3): Attempt => ({ id: 'x', at: 1, questionId: 'q', skill: 'number', difficulty, firstTryCorrect: ok, hintsUsed: ok ? 0 : 1, durationMs: 1, sessionId: 's' })
  it(`連錯 ${WRONG_RUN_DEMOTE} 題自動降一級；中間答對一題就重算；已經是 1 級不再降`, () => {
    let s: SkillState = { ...initialSkillState('number', 0, 3), total: 20 }
    s = applyAttempt(s, at(false))
    s = applyAttempt(s, at(false))
    expect(s.difficulty).toBe(3)
    s = applyAttempt(s, at(false))
    expect(s.difficulty).toBe(2)
    expect(s.wrongRun).toBe(0)
    let t: SkillState = { ...initialSkillState('number', 0, 3), total: 20 }
    for (const ok of [false, false, true, true, true, false, false]) t = applyAttempt(t, at(ok))
    expect(t.difficulty).toBe(3)
    let u: SkillState = { ...initialSkillState('number', 0, 1), total: 20 }
    for (let i = 0; i < 4; i++) u = applyAttempt(u, at(false, 1))
    expect(u.difficulty).toBe(1)
  })
  it('幼幼模式不套用連錯降級', () => {
    let s: SkillState = { ...initialSkillState('number', 0, 3), total: 20 }
    for (let i = 0; i < 3; i++) s = applyAttempt(s, at(false), { gentle: true })
    expect(s.difficulty).toBe(3)
  })
  it('分級結果：全對 3；錯 1 題 2；錯 2 題以上 1', () => {
    expect([3, 2, 1, 0].map((c) => placementLevel(c))).toEqual([3, 2, 1, 1])
  })
  it('快速分級 3 題：數感、分類、規律各一題難度 3 的點選題', () => {
    const qs = placementQuestions()
    expect(qs.map((q) => q.skill)).toEqual(['number', 'classify', 'pattern'])
    for (const q of qs) {
      expect(q.difficulty).toBe(3)
      expect(q.interaction ?? 'pick').toBe('pick')
    }
  })
  it('6–7 歲可以直接選水簾洞；其他年齡要先通關花果山', () => {
    expect(chapterUnlocked(SHUILIANDONG, {}, [], '6-7')).toBe(true)
    expect(chapterUnlocked(SHUILIANDONG, {}, [], '4-5')).toBe(false)
    expect(chapterUnlocked(SHUILIANDONG, {}, [], '3')).toBe(false)
    expect(chapterUnlocked(SHUILIANDONG, {})).toBe(false)
  })
})

describe('B3 挑戰站', () => {
  it('chapterId 往返；挑戰站有自己的站定義（8 個位置，章末站的材料）', () => {
    for (const ch of CHAPTERS) {
      expect(parseChallengeId(challengeChapterId(ch.id))?.id).toBe(ch.id)
      expect(challengeSlots(ch)).toHaveLength(CHALLENGE_SIZE)
      const info = resolveStage(challengeChapterId(ch.id), 1, '2026-10-28')
      expect(info?.challenge).toBe(true)
      expect(info?.def.material).toBe(ch.stations[ch.stations.length - 1].material)
    }
    expect(parseChallengeId('huaguoshan')).toBeNull()
    expect(resolveStage(challengeChapterId('huaguoshan'), 2, '2026-10-28')).toBeUndefined()
  })
  it('6–7 歲一開始就看得到；其他年齡要先通關這一章', () => {
    const fresh = { stations: [{ done: false, independent: 0, total: 0 }], completedRuns: 0 }
    expect(challengeVisible(fresh, '6-7')).toBe(true)
    expect(challengeVisible(fresh, '4-5')).toBe(false)
    expect(challengeVisible({ stations: [{ done: true, independent: 5, total: 5 }], completedRuns: 0 }, '3')).toBe(true)
    expect(challengeVisible({ ...fresh, completedRuns: 1 }, '4-5')).toBe(true)
    expect(challengeVisible(undefined, '4-5')).toBe(false)
  })
  it('combo：只算第一次就對且沒提示、答錯歸零；5 連對拿徽章', () => {
    const a = (ok: boolean, i: number) => ({ at: i, firstTryCorrect: ok, hintsUsed: ok ? 0 : 1 })
    expect(bestCombo([true, true, false, true, true, true, true, false].map((ok, i) => a(ok, i)))).toBe(4)
    expect(bestCombo([a(true, 2), a(true, 1), a(false, 3)])).toBe(2) // 依時間排序
    expect(earnsBadge(4)).toBe(false)
    expect(earnsBadge(5)).toBe(true)
    expect(scaledIndependent(8, 8)).toBe(5)
    expect(scaledIndependent(6, 8)).toBe(4)
    expect(stationFoodQty(scaledIndependent(5, 8))).toBe(1)
  })
  it('挑戰站的題目比目前難度高 1 級（最高 4）', () => {
    const s = states()
    s.number = { ...s.number, difficulty: 4 }
    s.classify = { ...s.classify, difficulty: 2 }
    const b = bumpStates(s)
    expect(b.number.difficulty).toBe(4)
    expect(b.classify.difficulty).toBe(3)
  })
})

describe('B4 / B5 地圖', () => {
  it('每章都有自己的地圖與 6 個點（5 站加寶箱），座標在圖內、彼此不重疊', () => {
    for (const id of ['english-island', 'life-town', 'nature-forest', 'shuiliandong']) {
      const ch = getChapter(id)!
      expect(ch.scene, id).toBeTruthy()
      expect(ch.points, id).toHaveLength(6)
      for (const [x, y] of ch.points!) {
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(100)
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(100)
      }
      // 場景 16:9：把 % 換成相對寬度的距離，節點直徑約 7.6% 寬
      const pts = ch.points!
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i][0] - pts[j][0], ((pts[i][1] - pts[j][1]) * 9) / 16)
          expect(d, `${id} ${i}-${j}`).toBeGreaterThan(9.5)
        }
    }
  })
  it('直向：顯示範圍涵蓋所有節點外框，不超出圖', () => {
    for (const ch of CHAPTERS) {
      const pts = ch.points ?? [[11, 84], [25, 78], [38, 62], [56, 46], [72, 33], [87, 11]]
      const { x0, x1 } = nodeWindow(pts as [number, number][])
      expect(x0).toBeGreaterThanOrEqual(0)
      expect(x1).toBeLessThanOrEqual(100)
      for (const [x] of pts) {
        expect(x).toBeGreaterThan(x0)
        expect(x).toBeLessThan(x1)
        // 節點換算到顯示範圍後，在 0–100% 內且離邊緣至少 5%
        const rel = ((x - x0) / (x1 - x0)) * 100
        expect(rel).toBeGreaterThan(5)
        expect(rel).toBeLessThan(95)
      }
    }
  })
})

describe('G8 蛋還沒孵化：生活題不說「阿悟」', () => {
  const life = QUESTIONS.filter((q) => q.skill === 'life' && (q.prompt.includes('阿悟') || q.hint.includes('阿悟')))
  it('生活題裡提到阿悟的題，蛋的時候顯示成「小朋友」；孵化後不變；其他科目不受影響', () => {
    expect(life.length).toBeGreaterThan(5)
    for (const q of life) {
      const egg = displayQuestion(q, 's', false, true)
      expect(egg.prompt.includes('阿悟'), q.id).toBe(false)
      expect(egg.hint.includes('阿悟'), q.id).toBe(false)
      expect(egg.kid).toBe(true)
      expect(displayQuestion(q, 's', false, false).prompt).toBe(q.prompt)
    }
    const math = QUESTIONS.find((q) => q.skill === 'number' && q.prompt.includes('阿悟'))
    if (math) expect(displayQuestion(math, 's', false, true).prompt).toBe(math.prompt)
    expect(kidText('阿悟在洗手')).toBe('小朋友在洗手')
  })
  it('小朋友版的語音句子都在句子清單裡（預錄語音才找得到）', () => {
    const lines = allLines(QUESTIONS)
    for (const q of life) {
      expect(isKidVariant(q)).toBe(true)
      expect(lines[questionKey(q.id, 'prompt', true)], q.id).toBe(kidText(q.prompt))
      expect(lines[questionKey(q.id, 'hint', true)], q.id).toBe(kidText(q.hint))
    }
  })
  it('新句子（挑戰站、快速分級、結算）都在句子清單裡', () => {
    const lines = allLines([])
    for (const k of ['challenge.open', 'challenge.done', 'challenge.badge', 'placement.ask', 'placement.done', 'result.food']) expect(lines[k], k).toBeTruthy()
  })
})

describe('E 空間題：上面／下面不用貼地的家具', () => {
  it('題目裡有「上面／下面」的場景，家具一律是懸空的桌子或箱子', () => {
    const SPACE = QUESTIONS.filter((q) => q.skill === 'space')
    let n = 0
    for (const q of SPACE) {
      const rels: string[] = [q.params?.rel as string, ...(q.params?.zones ?? []).map((z) => z.rel), ...q.choices.map((c) => c.scene?.rel as string), q.params?.scene?.rel as string]
      if (!rels.some((r) => r === 'above' || r === 'below')) continue
      const anchors = [...(q.params?.anchors ?? []), ...q.choices.map((c) => c.scene?.anchor as string), q.params?.scene?.anchor as string].filter(Boolean)
      for (const a of anchors) expect(['decor-table', 'decor-crate'], q.id).toContain(a)
      n++
    }
    expect(n).toBeGreaterThan(30)
  })
})

describe('repo：挑戰站與快速分級', () => {
  let repo: Repo
  let n = 0
  const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime()
  beforeEach(async () => {
    repo = new Repo(new GuaibaoDB(`quest7-${n++}`), () => T0, makeRng(7))
    await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
  })
  const answerAll = async (sid: string, plan: { question: { id: string } }[], okAt: (i: number) => boolean) => {
    for (const [i, p] of plan.entries()) await repo.recordAttempt({ sessionId: sid, questionId: p.question.id, firstTryCorrect: okAt(i), hintsUsed: okAt(i) ? 0 : 1, durationMs: 1 }, T0 + i)
  }
  it('挑戰站：8 題、不複習、比目前難度高 1 級；做完拿材料與食物、記錄最高連對；連對 5 題拿一次徽章', async () => {
    const o = await repo.openStation(challengeChapterId('huaguoshan'), 1, T0, makeRng(3))
    expect(o.plan).toHaveLength(CHALLENGE_SIZE)
    expect(o.plan.every((p) => !p.review)).toBe(true)
    expect(o.plan.every((p) => p.question.difficulty === 2)).toBe(true) // 4–5 歲起始難度 1 + 1
    // 中途離開再回來：接著玩同一份
    const again = await repo.openStation(challengeChapterId('huaguoshan'), 1, T0, makeRng(99))
    expect(again.sessionId).toBe(o.sessionId)
    expect(again.plan.map((p) => p.question.id)).toEqual(o.plan.map((p) => p.question.id))
    expect((await repo.completeChallenge({ chapterId: 'huaguoshan', sessionId: o.sessionId }, T0)).ok).toBe(false) // 還沒答完
    await answerAll(o.sessionId, o.plan, () => true)
    const before = (await repo.db.inventory.toArray()).reduce((a, b) => a + b.qty, 0)
    const r = await repo.completeChallenge({ chapterId: 'huaguoshan', sessionId: o.sessionId }, T0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.combo).toBe(8)
    expect(r.badge).toBe(true)
    expect(r.material).toBe('stone') // 花果山最後一站的材料
    expect(r.foods).toHaveLength(2)
    expect((await repo.db.inventory.toArray()).reduce((a, b) => a + b.qty, 0) - before).toBe(2)
    expect(await repo.getChallenge('huaguoshan')).toMatchObject({ plays: 1, best: 8 })
    expect((await repo.listChapterBadges()).map((b) => b.chapterId)).toEqual(['huaguoshan'])
    expect((await repo.completeChallenge({ chapterId: 'huaguoshan', sessionId: o.sessionId }, T0)).ok).toBe(false) // 不重複領
    // 再玩一次：連對不足，不再有徽章，最高連對保留
    const o2 = await repo.openStation(challengeChapterId('huaguoshan'), 1, T0 + 5000, makeRng(4))
    expect(o2.sessionId).not.toBe(o.sessionId)
    await answerAll(o2.sessionId, o2.plan, (i) => i % 2 === 0)
    const r2 = await repo.completeChallenge({ chapterId: 'huaguoshan', sessionId: o2.sessionId }, T0 + 6000)
    expect(r2.ok && r2.badge).toBe(false)
    expect(r2.ok && r2.combo).toBe(1)
    expect(await repo.getChallenge('huaguoshan')).toMatchObject({ plays: 2, best: 8 })
    expect((await repo.getProgress('huaguoshan')).stations.every((s) => !s.done)).toBe(true) // 不影響章節進度
  })
  it('挑戰站的作答不改技能難度；站中不調整題目', async () => {
    const o = await repo.openStation(challengeChapterId('huaguoshan'), 1, T0, makeRng(3))
    await answerAll(o.sessionId, o.plan, () => false)
    const st = await repo.getSkillStates()
    for (const k of ['number', 'classify', 'pattern'] as const) expect(st[k].difficulty).toBe(1)
    const plan = await repo.adaptStation({ chapterId: challengeChapterId('huaguoshan'), station: 1, sessionId: o.sessionId, plan: o.plan, from: 1 })
    expect(plan).toBe(o.plan)
  })
  it('快速分級：只有 6–7 歲、還沒做過、數學沒有作答紀錄才問；做完數學技能依結果起跳，只做一次', async () => {
    expect(await repo.placementDue()).toBe(false) // 年齡未設定
    await repo.setAgeBand('6-7')
    expect(await repo.placementDue()).toBe(true)
    expect(await repo.applyPlacement(3, T0)).toMatchObject({ ok: true, level: 3 })
    const st = await repo.getSkillStates()
    for (const k of ['number', 'classify', 'pattern', 'measure', 'space', 'observe'] as const) expect(st[k].difficulty).toBe(3)
    expect(st.english.difficulty).toBe(2) // 其他科目不受影響（6–7 歲預設 2）
    expect(await repo.placementDue()).toBe(false)
    expect(await repo.applyPlacement(0, T0)).toMatchObject({ ok: true, level: 3 }) // 已經做過，不改
  })
  it('快速分級：錯 1 題從難度 2 起跳、錯 2 題以上從 1 起跳；略過後不再問；已經玩過數學的不問', async () => {
    await repo.setAgeBand('6-7')
    expect(await repo.applyPlacement(2, T0)).toMatchObject({ level: 2 })
    expect((await repo.getSkillStates()).number.difficulty).toBe(2)
    const r2 = new Repo(new GuaibaoDB(`quest7-${n++}`), () => T0, makeRng(7))
    await r2.onboard({ pin: '1234', childName: 'b', petName: '' }, T0)
    await r2.setAgeBand('6-7')
    expect(await r2.applyPlacement(1, T0)).toMatchObject({ level: 1 })
    expect((await r2.getSkillStates()).pattern.difficulty).toBe(1)
    const r3 = new Repo(new GuaibaoDB(`quest7-${n++}`), () => T0, makeRng(7))
    await r3.onboard({ pin: '1234', childName: 'c', petName: '' }, T0)
    await r3.setAgeBand('6-7')
    await r3.skipPlacement(T0)
    expect(await r3.placementDue()).toBe(false)
    const r4 = new Repo(new GuaibaoDB(`quest7-${n++}`), () => T0, makeRng(7))
    await r4.onboard({ pin: '1234', childName: 'd', petName: '' }, T0)
    await r4.setAgeBand('6-7')
    await r4.recordAttempt({ sessionId: 's', questionId: 'number-2-01', firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    expect(await r4.placementDue()).toBe(false)
  })
  it('6–7 歲的水簾洞一開始就開放（repo 層）', async () => {
    expect((await repo.getChapterUnlocks()).shuiliandong).toBe(false)
    await repo.setAgeBand('6-7')
    expect((await repo.getChapterUnlocks()).shuiliandong).toBe(true)
  })
})
