// v8 線 O：自己畫的小圖示（SVG），和 3D 糖果按鈕同一個語言：白色粗線 + 深色描邊，取代 emoji（👈 👉 👇）
import type { CSSProperties } from 'react'

/** 左右看房間的箭頭：粗圓角的「>」，白色填色加一圈深色描邊（和糖果按鈕上的字同一種做法） */
export function ChevronIcon({ dir, className = '' }: { dir: 'left' | 'right'; className?: string }) {
  const style: CSSProperties | undefined = dir === 'left' ? { transform: 'scaleX(-1)' } : undefined
  return (
    <svg className={`o8-chevron ${className}`} viewBox="0 0 48 48" aria-hidden focusable="false" style={style}>
      <path d="M17 9 L32 24 L17 39" fill="none" stroke="var(--o8-chev-edge, #3b8fd6)" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 9 L32 24 L17 39" fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 往下指的粗箭頭（提示條、首次引導用）：圓潤的水滴形箭頭，不是 emoji 手指 */
export function DownArrowIcon({ className = '', size }: { className?: string; size?: number | string }) {
  return (
    <svg className={`o8-down ${className}`} viewBox="0 0 48 56" width={size} height={size} aria-hidden focusable="false">
      <path d="M17 4 H31 V26 H40 L24 50 L8 26 H17 Z" fill="var(--o8-arrow-edge, #23805e)" stroke="var(--o8-arrow-edge, #23805e)" strokeWidth="11" strokeLinejoin="round" />
      <path d="M17 4 H31 V26 H40 L24 50 L8 26 H17 Z" fill="#fff" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
