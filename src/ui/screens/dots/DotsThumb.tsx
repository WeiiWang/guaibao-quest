import { useMemo } from 'react'
import { dotsItem, dotsPoints, silhouettePath, type DotsLevel } from '../../../art/dots/dots'
import { VIEWBOX } from '../../../art/coloring/render'

/** 連連看卡片上的小預覽：還沒連完是淡淡的剪影加上點與已連的線；連完了就是 3D 圖 */
export function DotsThumb({ name, level, at, done, className = '' }: { name: string; level: DotsLevel; at: number; done: boolean; className?: string }) {
  const it = dotsItem(name)
  const dots = useMemo(() => dotsPoints(name, level), [name, level])
  const sil = useMemo(() => silhouettePath(name), [name])
  if (!it) return null
  const line = dots.slice(0, Math.max(0, at)).map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('')
  const [x, y, w, h] = it.img
  return (
    <svg className={`dt-thumb ${className}`} viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.size} ${VIEWBOX.size}`} role="img" aria-label={name} data-testid="dots-thumb" data-done={done ? '1' : '0'}>
      {done ? (
        <image href={`${import.meta.env.BASE_URL}art/${name}.png`} x={x} y={y} width={w} height={h} />
      ) : (
        <>
          <path d={sil} fill="#f4effe" stroke="#d9cdf7" strokeWidth={5} strokeLinejoin="round" />
          {line && <path d={line} fill="none" stroke="#8a73db" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />}
          {dots.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={i < at ? 8 : 6} fill={i < at ? '#8a73db' : '#fff'} stroke="#8a73db" strokeWidth={3.5} />
          ))}
        </>
      )}
    </svg>
  )
}
