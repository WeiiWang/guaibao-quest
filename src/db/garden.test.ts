import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { decodeValue, encodeValue } from '../profiles/backup'

const T0 = new Date(2026, 10, 4, 9, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000
let n = 0
let repo: Repo

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`garden-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

const qty = async (id: string) => (await repo.db.inventory.get(id))?.qty ?? 0
const settings = async () => (await repo.db.settings.get('main'))!

describe('小菜園 repo', () => {
  it('舊存檔沒有 garden 欄位也能種；寫回去長度是 6', async () => {
    expect((await settings()).garden).toBeUndefined()
    expect(await repo.gardenPlant(3, 'carrot')).toBe(true)
    const g = (await settings()).garden!
    expect(g).toHaveLength(6)
    expect(g[3]).toEqual({ crop: 'carrot', stage: 0, grewOn: '' })
    expect(await repo.gardenPlant(3, 'apple')).toBe(false)
  })
  it('走完一輪：今天澆長一階、同一天再澆不長、隔天再澆長好、收成 2 個進背包、田變空', async () => {
    await repo.gardenPlant(0, 'grape')
    const before = await qty('grape')
    expect(await repo.gardenHarvest(0)).toBeNull()
    expect(await repo.gardenWater(0, T0)).toBe('grew')
    expect((await settings()).garden![0]?.stage).toBe(1)
    expect(await repo.gardenWater(0, T0 + 1000)).toBe('asleep')
    expect((await settings()).garden![0]?.stage).toBe(1)
    expect(await repo.gardenHarvest(0)).toBeNull()
    expect(await qty('grape')).toBe(before)
    expect(await repo.gardenWater(0, T0 + DAY)).toBe('grew')
    expect((await settings()).garden![0]?.stage).toBe(2)
    expect(await repo.gardenWater(0, T0 + 2 * DAY)).toBe('ready')
    expect(await repo.gardenHarvest(0)).toEqual({ crop: 'grape', qty: 2 })
    expect(await qty('grape')).toBe(before + 2)
    expect((await settings()).garden![0]).toBeNull()
    expect(await repo.gardenHarvest(0)).toBeNull()
    expect(await qty('grape')).toBe(before + 2)
  })
  it('空田澆水不會寫出 garden 欄位', async () => {
    expect(await repo.gardenWater(0, T0)).toBe('empty')
    expect((await settings()).garden).toBeUndefined()
  })
  it('小菜園不走遊樂場的每日獎勵：finishPlayGame 不送', async () => {
    expect(await repo.finishPlayGame('garden', T0)).toBeNull()
  })
  it('備份的編碼解碼把菜園（含空田的 null）原樣帶回來', async () => {
    await repo.gardenPlant(1, 'peach')
    await repo.gardenWater(1, T0)
    const s = await settings()
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue(s)))) as typeof s
    expect(back.garden).toEqual(s.garden)
    expect(back.garden).toHaveLength(6)
    expect(back.garden![0]).toBeNull()
  })
})
