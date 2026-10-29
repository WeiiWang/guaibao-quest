import type { CSSProperties } from 'react'
import { Art } from './Art'
import { useArtStatuses } from '../artProbe'
import { artFallbacks } from '../../domain/species'

interface Props {
  name: string
  /** 缺圖時顯示的 emoji；不給就走 Art 的色塊 fallback */
  emoji?: string
  alt?: string
  className?: string
  size?: number | string
  style?: CSSProperties
  /** v7.5：不要退回猴子的同一張（選寵物那頁：兔兔沒圖就顯示 🐰，不能顯示猴子） */
  exact?: boolean
}

/** 小圖示：有 3D 素材就用素材，沒有就顯示 emoji（不會破版、也不會是一塊文字）。 */
export function Icon({ name, emoji, alt, className = '', size, style, exact = false }: Props) {
  // v7.5：兔兔、虎虎的寵物圖缺圖時先用猴子的同一張，再退回 emoji
  const chain = exact ? [name] : artFallbacks(name)
  const st = useArtStatuses(chain)
  const at = st.findIndex((s) => s !== 'no')
  const status = at < 0 ? 'no' : st[at]
  const shown = at < 0 ? name : chain[at]
  const dim = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size
  if (emoji && status !== 'ok') {
    // emoji 大小跟著容器走（cqmin），所以 size 可以是 px、% 或交給 CSS class
    return (
      <span
        className={`art-emoji ${className}`}
        style={{ width: dim, height: dim, ...style }}
        {...(status === 'no' ? { role: 'img', 'aria-label': alt ?? name } : { 'aria-hidden': true })}
      >
        <span className="art-emoji-glyph">{status === 'no' ? emoji : ''}</span>
      </span>
    )
  }
  return <Art name={shown} alt={alt} className={className} size={size} style={style} />
}
