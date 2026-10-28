import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { localDateStr } from '../domain/date'
import { getQuestion, QUESTIONS } from '../learning/bank'
import { HUAGUOSHAN } from '../learning/chapter'
import { makeRng } from '../learning/rng'
import { SHOP_CATALOG, DECOR_COSTS } from '../learning/materials'
import type { PlannedQuestion } from '../learning/select'
import { initialSkillState } from '../learning/skills'
import { SKILLS } from '../learning/types'

const T0 = new Date(2026, 5, 10, 9, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000
let n = 0
let repo: Repo

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`learn-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

/** 玩一站：plan 的 5 題，correct 指定哪幾題「第一次就對」，其餘算錯一次後答對 */
async function playStation(station: number, sessionId: string, correct: boolean[], now = T0): Promise<PlannedQuestion[]> {
  const plan = await repo.planStation(station - 1, now, makeRng(station * 31 + sessionId.length))
  for (const [i, p] of plan.entries()) {
    const ok = correct[i]
    const r = await repo.recordAttempt(
      { sessionId, questionId: p.question.id, firstTryCorrect: ok, hintsUsed: ok ? 0 : 1, durationMs: 2000, review: p.review, followUp: p.followUp },
      now + i,
    )
    expect(r.ok).toBe(true)
  }
  return plan
}

describe('作答紀錄', () => {
  it('技能與難度以題庫為準；提示後答對 firstTryCorrect=false、hintsUsed>=1', async () => {
    const q = getQuestion('number-1-01')!
    await repo.recordAttempt({ sessionId: 's', questionId: q.id, firstTryCorrect: false, hintsUsed: 1, durationMs: 5000 }, T0)
    const a = (await repo.db.attempts.toArray())[0]
    expect(a).toMatchObject({ questionId: q.id, skill: 'number', difficulty: 1, firstTryCorrect: false, hintsUsed: 1, sessionId: 's', durationMs: 5000, at: T0 })
  })
  it('第一次就對時 hintsUsed 一律 0；答錯但宣稱 0 次提示會被修正成 >= 1', async () => {
    await repo.recordAttempt({ sessionId: 's', questionId: 'number-1-01', firstTryCorrect: true, hintsUsed: 3, durationMs: 1 }, T0)
    await repo.recordAttempt({ sessionId: 's', questionId: 'number-1-02', firstTryCorrect: false, hintsUsed: 0, durationMs: 1 }, T0)
    const [a, b] = (await repo.db.attempts.orderBy('questionId').toArray())
    expect(a.hintsUsed).toBe(0)
    expect(b.hintsUsed).toBe(1)
  })
  it('未知題目/缺 session 被拒絕；同一 session 同一題重複送出不重複計算', async () => {
    expect((await repo.recordAttempt({ sessionId: 's', questionId: 'zzz', firstTryCorrect: true, hintsUsed: 0, durationMs: 1 })).ok).toBe(false)
    expect((await repo.recordAttempt({ sessionId: '', questionId: 'number-1-01', firstTryCorrect: true, hintsUsed: 0, durationMs: 1 })).ok).toBe(false)
    const rs = await Promise.all([1, 2, 3].map(() => repo.recordAttempt({ sessionId: 's', questionId: 'number-1-01', firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)))
    expect(rs.every((r) => r.ok)).toBe(true)
    expect(await repo.db.attempts.count()).toBe(1)
    expect((await repo.getSkillStates()).number.recent).toEqual([true])
  })
  it('並行寫入同一技能：recent 不遺失', async () => {
    const ids = ['number-1-01', 'number-1-02', 'number-1-03', 'number-1-04']
    // 一對一錯，避開「前 3 題全對直接升級」會清空 recent
    await Promise.all(ids.map((id, i) => repo.recordAttempt({ sessionId: 's', questionId: id, firstTryCorrect: i % 2 === 0, hintsUsed: i % 2 === 0 ? 0 : 1, durationMs: 1 }, T0)))
    expect((await repo.getSkillStates()).number.recent).toHaveLength(4)
  })
  it('累積 5 題無提示答對 → 該技能升到難度 2（持久化）', async () => {
    for (let i = 1; i <= 5; i++) await repo.recordAttempt({ sessionId: 's', questionId: `number-1-0${i}`, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
    expect((await repo.getSkillStates()).number.difficulty).toBe(2)
    expect((await repo.getSkillStates()).number.mastered[1]).toBeDefined() // 升級時舊難度記成已掌握
    expect((await repo.getSkillStates()).classify.difficulty).toBe(1)
  })
})

describe('關卡 / 材料 / 寶箱', () => {
  it('完成一站：材料依無提示答對數入帳、進度更新', async () => {
    await playStation(1, 'sess1', [true, true, true, false, true])
    const r = await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 'sess1' }, T0)
    expect(r).toMatchObject({ ok: true, independent: 4, total: 5, material: 'wood', qty: 4 })
    expect((await repo.materialBalance()).wood).toBe(4)
    const prog = await repo.getProgress('huaguoshan')
    expect(prog.stations[0]).toMatchObject({ done: true, independent: 4, total: 5 })
    expect(prog.stations[1].done).toBe(false)
  })
  it('提示後答對不算獨立答對：全部都錯一次 → 只得 2 個材料', async () => {
    await playStation(1, 'sess1', [false, false, false, false, false])
    const r = await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 'sess1' }, T0)
    expect(r).toMatchObject({ ok: true, independent: 0, qty: 2 })
  })
  it('答不滿 5 題不能結算；沒通關前一站不能玩下一站；同 session 不能重複領', async () => {
    await repo.recordAttempt({ sessionId: 'x', questionId: 'number-1-01', firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    expect((await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 'x' })).ok).toBe(false)
    await playStation(2, 'sess2', [true, true, true, true, true])
    expect((await repo.completeStation({ chapterId: 'huaguoshan', station: 2, sessionId: 'sess2' })).ok).toBe(false)
    await playStation(1, 'sess1', [true, true, true, true, true])
    const rs = await Promise.all([1, 2, 3].map(() => repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 'sess1' }, T0)))
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect((await repo.materialBalance()).wood).toBe(4)
    expect(await repo.db.materialLedger.count()).toBe(1)
    expect((await repo.completeStation({ chapterId: 'nope', station: 1, sessionId: 'sess1' })).ok).toBe(false)
  })
  it('5 站通關 → 寶箱 → 再玩一次（新一輪）', async () => {
    expect((await repo.claimChest('huaguoshan')).ok).toBe(false)
    for (let s = 1; s <= 5; s++) {
      await playStation(s, `run1-${s}`, [true, true, true, true, true], T0 + s * 1000)
      const r = await repo.completeStation({ chapterId: 'huaguoshan', station: s, sessionId: `run1-${s}` }, T0 + s * 1000)
      expect(r.ok && r.chapterDone).toBe(s === 5)
    }
    expect((await repo.startNextRun('huaguoshan')).ok).toBe(false) // 還沒開寶箱
    const before = await repo.materialBalance()
    const chests = await Promise.all([repo.claimChest('huaguoshan'), repo.claimChest('huaguoshan')])
    expect(chests.filter((c) => c.ok)).toHaveLength(1)
    const after = await repo.materialBalance()
    expect(after.wood - before.wood).toBe(HUAGUOSHAN.chest.wood)
    expect(after.stone - before.stone).toBe(HUAGUOSHAN.chest.stone)
    expect(after.flower - before.flower).toBe(HUAGUOSHAN.chest.flower)
    expect((await repo.startNextRun('huaguoshan')).ok).toBe(true)
    const p = await repo.getProgress('huaguoshan')
    expect(p).toMatchObject({ run: 2, chestClaimed: false, completedRuns: 1 })
    expect(p.stations.every((s) => !s.done)).toBe(true)
    // 第二輪可以再玩第 1 站
    await playStation(1, 'run2-1', [true, true, true, true, true], T0 + 9000)
    expect((await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 'run2-1' }, T0 + 9000)).ok).toBe(true)
  })
  it('第二輪抽到的題面和第一輪不同', async () => {
    const first = await playStation(1, 'a', [true, true, true, true, true])
    const second = await repo.planStation(0, T0, makeRng(99))
    const ids = new Set(first.map((p) => p.question.id))
    expect(second.every((p) => !ids.has(p.question.id))).toBe(true)
  })
  it('連續 2 站穩定 → 掌握，隔天出現複習題並記為 review', async () => {
    // 舊玩家的技能狀態（沒有 total 欄位）：不會觸發新技能的快速通道，純靠站末結算掌握
    await repo.db.skillState.bulkPut(SKILLS.map((k) => ({ ...initialSkillState(k), total: undefined })))
    await playStation(1, 'a', [true, true, true, true, true])
    await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 'a' }, T0)
    await playStation(2, 'b', [true, true, true, true, true])
    const r = await repo.completeStation({ chapterId: 'huaguoshan', station: 2, sessionId: 'b' }, T0)
    expect(r.ok && r.newlyMastered.length).toBeGreaterThan(0)
    const states = await repo.getSkillStates()
    expect(Object.values(states).some((s) => Object.keys(s.mastered).length > 0)).toBe(true)
    const plan = await repo.planStation(2, T0 + DAY, makeRng(5))
    expect(plan.filter((p) => p.review)).toHaveLength(1)
    const rv = plan.find((p) => p.review)!
    await repo.recordAttempt({ sessionId: 'c', questionId: rv.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1, review: true }, T0 + DAY)
    const att = await repo.db.attempts.get(`c:${rv.question.id}`)
    expect(att?.review).toBe(true)
    const st = (await repo.getSkillStates())[rv.question.skill]
    expect(st.mastered[rv.question.difficulty]?.reviews).toBe(1)
  })
})

describe('工坊', () => {
  const give = async (wood: number, stone: number, flower: number) => {
    const ts = T0
    await repo.db.materialLedger.bulkPut([
      { id: 'g1', at: ts, material: 'wood', delta: wood, kind: 'station', reason: 't' },
      { id: 'g2', at: ts, material: 'stone', delta: stone, kind: 'station', reason: 't' },
      { id: 'g3', at: ts, material: 'flower', delta: flower, kind: 'station', reason: 't' },
    ])
  }
  it('材料夠就能做：扣材料、家具進背包；材料不足不扣', async () => {
    const c = DECOR_COSTS['decor-plant']
    await give(c.wood, c.stone, c.flower - 1)
    const bad = await repo.craftFurniture('decor-plant', T0)
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.error).toContain('花朵 1')
    expect(await repo.db.inventory.get('decor-plant')).toBeUndefined()
    await give(c.wood, c.stone, c.flower) // 同 id 覆寫成剛好夠
    expect((await repo.craftFurniture('decor-plant', T0)).ok).toBe(true)
    expect(await repo.materialBalance()).toEqual({ wood: 0, stone: 0, flower: 0 })
    expect((await repo.db.inventory.get('decor-plant'))?.qty).toBe(1)
  })
  it('v7：同一件家具最多做 3 個，每個各扣一次材料；第 4 個不能做', async () => {
    await give(40, 40, 40)
    const rs = await Promise.all([repo.craftFurniture('decor-ball', T0), repo.craftFurniture('decor-ball', T0)])
    expect(rs.filter((r) => r.ok)).toHaveLength(2)
    const c = DECOR_COSTS['decor-ball']
    expect((await repo.materialBalance()).wood).toBe(40 - 2 * c.wood)
    expect((await repo.craftFurniture('decor-ball', T0)).ok).toBe(true)
    expect((await repo.craftFurniture('decor-ball', T0)).ok).toBe(false)
    expect((await repo.db.inventory.get('decor-ball'))?.qty).toBe(3)
  })
  it('不是家具/不存在的東西不能做；做好的家具可以擺放', async () => {
    await give(50, 50, 50)
    expect((await repo.craftFurniture('banana')).ok).toBe(false)
    expect((await repo.craftFurniture('nope')).ok).toBe(false)
    await repo.craftFurniture('decor-rug', T0)
    expect((await repo.placeDecor('decor-rug', 0.5, 0.9, T0)).ok).toBe(true)
  })
  it('SHOP_CATALOG 寫入 shopItems 時家具帶 cost', async () => {
    const rug = await repo.db.shopItems.get('decor-rug')
    expect(rug?.cost).toEqual(SHOP_CATALOG.find((i) => i.id === 'decor-rug')!.cost)
  })
})

describe('遊玩時間與設定', () => {
  const day = localDateStr(T0)
  it('新使用者預設 20 分鐘、音效與語音開', async () => {
    expect(await repo.getLearningSettings()).toEqual({ dailyLimitMin: 20, soundOn: true, voiceOn: true })
  })
  it('設定可改；不支援的時間限制被拒絕', async () => {
    expect((await repo.setLearningSettings({ dailyLimitMin: 45, soundOn: false })).ok).toBe(true)
    expect(await repo.getLearningSettings()).toEqual({ dailyLimitMin: 45, soundOn: false, voiceOn: true })
    expect((await repo.setLearningSettings({ dailyLimitMin: 7 })).ok).toBe(false)
    expect((await repo.setLearningSettings({ dailyLimitMin: 0 })).ok).toBe(true)
  })
  it('累計秒數；並行寫入不遺失', async () => {
    await Promise.all(Array.from({ length: 10 }, () => repo.addPlayTime(day, 5)))
    expect((await repo.getPlayTime(day)).seconds).toBe(50)
    await repo.addPlayTime(day, -3)
    await repo.addPlayTime(day, NaN)
    expect((await repo.getPlayTime(day)).seconds).toBe(50)
    expect(await repo.getPlayTime('2020-01-01')).toEqual({ date: '2020-01-01', seconds: 0, bonusSeconds: 0 })
  })
  it('延長 10 分鐘需要正確 PIN', async () => {
    expect((await repo.extendPlayTime('0000', day)).ok).toBe(false)
    expect((await repo.getPlayTime(day)).bonusSeconds).toBe(0)
    expect((await repo.extendPlayTime('1234', day)).ok).toBe(true)
    expect((await repo.getPlayTime(day)).bonusSeconds).toBe(600)
  })
  it('重設全部資料會清掉學習資料', async () => {
    await playStation(1, 'a', [true, true, true, true, true])
    await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 'a' }, T0)
    await repo.addPlayTime(day, 30)
    await repo.resetAll('1234')
    expect(await repo.db.attempts.count()).toBe(0)
    expect(await repo.db.materialLedger.count()).toBe(0)
    expect(await repo.db.progress.count()).toBe(0)
    expect(await repo.db.skillState.count()).toBe(0)
    expect(await repo.db.playTime.count()).toBe(0)
  })
})

describe('Dexie v3 migration：舊玩家資料不遺失', () => {
  /** 建一個 v2 時代的資料庫（沒有學習表、settings 沒有新欄位），塞滿舊資料 */
  async function seedOldDb(name: string) {
    const old = new Dexie(name)
    old.version(1).stores({
      children: 'id', templates: 'id, order', instances: 'id, templateId, date, status', ledger: 'id, at, kind',
      pets: 'id', shopItems: 'id, kind', inventory: 'id, itemId', coloring: 'pageId', settings: 'id',
    })
    old.version(2).stores({ placements: 'itemId' })
    await old.table('children').put({ id: 'child', name: '小明', avatar: '🐵' })
    await old.table('settings').put({ id: 'main', pinHash: 'HASH', childName: '小明', onboarded: true, feedHintShown: true })
    await old.table('pets').put({ id: 'pet', name: '阿悟', stage: 'baby', feedCount: 33, hunger: 61, hungerUpdatedAt: 123, mood: 'happy' })
    await old.table('templates').put({ id: 'tpl-x', title: '寫功課', emoji: '📚', points: 30, repeatDaily: true, active: true, order: 1 })
    await old.table('instances').put({ id: 'i1', templateId: 'tpl-x', date: '2026-06-10', status: 'approved', updatedAt: 5 })
    await old.table('ledger').bulkPut([
      { id: 'l1', at: 1, delta: 30, reason: '完成任務', kind: 'task' },
      { id: 'l2', at: 2, delta: -10, reason: '購買：香蕉', kind: 'purchase', refId: 'banana' },
    ])
    await old.table('inventory').bulkPut([
      { id: 'banana', itemId: 'banana', qty: 2 },
      { id: 'decor-plant', itemId: 'decor-plant', qty: 1 },
      { id: 'coloring-fish', itemId: 'coloring-fish', qty: 1 },
    ])
    await old.table('shopItems').bulkPut([
      { id: 'banana', kind: 'food', name: '香蕉', price: 10, asset: 'banana' },
      { id: 'decor-plant', kind: 'decor', name: '小盆栽', price: 50, asset: 'plant', slot: 'floor' },
    ])
    await old.table('placements').put({ itemId: 'decor-plant', x: 0.2, y: 0.8, z: 3, flipped: true, placedAt: 77 })
    await old.table('coloring').put({ pageId: 'fish', fills: { body: '#e8a6a0' }, updatedAt: 9 })
    old.close()
  }

  it('星星、寵物、已擺放家具、著色進度、背包、設定全部保留', async () => {
    const name = `mig3-${n++}`
    await seedOldDb(name)
    const db = new GuaibaoDB(name)
    const r = new Repo(db, () => T0)

    expect(await r.balance()).toBe(20)
    expect(await db.pets.get('pet')).toMatchObject({ name: '阿悟', stage: 'baby', feedCount: 33, hunger: 61 })
    expect(await db.placements.get('decor-plant')).toEqual({ itemId: 'decor-plant', x: 0.2, y: 0.8, z: 3, flipped: true, placedAt: 77 })
    expect((await db.coloring.get('fish'))?.fills).toEqual({ body: '#e8a6a0' })
    expect((await db.inventory.get('banana'))?.qty).toBe(2)
    expect((await db.inventory.get('decor-plant'))?.qty).toBe(1)
    expect((await db.inventory.get('coloring-fish'))?.qty).toBe(1)
    expect(await db.instances.count()).toBe(1)
    expect(await db.templates.count()).toBe(1)
    expect((await db.children.get('child'))?.name).toBe('小明')
    expect(await r.verifyPin('x')).toBe(false)

    const s = await db.settings.get('main')
    expect(s).toMatchObject({ pinHash: 'HASH', childName: '小明', onboarded: true, feedHintShown: true })
    expect(s).toMatchObject({ dailyLimitMin: 20, soundOn: true, voiceOn: true })

    // 家具補上材料成本，原欄位不變
    expect(await db.shopItems.get('decor-plant')).toMatchObject({ price: 50, slot: 'floor', cost: DECOR_COSTS['decor-plant'] })
    expect((await db.shopItems.get('banana'))?.cost).toBeUndefined()
  })

  it('升級後學習表可用，舊玩家可以直接玩一站並做家具', async () => {
    const name = `mig3-${n++}`
    await seedOldDb(name)
    const r = new Repo(new GuaibaoDB(name), () => T0)
    expect(await r.db.attempts.count()).toBe(0)
    expect(await r.db.playTime.count()).toBe(0)
    const plan = await r.planStation(0, T0, makeRng(1))
    for (const p of plan) await r.recordAttempt({ sessionId: 'old', questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    expect((await r.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 'old' }, T0)).ok).toBe(true)
    expect((await r.getLearningSettings()).dailyLimitMin).toBe(20)
    // v7：已擁有的盆栽可以再做第二個（最多 3 個）
    await r.db.materialLedger.put({ id: 'big', at: T0, material: 'flower', delta: 50, kind: 'station', reason: 't' })
    expect((await r.craftFurniture('decor-plant')).ok).toBe(true)
    expect((await r.db.inventory.get('decor-plant'))?.qty).toBe(2)
    // 星星帳不受影響
    expect(await r.balance()).toBe(20)
  })

  it('從 v1 一路升到 v3 也不遺失（舊 decor 陣列 → placements → v3）', async () => {
    const name = `mig3-${n++}`
    const old = new Dexie(name)
    old.version(1).stores({
      children: 'id', templates: 'id, order', instances: 'id, templateId, date, status', ledger: 'id, at, kind',
      pets: 'id', shopItems: 'id, kind', inventory: 'id, itemId', coloring: 'pageId', settings: 'id',
    })
    await old.table('pets').put({ id: 'pet', name: '阿悟', stage: 'baby', feedCount: 30, hunger: 50, hungerUpdatedAt: 1, mood: 'normal', decor: ['decor-plant'] })
    await old.table('settings').put({ id: 'main', pinHash: 'H', childName: 'A', onboarded: true })
    await old.table('ledger').put({ id: 'l1', at: 1, delta: 15, reason: 'x', kind: 'bonus' })
    old.close()
    const db = new GuaibaoDB(name)
    expect((await db.placements.toArray()).map((p) => p.itemId)).toEqual(['decor-plant'])
    expect((await db.pets.get('pet'))?.feedCount).toBe(30)
    expect((await db.ledger.get('l1'))?.delta).toBe(15)
    expect((await db.settings.get('main'))?.dailyLimitMin).toBe(20)
  })

  it('已升到 v3 的資料庫再次開啟不會重設使用者已改的設定', async () => {
    const name = `mig3-${n++}`
    const first = new Repo(new GuaibaoDB(name), () => T0)
    await first.onboard({ pin: '1234', childName: 'A', petName: '' }, T0)
    await first.setLearningSettings({ dailyLimitMin: 45, voiceOn: false })
    first.db.close()
    const again = new Repo(new GuaibaoDB(name), () => T0)
    expect(await again.getLearningSettings()).toEqual({ dailyLimitMin: 45, soundOn: true, voiceOn: false })
  })
})

describe('v4：年齡、起始難度、離開關卡保留進度', () => {
  it('getLearnerProfile：預設 4–5 歲；設定後讀得到；不支援的年齡被拒絕', async () => {
    expect(await repo.getLearnerProfile()).toMatchObject({ ageBand: '4-5', configured: false, startDifficulty: 1, gentle: false })
    expect((await repo.setAgeBand('6-7')).ok).toBe(true)
    expect(await repo.getLearnerProfile()).toMatchObject({ ageBand: '6-7', configured: true, startDifficulty: 2 })
    expect((await repo.setAgeBand('99' as never)).ok).toBe(false)
  })
  it('6–7 歲：還沒玩過的技能從難度 2 開始，抽到的題都是難度 2；已經有紀錄的技能不受影響', async () => {
    await repo.setAgeBand('6-7')
    const states = await repo.getSkillStates()
    expect(SKILLS.every((k) => states[k].difficulty === 2)).toBe(true)
    const plan = await repo.planStation(0, T0, makeRng(4))
    expect(plan.every((p) => p.question.difficulty === 2)).toBe(true)
    // 已經玩過 number（降回難度 1）後改年齡：number 不動
    await repo.db.skillState.put({ ...initialSkillState('number', T0, 1), total: 9 })
    await repo.setAgeBand('6-7')
    expect((await repo.getSkillStates()).number.difficulty).toBe(1)
  })
  it('3 歲：只抽幼幼題庫；升級要連續 5 題獨立答對', async () => {
    await repo.setAgeBand('3')
    const plan = await repo.planStation(0, T0, makeRng(8))
    expect(plan.every((p) => p.question.difficulty === 1)).toBe(true)
    const num = plan.filter((p) => p.question.skill === 'number')
    expect(num.every((p) => Number(p.question.answer) <= 3)).toBe(true)
    for (let i = 1; i <= 4; i++) await repo.recordAttempt({ sessionId: 's', questionId: `number-1-g0${i}`, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
    expect((await repo.getSkillStates()).number.difficulty).toBe(1)
    await repo.recordAttempt({ sessionId: 's', questionId: 'number-1-g05', firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + 9)
    expect((await repo.getSkillStates()).number.difficulty).toBe(2)
  })
  it('作答紀錄帶互動方式（舊紀錄沒有，視為 pick）', async () => {
    await repo.recordAttempt({ sessionId: 's', questionId: 'number-1-01', firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    const give = QUESTIONS_GIVE()
    await repo.recordAttempt({ sessionId: 's', questionId: give, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    expect((await repo.db.attempts.get('s:number-1-01'))?.interaction).toBe('pick')
    expect((await repo.db.attempts.get(`s:${give}`))?.interaction).toBe('tapN')
  })
  it('離開再回來：同一站接著上次的題目與順序，已答的不用重答；完成後進度清掉', async () => {
    const first = await repo.openStation('huaguoshan', 1, T0, makeRng(1))
    expect(first).toMatchObject({ idx: 0, resumed: false })
    // 答了前 2 題就離開
    for (const p of first.plan.slice(0, 2))
      await repo.recordAttempt({ sessionId: first.sessionId, questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    const again = await repo.openStation('huaguoshan', 1, T0 + 1000, makeRng(99))
    expect(again.sessionId).toBe(first.sessionId)
    expect(again.plan.map((p) => p.question.id)).toEqual(first.plan.map((p) => p.question.id))
    expect(again).toMatchObject({ idx: 2, resumed: true })
    // 補完，結算後進度清掉，再進同一站會是新的一站（這站已通關就不能玩，但草稿不留）
    for (const p of first.plan.slice(2))
      await repo.recordAttempt({ sessionId: first.sessionId, questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    expect((await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: first.sessionId }, T0)).ok).toBe(true)
    expect((await repo.getSettings())?.stageDraft).toBeUndefined()
  })
  it('進度只對同一站有效；別的站或下一輪會是全新的一站', async () => {
    const a = await repo.openStation('huaguoshan', 1, T0, makeRng(1))
    const b = await repo.openStation('huaguoshan', 2, T0, makeRng(2))
    expect(b.sessionId).not.toBe(a.sessionId)
    expect(b.resumed).toBe(false)
    const back = await repo.openStation('huaguoshan', 1, T0, makeRng(3))
    expect(back.sessionId).not.toBe(a.sessionId) // 草稿只保留最近離開的那一站
  })
  it('草稿裡有已經不存在的題目（題庫改版）時，丟掉草稿重新規劃，不會報錯', async () => {
    const a = await repo.openStation('huaguoshan', 1, T0, makeRng(1))
    await repo.db.settings.update('main', { stageDraft: { ...(await repo.getSettings())!.stageDraft!, plan: [{ id: 'classify-3-14-old', review: false, followUp: false }] } })
    const b = await repo.openStation('huaguoshan', 1, T0, makeRng(1))
    expect(b.sessionId).not.toBe(a.sessionId)
    expect(b.plan).toHaveLength(5)
  })
  it('adaptStation：升級後剩下的同技能題改用新難度，並存回進度', async () => {
    const o = await repo.openStation('huaguoshan', 1, T0, makeRng(5))
    // 把 number 狀態設成已經升到難度 2（模擬站中升級）
    await repo.db.skillState.put({ ...initialSkillState('number', T0, 2), total: 9 })
    const next = await repo.adaptStation({ chapterId: 'huaguoshan', station: 1, sessionId: o.sessionId, plan: o.plan, from: 1 }, makeRng(6))
    for (const p of next.slice(1)) if (p.question.skill === 'number') expect(p.question.difficulty).toBe(2)
    const draft = (await repo.getSettings())!.stageDraft!
    expect(draft.plan.map((p) => p.id)).toEqual(next.map((p) => p.question.id))
  })
  it('舊玩家（v3 的 skillState 沒有 total、attempts 的題目 id 已不存在）升級後可以直接玩，不報錯', async () => {
    await repo.db.skillState.put({ skill: 'classify', difficulty: 3, recent: [true, false, true], stationStreak: 1, mastered: { 1: { masteredAt: T0 - 9 * DAY, reviews: 1 }, 2: { masteredAt: T0 - 4 * DAY, reviews: 0 } }, updatedAt: T0 })
    await repo.db.attempts.put({ id: 'old:classify-3-14', at: T0 - DAY, questionId: 'classify-3-14', skill: 'classify', difficulty: 3, firstTryCorrect: true, hintsUsed: 0, durationMs: 1, sessionId: 'old' })
    const o = await repo.openStation('huaguoshan', 1, T0, makeRng(7))
    expect(o.plan).toHaveLength(5)
    for (const p of o.plan) await repo.recordAttempt({ sessionId: o.sessionId, questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1, review: p.review }, T0)
    expect((await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: o.sessionId }, T0)).ok).toBe(true)
    const st = (await repo.getSkillStates()).classify
    expect(st.mastered[1]).toBeDefined()
  })
})

function QUESTIONS_GIVE(): string {
  const q = QUESTIONS.find((x) => x.type === 'give')
  return q!.id
}
