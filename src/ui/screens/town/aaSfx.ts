import { getAudioContext, unlockAudio } from '../../../learning/audioEngine'

// v8.4 線 AA 的兩個合成音效：開車的喇叭「叭叭」、照相館的快門「喀嚓」。
// v8.5 再加三個：消防車的警笛、冰淇淋車叮叮的小旋律（自己寫的，不是現成的曲子）、車子起步的引擎聲。
// 現有音效庫沒有這兩種；用 WebAudio 現場合成（很短、不用下載）。發不發聲由呼叫端看 soundOn。任何錯誤都吞掉，不影響遊戲。

function tone(c: AudioContext, t: number, freq: number, dur: number, vol: number, type: OscillatorType): void {
  const o = c.createOscillator()
  const g = c.createGain()
  const f = c.createBiquadFilter()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  f.type = 'lowpass'
  f.frequency.value = 1800
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015)
  g.gain.setValueAtTime(vol, t + dur - 0.04)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(f)
  f.connect(g)
  g.connect(c.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
  o.onended = () => {
    try {
      o.disconnect()
      f.disconnect()
      g.disconnect()
    } catch {
      /* ignore */
    }
  }
}

/** 叭叭：兩聲短短的玩具喇叭（兩個音疊在一起比較像汽車喇叭） */
export function playHorn(): boolean {
  try {
    unlockAudio()
    const c = getAudioContext()
    if (!c) return false
    const t = c.currentTime + 0.01
    for (const at of [t, t + 0.22]) {
      tone(c, at, 392, 0.16, 0.14, 'square')
      tone(c, at, 494, 0.16, 0.1, 'square')
    }
    return true
  } catch {
    return false
  }
}

function click(c: AudioContext, t: number, freq: number, vol: number): void {
  const len = Math.floor(c.sampleRate * 0.05)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
  const s = c.createBufferSource()
  s.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = freq
  f.Q.value = 1.2
  const g = c.createGain()
  g.gain.value = vol
  s.connect(f)
  f.connect(g)
  g.connect(c.destination)
  s.start(t)
  s.onended = () => {
    try {
      s.disconnect()
      f.disconnect()
      g.disconnect()
    } catch {
      /* ignore */
    }
  }
}

/** 喀嚓：快門開、關兩下 */
export function playShutter(): boolean {
  try {
    unlockAudio()
    const c = getAudioContext()
    if (!c) return false
    const t = c.currentTime + 0.01
    click(c, t, 2600, 0.9)
    click(c, t + 0.09, 1500, 0.7)
    return true
  } catch {
    return false
  }
}

/** 警笛與小旋律比較長：還在響的時候再按不重疊（不然連按會糊成一團） */
let busyUntil = 0

/** 喔咿喔咿：消防車的警笛，低音滑到高音再滑回來，兩輪。三角波、不刺耳 */
export const SIREN = { lo: 560, hi: 760, cycle: 0.6, cycles: 2 } as const
export function playSiren(): boolean {
  try {
    unlockAudio()
    const c = getAudioContext()
    if (!c) return false
    if (c.currentTime < busyUntil) return false
    const t = c.currentTime + 0.01
    const dur = SIREN.cycle * SIREN.cycles
    const o = c.createOscillator()
    const g = c.createGain()
    const f = c.createBiquadFilter()
    o.type = 'triangle'
    f.type = 'lowpass'
    f.frequency.value = 2200
    o.frequency.setValueAtTime(SIREN.lo, t)
    for (let i = 0; i < SIREN.cycles; i++) {
      const b = t + i * SIREN.cycle
      o.frequency.setValueAtTime(SIREN.lo, b)
      o.frequency.linearRampToValueAtTime(SIREN.hi, b + SIREN.cycle * 0.22)
      o.frequency.setValueAtTime(SIREN.hi, b + SIREN.cycle * 0.5)
      o.frequency.linearRampToValueAtTime(SIREN.lo, b + SIREN.cycle * 0.72)
    }
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03)
    g.gain.setValueAtTime(0.16, t + dur - 0.08)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(f)
    f.connect(g)
    g.connect(c.destination)
    o.start(t)
    o.stop(t + dur + 0.02)
    o.onended = () => {
      try {
        o.disconnect()
        f.disconnect()
        g.disconnect()
      } catch {
        /* ignore */
      }
    }
    busyUntil = t + dur
    return true
  } catch {
    return false
  }
}

/**
 * 冰淇淋車的小旋律（自己寫的七個音，五聲音階）：mi sol la sol 高do — la 高do。
 * f = 頻率、t = 第幾秒開始、d = 響多久。
 */
export const JINGLE: readonly { f: number; t: number; d: number }[] = [
  { f: 659.25, t: 0, d: 0.3 },
  { f: 783.99, t: 0.16, d: 0.3 },
  { f: 880, t: 0.32, d: 0.3 },
  { f: 783.99, t: 0.48, d: 0.3 },
  { f: 1046.5, t: 0.64, d: 0.5 },
  { f: 880, t: 0.94, d: 0.3 },
  { f: 1046.5, t: 1.1, d: 0.6 },
]

/** 叮：像小鈴鐺，敲下去馬上變小聲（基音加一個高八度的泛音） */
function bell(c: AudioContext, t: number, freq: number, dur: number, vol: number): void {
  for (const [mul, v] of [
    [1, vol],
    [2, vol * 0.35],
  ] as const) {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(freq * mul, t)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(v, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g)
    g.connect(c.destination)
    o.start(t)
    o.stop(t + dur + 0.02)
    o.onended = () => {
      try {
        o.disconnect()
        g.disconnect()
      } catch {
        /* ignore */
      }
    }
  }
}

/** 叮叮的小旋律：冰淇淋車的喇叭 */
export function playJingle(): boolean {
  try {
    unlockAudio()
    const c = getAudioContext()
    if (!c) return false
    if (c.currentTime < busyUntil) return false
    const t = c.currentTime + 0.01
    for (const n of JINGLE) bell(c, t + n.t, n.f, n.d, 0.2)
    const last = JINGLE[JINGLE.length - 1]
    busyUntil = t + last.t + last.d * 0.6
    return true
  } catch {
    return false
  }
}

let vroomAt = -Infinity
/** 噗噗：車子起步的引擎聲（低低的、很短；1.5 秒內不重複，連點也不吵） */
export function playVroom(): boolean {
  try {
    unlockAudio()
    const c = getAudioContext()
    if (!c) return false
    if (c.currentTime - vroomAt < 1.5) return false
    vroomAt = c.currentTime
    const t = c.currentTime + 0.01
    const o = c.createOscillator()
    const g = c.createGain()
    const f = c.createBiquadFilter()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(70, t)
    o.frequency.linearRampToValueAtTime(130, t + 0.22)
    o.frequency.linearRampToValueAtTime(95, t + 0.4)
    f.type = 'lowpass'
    f.frequency.value = 420
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
    o.connect(f)
    f.connect(g)
    g.connect(c.destination)
    o.start(t)
    o.stop(t + 0.45)
    o.onended = () => {
      try {
        o.disconnect()
        f.disconnect()
        g.disconnect()
      } catch {
        /* ignore */
      }
    }
    return true
  } catch {
    return false
  }
}
