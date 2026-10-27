import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { FOOD_IDS } from '../domain/constants'
import { localDateStr } from '../domain/date'
import { favoriteFoodOf } from '../domain/favorite'
import { FRIENDS } from '../domain/friends'
import { makeRng } from '../learning/rng'
import { QUESTIONS } from '../learning/bank'
import { objectsInQuestion } from '../domain/friends'

const T0 = new Date(2026, 5, 10, 9, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000
let n = 0
let repo: Repo

const makeRepo = (rng: () => number = makeRng(1)) => new Repo(new GuaibaoDB(`meta-${n++}`), () => T0, rng)

beforeEach(async () => {
  repo = makeRepo()
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

async function playStation(station: number, sessionId: string, correct = true, now = T0) {
  const plan = await repo.planStation(station - 1, now, makeRng(station * 31 + sessionId.length))
  for (const [i, p] of plan.entries()) {
    await repo.recordAttempt({ sessionId, questionId: p.question.id, firstTryCorrect: correct, hintsUsed: correct ? 0 : 1, durationMs: 1000, review: p.review, followUp: p.followUp }, now + i)
  }
  return plan
}
const qty = async (id: string) => (await repo.db.inventory.get(id))?.qty ?? 0

describe('學習掉落食物（completeStation）', () => {
  it('過一站：背包多 1 個食物，pendingGifts 多一筆 { foodId, at, from: station }；回傳結構不變', async () => {
    await playStation(1, 's1')
    const before = await Promise.all(FOOD_IDS.map(qty))
    const r = await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 's1' }, T0)
    expect(r).toMatchObject({ ok: true, material: 'wood', chapterDone: false })
    expect(Object.keys(r).sort()).toEqual(['chapterDone', 'independent', 'material', 'newlyMastered', 'ok', 'qty', 'total'])
    const gifts = await repo.getPendingGifts()
    expect(gifts).toHaveLength(1)
    expect(gifts[0]).toMatchObject({ at: T0, from: 'station' })
    expect(FOOD_IDS).toContain(gifts[0].foodId)
    expect(gifts[0].foodId).not.toBe('cake')
    const after = await Promise.all(FOOD_IDS.map(qty))
    expect(after.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0)).toBe(1)
    expect(await qty(gifts[0].foodId!)).toBe(1)
  })
  it('注入固定亂數：掉落可以重現；同一個 session 重複領不會多掉', async () => {
    await playStation(1, 's1')
    await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 's1' }, T0)
    const again = await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 's1' }, T0)
    expect(again.ok).toBe(false)
    expect(await repo.getPendingGifts()).toHaveLength(1)
    // 同樣的亂數序列 → 同樣的食物
    const r2 = makeRepo(makeRng(1))
    await r2.onboard({ pin: '1234', childName: 'x', petName: '' }, T0)
    const plan = await r2.planStation(0, T0, makeRng(32))
    for (const [i, p] of plan.entries()) await r2.recordAttempt({ sessionId: 's1', questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
    await r2.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 's1' }, T0)
    expect((await r2.getPendingGifts())[0].foodId).toBe((await repo.getPendingGifts())[0].foodId)
  })
  it('亂數可注入：rng 固定 0 → 權重表第一個食物；固定接近 1 → 最後一個（不是蛋糕）', async () => {
    const { grantStationDrop } = await import('./meta')
    const g0 = await grantStationDrop(repo.db, () => 0, T0)
    const g1 = await grantStationDrop(repo.db, () => 0.999999, T0)
    expect(g0.foodId).toBe('carrot')
    expect(g1.foodId).toBe('watermelon')
    expect(favoriteFoodOf(localDateStr(T0))).toBeTruthy() // 加權細節在 domain/gifts.test.ts
  })
})

describe('今日小禮物', () => {
  const guideDone = () => repo.markHomeGuideShown()
  it('新使用者第一天有首次引導：當天不送，隔天開始', async () => {
    expect(await repo.grantDailyGift(T0)).toBeNull()
    expect(await repo.getPendingGifts()).toEqual([])
    await guideDone()
    expect(await repo.grantDailyGift(T0)).toBeNull() // 同一天還是沒有
    expect(await repo.grantDailyGift(T0 + DAY)).not.toBeNull()
  })
  it('一天只送一次；隔天再送；漏掉幾天不補', async () => {
    await guideDone()
    await repo.db.settings.update('main', { lastGiftDate: '2000-01-01' })
    const g = await repo.grantDailyGift(T0)
    expect(g).toMatchObject({ from: 'daily' })
    expect(await repo.grantDailyGift(T0)).toBeNull()
    expect(await repo.grantDailyGift(T0 + 3600_000)).toBeNull()
    expect(await repo.getPendingGifts()).toHaveLength(1)
    // 隔了 5 天才開：只有一份，沒有補 4 份、也沒有連續獎勵
    expect(await repo.grantDailyGift(T0 + 5 * DAY)).not.toBeNull()
    expect(await repo.getPendingGifts()).toHaveLength(2)
  })
  it('食物進背包、材料進材料帳、貼紙記錄在 settings.stickers', async () => {
    await guideDone()
    const seen = { food: 0, material: 0, sticker: 0 }
    for (let i = 1; i <= 60; i++) {
      const g = await repo.grantDailyGift(T0 + i * DAY)
      if (g?.foodId) {
        seen.food++
        expect(await qty(g.foodId)).toBeGreaterThan(0)
      } else if (g?.materialId) {
        seen.material++
        expect((await repo.materialBalance())[g.materialId]).toBeGreaterThanOrEqual(2)
      } else if (g?.stickerId) {
        seen.sticker++
        expect((await repo.getSettings())?.stickers).toContain(g.stickerId)
      }
    }
    expect(seen.food).toBeGreaterThan(0)
    expect(seen.material).toBeGreaterThan(0)
    expect(seen.food + seen.material + seen.sticker).toBe(60)
  })
})

describe('pendingGifts 依序展示', () => {
  it('收下 = 從佇列最前面拿掉；沒有東西時回傳 null', async () => {
    await repo.markHomeGuideShown()
    const { queueGifts } = await import('./meta')
    await queueGifts(repo.db, [
      { foodId: 'apple', at: 1, from: 'station' },
      { foodId: 'peach', at: 2, from: 'station' },
      { materialId: 'wood', qty: 2, at: 3, from: 'daily' },
    ])
    expect((await repo.getPendingGifts()).map((g) => g.at)).toEqual([1, 2, 3])
    expect((await repo.collectGift())?.foodId).toBe('apple')
    expect((await repo.getPendingGifts()).map((g) => g.at)).toEqual([2, 3])
    expect((await repo.collectGift())?.foodId).toBe('peach')
    expect((await repo.collectGift())?.materialId).toBe('wood')
    expect(await repo.collectGift()).toBeNull()
    // 收下不會再改背包（東西發放時就已經進背包）
    expect(await qty('apple')).toBe(1)
    expect(await qty('peach')).toBe(1)
  })
})

describe('阿悟學會新招', () => {
  it('沒有里程碑就沒有新招；數感升級 → 數香蕉；只慶祝一次', async () => {
    expect(await repo.syncTricks()).toEqual([])
    for (let i = 1; i <= 5; i++) await repo.recordAttempt({ sessionId: 's', questionId: `number-1-0${i}`, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
    expect((await repo.getSkillStates()).number.difficulty).toBe(2)
    expect(await repo.syncTricks()).toEqual(['count'])
    expect((await repo.db.pets.get('pet'))?.tricks).toEqual(['count'])
    expect((await repo.getSettings())?.pendingTricks).toEqual(['count'])
    expect(await repo.syncTricks()).toEqual([]) // 已經學會，不會再來一次
    expect(await repo.popPendingTrick()).toBe('count')
    expect(await repo.popPendingTrick()).toBeNull()
  })
  it('通關第一章 → 翻筋斗', async () => {
    for (let s = 1; s <= 5; s++) {
      await playStation(s, `st${s}`, true, T0 + s * 1000)
      expect((await repo.completeStation({ chapterId: 'huaguoshan', station: s, sessionId: `st${s}` }, T0 + s * 1000)).ok).toBe(true)
    }
    const fresh = await repo.syncTricks()
    expect(fresh).toContain('flip')
    // 5 站每站都有一個掉落
    expect(await repo.getPendingGifts()).toHaveLength(5)
  })
})

describe('圖鑑收錄', () => {
  it('答過的題目裡的物件自動收錄；沒答過的不算', async () => {
    expect((await repo.knownFriends()).size).toBe(0)
    const q = QUESTIONS.find((x) => x.skill === 'number')!
    await repo.recordAttempt({ sessionId: 's', questionId: q.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    expect([...(await repo.knownFriends())].sort()).toEqual(objectsInQuestion(q).sort())
  })
  it('每收集滿 6 個送 1 份禮物，補發、不重複', async () => {
    // 逐題作答，直到收錄 >= 6 個
    let known = 0
    let i = 0
    for (const q of QUESTIONS) {
      await repo.recordAttempt({ sessionId: `s${i++}`, questionId: q.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
      known = (await repo.knownFriends()).size
      if (known >= 6) break
    }
    expect(known).toBeGreaterThanOrEqual(6)
    expect(await repo.syncCollection(T0)).toBe(1)
    const g = await repo.getPendingGifts()
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ from: 'collection' })
    expect(await qty(g[0].foodId!)).toBe(1)
    expect(await repo.syncCollection(T0)).toBe(0) // 同一批不重複給
    expect((await repo.getSettings())?.collectionRewarded).toBe(1)
    // 全部答完：最多 floor(總數/6) 份
    for (const q of QUESTIONS) await repo.recordAttempt({ sessionId: 'all', questionId: q.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + 99999)
    await repo.syncCollection(T0)
    const total = (await repo.knownFriends()).size
    expect(total).toBeLessThanOrEqual(FRIENDS.length)
    expect((await repo.getSettings())?.collectionRewarded).toBe(Math.floor(total / 6))
    expect((await repo.getPendingGifts()).length).toBe(Math.floor(total / 6))
  })
})
