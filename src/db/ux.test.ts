// v4 線 U 的資料層：餵食防呆、購買退回、收回「我做完了」、免費著色頁、掛畫預設位置
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { DAILY_GROWTH_CAP, FREE_COLORING_PAGES, FULL_HUNGER, PURCHASE_UNDO_MS } from '../domain/constants'
import { balanceOf } from '../domain/points'
import { artworkSpot, PET_X, ROOM_WIDTH_FACTOR } from '../domain/room'
import { transition } from '../domain/tasks'

const T0 = new Date(2026, 9, 27, 10, 0, 0).getTime()
let n = 0
let repo: Repo

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`ux-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

const setHunger = (h: number) => repo.db.pets.update('pet', { hunger: h, hungerUpdatedAt: T0 })
const qty = async (id: string) => (await repo.db.inventory.get(id))?.qty ?? 0

describe('餵食（v7.3）：吃飽仍可餵，每日成長有上限', () => {
  it(`飽足 ≥ ${FULL_HUNGER}：照樣吃——食物照扣、成長 +1、飽足維持在上限、回 full: true`, async () => {
    await repo.db.inventory.put({ id: 'banana', itemId: 'banana', qty: 3 })
    await setHunger(FULL_HUNGER)
    const r = await repo.feedPet('banana', T0)
    expect(r).toMatchObject({ ok: true, full: true })
    expect(await qty('banana')).toBe(2)
    const pet = (await repo.db.pets.get('pet'))!
    expect(pet.feedCount).toBe(1)
    expect(pet.hunger).toBe(100)
  })
  it('飽足差一點（94）：照常吃，full: false', async () => {
    await repo.db.inventory.put({ id: 'banana', itemId: 'banana', qty: 3 })
    await setHunger(FULL_HUNGER - 1)
    expect(await repo.feedPet('banana', T0)).toMatchObject({ ok: true, full: false })
    expect(await qty('banana')).toBe(2)
  })
  it(`吃飽後蛋糕只算成長 +1；一天最多長 ${DAILY_GROWTH_CAP}，到了才拒絕（reason: capped）且食物不扣`, async () => {
    await repo.db.inventory.put({ id: 'cake', itemId: 'cake', qty: 30 })
    await setHunger(100)
    for (let i = 0; i < DAILY_GROWTH_CAP; i++) expect((await repo.feedPet('cake', T0 + i)).ok).toBe(true)
    expect(await qty('cake')).toBe(30 - DAILY_GROWTH_CAP)
    expect((await repo.db.pets.get('pet'))!.feedCount).toBe(DAILY_GROWTH_CAP)
    for (let i = 0; i < 4; i++) expect(await repo.feedPet('cake', T0 + 100 + i)).toMatchObject({ ok: false, reason: 'capped', error: '肚子撐撐的，明天再吃好不好？' })
    expect(await qty('cake')).toBe(30 - DAILY_GROWTH_CAP)
    expect((await repo.db.pets.get('pet'))!.feedCount).toBe(DAILY_GROWTH_CAP)
  })
  it('沒吃飽時一次吃桃子 / 蛋糕會多長（+2 / +3），最後一次只補到上限', async () => {
    await repo.db.inventory.put({ id: 'cake', itemId: 'cake', qty: 10 })
    await setHunger(0)
    for (let i = 0; i < 4; i++) {
      await setHunger(0)
      expect((await repo.feedPet('cake', T0 + i)).ok).toBe(true)
    }
    expect((await repo.db.pets.get('pet'))!.feedCount).toBe(DAILY_GROWTH_CAP) // 3+3+3+3
    await setHunger(0)
    expect((await repo.feedPet('cake', T0 + 9)).ok).toBe(false)
  })
  it('隔天上限歸零，又可以長；growth 欄位依本地日期', async () => {
    await repo.db.inventory.put({ id: 'banana', itemId: 'banana', qty: 40 })
    await setHunger(100)
    for (let i = 0; i < DAILY_GROWTH_CAP; i++) await repo.feedPet('banana', T0 + i)
    expect((await repo.feedPet('banana', T0 + 1000)).ok).toBe(false)
    const tomorrow = T0 + 24 * 60 * 60 * 1000
    const r = await repo.feedPet('banana', tomorrow)
    expect(r.ok).toBe(true)
    expect((await repo.db.pets.get('pet'))!.growth).toEqual({ date: '2026-10-28', n: 1 })
  })
  it('舊存檔（沒有 growth 欄位）照常餵', async () => {
    await repo.db.inventory.put({ id: 'banana', itemId: 'banana', qty: 3 })
    const pet = (await repo.db.pets.get('pet'))!
    delete pet.growth
    await repo.db.pets.put(pet)
    await setHunger(10)
    expect((await repo.feedPet('banana', T0)).ok).toBe(true)
  })
  it('餵蛋第 6 次孵化；既有存檔 feedCount 已經 ≥ 6 的蛋，syncGrowth 補孵化並新增「新」回憶卡，只做一次', async () => {
    await repo.db.pets.update('pet', { feedCount: 9, stage: 'egg' })
    const r = await repo.syncGrowth(T0)
    expect(r).toMatchObject({ evolvedTo: 'baby', from: 'egg' })
    expect((await repo.db.pets.get('pet'))!.stage).toBe('baby')
    const card = (await repo.getSettings())!.album?.find((c) => c.id === 'hatch')
    expect(card).toMatchObject({ kind: 'hatch', fresh: true })
    expect(await repo.syncGrowth(T0)).toBeNull()
  })
  it('既有幼體 feedCount 66–79：syncGrowth 長大成體；< 66 的幼體與蛋 < 6 不動', async () => {
    await repo.db.pets.update('pet', { feedCount: 70, stage: 'baby' })
    expect(await repo.syncGrowth(T0)).toMatchObject({ evolvedTo: 'adult', from: 'baby' })
    await repo.db.pets.update('pet', { feedCount: 40, stage: 'baby' })
    expect(await repo.syncGrowth(T0)).toBeNull()
    await repo.db.pets.update('pet', { feedCount: 5, stage: 'egg' })
    expect(await repo.syncGrowth(T0)).toBeNull()
  })
})

describe('購買退回（5 秒內）', () => {
  it('買 → 退回：星星與庫存回到買之前', async () => {
    await repo.grantBonus(50, 'x', T0)
    const before = balanceOf(await repo.db.ledger.toArray())
    const b = await repo.buyItem('banana', T0)
    if (!b.ok) throw new Error(b.error)
    expect(await qty('banana')).toBe(1)
    expect(await repo.balance()).toBe(before - 10)
    const u = await repo.undoPurchase(b.ledgerId, T0 + 3000)
    expect(u).toMatchObject({ ok: true, itemId: 'banana', refunded: 10 })
    expect(await qty('banana')).toBe(0)
    expect(await repo.balance()).toBe(before)
    // 流水帳沒有留下那筆購買
    expect((await repo.db.ledger.toArray()).some((e) => e.kind === 'purchase')).toBe(false)
  })
  it('同一筆只能退一次', async () => {
    await repo.grantBonus(50, 'x', T0)
    const b = await repo.buyItem('banana', T0)
    if (!b.ok) throw new Error(b.error)
    expect((await repo.undoPurchase(b.ledgerId, T0)).ok).toBe(true)
    const again = await repo.undoPurchase(b.ledgerId, T0)
    expect(again.ok).toBe(false)
    expect(await qty('banana')).toBe(0)
    expect(await repo.balance()).toBe(50)
  })
  it('超過時間不能退（星星與庫存都不動）', async () => {
    await repo.grantBonus(50, 'x', T0)
    const b = await repo.buyItem('banana', T0)
    if (!b.ok) throw new Error(b.error)
    const r = await repo.undoPurchase(b.ledgerId, T0 + PURCHASE_UNDO_MS + 5000)
    expect(r).toMatchObject({ ok: false, reason: 'expired' })
    expect(await qty('banana')).toBe(1)
    expect(await repo.balance()).toBe(40)
  })
  it('食物已經餵掉就不能退', async () => {
    await repo.grantBonus(50, 'x', T0)
    const b = await repo.buyItem('banana', T0)
    if (!b.ok) throw new Error(b.error)
    await setHunger(10)
    expect((await repo.feedPet('banana', T0)).ok).toBe(true)
    expect(await repo.undoPurchase(b.ledgerId, T0)).toMatchObject({ ok: false, reason: 'used' })
    expect(await repo.balance()).toBe(40)
  })
  it('買兩個、退回第二個：只扣一個、只還一筆', async () => {
    await repo.grantBonus(50, 'x', T0)
    await repo.buyItem('banana', T0)
    const b2 = await repo.buyItem('banana', T0 + 100)
    if (!b2.ok) throw new Error(b2.error)
    expect(await qty('banana')).toBe(2)
    expect((await repo.undoPurchase(b2.ledgerId, T0 + 200)).ok).toBe(true)
    expect(await qty('banana')).toBe(1)
    expect(await repo.balance()).toBe(40)
  })
  it('著色頁：退回後又可以再買（不是「已擁有」）', async () => {
    await repo.grantBonus(100, 'x', T0)
    const b = await repo.buyItem('coloring-clouds', T0)
    if (!b.ok) throw new Error(b.error)
    expect((await repo.buyItem('coloring-clouds', T0)).ok).toBe(false)
    expect((await repo.undoPurchase(b.ledgerId, T0)).ok).toBe(true)
    expect(await repo.balance()).toBe(100)
    expect((await repo.buyItem('coloring-clouds', T0)).ok).toBe(true)
  })
  it('不是購買紀錄的 id、不存在的 id 都退不了', async () => {
    const g = await repo.grantBonus(50, 'x', T0)
    expect(g.ok).toBe(true)
    const entry = (await repo.db.ledger.toArray())[0]
    expect((await repo.undoPurchase(entry.id, T0)).ok).toBe(false)
    expect((await repo.undoPurchase('nope', T0)).ok).toBe(false)
    expect(await repo.balance()).toBe(50)
  })
})

describe('收回「我做完了」', () => {
  it('狀態表：只有 pending 可以收回', () => {
    expect(transition('pending', 'withdraw')).toBe('todo')
    for (const s of ['todo', 'approved', 'rejected'] as const) expect(transition(s, 'withdraw')).toBeNull()
  })
  it('送出 → 收回 → 回到待辦、家長審核不到；可以再送', async () => {
    const inst = (await repo.db.instances.toArray())[0]
    await repo.submitTask(inst.id, T0)
    expect((await repo.withdrawTask(inst.id, T0)).ok).toBe(true)
    expect((await repo.db.instances.get(inst.id))!.status).toBe('todo')
    expect((await repo.reviewTask(inst.id, 'approve', T0)).ok).toBe(false)
    expect((await repo.submitTask(inst.id, T0)).ok).toBe(true)
  })
  it('已通過的不能收回，也不會動到點數', async () => {
    const inst = (await repo.db.instances.toArray())[0]
    await repo.submitTask(inst.id, T0)
    await repo.reviewTask(inst.id, 'approve', T0)
    const bal = await repo.balance()
    expect((await repo.withdrawTask(inst.id, T0)).ok).toBe(false)
    expect(await repo.balance()).toBe(bal)
  })
})

describe('免費著色頁', () => {
  it('送 2 張（小猴子、香蕉樹），只送一次', async () => {
    expect(await repo.grantFreeColoring()).toBe(true)
    for (const p of FREE_COLORING_PAGES) expect(await qty(`coloring-${p}`)).toBe(1)
    expect(FREE_COLORING_PAGES).toEqual(['monkey', 'banana-tree'])
    // 之後庫存被改掉也不再補
    await repo.db.inventory.put({ id: 'coloring-monkey', itemId: 'coloring-monkey', qty: 0 })
    expect(await repo.grantFreeColoring()).toBe(false)
    expect(await qty('coloring-monkey')).toBe(0)
  })
  it('已經買過的不會變成 2 份', async () => {
    await repo.seedShop()
    await repo.grantBonus(100, 'x', T0)
    await repo.buyItem('coloring-monkey', T0)
    await repo.grantFreeColoring()
    expect(await qty('coloring-monkey')).toBe(1)
  })
  it('送了之後商店裡這兩張顯示已擁有（不能重複買）', async () => {
    await repo.seedShop()
    await repo.grantFreeColoring()
    await repo.grantBonus(100, 'x', T0)
    expect((await repo.buyItem('coloring-monkey', T0)).ok).toBe(false)
    expect(await repo.balance()).toBe(100)
  })
})

describe('掛畫預設位置', () => {
  it('落在剛進房間時畫面的右半邊（避開左上角狀態卡）', () => {
    for (let i = 0; i < 8; i++) {
      const { x, y } = artworkSpot(i)
      const viewFrac = (x - PET_X) * ROOM_WIDTH_FACTOR + 0.5 // 換算回「畫面寬度的比例」
      expect(viewFrac).toBeGreaterThan(0.25)
      expect(viewFrac).toBeLessThan(0.78) // 右上角是工坊/背包按鈕
      expect(y).toBeLessThan(0.5)
    }
    const first = artworkSpot(0)
    expect((first.x - PET_X) * ROOM_WIDTH_FACTOR + 0.5).toBeGreaterThanOrEqual(0.55)
    expect(first.y).toBeLessThan(0.3) // 第一幅放在牆面上方，最顯眼
  })
  it('hangArtwork（v7）自動挑空牆面：不蓋到窗戶，第二幅不蓋到第一幅', async () => {
    await repo.seedShop()
    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
      const res = await repo.completeColoring('monkey', { fills: { a: '#ff0000' }, strokes: [], stickers: [] }, 'data:image/png;base64,AAAA', T0 + i)
      if (!res.ok) throw new Error(res.error)
      const h = await repo.hangArtwork(res.galleryId, T0)
      if (!h.ok) throw new Error(h.error)
      ids.push(h.itemId)
    }
    const [a, b] = await Promise.all(ids.map((id) => repo.db.placements.get(id)))
    expect(a!.y).toBeLessThan(0.5)
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThan(0.05)
  })
})
