import { describe, expect, it } from 'vitest'
import { FOOD_IDS } from './constants'
import { favoriteFoodOf } from './favorite'
import { collectionStep, FRIEND_TABS, familiarityOf, friendCount, friendStats, answerFriendOf } from './friends'
import { FRIENDS, objectsInQuestion } from './friends'
import { FAVORITE_BOOST, collectionRewardsDue, dropWeights, giftKind, rollDailyGift, rollStationDrop, DROP_FOODS } from './gifts'
import { GIFT_COLLECT_LINE, GIFT_DAILY_LINE, TIME_WARN_LINE, giftFoodLine, giftLine } from './giftLines'
import { TRICKS, learnLine, earnedTricks, newTricks, pickTrick, skillMilestone } from './tricks'
import { makeRng } from '../learning/rng'
import { staticLineList } from '../learning/lines'
import { QUESTIONS } from '../learning/bank'

const DATE = '2026-10-27'

describe('學習掉落食物', () => {
  it('永遠掉得出東西、不掉蛋糕、只掉列表內的食物', () => {
    const rng = makeRng(1)
    for (let i = 0; i < 2000; i++) {
      const f = rollStationDrop(rng, DATE)
      expect(f).not.toBe('cake')
      expect(DROP_FOODS).toContain(f)
    }
  })
  it('今天最愛的食物機率比一般同價位的高（約 3 倍權重）', () => {
    const fav = favoriteFoodOf(DATE)
    const w = dropWeights(DATE)
    const wf = w.find((x) => x.id === fav)
    if (fav === 'cake') {
      expect(wf).toBeUndefined() // 最愛是蛋糕：沒有加權對象，也不會掉
      return
    }
    const base = dropWeights('1999-01-01').find((x) => x.id === fav)!.weight
    // 同一種食物，在「它是最愛」與「不是最愛」兩天的權重差 FAVORITE_BOOST 倍
    const days = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-28', '2026-10-29']
    const notFav = days.find((d) => favoriteFoodOf(d) !== fav)!
    expect(wf!.weight).toBe(dropWeights(notFav).find((x) => x.id === fav)!.weight * FAVORITE_BOOST)
    expect(base).toBeGreaterThan(0)
    // 實際抽樣：最愛的頻率高於「權重相同的一般食物」
    const rng = makeRng(7)
    const N = 30000
    const count: Record<string, number> = {}
    for (let i = 0; i < N; i++) {
      const f = rollStationDrop(rng, DATE)
      count[f] = (count[f] ?? 0) + 1
    }
    const total = w.reduce((s, x) => s + x.weight, 0)
    expect(count[fav] / N).toBeGreaterThan((wf!.weight / total) * 0.9)
    expect(count[fav] / N).toBeLessThan((wf!.weight / total) * 1.1)
    const sameBase = w.filter((x) => x.id !== fav && x.weight === wf!.weight / FAVORITE_BOOST)
    for (const o of sameBase) expect(count[fav]).toBeGreaterThan(count[o.id] * 2)
  })
  it('每一種不是蛋糕的食物都有機會掉（可以湊齊）', () => {
    const rng = makeRng(3)
    const seen = new Set<string>()
    for (let i = 0; i < 3000; i++) seen.add(rollStationDrop(rng, DATE))
    expect([...seen].sort()).toEqual(FOOD_IDS.filter((f) => f !== 'cake').sort())
  })
})

describe('今日小禮物', () => {
  it('食物 60%、材料 30%（任一種 2 個）、貼紙 10%', () => {
    const rng = makeRng(11)
    const N = 20000
    const k = { food: 0, material: 0, sticker: 0 }
    const mats = new Set<string>()
    for (let i = 0; i < N; i++) {
      const g = rollDailyGift(rng, DATE, 1)
      k[giftKind(g)]++
      expect(g.from).toBe('daily')
      if (g.materialId) {
        mats.add(g.materialId)
        expect(g.qty).toBe(2)
      }
      if (g.foodId) expect(g.foodId).not.toBe('cake')
    }
    expect(k.food / N).toBeGreaterThan(0.57)
    expect(k.food / N).toBeLessThan(0.63)
    expect(k.material / N).toBeGreaterThan(0.27)
    expect(k.material / N).toBeLessThan(0.33)
    expect(k.sticker / N).toBeGreaterThan(0.08)
    expect(k.sticker / N).toBeLessThan(0.12)
    expect(mats.size).toBe(3)
  })
})

describe('圖鑑', () => {
  it('每收集滿 N 個才算 1 份禮物，N 依總數調整，整個圖鑑至少 8 份', () => {
    expect([0, 5, 6, 11, 12, 15].map((k) => collectionRewardsDue(k, 6))).toEqual([0, 0, 1, 1, 2, 2])
    expect(collectionStep(15)).toBe(2)
    expect(collectionStep(98)).toBe(12)
    for (const total of [40, 64, 98, 130, 200]) expect(collectionRewardsDue(total, collectionStep(total)), `${total}`).toBeGreaterThanOrEqual(8)
    expect(collectionRewardsDue(friendCount(), collectionStep())).toBeGreaterThanOrEqual(8)
  })
  it('熟悉度三級：遇過 1 次認識、答對 3 次好朋友、答對 10 次超級好朋友', () => {
    expect([undefined, { seen: 0, right: 0 }, { seen: 1, right: 0 }, { seen: 5, right: 2 }, { seen: 5, right: 3 }, { seen: 20, right: 9 }, { seen: 20, right: 10 }].map(familiarityOf)).toEqual([0, 0, 1, 1, 2, 2, 3])
  })
  it('答對次數只算「問的就是這個朋友」且第一次就答對；遇過算所有出現的朋友', () => {
    const q1 = { id: 'q1', skill: 'number', items: [], choices: [{ id: 'obj-apple', obj: 'obj-apple' }, { id: 'obj-fish', obj: 'obj-fish' }], answer: 'obj-apple', params: {} }
    const qe = { id: 'qe', skill: 'english', items: [], choices: [{ id: 'red', swatch: '#f00' }], answer: 'red', params: { word: 'red' } }
    const m: Record<string, typeof q1 | typeof qe> = { q1, qe } as never
    expect(answerFriendOf(q1 as never)).toBe('obj-apple')
    expect(answerFriendOf(qe as never)).toBe('en:red')
    const st = friendStats(
      [
        { questionId: 'q1', firstTryCorrect: true },
        { questionId: 'q1', firstTryCorrect: false },
        { questionId: 'qe', firstTryCorrect: true },
        { questionId: 'gone', firstTryCorrect: true },
      ],
      (id) => m[id] as never,
    )
    expect(st['obj-apple']).toEqual({ seen: 2, right: 1 })
    expect(st['obj-fish']).toEqual({ seen: 2, right: 0 })
    expect(st['en:red']).toEqual({ seen: 1, right: 1 })
  })
  it('分頁：每個朋友都在某一頁；英文頁有全部英文單字', () => {
    const tabs = new Set(FRIEND_TABS.map((t) => t.id))
    for (const f of FRIENDS) expect(tabs.has(f.tab), f.id).toBe(true)
    expect(FRIENDS.filter((f) => f.tab === 'english').length).toBe(38)
    expect(new Set(FRIENDS.map((f) => f.id)).size).toBe(FRIENDS.length)
  })
  it('每個朋友都能在題庫的某一題裡遇到（沒有永遠收不到的格子）', () => {
    const seen = new Set<string>()
    for (const q of QUESTIONS) for (const id of objectsInQuestion(q)) seen.add(id)
    const missing = FRIENDS.filter((f) => !seen.has(f.id)).map((f) => f.id)
    expect(missing).toEqual([])
  })
  it('題目裡的物件（題幹、選項、籃子）都算遇過；不在物件表的略過', () => {
    const ids = objectsInQuestion({
      items: [{ obj: 'obj-banana', count: 3 }, { obj: null }],
      choices: [{ id: 'a', obj: 'obj-peach' }, { id: 'b', label: '3' }],
      params: { bins: [{ id: 'x', label: '水果', obj: 'obj-apple' }], obj: 'zzz-unknown' },
    })
    expect(ids.sort()).toEqual(['obj-apple', 'obj-banana', 'obj-peach'])
  })
  it('題庫的物件全部都在圖鑑裡（不會有收不到的格子、也沒有漏掉的物件）', () => {
    const all = new Set<string>()
    for (const q of QUESTIONS) for (const id of objectsInQuestion(q)) all.add(id)
    expect(all.size).toBeGreaterThan(5)
    for (const id of all) expect(FRIENDS.some((f) => f.id === id), id).toBe(true)
    expect(friendCount()).toBe(FRIENDS.length)
  })
})

describe('新招解鎖條件', () => {
  const st = (difficulty: 1 | 2 | 3 | 4, mastered: Record<number, object> = {}) => ({ difficulty, mastered: mastered as never })
  it('難度升級（高於起始難度）或首次 mastered 才算里程碑', () => {
    expect(skillMilestone(st(1), 1)).toBe(false)
    expect(skillMilestone(st(2), 1)).toBe(true)
    expect(skillMilestone(st(2), 2)).toBe(false) // 6–7 歲從難度 2 開始，沒升級就不算
    expect(skillMilestone(st(1, { 1: { masteredAt: 1, reviews: 0 } }), 1)).toBe(true)
    expect(skillMilestone(undefined, 1)).toBe(false)
  })
  it('數感 → 數香蕉、分類 → 整理房間、規律 → 節奏舞、英文 → 說 Hello、通關第一章 → 翻筋斗', () => {
    const base = { startDifficulty: 1 as const, clearedChapters: [] as string[] }
    expect(earnedTricks({ ...base, states: { number: st(2) } })).toEqual(['count'])
    expect(earnedTricks({ ...base, states: { classify: st(1, { 1: { masteredAt: 1, reviews: 0 } }) } })).toEqual(['tidy'])
    expect(earnedTricks({ ...base, states: { pattern: st(3) } })).toEqual(['rhythm'])
    expect(earnedTricks({ ...base, states: { english: st(2) } })).toEqual(['hello'])
    expect(earnedTricks({ ...base, states: {}, clearedChapters: ['huaguoshan'] })).toEqual(['flip'])
    expect(earnedTricks({ ...base, states: {}, clearedChapters: ['shuilian'] })).toEqual([])
    expect(earnedTricks({ ...base, states: {} })).toEqual([])
  })
  it('已經學會的不會再算新招', () => {
    const input = { startDifficulty: 1 as const, clearedChapters: [], states: { number: st(2), pattern: st(2) } }
    expect(newTricks(input, ['count'])).toEqual(['rhythm'])
    expect(newTricks(input, ['count', 'rhythm'])).toEqual([])
  })
  it('隨機表演：只挑已學會的、盡量不連續同一招、沒學會就不演', () => {
    const rng = makeRng(5)
    expect(pickTrick([], rng)).toBeNull()
    expect(pickTrick(['count'], rng, 'count')).toBe('count')
    for (let i = 0; i < 50; i++) expect(pickTrick(['count', 'flip'], rng, 'count')).toBe('flip')
    expect(pickTrick(['zzz'], rng)).toBeNull()
  })
})

describe('固定句型和 STATIC_LINES 一字不差（預錄的媽媽聲才找得到）', () => {
  const texts = new Set(staticLineList().map((l) => l.text))
  it('禮物：路上撿到的食物、今日小禮物、圖鑑獎勵', () => {
    for (const f of FOOD_IDS.filter((x) => x !== 'cake')) expect(texts.has(giftFoodLine(f)), f).toBe(true)
    expect(texts.has(GIFT_DAILY_LINE)).toBe(true)
    expect(texts.has(GIFT_COLLECT_LINE)).toBe(true)
    expect(giftLine({ foodId: 'apple', at: 1, from: 'station' })).toBe('我在路上撿到一顆蘋果，送給你！')
    expect(giftLine({ materialId: 'wood', qty: 2, at: 1, from: 'daily' })).toBe('今天的小禮物！')
  })
  it('新招慶祝句（預設名字阿悟）、時間提醒、圖鑑名字', () => {
    for (const t of TRICKS) expect(texts.has(learnLine('阿悟', t.name)), t.name).toBe(true)
    expect(texts.has(TIME_WARN_LINE)).toBe(true)
    for (const f of FRIENDS) expect(texts.has(f.name), f.name).toBe(true)
  })
})
