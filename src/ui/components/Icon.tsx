import type { CSSProperties } from 'react'
import { Art } from './Art'
import { useArtStatus } from '../artProbe'

interface Props {
  name: string
  /** 缺圖時顯示的 emoji；不給就走 Art 的色塊 fallback */
  emoji?: string
  alt?: string
  className?: string
  size?: number | string
  style?: CSSProperties
}

/** 小圖示：有 3D 素材就用素材，沒有就顯示 emoji（不會破版、也不會是一塊文字）。 */
export function Icon({ name, emoji, alt, className = '', size, style }: Props) {
  const status = useArtStatus(name)
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
  return <Art name={name} alt={alt} className={className} size={size} style={style} />
}
