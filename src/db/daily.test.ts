import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { localDateStr } from '../domain/date'
import { getQuestion } from '../learning/bank'
import { avoidIdsFor, dailyInfo, emptyDaily, finishPlay, planDaily, startPlay } from '../learning/daily'
import { initialSkillState } from '../learning/skills'
import { SUBJECTS, dailyChapterId, dailyMaterial, parseDailyId, resolveStage } from '../learning/subject'
import { ENGLISH_ISLAND, HUAGUOSHAN } from '../learning/chapter'
import { SKILLS, type SkillState } from '../learning/types'
import type { PlannedQuestion } from '../learning/select'

const T0 = new Date(2026, 9, 27, 9, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000
let n = 0
let repo: Repo

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`daily-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

/** 把一份 plan 全部答完（correct[i] = 第 i 題第一次就對） */
async function answerAll(sessionId: string, plan: PlannedQuestion[], now: number, correct = [true, true, true, true, true]) {
  for (const [i, p] of plan.entries()) {
    const r = await repo.recordAttempt(
      { sessionId, questionId: p.question.id, firstTryCorrect: correct[i], hintsUsed: correct[i] ? 0 : 1, durationMs: 1500, review: p.review, followUp: p.followUp },
      now + i,
    )
    expect(r.ok).toBe(true)
  }
}
const ids = (plan: PlannedQuestion[]) => plan.map((p) => p.question.id)

describe('科目與每日冒險的 id', () => {
  it('科目清單：數學（花果山，三個技能）與英文（英文小島，english 技能），可擴充', () => {
    expect(SUBJECTS.map((s) => [s.id, s.name, s.chapter.id])).toEqual([['math', '數學', 'huaguoshan'], ['english', '英文', 'english-island']])
    expect(SUBJECTS[0].skills).toEqual(['number', 'classify', 'pattern'])
    expect(SUBJECTS[1].skills).toEqual(['english'])
    for (const s of SUBJECTS) {
      expect(s.chapter.stations).toHaveLength(5)
      expect(s.chapter.stations[4].kind).toBe('boss')
      expect(s.dailySlots).toHaveLength(5)
    }
    expect(ENGLISH_ISLAND.stations.map((x) => x.name)).toHaveLength(5)
  })
  it('daily:<科目> 只認得存在的科目；每日冒險可以當成一站來解析', () => {
    expect(parseDailyId(dailyChapterId('english'))).toBe('english')
    expect(parseDailyId('daily:nope')).toBeNull()
    expect(parseDailyId('huaguoshan')).toBeNull()
    expect(resolveStage('daily:math', 1, '2026-10-27')).toMatchObject({ daily: true, subject: 'math', def: { name: '今日冒險', kind: 'normal' } })
    expect(resolveStage('daily:math', 2, '2026-10-27')).toBeUndefined()
    expect(resolveStage('english-island', 3, '2026-10-27')).toMatchObject({ daily: false, chapterName: '英文小島', def: { name: '珊瑚礁' } })
    expect(resolveStage('huaguoshan', 9, '2026-10-27')).toBeUndefined()
  })
  it('每日材料一天一種輪流（連續三天三種都有）', () => {
    const mats = [0, 1, 2].map((d) => dailyMaterial(localDateStr(T0 + d * DAY)))
    expect(new Set(mats).size).toBe(3)
    expect(dailyMaterial('2026-10-27')).toBe(dailyMaterial('2026-10-27'))
  })
})

describe('每日冒險抽題（純函式）', () => {
  const states = () => Object.fromEntries(SKILLS.map((k) => [k, { ...initialSkillState(k), total: 50 }])) as Record<(typeof SKILLS)[number], SkillState>
  const plan = (o: Partial<Parameters<typeof planDaily>[0]> = {}) =>
    planDaily({ subject: 'math', date: '2026-10-27', play: 1, states: states(), attempts: [], now: T0, ...o })

  it('同一天同一次永遠抽到一樣的題；5 題不重複', () => {
    const a = plan()
    expect(ids(a)).toEqual(ids(plan()))
    expect(a).toHaveLength(5)
    expect(new Set(ids(a)).size).toBe(5)
  })
  it('跨日不同：隔天、後天的題都不一樣；今天再玩一次也換新題', () => {
    const d1 = ids(plan())
    const d2 = ids(plan({ date: '2026-10-28' }))
    const d3 = ids(plan({ date: '2026-10-29' }))
    expect(d2).not.toEqual(d1)
    expect(d3).not.toEqual(d2)
    expect(ids(plan({ play: 2 }))).not.toEqual(d1)
  })
  it('避開昨天的題面：avoid 裡的題一題都不會出現（題庫夠換時）', () => {
    const d1 = plan()
    const avoid = new Set(ids(d1))
    const d2 = plan({ date: '2026-10-28', avoid })
    expect(ids(d2).filter((id) => avoid.has(id))).toEqual([])
    // 英文科目一樣
    const e1 = planDaily({ subject: 'english', date: '2026-10-27', play: 1, states: states(), attempts: [], now: T0 })
    const e2 = planDaily({ subject: 'english', date: '2026-10-28', play: 1, states: states(), attempts: [], now: T0, avoid: new Set(ids(e1)) })
    expect(ids(e2).filter((id) => ids(e1).includes(id))).toEqual([])
    expect(e1.every((p) => p.question.skill === 'english')).toBe(true)
  })
  it('科目隔離：數學只出數學技能、英文只出英文；複習也不會跨科目', () => {
    // 數學和英文都有到期的複習
    const st = states()
    st.english = { ...st.english, difficulty: 2, mastered: { 1: { masteredAt: T0 - 3 * DAY, reviews: 0 } } }
    st.number = { ...st.number, difficulty: 2, mastered: { 1: { masteredAt: T0 - 3 * DAY, reviews: 0 } } }
    const m = plan({ states: st })
    const e = planDaily({ subject: 'english', date: '2026-10-27', play: 1, states: st, attempts: [], now: T0 })
    expect(m.every((p) => p.question.skill !== 'english')).toBe(true)
    expect(e.every((p) => p.question.skill === 'english')).toBe(true)
    expect(m.filter((p) => p.review)).toHaveLength(1)
    expect(m.find((p) => p.review)!.question).toMatchObject({ skill: 'number', difficulty: 1 })
    expect(e.find((p) => p.review)!.question).toMatchObject({ skill: 'english', difficulty: 1 })
  })
  it('優先複習：到期的複習最多放 2 題（一般的站只有 1 題）；依自適應難度抽題', () => {
    const st = states()
    st.number = { ...st.number, difficulty: 2, mastered: { 1: { masteredAt: T0 - 3 * DAY, reviews: 0 } } }
    st.classify = { ...st.classify, difficulty: 3, mastered: { 2: { masteredAt: T0 - 8 * DAY, reviews: 1 } } }
    st.pattern = { ...st.pattern, difficulty: 3, mastered: { 1: { masteredAt: T0 - 20 * DAY, reviews: 0 } } }
    const p = plan({ states: st })
    const reviews = p.filter((x) => x.review)
    expect(reviews).toHaveLength(2)
    expect(reviews.map((r) => r.question.skill).sort()).toEqual(['classify', 'number'])
    // 其餘題目用目前難度
    for (const x of p.filter((y) => !y.review)) expect(x.question.difficulty).toBe(st[x.question.skill].difficulty)
  })
  it('幼幼模式：只抽幼幼能做的題', () => {
    const p = planDaily({ subject: 'english', date: '2026-10-27', play: 1, states: states(), attempts: [], now: T0, gentle: true })
    expect(p.every((x) => x.question.gentle)).toBe(true)
  })
  it('DailyState 純函式：開始、完成、徽章只在每天第一次、保留最近 14 天', () => {
    let st = emptyDaily()
    const s1 = startPlay(st, '2026-10-27', ['a', 'b'])
    expect(s1.play).toBe(1)
    const f1 = finishPlay(s1.state, '2026-10-27', 'math', ['a', 'b'], T0)
    expect(f1.badge).toMatchObject({ date: '2026-10-27', subject: 'math' })
    const s2 = startPlay(f1.state, '2026-10-27', ['c'])
    expect(s2.play).toBe(2)
    const f2 = finishPlay(s2.state, '2026-10-27', 'math', ['c'], T0 + 1000)
    expect(f2.badge).toBeNull()
    expect(f2.state.badges).toHaveLength(1)
    expect(dailyInfo(f2.state, '2026-10-27')).toMatchObject({ plays: 2, done: 2, badgeToday: true, badgeTotal: 1 })
    expect(dailyInfo(f2.state, '2026-10-28')).toMatchObject({ plays: 0, done: 0, badgeToday: false })
    // 避開：隔天看昨天 + （同一天）先前幾次
    expect([...avoidIdsFor(f2.state, '2026-10-28')].sort()).toEqual(['a', 'b', 'c'])
    expect([...avoidIdsFor(f2.state, '2026-10-27')].sort()).toEqual(['a', 'b', 'c'])
    for (let d = 1; d <= 20; d++) st = startPlay(st, `2026-11-${String(d).padStart(2, '0')}`, [`q${d}`]).state
    expect(Object.keys(st.days)).toHaveLength(14)
  })
})

describe('每日冒險（repo）', () => {
  it('同一天中途離開再回來：接著玩同一份（同 session、同題目），不會多算一次', async () => {
    const a = await repo.openStation(dailyChapterId('math'), 1, T0)
    expect(a.resumed).toBe(false)
    await repo.recordAttempt({ sessionId: a.sessionId, questionId: a.plan[0].question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1000 }, T0)
    await repo.recordAttempt({ sessionId: a.sessionId, questionId: a.plan[1].question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1000 }, T0 + 1)
    const b = await repo.openStation(dailyChapterId('math'), 1, T0 + 5000)
    expect(b.sessionId).toBe(a.sessionId)
    expect(ids(b.plan)).toEqual(ids(a.plan))
    expect(b.resumed).toBe(true)
    expect(b.idx).toBe(2)
    expect((await repo.getDailyInfo('math', T0)).plays).toBe(1)
  })
  it('同時開兩次（React StrictMode）只算一次、拿到同一份', async () => {
    const [a, b] = await Promise.all([repo.openStation(dailyChapterId('english'), 1, T0), repo.openStation(dailyChapterId('english'), 1, T0)])
    expect(b.sessionId).toBe(a.sessionId)
    expect(ids(b.plan)).toEqual(ids(a.plan))
    expect((await repo.getDailyInfo('english', T0)).plays).toBe(1)
  })
  it('完成：發材料（和一般站一樣 2–4 個、當天的材料種類）、第一次有今日徽章、技能難度照常更新', async () => {
    const o = await repo.openStation(dailyChapterId('english'), 1, T0)
    await answerAll(o.sessionId, o.plan, T0)
    const r = await repo.completeDaily({ chapterId: dailyChapterId('english'), sessionId: o.sessionId }, T0 + 100)
    expect(r.ok && r.badge).toBe(true)
    expect(r.ok && r.material).toBe(dailyMaterial(localDateStr(T0)))
    expect(r.ok && r.qty).toBe(4)
    expect(r.ok && r.chapterDone).toBe(false)
    expect(await repo.materialBalance()).toMatchObject({ [dailyMaterial(localDateStr(T0))]: 4 })
    expect(await repo.db.materialLedger.get(`daily:${o.sessionId}`)).toMatchObject({ kind: 'station', delta: 4 })
    expect((await repo.getDailyInfo('english', T0))).toMatchObject({ done: 1, badgeToday: true, badgeTotal: 1 })
    expect(await repo.listDailyBadges()).toEqual([{ date: localDateStr(T0), subject: 'english', at: T0 + 100 }])
    // 草稿清掉，不會留下舊進度
    expect((await repo.getSettings())?.stageDraft).toBeUndefined()
    // 答了 5 題 → 英文技能狀態有更新（快速通道：前 3 題全對直接升級）
    expect((await repo.getSkillStates()).english.difficulty).toBeGreaterThan(1)
  })
  it('同一個 session 只能領一次；沒答完不能領', async () => {
    const o = await repo.openStation(dailyChapterId('math'), 1, T0)
    expect((await repo.completeDaily({ chapterId: dailyChapterId('math'), sessionId: o.sessionId }, T0)).ok).toBe(false)
    await answerAll(o.sessionId, o.plan, T0)
    const rs = await Promise.all([1, 2].map(() => repo.completeDaily({ chapterId: dailyChapterId('math'), sessionId: o.sessionId }, T0 + 50)))
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect((await repo.listDailyBadges())).toHaveLength(1)
    expect((await repo.completeDaily({ chapterId: 'huaguoshan', sessionId: o.sessionId }, T0)).ok).toBe(false)
  })
  it('同一天可以重玩（題面換新、仍有材料），但只有第一次有徽章', async () => {
    const o1 = await repo.openStation(dailyChapterId('math'), 1, T0)
    await answerAll(o1.sessionId, o1.plan, T0)
    await repo.completeDaily({ chapterId: dailyChapterId('math'), sessionId: o1.sessionId }, T0 + 10)
    const o2 = await repo.openStation(dailyChapterId('math'), 1, T0 + 20_000)
    expect(o2.sessionId).not.toBe(o1.sessionId)
    expect(o2.resumed).toBe(false)
    expect(ids(o2.plan).filter((id) => ids(o1.plan).includes(id))).toEqual([]) // 今天先前的題面不再出
    await answerAll(o2.sessionId, o2.plan, T0 + 20_000)
    const r2 = await repo.completeDaily({ chapterId: dailyChapterId('math'), sessionId: o2.sessionId }, T0 + 30_000)
    expect(r2.ok && r2.badge).toBe(false)
    expect(r2.ok && r2.qty).toBeGreaterThanOrEqual(2)
    expect(await repo.getDailyInfo('math', T0)).toMatchObject({ plays: 2, done: 2, badgeTotal: 1 })
    expect((await repo.db.materialLedger.where('kind').equals('station').toArray())).toHaveLength(2)
  })
  it('隔天題面和昨天不同，又有一個新徽章；中間漏掉的日子沒有任何影響', async () => {
    const o1 = await repo.openStation(dailyChapterId('math'), 1, T0)
    await answerAll(o1.sessionId, o1.plan, T0)
    await repo.completeDaily({ chapterId: dailyChapterId('math'), sessionId: o1.sessionId }, T0 + 10)
    const day3 = T0 + 3 * DAY // 漏了兩天
    const o2 = await repo.openStation(dailyChapterId('math'), 1, day3)
    expect(ids(o2.plan).filter((id) => ids(o1.plan).includes(id))).toEqual([]) // 避開上一個玩過的日子
    await answerAll(o2.sessionId, o2.plan, day3)
    const r = await repo.completeDaily({ chapterId: dailyChapterId('math'), sessionId: o2.sessionId }, day3 + 10)
    expect(r.ok && r.badge).toBe(true)
    expect((await repo.listDailyBadges()).map((b) => b.date)).toEqual([localDateStr(T0), localDateStr(day3)])
    expect(await repo.getDailyInfo('math', day3)).toMatchObject({ plays: 1, done: 1, badgeToday: true, badgeTotal: 2 })
    expect(await repo.getDailyInfo('math', T0 + DAY)).toMatchObject({ plays: 0, done: 0, badgeToday: false })
  })
  it('每個科目各自的每日冒險與徽章；不影響章節進度', async () => {
    const m = await repo.openStation(dailyChapterId('math'), 1, T0)
    await answerAll(m.sessionId, m.plan, T0)
    await repo.completeDaily({ chapterId: dailyChapterId('math'), sessionId: m.sessionId }, T0)
    expect(await repo.getDailyInfo('math', T0)).toMatchObject({ done: 1, badgeToday: true })
    expect(await repo.getDailyInfo('english', T0)).toMatchObject({ plays: 0, done: 0, badgeToday: false })
    const e = await repo.openStation(dailyChapterId('english'), 1, T0)
    await answerAll(e.sessionId, e.plan, T0 + 100)
    const re = await repo.completeDaily({ chapterId: dailyChapterId('english'), sessionId: e.sessionId }, T0 + 100)
    expect(re.ok && re.badge).toBe(true) // 英文今天的第一次，也有自己的徽章
    expect((await repo.listDailyBadges()).map((b) => b.subject)).toEqual(['math', 'english'])
    // 章節進度完全沒被動到
    expect(await repo.db.progress.get('huaguoshan')).toBeUndefined()
    expect(await repo.db.progress.get('english-island')).toBeUndefined()
  })
  it('站中調整（adaptStation）會把草稿的次數存對，離開再回來還是同一份', async () => {
    const o = await repo.openStation(dailyChapterId('math'), 1, T0)
    await repo.recordAttempt({ sessionId: o.sessionId, questionId: o.plan[0].question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    const next = await repo.adaptStation({ chapterId: dailyChapterId('math'), station: 1, sessionId: o.sessionId, plan: o.plan, from: 1 })
    const again = await repo.openStation(dailyChapterId('math'), 1, T0 + 1000)
    expect(again.sessionId).toBe(o.sessionId)
    expect(ids(again.plan)).toEqual(ids(next))
  })
})

describe('科目各自的進度（章節）', () => {
  async function play(chapterId: string, station: number, now = T0) {
    const o = await repo.openStation(chapterId, station, now)
    await answerAll(o.sessionId, o.plan, now)
    return { o, r: await repo.completeStation({ chapterId, station, sessionId: o.sessionId }, now + 100) }
  }
  it('英文站：只出英文題；通關給材料；英文進度與數學進度互相獨立', async () => {
    const e = await play('english-island', 1)
    expect(e.o.plan.every((p) => p.question.skill === 'english')).toBe(true)
    expect(e.r.ok && e.r.material).toBe(ENGLISH_ISLAND.stations[0].material)
    expect((await repo.getProgress('english-island')).stations.map((s) => s.done)).toEqual([true, false, false, false, false])
    expect((await repo.getProgress('huaguoshan')).stations.every((s) => !s.done)).toBe(true)
    const m = await play('huaguoshan', 1)
    expect(m.o.plan.every((p) => p.question.skill !== 'english')).toBe(true)
    expect(m.r.ok).toBe(true)
    expect((await repo.getProgress('huaguoshan')).stations.map((s) => s.done)).toEqual([true, false, false, false, false])
    expect((await repo.getProgress('english-island')).stations.map((s) => s.done)).toEqual([true, false, false, false, false])
    // 英文第 2 站不受數學影響；數學第 3 站要先過第 2 站
    expect((await play('english-island', 2)).r.ok).toBe(true)
    expect((await repo.getProgress('english-island')).stations.filter((s) => s.done)).toHaveLength(2)
    expect((await repo.getProgress('huaguoshan')).stations.filter((s) => s.done)).toHaveLength(1)
    const skip = await repo.openStation('huaguoshan', 3, T0)
    await answerAll(skip.sessionId, skip.plan, T0)
    expect((await repo.completeStation({ chapterId: 'huaguoshan', station: 3, sessionId: skip.sessionId }, T0)).ok).toBe(false)
  })
  it('英文章末寶箱：通關 5 站才能開，每輪一次，只影響英文進度', async () => {
    for (let s = 1; s <= 5; s++) expect((await play('english-island', s, T0 + s * 1000)).r.ok).toBe(true)
    expect((await repo.getProgress('english-island')).stations.every((s) => s.done)).toBe(true)
    const chest = await repo.claimChest('english-island', T0)
    expect(chest.ok && chest.rewards).toEqual(ENGLISH_ISLAND.chest)
    expect((await repo.claimChest('english-island', T0)).ok).toBe(false)
    expect((await repo.claimChest('huaguoshan', T0)).ok).toBe(false) // 數學的寶箱還鎖著
    expect((await repo.startNextRun('english-island', T0)).ok).toBe(true)
    expect((await repo.getProgress('english-island')).run).toBe(2)
    expect((await repo.getProgress('huaguoshan')).run).toBe(1)
    expect(HUAGUOSHAN.stations).toHaveLength(5)
  })
  it('英文技能的難度各自獨立：英文升級不會改數學的難度', async () => {
    await play('english-island', 1)
    const st = await repo.getSkillStates()
    expect(st.english.difficulty).toBeGreaterThan(1)
    expect([st.number.difficulty, st.classify.difficulty, st.pattern.difficulty]).toEqual([1, 1, 1])
  })
  it('年齡檔對英文也有用：6–7 歲英文從難度 2 開始；3 歲英文用幼幼題', async () => {
    await repo.setAgeBand('6-7')
    expect((await repo.getSkillStates()).english.difficulty).toBe(2)
    await repo.setAgeBand('3')
    const o = await repo.openStation('english-island', 1, T0)
    expect(o.plan.every((p) => p.question.skill === 'english' && p.question.gentle)).toBe(true)
    expect(getQuestion(o.plan[0].question.id)?.choices).toHaveLength(2)
  })
})
