import { getAudioContext, unlockAudio } from '../../../learning/audioEngine'

// v8.4 線 AA 的兩個合成音效：開車的喇叭「叭叭」、照相館的快門「喀嚓」。
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
