import { createContext, useContext, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { now as clockNow } from '../domain/clock'
import { balanceOf } from '../domain/points'

/** 目前時間（每 15 秒更新；dev 除錯推進時鐘時立即更新） */
export function useNow(): number {
  const [n, setN] = useState(clockNow())
  useEffect(() => {
    const tick = () => setN(clockNow())
    const id = window.setInterval(tick, 15_000)
    window.addEventListener('gq-time', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('gq-time', tick)
    }
  }, [])
  return n
}

export function useBalance(): number {
  return useLiveQuery(async () => balanceOf(await db.ledger.toArray()), [], 0)
}

export type ToastTone = 'ok' | 'warn' | 'info'
export type ToastFn = (message: string, tone?: ToastTone) => void
export const ToastContext = createContext<ToastFn>(() => {})
export const useToast = () => useContext(ToastContext)

export interface CelebrateInfo {
  petName: string
  from: 'egg' | 'baby'
  to: 'baby' | 'adult'
  feedCount: number
}
export type CelebrateFn = (info: CelebrateInfo) => void
export const CelebrateContext = createContext<CelebrateFn>(() => {})
export const useCelebrate = () => useContext(CelebrateContext)
