// v7.4 線 H：重玩已通關的站（openReplay / completeReplay）、6–7 歲首站與挑戰站、每日禮物與掉落食物固定輪替
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { localDateStr } from '../domain/date'
import { dropFoods } from '../domain/gifts'
import { makeRng } from '../learning/rng'
import { replayChapterId } from '../learning/subject'

const T0 = new Date(2026, 5, 10, 9, 0, 0).getTime()
let n = 0
let repo: Repo
const makeRepo = () => new Repo(new GuaibaoDB(`h74-${n++}`), () => T0, makeRng(1))
beforeEach(async () => {
  repo = makeRepo()
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

/** 玩完並通關一站（correct = 全部獨立答對） */
async function clearStation(station: number, sessionId: string, correct = true) {
  const plan = await repo.planStation(station - 1, T0, makeRng(station * 31 + sessionId.length))
  for (const [i, p] of plan.entries()) await repo.recordAttempt({ sessionId, questionId: p.question.id, firstTryCorrect: correct, hintsUsed: correct ? 0 : 1, durationMs: 1000, review: p.review, followUp: p.followUp }, T0 + station * 100 + i)
  const r = await repo.completeStation({ chapterId: 'huaguoshan', station, sessionId }, T0)
  expect(r.ok).toBe(true)
  return plan
}
const answerAll = async (sessionId: string, plan: { question: { id: string } }[], at = T0 + 5000) => {
  for (const [i, p] of plan.entries()) await repo.recordAttempt({ sessionId, questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1000 }, at + i)
}

describe('H1 重玩已通關的站', () => {
  it('還沒通關的站不能重玩', async () => {
    await expect(repo.openReplay('huaguoshan', 1, T0)).rejects.toThrow('還沒通關')
    await expect(repo.openStation(replayChapterId('huaguoshan'), 2, T0)).rejects.toThrow('還沒通關')
    await expect(repo.openReplay('nope', 1, T0)).rejects.toThrow('找不到')
  })
  it('通關後可以重玩：重新抽 5 題，盡量避開最近答過的，存成 replay 草稿', async () => {
    const first = await clearStation(1, 's1')
    const open = await repo.openStation(replayChapterId('huaguoshan'), 1, T0 + 9000, makeRng(7))
    expect(open.plan).toHaveLength(5)
    expect(open.idx).toBe(0)
    expect(open.resumed).toBe(false)
    const firstIds = new Set(first.map((p) => p.question.id))
    expect(open.plan.filter((p) => firstIds.has(p.question.id))).toHaveLength(0)
    const draft = (await repo.getSettings())?.stageDraft
    expect(draft).toMatchObject({ chapterId: 'replay:huaguoshan', station: 1, sessionId: open.sessionId })
  })
  it('中途離開再回來接著玩同一份（題目、session 都一樣）', async () => {
    await clearStation(1, 's1')
    const open = await repo.openReplay('huaguoshan', 1, T0 + 9000, makeRng(7))
    await repo.recordAttempt({ sessionId: open.sessionId, questionId: open.plan[0].question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + 9100)
    const again = await repo.openReplay('huaguoshan', 1, T0 + 9200, makeRng(99))
    expect(again.sessionId).toBe(open.sessionId)
    expect(again.plan.map((p) => p.question.id)).toEqual(open.plan.map((p) => p.question.id))
    expect(again.idx).toBe(1)
    expect(again.resumed).toBe(true)
  })
  it('完成重玩：固定 1 份食物（不看答對幾題）、不給材料、不改章節進度；同一次不能重複領', async () => {
    await clearStation(1, 's1')
    const matBefore = await repo.materialBalance()
    const foodsBefore = (await repo.db.inventory.toArray()).reduce((s, i) => s + i.qty, 0)
    const progBefore = await repo.getProgress('huaguoshan')
    const open = await repo.openReplay('huaguoshan', 1, T0 + 9000, makeRng(7))
    await answerAll(open.sessionId, open.plan)
    const r = await repo.completeReplay({ chapterId: 'huaguoshan', station: 1, sessionId: open.sessionId }, T0 + 9999)
    expect(r).toMatchObject({ ok: true, replay: true, qty: 0, independent: 5, total: 5 })
    expect(r.ok && r.foods).toHaveLength(1)
    expect(await repo.materialBalance()).toEqual(matBefore)
    expect((await repo.db.inventory.toArray()).reduce((s, i) => s + i.qty, 0)).toBe(foodsBefore + 1)
    expect((await repo.getProgress('huaguoshan')).stations).toEqual(progBefore.stations)
    expect((await repo.getSettings())?.stageDraft).toBeUndefined()
    const again = await repo.completeReplay({ chapterId: 'huaguoshan', station: 1, sessionId: open.sessionId }, T0 + 9999)
    expect(again.ok).toBe(false)
  })
  it('答錯很多也一樣給 1 份食物（不懲罰）；食物是今天固定輪替的下一個', async () => {
    await clearStation(1, 's1', false) // 第一次通關：全部沒有獨立答對 → 1 份食物（序號 0）
    const date = localDateStr(T0)
    expect((await repo.getSettings())?.foodDrop).toEqual({ date, n: 1 })
    const open = await repo.openReplay('huaguoshan', 1, T0 + 9000, makeRng(3))
    for (const [i, p] of open.plan.entries()) await repo.recordAttempt({ sessionId: open.sessionId, questionId: p.question.id, firstTryCorrect: false, hintsUsed: 1, durationMs: 1000 }, T0 + 9100 + i)
    const r = await repo.completeReplay({ chapterId: 'huaguoshan', station: 1, sessionId: open.sessionId }, T0 + 9999)
    expect(r.ok && r.foods).toEqual(dropFoods(date, 1, 1))
  })
  it('題目沒答完不能領；還沒通關的站不能領', async () => {
    await clearStation(1, 's1')
    const open = await repo.openReplay('huaguoshan', 1, T0 + 9000, makeRng(7))
    expect((await repo.completeReplay({ chapterId: 'huaguoshan', station: 1, sessionId: open.sessionId }, T0 + 9500)).ok).toBe(false)
    await answerAll('x', open.plan)
    expect((await repo.completeReplay({ chapterId: 'huaguoshan', station: 2, sessionId: 'x' }, T0 + 9500)).ok).toBe(false)
  })
  it('重玩會更新技能紀錄（作答照常記錄），重玩的題不重複題面', async () => {
    await clearStation(1, 's1')
    const before = (await repo.db.attempts.toArray()).length
    const open = await repo.openReplay('huaguoshan', 1, T0 + 9000, makeRng(7))
    await answerAll(open.sessionId, open.plan)
    expect((await repo.db.attempts.toArray()).length).toBe(before + 5)
    expect(new Set(open.plan.map((p) => p.question.id)).size).toBe(5)
  })
  it('重玩的站中調整：題目不變（開始前就排好）', async () => {
    await clearStation(1, 's1')
    const open = await repo.openReplay('huaguoshan', 1, T0 + 9000, makeRng(7))
    const next = await repo.adaptStation({ chapterId: replayChapterId('huaguoshan'), station: 1, sessionId: open.sessionId, plan: open.plan, from: 1 })
    expect(next).toBe(open.plan)
  })
})

describe('H3 6–7 歲首站與挑戰站', () => {
  it('6–7 歲數學第 1 站不出 kind（請你指出水果）', async () => {
    await repo.setAgeBand('6-7')
    expect((await repo.getSkillStates()).classify.difficulty).toBe(2)
    for (let seed = 1; seed <= 40; seed++) {
      const plan = await repo.planStation(0, T0, makeRng(seed), 'huaguoshan')
      expect(plan.filter((p) => p.question.type === 'kind'), `seed ${seed}`).toHaveLength(0)
    }
  })
  it('其他站、其他年齡不受影響（4–5 歲第 1 站出得到 kind）', async () => {
    let kinds = 0
    for (let seed = 1; seed <= 60; seed++) kinds += (await repo.planStation(0, T0, makeRng(seed), 'huaguoshan')).filter((p) => p.question.type === 'kind').length
    expect(kinds).toBeGreaterThan(0)
  })
  it('6–7 歲挑戰站所有題目難度 >= 3；4–5 歲維持比目前高 1 級', async () => {
    await repo.setAgeBand('6-7')
    const c = await repo.openChallenge('huaguoshan', T0, makeRng(5))
    expect(c.plan).toHaveLength(8)
    for (const p of c.plan) expect(p.question.difficulty, p.question.id).toBeGreaterThanOrEqual(3)
    await repo.clearStageDraft()
    await repo.setAgeBand('4-5')
    await repo.db.skillState.clear()
    const c2 = await repo.openChallenge('huaguoshan', T0, makeRng(5))
    expect(Math.max(...c2.plan.map((p) => p.question.difficulty))).toBe(2)
  })
})
