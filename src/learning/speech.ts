/**
 * 語音唸題（Web Speech API；預設 zh-TW，英文單字用 en-US）。
 * 不支援時所有函式都安靜地什麼都不做，畫面仍有字幕。
 */

import { EN_LANG, enKey } from './english'
import { chineseNumber } from './lines'

function synth(): SpeechSynthesis | null {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
      ? window.speechSynthesis
      : null
  } catch {
    return null
  }
}

export function isSpeechSupported(): boolean {
  return synth() !== null
}

/** 挑一個英語語音（優先 en-US）；沒有就回傳 undefined（交給瀏覽器用 lang 決定） */
export function pickEnglishVoice(voices: Pick<SpeechSynthesisVoice, 'lang' | 'name'>[]): Pick<SpeechSynthesisVoice, 'lang' | 'name'> | undefined {
  const norm = (l: string) => l.replace('_', '-').toLowerCase()
  return voices.find((v) => norm(v.lang) === 'en-us') ?? voices.find((v) => norm(v.lang).startsWith('en'))
}

/** 依語言挑語音：en 開頭用英語語音，其他一律繁中 */
export function pickVoiceFor(voices: Pick<SpeechSynthesisVoice, 'lang' | 'name'>[], lang: string): Pick<SpeechSynthesisVoice, 'lang' | 'name'> | undefined {
  return lang.toLowerCase().startsWith('en') ? pickEnglishVoice(voices) : pickZhTwVoice(voices)
}

/** 挑一個繁中語音；沒有就回傳 undefined（交給瀏覽器用 lang 決定） */
export function pickZhTwVoice(voices: Pick<SpeechSynthesisVoice, 'lang' | 'name'>[]): Pick<SpeechSynthesisVoice, 'lang' | 'name'> | undefined {
  const norm = (l: string) => l.replace('_', '-').toLowerCase()
  return (
    voices.find((v) => norm(v.lang) === 'zh-tw') ??
    voices.find((v) => norm(v.lang).startsWith('zh-hant')) ??
    voices.find((v) => norm(v.lang).startsWith('zh'))
  )
}

export interface SpeakOptions {
  /** false = 家長關閉語音，直接不唸 */
  enabled?: boolean
  rate?: number
  onEnd?: () => void
  /** 語言（BCP 47）。預設 zh-TW；英文單字用 en-US（見 english.ts 的 EN_LANG） */
  lang?: string
}

/**
 * 連續唸幾句（sayChain）的世代：任何一次直接呼叫 say / speak / cancelSpeech 都會讓進行中的連續唸作廢，
 * 這樣「被別句打斷」的那一句結束時，不會又把後面的英文單字唸出來蓋掉新的那句。
 */
let chainGen = 0

/** 唸出文字（會先取消前一句）。回傳是否真的開始唸。 */
export function speak(text: string, opts: SpeakOptions = {}): boolean {
  chainGen++
  return speakCore(text, opts)
}

function speakCore(text: string, opts: SpeakOptions): boolean {
  const s = synth()
  if (!s || opts.enabled === false || !text) return false
  try {
    s.cancel()
    stopLineAudio()
    const u = new SpeechSynthesisUtterance(text)
    const lang = opts.lang ?? 'zh-TW'
    const en = lang.toLowerCase().startsWith('en')
    u.lang = lang
    u.rate = opts.rate ?? (en ? 0.8 : 0.9)
    u.pitch = en ? 1.1 : 1.15
    const v = pickVoiceFor(s.getVoices(), lang)
    if (v) u.voice = v as SpeechSynthesisVoice
    if (opts.onEnd) {
      u.onend = opts.onEnd
      u.onerror = opts.onEnd
    }
    s.speak(u)
    return true
  } catch {
    return false
  }
}

export function cancelSpeech(): void {
  chainGen++
  try {
    synth()?.cancel()
  } catch {
    /* ignore */
  }
  stopLineAudio()
}

// ---------- 預先錄好的音檔（key → 檔案網址與原文）----------
// 音檔由 design/tools/gen_voice.py 用本機 Voicebox 預先生成（媽媽聲），清單在 public/voice/manifest.json。
interface LineAudio {
  url: string
  /** 生成音檔時的原文；呼叫時的文字不同（題目改過但還沒重新生成）就退回 Web Speech */
  text?: string
}
let lineAudio: Record<string, LineAudio> = {}
/** 原文 → key：給沒有 key 的固定句子用（sayText） */
let textIndex: Record<string, string> = {}
let player: HTMLAudioElement | null = null
let unlocked = false
/** 每次播預錄音檔 +1：舊的那一句的失敗回呼看到不是自己就不動作 */
let playGen = 0

/**
 * 沒有用到預錄音檔、改用機器語音的句子（除錯用）：記在 window.__gqVoiceMiss，
 * e2e 用它找出「還沒錄到」或「原文對不上」的句子。只記最後 200 筆。
 */
function missLog(reason: 'no-recording' | 'text-mismatch' | 'play-failed', text: string): void {
  if (typeof window === 'undefined' || !text) return
  const w = window as unknown as { __gqVoiceMiss?: { reason: string; text: string }[] }
  const list = (w.__gqVoiceMiss ??= [])
  list.push({ reason, text })
  if (list.length > 200) list.shift()
  try {
    if (localStorage.getItem('gq-voice-debug') === '1') console.debug('[voice-miss]', reason, text)
  } catch {
    /* ignore */
  }
}

/** 註冊預錄音檔：key（見 lines.ts）→ 網址（或 {url, text}）。沒註冊的 key 一律退回 Web Speech */
export function registerLineAudio(map: Record<string, string | LineAudio>): void {
  lineAudio = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, typeof v === 'string' ? { url: v } : v]))
  textIndex = {}
  for (const [k, v] of Object.entries(lineAudio)) if (v.text && !(v.text in textIndex)) textIndex[v.text] = k
}

/**
 * 只播預錄音檔、不退回 Web Speech：阿悟頭上的泡泡用（例如「嘻嘻」「臭臭～」）。
 * prefix 指定要哪一組聲音（例：'pet.' = 阿悟聲），找不到就安靜，回傳 false。
 */
export function sayRecorded(prefix: string, text: string, opts: SpeakOptions = {}): boolean {
  if (opts.enabled === false || !text) return false
  const key = Object.keys(lineAudio).find((k) => k.startsWith(prefix) && lineAudio[k].text === text)
  return key ? say(key, text, opts) : false
}

/** 沒有 key 的句子：用原文找預錄音檔，找不到就用 Web Speech */
export function sayText(text: string, opts: SpeakOptions = {}): boolean {
  const key = textIndex[text]
  if (!key && opts.enabled !== false) missLog('no-recording', text)
  return key ? say(key, text, opts) : speak(text, opts)
}

/** 共用一個播放器：iPad Safari 只允許「使用者觸碰過」的播放器自動播放，所以第一次觸碰時先解鎖它 */
function getPlayer(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  if (!player) player = new Audio()
  return player
}

/** 在第一次觸碰時呼叫：用一段靜音解鎖播放器（之後換 src 播放不會被擋） */
export function unlockLineAudio(): void {
  const a = getPlayer()
  if (!a || unlocked) return
  unlocked = true
  try {
    a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
    void a.play().catch(() => {
      unlocked = false
    })
  } catch {
    unlocked = false
  }
}

function stopLineAudio(): void {
  try {
    player?.pause()
  } catch {
    /* ignore */
  }
}

/**
 * 唸一句有 key 的台詞：有預錄音檔（且原文相符）就播檔，沒有或播放失敗才用 Web Speech 唸 text。
 * 所有會唸出來的句子都走這裡（key 見 lines.ts）。
 */
export function say(key: string, text: string, opts: SpeakOptions = {}): boolean {
  chainGen++
  return sayCore(key, text, opts)
}

function sayCore(key: string, text: string, opts: SpeakOptions): boolean {
  if (opts.enabled === false) return false
  const line = lineAudio[key]
  const a = line && (!line.text || !text || line.text === text) ? getPlayer() : null
  if (line && a) {
    try {
      synth()?.cancel()
      stopLineAudio()
      // 共用同一個播放器：下一句換 src 時，這一句的 play() 會以 AbortError 失敗。
      // 那是「被打斷」不是「播不出來」，不能退回機器語音（否則會用機器聲唸上一句、還把新那句的錄音停掉）。
      const gen = ++playGen
      let fellBack = false
      const fallback = (err?: unknown) => {
        if (fellBack || gen !== playGen) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        fellBack = true
        missLog('play-failed', text)
        if (!speakCore(text, opts)) opts.onEnd?.()
      }
      a.onended = opts.onEnd ? () => gen === playGen && opts.onEnd?.() : null
      a.onerror = () => fallback()
      a.src = line.url
      void a.play().catch(fallback)
      return true
    } catch {
      /* 退回 Web Speech */
    }
  }
  missLog(line ? 'text-mismatch' : 'no-recording', text)
  return speakCore(text, opts)
}

/** 唸一個英文單字：有預錄音檔（key = en.<word>）就播檔，沒有就用 Web Speech en-US */
export function sayEnglish(word: string, opts: SpeakOptions = {}): boolean {
  return say(enKey(word), word, { ...opts, lang: EN_LANG })
}

/** 連續唸的一句 */
export interface SayPart {
  key: string
  text: string
  lang?: string
}

/** 連續唸一句的最長等待：播放器沒有回報結束（iOS 偶爾會這樣）也要接著唸下一句 */
const CHAIN_STEP_TIMEOUT_MS = 12_000

/**
 * 依序唸幾句（例如中文題目 → 英文單字）。上一句唸完（或逾時）才唸下一句；
 * 中途有別的 say / speak / cancelSpeech，或再呼叫一次 sayChain，剩下的就不唸。
 * 回傳第一句是否真的開始唸。
 */
export function sayChain(parts: SayPart[], opts: Pick<SpeakOptions, 'enabled' | 'rate'> = {}): boolean {
  const gen = ++chainGen
  let first = false
  const run = (i: number): void => {
    if (gen !== chainGen || i >= parts.length) return
    const p = parts[i]
    let moved = false
    const timer = setTimeout(() => step(), CHAIN_STEP_TIMEOUT_MS)
    const step = () => {
      if (moved) return
      moved = true
      clearTimeout(timer)
      run(i + 1)
    }
    const ok = sayCore(p.key, p.text, { ...opts, lang: p.lang, onEnd: step })
    if (i === 0) first = ok
    if (!ok) step()
  }
  run(0)
  return first
}

export { chineseNumber }

/** 數數用的語音稿：「一、二、三」 */
export function countAloud(n: number): string {
  return Array.from({ length: n }, (_, i) => chineseNumber(i + 1)).join('、')
}
