import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { db } from '../../db/db'
import { getTodMode, TOD_EVENT } from '../../pet/bus'
import type { TodMode } from '../../pet/daynight'

const subscribeTod = (cb: () => void) => {
  window.addEventListener(TOD_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(TOD_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** PM 預覽指定的日夜模式（跟隨真實時間 = 'auto'） */
export function useTodMode(): TodMode {
  return useSyncExternalStore(subscribeTod, () => getTodMode(), () => 'auto' as TodMode)
}

const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** 系統設定了「減少動態效果」：走路改成直接出現、特效淡入淡出（行為照常發生） */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  )
}

/** 家長開關「寵物會大便」；未設定視為開 */
export function usePoopSetting(): boolean {
  return useLiveQuery(async () => (await db.settings.get('main'))?.petPoopOn ?? true, [], true)
}
