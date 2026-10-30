import { useState, type CSSProperties } from 'react'
import { artFallbacks } from '../../domain/species'

interface Props {
  /** public/art/<name>.png 的檔名（不含副檔名），例：obj-banana */
  name: string
  /** 替代文字；也用於載入失敗時的 fallback 標籤 */
  alt?: string
  className?: string
  /** 邊長（px 或 CSS 長度）；不給就由 className 控制 */
  size?: number | string
  style?: CSSProperties
  /** 圖片載入完成；src = 實際載入的那張（v7.5：缺圖時可能是備援的猴子圖，帽子要依它對位） */
  onLoad?: (src: string) => void
}

/**
 * 3D 公仔素材圖。載入失敗時顯示圓角色塊 + 名稱，版面不壞。
 * v7.5：兔兔、虎虎的寵物圖（pet-rabbit-*、pet-tiger-*）載入失敗時先換成猴子的同一張（domain/species.ts 的 artFallbacks），
 * 例如已經貼在作品上的兔兔貼紙、相簿卡，圖還沒生成也不會破圖。
 */
export function Art({ name, alt, className = '', size, style, onLoad }: Props) {
  // 失敗了幾次（= 用到備援清單的第幾張）；name 換了要歸零，所以連同 name 一起記
  const [fail, setFail] = useState<{ name: string; n: number }>({ name, n: 0 })
  const tries = fail.name === name ? fail.n : 0
  const chain = artFallbacks(name)
  const failed = tries >= chain.length
  const src = chain[Math.min(tries, chain.length - 1)]
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
      src={`${import.meta.env.BASE_URL}art/${src}.png`}
      alt={alt ?? ''}
      draggable={false}
      onError={() => setFail({ name, n: tries + 1 })}
      onLoad={onLoad ? () => onLoad(src) : undefined}
    />
  )
}
