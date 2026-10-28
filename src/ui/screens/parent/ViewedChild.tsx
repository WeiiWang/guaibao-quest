import { createContext, useContext } from 'react'

/**
 * 家長區正在看哪個孩子（v7 O7）。家長區頂端的頭像 chips 可以直接切換，不必離開、也不必再輸一次 PIN；
 * 切換時 `db` 會指向那個孩子的資料庫，所以所有分頁看到的都是他的資料。離開家長區時一定要切回原本正在玩的孩子。
 */
export interface ViewedChild {
  /** 目前看的孩子 id；不在 ProfileGate 裡（單元測試）時是 null */
  id: string | null
}
export const ViewedChildContext = createContext<ViewedChild>({ id: null })
export const useViewedChild = (): ViewedChild => useContext(ViewedChildContext)
