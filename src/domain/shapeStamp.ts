/**
 * v7.4 I1：形狀章（圓、方、愛心）。蓋下去 = 一筆普通的向量筆畫（kind 'pen'，空心的外框），
 * 所以復原、橡皮擦、存檔、完成圖都不用新程式；外框封得起來，就能再用填色桶塗滿。
 */
export type ShapeKind = 'circle' | 'square' | 'heart'
export const SHAPES: { shape: ShapeKind; label: string }[] = [
  { shape: 'circle', label: '圓形' },
  { shape: 'square', label: '方形' },
  { shape: 'heart', label: '愛心' },
]
/** 點一下蓋出來的大小（半徑，座標空間 0–400）；拖曳可以拉大縮小 */
export const SHAPE_DEFAULT_R = 56
export const SHAPE_MIN_R = 14
export const SHAPE_MAX_R = 190

export const clampShapeR = (r: number): number => Math.min(SHAPE_MAX_R, Math.max(SHAPE_MIN_R, r))

const r1 = (n: number) => Math.round(n * 10) / 10

/** 一個封閉外框的點（最後一點 = 第一點）。中心 (cx, cy)、半徑 r（方形是半邊長；愛心的寬約 2r） */
export function shapePoints(shape: ShapeKind, cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = []
  if (shape === 'circle') {
    const n = 72
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      pts.push([r1(cx + Math.cos(a) * r), r1(cy + Math.sin(a) * r)])
    }
  } else if (shape === 'square') {
    // 每條邊多放幾個點：畫的時候用平滑曲線連，點太少四個角會被削圓
    const corners: [number, number][] = [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]]
    const per = 14
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k < per; k++) {
        const t = k / per
        pts.push([r1(cx + corners[e][0] + (corners[e + 1][0] - corners[e][0]) * t), r1(cy + corners[e][1] + (corners[e + 1][1] - corners[e][1]) * t)])
      }
    }
    pts.push([r1(cx + corners[4][0]), r1(cy + corners[4][1])])
  } else {
    // 經典愛心曲線：x = 16 sin³t，y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t（y 朝上，要翻成畫面座標）
    const n = 72
    const k = r / 16
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2
      const x = 16 * Math.sin(t) ** 3
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
      pts.push([r1(cx + x * k), r1(cy - (y - 2.5) * k)])
    }
  }
  return pts
}
