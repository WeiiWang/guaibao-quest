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

/**
 * v8.5 鈴鐺：音磚樂器的非整數泛音（1、2.76、5.4 倍）加一個略高於八度的分音，尾巴拖得比木琴長很多，
 * 聽起來是「叮——」而不是「咚」。基音還是那個鍵的音，所以彈得出旋律。
 */
export function playBell(freq: number): void {
  try {
    const c = getAudioContext()
    if (!c) return
    const t = c.currentTime
    const out = busOf(c)
    partial(c, out, t, freq, freq, 0.4, 1.6)
    partial(c, out, t, freq * 2.003, freq * 2.003, 0.1, 1.2)
    partial(c, out, t, freq * 2.76, freq * 2.76, 0.16, 0.9)
    partial(c, out, t, freq * 5.4, freq * 5.4, 0.07, 0.35)
  } catch {
    /* 聲音失敗不影響遊戲 */
  }
}

/**
 * v8.5 喵喵：一個像貓叫的滑音。鋸齒波的音高先滑上去、停在那個鍵的音、最後掉下來（喵～），
 * 同時一個帶通濾波器從低掃到高再掃回來（嘴巴從「ㄇ」張開到「ㄧ」再收成「ㄠ」）。
 * 中間停在鍵的音上，所以還是彈得出旋律。只用一個振盪器。
 */
export function playMeow(freq: number): void {
  try {
    const c = getAudioContext()
    if (!c) return
    const t = c.currentTime
    const out = busOf(c)
    const dur = 0.46
    const o = c.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(freq * 0.78, t)
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.09)
    o.frequency.setValueAtTime(freq, t + 0.22)
    o.frequency.exponentialRampToValueAtTime(freq * 0.8, t + dur)
    const mouth = c.createBiquadFilter()
    mouth.type = 'bandpass'
    mouth.Q.value = 4
    mouth.frequency.setValueAtTime(700, t)
    mouth.frequency.exponentialRampToValueAtTime(2400, t + 0.11)
    mouth.frequency.setValueAtTime(2400, t + 0.2)
    mouth.frequency.exponentialRampToValueAtTime(850, t + dur)
    // 一點沒過濾波器的本音墊在下面，音高才聽得清楚；先壓掉刺耳的高頻
    const body = c.createBiquadFilter()
    body.type = 'lowpass'
    body.frequency.value = 1800
    const bodyGain = c.createGain()
    bodyGain.gain.value = 0.22
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05)
    g.gain.setValueAtTime(0.5, t + 0.24)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(mouth)
    mouth.connect(g)
    o.connect(body)
    body.connect(bodyGain)
    bodyGain.connect(g)
    g.connect(out)
    o.onended = () => {
      try {
        o.disconnect()
        mouth.disconnect()
        body.disconnect()
        bodyGain.disconnect()
        g.disconnect()
      } catch {
        /* ignore */
      }
    }
    o.start(t)
    o.stop(t + dur + 0.02)
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
