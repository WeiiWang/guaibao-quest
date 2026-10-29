import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { FOOD_IDS } from '../domain/constants'
import { localDateStr } from '../domain/date'
import { favoriteFoodOf } from '../domain/favorite'
import { dropFoods, GIFT_STICKERS } from '../domain/gifts'
import { collectionStep, FRIENDS } from '../domain/friends'
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
  it('v7：過一站食物直接進背包、不再排進 pendingGifts；答對 >= 4 題 2 個；回傳 foods', async () => {
    await playStation(1, 's1')
    const before = await Promise.all(FOOD_IDS.map(qty))
    const r = await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 's1' }, T0)
    expect(r).toMatchObject({ ok: true, material: 'wood', chapterDone: false })
    expect(Object.keys(r).sort()).toEqual(['chapterDone', 'foods', 'independent', 'material', 'newlyMastered', 'ok', 'qty', 'total'])
    if (!r.ok) return
    expect(r.independent).toBe(5)
    expect(r.foods).toHaveLength(2)
    for (const f of r.foods) {
      expect(FOOD_IDS).toContain(f)
      expect(f).not.toBe('cake')
    }
    expect(await repo.getPendingGifts()).toEqual([])
    const after = await Promise.all(FOOD_IDS.map(qty))
    expect(after.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0)).toBe(2)
  })
  it('個數是固定規則不是機率：答對 >= 4 題 2 個，其他 1 個（含 0 題）', async () => {
    const { stationFoodQty } = await import('../learning/scoring')
    expect([0, 1, 2, 3, 4, 5].map(stationFoodQty)).toEqual([1, 1, 1, 1, 2, 2])
    await playStation(1, 'w1', false)
    const r = await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 'w1' }, T0)
    expect(r.ok && r.independent).toBe(0)
    expect(r.ok && r.foods.length).toBe(1)
    expect(await repo.getPendingGifts()).toEqual([])
  })
  it('同一個 session 重複領不會多掉；同樣的答案 → 同樣的食物（固定輪替）', async () => {
    await playStation(1, 's1')
    const first = await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 's1' }, T0)
    const again = await repo.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 's1' }, T0)
    expect(again.ok).toBe(false)
    const r2 = makeRepo(makeRng(1))
    await r2.onboard({ pin: '1234', childName: 'x', petName: '' }, T0)
    const plan = await r2.planStation(0, T0, makeRng(32))
    for (const [i, p] of plan.entries()) await r2.recordAttempt({ sessionId: 's1', questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
    const second = await r2.completeStation({ chapterId: 'huaguoshan', station: 1, sessionId: 's1' }, T0)
    expect(second.ok && first.ok && second.foods).toEqual(first.ok ? first.foods : [])
  })
  it('食物種類固定輪替：今天第 1 個掉最愛的，之後依清單順序，序號跨站接續；隔天從新的最愛開始', async () => {
    const { grantStationFoods } = await import('./meta')
    const date = localDateStr(T0)
    const g0 = await grantStationFoods(repo.db, T0, 5) // 2 個
    const g1 = await grantStationFoods(repo.db, T0, 0) // 1 個，接著第 3 個
    expect(g0).toEqual(dropFoods(date, 0, 2))
    expect(g1).toEqual(dropFoods(date, 2, 1))
    expect((await repo.getSettings())?.foodDrop).toEqual({ date, n: 3 })
    const next = await grantStationFoods(repo.db, T0 + DAY, 0)
    expect(next).toEqual(dropFoods(localDateStr(T0 + DAY), 0, 1))
    expect((await repo.getSettings())?.foodDrop).toEqual({ date: localDateStr(T0 + DAY), n: 1 })
    expect(favoriteFoodOf(date)).toBeTruthy()
  })
  it('重玩固定掉 1 個食物，不看答對幾題', async () => {
    const { grantStationFoods } = await import('./meta')
    expect(await grantStationFoods(repo.db, T0, 5, 1)).toHaveLength(1)
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
  it('食物進背包、材料進材料帳、貼紙記錄在 settings.stickers；種類固定輪替（食物、材料、食物、貼紙）', async () => {
    await guideDone()
    const kinds: string[] = []
    const stickers: string[] = []
    for (let i = 1; i <= 24; i++) {
      const g = await repo.grantDailyGift(T0 + i * DAY)
      if (g?.foodId) {
        kinds.push('food')
        expect(await qty(g.foodId)).toBeGreaterThan(0)
      } else if (g?.materialId) {
        kinds.push('material')
        expect((await repo.materialBalance())[g.materialId]).toBeGreaterThanOrEqual(2)
      } else if (g?.stickerId) {
        kinds.push('sticker')
        stickers.push(g.stickerId)
        expect((await repo.getSettings())?.stickers).toContain(g.stickerId)
      }
    }
    expect(kinds).toEqual(Array.from({ length: 24 }, (_, n) => ['food', 'material', 'food', 'sticker'][n % 4]))
    expect(stickers).toEqual(GIFT_STICKERS.slice(0, 6)) // 順序固定、不重複
    expect((await repo.getSettings())?.dailyGiftSeq).toBe(24)
  })
  it('貼紙已經有了（朋友圖鑑之類送的）就跳過；全部送完改送食物', async () => {
    await guideDone()
    await repo.db.settings.update('main', { stickers: [...GIFT_STICKERS.slice(0, 2)], dailyGiftSeq: 3 })
    const g = await repo.grantDailyGift(T0 + DAY)
    expect(g?.stickerId).toBe(GIFT_STICKERS[2])
    await repo.db.settings.update('main', { stickers: [...GIFT_STICKERS], dailyGiftSeq: 7 })
    const f = await repo.grantDailyGift(T0 + 2 * DAY)
    expect(f?.stickerId).toBeUndefined()
    expect(f?.foodId).toBeTruthy()
    expect((await repo.getSettings())?.stickers).toHaveLength(GIFT_STICKERS.length) // 不重複
  })
  it('舊存檔沒有 dailyGiftSeq：從第 1 份（食物）開始', async () => {
    await guideDone()
    await repo.db.settings.update('main', { lastGiftDate: '2000-01-01', dailyGiftSeq: undefined })
    expect((await repo.grantDailyGift(T0))?.foodId).toBeTruthy()
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
    // v7：站點掉落直接進背包，不排進 pendingGifts
    expect(await repo.getPendingGifts()).toHaveLength(0)
  })
})

describe('圖鑑收錄', () => {
  it('答過的題目裡的朋友自動收錄；沒答過的不算', async () => {
    expect((await repo.knownFriends()).size).toBe(0)
    const q = QUESTIONS.find((x) => x.skill === 'number')!
    await repo.recordAttempt({ sessionId: 's', questionId: q.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0)
    expect([...(await repo.knownFriends())].sort()).toEqual(objectsInQuestion(q).sort())
  })
  it('v7：英文、自然、生活題裡的朋友也收錄，並累計遇過與答對次數', async () => {
    const en = QUESTIONS.find((x) => x.skill === 'english' && x.type === 'hear')!
    const nat = QUESTIONS.find((x) => x.skill === 'nature' && x.type === 'natWeather')!
    for (const [i, q] of [en, nat].entries()) await repo.recordAttempt({ sessionId: `s${i}`, questionId: q.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
    const known = await repo.knownFriends()
    expect(known.has(`en:${en.params!.word}`)).toBe(true)
    expect([...known].some((id) => id.startsWith('nat-'))).toBe(true)
    const st = await repo.friendStats()
    expect(st[`en:${en.params!.word}`]).toEqual({ seen: 1, right: 1 })
    // 同一個英文字再答對兩次（不同題）→ 答對 3 次
    const more = QUESTIONS.filter((x) => x.skill === 'english' && x.params?.word === en.params!.word && x.id !== en.id).slice(0, 2)
    for (const [i, q] of more.entries()) await repo.recordAttempt({ sessionId: `m${i}`, questionId: q.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + 10 + i)
    expect((await repo.friendStats())[`en:${en.params!.word}`].right).toBe(1 + more.length)
  })
  it('每收集滿 N 個送 1 份禮物（N 依總數調整），補發、不重複；整個圖鑑至少 8 份', async () => {
    const step = collectionStep()
    let known = 0
    let i = 0
    for (const q of QUESTIONS) {
      await repo.recordAttempt({ sessionId: `s${i++}`, questionId: q.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
      known = (await repo.knownFriends()).size
      if (known >= step) break
    }
    expect(known).toBeGreaterThanOrEqual(step)
    const first = await repo.syncCollection(T0)
    expect(first).toBe(Math.floor(known / step))
    const g = await repo.getPendingGifts()
    expect(g).toHaveLength(first)
    expect(g[0]).toMatchObject({ from: 'collection' })
    expect(await repo.syncCollection(T0)).toBe(0) // 同一批不重複給
    for (const q of QUESTIONS) await repo.recordAttempt({ sessionId: 'all', questionId: q.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + 99999)
    await repo.syncCollection(T0)
    const total = (await repo.knownFriends()).size
    expect(total).toBeLessThanOrEqual(FRIENDS.length)
    expect((await repo.getSettings())?.collectionRewarded).toBe(Math.floor(total / step))
    expect(Math.floor(total / step)).toBeGreaterThanOrEqual(8)
  })
})
