import { shapePoints, type ShapeKind } from '../../../domain/shapeStamp'

/** 形狀章按鈕上的圖：空心的外框（和蓋出來的樣子一樣） */
export function ShapeIcon({ shape, color, size = 40 }: { shape: ShapeKind; color: string; size?: number }) {
  const pts = shapePoints(shape, 20, 20, shape === 'square' ? 14 : 15)
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')
  return (
    <svg className="i74-shape-ico" viewBox="0 0 40 40" width={size} height={size} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** 填色桶說明圖：外框裡塗了一半 */
export function BucketHint({ color }: { color: string }) {
  return (
    <svg className="i74-bucket-ico" viewBox="0 0 64 44" width="64" height="44" aria-hidden>
      <circle cx="22" cy="22" r="17" fill="#fff" stroke="#4a3b35" strokeWidth="3" />
      <path d="M22 5a17 17 0 0 1 0 34z" fill={color} />
      <circle cx="22" cy="22" r="17" fill="none" stroke="#4a3b35" strokeWidth="3" />
      <path d="M44 22h14m-5-5 5 5-5 5" fill="none" stroke="#7a52c8" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
