import { describe, expect, it } from 'vitest'
import { computeFill, dilate, floodRegion, FLOOD_TOL } from './flood'

const W = 208 // 約 0.5 像素 / 座標單位（416 單位 → 208 像素）
/** 透明底、畫一個圓環（黑、不透明）；gapPx > 0 時在最右邊（角度 0）留一個缺口 */
function ring(r: number, thick: number, gapPx = 0, cx = 104, cy = 104): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * W * 4)
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const dist = Math.hypot(x - cx, y - cy)
      if (Math.abs(dist - r) > thick / 2) continue
      if (gapPx > 0 && x > cx && Math.abs(y - cy) < gapPx / 2) continue
      const i = (y * W + x) * 4
      d[i + 3] = 255
    }
  return d
}
const count = (m: Uint8Array) => m.reduce((a, b) => a + b, 0)
const at = (m: Uint8Array, x: number, y: number) => m[y * W + x]

describe('v7.4 I1：填色桶 flood fill', () => {
  it('dilate：往外長 g 格（方形）', () => {
    const src = new Uint8Array(9 * 9)
    src[4 * 9 + 4] = 1
    const out = dilate(src, 9, 2)
    expect(count(out)).toBe(25)
    expect(out[2 * 9 + 2]).toBe(1)
    expect(out[1 * 9 + 1]).toBe(0)
    expect(count(dilate(src, 9, 0))).toBe(1)
  })
  it('floodRegion：被牆圍住的區塊，不漏就 leaks = false；種子在牆上回 null', () => {
    const w = 8
    const bl = new Uint8Array(w * w)
    for (let i = 2; i <= 5; i++) {
      bl[2 * w + i] = bl[5 * w + i] = 1
      bl[i * w + 2] = bl[i * w + 5] = 1
    }
    const r = floodRegion(bl, w, 3, 3)
    expect(r && r.leaks).toBe(false)
    expect(r && r.count).toBe(4)
    const out = floodRegion(bl, w, 0, 0)
    expect(out && out.leaks).toBe(true)
    expect(floodRegion(bl, w, 2, 2)).toBeNull()
  })
  it('封閉的圈：點裡面只填裡面（外面不動）', () => {
    const d = ring(60, 6)
    const r = computeFill(d, W, 104, 104)!
    expect(r.leaks).toBe(false)
    expect(at(r.fill, 104, 104)).toBe(1)
    expect(at(r.fill, 104, 104 - 50)).toBe(1) // 靠近線的裡面
    expect(at(r.fill, 2, 2)).toBe(0) // 外面
    expect(at(r.fill, 104, 104 - 60)).toBe(0) // 線本身不蓋
    const inside = Math.PI * 57 * 57
    expect(count(r.fill)).toBeGreaterThan(inside * 0.9)
    expect(count(r.fill)).toBeLessThan(Math.PI * 63 * 63)
  })
  it('防漏：手畫的圈有小缺口（≤ 約 6 單位）也封得住，缺口大到封不住才算漏', () => {
    // 4 像素 ≈ 8 單位：用較大的防漏距離封起來；填色不會跑到外面
    const small = computeFill(ring(60, 6, 4), W, 104, 104)!
    expect(small.leaks).toBe(false)
    expect(at(small.fill, 2, 2)).toBe(0)
    expect(at(small.fill, 104, 104)).toBe(1)
    // 大缺口（18 像素 ≈ 36 單位）：封不住，填色漏到外面（= 背景）
    const big = computeFill(ring(60, 6, 18), W, 104, 104)!
    expect(big.leaks).toBe(true)
    expect(at(big.fill, 2, 2)).toBe(1)
  })
  it('點在圈外：填整個外面（碰到畫布邊緣 = leaks）', () => {
    const r = computeFill(ring(60, 6), W, 5, 5)!
    expect(r.leaks).toBe(true)
    expect(at(r.fill, 104, 104)).toBe(0)
  })
  it('點得很靠近線（種子被防漏撐掉）：退回小距離，仍然填得到那一小塊', () => {
    const r = computeFill(ring(60, 6), W, 104, 104 - 55)!
    expect(r.fill[(104 - 55) * W + 104]).toBe(1)
    expect(r.leaks).toBe(false)
  })
  it('再換色：點在已填色的區塊上，範圍是同色的那一塊（線是牆）', () => {
    const d = ring(60, 6)
    const first = computeFill(d, W, 104, 104)!
    for (let p = 0; p < W * W; p++)
      if (first.fill[p]) {
        d[p * 4] = 230
        d[p * 4 + 1] = 100
        d[p * 4 + 2] = 100
        d[p * 4 + 3] = 255
      }
    const again = computeFill(d, W, 104, 104)!
    expect(again.leaks).toBe(false)
    expect(count(again.fill)).toBeGreaterThan(count(first.fill) * 0.95)
    expect(at(again.fill, 2, 2)).toBe(0)
  })
  it('容差：透明度在容差內的邊緣像素算空白，不當成牆', () => {
    const d = ring(60, 6)
    // 在圈外放一個很淡的雜點（alpha ≤ FLOOD_TOL）：不影響外面的區塊
    d[(10 * W + 10) * 4 + 3] = FLOOD_TOL
    const r = computeFill(d, W, 5, 5)!
    expect(at(r.fill, 10, 10)).toBe(1)
  })
})
