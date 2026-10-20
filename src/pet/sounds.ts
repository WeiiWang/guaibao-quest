// 寵物音效（SPEC-v3 A6）：全部用 WebAudio 即時合成，不下載音檔。
// 配方是純資料（Voice 清單），可以不碰 WebAudio 就測試；播放時遵守 soundOn 開關。
import { audio } from '../learning/sfx'

export type PetSound =
  | 'ah'
  | 'chew'
  | 'gulp'
  | 'burp'
  | 'poop'
  | 'pop'
  | 'sing'
  | 'sneeze'
  | 'giggle'
  | 'boing'
  | 'yawn'
  | 'rumble'
  | 'sparkle'

export type VoiceType = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise'

export interface Voice {
  /** 開始時間（秒，相對於播放時刻） */
  t: number
  /** 長度（秒） */
  d: number
  type: VoiceType
  /** 起始頻率；noise 時當作濾波中心頻率 */
  f0: number
  /** 結束頻率（會滑過去）；沒給 = 不滑音 */
  f1?: number
  /** 0–1，整體再乘上 MASTER_GAIN */
  gain: number
  /** 低通濾波截止頻率 */
  lp?: number
}

/** 整體音量上限：柔和、不刺耳 */
export const MASTER_GAIN = 0.16

// C 大調五聲音階（C5 D5 E5 G5 A5 C6），唱歌旋律只從這裡挑，怎麼唱都不會難聽
export const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5] as const

/** 3–5 個音的小旋律（音高隨機但相鄰不會一樣，最後一個音拉長） */
export function singMelody(rng: () => number): Voice[] {
  const n = 3 + Math.floor(rng() * 3)
  const out: Voice[] = []
  let prev = -1
  let t = 0
  for (let i = 0; i < n; i++) {
    let k = Math.floor(rng() * PENTATONIC.length)
    if (k === prev) k = (k + 1 + Math.floor(rng() * 2)) % PENTATONIC.length
    prev = k
    const last = i === n - 1
    const d = last ? 0.5 : 0.22 + rng() * 0.08
    out.push({ t, d, type: 'triangle', f0: PENTATONIC[k], gain: 0.9, lp: 3200 })
    // 疊一個高八度的小聲泛音，聽起來比較像「唱」
    out.push({ t, d: d * 0.8, type: 'sine', f0: PENTATONIC[k] * 2, gain: 0.18 })
    t += d * (last ? 1 : 0.92)
  }
  return out
}

export function soundVoices(kind: PetSound, rng: () => number = Math.random): Voice[] {
  switch (kind) {
    case 'ah': // 「啊嗯」：張嘴 + 閉嘴
      return [
        { t: 0, d: 0.22, type: 'triangle', f0: 520, f1: 420, gain: 0.7, lp: 1800 },
        { t: 0.2, d: 0.14, type: 'sine', f0: 300, f1: 260, gain: 0.7 },
      ]
    case 'chew': // 嚼：一小段濾過的雜訊 + 低沉的咚
      return [
        { t: 0, d: 0.07, type: 'noise', f0: 1400, gain: 0.55, lp: 1800 },
        { t: 0, d: 0.09, type: 'sine', f0: 190, f1: 130, gain: 0.7 },
      ]
    case 'gulp': // 咕嚕
      return [
        { t: 0, d: 0.12, type: 'sine', f0: 320, f1: 140, gain: 0.8 },
        { t: 0.1, d: 0.1, type: 'sine', f0: 240, f1: 110, gain: 0.7 },
      ]
    case 'burp': // 嗝：低頻鋸齒波 + 抖動
      return [
        { t: 0, d: 0.34, type: 'sawtooth', f0: 125, f1: 70, gain: 0.55, lp: 420 },
        { t: 0.02, d: 0.3, type: 'square', f0: 62, f1: 48, gain: 0.35, lp: 220 },
      ]
    case 'poop': // 噗
      return [
        { t: 0, d: 0.2, type: 'sine', f0: 150, f1: 55, gain: 0.8 },
        { t: 0, d: 0.12, type: 'noise', f0: 380, gain: 0.5, lp: 500 },
      ]
    case 'pop': // 啵（泡泡破掉）
      return [
        { t: 0, d: 0.09, type: 'sine', f0: 260, f1: 980, gain: 0.8 },
        { t: 0.07, d: 0.05, type: 'noise', f0: 2600, gain: 0.3, lp: 4000 },
      ]
    case 'sing':
      return singMelody(rng)
    case 'sneeze': // 哈～啾！
      return [
        { t: 0, d: 0.22, type: 'noise', f0: 900, f1: 2600, gain: 0.35, lp: 3000 },
        { t: 0.26, d: 0.14, type: 'sine', f0: 1050, f1: 640, gain: 0.8 },
        { t: 0.26, d: 0.08, type: 'noise', f0: 3000, gain: 0.35, lp: 5000 },
      ]
    case 'giggle': // 嘻嘻
      return [
        { t: 0, d: 0.07, type: 'triangle', f0: 760, f1: 900, gain: 0.7 },
        { t: 0.11, d: 0.07, type: 'triangle', f0: 800, f1: 960, gain: 0.7 },
        { t: 0.22, d: 0.09, type: 'triangle', f0: 840, f1: 1020, gain: 0.7 },
      ]
    case 'boing': // 彈簧
      return [
        { t: 0, d: 0.28, type: 'sine', f0: 210, f1: 520, gain: 0.85 },
        { t: 0.2, d: 0.2, type: 'sine', f0: 520, f1: 300, gain: 0.6 },
      ]
    case 'yawn': // 哈～（慢慢往下）
      return [{ t: 0, d: 0.7, type: 'sine', f0: 440, f1: 230, gain: 0.5, lp: 1200 }]
    case 'rumble': // 肚子咕嚕叫
      return [
        { t: 0, d: 0.5, type: 'sawtooth', f0: 85, f1: 62, gain: 0.35, lp: 240 },
        { t: 0.55, d: 0.3, type: 'sawtooth', f0: 70, f1: 55, gain: 0.3, lp: 220 },
      ]
    case 'sparkle': // 閃光（清掉便便時）
      return [
        { t: 0, d: 0.12, type: 'sine', f0: 1320, gain: 0.5 },
        { t: 0.08, d: 0.12, type: 'sine', f0: 1760, gain: 0.45 },
        { t: 0.16, d: 0.2, type: 'sine', f0: 2093, gain: 0.4 },
      ]
  }
}

/** 一段音效的總長（秒） */
export const soundDuration = (voices: readonly Voice[]): number => voices.reduce((m, v) => Math.max(m, v.t + v.d), 0)

/** 最小的 AudioContext 形狀，方便測試時注入假的 */
export interface AudioLike {
  currentTime: number
  state?: string
  resume?: () => Promise<void> | void
  destination: unknown
  createOscillator(): {
    type: string
    frequency: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }
    connect(n: unknown): unknown
    start(t: number): void
    stop(t: number): void
  }
  createGain(): {
    gain: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }
    connect(n: unknown): unknown
  }
  createBiquadFilter(): { type: string; frequency: { value: number }; connect(n: unknown): unknown }
  createBuffer(ch: number, len: number, rate: number): { getChannelData(c: number): Float32Array }
  createBufferSource(): { buffer: unknown; connect(n: unknown): unknown; start(t: number): void; stop(t: number): void }
  sampleRate: number
}

const FLOOR = 0.0001

/** 把配方排進 AudioContext（可單元測試：ctx 可注入）。訊號鏈：來源 →（低通）→ 增益 → 輸出 */
export function renderVoices(ctx: AudioLike, voices: readonly Voice[], volume = 1): void {
  const t0 = ctx.currentTime
  for (const v of voices) {
    const peak = Math.max(FLOOR * 2, v.gain * MASTER_GAIN * volume)
    const g = ctx.createGain()
    g.gain.setValueAtTime(FLOOR, t0 + v.t)
    g.gain.exponentialRampToValueAtTime(peak, t0 + v.t + Math.min(0.02, v.d / 3))
    g.gain.exponentialRampToValueAtTime(FLOOR, t0 + v.t + v.d)
    g.connect(ctx.destination)

    let entry: { connect(n: unknown): unknown } = g
    if (v.type === 'noise' || v.lp) {
      const f = ctx.createBiquadFilter()
      // 雜訊沒有指定低通時，用 f0 當中心頻率做帶通
      f.type = v.lp ? 'lowpass' : 'bandpass'
      f.frequency.value = v.lp ?? v.f0
      f.connect(g)
      entry = f
    }

    if (v.type === 'noise') {
      const len = Math.max(1, Math.ceil(ctx.sampleRate * (v.d + 0.05)))
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(entry)
      src.start(t0 + v.t)
      src.stop(t0 + v.t + v.d + 0.05)
    } else {
      const o = ctx.createOscillator()
      o.type = v.type
      o.frequency.setValueAtTime(v.f0, t0 + v.t)
      if (v.f1 && v.f1 !== v.f0) o.frequency.exponentialRampToValueAtTime(v.f1, t0 + v.t + v.d)
      o.connect(entry)
      o.start(t0 + v.t)
      o.stop(t0 + v.t + v.d + 0.05)
    }
  }
}

/** 播放寵物音效；soundOn=false 或不支援 WebAudio 時靜音 */
export function playPetSound(kind: PetSound, enabled = true, rng: () => number = Math.random): void {
  if (!enabled) return
  const c = audio()
  if (!c) return
  try {
    if (c.state === 'suspended') void c.resume()
    renderVoices(c as unknown as AudioLike, soundVoices(kind, rng))
  } catch {
    /* 音效失敗不影響遊戲 */
  }
}
