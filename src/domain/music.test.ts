import { describe, expect, it } from 'vitest'
import { FREE_PLAY_GOAL, MUSIC_NOTES, NOTE_COLOR, NOTE_FREQ, SONGS, anyKeyAdvances, nextNote, songStep, type MusicNote, type Song } from './music'

const song = (id: string): Song => {
  const s = SONGS.find((x) => x.id === id)
  if (!s) throw new Error(id)
  return s
}

describe('音階', () => {
  it('8 鍵，C5 到 C6，音高遞增', () => {
    expect(MUSIC_NOTES).toHaveLength(8)
    expect(MUSIC_NOTES[0]).toBe('C5')
    expect(MUSIC_NOTES[7]).toBe('C6')
    for (let i = 1; i < 8; i++) expect(NOTE_FREQ[MUSIC_NOTES[i]]).toBeGreaterThan(NOTE_FREQ[MUSIC_NOTES[i - 1]])
    expect(NOTE_FREQ.C6 / NOTE_FREQ.C5).toBeCloseTo(2, 2)
  })
  it('每一鍵顏色不同', () => {
    expect(new Set(MUSIC_NOTES.map((n) => NOTE_COLOR[n])).size).toBe(8)
  })
})

describe('歌譜', () => {
  it('每一個音都在木琴範圍內', () => {
    for (const s of SONGS) for (const n of s.notes) expect(MUSIC_NOTES).toContain(n)
  })
  it('小星星 6 句共 42 個音，開頭與結尾正確', () => {
    const s = song('twinkle')
    expect(s.notes).toHaveLength(42)
    expect(s.notes.slice(0, 7)).toEqual(['C5', 'C5', 'G5', 'G5', 'A5', 'A5', 'G5'])
    expect(s.notes.at(-1)).toBe('C5')
  })
  it('兩隻老虎共 32 個音，最後一句 do sol do 整組高八度、音程不變', () => {
    const s = song('tigers')
    expect(s.notes).toHaveLength(32)
    expect(s.notes.slice(0, 4)).toEqual(['C5', 'D5', 'E5', 'C5'])
    expect(s.notes.slice(-3)).toEqual(['C6', 'G5', 'C6'])
  })
})

describe('魔法演奏', () => {
  it('3 歲與 4–5 歲按任何鍵都彈出下一個音，一定彈得完整首', () => {
    for (const band of ['3', '4-5'] as const) {
      for (const s of SONGS) {
        let i = 0
        const played: MusicNote[] = []
        let done = false
        // 一直亂按同一個鍵
        while (!done) {
          const r = songStep(s, i, 'B5', band)
          played.push(r.play)
          expect(r.advanced).toBe(true)
          i = r.index
          done = r.done
        }
        expect(played).toEqual(s.notes)
      }
    }
  })

  it('6–7 歲按別的鍵還是發聲，但不前進、也不算完成', () => {
    const s = song('twinkle')
    const r = songStep(s, 0, 'B5', '6-7')
    expect(r).toEqual({ play: 'B5', index: 0, advanced: false, done: false })
  })

  it('6–7 歲按亮的鍵才前進，按完最後一個音才算完成', () => {
    const s = song('tigers')
    let i = 0
    for (const note of s.notes) {
      expect(nextNote(s, i)).toBe(note)
      const r = songStep(s, i, note, '6-7')
      expect(r.play).toBe(note)
      expect(r.advanced).toBe(true)
      i = r.index
      expect(r.done).toBe(i === s.notes.length)
    }
    expect(nextNote(s, i)).toBeNull()
  })

  it('已經彈完再按：只發按的音，不前進', () => {
    const s = song('twinkle')
    expect(songStep(s, s.notes.length, 'E5', '3')).toEqual({ play: 'E5', index: s.notes.length, advanced: false, done: true })
  })

  it('年齡規則', () => {
    expect(anyKeyAdvances('3')).toBe(true)
    expect(anyKeyAdvances('4-5')).toBe(true)
    expect(anyKeyAdvances('6-7')).toBe(false)
  })

  it('自由彈約 30 下算玩完', () => {
    expect(FREE_PLAY_GOAL).toBe(30)
  })
})
