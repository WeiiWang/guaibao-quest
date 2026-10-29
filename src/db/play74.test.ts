import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { QUESTIONS } from '../learning/bank'
import { objectsInQuestion } from '../domain/friends'
import { dotsItemId } from '../art/dots/dots'
import { allGiftItemIds, giftItemId, GUEST_FOODS, WISHES } from '../domain/play74'
import { localDateStr } from '../domain/date'
import type { Attempt } from '../learning/types'

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime()
let n = 0
let repo: Repo

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`k74-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

/** 讓孩子依序「認識」這些朋友（每位各答一題） */
const know = async (ids: string[], at = T0 - 30 * DAY) => {
  const rows: Attempt[] = ids.map((id, i) => {
    const q = QUESTIONS.find((x) => objectsInQuestion(x).includes(id))
    if (!q) throw new Error(`題庫沒有題目出現 ${id}`)
    return { id: `a-${id}-${i}`, at: at + i * 1000, questionId: q.id, skill: q.skill, difficulty: q.difficulty, firstTryCorrect: true, hintsUsed: 0, durationMs: 1000, sessionId: 's' }
  })
  await repo.db.attempts.bulkPut(rows)
}
const owned = async (id: string) => (await repo.db.inventory.get(id))?.qty ?? 0
const setStage = async (stage: 'egg' | 'baby' | 'adult') => {
  const pet = (await repo.db.pets.get('pet'))!
  await repo.db.pets.put({ ...pet, stage })
}
const place = (itemId: string) => repo.db.placements.put({ itemId, x: 0.5, y: 0.8, z: 0, flipped: false, placedAt: T0 })

describe('v7.5 兔兔的願望回憶卡', () => {
  it('卡片的圖用兔兔的姿勢圖', async () => {
    const pet = (await repo.db.pets.get('pet'))!
    await repo.db.pets.put({ ...pet, stage: 'baby', species: 'rabbit', name: '兔兔' })
    await repo.syncWish()
    await place('decor-ball')
    expect((await repo.completeWish('w-ball', T0 + 1000))?.art).toBe('pet-rabbit-baby-dance')
  })
})

describe('K1 朋友來作客', () => {
  it('還不認識任何會來的朋友就沒有人來', async () => {
    expect(await repo.syncGuest(T0)).toBeNull()
    expect((await repo.db.settings.get('main'))?.play?.guest).toBeUndefined()
  })
  it('第一天：第一位認識的朋友來，留下一張新的畫（寫進背包），紀錄在 settings.play', async () => {
    await know(['obj-rabbit', 'obj-banana'])
    const g = await repo.syncGuest(T0)
    expect(g).toMatchObject({ date: localDateStr(T0), friendId: 'obj-rabbit', first: true })
    expect(g?.gift?.kind).toBe('coloring')
    expect(await owned(giftItemId(g!.gift!))).toBe(1)
    const play = (await repo.db.settings.get('main'))?.play
    expect(play?.guestVisited).toEqual(['obj-rabbit'])
    expect(play?.guestVisits).toBe(1)
    expect(play?.guestLog).toHaveLength(1)
  })
  it('同一天再進首頁還是同一位，不會再送一次禮物', async () => {
    await know(['obj-rabbit', 'obj-banana'])
    const a = await repo.syncGuest(T0)
    const b = await repo.syncGuest(T0 + 3 * 60 * 60 * 1000)
    expect(b).toEqual(a)
    expect((await repo.db.settings.get('main'))?.play?.guestVisits).toBe(1)
    const total = (await repo.db.inventory.toArray()).filter((v) => v.itemId.startsWith('coloring-')).reduce((s, v) => s + v.qty, 0)
    expect(total).toBe(1)
    // 當天又認識了新朋友：今天的訪客不變
    await know(['obj-star'], T0)
    expect((await repo.syncGuest(T0 + 1000))?.friendId).toBe('obj-rabbit')
  })
  it('隔天輪到第二位，禮物是下一種（著色、連連看輪流）', async () => {
    await know(['obj-rabbit', 'obj-banana', 'obj-star'])
    const a = await repo.syncGuest(T0)
    const b = await repo.syncGuest(T0 + DAY)
    const c = await repo.syncGuest(T0 + 2 * DAY)
    expect([a, b, c].map((x) => x?.friendId)).toEqual(['obj-rabbit', 'obj-banana', 'obj-star'])
    expect([a, b, c].map((x) => x?.gift?.kind)).toEqual(['coloring', 'dots', 'coloring'])
    expect(await owned(dotsItemId(b!.gift!.id))).toBe(1)
  })
  it('漏掉的日子不補：隔 5 天回來只來 1 位，順序不跳', async () => {
    await know(['obj-rabbit', 'obj-banana', 'obj-star', 'obj-flower'])
    expect((await repo.syncGuest(T0))?.friendId).toBe('obj-rabbit')
    expect((await repo.syncGuest(T0 + 6 * DAY))?.friendId).toBe('obj-banana')
    expect((await repo.db.settings.get('main'))?.play?.guestVisits).toBe(2)
    expect((await repo.syncGuest(T0 + 7 * DAY))?.friendId).toBe('obj-star')
  })
  it('後來才認識的朋友排在後面', async () => {
    await know(['obj-rabbit', 'obj-banana'])
    await repo.syncGuest(T0)
    await know(['obj-star'], T0 + 1000)
    expect((await repo.syncGuest(T0 + DAY))?.friendId).toBe('obj-banana')
    expect((await repo.syncGuest(T0 + 2 * DAY))?.friendId).toBe('obj-star')
  })
  it('孩子自己用星星買過的畫不會重複送', async () => {
    await know(['obj-rabbit'])
    await repo.db.inventory.put({ id: 'coloring-line-awu-banana', itemId: 'coloring-line-awu-banana', qty: 1 })
    const g = await repo.syncGuest(T0)
    expect(g?.gift?.id).not.toBe('line-awu-banana')
    expect(await owned('coloring-line-awu-banana')).toBe(1)
  })
  it('全部的畫都有了：第一次來的朋友改送食物（輪流，不送蛋糕）', async () => {
    await know(['obj-rabbit', 'obj-banana'])
    for (const id of allGiftItemIds('4-5')) await repo.db.inventory.put({ id, itemId: id, qty: 1 })
    const a = await repo.syncGuest(T0)
    const b = await repo.syncGuest(T0 + DAY)
    expect(a?.gift).toEqual({ kind: 'food', id: GUEST_FOODS[0] })
    expect(b?.gift).toEqual({ kind: 'food', id: GUEST_FOODS[1] })
    expect(await owned(GUEST_FOODS[0])).toBe(1)
  })
  it('朋友都來過了：回訪不再送禮物', async () => {
    await know(['obj-rabbit', 'obj-banana'])
    await repo.syncGuest(T0)
    await repo.syncGuest(T0 + DAY)
    const c = await repo.syncGuest(T0 + 2 * DAY)
    expect(c).toMatchObject({ friendId: 'obj-rabbit', first: false })
    expect(c?.gift).toBeUndefined()
    expect((await repo.db.settings.get('main'))?.play?.guestVisited).toEqual(['obj-rabbit', 'obj-banana'])
  })
  it('紀錄最多留 40 筆；markGuest 記下看過禮物與打過招呼', async () => {
    await know(['obj-rabbit'])
    await repo.syncGuest(T0)
    await repo.markGuest('seen')
    await repo.markGuest('greeted')
    expect((await repo.db.settings.get('main'))?.play?.guest).toMatchObject({ seen: true, greeted: true })
    for (let d = 1; d <= 45; d++) await repo.syncGuest(T0 + d * DAY)
    expect((await repo.db.settings.get('main'))?.play?.guestLog?.length).toBe(40)
  })
  it('舊存檔（沒有 play 欄位）直接可用', async () => {
    const s = (await repo.db.settings.get('main'))!
    expect(s.play).toBeUndefined()
    await know(['obj-rabbit'])
    expect((await repo.syncGuest(T0))?.friendId).toBe('obj-rabbit')
  })
})

describe('K2 阿悟的小願望', () => {
  it('蛋還沒孵出來不出願望；孵化後第一個願望出現', async () => {
    await setStage('egg')
    expect(await repo.syncWish()).toBeUndefined()
    await setStage('baby')
    expect(await repo.syncWish()).toBe('w-ball')
    expect((await repo.db.settings.get('main'))?.play?.wishActive).toBe('w-ball')
  })
  it('家具擺進房間才算實現：一次只有一個、送一張回憶卡（標「新」）、接著下一個', async () => {
    await setStage('baby')
    await repo.syncWish()
    expect(await repo.completeWish('w-ball', T0)).toBeNull() // 還沒擺
    await place('decor-ball')
    const card = await repo.completeWish('w-ball', T0 + 1000)
    expect(card).toMatchObject({ id: 'wish:w-ball', kind: 'wish', fresh: true, reward: 'decor-ball', at: T0 + 1000 })
    expect(card?.caption).toBe('小願望實現了：皮球！')
    const s = (await repo.db.settings.get('main'))!
    expect(s.album?.some((c) => c.id === 'wish:w-ball')).toBe(true)
    expect(s.play?.wishActive).toBe('w-plant')
    expect(s.play?.wishDone).toEqual(['w-ball'])
    expect(s.play?.wishLog).toEqual([{ id: 'w-ball', at: T0 + 1000 }])
    expect(card?.art).toBe('pet-baby-dance') // 舊存檔（猴子）維持原檔名
    // 重複完成同一個不會多一張卡
    expect(await repo.completeWish('w-ball', T0 + 2000)).toBeNull()
    expect((await repo.db.settings.get('main'))?.album?.filter((c) => c.kind === 'wish')).toHaveLength(1)
  })
  it('出現之前就已經擺好的家具：直接略過，不送卡', async () => {
    await setStage('adult')
    await place('decor-ball')
    await place('decor-plant')
    expect(await repo.syncWish()).toBe('w-clock')
    const s = (await repo.db.settings.get('main'))!
    expect(s.play?.wishDone).toEqual(['w-ball', 'w-plant'])
    expect(s.album?.some((c) => c.kind === 'wish')).toBeFalsy()
  })
  it('完成一個願望後，下一個的家具如果早就擺好也略過', async () => {
    await setStage('baby')
    await repo.syncWish()
    await place('decor-ball')
    await place('decor-plant')
    await repo.completeWish('w-ball', T0)
    expect((await repo.db.settings.get('main'))?.play?.wishActive).toBe('w-clock')
  })
  it('不限時：隔了很多天願望還是同一個，沒有任何損失', async () => {
    await setStage('baby')
    expect(await repo.syncWish()).toBe('w-ball')
    expect(await repo.syncWish()).toBe('w-ball')
    expect((await repo.db.settings.get('main'))?.play?.wishDone ?? []).toEqual([])
  })
  it('套裝願望只有 6–7 歲：單一願望都做完之後出現，要全部擺好才實現', async () => {
    await repo.db.settings.update('main', { ageBand: '6-7' })
    await setStage('adult')
    for (const w of WISHES.filter((x) => !x.set)) await place(w.items[0])
    expect(await repo.syncWish()).toBe('w-camp')
    await place('decor-tent')
    await place('decor-lamp')
    expect(await repo.completeWish('w-camp', T0)).toBeNull()
    await place('decor-rug')
    const card = await repo.completeWish('w-camp', T0)
    expect(card?.caption).toBe('小願望實現了：露營組！')
    expect((await repo.db.settings.get('main'))?.play?.wishActive).toBe('w-party')
  })
  it('4–5 歲單一願望都做完就沒有下一個願望', async () => {
    await repo.db.settings.update('main', { ageBand: '4-5' })
    await setStage('adult')
    for (const w of WISHES.filter((x) => !x.set)) await place(w.items[0])
    expect(await repo.syncWish()).toBeUndefined()
  })
  it('markWishSaid 只記一次', async () => {
    await setStage('baby')
    await repo.syncWish()
    await repo.markWishSaid('w-ball')
    expect((await repo.db.settings.get('main'))?.play?.wishSaid).toBe('w-ball')
  })
})
