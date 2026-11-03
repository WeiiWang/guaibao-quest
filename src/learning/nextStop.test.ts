import { describe, expect, it } from 'vitest'
import { HUAGUOSHAN } from './chapter'
import { nextStopOf } from './nextStop'

const prog = (done: number, chestClaimed = false) => ({ stations: HUAGUOSHAN.stations.map((_, i) => ({ done: i < done, independent: 0, total: 0 })), chestClaimed })

describe('首頁的下一站', () => {
  it('還沒玩過：第 1 站', () => {
    expect(nextStopOf(HUAGUOSHAN, undefined)).toMatchObject({ kind: 'station', index: 1, stationName: '山腳小路' })
  })
  it('過了兩站：第 3 站', () => {
    expect(nextStopOf(HUAGUOSHAN, prog(2))).toMatchObject({ kind: 'station', index: 3, stationName: '小溪邊' })
  })
  it('5 站都過、寶箱還沒開：寶箱', () => {
    expect(nextStopOf(HUAGUOSHAN, prog(5)).kind).toBe('chest')
  })
  it('寶箱開了：再玩一輪', () => {
    expect(nextStopOf(HUAGUOSHAN, prog(5, true)).kind).toBe('again')
  })
})
