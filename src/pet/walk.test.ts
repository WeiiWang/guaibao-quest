import { describe, expect, it } from 'vitest'
import { makeRng } from '../learning/rng'
import { clipWalk, pickWalk, walkDurationMs, walkTo, WALK_MIN_MS } from './walk'

const HALF = 0.05

describe('clipWalk', () => {
  it('沒有家具就走到目標', () => {
    expect(clipWalk(0.2, 0.6, HALF, [])).toEqual({ x: 0.6, blocked: false })
  })
  it('往右走遇到家具：停在家具前面（不會穿過去）', () => {
    const r = clipWalk(0.2, 0.7, HALF, [{ left: 0.4, right: 0.5 }])
    expect(r.blocked).toBe(true)
    expect(r.x + HALF).toBeLessThanOrEqual(0.4)
    expect(r.x).toBeGreaterThan(0.2)
  })
  it('往左走遇到家具：停在家具右邊', () => {
    const r = clipWalk(0.8, 0.1, HALF, [{ left: 0.4, right: 0.5 }])
    expect(r.blocked).toBe(true)
    expect(r.x - HALF).toBeGreaterThanOrEqual(0.5)
  })
  it('家具在目標之後不影響', () => {
    expect(clipWalk(0.2, 0.3, HALF, [{ left: 0.6, right: 0.7 }]).blocked).toBe(false)
  })
  it('起點貼著家具（在家具範圍內）時可以離開', () => {
    const r = clipWalk(0.45, 0.8, HALF, [{ left: 0.4, right: 0.5 }])
    expect(r).toEqual({ x: 0.8, blocked: false })
  })
  it('多件家具：停在最近的那件前面', () => {
    const r = clipWalk(0.1, 0.9, HALF, [
      { left: 0.7, right: 0.8 },
      { left: 0.4, right: 0.5 },
    ])
    expect(r.x + HALF).toBeLessThanOrEqual(0.4)
  })
})

describe('pickWalk', () => {
  it('目標落在可走範圍內，且夠遠', () => {
    const rng = makeRng(4)
    for (let i = 0; i < 100; i++) {
      const w = pickWalk({ fromX: 0.3, rng, minX: 0.1, maxX: 0.5, halfW: HALF, obstacles: [] })
      expect(w).not.toBeNull()
      expect(w!.toX).toBeGreaterThanOrEqual(0.1)
      expect(w!.toX).toBeLessThanOrEqual(0.5)
      expect(Math.abs(w!.toX - 0.3)).toBeGreaterThanOrEqual(0.02)
      expect(w!.dir).toBe(w!.toX >= 0.3 ? 1 : -1)
    }
  })
  it('可走範圍太小就不走', () => {
    expect(pickWalk({ fromX: 0.3, rng: () => 0.5, minX: 0.3, maxX: 0.32, halfW: HALF, obstacles: [] })).toBeNull()
  })
  it('被家具擋住時停在前面', () => {
    const w = pickWalk({ fromX: 0.2, rng: () => 0.99, minX: 0.1, maxX: 0.9, halfW: HALF, obstacles: [{ left: 0.5, right: 0.6 }] })
    expect(w).not.toBeNull()
    expect(w!.blocked).toBe(true)
    expect(w!.toX + HALF).toBeLessThanOrEqual(0.5)
  })
})

describe('walkTo', () => {
  it('走到指定位置；已經在那裡就回 null；超出範圍會夾回', () => {
    expect(walkTo(0.3, 0.6, HALF, [], 0.1, 0.9)?.toX).toBe(0.6)
    expect(walkTo(0.3, 0.304, HALF, [], 0.1, 0.9)).toBeNull()
    expect(walkTo(0.3, 2, HALF, [], 0.1, 0.9)?.toX).toBe(0.9)
  })
})

describe('walkDurationMs', () => {
  it('距離越長越久，有下限', () => {
    expect(walkDurationMs(0.001, 0.1)).toBe(WALK_MIN_MS)
    expect(walkDurationMs(0.4, 0.1)).toBeGreaterThan(walkDurationMs(0.2, 0.1))
    expect(walkDurationMs(0.3, 0)).toBe(WALK_MIN_MS)
  })
})
