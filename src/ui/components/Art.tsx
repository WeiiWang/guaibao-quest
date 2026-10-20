import { useState, type CSSProperties } from 'react'

interface Props {
  /** public/art/<name>.png 的檔名（不含副檔名），例：obj-banana */
  name: string
  /** 替代文字；也用於載入失敗時的 fallback 標籤 */
  alt?: string
  className?: string
  /** 邊長（px 或 CSS 長度）；不給就由 className 控制 */
  size?: number | string
  style?: CSSProperties
}

/** 3D 公仔素材圖。載入失敗時顯示圓角色塊 + 名稱，版面不壞。 */
export function Art({ name, alt, className = '', size, style }: Props) {
  const [failed, setFailed] = useState(false)
  const dim = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size
  const box: CSSProperties = { width: dim, height: dim, ...style }
  if (failed) {
    return (
      <span className={`art art-fallback ${className}`} style={box} role="img" aria-label={alt ?? name}>
        {alt ?? name}
      </span>
    )
  }
  return (
    <img
      className={`art ${className}`}
      style={{ ...box, objectFit: 'contain' }}
      src={`${import.meta.env.BASE_URL}art/${name}.png`}
      alt={alt ?? ''}
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}
