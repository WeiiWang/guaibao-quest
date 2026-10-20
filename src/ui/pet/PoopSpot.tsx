import type { CSSProperties } from 'react'
import type { Poop } from '../../domain/types'
import { Icon } from '../components/Icon'

interface Props {
  poop: Poop
  left: number
  top: number
  size: number
  z: number
  /** 剛長出來：從寵物身後彈出（動畫延遲對上「噗」那一刻） */
  fresh: boolean
  /** 從寵物身後出來的水平距離（px，往右為正） */
  from: number
  popping: boolean
  disabled: boolean
  /** 偶爾有一隻蒼蠅 */
  fly: boolean
  onClean: () => void
}

/** 一坨可愛的卡通便便：綠色臭臭線、偶爾一隻蒼蠅；點一下用泡泡包起來「啵」一聲消失。 */
export function PoopSpot({ poop, left, top, size, z, fresh, from, popping, disabled, fly, onClean }: Props) {
  return (
    <button
      className={`pf-poop ${fresh ? 'fresh' : ''} ${popping ? 'popping' : ''}`}
      data-testid="poop"
      data-poop-id={poop.id}
      data-nodrag
      disabled={disabled || popping}
      aria-label="清理便便"
      style={{ left, top, width: size, height: size, zIndex: z, '--from': `${from}px` } as CSSProperties}
      onClick={onClean}
    >
      <span className="pf-stink" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <Icon name="poop" emoji="💩" alt="" className="pf-poop-img" />
      {fly && <span className="pf-fly" aria-hidden />}
      <span className="pf-wrap" aria-hidden />
    </button>
  )
}

/** 便便被清掉時，在原位閃一下小星星 */
export function PoopBurst({ left, top, z }: { left: number; top: number; z: number }) {
  return (
    <div className="pf-burst" style={{ left, top, zIndex: z }} aria-hidden data-testid="poop-burst">
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <i key={a} style={{ '--a': `${a}deg` } as CSSProperties}>✦</i>
      ))}
    </div>
  )
}
