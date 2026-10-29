import { describe, expect, it } from 'vitest'
import { FOOD_IDS } from './constants'
import { favoriteFoodOf } from './favorite'
import { collectionStep, FRIEND_TABS, familiarityOf, friendCount, friendStats, answerFriendOf } from './friends'
import { FRIENDS, objectsInQuestion } from './friends'
import { DAILY_ROTATION, DROP_FOODS, GIFT_STICKERS, collectionRewardsDue, dailyGiftAt, dropFoodAt, dropFoodOrder, dropFoods, giftKind, groupFoods, nextGiftSticker } from './gifts'
import { GIFT_COLLECT_LINE, GIFT_DAILY_LINE, TIME_WARN_LINE, giftFoodLine, giftLine } from './giftLines'
import { TRICKS, learnLine, earnedTricks, newTricks, pickTrick, skillMilestone } from './tricks'
import { makeRng } from '../learning/rng'
import { staticLineList } from '../learning/lines'
import { QUESTIONS } from '../learning/bank'

const DATE = '2026-10-27'

describe('學習掉落食物（固定輪替，不靠亂數）', () => {
  it('同一天同一個序號永遠掉同一種：今天最愛的先掉，之後依清單順序輪下去，不掉蛋糕', () => {
    const fav = favoriteFoodOf(DATE)
    const order = dropFoodOrder(DATE)
    expect(order).toHaveLength(DROP_FOODS.length)
    expect([...order].sort()).toEqual([...DROP_FOODS].sort())
    if (DROP_FOODS.includes(fav)) expect(order[0]).toBe(fav)
    for (let n = 0; n < 40; n++) {
      expect(dropFoodAt(DATE, n)).toBe(dropFoodAt(DATE, n))
      expect(DROP_FOODS).toContain(dropFoodAt(DATE, n))
      expect(dropFoodAt(DATE, n)).not.toBe('cake')
    }
    // 連續掉的食物依清單順序（接在最愛後面）
    const at = DROP_FOODS.indexOf(order[0])
    for (let k = 0; k < order.length; k++) expect(order[k]).toBe(DROP_FOODS[(at + k) % DROP_FOODS.length])
    expect(dropFoodAt(DATE, DROP_FOODS.length)).toBe(order[0]) // 輪一圈回到最愛
  })
  it('一次掉 2 個 = 連續兩個序號；兩段拆開掉結果一樣（序號接續）', () => {
    expect(dropFoods(DATE, 0, 2)).toEqual([dropFoodAt(DATE, 0), dropFoodAt(DATE, 1)])
    expect([...dropFoods(DATE, 0, 3), ...dropFoods(DATE, 3, 2)]).toEqual(dropFoods(DATE, 0, 5))
    expect(dropFoods(DATE, 4, 0)).toEqual([])
  })
  it('每一種不是蛋糕的食物都會輪到（可以湊齊）；每天的起點是當天最愛，不同日期起點會變', () => {
    const seen = new Set(dropFoods(DATE, 0, DROP_FOODS.length))
    expect([...seen].sort()).toEqual(FOOD_IDS.filter((f) => f !== 'cake').sort())
    const firsts = new Set(Array.from({ length: 30 }, (_, i) => dropFoodAt(`2026-11-${String(i + 1).padStart(2, '0')}`, 0)))
    expect(firsts.size).toBeGreaterThan(3)
  })
  it('最愛是蛋糕的日子：從清單第一個開始，一樣不掉蛋糕', () => {
    let found = ''
    for (let m = 1; m <= 12 && !found; m++) for (let d = 1; d <= 28 && !found; d++) {
      const date = `2027-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (favoriteFoodOf(date) === 'cake') found = date
    }
    expect(found, '一年裡總會有最愛是蛋糕的日子').not.toBe('')
    expect(dropFoodAt(found, 0)).toBe(DROP_FOODS[0])
    expect(dropFoods(found, 0, 20)).not.toContain('cake')
  })
})

describe('結算的食物合併（H4）', () => {
  it('同一種合併成一組、保留第一次出現的順序；不同的各一組', () => {
    expect(groupFoods(['apple', 'apple'])).toEqual([{ id: 'apple', n: 2 }])
    expect(groupFoods(['apple', 'banana', 'apple'])).toEqual([{ id: 'apple', n: 2 }, { id: 'banana', n: 1 }])
    expect(groupFoods(['carrot'])).toEqual([{ id: 'carrot', n: 1 }])
    expect(groupFoods([])).toEqual([])
  })
})

describe('今日小禮物（固定輪替：食物、材料、食物、貼紙）', () => {
  it('種類依序輪替，4 份一輪；沒有機率', () => {
    expect(DAILY_ROTATION).toEqual(['food', 'material', 'food', 'sticker'])
    const kinds = Array.from({ length: 12 }, (_, n) => giftKind(dailyGiftAt(n, DATE, 1, [])))
    expect(kinds).toEqual(['food', 'material', 'food', 'sticker', 'food', 'material', 'food', 'sticker', 'food', 'material', 'food', 'sticker'])
    // 純函式：同樣輸入同樣結果
    for (let n = 0; n < 12; n++) expect(dailyGiftAt(n, DATE, 1, [])).toEqual(dailyGiftAt(n, DATE, 1, []))
  })
  it('食物是今天掉落順序的第一個（不是蛋糕）；一律標記 daily', () => {
    for (const n of [0, 2, 4, 6]) {
      const g = dailyGiftAt(n, DATE, 7)
      expect(g).toEqual({ foodId: dropFoodAt(DATE, 0), at: 7, from: 'daily' })
      expect(g.foodId).not.toBe('cake')
    }
  })
  it('材料每一輪換一種（木、石、花），一次 2 個', () => {
    const mats = [1, 5, 9, 13].map((n) => dailyGiftAt(n, DATE, 1))
    for (const g of mats) expect(g).toMatchObject({ qty: 2, from: 'daily' })
    expect(mats.map((g) => g.materialId)).toEqual(['wood', 'stone', 'flower', 'wood'])
  })
  it('貼紙依固定順序送、不重複；送完改送食物', () => {
    const owned: string[] = []
    const got: string[] = []
    for (let round = 0; round < GIFT_STICKERS.length; round++) {
      const g = dailyGiftAt(round * 4 + 3, DATE, 1, owned)
      expect(g.stickerId, `第 ${round + 1} 張貼紙`).toBe(GIFT_STICKERS[round])
      owned.push(g.stickerId!)
      got.push(g.stickerId!)
    }
    expect(new Set(got).size).toBe(GIFT_STICKERS.length)
    const after = dailyGiftAt(GIFT_STICKERS.length * 4 + 3, DATE, 1, owned)
    expect(after.stickerId).toBeUndefined()
    expect(after.foodId).toBe(dropFoodAt(DATE, 0))
    // 已經有的貼紙（例如朋友圖鑑送的）會被跳過，不會重複送
    expect(dailyGiftAt(3, DATE, 1, [GIFT_STICKERS[0], GIFT_STICKERS[1]]).stickerId).toBe(GIFT_STICKERS[2])
    expect(nextGiftSticker([])).toBe(GIFT_STICKERS[0])
    expect(nextGiftSticker([...GIFT_STICKERS])).toBeNull()
  })
  it('貼紙清單：沒有重複，全部都是貼紙盤裡的貼紙', async () => {
    const { STICKERS } = await import('../ui/screens/coloring/stickers')
    expect(new Set(GIFT_STICKERS).size).toBe(GIFT_STICKERS.length)
    const tray = new Set(STICKERS.map((x) => x.art))
    for (const id of GIFT_STICKERS) expect(tray.has(id), id).toBe(true)
  })
  it('貼紙禮物不含線 I 預設開放的 8 張（孩子本來就有的不能當禮物）', () => {
    for (const art of ['pet-adult-happy', 'obj-banana', 'obj-apple', 'obj-peach', 'obj-grape', 'food-cake', 'decor-rocket', 'decor-dino']) expect(GIFT_STICKERS, art).not.toContain(art)
    expect(GIFT_STICKERS).toHaveLength(10)
  })
  it('壞掉的序號（負數、小數）也安全', () => {
    expect(giftKind(dailyGiftAt(-3, DATE, 1, []))).toBe('food')
    expect(giftKind(dailyGiftAt(1.7, DATE, 1, []))).toBe('material')
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
