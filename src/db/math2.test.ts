import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { pmLockChapters, pmUnlockChapters } from './pm'
import { localDateStr } from '../domain/date'
import { getQuestion } from '../learning/bank'
import { HUAGUOSHAN, SHUILIANDONG } from '../learning/chapter'
import { buildReport } from '../learning/report'
import { makeRng } from '../learning/rng'
import { initialSkillState } from '../learning/skills'
import { dailyChapterId } from '../learning/subject'
import { MATH2_SKILLS, MATH_SKILLS, SKILLS, type SkillId } from '../learning/types'

const T0 = new Date(2026, 5, 10, 9, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000
let n = 0
let repo: Repo

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`math2-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

/** 把花果山 5 站直接標成通關（不用真的玩） */
async function clearFirstChapter(chestClaimed = false) {
  await repo.db.progress.put({
    chapterId: 'huaguoshan',
    run: 1,
    stations: Array.from({ length: 5 }, () => ({ done: true, independent: 5, total: 5, completedAt: T0 })),
    chestClaimed,
    completedRuns: chestClaimed ? 1 : 0,
    updatedAt: T0,
  })
}

async function playStation(chapterId: string, station: number, sessionId: string, now = T0, ok = true) {
  const plan = await repo.planStation(station - 1, now, makeRng(station * 17 + 3), chapterId)
  for (const [i, p] of plan.entries()) {
    const r = await repo.recordAttempt(
      { sessionId, questionId: p.question.id, firstTryCorrect: ok, hintsUsed: ok ? 0 : 1, durationMs: 1500, review: p.review, followUp: p.followUp, interaction: p.question.interaction },
      now + i,
    )
    expect(r.ok).toBe(true)
  }
  return plan
}

describe('章節解鎖：水簾洞要先通關花果山（唯一的鎖）', () => {
  it('一開始只有花果山開放；通關花果山（5 站都過）之後水簾洞解鎖', async () => {
    const u0 = await repo.getChapterUnlocks()
    expect(u0).toMatchObject({ huaguoshan: true, shuiliandong: false, 'english-island': true })
    await repo.db.progress.put({
      chapterId: 'huaguoshan',
      run: 1,
      stations: Array.from({ length: 5 }, (_, i) => ({ done: i < 4, independent: 5, total: 5 })),
      chestClaimed: false,
      completedRuns: 0,
      updatedAt: T0,
    })
    expect((await repo.getChapterUnlocks()).shuiliandong).toBe(false) // 還差一站
    await clearFirstChapter()
    expect((await repo.getChapterUnlocks()).shuiliandong).toBe(true)
  })
  it('再玩一輪花果山（關卡重置）之後，水簾洞仍然開著', async () => {
    await clearFirstChapter(true)
    await repo.startNextRun('huaguoshan')
    expect((await repo.getProgress('huaguoshan')).stations.every((s) => !s.done)).toBe(true)
    expect((await repo.getChapterUnlocks()).shuiliandong).toBe(true)
  })
  it('PM 預覽可以直接解鎖，也可以鎖回去；不影響花果山的進度', async () => {
    expect(await pmUnlockChapters(repo.db)).toBe(1)
    expect((await repo.getChapterUnlocks()).shuiliandong).toBe(true)
    expect(await pmUnlockChapters(repo.db)).toBe(0) // 已經解鎖，不重複
    expect((await repo.getSettings())?.unlockedChapters).toEqual(['shuiliandong'])
    await pmLockChapters(repo.db)
    expect((await repo.getChapterUnlocks()).shuiliandong).toBe(false)
    expect((await repo.getProgress('huaguoshan')).stations.some((s) => s.done)).toBe(false)
  })
  it('還沒解鎖就不能領第 2 章的獎勵（資料層也擋，不只是畫面）', async () => {
    const plan = await playStation('shuiliandong', 1, 'locked-1')
    expect(plan).toHaveLength(5)
    const r = await repo.completeStation({ chapterId: 'shuiliandong', station: 1, sessionId: 'locked-1' }, T0)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('還沒開放')
    expect(await repo.db.materialLedger.count()).toBe(0)
  })
})

describe('第 2 章：玩一站、進度、寶箱', () => {
  beforeEach(async () => {
    await clearFirstChapter()
  })
  it('規劃一站：4 題新技能（三種都有）+ 最後 1 題第 1 章的技能；站型的互動位置有套用', async () => {
    for (let s = 1; s <= 5; s++) {
      const plan = await repo.planStation(s - 1, T0, makeRng(s), 'shuiliandong')
      const skills = plan.map((p) => p.question.skill)
      expect(new Set(skills.slice(0, 4))).toEqual(new Set(MATH2_SKILLS))
      expect(MATH_SKILLS).toContain(skills[4])
      expect(new Set(plan.map((p) => p.question.id)).size).toBe(5)
    }
  })
  it('過一站：進度寫在第 2 章（不動花果山）、材料依站別、依序才能玩、記下互動方式', async () => {
    await playStation('shuiliandong', 1, 'w1')
    const r = await repo.completeStation({ chapterId: 'shuiliandong', station: 1, sessionId: 'w1' }, T0)
    expect(r).toMatchObject({ ok: true, material: SHUILIANDONG.stations[0].material, chapterDone: false })
    const prog = await repo.getProgress('shuiliandong')
    expect(prog.stations[0].done).toBe(true)
    expect(prog.stations).toHaveLength(5)
    expect(await repo.materialBalance()).toMatchObject({ [SHUILIANDONG.stations[0].material]: expect.any(Number) })
    // 第 3 站不能跳著過
    await playStation('shuiliandong', 3, 'w3')
    expect((await repo.completeStation({ chapterId: 'shuiliandong', station: 3, sessionId: 'w3' }, T0)).ok).toBe(false)
    // 作答紀錄帶互動方式
    const kinds = new Set((await repo.db.attempts.toArray()).map((a) => a.interaction))
    expect([...kinds].every((k) => k === 'pick' || k === 'dragOrder' || k === 'place' || k === 'flip')).toBe(true)
  })
  it('5 站通關 → 水簾洞寶箱（材料依章節設定）→ 再玩一輪', async () => {
    for (let s = 1; s <= 5; s++) {
      await playStation('shuiliandong', s, `ch2-${s}`, T0 + s * 1000)
      const r = await repo.completeStation({ chapterId: 'shuiliandong', station: s, sessionId: `ch2-${s}` }, T0 + s * 1000)
      expect(r.ok && r.chapterDone).toBe(s === 5)
    }
    const before = await repo.materialBalance()
    const c = await repo.claimChest('shuiliandong')
    expect(c.ok).toBe(true)
    const after = await repo.materialBalance()
    expect(after.wood - before.wood).toBe(SHUILIANDONG.chest.wood)
    expect(after.stone - before.stone).toBe(SHUILIANDONG.chest.stone)
    expect(after.flower - before.flower).toBe(SHUILIANDONG.chest.flower)
    expect(SHUILIANDONG.chest.wood).toBeGreaterThan(HUAGUOSHAN.chest.wood - 1)
    expect((await repo.startNextRun('shuiliandong')).ok).toBe(true)
    expect((await repo.getProgress('shuiliandong')).run).toBe(2)
  })
  it('中途離開再回來：接著玩同一份題目（stageDraft 記著章節與站）', async () => {
    const a = await repo.openStation('shuiliandong', 2, T0, makeRng(5))
    expect(a.resumed).toBe(false)
    await repo.recordAttempt({ sessionId: a.sessionId, questionId: a.plan[0].question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    const b = await repo.openStation('shuiliandong', 2, T0 + 1000, makeRng(9))
    expect(b.sessionId).toBe(a.sessionId)
    expect(b.plan.map((p) => p.question.id)).toEqual(a.plan.map((p) => p.question.id))
    expect(b.idx).toBe(1)
    expect(b.resumed).toBe(true)
  })
})

describe('新技能的難度、報告與新招', () => {
  it('新技能的起始難度跟年齡走（6–7 歲從難度 2），升級規則和舊技能一樣', async () => {
    expect((await repo.getSkillStates()).measure.difficulty).toBe(1)
    await repo.setAgeBand('6-7')
    const st = await repo.getSkillStates()
    for (const s of MATH2_SKILLS) expect(st[s].difficulty).toBe(2)
    // 5 題無提示答對 → 升級（用 measure 的難度 2 題）
    const ids = (await import('../learning/bank')).QUESTIONS.filter((q) => q.skill === 'measure' && q.difficulty === 2 && !q.gentle).slice(0, 5).map((q) => q.id)
    for (const [i, id] of ids.entries()) await repo.recordAttempt({ sessionId: 's', questionId: id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
    expect((await repo.getSkillStates()).measure.difficulty).toBe(3)
  })
  it('家長報告：作答過的新技能出現在報告裡（題數、無提示答對率、白話描述）', async () => {
    const qs = (await import('../learning/bank')).QUESTIONS
    const pick = (skill: SkillId) => qs.filter((q) => q.skill === skill && q.difficulty === 1 && !q.gentle).slice(0, 4)
    let i = 0
    for (const skill of MATH2_SKILLS)
      for (const q of pick(skill)) await repo.recordAttempt({ sessionId: `r-${skill}`, questionId: q.id, firstTryCorrect: i % 4 !== 0, hintsUsed: i++ % 4 !== 0 ? 0 : 1, durationMs: 1, interaction: q.interaction }, T0 + i)
    const report = buildReport(await repo.db.attempts.toArray(), await repo.getSkillStates(), T0 + 1000)
    for (const skill of MATH2_SKILLS) {
      const row = report.skills.find((s) => s.skill === skill)!
      expect(row.total, skill).toBe(4)
      expect(row.independent, skill).toBe(3)
      expect(row.levelLabel.length, skill).toBeGreaterThan(4)
    }
    expect(report.sessions).toBe(3)
  })
  it('三個新技能各自升級就學會新招：量身高、捉迷藏、記憶魔術（只讀技能狀態，不動學習邏輯）', async () => {
    await repo.db.skillState.bulkPut(SKILLS.map((k) => initialSkillState(k, T0)))
    expect(await repo.syncTricks()).toEqual([])
    await repo.db.skillState.put({ ...initialSkillState('measure', T0), difficulty: 2 })
    expect(await repo.syncTricks()).toEqual(['height'])
    await repo.db.skillState.put({ ...initialSkillState('space', T0), difficulty: 2 })
    await repo.db.skillState.put({ ...initialSkillState('observe', T0), difficulty: 3 })
    expect((await repo.syncTricks()).sort()).toEqual(['hide', 'memory'])
    expect((await repo.db.pets.get('pet'))?.tricks).toEqual(['height', 'hide', 'memory'])
    expect((await repo.getSettings())?.pendingTricks).toEqual(['height', 'hide', 'memory'])
  })
})

describe('每日冒險納入新技能', () => {
  it('數學的每日冒險：連續幾天六個技能都會出現（每天缺一個、每天不同）；英文不受影響', async () => {
    const seen = new Set<SkillId>()
    const perDay: string[] = []
    for (let d = 0; d < 6; d++) {
      const now = T0 + d * DAY
      const r = await repo.openDaily('math', now, makeRng(d + 1))
      const skills = r.plan.map((p) => p.question.skill)
      expect(skills).toHaveLength(5)
      expect(new Set(skills).size).toBe(5) // 六個技能輪流缺一個
      for (const s of skills) seen.add(s)
      perDay.push([...new Set(skills)].sort().join())
      // 玩完：清掉草稿，隔天才是新的一天
      for (const p of r.plan) await repo.recordAttempt({ sessionId: r.sessionId, questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1, review: p.review, interaction: p.question.interaction }, now)
      const done = await repo.completeDaily({ chapterId: dailyChapterId('math'), sessionId: r.sessionId }, now)
      expect(done.ok).toBe(true)
      expect(localDateStr(now)).toBeTruthy()
    }
    expect(seen).toEqual(new Set([...MATH_SKILLS, ...MATH2_SKILLS]))
    expect(seen.has('english')).toBe(false)
    expect(new Set(perDay).size).toBeGreaterThan(1)
    const en = await repo.openDaily('english', T0 + 8 * DAY, makeRng(1))
    expect(en.plan.every((p) => p.question.skill === 'english')).toBe(true)
  })
  it('每日冒險的新技能題都排得出來（難度 1–4、幼幼模式都不會「題庫不足」）', async () => {
    for (const age of ['3', '4-5', '6-7'] as const) {
      await repo.setAgeBand(age)
      for (let d = 0; d < 6; d++) {
        const r = await repo.openDaily('math', T0 + (d + 20) * DAY, makeRng(d + 5))
        expect(r.plan).toHaveLength(5)
        for (const p of r.plan) expect(getQuestion(p.question.id)).toBeDefined()
      }
    }
  })
})
