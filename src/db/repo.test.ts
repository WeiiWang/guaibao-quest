import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { HOUR_MS } from '../domain/constants'
import { balanceOf } from '../domain/points'
import { currentHunger } from '../domain/pet'
import { spriteSize } from '../art/items'
import { FLOOR_TOP, ROOM_CELLS_H } from '../domain/room'
import Dexie from 'dexie'

const T0 = new Date(2026, 5, 10, 9, 0, 0).getTime()
const DAY = 24 * HOUR_MS
let n = 0
let repo: Repo

async function setup() {
  repo = new Repo(new GuaibaoDB(`test-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
}
const instOf = async (title: string, date = '2026-06-10') => {
  const tpl = (await repo.db.templates.toArray()).find((t) => t.title === title)!
  return (await repo.db.instances.toArray()).find((i) => i.templateId === tpl.id && i.date === date)!
}
const complete = async (title: string, now = T0) => {
  const i = await instOf(title)
  await repo.submitTask(i.id, now)
  return repo.reviewTask(i.id, 'approve', now)
}

beforeEach(setup)

describe('onboarding', () => {
  it('建立設定、預設寵物「阿悟」(蛋)、5 個模板與今日任務', async () => {
    const s = await repo.getSettings()
    expect(s?.onboarded).toBe(true)
    expect(s?.pinHash).not.toContain('1234')
    const pet = await repo.db.pets.get('pet')
    expect(pet).toMatchObject({ name: '阿悟', stage: 'egg', feedCount: 0 })
    expect(await repo.db.templates.count()).toBe(5)
    expect(await repo.db.instances.count()).toBe(5)
  })
  it('PIN 錯誤驗證失敗', async () => {
    expect(await repo.verifyPin('1234')).toBe(true)
    expect(await repo.verifyPin('0000')).toBe(false)
    expect(await repo.verifyPin('')).toBe(false)
  })
})

describe('核心循環', () => {
  it('申請 → 通過加點 → 買香蕉 → 餵食 feedCount+1', async () => {
    const i = await instOf('寫功課')
    expect((await repo.submitTask(i.id, T0)).ok).toBe(true)
    expect((await repo.db.instances.get(i.id))?.status).toBe('pending')
    const r = await repo.reviewTask(i.id, 'approve', T0)
    expect(r).toMatchObject({ ok: true, awarded: 30 })
    expect(await repo.balance()).toBe(30)
    expect((await repo.buyItem('banana', T0)).ok).toBe(true)
    expect(await repo.balance()).toBe(20)
    const f = await repo.feedPet('banana', T0)
    expect(f.ok && f.pet.feedCount).toBe(1)
    expect((await repo.db.inventory.get('banana'))?.qty).toBe(0)
    expect((await repo.feedPet('banana', T0)).ok).toBe(false)
  })
  it('退回不加點，可再申請', async () => {
    const i = await instOf('刷牙')
    await repo.submitTask(i.id, T0)
    await repo.reviewTask(i.id, 'reject', T0)
    expect(await repo.balance()).toBe(0)
    expect((await repo.db.instances.get(i.id))?.status).toBe('rejected')
    expect((await repo.submitTask(i.id, T0)).ok).toBe(true)
    expect((await repo.reviewTask(i.id, 'approve', T0)).ok).toBe(true)
    expect(await repo.balance()).toBe(10)
  })
  it('不能重複審核或對 todo 審核', async () => {
    const i = await instOf('刷牙')
    expect((await repo.reviewTask(i.id, 'approve', T0)).ok).toBe(false)
    await repo.submitTask(i.id, T0)
    await repo.reviewTask(i.id, 'approve', T0)
    expect((await repo.reviewTask(i.id, 'approve', T0)).ok).toBe(false)
    expect(await repo.balance()).toBe(10)
  })
})

describe('每日上限', () => {
  it('任務 + 家長加點總和 100，超過部分不發放', async () => {
    await complete('寫功課') // 30
    await complete('收玩具') // 20
    await complete('看書 10 分鐘') // 20  => 70
    const b = await repo.grantBonus(50, '今天很乖', T0)
    expect(b).toMatchObject({ ok: true, granted: 30, capped: true })
    expect(await repo.balance()).toBe(100)
    const last = await complete('刷牙')
    expect(last).toMatchObject({ ok: true, awarded: 0, capped: true })
    expect(await repo.balance()).toBe(100)
    expect((await instOf('刷牙')).status).toBe('approved')
  })
  it('跨日後額度重置', async () => {
    await repo.grantBonus(100, 'x', T0)
    expect(await repo.grantBonus(10, 'y', T0)).toMatchObject({ granted: 0, capped: true })
    expect(await repo.grantBonus(10, 'y', T0 + DAY)).toMatchObject({ granted: 10, capped: false })
  })
  it('花掉點數不釋出額度', async () => {
    await repo.grantBonus(100, 'x', T0)
    await repo.buyItem('decor-plant', T0)
    expect(await repo.grantBonus(10, 'y', T0)).toMatchObject({ granted: 0, capped: true })
  })
})

describe('扣點與購買', () => {
  it('扣點不能讓餘額 < 0', async () => {
    await repo.grantBonus(30, 'x', T0)
    expect((await repo.applyPenalty(40, '', T0)).ok).toBe(false)
    expect(await repo.balance()).toBe(30)
    expect((await repo.applyPenalty(30, '吵架', T0)).ok).toBe(true)
    expect(await repo.balance()).toBe(0)
    expect((await repo.applyPenalty(1, '', T0)).ok).toBe(false)
  })
  it('買不起不會扣點也不進背包', async () => {
    await repo.grantBonus(5, 'x', T0)
    const r = await repo.buyItem('banana', T0)
    expect(r).toEqual({ ok: false, error: '還差 5 點' })
    expect(await repo.balance()).toBe(5)
    expect(await repo.db.inventory.count()).toBe(0)
  })
  it('裝飾只能買一次', async () => {
    await repo.grantBonus(100, 'x', T0)
    expect((await repo.buyItem('decor-plant', T0)).ok).toBe(true)
    expect((await repo.buyItem('decor-plant', T0)).ok).toBe(false)
  })
  it('流水帳餘額一致', async () => {
    await repo.grantBonus(60, 'x', T0)
    await repo.buyItem('peach', T0)
    expect(balanceOf(await repo.db.ledger.toArray())).toBe(40)
  })
})

describe('跨日與飢餓', () => {
  it('隔天第一次開啟產生新的每日任務，重跑不重複', async () => {
    expect(await repo.ensureDailyTasks(T0)).toBe(0)
    expect(await repo.ensureDailyTasks(T0 + DAY)).toBe(5)
    expect(await repo.ensureDailyTasks(T0 + DAY)).toBe(0)
    expect(await repo.db.instances.count()).toBe(10)
  })
  it('寵物飢餓隨時間衰減，餵食後重新計時', async () => {
    await repo.grantBonus(30, 'x', T0)
    await repo.buyItem('banana', T0)
    const later = T0 + 10 * HOUR_MS
    expect(currentHunger((await repo.db.pets.get('pet'))!, later)).toBe(40)
    const f = await repo.feedPet('banana', later)
    expect(f.ok && f.pet.hunger).toBe(65)
  })
  it('蛋餵滿 20 次孵化成幼體', async () => {
    for (let k = 0; k < 20; k++) {
      await repo.db.inventory.put({ id: 'banana', itemId: 'banana', qty: 1 })
      await repo.db.pets.update('pet', { hunger: 0, hungerUpdatedAt: T0 }) // 吃飽了就不會吃，所以每次先餓著
      const r = await repo.feedPet('banana', T0)
      if (k < 19) expect(r.ok && r.evolvedTo).toBeNull()
      else expect(r.ok && r.evolvedTo).toBe('baby')
    }
  })
})

describe('任務管理與設定', () => {
  it('新增模板立即產生今日實例；點數限制 10–30；停用後不產生', async () => {
    await repo.saveTemplate({ title: '倒垃圾', emoji: '🗑️', points: 99 }, T0)
    const t = (await repo.db.templates.toArray()).find((x) => x.title === '倒垃圾')!
    expect(t.points).toBe(30)
    expect(await repo.db.instances.count()).toBe(6)
    await repo.saveTemplate({ id: t.id, title: '倒垃圾', active: false }, T0)
    expect(await repo.ensureDailyTasks(T0 + DAY)).toBe(5)
  })
  it('改 PIN 需舊 PIN', async () => {
    expect((await repo.changePin('9999', '4321')).ok).toBe(false)
    expect((await repo.changePin('1234', '4321')).ok).toBe(true)
    expect(await repo.verifyPin('4321')).toBe(true)
    expect(await repo.verifyPin('1234')).toBe(false)
  })
  it('重設全部資料需 PIN', async () => {
    expect((await repo.resetAll('0000')).ok).toBe(false)
    expect(await repo.db.ledger.count()).toBe(0)
    expect((await repo.getSettings())?.onboarded).toBe(true)
    expect((await repo.resetAll('1234')).ok).toBe(true)
    expect(await repo.getSettings()).toBeUndefined()
    expect(await repo.db.templates.count()).toBe(0)
  })
  it('著色進度可保存與讀回', async () => {
    await repo.saveColoring('fish', { body: '#e8a6a0' }, T0)
    expect((await repo.db.coloring.get('fish'))?.fills).toEqual({ body: '#e8a6a0' })
  })
})

describe('快速連點 / 並行寫入', () => {
  it('同一任務並行 approve 兩次只發一次點', async () => {
    const i = await instOf('寫功課')
    await repo.submitTask(i.id, T0)
    const rs = await Promise.all([repo.reviewTask(i.id, 'approve', T0), repo.reviewTask(i.id, 'approve', T0)])
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect(await repo.balance()).toBe(30)
    expect((await repo.db.ledger.where('kind').equals('task').count())).toBe(1)
  })
  it('並行 approve 與 reject 只有一個生效', async () => {
    const i = await instOf('刷牙')
    await repo.submitTask(i.id, T0)
    const rs = await Promise.all([repo.reviewTask(i.id, 'approve', T0), repo.reviewTask(i.id, 'reject', T0)])
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    const status = (await repo.db.instances.get(i.id))!.status
    expect(await repo.balance()).toBe(status === 'approved' ? 10 : 0)
  })
  it('並行 submit 兩次只有一次成功', async () => {
    const i = await instOf('刷牙')
    const rs = await Promise.all([repo.submitTask(i.id, T0), repo.submitTask(i.id, T0)])
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
  })
  it('並行買同一個飼料：扣點與庫存一致', async () => {
    await repo.grantBonus(30, 'x', T0)
    await Promise.all([repo.buyItem('banana', T0), repo.buyItem('banana', T0)])
    const qty = (await repo.db.inventory.get('banana'))?.qty ?? 0
    expect(qty).toBe(2)
    expect(await repo.balance()).toBe(30 - 10 * qty)
  })
  it('餘額只夠一份時並行買兩次：只成功一次、餘額不為負', async () => {
    await repo.grantBonus(10, 'x', T0)
    const rs = await Promise.all([repo.buyItem('banana', T0), repo.buyItem('banana', T0)])
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect((await repo.db.inventory.get('banana'))?.qty).toBe(1)
    expect(await repo.balance()).toBe(0)
  })
  it('並行買同一個裝飾只買到一份', async () => {
    await repo.grantBonus(100, 'x', T0)
    const rs = await Promise.all([repo.buyItem('decor-plant', T0), repo.buyItem('decor-plant', T0)])
    expect(rs.filter((r) => r.ok)).toHaveLength(1)
    expect(await repo.balance()).toBe(50)
  })
  it('並行 grantBonus 不會超過每日上限', async () => {
    await Promise.all([repo.grantBonus(60, 'a', T0), repo.grantBonus(60, 'b', T0)])
    expect(await repo.balance()).toBe(100)
  })
})

describe('房間裝飾擺放', () => {
  const own = async (id: string) => {
    await repo.db.inventory.put({ id, itemId: id, qty: 1 })
  }
  it('沒有該裝飾不能擺放/翻轉/移到最前/收回', async () => {
    expect((await repo.placeDecor('decor-plant', 0.5, 0.8)).ok).toBe(false)
    expect((await repo.flipDecor('decor-plant')).ok).toBe(false)
    expect((await repo.bringToFront('decor-plant')).ok).toBe(false)
    expect((await repo.removeDecor('decor-plant')).ok).toBe(false)
    expect(await repo.db.placements.count()).toBe(0)
  })
  it('非裝飾品（飼料）不能擺放', async () => {
    await own('banana')
    expect((await repo.placeDecor('banana', 0.5, 0.8)).ok).toBe(false)
  })
  it('擺放、移動、翻轉、移到最前、收回，並保存比例座標', async () => {
    await own('decor-plant')
    await own('decor-rug')
    expect((await repo.placeDecor('decor-plant', 0.4, 0.8, T0)).ok).toBe(true)
    await repo.placeDecor('decor-rug', 0.3, 0.9, T0)
    expect(await repo.db.placements.get('decor-plant')).toMatchObject({ x: 0.4, z: 0, flipped: false })
    expect((await repo.moveDecor('decor-plant', 0.6, 0.85)).ok).toBe(true)
    expect((await repo.db.placements.get('decor-plant'))!.x).toBe(0.6)
    await repo.flipDecor('decor-plant')
    expect((await repo.db.placements.get('decor-plant'))!.flipped).toBe(true)
    await repo.bringToFront('decor-plant')
    await repo.bringToFront('decor-rug')
    expect((await repo.db.placements.get('decor-plant'))!.z).toBe(1)
    expect((await repo.db.placements.get('decor-rug'))!.z).toBe(2)
    // 移動不改 z / 翻轉
    await repo.moveDecor('decor-plant', 0.7, 0.85)
    expect(await repo.db.placements.get('decor-plant')).toMatchObject({ z: 1, flipped: true })
    expect((await repo.removeDecor('decor-plant')).ok).toBe(true)
    expect(await repo.db.placements.get('decor-plant')).toBeUndefined()
    expect((await repo.db.inventory.get('decor-plant'))?.qty).toBe(1)
    expect((await repo.moveDecor('decor-plant', 0.5, 0.8)).ok).toBe(false)
  })
  it('牆面類不能放到地板區、地面類不能放到牆上', async () => {
    await own('decor-frame')
    await own('decor-rug')
    await repo.placeDecor('decor-frame', 0.5, 0.95)
    expect((await repo.db.placements.get('decor-frame'))!.y).toBeLessThan(FLOOR_TOP)
    await repo.placeDecor('decor-rug', 0.5, 0.05)
    expect((await repo.db.placements.get('decor-rug'))!.y + spriteSize('rug').rows / 2 / ROOM_CELLS_H).toBeGreaterThan(FLOOR_TOP) // 下緣在地板區
  })
  it('座標超出範圍會被限制在 0–1', async () => {
    await own('decor-rug')
    await repo.placeDecor('decor-rug', 5, 5)
    const p = (await repo.db.placements.get('decor-rug'))!
    expect(p.x).toBeLessThanOrEqual(1)
    expect(p.y).toBeLessThanOrEqual(1)
    expect((await repo.placeDecor('decor-rug', NaN, 0.5)).ok).toBe(false)
  })
  it('migration：舊版 Pet.decor 陣列轉成 placements', async () => {
    const name = `mig-${n++}`
    const old = new Dexie(name)
    old.version(1).stores({
      children: 'id', templates: 'id, order', instances: 'id, templateId, date, status', ledger: 'id, at, kind',
      pets: 'id', shopItems: 'id, kind', inventory: 'id, itemId', coloring: 'pageId', settings: 'id',
    })
    await old.table('pets').put({ id: 'pet', name: '阿悟', stage: 'baby', feedCount: 30, hunger: 50, hungerUpdatedAt: 1, mood: 'normal', decor: ['decor-plant', 'decor-frame'] })
    old.close()
    const migrated = new GuaibaoDB(name)
    const ps = await migrated.placements.toArray()
    expect(ps.map((p) => p.itemId).sort()).toEqual(['decor-frame', 'decor-plant'])
    expect(ps.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true)
    const pet = (await migrated.pets.get('pet')) as unknown as Record<string, unknown>
    expect(pet.decor).toBeUndefined()
    expect(pet.feedCount).toBe(30)
  })
})
