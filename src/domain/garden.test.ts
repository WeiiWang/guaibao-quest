import { describe, expect, it } from 'vitest'
import { FOOD_IDS } from './constants'
import { GARDEN_CROPS, GARDEN_SIZE, HARVEST_QTY, gardenIntroLine, harvestPlot, hasReadyCrop, normalizeGarden, plantArt, plantSeed, plotState, waterPlot } from './garden'

const D1 = '2026-11-04'
const D2 = '2026-11-05'
const D3 = '2026-11-06'

describe('小菜園：資料', () => {
  it('舊存檔沒有這個欄位：6 塊空田', () => {
    expect(normalizeGarden(undefined)).toEqual(Array(GARDEN_SIZE).fill(null))
    expect(normalizeGarden(null)).toHaveLength(GARDEN_SIZE)
  })
  it('長度不對、資料壞掉：補齊、認不得的當空田', () => {
    const g = normalizeGarden([{ crop: 'carrot', stage: 1, grewOn: D1 }, { crop: 'pizza', stage: 0, grewOn: '' }, { crop: 'apple', stage: 9, grewOn: '' }, 'x'])
    expect(g).toHaveLength(GARDEN_SIZE)
    expect(g[0]).toEqual({ crop: 'carrot', stage: 1, grewOn: D1 })
    expect(g.slice(1)).toEqual(Array(GARDEN_SIZE - 1).fill(null))
    expect(normalizeGarden(Array(9).fill(null))).toHaveLength(GARDEN_SIZE)
  })
  it('作物都是真的食物（收成才進得了背包）', () => {
    for (const c of GARDEN_CROPS) expect(FOOD_IDS).toContain(c)
  })
})

describe('小菜園：種下', () => {
  it('種在空田是 stage 0，當天還沒長過', () => {
    const g = plantSeed(undefined, 2, 'grape')
    expect(g?.[2]).toEqual({ crop: 'grape', stage: 0, grewOn: '' })
    expect(plotState(g![2], D1)).toBe('thirsty')
  })
  it('有東西的田、超出範圍、不是種子都不行', () => {
    const g = plantSeed(undefined, 0, 'carrot')
    expect(plantSeed(g, 0, 'apple')).toBeNull()
    expect(plantSeed(g, 6, 'apple')).toBeNull()
    expect(plantSeed(g, -1, 'apple')).toBeNull()
    expect(plantSeed(g, 1, 'cake')).toBeNull()
  })
  it('不改到傳進來的資料', () => {
    const before = normalizeGarden(undefined)
    plantSeed(before, 0, 'carrot')
    expect(before[0]).toBeNull()
  })
})

describe('小菜園：澆水與換日', () => {
  const sprout = plantSeed(undefined, 0, 'carrot')!
  it('種下當天澆水就長一階（第一次就看得到變化）', () => {
    const r = waterPlot(sprout, 0, D1)
    expect(r.outcome).toBe('grew')
    expect(r.garden[0]).toEqual({ crop: 'carrot', stage: 1, grewOn: D1 })
  })
  it('一天只長一階：同一天再澆只是開心，資料不變', () => {
    const a = waterPlot(sprout, 0, D1)
    const b = waterPlot(a.garden, 0, D1)
    expect(b.outcome).toBe('asleep')
    expect(b.garden).toEqual(a.garden)
    expect(plotState(b.garden[0], D1)).toBe('sleeping')
  })
  it('換日可以再長一階，長好就不再變', () => {
    const a = waterPlot(sprout, 0, D1)
    expect(plotState(a.garden[0], D2)).toBe('thirsty')
    const b = waterPlot(a.garden, 0, D2)
    expect(b.outcome).toBe('grew')
    expect(b.garden[0]?.stage).toBe(2)
    const c = waterPlot(b.garden, 0, D3)
    expect(c.outcome).toBe('ready')
    expect(c.garden).toEqual(b.garden)
  })
  it('沒澆水永遠只是等著：隔很久回來還是原來那一階，不會枯萎', () => {
    const a = waterPlot(sprout, 0, D1)
    expect(a.garden[0]?.stage).toBe(1)
    expect(plotState(a.garden[0], '2030-01-01')).toBe('thirsty')
    expect(waterPlot(a.garden, 0, '2030-01-01').garden[0]?.stage).toBe(2)
  })
  it('空田澆水：沒事發生', () => {
    const r = waterPlot(undefined, 3, D1)
    expect(r.outcome).toBe('empty')
    expect(r.garden).toEqual(Array(GARDEN_SIZE).fill(null))
  })
})

describe('小菜園：收成', () => {
  const grown = waterPlot(waterPlot(plantSeed(undefined, 1, 'peach'), 1, D1).garden, 1, D2).garden
  it('長好的才能收，田變空，數量固定', () => {
    const r = harvestPlot(grown, 1)
    expect(r?.crop).toBe('peach')
    expect(r?.qty).toBe(HARVEST_QTY)
    expect(HARVEST_QTY).toBe(2)
    expect(r?.garden[1]).toBeNull()
  })
  it('不能收沒長好的、空田', () => {
    const g = plantSeed(undefined, 0, 'carrot')
    expect(harvestPlot(g, 0)).toBeNull()
    expect(harvestPlot(waterPlot(g, 0, D1).garden, 0)).toBeNull()
    expect(harvestPlot(g, 5)).toBeNull()
  })
  it('hasReadyCrop', () => {
    expect(hasReadyCrop(undefined)).toBe(false)
    expect(hasReadyCrop(plantSeed(undefined, 0, 'carrot'))).toBe(false)
    expect(hasReadyCrop(grown)).toBe(true)
  })
})

describe('小菜園：寵物說什麼、畫哪張圖', () => {
  const sprout = plantSeed(undefined, 0, 'carrot')!
  const leafy = waterPlot(sprout, 0, D1).garden
  const ready = waterPlot(leafy, 0, D2).garden
  it('有長好的優先', () => {
    const both = plantSeed(ready, 1, 'apple')
    expect(gardenIntroLine(both, D2)).toBe('pet.play.garden.ready')
  })
  it('有能澆的請孩子澆；沒種過就請孩子種', () => {
    expect(gardenIntroLine(sprout, D1)).toBe('pet.play.garden.water')
    expect(gardenIntroLine(leafy, D2)).toBe('pet.play.garden.water')
    expect(gardenIntroLine(undefined, D1)).toBe('pet.play.garden.intro')
    expect(gardenIntroLine(leafy, D1)).toBe('pet.play.garden.intro')
  })
  it('六塊都睡了：明天見', () => {
    let g = leafy
    for (let i = 1; i < GARDEN_SIZE; i++) g = waterPlot(plantSeed(g, i, 'apple'), i, D1).garden
    expect(gardenIntroLine(g, D1)).toBe('pet.play.garden.tomorrow')
  })
  it('三階各有圖', () => {
    expect(plantArt(sprout[0]!)).toBe('ui-plant-sprout')
    expect(plantArt(leafy[0]!)).toBe('ui-plant-leafy')
    expect(plantArt(ready[0]!)).toBe('ui-plant-carrot')
  })
})
