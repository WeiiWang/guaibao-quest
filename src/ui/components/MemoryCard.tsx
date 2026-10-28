import { ALBUM_KIND_LABEL, albumDateText, parseCardArt } from '../../domain/album'
import type { AlbumCard } from '../../domain/types'
import { PetSprite, type PetPose } from './PetSprite'
import { Icon } from './Icon'
import '../wardrobe.css'

/**
 * 成長相簿的一張回憶卡：用元件即時繪製（不是截圖）。
 * 阿悟當時的姿勢圖、日期、一句話；得到第一頂帽子那張還會畫出戴帽子的樣子。
 */
export function MemoryCard({ card, petName = '阿悟', big = false, onClick }: { card: AlbumCard; petName?: string; big?: boolean; onClick?: () => void }) {
  const { stage, pose } = parseCardArt(card.art)
  const kind = ALBUM_KIND_LABEL[card.kind]
  const body = (
    <>
      <div className="al-photo">
        <span className="al-tag" aria-hidden>
          {kind.emoji} {kind.label}
        </span>
        <PetSprite pet={{ stage, feedCount: 0, name: petName }} mood="happy" pose={pose as PetPose} hat={card.hat} className="al-pet" />
        {card.reward && (
          <span className="h7-al-reward" data-testid="album-reward" data-reward={card.reward}>
            <Icon name={/^(decor|wall|floor)-/.test(card.reward) ? card.reward : `food-${card.reward}`} emoji={/^(wall|floor)-/.test(card.reward) ? '🎨' : /^decor-/.test(card.reward) ? '🪑' : '🎁'} className="h7-al-reward-img" />
          </span>
        )}
      </div>
      <div className="al-meta">
        <time className="al-date" data-testid="album-date">{albumDateText(card)}</time>
        <p className="al-caption" data-testid="album-caption">{card.caption}</p>
      </div>
    </>
  )
  const cls = `al-card al-kind-${card.kind} ${big ? 'big' : ''} ${card.fresh ? 'fresh' : ''}`
  return onClick ? (
    <button className={cls} onClick={onClick} data-testid="album-card" data-card={card.id} data-kind={card.kind} aria-label={`${albumDateText(card)}，${card.caption}`}>
      {body}
    </button>
  ) : (
    <figure className={cls} data-testid="album-card" data-card={card.id} data-kind={card.kind}>
      {body}
    </figure>
  )
}
