/**
 * 簡單音效。v8 起實際發聲交給單一引擎（audioEngine.ts）：有音檔播音檔、沒有就退回原本的 WebAudio 合成音。
 * 這裡只留舊 API 的薄包裝：soundOn=false 或不支援時靜音。
 */
import { audio, playSound } from './audioEngine'

type Kind = 'correct' | 'wrong' | 'reward' | 'tap'

/** 共用的 AudioContext（寵物音效也用這個）；不支援時回 null */
export { audio }

export function playSfx(kind: Kind, enabled = true): void {
  if (!enabled) return
  playSound(kind)
}
