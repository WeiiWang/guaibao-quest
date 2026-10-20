import { describe, expect, it } from 'vitest'
import {
  autoScrollSpeed,
  clampPlacement,
  EDGE_SCROLL_MAX,
  FLOOR_TOP,
  inRect,
  nextFrontZ,
  renderOrder,
  ROOM_CELLS_H,
  spritePx,
  toFrac,
} from './room'

describe('clampPlacement', () => {
  it('整件限制在房間內', () => {
    expect(clampPlacement('floor', -1, 0.9, 0.1, 0.2)).toEqual({ x: 0.05, y: 0.9 })
    expect(clampPlacement('floor', 2, 0.9, 0.1, 0.2).x).toBe(0.95)
    expect(clampPlacement('floor', 0.5, 5, 0.1, 0.2).y).toBeCloseTo(0.9)
  })
  it('牆面類只能在牆面區', () => {
    const r = clampPlacement('wall', 0.5, 0.95, 0.1, 0.2)
    expect(r.y + 0.1).toBeLessThan(FLOOR_TOP)
    expect(clampPlacement('wall', 0.5, -3, 0.1, 0.2).y).toBeCloseTo(0.1)
  })
  it('地面類的下緣要落在地板區，但上半身可高過地板線', () => {
    const r = clampPlacement('floor', 0.5, 0.1, 0.1, 0.3)
    expect(r.y + 0.15).toBeGreaterThanOrEqual(FLOOR_TOP)
    expect(r.y - 0.15).toBeGreaterThanOrEqual(0)
    expect(r.y - 0.15).toBeLessThan(FLOOR_TOP)
  })
  it('合法位置不變', () => {
    expect(clampPlacement('floor', 0.4, 0.8, 0.1, 0.2)).toEqual({ x: 0.4, y: 0.8 })
    expect(clampPlacement('wall', 0.4, 0.3, 0.1, 0.2)).toEqual({ x: 0.4, y: 0.3 })
  })
})

describe('座標換算 / 命中', () => {
  it('toFrac 與 spritePx', () => {
    expect(toFrac(500, 150, 1000, 300)).toEqual({ x: 0.5, y: 0.5 })
    expect(spritePx(36, 18, ROOM_CELLS_H * 10)).toEqual({ w: 360, h: 180 })
  })
  it('inRect 含 padding', () => {
    const r = { left: 10, top: 10, right: 20, bottom: 20 }
    expect(inRect(15, 15, r)).toBe(true)
    expect(inRect(25, 15, r)).toBe(false)
    expect(inRect(25, 15, r, 6)).toBe(true)
  })
})

describe('autoScrollSpeed', () => {
  it('中間不捲動、靠左往左、靠右往右，越靠邊越快', () => {
    expect(autoScrollSpeed(500, 0, 1000)).toBe(0)
    expect(autoScrollSpeed(30, 0, 1000)).toBeLessThan(0)
    expect(autoScrollSpeed(970, 0, 1000)).toBeGreaterThan(0)
    expect(Math.abs(autoScrollSpeed(5, 0, 1000))).toBeGreaterThan(Math.abs(autoScrollSpeed(35, 0, 1000)))
    expect(autoScrollSpeed(-50, 0, 1000)).toBe(-EDGE_SCROLL_MAX)
    expect(autoScrollSpeed(1100, 0, 1000)).toBe(EDGE_SCROLL_MAX)
  })
  it('考慮可視區的偏移', () => {
    expect(autoScrollSpeed(110, 100, 800)).toBeLessThan(0)
    expect(autoScrollSpeed(500, 100, 800)).toBe(0)
  })
})

describe('圖層', () => {
  it('依下緣 y 排序，越下面越前面；z 覆寫排最上', () => {
    const list = [
      { id: 'a', bottom: 0.9, z: 0 },
      { id: 'b', bottom: 0.5, z: 0 },
      { id: 'c', bottom: 0.3, z: 1 },
      { id: 'd', bottom: 0.7, z: 0 },
    ]
    expect(renderOrder(list).map((x) => x.id)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('nextFrontZ', () => {
    expect(nextFrontZ([])).toBe(1)
    expect(nextFrontZ([{ z: 0 }, { z: 3 }])).toBe(4)
  })
})
