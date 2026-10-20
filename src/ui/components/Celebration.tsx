import { useEffect, useState } from 'react'
import { PetSprite } from './PetSprite'
import type { CelebrateInfo } from '../hooks'

/** 全螢幕孵化 / 進化慶祝：舊型態 → 閃光 → 新型態 */
export function Celebration({ info, onClose }: { info: CelebrateInfo; onClose: () => void }) {
  const [phase, setPhase] = useState<'old' | 'burst' | 'new'>('old')
  useEffect(() => {
    const a = window.setTimeout(() => setPhase('burst'), 1500)
    const b = window.setTimeout(() => setPhase('new'), 2000)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [])
  const hatched = info.to === 'baby'
  const text = hatched ? `哇！${info.petName}孵出來了！` : `${info.petName}長大了！`
  const stage = phase === 'new' ? info.to : info.from
  const pet = { stage, feedCount: phase === 'new' ? info.feedCount : Math.max(0, info.feedCount - 1), name: info.petName }
  return (
    <div className="celebrate" role="dialog" aria-modal="true" aria-label={text}>
      <div className={`celebrate-stage phase-${phase}`}>
        <div className="rays" aria-hidden />
        <div className="celebrate-pet">
          <PetSprite pet={pet} mood="happy" pose={phase === 'new' ? 'cheer' : undefined} className={phase === 'old' ? 'shake-hard' : phase === 'new' ? 'pop-in cheer' : ''} />
        </div>
        <div className="flash" aria-hidden />
        {phase === 'new' && (
          <div className="confetti" aria-hidden>
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 5) * 0.12}s`, background: ['#FF8FB1', '#FFD66B', '#7FD6B4', '#8EC9F5', '#B9A6F5'][i % 5] }} />
            ))}
          </div>
        )}
      </div>
      <p className={`celebrate-text ${phase === 'new' ? 'show' : ''}`}>{text}</p>
      {phase === 'new' && (
        <button className="btn primary celebrate-btn" onClick={onClose} autoFocus>太棒了</button>
      )}
    </div>
  )
}
