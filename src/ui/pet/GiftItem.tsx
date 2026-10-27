import { FOOD_EMOJI, MAT_EMOJI } from '../../art/items'
import { giftKind } from '../../domain/gifts'
import type { Gift } from '../../domain/types'
import { MATERIAL_NAMES } from '../../learning/types'
import { SHOP_ITEMS } from '../../domain/constants'
import { Icon } from '../components/Icon'
import { stickerEmoji } from '../screens/coloring/stickers'
import './gift.css'

/** 禮物的素材圖名、缺圖 emoji、名字（給展示與收下動畫用） */
export function giftArt(g: Gift): { name: string; emoji: string; label: string } {
  switch (giftKind(g)) {
    case 'food':
      return { name: `food-${g.foodId}`, emoji: FOOD_EMOJI[g.foodId ?? ''] ?? '🎁', label: SHOP_ITEMS.find((i) => i.id === g.foodId)?.name ?? '食物' }
    case 'material':
      return { name: `mat-${g.materialId}`, emoji: MAT_EMOJI[g.materialId ?? ''] ?? '🎁', label: `${MATERIAL_NAMES[g.materialId!]} x${g.qty ?? 1}` }
    default:
      return { name: g.stickerId ?? 'ui-star', emoji: stickerEmoji(g.stickerId ?? '') ?? '⭐', label: '貼紙' }
  }
}

const STARS: [number, number][] = [[4, 24], [90, 18], [96, 62], [2, 66], [50, -4]]

interface Props {
  gift: Gift
  /** 收下中（飛走的動畫由外層做，這裡先藏起來） */
  taking: boolean
  onTake: (el: HTMLElement) => void
}

/**
 * 阿悟拿出來的禮物：大圖從阿悟身後彈出、閃光，孩子點一下收下。
 * 放在 pet-slot 裡，跟著阿悟的位置；class gift-live 讓自主行為排程暫停。
 */
export function GiftItem({ gift, taking, onTake }: Props) {
  const art = giftArt(gift)
  return (
    <button
      type="button"
      data-nodrag
      data-testid="gift"
      data-gift-kind={giftKind(gift)}
      className={`gift-item gift-live ${taking ? 'taking' : ''}`}
      aria-label={`收下禮物：${art.label}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => onTake(e.currentTarget)}
    >
      <span className="gift-glow" aria-hidden />
      <span className="gift-bob">
        <Icon name={art.name} emoji={art.emoji} alt={art.label} className="gift-img" />
      </span>
      {STARS.map((p, i) => (
        <i key={i} className="gift-star" aria-hidden style={{ left: `${p[0]}%`, top: `${p[1]}%`, ['--i' as string]: i }}>✦</i>
      ))}
    </button>
  )
}
