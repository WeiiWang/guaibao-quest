import { Art } from '../components/Art'
import './play74.css'

/** 今天作客的朋友（給 RoomView 畫在房間裡） */
export interface GuestView {
  id: string
  name: string
  /** public/art 的圖名 */
  art: string
  /** 第一次來、禮物還沒看 */
  hasGift: boolean
  onTap: () => void
}

interface Props {
  guest: GuestView
  /** 站的位置：中心 x、腳底 y（房間座標，px）與大小 */
  x: number
  bottom: number
  size: number
  z: number
}

/**
 * 朋友來作客（v7.4 K1）：站在房間地板上的 3D 圖，點一下唸名字（有英文的接著唸英文）。
 * 站得比阿悟靠後一點，阿悟會繞開它；第一次來還沒收禮物時，頭上有一個禮物小標記。
 * 不是物件，不能拖、不能收回，佈置模式時不出現。
 */
export function GuestFriend({ guest, x, bottom, size, z }: Props) {
  return (
    <div className="k74-guest" data-testid="guest-spot" style={{ left: x - size / 2, top: bottom - size, width: size, height: size, zIndex: z }}>
      <span className="k74-guest-shadow" aria-hidden />
      <button
        type="button"
        data-nodrag
        data-testid="guest"
        data-friend={guest.id}
        data-gift={guest.hasGift || undefined}
        className="k74-guest-btn"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={guest.onTap}
        aria-label={guest.hasGift ? `${guest.name}來作客，帶了禮物，點一下聽名字` : `${guest.name}來作客，點一下聽名字`}
      >
        <span className="k74-guest-bob">
          <Art name={guest.art} alt="" className="k74-guest-img" />
        </span>
      </button>
      {guest.hasGift && (
        <span className="k74-gift-tag" data-testid="guest-gift-tag" aria-hidden>
          🎁
        </span>
      )}
      <span className="k74-guest-name" aria-hidden>
        {guest.name}
      </span>
    </div>
  )
}
