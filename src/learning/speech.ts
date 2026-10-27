/**
 * 語音唸題（Web Speech API，zh-TW）。
 * 不支援時所有函式都安靜地什麼都不做，畫面仍有字幕。
 */

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
}

/** 唸出文字（會先取消前一句）。回傳是否真的開始唸。 */
export function speak(text: string, opts: SpeakOptions = {}): boolean {
  const s = synth()
  if (!s || opts.enabled === false || !text) return false
  try {
    s.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-TW'
    u.rate = opts.rate ?? 0.9
    u.pitch = 1.15
    const v = pickZhTwVoice(s.getVoices())
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
  try {
    synth()?.cancel()
  } catch {
    /* ignore */
  }
  stopLineAudio()
}

// ---------- 預先錄好的音檔（key → 檔案網址）。這一輪還沒接，介面先備好 ----------
let lineAudio: Record<string, string> = {}
let playing: HTMLAudioElement | null = null

/** 註冊預錄音檔：key（見 lines.ts）→ 音檔網址。沒註冊的 key 一律退回 Web Speech */
export function registerLineAudio(map: Record<string, string>): void {
  lineAudio = { ...map }
}

function stopLineAudio(): void {
  try {
    playing?.pause()
  } catch {
    /* ignore */
  }
  playing = null
}

/**
 * 唸一句有 key 的台詞：有預錄音檔就播檔，沒有才用 Web Speech 唸 text。
 * 所有會唸出來的句子都走這裡（key 見 lines.ts）。
 */
export function say(key: string, text: string, opts: SpeakOptions = {}): boolean {
  if (opts.enabled === false) return false
  const url = lineAudio[key]
  if (url && typeof Audio !== 'undefined') {
    try {
      synth()?.cancel()
      stopLineAudio()
      const a = new Audio(url)
      playing = a
      if (opts.onEnd) {
        a.onended = opts.onEnd
        a.onerror = opts.onEnd
      }
      void a.play().catch(() => opts.onEnd?.())
      return true
    } catch {
      /* 退回 Web Speech */
    }
  }
  return speak(text, opts)
}

export { chineseNumber }

/** 數數用的語音稿：「一、二、三」 */
export function countAloud(n: number): string {
  return Array.from({ length: n }, (_, i) => chineseNumber(i + 1)).join('、')
}
