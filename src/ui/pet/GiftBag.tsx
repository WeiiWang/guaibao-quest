import type { Gift } from '../../domain/types'
import { giftKind } from '../../domain/gifts'
import { giftArt } from './GiftItem'
import { Icon } from '../components/Icon'
import '../home7.css'

interface Props {
  gifts: Gift[]
  /** 孩子正在餵食或拖曳：不晃動（不打斷他） */
  calm: boolean
  onTake: (el: HTMLElement) => void
}

/**
 * 禮物袋（v7 O1）：房間角落的一個大袋子（≥80px），有數字徽章，輕輕晃。
 * 點一次就把所有禮物全部收下；不閃爍、不催促。沒有禮物時整個不出現。
 */
export function GiftBag({ gifts, calm, onTake }: Props) {
  if (gifts.length === 0) return null
  const kinds = [...new Set(gifts.map((g) => giftKind(g)))]
  return (
    <button
      type="button"
      data-nodrag
      data-testid="gift-bag"
      data-count={gifts.length}
      data-calm={calm || undefined}
      className={`h7-bag ${calm ? 'calm' : ''}`}
      aria-label={`禮物袋，有 ${gifts.length} 份禮物，點一下全部收下`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => onTake(e.currentTarget)}
    >
      {/* 晃動的是裡面這一層；按鈕本身不動，手指點的位置永遠穩定 */}
      <span className="h7-bag-sway">
        <span className="h7-bag-body">
          <span className="h7-bag-emoji" aria-hidden>🎁</span>
        </span>
        <span className="h7-bag-peek" aria-hidden>
          {gifts.slice(0, 3).map((g, i) => {
            const a = giftArt(g)
            return <Icon key={i} name={a.name} emoji={a.emoji} className="h7-bag-mini" />
          })}
        </span>
      </span>
      <b className="h7-bag-badge" data-testid="gift-bag-count" data-kinds={kinds.join(',')}>{gifts.length}</b>
    </button>
  )
}
