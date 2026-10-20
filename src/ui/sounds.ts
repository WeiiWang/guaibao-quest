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
