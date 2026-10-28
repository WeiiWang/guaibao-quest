import { describe, expect, it } from 'vitest'
import {
  bestFrame,
  COUNT_MIN_PCT,
  countsAsFinished,
  FRAME_LINES,
  FRAMES,
  framesToGo,
  isFrameId,
  isFrameUnlocked,
  newlyUnlocked,
  nextFrame,
  unlockedFrames,
} from './frames'
import { STATIC_LINES } from '../learning/lines'

describe('畫框收藏的門檻（1、3、6、10、15 幅，固定不抽籤）', () => {
  it('五種畫框依序：木 → 銀 → 金 → 彩虹 → 星星，門檻 1、3、6、10、15', () => {
    expect(FRAMES.map((f) => [f.id, f.need])).toEqual([
      ['wood', 1],
      ['silver', 3],
      ['gold', 6],
      ['rainbow', 10],
      ['star', 15],
    ])
    expect(FRAMES.map((f) => f.name)).toEqual(['木框', '銀框', '金框', '彩虹框', '星星框'])
  })
  it('累計幅數 → 已解鎖的畫框', () => {
    expect(unlockedFrames(0)).toEqual([])
    expect(unlockedFrames(undefined)).toEqual([])
    expect(unlockedFrames(1).map((f) => f.id)).toEqual(['wood'])
    expect(unlockedFrames(2).map((f) => f.id)).toEqual(['wood'])
    expect(unlockedFrames(3).map((f) => f.id)).toEqual(['wood', 'silver'])
    expect(unlockedFrames(10).map((f) => f.id)).toEqual(['wood', 'silver', 'gold', 'rainbow'])
    expect(unlockedFrames(15)).toHaveLength(5)
    expect(unlockedFrames(99)).toHaveLength(5)
    expect(unlockedFrames(-3)).toEqual([])
  })
  it('剛好跨過門檻那一幅才算「新解鎖」', () => {
    const seq = Array.from({ length: 16 }, (_, i) => newlyUnlocked(i, i + 1).map((f) => f.id))
    expect(seq[0]).toEqual(['wood'])
    expect(seq[1]).toEqual([])
    expect(seq[2]).toEqual(['silver'])
    expect(seq[5]).toEqual(['gold'])
    expect(seq[9]).toEqual(['rainbow'])
    expect(seq[14]).toEqual(['star'])
    expect(seq.flat()).toHaveLength(5)
    expect(newlyUnlocked(0, 15)).toHaveLength(5) // 一次補算多個
  })
  it('isFrameUnlocked / framesToGo / nextFrame / bestFrame', () => {
    expect(isFrameUnlocked('silver', 2)).toBe(false)
    expect(isFrameUnlocked('silver', 3)).toBe(true)
    expect(isFrameUnlocked('plastic', 99)).toBe(false)
    expect(isFrameUnlocked(undefined, 99)).toBe(false)
    expect(framesToGo('gold', 4)).toBe(2)
    expect(framesToGo('gold', 6)).toBe(0)
    expect(nextFrame(0)?.id).toBe('wood')
    expect(nextFrame(3)?.id).toBe('gold')
    expect(nextFrame(15)).toBeUndefined()
    expect(bestFrame(0)).toBeUndefined()
    expect(bestFrame(7)?.id).toBe('gold')
    expect(isFrameId('star')).toBe(true)
    expect(isFrameId('plain')).toBe(false)
  })
})

describe('什麼算「完成一幅」', () => {
  it('著色頁完成度 ≥ 60% 才算；空白畫紙不看完成度', () => {
    expect(COUNT_MIN_PCT).toBe(60)
    expect(countsAsFinished(false, 59)).toBe(false)
    expect(countsAsFinished(false, 60)).toBe(true)
    expect(countsAsFinished(false, 100)).toBe(true)
    expect(countsAsFinished(true, 0)).toBe(true)
  })
})

describe('新句子', () => {
  it('FRAME_LINES 與 lines.ts 的固定台詞一字不差（預錄音檔靠它找）', () => {
    for (const [k, v] of Object.entries(FRAME_LINES)) expect(STATIC_LINES[k], k).toEqual(v)
  })
})
