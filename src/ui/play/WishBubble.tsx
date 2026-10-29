import { DECOR_EMOJI } from '../../art/items'
import { SHOP_ITEMS } from '../../domain/constants'
import { Icon } from '../components/Icon'
import './play74.css'

/** 阿悟的小願望泡泡（給 RoomView 畫在阿悟頭上） */
export interface WishView {
  id: string
  /** 要做的家具（商品 id），泡泡裡畫它們的 3D 圖 */
  items: readonly string[]
  /** 阿悟說的願望（讀屏用） */
  line: string
  onTap: () => void
}

const emojiOf = (id: string): string | undefined => DECOR_EMOJI[SHOP_ITEMS.find((i) => i.id === id)?.asset ?? '']

interface Props {
  wish: WishView
  /** 泡泡左上角（房間座標，px） */
  left: number
  top: number
  /** 阿悟走路要多久（ms）：泡泡跟著慢慢移動，不會比阿悟先到 */
  walkMs: number
  /** 阿悟正在說話、吃東西或被拖曳：泡泡先淡出，不搶戲 */
  quiet: boolean
}

/**
 * 思考泡泡（v7.4 K2）：一次只有一個願望，泡泡裡是那件家具的圖（套裝是 2–3 件）。
 * 點一下帶去工坊。沒有倒數、不閃爍、不催促；孩子不理它也不會有任何損失。
 */
export function WishBubble({ wish, left, top, walkMs, quiet }: Props) {
  return (
    <button
      type="button"
      data-nodrag
      data-testid="wish-bubble"
      data-wish={wish.id}
      className={`k74-wish ${quiet ? 'quiet' : ''} ${wish.items.length > 1 ? 'set' : ''}`}
      style={{ left, top, transition: walkMs ? `left ${walkMs}ms linear, opacity 0.3s` : undefined }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={wish.onTap}
      aria-label={`${wish.line}，點一下去工坊看怎麼做`}
    >
      <span className="k74-wish-cloud">
        {wish.items.map((id) => (
          <Icon key={id} name={id} emoji={emojiOf(id)} className="k74-wish-img" />
        ))}
      </span>
      <span className="k74-wish-tail" aria-hidden>
        <i />
        <i />
      </span>
    </button>
  )
}
