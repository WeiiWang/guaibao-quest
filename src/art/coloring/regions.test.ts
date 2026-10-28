import { describe, expect, it } from 'vitest'
import { dilateLabels, buildRegionMap, HIT_RADIUS, labelOfId, regionAnchor, regionAt, regionIdOf } from './regions'
import { paintAll, paintRegion } from './fillPaint'

/** 小張合成線稿：size×size，外框一圈線 + 十字線，把畫面分成 4 格；另外在左上格放一個很小的圓（碎塊） */
function makeLine(size: number, extra?: (set: (x: number, y: number) => void) => void): Uint8Array {
  const m = new Uint8Array(size * size)
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) m[y * size + x] = 1
  }
  const t = 2
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < t; k++) {
      set(i, k)
      set(i, size - 1 - k)
      set(k, i)
      set(size - 1 - k, i)
      set(i, Math.floor(size / 2) + k)
      set(Math.floor(size / 2) + k, i)
    }
  }
  extra?.(set)
  return m
}

const SIZE = 64

describe('區塊表（region map）', () => {
  it('十字線 + 外框 = 4 個區塊；regionId 是 r1..r4，依掃描順序（左上、右上、左下、右下）', () => {
    const map = buildRegionMap(makeLine(SIZE), SIZE)
    expect(map.regions.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4'])
    const at = (x: number, y: number) => map.labels[y * SIZE + x]
    expect(at(10, 10)).toBe(1)
    expect(at(50, 10)).toBe(2)
    expect(at(10, 50)).toBe(3)
    expect(at(50, 50)).toBe(4)
  })

  it('同一張圖算兩次，標籤完全一樣（固定掃描順序）', () => {
    const a = buildRegionMap(makeLine(SIZE), SIZE)
    const b = buildRegionMap(makeLine(SIZE), SIZE)
    expect(Array.from(a.labels)).toEqual(Array.from(b.labels))
    expect(a.regions).toEqual(b.regions)
  })

  it('外圍背景也是一個區塊（線稿外面一圈）', () => {
    const line = new Uint8Array(SIZE * SIZE)
    // 中間一個封閉的方框：外面 = 背景區塊 r1，裡面 = r2
    for (let i = 16; i <= 47; i++) {
      for (const k of [16, 17, 46, 47]) {
        line[i * SIZE + k] = 1
        line[k * SIZE + i] = 1
      }
    }
    const map = buildRegionMap(line, SIZE)
    expect(map.regions).toHaveLength(2)
    expect(map.labels[2 * SIZE + 2]).toBe(1)
    expect(map.labels[32 * SIZE + 32]).toBe(2)
    expect(map.regions[0].area).toBeGreaterThan(map.regions[1].area)
  })

  it('小於全圖 0.04% 的碎塊併入線條（不可點），其餘重新編成連續編號', () => {
    // 64×64 = 4096 px，0.04% = 約 2 px：做一個 1 px 的小洞（碎塊）與一個 9 px 的洞（保留）
    const withSpecks = makeLine(SIZE, (set) => {
      const ring = (cx: number, cy: number, r: number) => {
        for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r + 1) set(cx + dx, cy + dy)
      }
      ring(10, 10, 0) // 內部 1×1
      ring(50, 50, 1) // 內部 3×3 = 9 px
    })
    const map = buildRegionMap(withSpecks, SIZE)
    // 1×1 的洞不成區塊：標籤是 0
    expect(map.labels[10 * SIZE + 10]).toBe(0)
    // 3×3 的洞是區塊（編號連續、不跳號）
    const hole = map.labels[50 * SIZE + 50]
    expect(hole).toBeGreaterThan(0)
    expect(map.regions.map((r) => r.label)).toEqual(map.regions.map((_, i) => i + 1))
    expect(map.regions.find((r) => r.label === hole)!.area).toBe(9)
    // 4 個大格 + 1 個 3×3 洞
    expect(map.regions).toHaveLength(5)
  })

  it('門檻可調：minFrac = 0 時 1 px 的碎塊也保留', () => {
    const line = makeLine(SIZE, (set) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) set(10 + dx, 10 + dy)
    })
    expect(buildRegionMap(line, SIZE, 0).regions).toHaveLength(5)
    expect(buildRegionMap(line, SIZE).regions).toHaveLength(4)
  })

  it('4-連通：只有斜角相連的兩塊不算同一塊', () => {
    const line = new Uint8Array(16 * 16).fill(1)
    // 兩個斜對角的空格：(5,5) 與 (6,6) 各自是一塊（用 minFrac=0 保留）
    line[5 * 16 + 5] = 0
    line[6 * 16 + 6] = 0
    const map = buildRegionMap(line, 16, 0)
    expect(map.regions).toHaveLength(2)
  })

  it('大小不對會丟出錯誤', () => {
    expect(() => buildRegionMap(new Uint8Array(10), 8)).toThrow()
  })

  it('regionIdOf / labelOfId 互為反函數，壞字串回 0', () => {
    expect(labelOfId(regionIdOf(12))).toBe(12)
    expect(labelOfId('head')).toBe(0)
    expect(labelOfId('r')).toBe(0)
  })
})

describe('點擊判定（regionAt）', () => {
  const map = buildRegionMap(makeLine(SIZE), SIZE)
  it('點在區塊裡就是那一塊', () => {
    expect(regionAt(map, 10, 10)).toBe(1)
    expect(regionAt(map, 50, 50)).toBe(4)
  })
  it('點在線上：往外找最近的區塊（半徑內）', () => {
    // 垂直的十字線在 x = 32、33：點在線的左緣、靠近左邊的格子
    expect(regionAt(map, 32, 10)).toBe(1)
    expect(regionAt(map, 33, 10)).toBe(2)
    expect(regionAt(map, 10, 32)).toBe(1)
    expect(regionAt(map, 10, 33)).toBe(3)
  })
  it('距離相同時結果固定（掃描順序在前的贏）', () => {
    const a = regionAt(map, 32.4, 32.4)
    const b = regionAt(map, 32.4, 32.4)
    expect(a).toBe(b)
    expect(a).toBeGreaterThan(0)
  })
  it(`超過半徑 ${HIT_RADIUS} 找不到區塊就回 0，畫面外也是 0`, () => {
    const line = new Uint8Array(SIZE * SIZE).fill(1)
    for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) line[y * SIZE + x] = 0
    const m = buildRegionMap(line, SIZE)
    expect(regionAt(m, 20, 20)).toBe(0)
    expect(regionAt(m, 36, 50)).toBe(1) // 距離 4
    expect(regionAt(m, 20, 50)).toBe(0) // 距離 20
    expect(regionAt(m, -5, 10)).toBe(0)
    expect(regionAt(m, 500, 10)).toBe(0)
  })
  it('regionAnchor 回傳區塊內部的點', () => {
    for (const r of map.regions) {
      const [x, y] = regionAnchor(map, r.label)
      expect(map.labels[y * SIZE + x]).toBe(r.label)
    }
  })
})

describe('填色層（外擴與圖樣）', () => {
  const map = buildRegionMap(makeLine(SIZE), SIZE)
  it('填色往線條底下外擴 2px，區塊之間不留白縫', () => {
    expect(map.paint[10 * SIZE + 31]).toBe(1) // 線的左緣外擴到這裡
    expect(map.paint[10 * SIZE + 32]).toBe(1) // 線寬 2：x=32 被左邊外擴
    expect(map.paint[10 * SIZE + 33]).toBe(2)
    expect(dilateLabels(map.labels, SIZE, 0)).toEqual(map.labels)
  })
  it('paintAll：只有填了的區塊有顏色，其餘透明；純色與特殊填色都能畫', () => {
    const buf = paintAll(map, { r1: '#ff0000', r2: 'stripes:#00ff00', r3: 'rainbow', r4: 'glitter:#0000ff', bogus: '#123456' })
    const px = (x: number, y: number) => Array.from(buf.data.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4))
    expect(px(10, 10)).toEqual([255, 0, 0, 255])
    expect(px(50, 10)[3]).toBe(255)
    expect(px(10, 50)[3]).toBe(255)
    expect(px(50, 50)[3]).toBe(255)
    const empty = paintAll(map, {})
    expect(Array.from(empty.data.slice(0, 4))).toEqual([0, 0, 0, 0])
    // 重畫成別的顏色 / 清除
    paintRegion(buf, map, 1, '#00ff00')
    expect(px(10, 10)).toEqual([0, 255, 0, 255])
    paintRegion(buf, map, 1, undefined)
    expect(px(10, 10)[3]).toBe(0)
  })
  it('漣漪：只畫圓內的像素', () => {
    const buf = paintAll(map, {})
    paintRegion(buf, map, 1, '#ff0000', { x: 5, y: 5, r: 6 })
    const a = (x: number, y: number) => buf.data[(y * SIZE + x) * 4 + 3]
    expect(a(5, 5)).toBe(255)
    expect(a(25, 25)).toBe(0)
  })
  it('特殊填色是決定性的（同樣輸入、同樣像素）', () => {
    const fills = { r1: 'glitter:#ff8800', r2: 'dots:#8800ff', r3: 'stripes:#00aa44', r4: 'rainbow' }
    expect(Array.from(paintAll(map, fills).data)).toEqual(Array.from(paintAll(map, fills).data))
  })
})
