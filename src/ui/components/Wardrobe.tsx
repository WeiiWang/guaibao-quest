import { HATS, hatEmptyLine } from '../../domain/hats'
import { sayText } from '../../learning/speech'
import { useEffect } from 'react'
import { Icon } from './Icon'
import '../wardrobe.css'

interface Props {
  petName: string
  /** 擁有的帽子 id */
  owned: string[]
  /** 目前戴著的帽子 */
  wearing: string | undefined
  voiceOn: boolean
  /** 選了一頂（hatId）或拿下（null） */
  onPick: (hatId: string | null) => void
  onClose: () => void
  goShop: () => void
}

/** 首頁的衣櫃：換戴或拿下帽子。擁有的帽子可以點；還沒有的灰灰的，標出要幾顆星星 */
export function Wardrobe({ petName, owned, wearing, voiceOn, onPick, onClose, goShop }: Props) {
  useEffect(() => {
    if (owned.length === 0) sayText(hatEmptyLine(), { enabled: voiceOn })
    // 只在打開時說一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="wd-back" role="presentation" onClick={onClose} data-testid="wardrobe-back">
      <div className="wd-sheet" role="dialog" aria-modal="true" aria-label={`${petName}的衣櫃`} data-testid="wardrobe" onClick={(e) => e.stopPropagation()}>
        <div className="wd-head">
          <h2>{petName}的衣櫃</h2>
          <button className="wd-close" onClick={onClose} aria-label="關起來" data-testid="wardrobe-close">✕</button>
        </div>
        <ul className="wd-grid">
          <li>
            <button className={`wd-tile off ${wearing ? '' : 'on'}`} onClick={() => onPick(null)} data-testid="wd-off" aria-pressed={!wearing}>
              <span className="wd-tile-art" aria-hidden>🙈</span>
              <span className="wd-tile-name">不戴帽子</span>
            </button>
          </li>
          {HATS.map((h) => {
            const has = owned.includes(h.id)
            return (
              <li key={h.id}>
                <button
                  className={`wd-tile ${has ? '' : 'locked'} ${wearing === h.id ? 'on' : ''}`}
                  onClick={() => (has ? onPick(h.id) : goShop())}
                  data-testid={`wd-hat-${h.id}`}
                  data-owned={has}
                  aria-pressed={has ? wearing === h.id : undefined}
                  aria-label={has ? `${h.name}${wearing === h.id ? '，戴著' : ''}` : `${h.name}，還沒有，要 ${h.price} 顆星星`}
                >
                  <span className="wd-tile-art"><Icon name={h.id} emoji={h.emoji} size={64} alt={h.name} /></span>
                  <span className="wd-tile-name">{h.name}</span>
                  {!has && <span className="wd-tile-price"><Icon name="ui-star" emoji="⭐" size={18} /> {h.price}</span>}
                  {wearing === h.id && <span className="wd-tile-badge">戴著</span>}
                </button>
              </li>
            )
          })}
        </ul>
        {owned.length === 0 && (
          <button className="btn primary wd-shop" onClick={goShop} data-testid="wardrobe-shop">去商店的衣櫃看看</button>
        )}
      </div>
    </div>
  )
}
