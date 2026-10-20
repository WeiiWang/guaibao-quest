/** 簡單音效（WebAudio 合成，不需音檔）。soundOn=false 或不支援時靜音。 */

type Kind = 'correct' | 'wrong' | 'reward' | 'tap'

let ctx: AudioContext | null = null

/** 共用的 AudioContext（寵物音效也用這個）；不支援時回 null */
export function audio(): AudioContext | null {
  try {
    if (ctx) return ctx
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!C) return null
    ctx = new C()
    return ctx
  } catch {
    return null
  }
}

const NOTES: Record<Kind, { f: number; t: number; d: number }[]> = {
  correct: [
    { f: 659, t: 0, d: 0.12 },
    { f: 880, t: 0.1, d: 0.2 },
  ],
  wrong: [{ f: 294, t: 0, d: 0.22 }],
  reward: [
    { f: 523, t: 0, d: 0.12 },
    { f: 659, t: 0.1, d: 0.12 },
    { f: 784, t: 0.2, d: 0.12 },
    { f: 1047, t: 0.3, d: 0.3 },
  ],
  tap: [{ f: 520, t: 0, d: 0.05 }],
}

export function playSfx(kind: Kind, enabled = true): void {
  if (!enabled) return
  const c = audio()
  if (!c) return
  try {
    if (c.state === 'suspended') void c.resume()
    const t0 = c.currentTime
    for (const n of NOTES[kind]) {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = kind === 'wrong' ? 'sine' : 'triangle'
      o.frequency.value = n.f
      g.gain.setValueAtTime(0.0001, t0 + n.t)
      g.gain.exponentialRampToValueAtTime(0.18, t0 + n.t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d)
      o.connect(g).connect(c.destination)
      o.start(t0 + n.t)
      o.stop(t0 + n.t + n.d + 0.05)
    }
  } catch {
    /* ignore */
  }
}
