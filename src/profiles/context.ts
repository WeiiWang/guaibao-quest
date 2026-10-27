import { createContext, useContext } from 'react'
import type { ChildProfile } from './registry'

export interface ProfileContextValue {
  /** 所有孩子 */
  children: ChildProfile[]
  /** 目前正在玩的孩子 id */
  activeId: string
  /** 回到選孩子畫面（換人玩）；只有 1 個孩子時沒有作用 */
  switchPerson: () => void
  /** 離開目前孩子的畫面，等整個畫面卸載完才 resolve（刪除目前孩子的資料庫前要先離開） */
  leave: () => Promise<void>
}

export const ProfileContext = createContext<ProfileContextValue | null>(null)

/** 在孩子的畫面裡讀取孩子清單與換人；不在 ProfileGate 裡（例如單元測試）時回 null */
export function useProfiles(): ProfileContextValue | null {
  return useContext(ProfileContext)
}
