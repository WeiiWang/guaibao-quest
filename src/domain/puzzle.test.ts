import { describe, expect, it } from 'vitest'
import { PUZZLE_SCENES, PUZZLE_SIZES, gridOf, puzzleLayout, saySnap, shuffleOrder, slotOf, snaps, tiltOf } from './puzzle'

describe('拼圖：片數依年齡', () => {
  it('3 歲 4 片、4–5 歲 6 或 9 片、6–7 歲 9 或 16 片', () => {
    expect(PUZZLE_SIZES['3']).toEqual([4])
    expect(PUZZLE_SIZES['4-5']).toEqual([6, 9])
    expect(PUZZLE_SIZES['6-7']).toEqual([9, 16])
  })
  it('格子：6 片是 3×2，其他是正方形', () => {
    expect(gridOf(4)).toEqual({ cols: 2, rows: 2 })
    expect(gridOf(6)).toEqual({ cols: 3, rows: 2 })
    expect(gridOf(9)).toEqual({ cols: 3, rows: 3 })
    expect(gridOf(16)).toEqual({ cols: 4, rows: 4 })
  })
  it('場景圖 6–8 張', () => {
    expect(PUZZLE_SCENES.length).toBeGreaterThanOrEqual(6)
    expect(PUZZLE_SCENES.length).toBeLessThanOrEqual(8)
  })
})

describe('拼圖：固定的洗牌', () => {
  it('同樣的圖與日期一定一樣，換一天或換一張圖就不同', () => {
    const a = shuffleOrder(9, 'scene-play-garden|2026-11-06|9')
    expect(shuffleOrder(9, 'scene-play-garden|2026-11-06|9')).toEqual(a)
    expect(shuffleOrder(9, 'scene-play-garden|2026-11-07|9')).not.toEqual(a)
    expect(shuffleOrder(9, 'scene-play-sky|2026-11-06|9')).not.toEqual(a)
  })
  it('是一個排列、而且不是原本的順序', () => {
    for (const n of [4, 6, 9, 16])
      for (const key of ['a', 'b', 'c', 'd', 'e']) {
        const o = shuffleOrder(n, key)
        expect([...o].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i))
        expect(o.every((v, i) => v === i)).toBe(false)
      }
  })
  it('歪斜角度固定、在 ±7 度內', () => {
    for (let i = 0; i < 16; i++) {
      const t = tiltOf(i, 'k')
      expect(t).toBe(tiltOf(i, 'k'))
      expect(Math.abs(t)).toBeLessThanOrEqual(7)
    }
  })
})

const overlap = (a: { x: number; y: number }, b: { x: number; y: number }, p: number) => Math.abs(a.x - b.x) < p - 0.5 && Math.abs(a.y - b.y) < p - 0.5

describe('拼圖：桌面排版', () => {
  const SIZES = [
    [1156, 700],
    [796, 1080],
    [366, 740],
  ] as const
  for (const [w, h] of SIZES)
    for (const n of [4, 6, 9, 16])
      it(`${w}x${h} ${n} 片：底板與碎片都在桌面內，碎片不壓底板`, () => {
        const L = puzzleLayout(w, h, n)
        const { cols, rows } = gridOf(n)
        expect(L.board.w / cols).toBeCloseTo(L.piece)
        expect(L.board.h / rows).toBeCloseTo(L.piece)
        expect(L.board.x).toBeGreaterThanOrEqual(-0.5)
        expect(L.board.y).toBeGreaterThanOrEqual(-0.5)
        expect(L.board.x + L.board.w).toBeLessThanOrEqual(w + 0.5)
        expect(L.board.y + L.board.h).toBeLessThanOrEqual(h + 0.5)
        expect(L.spots.length).toBeGreaterThanOrEqual(n)
        for (const s of L.spots.slice(0, n)) {
          expect(s.x).toBeGreaterThanOrEqual(-0.5)
          expect(s.y).toBeGreaterThanOrEqual(-0.5)
          expect(s.x + L.piece).toBeLessThanOrEqual(w + 0.5)
          expect(s.y + L.piece).toBeLessThanOrEqual(h + 0.5)
          const onBoard = s.x < L.board.x + L.board.w && s.x + L.piece > L.board.x && s.y < L.board.y + L.board.h && s.y + L.piece > L.board.y
          expect(onBoard).toBe(false)
        }
      })
  it('iPad 上 16 片也不用疊在一起，而且一片夠大（≥ 56）', () => {
    for (const [w, h] of SIZES.slice(0, 2)) {
      const L = puzzleLayout(w, h, 16)
      const s = L.spots.slice(0, 16)
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) expect(overlap(s[i], s[j], L.piece)).toBe(false)
      expect(L.piece).toBeGreaterThanOrEqual(56)
    }
  })
  it('手機 9 片：一片也 ≥ 56', () => {
    expect(puzzleLayout(366, 740, 9).piece).toBeGreaterThanOrEqual(56)
  })
  it('第 i 片的正確位置', () => {
    const board = { x: 100, y: 50, w: 300, h: 200 }
    expect(slotOf(board, 6, 0)).toEqual({ x: 100, y: 50 })
    expect(slotOf(board, 6, 2)).toEqual({ x: 300, y: 50 })
    expect(slotOf(board, 6, 4)).toEqual({ x: 200, y: 150 })
  })
})

describe('拼圖：吸過去', () => {
  it('3 歲比較寬鬆，6–7 歲要比較準', () => {
    expect(snaps(50, 0, 100, '3')).toBe(true)
    expect(snaps(50, 0, 100, '4-5')).toBe(false)
    expect(snaps(35, 0, 100, '4-5')).toBe(true)
    expect(snaps(35, 0, 100, '6-7')).toBe(false)
    expect(snaps(20, 20, 100, '6-7')).toBe(true)
  })
})

describe('拼圖：不要每片都說話', () => {
  it('第一片說，之後每 4 片說一次，最後一片留給「拼好了」', () => {
    const said = Array.from({ length: 16 }, (_, i) => saySnap(i + 1, 16))
    expect(said.filter(Boolean).length).toBe(4) // 1、4、8、12
    expect(saySnap(16, 16)).toBe(false)
    expect(saySnap(1, 4)).toBe(true)
    expect(saySnap(4, 4)).toBe(false)
  })
})
