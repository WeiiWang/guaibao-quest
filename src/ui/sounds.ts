/** 著色本用的小音效（WebAudio 即時合成，不下載音檔）。enabled=false 或不支援時靜音。 */
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
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

function tone(c: AudioContext, t0: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(f0, t0)
  o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.8)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(c.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.04)
}

/** 「啵」：快速上揚的短音 */
export function playPop(enabled = true): void {
  if (!enabled) return
  const c = audio()
  if (!c) return
  try {
    if (c.state === 'suspended') void c.resume()
    tone(c, c.currentTime, 380, 900, 0.12, 0.2)
  } catch {
    /* ignore */
  }
}

/** 貼上貼紙 / 完成：上行的小鈴聲 */
export function playChime(enabled = true, notes: number[] = [784, 988, 1175]): void {
  if (!enabled) return
  const c = audio()
  if (!c) return
  try {
    if (c.state === 'suspended') void c.resume()
    const t0 = c.currentTime
    notes.forEach((f, i) => tone(c, t0 + i * 0.1, f, f * 1.01, 0.28, 0.16, 'triangle'))
  } catch {
    /* ignore */
  }
}

/** 短促的雜訊（蠟筆的沙沙聲）：用 AudioBuffer 雜訊 + 低通 */
function noiseBurst(c: AudioContext, t0: number, dur: number, vol: number, cutoff: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1 // 固定的偽隨機，不用 Math.random
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = cutoff
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f).connect(g).connect(c.destination)
  src.start(t0)
}

/** 彩虹筆走音階用（五聲音階，不會不和諧） */
const PENTA = [523, 587, 659, 784, 880, 1047]

/**
 * 每種筆刷各有一個合成音效。step = 這一筆裡第幾次發聲（彩虹筆會往上爬音階）。
 * enabled=false（音效開關關掉）或不支援時靜音。
 */
export function playBrush(enabled: boolean, kind: string, step = 0): void {
  if (!enabled) return
  const c = audio()
  if (!c) return
  try {
    if (c.state === 'suspended') void c.resume()
    const t = c.currentTime
    switch (kind) {
      case 'crayon':
        noiseBurst(c, t, 0.07, 0.1, 2200)
        break
      case 'marker':
        tone(c, t, 240, 190, 0.08, 0.09, 'triangle')
        break
      case 'glitter':
        tone(c, t, 1760, 2200, 0.08, 0.05, 'triangle')
        tone(c, t + 0.04, 2637, 3100, 0.07, 0.04, 'triangle')
        break
      case 'rainbow': {
        const f = PENTA[step % PENTA.length]
        tone(c, t, f, f * 1.01, 0.12, 0.09, 'sine')
        break
      }
      case 'neon':
        tone(c, t, 140, 280, 0.1, 0.05, 'sawtooth')
        break
      case 'stamp':
        tone(c, t, 320, 120, 0.1, 0.18, 'sine')
        break
      default:
        tone(c, t, 560, 620, 0.05, 0.08, 'sine')
    }
  } catch {
    /* ignore */
  }
}
