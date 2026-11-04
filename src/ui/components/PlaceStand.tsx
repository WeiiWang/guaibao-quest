import type { ReactNode } from 'react'
import { Companion, type Pose } from '../screens/adventure/Companion'
import { usePlaceGreeting, type PlaceId } from './Place'
import './place-spot.css'

// v8.2 線 S：商店、工坊、背包、任務共用的「寵物站在這個地方」。位置全部由 place-spot.css 依橫直向決定，
// 這裡只有結構：外層定位、內層負責跳與歪頭（Companion 自己有呼吸動畫，不搶同一個 transform）。

interface Props {
  pose?: Pose
  /** 每加 1 跳一下（0 = 還沒跳過）；連點會重新跳 */
  hop?: number
  /** 正在看某樣東西：往內容那邊歪一點 */
  look?: boolean
  /** 直向與手機站在頁面最下面的地上（在內容之後，不會蓋到內容）；沒給 = 站在 .pl-spot-bar 裡 */
  floor?: boolean
  /** 頭上的泡泡 */
  children?: ReactNode
}

export function PlaceStand({ pose = 'idle', hop = 0, look = false, floor = false, children }: Props) {
  return (
    <div className={`pl-spot-pet ${floor ? 'pl-spot-floor' : ''}`} data-testid="place-pet">
      <div className={`pl-spot-pet-in ${look ? 'pl-spot-look' : ''} ${hop > 0 ? `pl-spot-hop${hop % 2}` : ''}`} data-hop={hop}>
        <Companion pose={pose} size="var(--pl-pet)" />
        <i className="pl-spot-shadow" aria-hidden />
      </div>
      {children}
    </div>
  )
}

/**
 * 有條件的招呼：畫面一進來就有別句話要說（背包的空狀態、工坊的小願望）時不掛上這個元件，
 * 不然 0.5 秒後的招呼會把正在唸的那句蓋掉。
 */
export function PlaceGreeting({ place }: { place: PlaceId }) {
  usePlaceGreeting(place)
  return null
}
