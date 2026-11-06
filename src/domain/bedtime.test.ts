import { describe, expect, it } from 'vitest'
import { BED_STEPS, BED_STEP_LINE, BRUSH_GOAL, LULLABY, LULLABY_FREQ, brushGain, brushProgress, inMouthZone, lullabySchedule, lullabySeconds, nextBedStep } from './bedtime'
import { STATIC_LINES } from '../learning/lines'

describe('步驟', () => {
  it('刷牙 → 睡衣 → 故事 → 關燈 → 睡著，最後停在睡著', () => {
    expect(BED_STEPS).toEqual(['brush', 'pajamas', 'story', 'lamp', 'asleep'])
    expect(nextBedStep('brush')).toBe('pajamas')
    expect(nextBedStep('lamp')).toBe('asleep')
    expect(nextBedStep('asleep')).toBe('asleep')
  })
  it('每一步的台詞都在 lines.ts', () => {
    for (const s of BED_STEPS) expect(typeof STATIC_LINES[BED_STEP_LINE[s]]).toBe('string')
    for (const k of ['intro', 'brushed', 'sleepy', 'dream']) expect(typeof STATIC_LINES[`pet.play.bedtime.${k}`]).toBe('string')
  })
})

describe('刷牙', () => {
  it('嘴巴附近才算', () => {
    expect(inMouthZone({ x: 0.5, y: 0.5 })).toBe(true)
    expect(inMouthZone({ x: 0.5, y: 0.1 })).toBe(false)
    expect(brushGain({ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 })).toBeCloseTo(0.2)
    expect(brushGain({ x: 0.1, y: 0.95 }, { x: 0.3, y: 0.95 })).toBe(0)
  })
  it('一下跳很遠只算一點點（要真的來回刷）', () => {
    expect(brushGain({ x: 0.5, y: 0.5 }, { x: 5, y: 0.5 })).toBeLessThanOrEqual(0.4)
  })
  it('左右來回 4–6 趟就刷好', () => {
    let d = 0
    let trips = 0
    let x = 0.3
    while (brushProgress(d) < 1 && trips < 50) {
      const to = x === 0.3 ? 0.7 : 0.3
      d += brushGain({ x, y: 0.5 }, { x: to, y: 0.5 })
      x = to
      trips++
    }
    expect(trips).toBeGreaterThanOrEqual(4)
    expect(trips).toBeLessThanOrEqual(6)
    expect(brushProgress(BRUSH_GOAL * 2)).toBe(1)
    expect(brushProgress(-1)).toBe(0)
  })
})

describe('搖籃曲', () => {
  it('每個音都有頻率、時間接續', () => {
    const s = lullabySchedule()
    expect(s).toHaveLength(LULLABY.length)
    for (const [n] of LULLABY) expect(LULLABY_FREQ[n]).toBeGreaterThan(200)
    for (let i = 1; i < s.length; i++) expect(s[i].at).toBeCloseTo(s[i - 1].at + s[i - 1].dur)
  })
  it('長度適中：8 到 14 秒', () => {
    expect(lullabySeconds()).toBeGreaterThan(8)
    expect(lullabySeconds()).toBeLessThan(14)
  })
  it('結束在主音 C', () => {
    expect(LULLABY[LULLABY.length - 1][0]).toBe('C5')
  })
})
