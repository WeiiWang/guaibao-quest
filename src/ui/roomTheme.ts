import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { DEFAULT_THEME, resolveTheme } from '../domain/theme'
import type { RoomTheme } from './components/RoomBackdrop'

/**
 * 套用中的房間主題（壁紙 + 地板），可直接傳給 <RoomBackdrop theme={...} />。
 * 資料來自 settings.roomTheme，並確認已擁有；讀取中或資料異常時退回預設，不會壞版。
 */
export function useRoomTheme(): Required<RoomTheme> {
  return useLiveQuery(
    async () => {
      const [settings, inventory] = await Promise.all([db.settings.get('main'), db.inventory.toArray()])
      return resolveTheme(settings?.roomTheme, inventory)
    },
    [],
    DEFAULT_THEME,
  )
}
