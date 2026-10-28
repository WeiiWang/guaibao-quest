/**
 * 畫板的縮放與平移（v7）。放大只影響顯示，存檔的座標一律是著色頁座標空間（0–400）。
 *
 * view = { z, ox, oy }：z = 放大倍率（1–3）；(ox, oy) = 目前視窗左上角在「整張畫」裡的位置（0–1 的比例）。
 * 視窗看到的範圍是 [ox, ox + 1/z] × [oy, oy + 1/z]。
 */
export interface View {
  z: number
  ox: number
  oy: number
}
export const ZOOM_MIN = 1
export const ZOOM_MAX = 3
export const ZOOM_STEPS = [1, 2, 3] as const
export const VIEW_HOME: View = { z: 1, ox: 0, oy: 0 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const clampZoom = (z: number): number => clamp(Number.isFinite(z) ? z : 1, ZOOM_MIN, ZOOM_MAX)

/** 倍率限制在 1–3，視窗不能超出畫面 */
export function clampView(v: View): View {
  const z = clampZoom(v.z)
  const max = 1 - 1 / z
  return { z, ox: clamp(v.ox, 0, max), oy: clamp(v.oy, 0, max) }
}

/** 視窗上的位置（fx, fy 是 0–1，相對視窗）對應到整張畫的位置（0–1） */
export const viewToUnit = (v: View, fx: number, fy: number): [number, number] => [v.ox + fx / v.z, v.oy + fy / v.z]

/**
 * 螢幕座標 → 整張畫的 0–1 位置。rect 是「視窗」（不含放大的那一層）在螢幕上的矩形。
 * 例：1× 時就是點在視窗內的相對位置；2× 且 ox=0.5 時，視窗最左邊 = 畫的正中間。
 */
export function clientToUnit(v: View, rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): [number, number] {
  return viewToUnit(v, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height)
}
/** 反過來：整張畫的 0–1 位置 → 螢幕座標 */
export function unitToClient(v: View, rect: { left: number; top: number; width: number; height: number }, ux: number, uy: number): [number, number] {
  return [rect.left + (ux - v.ox) * v.z * rect.width, rect.top + (uy - v.oy) * v.z * rect.height]
}

/** 縮放到 newZ，並讓視窗上 (fx, fy) 那一點底下的畫面位置不動（雙指縮放、按鈕縮放都用這個） */
export function zoomAt(v: View, newZ: number, fx = 0.5, fy = 0.5): View {
  const z = clampZoom(newZ)
  const [ux, uy] = viewToUnit(v, fx, fy)
  return clampView({ z, ox: ux - fx / z, oy: uy - fy / z })
}

/** 平移：視窗內的手指移動了 (dfx, dfy)（視窗寬度的比例）。手指往右拖 = 畫面跟著往右 = 視窗往左 */
export function panBy(v: View, dfx: number, dfy: number): View {
  return clampView({ ...v, ox: v.ox - dfx / v.z, oy: v.oy - dfy / v.z })
}

/** 讓 (ux, uy)（整張畫的位置）成為視窗正中央 */
export function centerOn(v: View, ux: number, uy: number): View {
  return clampView({ ...v, ox: ux - 0.5 / v.z, oy: uy - 0.5 / v.z })
}

/** 小地圖上的視窗框（0–1，相對整張畫） */
export const minimapRect = (v: View) => ({ x: v.ox, y: v.oy, w: 1 / v.z, h: 1 / v.z })

/** 放大一階 / 縮小一階（1× → 2× → 3×）。目前的倍率不在整數上就靠到最近的下一階 */
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.05) ?? ZOOM_MAX
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.05) ?? ZOOM_MIN
}

/** 雙指手勢：開始時的兩指距離 d0、中心 c0（視窗比例）、view0；現在的 d、c → 新的 view */
export function pinchView(view0: View, d0: number, c0: [number, number], d: number, c: [number, number]): View {
  const z = clampZoom(view0.z * (d / Math.max(d0, 1e-6)))
  // 開始時 c0 底下的畫面位置，要跟著中心移到 c
  const [ux, uy] = viewToUnit(view0, c0[0], c0[1])
  return clampView({ z, ox: ux - c[0] / z, oy: uy - c[1] / z })
}
