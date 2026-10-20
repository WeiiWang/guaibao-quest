import type { ReactNode } from 'react'
import { useBalance } from '../hooks'
import { Icon } from './Icon'

export function PointsChip() {
  const b = useBalance()
  return (
    <span className="points-chip" data-points-chip aria-label={`目前點數 ${b}`}>
      <Icon name="ui-star" emoji="⭐" size={26} className="chip-icon" />
      <span className="chip-num">{b}</span>
    </span>
  )
}

export function ScreenHeader({ title, onBack, right, backLabel = '回首頁' }: { title: string; onBack: () => void; right?: ReactNode; backLabel?: string }) {
  return (
    <header className="screen-header">
      <button className="btn back" onClick={onBack}>
        <span className="back-arrow" aria-hidden>‹</span>
        {backLabel.replace(/^←\s*/, '')}
      </button>
      <h1>{title}</h1>
      <div className="header-right">{right ?? <PointsChip />}</div>
    </header>
  )
}
