import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FRIENDS } from './friends'
import { SHOP_ITEMS } from './constants'
import {
  advanceWish,
  canVisit,
  coloringGiftOrder,
  dotsGiftOrder,
  friendOrder,
  allGiftItemIds,
  giftItemId,
  giftName,
  GUEST_FOODS,
  GUEST_ROWS,
  guestArriveLine,
  guestWeekText,
  pickGuest,
  pickGuestGift,
  pickGuestSpot,
  placedBaseIds,
  WISHES,
  wishesFor,
  wishWeekText,
  type Rect,
} from './play74'
import { playLines } from '../learning/playLines'
import { DOTS_IDS, isDotsFree } from '../art/dots/dots'
import { DECOR_COSTS } from '../learning/materials'

describe('K1 誰會來作客', () => {
  it('動物、食物、東西、星星花貝殼會來；天氣、生活情境、英文單字卡不會來', () => {
    for (const id of ['obj-rabbit', 'obj-banana', 'decor-bed', 'obj-star', 'obj-flower', 'obj-shell', 'food-cake']) expect(canVisit(id), id).toBe(true)
    for (const f of FRIENDS.filter((x) => x.tab === 'life' || x.tab === 'english' || x.tab === 'nature').filter((x) => !x.id.startsWith('obj-'))) expect(canVisit(f.id), f.id).toBe(false)
    expect(canVisit('不存在')).toBe(false)
  })
  it('每一位會來的朋友都有 3D 圖檔（站在房間裡用）', () => {
    const list = FRIENDS.filter((f) => canVisit(f.id))
    expect(list.length).toBeGreaterThanOrEqual(25)
    for (const f of list) expect(existsSync(`public/art/${f.art}.png`), f.id).toBe(true)
  })
})

describe('K1 認識的順序', () => {
  const qs: Record<string, { items: { obj: string }[]; choices: { obj?: string; art?: string }[]; params?: Record<string, unknown> }> = {
    q1: { items: [], choices: [{ obj: 'obj-rabbit' }, { obj: 'obj-banana' }] },
    q2: { items: [{ obj: 'obj-banana' }], choices: [{ obj: 'obj-star' }] },
    q3: { items: [], choices: [{ art: 'life-wash-hands' }, { obj: 'decor-bed' }] },
  }
  const lookup = (id: string) => qs[id] as never
  it('依第一次遇到的先後排；重複的只算一次；不會來的朋友略過；找不到的題目略過', () => {
    const attempts = [
      { questionId: 'q2', at: 2000 },
      { questionId: 'q1', at: 1000 },
      { questionId: 'q3', at: 3000 },
      { questionId: 'gone', at: 500 },
    ]
    expect(friendOrder(attempts, lookup)).toEqual(['obj-rabbit', 'obj-banana', 'obj-star', 'decor-bed'])
  })
  it('同一時間的作答依原本順序（穩定）', () => {
    expect(friendOrder([{ questionId: 'q2', at: 1 }, { questionId: 'q1', at: 1 }], lookup)).toEqual(['obj-banana', 'obj-star', 'obj-rabbit'])
  })
})

describe('K1 今天輪到誰（每天最多 1 位、固定順序、不補）', () => {
  const order = ['a', 'b', 'c']
  it('第一個還沒來過的；來過的不再是「第一次」', () => {
    expect(pickGuest(order, [], 0)).toEqual({ friendId: 'a', first: true })
    expect(pickGuest(order, ['a'], 1)).toEqual({ friendId: 'b', first: true })
    expect(pickGuest(order, ['a', 'b'], 2)).toEqual({ friendId: 'c', first: true })
  })
  it('沒來的日子不補：隔幾天回來還是只輪到下一位', () => {
    // 不管隔了幾天，輪到的都只是「第一個還沒來過的」
    expect(pickGuest(order, ['a'], 1)).toEqual({ friendId: 'b', first: true })
  })
  it('後來才認識的朋友排在最後', () => {
    expect(pickGuest([...order, 'd'], ['a', 'b', 'c'], 3)).toEqual({ friendId: 'd', first: true })
  })
  it('全部來過就輪流回訪，不再是第一次；沒有朋友就沒有人來', () => {
    expect(pickGuest(order, ['a', 'b', 'c'], 3)).toEqual({ friendId: 'a', first: false })
    expect(pickGuest(order, ['a', 'b', 'c'], 4)).toEqual({ friendId: 'b', first: false })
    expect(pickGuest([], [], 0)).toBeNull()
  })
})

describe('K1 固定禮物', () => {
  it('著色頁與連連看輪流（偶數次著色頁、奇數次連連看）；連連看免費的前 3 張不送；清單裡每項只出現一次', () => {
    for (const age of ['3', '4-5', '6-7'] as const) {
      const ids = allGiftItemIds(age)
      expect(new Set(ids).size).toBe(ids.length)
      for (const g of dotsGiftOrder(age)) expect(isDotsFree(g.split(':')[1]), g).toBe(false)
    }
    expect(coloringGiftOrder()[0]).toBe('line-awu-banana')
    expect(pickGuestGift(new Set(), '4-5', 0).kind).toBe('coloring')
    expect(pickGuestGift(new Set(), '4-5', 1).kind).toBe('dots')
    expect(pickGuestGift(new Set(), '4-5', 2).kind).toBe('coloring')
  })
  it('連連看的難度順序依年齡：6–7 歲從中等開始，其餘從簡單開始', () => {
    expect(dotsGiftOrder('4-5')[0].endsWith(':e')).toBe(true)
    expect(dotsGiftOrder('6-7')[0].endsWith(':m')).toBe(true)
    expect(dotsGiftOrder('3').length).toBe((DOTS_IDS.length - 3) * 4)
  })
  it('送那一種裡第一個還沒有的；已經有的跳過（包含免費送的）；順序固定', () => {
    const free = new Set(['coloring-monkey', 'coloring-banana-tree', 'coloring-line-awu-banana', 'coloring-line-awu-bath'])
    const a = pickGuestGift(free, '4-5', 0)
    expect(a).toEqual({ kind: 'coloring', id: 'line-dino' })
    expect(pickGuestGift(free, '4-5', 0)).toEqual(a)
    const owned = new Set([...free, giftItemId(a)])
    const b = pickGuestGift(owned, '4-5', 1)
    expect(b.kind).toBe('dots')
    const c = pickGuestGift(new Set([...owned, giftItemId(b)]), '4-5', 2)
    expect(c.kind).toBe('coloring')
    expect(c.id).not.toBe(a.id)
    // 孩子自己用星星買了下一張：不會重複送
    expect(giftItemId(pickGuestGift(new Set([...owned, 'coloring-line-birthday-cake']), '4-5', 2))).not.toBe('coloring-line-birthday-cake')
  })
  it('一種送完了就送另一種', () => {
    const allColoring = new Set(coloringGiftOrder().map((id) => `coloring-${id}`))
    expect(pickGuestGift(allColoring, '4-5', 0).kind).toBe('dots')
    const allDots = new Set(dotsGiftOrder('4-5').map((id) => `coloring-${id}`))
    expect(pickGuestGift(allDots, '4-5', 1).kind).toBe('coloring')
  })
  it('全部都有了就改送食物，依次序輪流，不送蛋糕', () => {
    const all = new Set(allGiftItemIds('4-5'))
    const foods = [0, 1, 2, 3].map((n) => pickGuestGift(all, '4-5', n))
    expect(foods.every((g) => g.kind === 'food')).toBe(true)
    expect(foods.map((g) => g.id)).toEqual(GUEST_FOODS.slice(0, 4))
    expect(GUEST_FOODS).not.toContain('cake')
    expect(giftName({ kind: 'food', id: 'apple' })).toBe('蘋果')
  })
  it('禮物名字：連連看帶「連連看：」', () => {
    expect(giftName({ kind: 'dots', id: 'dots:obj-fish:e' })).toBe('連連看：小魚')
    expect(giftName({ kind: 'coloring', id: 'monkey' })).toBe('小猴子')
  })
})

describe('K1 站的位置', () => {
  const base = { roomW: 2950, roomH: 555, petX: 885, petW: 175, guestW: 111, guestH: 111, viewLeft: 295, viewW: 1180, furniture: [] as Rect[], blocks: [] as Rect[] }
  const overlap = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  const rectOf = (s: { x: number; bottom: number; scale: number }): Rect => {
    const w = base.guestW * s.scale
    return { left: s.x - w / 2, right: s.x + w / 2, top: s.bottom - w, bottom: s.bottom }
  }
  const PET: Rect = { left: 885 - 87, right: 885 + 87, top: 0, bottom: 555 }
  it('沒有家具：站在阿悟旁邊、剛進房間看得到的範圍，不壓到阿悟，原大小、後排', () => {
    const s = pickGuestSpot(base)
    const r = rectOf(s)
    expect(r.left).toBeGreaterThanOrEqual(base.viewLeft)
    expect(r.right).toBeLessThanOrEqual(base.viewLeft + base.viewW)
    expect(overlap(r, PET)).toBe(false)
    expect(s.bottom).toBe(GUEST_ROWS[0] * base.roomH)
    expect(s.scale).toBe(1)
  })
  it('家具、按鈕佔住的位置不站；一格一格往外找', () => {
    const furniture: Rect[] = [{ left: 960, right: 1400, top: 200, bottom: 520 }]
    const blocks: Rect[] = [{ left: 600, right: 700, top: 300, bottom: 500 }]
    const s = pickGuestSpot({ ...base, furniture, blocks })
    expect([...furniture, ...blocks].every((b) => !overlap(rectOf(s), b))).toBe(true)
    expect(overlap(rectOf(s), PET)).toBe(false)
  })
  it('後排被擋住就站前排', () => {
    // 阿悟兩側的後排都被擋住，只剩前排
    const furniture: Rect[] = [{ left: 0, right: 4000, top: 300, bottom: 390 }]
    const s = pickGuestSpot({ ...base, furniture })
    expect(s.bottom).toBe(GUEST_ROWS[1] * base.roomH)
  })
  it('空位不夠就縮小（不小於 56px）', () => {
    // 阿悟右邊只剩 96px 寬、左邊被按鈕擋住：原大小（111）放不下，縮小後放得下
    const blocks: Rect[] = [{ left: 0, right: 797, top: 0, bottom: 555 }, { left: 1080, right: 4000, top: 0, bottom: 555 }]
    const s = pickGuestSpot({ ...base, blocks })
    expect(s.scale).toBeLessThan(1)
    expect(base.guestW * s.scale).toBeGreaterThanOrEqual(56)
    expect(rectOf(s).left).toBeGreaterThanOrEqual(base.viewLeft)
    expect(blocks.every((b) => !overlap(rectOf(s), b))).toBe(true)
  })
  it('房間被家具塞滿：仍然站在看得到的範圍，壓到家具最少，但不壓阿悟與按鈕', () => {
    const furniture: Rect[] = [{ left: 295, right: 1475, top: 200, bottom: 555 }]
    const blocks: Rect[] = [{ left: 1300, right: 1475, top: 300, bottom: 400 }]
    const s = pickGuestSpot({ ...base, furniture, blocks })
    const r = rectOf(s)
    expect(r.left).toBeGreaterThanOrEqual(base.viewLeft)
    expect(r.right).toBeLessThanOrEqual(base.viewLeft + base.viewW)
    expect(overlap(r, PET)).toBe(false)
    expect(overlap(r, blocks[0])).toBe(false)
  })
  it('看得到的範圍被按鈕與阿悟佔滿：才去整個房間找位置', () => {
    const s = pickGuestSpot({ ...base, blocks: [{ left: 295, right: 1475, top: 0, bottom: 555 }] })
    const r = rectOf(s)
    expect(r.right <= 295 || r.left >= 1475).toBe(true)
  })
  it('決定性：同樣的輸入同樣的位置', () => {
    const furniture: Rect[] = [{ left: 1000, right: 1100, top: 300, bottom: 500 }]
    expect(pickGuestSpot({ ...base, furniture })).toEqual(pickGuestSpot({ ...base, furniture }))
  })
})

describe('K2 阿悟的小願望', () => {
  it('順序固定、id 不重複；每件家具都在商店目錄裡而且有材料成本（做得出來）', () => {
    expect(new Set(WISHES.map((w) => w.id)).size).toBe(WISHES.length)
    for (const w of WISHES) for (const id of w.items) {
      expect(SHOP_ITEMS.some((i) => i.id === id && i.kind === 'decor'), id).toBe(true)
      expect(DECOR_COSTS[id], id).toBeTruthy()
    }
  })
  it('單一願望 12 個；套裝 3 個（2–3 件），而且套裝的家具和單一願望不重複', () => {
    const singles = WISHES.filter((w) => !w.set)
    const sets = WISHES.filter((w) => w.set)
    expect(singles).toHaveLength(12)
    expect(sets.length).toBeGreaterThanOrEqual(3)
    for (const s of sets) expect(s.items.length).toBeGreaterThanOrEqual(2)
    const single = new Set(singles.flatMap((w) => w.items))
    for (const s of sets) for (const id of s.items) expect(single.has(id), id).toBe(false)
    // 套裝排在單一願望之後
    expect(WISHES.findIndex((w) => w.set)).toBe(singles.length)
  })
  it('前面的願望材料少（第一個願望 3 個材料以內）', () => {
    const total = (id: string) => Object.values(DECOR_COSTS[id]).reduce((a, b) => a + b, 0)
    expect(total(WISHES[0].items[0])).toBeLessThanOrEqual(3)
  })
  it('套裝只有 6–7 歲看得到', () => {
    expect(wishesFor('3').every((w) => !w.set)).toBe(true)
    expect(wishesFor('4-5').every((w) => !w.set)).toBe(true)
    expect(wishesFor('6-7').some((w) => w.set)).toBe(true)
  })
  it('placedBaseIds：第 2、3 個（~2）也算', () => {
    expect([...placedBaseIds(['decor-bed', 'decor-ball~2'])].sort()).toEqual(['decor-ball', 'decor-bed'])
  })
  it('advanceWish：從頭開始，第一個願望出現', () => {
    expect(advanceWish({ done: [] }, new Set(), '4-5')).toEqual({ done: [], active: 'w-ball' })
  })
  it('出現之前就已經擺好的直接略過，不演也不留紀錄；擺好的在前面幾個就一路略過', () => {
    const r = advanceWish({ done: [] }, new Set(['decor-ball', 'decor-plant']), '4-5')
    expect(r).toEqual({ done: ['w-ball', 'w-plant'], active: 'w-clock' })
  })
  it('已經出現過（active）的願望：就算擺好了也停在它（要由畫面演出實現）', () => {
    const r = advanceWish({ done: [], active: 'w-ball' }, new Set(['decor-ball']), '4-5')
    expect(r).toEqual({ done: [], active: 'w-ball' })
  })
  it('單一願望都結束後：6–7 歲接套裝，其他年齡沒有願望；套裝要全部擺好才算', () => {
    const singles = WISHES.filter((w) => !w.set).map((w) => w.id)
    expect(advanceWish({ done: singles }, new Set(), '4-5')).toEqual({ done: singles })
    expect(advanceWish({ done: singles }, new Set(), '6-7')).toEqual({ done: singles, active: 'w-camp' })
    // 套裝擺了兩件還不算，而且它已經出現過，所以停在它
    expect(advanceWish({ done: singles, active: 'w-camp' }, new Set(['decor-tent', 'decor-lamp']), '6-7').active).toBe('w-camp')
    // 3 件都在、但還沒出現過 = 略過
    expect(advanceWish({ done: singles }, new Set(['decor-tent', 'decor-lamp', 'decor-rug']), '6-7').active).toBe('w-party')
  })
  it('全部做完沒有下一個', () => {
    const all = WISHES.map((w) => w.id)
    expect(advanceWish({ done: all }, new Set(), '6-7')).toEqual({ done: all })
  })
})

describe('會唸的句子', () => {
  const lines = playLines()
  it('每位會來的朋友有 作客、送畫、送食物、名字 四句；每個願望有 願望、實現、回憶卡 三句', () => {
    for (const f of FRIENDS.filter((x) => canVisit(x.id))) {
      for (const k of ['arrive', 'page', 'food', 'name']) expect(lines[`play.guest.${k}.${f.id}`], `${k} ${f.id}`).toBeTruthy()
    }
    for (const w of WISHES) {
      expect(lines[`pet.wish.${w.id}`]).toBe(w.line)
      expect(lines[`pet.wish.done.${w.id}`]).toBe(w.doneLine)
      expect(lines[`play.wish.card.${w.id}`]).toBe(w.caption)
    }
  })
  it('句型和畫面呼叫的完全一致（畫面用 sayText(原文) 找音檔）', () => {
    expect(guestArriveLine('小兔子')).toBe('今天小兔子來玩囉！')
    expect(lines['play.guest.arrive.obj-rabbit']).toBe('今天小兔子來玩囉！')
    expect(lines['play.guest.page.obj-rabbit']).toBe('小兔子送你一張新的畫！')
    expect(lines['play.guest.food.obj-rabbit']).toBe('小兔子送你好吃的！')
  })
  it('阿悟說的話 key 用 pet. 開頭；每句都不是空的', () => {
    expect(Object.keys(lines).filter((k) => k.startsWith('pet.')).length).toBe(WISHES.length * 2)
    for (const t of Object.values(lines)) expect(t.length).toBeGreaterThan(0)
  })
})

describe('家長區「本週」的一行字', () => {
  const days = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']
  it('這週來作客的朋友與收到的新玩意', () => {
    const t = guestWeekText(
      [
        { date: '2026-10-20', friendId: 'obj-star' },
        { date: '2026-10-28', friendId: 'obj-rabbit', gift: { kind: 'coloring', id: 'line-awu-banana' } },
        { date: '2026-10-29', friendId: 'obj-banana', gift: { kind: 'dots', id: 'dots:obj-fish:e' } },
      ],
      days,
    )
    expect(t).toContain('2 位')
    expect(t).toContain('小兔子')
    expect(t).toContain('阿悟抱香蕉')
    expect(t).toContain('連連看：小魚')
    expect(t).not.toContain('星星')
  })
  it('這週沒有人來也有一句白話', () => {
    expect(guestWeekText([], days)).toContain('還沒有朋友來作客')
  })
  it('這週實現的小願望與現在想要的家具', () => {
    const start = Date.parse('2026-10-23T00:00:00')
    const t = wishWeekText([{ id: 'w-ball', at: start + 1000 }, { id: 'w-bed', at: start - 1000 }], start, 'w-camp')
    expect(t).toContain('1 個小願望')
    expect(t).toContain('皮球')
    expect(t).not.toContain('小床')
    expect(t).toContain('帳篷')
    expect(wishWeekText([], start, undefined)).toContain('還沒有實現')
  })
})
