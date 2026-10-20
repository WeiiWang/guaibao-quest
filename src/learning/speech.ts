/**
 * 語音唸題（Web Speech API，zh-TW）。
 * 不支援時所有函式都安靜地什麼都不做，畫面仍有字幕。
 */

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
}

const NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
/** 1–20 轉中文數字（唸給孩子聽：一、二、三…） */
export function chineseNumber(n: number): string {
  if (n <= 10) return NUM[n] ?? String(n)
  if (n < 20) return `十${NUM[n - 10]}`
  if (n === 20) return '二十'
  return String(n)
}

/** 數數用的語音稿：「一、二、三」 */
export function countAloud(n: number): string {
  return Array.from({ length: n }, (_, i) => chineseNumber(i + 1)).join('、')
}
