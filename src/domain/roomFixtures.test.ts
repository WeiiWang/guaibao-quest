import { describe, expect, it } from 'vitest'
import { fixtureRect, fixturesGivingWay, ROOM_FIXTURES, type PlacedBox } from './roomFixtures'
import { FLOOR_TOP } from './room'

const W = 2950
const H = 500
const rect = (id: string) => fixtureRect(ROOM_FIXTURES.find((f) => f.id === id)!, W, H)
const on = (id: string, baseId: string, slot: 'wall' | 'floor', wf = 1, hf = 1): PlacedBox => {
  const r = rect(id)
  return { baseId, slot, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, w: (r.right - r.left) * wf, h: (r.bottom - r.top) * hf }
}

describe('內建陳設', () => {
  it('三件的位置合理：矮櫃與地墊站在地板、相框掛在牆面', () => {
    const by = Object.fromEntries(ROOM_FIXTURES.map((f) => [f.id, f]))
    expect(by.cabinet.bottom).toBeGreaterThan(FLOOR_TOP)
    expect(by.mat.bottom).toBeLessThanOrEqual(1)
    expect(by.mat.bottom - by.mat.h).toBeGreaterThan(FLOOR_TOP)
    expect(by.photos.bottom).toBeLessThan(FLOOR_TOP)
    expect(by.photos.bottom).toBeLessThanOrEqual(by.cabinet.bottom - by.cabinet.h)
  })

  it('沒有家具：都顯示', () => {
    expect(fixturesGivingWay([], W, H)).toEqual([])
  })

  it('地毯碰到地墊：地墊讓位；其他東西站在地墊上不用讓', () => {
    expect(fixturesGivingWay([on('mat', 'decor-rug', 'floor', 0.5, 0.5)], W, H)).toEqual(['mat'])
    expect(fixturesGivingWay([on('mat', 'decor-bed', 'floor')], W, H)).not.toContain('mat')
  })

  it('地毯擺在別處：地墊不用讓', () => {
    expect(fixturesGivingWay([{ baseId: 'decor-rug', slot: 'floor', x: W * 0.9, y: H * 0.88, w: 180, h: 150 }], W, H)).toEqual([])
  })

  it('書架碰到矮櫃就讓位；小球擺在前面不用讓；大件家具蓋住才讓', () => {
    expect(fixturesGivingWay([on('cabinet', 'decor-shelf', 'floor', 0.3, 0.3)], W, H)).toContain('cabinet')
    expect(fixturesGivingWay([on('cabinet', 'decor-ball', 'floor', 0.4, 0.4)], W, H)).not.toContain('cabinet')
    expect(fixturesGivingWay([on('cabinet', 'decor-bed', 'floor')], W, H)).toContain('cabinet')
  })

  it('牆上的畫蓋到相框組：相框讓位；地上的東西擋在前面不算', () => {
    expect(fixturesGivingWay([on('photos', 'decor-frame', 'wall', 0.4, 0.4)], W, H)).toContain('photos')
    expect(fixturesGivingWay([on('photos', 'art-1', 'wall')], W, H)).toContain('photos')
    expect(fixturesGivingWay([on('photos', 'decor-lamp', 'floor')], W, H)).not.toContain('photos')
  })

  it('房間還沒量好不用讓', () => {
    expect(fixturesGivingWay([on('mat', 'decor-rug', 'floor')], 0, 0)).toEqual([])
  })
})
