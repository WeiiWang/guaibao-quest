import { useEffect } from 'react'
import { STATIC_LINES } from '../../learning/lines'
import { sayRecorded } from '../../learning/speech'
import { placeVoiceOn } from '../feelFlags'
import { useLearningSettings } from '../learningHooks'
import './place.css'

// v8.2 線 S：選單畫面不再是粉彩底加白卡片，每個畫面都是世界裡的一個地方：
// 一張場景背景（鋪滿整頁、沒圖時退回原本的主題色）+ 走進去時寵物說一句話。

export type PlaceId = 'shop' | 'workshop' | 'bag' | 'tasks' | 'art' | 'gallery' | 'friends' | 'album' | 'playground' | 'town'

/** 整頁場景背景。放在 <main className="screen place"> 裡第一個；外層裁切同地圖的柔焦背景，轉場時不會撐出捲動 */
export function PlaceBackdrop({ place }: { place: PlaceId }) {
  return (
    <div className="place-backdrop" aria-hidden data-testid="place-backdrop" data-place={place}>
      <div style={{ backgroundImage: `url("${import.meta.env.BASE_URL}art/scene-place-${place}.jpg")` }} />
    </div>
  )
}

/** 這次開啟 App 已經打過招呼的地方：來回逛不會一直重複同一句 */
const greeted = new Set<PlaceId>()

/** 第一次走進這個地方：回傳 true 並記下來。單元測試用 */
export function firstVisit(place: PlaceId): boolean {
  if (greeted.has(place)) return false
  greeted.add(place)
  return true
}

/**
 * 走進地方時寵物打招呼（一次開啟每個地方一句；只播預錄音檔，沒錄就安靜；等轉場結束才說）。
 * skip：這個畫面自己有話要說（空狀態的邀請），這次不打招呼、也不算打過，下次進來才說，兩句才不會互相打斷。
 */
export function usePlaceGreeting(place: PlaceId, { skip = false }: { skip?: boolean } = {}) {
  const { voiceOn } = useLearningSettings()
  useEffect(() => {
    if (skip || !voiceOn || !placeVoiceOn()) return
    const t = window.setTimeout(() => {
      const line = STATIC_LINES[`pet.place.${place}`]
      if (typeof line === 'string' && firstVisit(place)) sayRecorded('pet.', line, { enabled: true })
    }, 500)
    return () => window.clearTimeout(t)
  }, [place, voiceOn, skip])
}
