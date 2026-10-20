import { describe, expect, it, vi } from 'vitest'
import { makeRng } from '../learning/rng'
import { MASTER_GAIN, PENTATONIC, renderVoices, singMelody, soundDuration, soundVoices, type AudioLike, type PetSound } from './sounds'

const KINDS: PetSound[] = ['ah', 'chew', 'gulp', 'burp', 'poop', 'pop', 'sing', 'sneeze', 'giggle', 'boing', 'yawn', 'rumble', 'sparkle']

describe('音效配方', () => {
  it('每種音效都有聲音、時間與頻率合理、音量柔和', () => {
    for (const k of KINDS) {
      const v = soundVoices(k, makeRng(3))
      expect(v.length, k).toBeGreaterThan(0)
      for (const x of v) {
        expect(x.t, k).toBeGreaterThanOrEqual(0)
        expect(x.d, k).toBeGreaterThan(0)
        expect(x.d, k).toBeLessThanOrEqual(1.5)
        expect(x.f0, k).toBeGreaterThan(20)
        expect(x.f0, k).toBeLessThan(8000)
        if (x.f1 !== undefined) expect(x.f1).toBeGreaterThan(20)
        expect(x.gain, k).toBeGreaterThan(0)
        expect(x.gain, k).toBeLessThanOrEqual(1)
      }
      expect(soundDuration(v), k).toBeLessThan(3)
    }
    expect(MASTER_GAIN).toBeLessThanOrEqual(0.25)
  })
  it('唱歌旋律：3–5 個音、都在五聲音階、相鄰音不重複', () => {
    const rng = makeRng(21)
    const counts = new Set<number>()
    for (let i = 0; i < 80; i++) {
      const v = singMelody(rng).filter((x) => x.type === 'triangle')
      counts.add(v.length)
      for (const x of v) expect(PENTATONIC as readonly number[]).toContain(x.f0)
      for (let j = 1; j < v.length; j++) expect(v[j].f0).not.toBe(v[j - 1].f0)
      // 依序播放、不重疊
      for (let j = 1; j < v.length; j++) expect(v[j].t).toBeGreaterThan(v[j - 1].t)
    }
    expect([...counts].sort()).toEqual([3, 4, 5])
  })
  it('同一個 seed 旋律固定（可測試）', () => {
    expect(singMelody(makeRng(5))).toEqual(singMelody(makeRng(5)))
  })
})

function fakeCtx() {
  const calls = { osc: 0, noise: 0, gain: 0, filter: 0, starts: [] as number[], peaks: [] as number[] }
  const param = (record?: number[]) => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn((v: number) => record?.push(v)),
  })
  const ctx: AudioLike = {
    currentTime: 10,
    sampleRate: 8000,
    destination: {},
    createOscillator: () => {
      calls.osc++
      return { type: '', frequency: param(), connect: () => ({}), start: (t: number) => calls.starts.push(t), stop: () => {} }
    },
    createGain: () => {
      calls.gain++
      return { gain: param(calls.peaks), connect: () => ({}) }
    },
    createBiquadFilter: () => {
      calls.filter++
      return { type: '', frequency: { value: 0 }, connect: () => ({}) }
    },
    createBuffer: (_c, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => {
      calls.noise++
      return { buffer: null, connect: () => ({}), start: (t: number) => calls.starts.push(t), stop: () => {} }
    },
  }
  return { ctx, calls }
}

describe('renderVoices', () => {
  it('把每個聲音排進 AudioContext，起始時間相對於 currentTime', () => {
    const { ctx, calls } = fakeCtx()
    renderVoices(ctx, soundVoices('chew'))
    expect(calls.osc).toBe(1)
    expect(calls.noise).toBe(1)
    expect(calls.gain).toBe(2)
    expect(calls.starts.every((t) => t >= 10)).toBe(true)
  })
  it('音量不會超過主音量上限', () => {
    const { ctx, calls } = fakeCtx()
    for (const k of KINDS) renderVoices(ctx, soundVoices(k, makeRng(1)))
    // 每個增益包絡的最高點（exponentialRamp 的第一個目標）都 ≤ MASTER_GAIN
    const peaks = calls.peaks.filter((v) => v > 0.001)
    expect(peaks.length).toBeGreaterThan(0)
    expect(Math.max(...peaks)).toBeLessThanOrEqual(MASTER_GAIN + 1e-9)
  })
})
