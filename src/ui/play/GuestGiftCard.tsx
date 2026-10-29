import { useEffect } from 'react'
import { parseDotsId } from '../../art/dots/dots'
import { FRIEND_BY_ID } from '../../domain/friends'
import { giftName, guestFoodLine, guestPageLine } from '../../domain/play74'
import type { GuestGift } from '../../domain/types'
import { sayText } from '../../learning/speech'
import { Art } from '../components/Art'
import { PageThumb } from '../components/ColoringThumb'
import { Icon } from '../components/Icon'
import { DotsThumb } from '../screens/dots/DotsThumb'
import './play74.css'

interface Props {
  friendId: string
  gift: GuestGift
  voiceOn: boolean
  /** 去畫畫：打開這張新的畫（食物沒有這個鈕） */
  onGo: () => void
  onClose: () => void
}

/** 第一次來作客的朋友留下的禮物：朋友的圖、一句話、禮物的縮圖；著色頁與連連看有「去畫畫」鈕 */
export function GuestGiftCard({ friendId, gift, voiceOn, onGo, onClose }: Props) {
  const f = FRIEND_BY_ID[friendId]
  const name = f?.name ?? '朋友'
  const line = gift.kind === 'food' ? guestFoodLine(name) : guestPageLine(name)
  useEffect(() => {
    sayText(line, { enabled: voiceOn })
    // 只在打開時唸一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const dots = gift.kind === 'dots' ? parseDotsId(gift.id) : null
  return (
    <div className="modal-back k74-gift-back" role="presentation" data-testid="guest-gift" onClick={onClose}>
      <div className="modal k74-gift" role="dialog" aria-modal="true" aria-label={line} onClick={(e) => e.stopPropagation()}>
        <div className="k74-gift-top">
          <Art name={f?.art ?? 'obj-star'} alt="" className="k74-gift-friend" />
          <span className="k74-gift-hi" aria-hidden>✨</span>
        </div>
        <h2 className="k74-gift-line">{line}</h2>
        <div className="k74-gift-item" data-testid="guest-gift-item" data-kind={gift.kind} data-id={gift.id}>
          {gift.kind === 'coloring' && <PageThumb pageId={gift.id} className="k74-gift-thumb" />}
          {dots && <DotsThumb name={dots.name} level={dots.level} at={0} done={false} className="k74-gift-thumb" />}
          {gift.kind === 'food' && <Icon name={`food-${gift.id}`} emoji="🎁" className="k74-gift-food" />}
          <b>{giftName(gift)}</b>
        </div>
        <div className="k74-gift-actions">
          {gift.kind !== 'food' && (
            <button className="btn primary k74-go" onClick={onGo} data-testid="guest-gift-go">
              <Icon name="ui-coloring" emoji="🎨" size={40} /> 去畫畫
            </button>
          )}
          <button className="btn" onClick={onClose} data-testid="guest-gift-close">
            好
          </button>
        </div>
      </div>
    </div>
  )
}
