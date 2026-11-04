import { getAudioContext } from './audioEngine'

// v8.3 小小音樂會的即時合成音色：木琴短促帶衰減、鼓用低頻加噪音。
// 按下去當下就在 currentTime 發聲，不預排；多個音共用一條匯流排，經壓縮器避免和音時爆音。
// 發聲與否由呼叫端依 soundOn 決定（要低延遲，這裡不做檢查以外的事）。任何錯誤都吞掉，不影響遊戲。

let bus: { ctx: AudioContext; input: GainNode } | null = null
let noise: { ctx: AudioContext; buffer: AudioBuffer } | null = null

function busOf(c: AudioContext): GainNode {
  if (bus?.ctx === c) return bus.input
  const input = c.createGain()
  input.gain.value = 0.7
  const comp = c.createDynamicsCompressor()
  input.connect(comp)
  comp.connect(c.destination)
  bus = { ctx: c, input }
  return input
}

function noiseOf(c: AudioContext): AudioBuffer {
  if (noise?.ctx === c) return noise.buffer
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * 0.35), c.sampleRate)
  const d = buffer.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  noise = { ctx: c, buffer }
  return buffer
}

/** 一個會衰減的正弦分音 */
function partial(c: AudioContext, dest: AudioNode, t: number, f0: number, f1: number, vol: number, dur: number): void {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(f0, t)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g)
  g.connect(dest)
  o.onended = () => {
    try {
      o.disconnect()
      g.disconnect()
    } catch {
      /* ignore */
    }
  }
  o.start(t)
  o.stop(t + dur + 0.02)
}

function noiseBurst(c: AudioContext, dest: AudioNode, t: number, type: BiquadFilterType, freq: number, vol: number, dur: number): void {
  const s = c.createBufferSource()
  s.buffer = noiseOf(c)
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  const g = c.createGain()
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.connect(f)
  f.connect(g)
  g.connect(dest)
  s.onended = () => {
    try {
      s.disconnect()
      f.disconnect()
      g.disconnect()
    } catch {
      /* ignore */
    }
  }
  s.start(t)
  s.stop(t + dur + 0.02)
}

/** 木琴一個音：基音 + 3 倍泛音（短） + 木槌敲擊的高頻（極短） */
export function playXylophone(freq: number): void {
  try {
    const c = getAudioContext()
    if (!c) return
    const t = c.currentTime
    const out = busOf(c)
    partial(c, out, t, freq, freq, 0.5, 0.6)
    partial(c, out, t, freq * 3, freq * 3, 0.13, 0.18)
    partial(c, out, t, freq * 6, freq * 6, 0.05, 0.045)
  } catch {
    /* 聲音失敗不影響遊戲 */
  }
}

export type DrumKind = 'low' | 'high'

/** 鼓：低頻下滑的「咚」+ 一點噪音的「噠」。low 大鼓、high 小鼓 */
export function playDrum(kind: DrumKind): void {
  try {
    const c = getAudioContext()
    if (!c) return
    const t = c.currentTime
    const out = busOf(c)
    if (kind === 'low') {
      partial(c, out, t, 130, 52, 0.95, 0.4)
      noiseBurst(c, out, t, 'lowpass', 900, 0.28, 0.06)
    } else {
      partial(c, out, t, 250, 125, 0.6, 0.2)
      noiseBurst(c, out, t, 'highpass', 1400, 0.26, 0.13)
    }
  } catch {
    /* 聲音失敗不影響遊戲 */
  }
}
