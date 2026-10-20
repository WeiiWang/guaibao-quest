import type { DecorSlot, Placement } from './types'

/** 房間邏輯寬度 = 可視寬度 × 2.5，高度不變 */
export const ROOM_WIDTH_FACTOR = 2.5
/** 房間高度對應多少像素格（決定道具大小；與螢幕寬度無關） */
export const ROOM_CELLS_H = 88
/** 牆面與地板的分界（佔房間高度比例） */
export const FLOOR_TOP = 0.62
/** 寵物位置（x 為中心、bottom 為腳底，皆為比例） */
export const PET_X = 0.3
export const PET_BOTTOM = 0.9
export const EDGE_SCROLL_ZONE = 40
export const EDGE_SCROLL_MAX = 16
export const DRAG_START_PX = 6

export interface Size {
  w: number
  h: number
}
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export const cellPx = (roomH: number) => roomH / ROOM_CELLS_H
export const spritePx = (cols: number, rows: number, roomH: number): Size => ({
  w: cols * cellPx(roomH),
  h: rows * cellPx(roomH),
})

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))

/**
 * 把裝飾中心點 (x,y)（比例）限制在合法範圍。
 * wf/hf 為裝飾寬高占房間寬/高的比例。
 * - 整體都不可超出房間
 * - wall：整件要在牆面區（y < FLOOR_TOP）
 * - floor：腳底（下緣）要落在地板區，上半身可以高過地板線（書架、盆栽）
 */
export function clampPlacement(
  slot: DecorSlot,
  x: number,
  y: number,
  wf: number,
  hf: number,
): { x: number; y: number } {
  const hw = wf / 2
  const hh = hf / 2
  const cx = clamp(x, hw, 1 - hw)
  let cy: number
  if (slot === 'wall') {
    cy = clamp(y, hh, FLOOR_TOP - 0.01 - hh)
  } else {
    cy = clamp(y, Math.max(hh, FLOOR_TOP + 0.04 - hh), 1 - hh)
  }
  return { x: cx, y: cy }
}

export const toFrac = (px: number, py: number, roomW: number, roomH: number) => ({
  x: px / roomW,
  y: py / roomH,
})

export function inRect(px: number, py: number, r: Rect, pad = 0): boolean {
  return px >= r.left - pad && px <= r.right + pad && py >= r.top - pad && py <= r.bottom + pad
}

/** 拖曳時，指標離可視區左右緣多近就自動捲動；回傳每幀 px（負 = 往左） */
export function autoScrollSpeed(
  pointerX: number,
  viewLeft: number,
  viewWidth: number,
  zone = EDGE_SCROLL_ZONE,
  max = EDGE_SCROLL_MAX,
): number {
  const fromLeft = pointerX - viewLeft
  const fromRight = viewLeft + viewWidth - pointerX
  if (fromLeft < zone) return -max * Math.min(1, (zone - fromLeft) / zone)
  if (fromRight < zone) return max * Math.min(1, (zone - fromRight) / zone)
  return 0
}

export interface DepthEntry {
  id: string
  /** 物件下緣 y（比例） */
  bottom: number
  z: number
}

/** 圖層順序：先看 z（移到最前），再看下緣 y（越下面越前面） */
export function renderOrder<T extends DepthEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => a.z - b.z || a.bottom - b.bottom || a.id.localeCompare(b.id))
}

export const nextFrontZ = (placements: readonly Pick<Placement, 'z'>[]) =>
  Math.max(0, ...placements.map((p) => p.z)) + 1
