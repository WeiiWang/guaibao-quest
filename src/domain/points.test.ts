import { describe, expect, it } from 'vitest'
import { DAILY_POINT_CAP } from './constants'
import { balanceOf, checkPenalty, earnedOn, grantPoints, remainingToday } from './points'
import { localDateStr } from './date'
import type { PointLedger } from './types'

const T = new Date(2026, 5, 10, 12, 0, 0).getTime()
const DAY = 24 * 3600 * 1000
const e = (delta: number, kind: PointLedger['kind'], at = T) => ({ delta, kind, at })

describe('points', () => {
  it('餘額是流水帳加總', () => {
    expect(balanceOf([])).toBe(0)
    expect(balanceOf([e(30, 'task'), e(-10, 'purchase'), e(5, 'bonus')])).toBe(25)
  })
  it('每日上限只算當天的 task/bonus 正向點數', () => {
    const ledger = [e(30, 'task'), e(20, 'bonus'), e(-10, 'purchase'), e(-5, 'penalty'), e(40, 'task', T - DAY)]
    expect(earnedOn(ledger, localDateStr(T))).toBe(50)
    expect(remainingToday(ledger, T)).toBe(DAILY_POINT_CAP - 50)
  })
  it('超過上限的部分不發放並標示 capped', () => {
    const ledger = [e(90, 'task')]
    expect(grantPoints(ledger, 30, T)).toEqual({ granted: 10, capped: true })
    expect(grantPoints(ledger, 10, T)).toEqual({ granted: 10, capped: false })
    expect(grantPoints([e(100, 'task')], 20, T)).toEqual({ granted: 0, capped: true })
  })
  it('花點數不會釋出當日額度', () => {
    expect(remainingToday([e(100, 'task'), e(-100, 'purchase')], T)).toBe(0)
  })
  it('隔天重新計算額度', () => {
    expect(remainingToday([e(100, 'task')], T + DAY)).toBe(DAILY_POINT_CAP)
  })
  it('扣點不可使餘額 < 0', () => {
    const ledger = [e(30, 'task')]
    expect(checkPenalty(ledger, 30)).toEqual({ ok: true })
    expect(checkPenalty(ledger, 31)).toEqual({ ok: false, reason: 'insufficient' })
    expect(checkPenalty(ledger, 0)).toEqual({ ok: false, reason: 'invalid' })
    expect(checkPenalty(ledger, -5)).toEqual({ ok: false, reason: 'invalid' })
    expect(checkPenalty(ledger, 1.5)).toEqual({ ok: false, reason: 'invalid' })
  })
})
