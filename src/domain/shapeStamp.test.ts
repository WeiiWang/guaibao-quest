import { describe, expect, it } from 'vitest'
import { SHAPES, SHAPE_DEFAULT_R, SHAPE_MAX_R, SHAPE_MIN_R, clampShapeR, shapePoints } from './shapeStamp'

const bbox = (pts: [number, number][]) => ({
  x0: Math.min(...pts.map((p) => p[0])),
  x1: Math.max(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  y1: Math.max(...pts.map((p) => p[1])),
})

describe('v7.4 I1：形狀章（圓、方、愛心）', () => {
  it('三種形狀：外框封閉（最後一點 = 第一點）', () => {
    expect(SHAPES.map((s) => s.shape)).toEqual(['circle', 'square', 'heart'])
    for (const { shape } of SHAPES) {
      const p = shapePoints(shape, 200, 200, 60)
      expect(p.length).toBeGreaterThan(20)
      expect(p[0]).toEqual(p[p.length - 1])
    }
  })
  it('圓：半徑 r、中心在 (cx, cy)', () => {
    const b = bbox(shapePoints('circle', 150, 120, 50))
    expect(b.x0).toBeCloseTo(100, 0)
    expect(b.x1).toBeCloseTo(200, 0)
    expect(b.y0).toBeCloseTo(70, 0)
    expect(b.y1).toBeCloseTo(170, 0)
  })
  it('方：半邊長 r', () => {
    const b = bbox(shapePoints('square', 200, 200, 40))
    expect([b.x0, b.x1, b.y0, b.y1]).toEqual([160, 240, 160, 240])
  })
  it('愛心：寬約 2r、左右對稱、尖角朝下', () => {
    const p = shapePoints('heart', 200, 200, 50)
    const b = bbox(p)
    expect(b.x1 - b.x0).toBeGreaterThan(90)
    expect(b.x1 - b.x0).toBeLessThan(110)
    expect((b.x0 + b.x1) / 2).toBeCloseTo(200, 0)
    const bottom = p.reduce((m, q) => (q[1] > m[1] ? q : m), p[0])
    expect(bottom[0]).toBeCloseTo(200, 0) // 下面的尖角在正中間
    expect(bottom[1]).toBe(b.y1)
  })
  it('大小夾在範圍內', () => {
    expect(clampShapeR(1)).toBe(SHAPE_MIN_R)
    expect(clampShapeR(999)).toBe(SHAPE_MAX_R)
    expect(clampShapeR(SHAPE_DEFAULT_R)).toBe(SHAPE_DEFAULT_R)
  })
})
