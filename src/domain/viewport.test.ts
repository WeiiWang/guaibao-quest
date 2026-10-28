import { describe, expect, it } from 'vitest'
import { centerOn, clampView, clampZoom, clientToUnit, minimapRect, panBy, pinchView, stepZoom, unitToClient, VIEW_HOME, viewToUnit, zoomAt } from './viewport'
import { fromUnit, toUnit } from '../art/coloring/render'

const rect = { left: 100, top: 50, width: 400, height: 400 }
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe('縮放與平移的座標換算', () => {
  it('1× 時：螢幕位置就是視窗內的相對位置', () => {
    const [ux, uy] = clientToUnit(VIEW_HOME, rect, 300, 250)
    close(ux, 0.5)
    close(uy, 0.5)
    const [a, b] = clientToUnit(VIEW_HOME, rect, 100, 50)
    close(a, 0)
    close(b, 0)
  })

  it('2× 且視窗在左上角：視窗右下角 = 畫的正中間', () => {
    const v = { z: 2, ox: 0, oy: 0 }
    const [ux, uy] = clientToUnit(v, rect, 500, 450)
    close(ux, 0.5)
    close(uy, 0.5)
  })

  it('2× 且視窗在右下角（ox = oy = 0.5）：視窗左上角 = 畫的正中間，右下角 = 畫的右下角', () => {
    const v = { z: 2, ox: 0.5, oy: 0.5 }
    const [a, b] = clientToUnit(v, rect, 100, 50)
    close(a, 0.5)
    close(b, 0.5)
    const [c, d] = clientToUnit(v, rect, 500, 450)
    close(c, 1)
    close(d, 1)
  })

  it('3× 任意位置：clientToUnit 與 unitToClient 互為反函數', () => {
    const v = { z: 3, ox: 0.31, oy: 0.12 }
    for (const [cx, cy] of [[120, 80], [333, 222], [499, 449]]) {
      const [ux, uy] = clientToUnit(v, rect, cx, cy)
      const [bx, by] = unitToClient(v, rect, ux, uy)
      close(bx, cx)
      close(by, cy)
    }
  })

  it('換算回著色頁座標空間（0–400）：放大前後手指指到同一處的座標不變', () => {
    // 視窗中心在 1× 時指到座標 (200, 200)；放大到 3× 並以中心為準，同一個螢幕位置仍然是 (200, 200)
    const v1 = VIEW_HOME
    const v3 = zoomAt(v1, 3, 0.5, 0.5)
    const [x1, y1] = clientToUnit(v1, rect, 300, 250).map(fromUnit)
    const [x3, y3] = clientToUnit(v3, rect, 300, 250).map(fromUnit)
    close(x1, 200)
    close(y1, 200)
    close(x3, 200)
    close(y3, 200)
    // 放大後視窗左上角指到的座標往中間靠
    const [lx] = clientToUnit(v3, rect, 100, 50).map(fromUnit)
    expect(lx).toBeGreaterThan(100)
  })

  it('zoomAt：視窗上 (fx, fy) 那一點底下的畫面位置不動', () => {
    const v0 = { z: 1.5, ox: 0.2, oy: 0.1 }
    const before = viewToUnit(v0, 0.8, 0.3)
    const v1 = zoomAt(v0, 2.4, 0.8, 0.3)
    const after = viewToUnit(v1, 0.8, 0.3)
    close(before[0], after[0])
    close(before[1], after[1])
  })

  it('視窗不會超出畫面：縮回 1× 一定回到 (0, 0)；平移被限制在邊界內', () => {
    expect(zoomAt({ z: 3, ox: 0.6, oy: 0.6 }, 1, 0.5, 0.5)).toEqual({ z: 1, ox: 0, oy: 0 })
    const far = panBy({ z: 2, ox: 0.4, oy: 0.4 }, -5, -5)
    expect(far).toEqual({ z: 2, ox: 0.5, oy: 0.5 })
    const back = panBy({ z: 2, ox: 0.1, oy: 0.1 }, 5, 5)
    expect(back).toEqual({ z: 2, ox: 0, oy: 0 })
    const cv = clampView({ z: 99, ox: -3, oy: 7 })
    expect(cv.z).toBe(3)
    expect(cv.ox).toBe(0)
    close(cv.oy, 2 / 3)
  })

  it('panBy：手指往右拖，視窗往左（看到比較左邊的畫面）', () => {
    const v = panBy({ z: 2, ox: 0.3, oy: 0.3 }, 0.1, -0.1)
    close(v.ox, 0.25)
    close(v.oy, 0.35)
  })

  it('倍率限制 1–3，壞數字當 1', () => {
    expect(clampZoom(0.2)).toBe(1)
    expect(clampZoom(7)).toBe(3)
    expect(clampZoom(NaN)).toBe(1)
  })

  it('stepZoom：1× → 2× → 3×，反向亦然；不在整數上靠到下一階', () => {
    expect(stepZoom(1, 1)).toBe(2)
    expect(stepZoom(2, 1)).toBe(3)
    expect(stepZoom(3, 1)).toBe(3)
    expect(stepZoom(3, -1)).toBe(2)
    expect(stepZoom(1, -1)).toBe(1)
    expect(stepZoom(1.4, 1)).toBe(2)
    expect(stepZoom(1.4, -1)).toBe(1)
  })

  it('小地圖的視窗框：大小 = 1/z，位置 = (ox, oy)', () => {
    expect(minimapRect({ z: 2, ox: 0.5, oy: 0.25 })).toEqual({ x: 0.5, y: 0.25, w: 0.5, h: 0.5 })
    expect(minimapRect(VIEW_HOME)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('centerOn：把某個位置放到視窗正中央，邊緣會被夾住', () => {
    const v = centerOn({ z: 2, ox: 0, oy: 0 }, 0.5, 0.5)
    close(v.ox, 0.25)
    close(v.oy, 0.25)
    expect(centerOn({ z: 2, ox: 0, oy: 0 }, 1, 1)).toEqual({ z: 2, ox: 0.5, oy: 0.5 })
    expect(centerOn({ z: 2, ox: 0.5, oy: 0.5 }, 0, 0)).toEqual({ z: 2, ox: 0, oy: 0 })
  })

  it('雙指：兩指距離變兩倍 → 倍率變兩倍；中心不動時兩指中心底下的畫面位置不動', () => {
    const v0 = { z: 1, ox: 0, oy: 0 }
    const c: [number, number] = [0.7, 0.4]
    const v = pinchView(v0, 0.2, c, 0.4, c)
    close(v.z, 2)
    const [bx, by] = viewToUnit(v0, c[0], c[1])
    const [ax, ay] = viewToUnit(v, c[0], c[1])
    close(ax, bx)
    close(ay, by)
  })

  it('雙指平移：中心移動，畫面跟著手指走', () => {
    const v0 = { z: 2, ox: 0.25, oy: 0.25 }
    const v = pinchView(v0, 0.3, [0.5, 0.5], 0.3, [0.4, 0.5])
    // 手指往左 0.1 視窗寬 → 視窗往右 0.05 畫面寬
    close(v.ox, 0.3)
    close(v.oy, 0.25)
  })

  it('座標空間：toUnit / fromUnit 與縮放換算合起來，放大 3× 的中心點仍是 (200,200)', () => {
    close(fromUnit(toUnit(123.4)), 123.4)
    const v = zoomAt({ z: 1, ox: 0, oy: 0 }, 3, 0.5, 0.5)
    const [ux, uy] = viewToUnit(v, 0.5, 0.5)
    close(fromUnit(ux), 200)
    close(fromUnit(uy), 200)
  })
})
