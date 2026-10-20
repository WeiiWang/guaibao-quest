import { describe, expect, it } from 'vitest'
import { getTimeOfDay, isSleepTime } from './daynight'

const at = (h: number, m = 0) => new Date(2026, 9, 20, h, m, 0).getTime()

describe('getTimeOfDay', () => {
  it('07:00–18:00 白天', () => {
    expect(getTimeOfDay(at(7, 0))).toBe('day')
    expect(getTimeOfDay(at(12, 30))).toBe('day')
    expect(getTimeOfDay(at(17, 59))).toBe('day')
  })
  it('18:00–19:30 傍晚', () => {
    expect(getTimeOfDay(at(18, 0))).toBe('dusk')
    expect(getTimeOfDay(at(19, 29))).toBe('dusk')
  })
  it('19:30–07:00 晚上（跨午夜）', () => {
    expect(getTimeOfDay(at(19, 30))).toBe('night')
    expect(getTimeOfDay(at(23, 59))).toBe('night')
    expect(getTimeOfDay(at(0, 0))).toBe('night')
    expect(getTimeOfDay(at(6, 59))).toBe('night')
  })
  it('PM 覆寫：指定時段直接用；auto / 空值跟隨時間', () => {
    expect(getTimeOfDay(at(12), 'night')).toBe('night')
    expect(getTimeOfDay(at(23), 'day')).toBe('day')
    expect(getTimeOfDay(at(12), 'dusk')).toBe('dusk')
    expect(getTimeOfDay(at(23), 'auto')).toBe('night')
    expect(getTimeOfDay(at(12), null)).toBe('day')
    expect(getTimeOfDay(at(12), undefined)).toBe('day')
  })
})

describe('isSleepTime', () => {
  it('20:30 以後到早上 07:00 睡覺', () => {
    expect(isSleepTime(at(20, 29))).toBe(false)
    expect(isSleepTime(at(20, 30))).toBe(true)
    expect(isSleepTime(at(2, 0))).toBe(true)
    expect(isSleepTime(at(6, 59))).toBe(true)
    expect(isSleepTime(at(7, 0))).toBe(false)
  })
  it('19:30–20:30 已經是晚上但還沒睡', () => {
    expect(getTimeOfDay(at(20, 0))).toBe('night')
    expect(isSleepTime(at(20, 0))).toBe(false)
  })
  it('PM 強制晚上就睡；強制白天/傍晚不睡', () => {
    expect(isSleepTime(at(12), 'night')).toBe(true)
    expect(isSleepTime(at(23), 'day')).toBe(false)
    expect(isSleepTime(at(23), 'dusk')).toBe(false)
    expect(isSleepTime(at(23), 'auto')).toBe(true)
  })
})
