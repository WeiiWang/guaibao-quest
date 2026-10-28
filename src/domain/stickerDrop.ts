import { clientToUnit, type View } from './viewport'
import { clampStickerPos } from './coloring'
import { fromUnit } from '../art/coloring/render'

export interface DropRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * D1：貼紙從托盤拖進畫布，放開的螢幕位置 → 貼紙的位置（座標空間 0–400）。
 * rect = 畫板「視窗」在螢幕上的矩形（不含放大的那一層）；view = 目前的放大與平移。
 * 放在視窗外回傳 null（= 取消，不貼）。放大時視窗只看到畫的一部分，座標要經過 view 換算，所以貼在手指下方那個點。
 */
export function stickerDropPoint(view: View, rect: DropRect, clientX: number, clientY: number): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  if (clientX < rect.left || clientX > rect.left + rect.width || clientY < rect.top || clientY > rect.top + rect.height) return null
  const [ux, uy] = clientToUnit(view, rect, clientX, clientY)
  return [clampStickerPos(fromUnit(ux)), clampStickerPos(fromUnit(uy))]
}
