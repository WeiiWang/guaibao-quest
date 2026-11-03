import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { albumId, freshCards } from '../domain/album'
import { craftableOf, SHOP_CATALOG } from '../learning/materials'
import { playLines, festivalCardKey, festivalLineKey } from '../learning/playLines'
import { FESTIVALS, type FestivalNow } from '../domain/season'

const T0 = new Date(2027, 1, 6, 9, 0, 0).getTime()
const CNY: FestivalNow = { id: 'cny', year: 2027 }
let n = 0
let repo: Repo

const setStage = async (r: Repo, stage: 'egg' | 'baby' | 'adult') => {
  const pet = (await r.db.pets.get('pet'))!
  await r.db.pets.put({ ...pet, stage })
}
const qty = async (id: string, r = repo) => (await r.db.inventory.get(id))?.qty ?? 0
const settings = async (r = repo) => (await r.db.settings.get('main'))!

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`fest-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
  await setStage(repo, 'baby')
})

describe('節慶：紀念家具與回憶卡', () => {
  it('第一次遇到：送一件進背包、寫一張回憶卡（標新）、記下來', async () => {
    const r = await repo.greetFestival(CNY, T0)
    expect(r).toEqual({ first: true, keepsake: 'decor-fest-lion' })
    expect(await qty('decor-fest-lion')).toBe(1)
    const s = await settings()
    expect(s.festival).toEqual({ seen: ['cny:2027'], got: ['cny'] })
    const card = s.album?.find((c) => c.id === albumId.festival('cny'))
    expect(card).toMatchObject({ kind: 'festival', at: T0, reward: 'decor-fest-lion', fresh: true, art: 'pet-baby-cheer' })
    expect(freshCards(s.album).map((c) => c.id)).toContain(albumId.festival('cny'))
  })

  it('同一年重開不重送，也不重複說話', async () => {
    await repo.greetFestival(CNY, T0)
    expect(await repo.greetFestival(CNY, T0 + 1000)).toEqual({ first: false })
    expect(await qty('decor-fest-lion')).toBe(1)
    expect((await settings()).album?.filter((c) => c.kind === 'festival')).toHaveLength(1)
  })

  it('隔年：寵物再說一次，但紀念家具不再多送', async () => {
    await repo.greetFestival(CNY, T0)
    expect(await repo.greetFestival({ id: 'cny', year: 2028 }, T0 + 1)).toEqual({ first: true })
    expect(await qty('decor-fest-lion')).toBe(1)
    expect((await settings()).festival).toEqual({ seen: ['cny:2027', 'cny:2028'], got: ['cny'] })
  })

  it('當年錯過，隔年第一次遇到還是會送', async () => {
    const r = await repo.greetFestival({ id: 'moon', year: 2030 }, T0)
    expect(r.keepsake).toBe('decor-fest-rabbitlamp')
    expect(await qty('decor-fest-rabbitlamp')).toBe(1)
  })

  it('五個節慶各送各的', async () => {
    for (const f of FESTIVALS) expect((await repo.greetFestival({ id: f.id, year: 2027 }, T0)).keepsake).toBe(f.keepsake.id)
    for (const f of FESTIVALS) expect(await qty(f.keepsake.id)).toBe(1)
  })

  it('每個孩子各自', async () => {
    const other = new Repo(new GuaibaoDB(`fest-${n++}`), () => T0)
    await other.onboard({ pin: '1234', childName: '小花', petName: '' }, T0)
    await setStage(other, 'baby')
    await repo.greetFestival(CNY, T0)
    expect(await qty('decor-fest-lion', other)).toBe(0)
    expect((await other.greetFestival(CNY, T0)).keepsake).toBe('decor-fest-lion')
  })

  it('蛋還沒孵：不送、不記，孵出來再來', async () => {
    await setStage(repo, 'egg')
    expect(await repo.greetFestival(CNY, T0)).toEqual({ first: false })
    expect(await qty('decor-fest-lion')).toBe(0)
    expect((await settings()).festival).toBeUndefined()
    await setStage(repo, 'baby')
    expect((await repo.greetFestival(CNY, T0)).first).toBe(true)
  })

  it('家長關掉節慶：不送；打開之後才送', async () => {
    expect((await settings()).festivalOn).toBeUndefined()
    await repo.setFestivalOn(false)
    expect(await repo.greetFestival(CNY, T0)).toEqual({ first: false })
    expect(await qty('decor-fest-lion')).toBe(0)
    await repo.setFestivalOn(true)
    expect((await repo.greetFestival(CNY, T0)).first).toBe(true)
  })

  it('舊存檔（沒有 festival 欄位）能直接用', async () => {
    const s = await settings()
    expect(s.festival).toBeUndefined()
    expect(s.festivalOn).toBeUndefined()
    expect((await repo.greetFestival(CNY, T0)).first).toBe(true)
  })

  it('紀念家具可以擺進房間，也可以擺第二次（收回再放）', async () => {
    await repo.greetFestival(CNY, T0)
    expect((await repo.placeDecor('decor-fest-lion', 0.5, 0.85, T0)).ok).toBe(true)
    expect((await repo.db.placements.get('decor-fest-lion'))?.itemId).toBe('decor-fest-lion')
    await repo.removeDecor('decor-fest-lion')
    expect(await repo.db.placements.get('decor-fest-lion')).toBeUndefined()
    expect(await qty('decor-fest-lion')).toBe(1)
    expect((await repo.placeDecor('decor-fest-lion', 0.4, 0.85, T0)).ok).toBe(true)
  })

  it('沒有的紀念家具不能擺', async () => {
    expect((await repo.placeDecor('decor-fest-tree', 0.5, 0.85, T0)).ok).toBe(false)
  })

  it('不在商店也不能在工坊製作；重新載入目錄不會把送過的弄丟', async () => {
    await repo.greetFestival(CNY, T0)
    for (const f of FESTIVALS) {
      expect(SHOP_CATALOG.some((i) => i.id === f.keepsake.id)).toBe(false)
      expect(craftableOf('decor').some((i) => i.id === f.keepsake.id)).toBe(false)
    }
    expect(await repo.db.shopItems.get('decor-fest-lion')).toMatchObject({ kind: 'decor', name: '小舞獅', slot: 'floor' })
  })
})

describe('節慶台詞', () => {
  it('寵物的話用 pet. 開頭（寵物聲，物種版本自動匯出），回憶卡的話用旁白聲', () => {
    const lines = playLines()
    for (const f of FESTIVALS) {
      expect(lines[festivalLineKey(f.id)]).toBe(f.line)
      expect(festivalLineKey(f.id).startsWith('pet.')).toBe(true)
      expect(lines[festivalCardKey(f.id)]).toBe(f.caption)
      expect(festivalCardKey(f.id).startsWith('play.')).toBe(true)
    }
  })
})
