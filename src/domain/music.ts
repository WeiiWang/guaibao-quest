import type { AgeBand } from './types'

// v8.3 小小音樂會：音階、歌譜（皆公版旋律）與魔法演奏的進度規則（純函式）。沒有錯、不扣分。

/** 木琴 8 鍵：C 大調 C5 到 C6，紅到紫 */
export const MUSIC_NOTES = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'] as const
export type MusicNote = (typeof MUSIC_NOTES)[number]

export const NOTE_FREQ: Record<MusicNote, number> = {
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  A5: 880,
  B5: 987.77,
  C6: 1046.5,
}

export const NOTE_COLOR: Record<MusicNote, string> = {
  C5: '#ef5350',
  D5: '#fb8c3c',
  E5: '#f7c631',
  F5: '#62bf5a',
  G5: '#2fb9a5',
  A5: '#3f9fe6',
  B5: '#5c6fd6',
  C6: '#a05cd0',
}

export type SongId = 'twinkle' | 'tigers'

export interface Song {
  id: SongId
  title: string
  notes: readonly MusicNote[]
}

const n = (s: string) => s.split(' ') as MusicNote[]

export const SONGS: readonly Song[] = [
  {
    id: 'twinkle',
    title: '小星星',
    notes: n('C5 C5 G5 G5 A5 A5 G5  F5 F5 E5 E5 D5 D5 C5  G5 G5 F5 F5 E5 E5 D5  G5 G5 F5 F5 E5 E5 D5  C5 C5 G5 G5 A5 A5 G5  F5 F5 E5 E5 D5 D5 C5'.replace(/ +/g, ' ')),
  },
  {
    id: 'tigers',
    title: '兩隻老虎',
    // 原曲最後兩句「do 低 sol do」的低音 sol 不在木琴上，這三個音整組高八度（C6 G5 C6），音程不變
    notes: n('C5 D5 E5 C5  C5 D5 E5 C5  E5 F5 G5  E5 F5 G5  G5 A5 G5 F5 E5 C5  G5 A5 G5 F5 E5 C5  C6 G5 C6  C6 G5 C6'.replace(/ +/g, ' ')),
  },
]

/** 自由彈累計敲幾下算玩完（讓只想亂敲的孩子也拿得到） */
export const FREE_PLAY_GOAL = 30

/** 3 歲、4–5 歲：按任何鍵都彈出下一個音；6–7 歲：按亮的鍵才前進 */
export const anyKeyAdvances = (band: AgeBand): boolean => band !== '6-7'

export interface SongStep {
  /** 這一下實際發出的音 */
  play: MusicNote
  /** 下一個音的位置 */
  index: number
  advanced: boolean
  /** 整首彈完了 */
  done: boolean
}

/** 魔法演奏按一下：回傳該發什麼音、進度走到哪。按別的鍵（6–7 歲）還是會發聲，只是不前進，也不算錯 */
export function songStep(song: Song, index: number, pressed: MusicNote, band: AgeBand): SongStep {
  const next = song.notes[index]
  if (next === undefined) return { play: pressed, index, advanced: false, done: true }
  if (!anyKeyAdvances(band) && pressed !== next) return { play: pressed, index, advanced: false, done: false }
  const to = index + 1
  return { play: next, index: to, advanced: true, done: to >= song.notes.length }
}

/** 下一個要亮的鍵；彈完了回 null */
export const nextNote = (song: Song, index: number): MusicNote | null => song.notes[index] ?? null
