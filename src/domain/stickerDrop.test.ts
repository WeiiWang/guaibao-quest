import { describe, expect, it } from 'vitest'
import { stickerDropPoint } from './stickerDrop'
import { VIEW_HOME, zoomAt, type View } from './viewport'
import { unitToClient } from './viewport'
import { toUnit } from '../art/coloring/render'

const rect = { left: 100, top: 50, width: 400, height: 400 }
const near = (a: [number, number] | null, x: number, y: number) => {
  expect(a).not.toBeNull()
  expect(Math.abs(a![0] - x)).toBeLessThan(0.01)
  expect(Math.abs(a![1] - y)).toBeLessThan(0.01)
}

describe('D1 貼紙拖進畫布：放開的位置 → 貼紙座標', () => {
  it('1×：畫板正中間 = 座標空間正中間（200, 200）', () => {
    near(stickerDropPoint(VIEW_HOME, rect, 300, 250), 200, 200)
  })
  it('1×：左上角 = 座標空間的 (−8, −8) 夾到 0，右下角夾到 400', () => {
    expect(stickerDropPoint(VIEW_HOME, rect, 100, 50)).toEqual([0, 0])
    expect(stickerDropPoint(VIEW_HOME, rect, 500, 450)).toEqual([400, 400])
  })
  it('放在畫板外 = 取消（null）', () => {
    expect(stickerDropPoint(VIEW_HOME, rect, 99, 250)).toBeNull()
    expect(stickerDropPoint(VIEW_HOME, rect, 300, 449 + 2)).toBeNull()
    expect(stickerDropPoint(VIEW_HOME, rect, 700, 250)).toBeNull()
    expect(stickerDropPoint(VIEW_HOME, { left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBeNull()
  })
  it('放大 2× 並平移：貼在手指下方那個點（以畫面的座標驗證，不是視窗座標）', () => {
    const v: View = { z: 2, ox: 0.5, oy: 0.25 } // 視窗看到右半邊、上方 1/4 之後的一半
    // 想貼在座標空間 (300, 150)：算出它在螢幕上的位置，再丟回去應該得到同一個點
    const [cx, cy] = unitToClient(v, rect, toUnit(300), toUnit(150))
    near(stickerDropPoint(v, rect, cx, cy), 300, 150)
    // 視窗正中間 = 視窗左上 + 1/(2z)
    near(stickerDropPoint(v, rect, 300, 250), 0.75 * 416 - 8, 0.5 * 416 - 8) // = (304, 200)
  })
  it('放大 3× 之後貼到最角落也不會超出 0–400', () => {
    const v = zoomAt(zoomAt(VIEW_HOME, 3, 1, 1), 3, 1, 1)
    const p = stickerDropPoint(v, rect, 500, 450)
    expect(p).not.toBeNull()
    expect(p![0]).toBeLessThanOrEqual(400)
    expect(p![1]).toBeLessThanOrEqual(400)
    expect(p![0]).toBeGreaterThan(300)
  })
})
