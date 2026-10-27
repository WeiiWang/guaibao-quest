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
    stopLineAudio()
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

/** 註冊預錄音檔：key（見 lines.ts）→ 網址（或 {url, text}）。沒註冊的 key 一律退回 Web Speech */
export function registerLineAudio(map: Record<string, string | LineAudio>): void {
  lineAudio = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, typeof v === 'string' ? { url: v } : v]))
  textIndex = {}
  for (const [k, v] of Object.entries(lineAudio)) if (v.text && !(v.text in textIndex)) textIndex[v.text] = k
}

/** 沒有 key 的句子：用原文找預錄音檔，找不到就用 Web Speech */
export function sayText(text: string, opts: SpeakOptions = {}): boolean {
  const key = textIndex[text]
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
  if (opts.enabled === false) return false
  const line = lineAudio[key]
  const a = line && (!line.text || !text || line.text === text) ? getPlayer() : null
  if (line && a) {
    try {
      synth()?.cancel()
      stopLineAudio()
      let fellBack = false
      const fallback = () => {
        if (fellBack) return
        fellBack = true
        if (!speak(text, opts)) opts.onEnd?.()
      }
      a.onended = opts.onEnd ? () => opts.onEnd?.() : null
      a.onerror = fallback
      a.src = line.url
      void a.play().catch(fallback)
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
