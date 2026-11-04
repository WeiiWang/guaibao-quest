import { normSpecies, type Species } from './species'

// v8.3 學我說話的純邏輯：什麼時候算開始說話、什麼時候算說完、要播回哪一段、聲音變多高。
// 真正碰麥克風的部分在 ui/screens/playground/talkEngine.ts。

/** 靜音這麼久算說完 */
export const TALK_SILENCE_MS = 900
/** 一句最長這麼久 */
export const TALK_MAX_MS = 6000
/** 短於這個長度的聲音（拍手、碰到 iPad）不算說話 */
export const TALK_MIN_VOICE_MS = 200
/** 門檻的下限：就算房間很安靜，音量（RMS）也要過這個才算開始 */
export const TALK_MIN_LEVEL = 0.03
/** 門檻 = 環境音的幾倍 */
export const TALK_FLOOR_RATIO = 3
/** 寵物說完（或播回完）多久才開始聽：避開房間裡的回音 */
export const TALK_DEAF_MS = 350
/** 一直沒聲音時，隔多久寵物再邀一次（一次比一次久，最多三次，不催促） */
export const TALK_NUDGE_MS: readonly number[] = [14_000, 30_000, 60_000]

export interface VoiceGate {
  phase: 'quiet' | 'voice'
  /** 環境音的估計（只在安靜時更新） */
  floor: number
  onsetAt: number
  lastLoudAt: number
}

export type GateEvent = 'start' | 'stop' | 'blip' | null

export const newGate = (floor = 0): VoiceGate => ({ phase: 'quiet', floor, onsetAt: 0, lastLoudAt: 0 })

/** 現在要多大聲才算開始說話 */
export const gateStartLevel = (floor: number): number => Math.max(TALK_MIN_LEVEL, floor * TALK_FLOOR_RATIO)

/**
 * 每一次取樣走一步。開始的門檻比「還在說」的門檻高（遲滯），句子中間聲音變小不會被切斷。
 * - start：開始收
 * - stop：這句說完了（靜音夠久，或到最長）
 * - blip：只是一下短短的聲音，當作沒聽到
 */
export function stepGate(g: VoiceGate, level: number, now: number): { gate: VoiceGate; event: GateEvent } {
  const startAt = gateStartLevel(g.floor)
  if (g.phase === 'quiet') {
    if (level >= startAt) return { gate: { ...g, phase: 'voice', onsetAt: now, lastLoudAt: now }, event: 'start' }
    return { gate: { ...g, floor: g.floor + (level - g.floor) * 0.05 }, event: null }
  }
  const lastLoudAt = level >= startAt * 0.5 ? now : g.lastLoudAt
  if (now - g.onsetAt >= TALK_MAX_MS) return { gate: { ...g, phase: 'quiet', lastLoudAt }, event: 'stop' }
  if (now - lastLoudAt >= TALK_SILENCE_MS) {
    const event: GateEvent = lastLoudAt - g.onsetAt < TALK_MIN_VOICE_MS ? 'blip' : 'stop'
    return { gate: { ...g, phase: 'quiet', lastLoudAt }, event }
  }
  return { gate: { ...g, lastLoudAt }, event: null }
}

/** 一段取樣的音量（RMS） */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/** 開口前多收一點：門檻是聲音變大才過的，第一個字的開頭在門檻之前 */
const PRE_ROLL_S = 0.3
const TAIL_S = 0.2

/**
 * 要播回錄音的哪一段（秒）。從錄音的尾巴往回算，不從開頭算：
 * 錄音一直開著等孩子開口，而 MediaRecorder 真正開始的時間各瀏覽器差很多（Safari 可能晚幾百毫秒），尾巴才是準的。
 */
export function speechWindow(durationS: number, t: { onsetAt: number; lastLoudAt: number; stopAt: number }): { start: number; end: number } {
  const start = durationS - (t.stopAt - t.onsetAt) / 1000 - PRE_ROLL_S
  const end = durationS - (t.stopAt - t.lastLoudAt) / 1000 + TAIL_S
  return { start: Math.max(0, start), end: Math.min(durationS, Math.max(end, 0)) }
}

export interface SpeechRange {
  /** 秒 */
  start: number
  end: number
  peak: number
}

/** 這段裡真的有聲音的範圍（去頭尾的靜音）；幾乎沒有聲音回 null（錄失敗或被系統靜音，就不播了） */
export function speechRange(samples: ArrayLike<number>, sampleRate: number, win: { start: number; end: number }): SpeechRange | null {
  const from = Math.max(0, Math.floor(win.start * sampleRate))
  const to = Math.min(samples.length, Math.ceil(win.end * sampleRate))
  if (to <= from) return null
  const frame = Math.max(1, Math.floor(sampleRate * 0.02))
  let peak = 0
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]))
  if (peak < 0.01) return null
  const limit = Math.max(peak * 0.08, 0.004)
  let first = -1
  let last = -1
  for (let i = from; i < to; i += frame) {
    let m = 0
    const stop = Math.min(to, i + frame)
    for (let j = i; j < stop; j++) m = Math.max(m, Math.abs(samples[j]))
    if (m >= limit) {
      if (first < 0) first = i
      last = stop
    }
  }
  if (first < 0) return null
  return { start: Math.max(win.start, first / sampleRate - 0.04), end: Math.min(win.end, last / sampleRate + 0.08), peak }
}

/** 播回時放大多少：不管孩子說得多小聲，寵物都差不多大聲（有上限，不把雜音放到很大） */
export const playbackGain = (peak: number): number => Math.min(6, 0.9 / Math.max(peak, 0.001))

const RATE: Record<Species, number> = { monkey: 1.45, rabbit: 1.6, tiger: 1.3 }
/** 播回的速度（同時決定音調）：兔兔最尖、虎虎低一點 */
export const talkRate = (species?: Species | null): number => RATE[normSpecies(species)]

/** 第 n 次（從 0 算）沒聲音時要等多久才再邀；邀完三次就不再說了（回 null） */
export const nudgeAfter = (n: number): number | null => TALK_NUDGE_MS[n] ?? null
