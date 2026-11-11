import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { PLAY_DAILY_CAP } from '../domain/playground'

// v8.5 越玩越多：玩完一回（次數、食物、新玩具一次算完）

const T0 = new Date(2026, 10, 11, 9, 0, 0).getTime()
const DAY = 24 * 3600 * 1000
let n = 0
let db: GuaibaoDB
let repo: Repo

beforeEach(async () => {
  db = new GuaibaoDB(`toys-${n++}`)
  repo = new Repo(db, () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

const qty = async (id: string) => (await db.inventory.get(id))?.qty ?? 0

describe('玩完一回', () => {
  it('第一次玩完：有食物、有第一個新玩具，次數是 1', async () => {
    const r = await repo.completePlayGame('bubbles', T0)
    expect(r.foodId).toBeTruthy()
    expect(r.toy?.id).toBe('animals')
    expect(r).toMatchObject({ plays: 1, crowned: false })
    expect(await qty(r.foodId!)).toBeGreaterThanOrEqual(1)
    expect((await repo.getSettings())?.playCount).toEqual({ bubbles: 1 })
  })

  it('同一天第二次：沒有食物也沒有新玩具，但次數照算；第三次有第二個新玩具', async () => {
    await repo.completePlayGame('bubbles', T0)
    expect(await repo.completePlayGame('bubbles', T0)).toEqual({ foodId: null, plays: 2, toy: null, crowned: false })
    const third = await repo.completePlayGame('bubbles', T0)
    expect(third.foodId).toBeNull()
    expect(third.toy?.id).toBe('wand')
    expect((await repo.getSettings())?.playCount).toEqual({ bubbles: 3 })
  })

  it('新玩具不受每日食物上限影響', async () => {
    const games = ['bubbles', 'catch', 'memory', 'hide'] as const
    const out = []
    for (const g of games) out.push(await repo.completePlayGame(g, T0))
    expect(out.filter((o) => o.foodId).length).toBe(PLAY_DAILY_CAP)
    expect(out[3].foodId).toBeNull()
    expect(out[3].toy?.id).toBe('swap')
  })

  it('第 6 次戴皇冠（只有那一次回報）；隔天又有食物', async () => {
    for (let i = 0; i < 5; i++) await repo.completePlayGame('doctor', T0)
    expect(await repo.completePlayGame('doctor', T0)).toMatchObject({ plays: 6, crowned: true, toy: null })
    const next = await repo.completePlayGame('doctor', T0 + DAY)
    expect(next).toMatchObject({ plays: 7, crowned: false, toy: null })
    expect(next.foodId).toBeTruthy()
  })

  it('小菜園：不送食物，但算次數、有新玩具', async () => {
    const r = await repo.completePlayGame('garden', T0)
    expect(r.foodId).toBeNull()
    expect(r.toy?.id).toBe('sprinkler')
  })

  it('學我說話：不送食物、不算次數', async () => {
    expect(await repo.completePlayGame('talk', T0)).toEqual({ foodId: null, plays: 0, toy: null, crowned: false })
    expect((await repo.getSettings())?.playCount).toBeUndefined()
  })

  it('舊的 finishPlayGame 還在，跟新的共用同一份每日紀錄', async () => {
    expect(await repo.finishPlayGame('bubbles', T0)).toBeTruthy()
    expect((await repo.completePlayGame('bubbles', T0)).foodId).toBeNull()
  })
})
