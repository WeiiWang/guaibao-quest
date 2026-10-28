import { DAILY_POINT_CAP } from './constants'
import { localDateStr } from './date'
import type { PointLedger } from './types'

/** 歡迎禮物那筆流水帳的 refId（不計入每日點數上限） */
export const WELCOME_REF = 'welcome'

type L = Pick<PointLedger, 'at' | 'delta' | 'kind'> & { refId?: string }

/** 餘額 = 流水帳加總，不存欄位 */
export function balanceOf(ledger: readonly Pick<PointLedger, 'delta'>[]): number {
  return ledger.reduce((s, e) => s + e.delta, 0)
}

/** 某本地日期已獲得的點數（任務 + 家長加點；扣點、購買與一次性的歡迎禮物不影響上限） */
export function earnedOn(ledger: readonly L[], date: string): number {
  return ledger.reduce(
    (s, e) =>
      e.delta > 0 && (e.kind === 'task' || e.kind === 'bonus') && e.refId !== WELCOME_REF && localDateStr(e.at) === date
        ? s + e.delta
        : s,
    0,
  )
}

export function remainingToday(ledger: readonly L[], now: number): number {
  return Math.max(0, DAILY_POINT_CAP - earnedOn(ledger, localDateStr(now)))
}

export interface GrantResult {
  granted: number
  capped: boolean
}

/** 計算實際可發放點數（超過上限的部分不發） */
export function grantPoints(ledger: readonly L[], requested: number, now: number): GrantResult {
  const req = Math.max(0, Math.floor(requested))
  const granted = Math.min(req, remainingToday(ledger, now))
  return { granted, capped: granted < req }
}

export type PenaltyCheck = { ok: true } | { ok: false; reason: 'invalid' | 'insufficient' }

/** 扣點不可讓餘額 < 0 */
export function checkPenalty(
  ledger: readonly Pick<PointLedger, 'delta'>[],
  amount: number,
): PenaltyCheck {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid' }
  if (balanceOf(ledger) - amount < 0) return { ok: false, reason: 'insufficient' }
  return { ok: true }
}
