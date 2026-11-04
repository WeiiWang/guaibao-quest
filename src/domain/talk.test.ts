import { describe, expect, it } from 'vitest'
import { TALK_MAX_MS, TALK_MIN_LEVEL, TALK_SILENCE_MS, gateStartLevel, newGate, nudgeAfter, playbackGain, rms, speechRange, speechWindow, stepGate, talkRate, type GateEvent, type VoiceGate } from './talk'

/** 用 60ms 一步餵一串音量，回傳事件與發生的時間 */
function run(levels: number[], g0: VoiceGate = newGate(), stepMs = 60) {
  let g = g0
  const events: { event: Exclude<GateEvent, null>; t: number }[] = []
  levels.forEach((level, i) => {
    const r = stepGate(g, level, i * stepMs)
    g = r.gate
    if (r.event) events.push({ event: r.event, t: i * stepMs })
  })
  return { events, gate: g }
}
const rep = (v: number, ms: number, stepMs = 60) => new Array<number>(Math.round(ms / stepMs)).fill(v)

describe('音量門檻狀態機', () => {
  it('安靜時不開始；超過門檻開始，靜音約 0.9 秒結束', () => {
    const { events } = run([...rep(0.005, 600), ...rep(0.2, 900), ...rep(0.002, 1200)])
    expect(events.map((e) => e.event)).toEqual(['start', 'stop'])
    expect(events[0].t).toBe(600)
    expect(events[1].t - 1500).toBeGreaterThanOrEqual(TALK_SILENCE_MS - 120)
    expect(events[1].t - 1500).toBeLessThanOrEqual(TALK_SILENCE_MS + 120)
  })

  it('一直講最長 6 秒就停', () => {
    const { events } = run(rep(0.2, 8000))
    expect(events[0]).toEqual({ event: 'start', t: 0 })
    expect(events[1].event).toBe('stop')
    expect(events[1].t).toBeGreaterThanOrEqual(TALK_MAX_MS)
    expect(events[1].t).toBeLessThanOrEqual(TALK_MAX_MS + 60)
  })

  it('拍一下手不算說話', () => {
    const { events, gate } = run([...rep(0.4, 60), ...rep(0.001, 1300)])
    expect(events.map((e) => e.event)).toEqual(['start', 'blip'])
    expect(gate.phase).toBe('quiet')
  })

  it('句子中間小聲一點不會被切斷（遲滯）', () => {
    const { events } = run([...rep(0.2, 600), ...rep(TALK_MIN_LEVEL * 0.6, 1500), ...rep(0.2, 300), ...rep(0.001, 1200)])
    expect(events.map((e) => e.event)).toEqual(['start', 'stop'])
  })

  it('句中短暫的停頓（小於 0.9 秒）算同一句', () => {
    const { events } = run([...rep(0.2, 400), ...rep(0.001, 600), ...rep(0.2, 400), ...rep(0.001, 1200)])
    expect(events.map((e) => e.event)).toEqual(['start', 'stop'])
  })

  it('環境音變大時門檻跟著上去，安靜時有下限', () => {
    expect(gateStartLevel(0)).toBe(TALK_MIN_LEVEL)
    expect(gateStartLevel(0.05)).toBeCloseTo(0.15)
    const noisy = run(rep(0.025, 4000))
    expect(noisy.events).toEqual([])
    expect(noisy.gate.floor).toBeGreaterThan(0.015)
    // 環境音 0.025 → 0.05 的聲音（剛好過下限）不算開始
    const r = stepGate(noisy.gate, 0.05, 5000)
    expect(r.event).toBeNull()
    expect(stepGate(noisy.gate, 0.3, 5000).event).toBe('start')
  })

  it('說話的音量不會被算進環境音', () => {
    const { gate } = run([...rep(0.005, 600), ...rep(0.4, 900)])
    expect(gate.floor).toBeLessThan(0.01)
  })
})

describe('要播回哪一段', () => {
  it('從尾巴往回算：含開口前一點點、去掉最後的靜音', () => {
    const w = speechWindow(12, { onsetAt: 10_000, lastLoudAt: 12_000, stopAt: 12_900 })
    expect(w.start).toBeCloseTo(12 - 2.9 - 0.3)
    expect(w.end).toBeCloseTo(12 - 0.9 + 0.2)
  })

  it('錄音比預期短（Safari 開始得晚）也不會超出範圍', () => {
    const w = speechWindow(1, { onsetAt: 0, lastLoudAt: 2000, stopAt: 2900 })
    expect(w.start).toBe(0)
    expect(w.end).toBeGreaterThan(0)
    expect(w.end).toBeLessThanOrEqual(1)
  })

  const rate = 1000
  const tone = (ms: number, amp: number) => new Array<number>(ms).fill(amp)

  it('去頭尾的靜音', () => {
    const samples = [...tone(500, 0), ...tone(1000, 0.3), ...tone(500, 0)]
    const r = speechRange(samples, rate, { start: 0, end: 2 })
    expect(r).not.toBeNull()
    expect(r!.start).toBeGreaterThan(0.4)
    expect(r!.start).toBeLessThanOrEqual(0.5)
    expect(r!.end).toBeGreaterThanOrEqual(1.5)
    expect(r!.end).toBeLessThan(1.65)
    expect(r!.peak).toBeCloseTo(0.3)
  })

  it('全部沒聲音就不播', () => {
    expect(speechRange(tone(1000, 0), rate, { start: 0, end: 1 })).toBeNull()
    expect(speechRange(tone(1000, 0.002), rate, { start: 0, end: 1 })).toBeNull()
    expect(speechRange([], rate, { start: 0, end: 1 })).toBeNull()
    expect(speechRange(tone(1000, 0.3), rate, { start: 0.5, end: 0.5 })).toBeNull()
  })

  it('只看視窗裡的：視窗外的吵雜不算', () => {
    const samples = [...tone(500, 0.9), ...tone(500, 0), ...tone(500, 0.2)]
    const r = speechRange(samples, rate, { start: 0.6, end: 1.5 })
    expect(r!.peak).toBeCloseTo(0.2)
    expect(r!.start).toBeGreaterThanOrEqual(0.6)
  })
})

describe('其他', () => {
  it('RMS', () => {
    expect(rms([])).toBe(0)
    expect(rms([0.5, -0.5])).toBeCloseTo(0.5)
  })

  it('小聲放大、大聲不放大、有上限', () => {
    expect(playbackGain(0.9)).toBeCloseTo(1)
    expect(playbackGain(0.3)).toBeCloseTo(3)
    expect(playbackGain(0.0001)).toBe(6)
  })

  it('每個物種都比原本高，舊存檔當猴子', () => {
    expect(talkRate('monkey')).toBe(1.45)
    expect(talkRate(undefined)).toBe(1.45)
    expect(talkRate('rabbit')).toBeGreaterThan(1)
    expect(talkRate('tiger')).toBeGreaterThan(1)
  })

  it('沒聲音時邀三次就不再說', () => {
    expect(nudgeAfter(0)).toBeGreaterThan(5000)
    expect(nudgeAfter(1)!).toBeGreaterThan(nudgeAfter(0)!)
    expect(nudgeAfter(3)).toBeNull()
  })
})
