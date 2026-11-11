import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  JIGSAW_TAB,
  PUZZLE_EXTRA,
  PUZZLE_SCENES,
  PUZZLE_SIZES,
  cropRect,
  gridOf,
  jigsawEdges,
  jigsawPath,
  puzzleLayout,
  puzzleScenes,
  saySnap,
  shuffleOrder,
  slotOf,
  snaps,
  tiltOf,
  usesJigsaw,
} from './puzzle'

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

describe('v8.5 新圖片', () => {
  it('沒有新玩具：圖片清單跟 v8.4 一模一樣', () => {
    expect(puzzleScenes(0)).toEqual(PUZZLE_SCENES.map((id) => ({ id })))
  })
  it('有了之後多 6 張，排在前面；原本的 8 張順序不變', () => {
    const list = puzzleScenes(1)
    expect(PUZZLE_EXTRA).toHaveLength(6)
    expect(list).toHaveLength(PUZZLE_SCENES.length + 6)
    expect(list.slice(0, 6)).toEqual(PUZZLE_EXTRA)
    expect(list.slice(6).map((s) => s.id)).toEqual([...PUZZLE_SCENES])
    expect(puzzleScenes(2)).toEqual(list)
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length)
  })
  it('新圖都是現有的故事圖或場景圖（檔案真的在）', () => {
    for (const s of PUZZLE_EXTRA) {
      expect(s.id).toMatch(/^(story|scene)-/)
      expect(existsSync(fileURLToPath(new URL(`../../public/art/${s.id}.jpg`, import.meta.url)))).toBe(true)
    }
  })
  it('裁圖：沒有指定就是正中間最大的一塊（原本的裁法）', () => {
    expect(cropRect(1600, 900, 3, 3)).toEqual({ x: 350, y: 0, w: 900, h: 900 })
    expect(cropRect(1600, 900, 3, 2)).toEqual({ x: 125, y: 0, w: 1350, h: 900 })
    expect(cropRect(600, 900, 2, 2)).toEqual({ x: 0, y: 150, w: 600, h: 600 })
  })
  it('裁圖：指定主體時裁小一點、移到主體上，比例不變、不會裁到圖外面', () => {
    for (const s of PUZZLE_EXTRA)
      for (const n of [4, 6, 9, 16]) {
        const { cols, rows } = gridOf(n)
        const r = cropRect(1600, 900, cols, rows, s.focus)
        expect(r.w / r.h).toBeCloseTo(cols / rows, 6)
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(1600 + 1e-6)
        expect(r.y + r.h).toBeLessThanOrEqual(900 + 1e-6)
        // 放大不超過 1.5 倍：裁出來的圖不會糊
        expect(r.h).toBeGreaterThanOrEqual(600)
      }
    // 中心點太靠邊：夾回圖裡
    expect(cropRect(1600, 900, 2, 2, { cx: 0, cy: 0, zoom: 2 })).toEqual({ x: 0, y: 0, w: 450, h: 450 })
    expect(cropRect(1600, 900, 2, 2, { cx: 1, cy: 1, zoom: 2 })).toEqual({ x: 1150, y: 450, w: 450, h: 450 })
  })
})

describe('v8.5 凹凸形狀', () => {
  it('兩個新玩具都有、而且 4 歲以上才用；3 歲維持方塊', () => {
    expect(usesJigsaw(0, '6-7')).toBe(false)
    expect(usesJigsaw(1, '6-7')).toBe(false)
    expect(usesJigsaw(2, '6-7')).toBe(true)
    expect(usesJigsaw(2, '4-5')).toBe(true)
    expect(usesJigsaw(2, '3')).toBe(false)
  })
  it('圖的外緣是平的；相鄰兩片一凸一凹', () => {
    for (const n of [4, 6, 9, 16]) {
      const { cols, rows } = gridOf(n)
      for (let i = 0; i < n; i++) {
        const e = jigsawEdges(i, cols, rows)
        const c = i % cols
        const r = Math.floor(i / cols)
        expect(e.top === 0).toBe(r === 0)
        expect(e.left === 0).toBe(c === 0)
        expect(e.right === 0).toBe(c === cols - 1)
        expect(e.bottom === 0).toBe(r === rows - 1)
        if (c < cols - 1) expect(e.right + jigsawEdges(i + 1, cols, rows).left).toBe(0)
        if (r < rows - 1) expect(e.bottom + jigsawEdges(i + cols, cols, rows).top).toBe(0)
      }
    }
  })
  it('只看位置、不用亂數：每次都一樣；中間的片有凸也有凹', () => {
    expect(jigsawEdges(5, 4, 4)).toEqual(jigsawEdges(5, 4, 4))
    const e = jigsawEdges(5, 4, 4)
    const kinds = [e.top, e.right, e.bottom, e.left]
    expect(kinds).toContain(1)
    expect(kinds).toContain(-1)
  })
  it('外框：四邊都平就是正方形；凸出去不超過 JIGSAW_TAB', () => {
    expect(jigsawPath({ top: 0, right: 0, bottom: 0, left: 0 }, 100)).toBe('M0 0L100 0L100 100L0 100L0 0Z')
    const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
    for (const k of [-1, 1] as const) {
      const d = jigsawPath({ top: k, right: k, bottom: k, left: k }, 100)
      expect(d.startsWith('M0 0')).toBe(true)
      expect(d.endsWith('Z')).toBe(true)
      const v = nums(d)
      expect(Math.min(...v)).toBeGreaterThanOrEqual(-JIGSAW_TAB * 100 - 0.01)
      expect(Math.max(...v)).toBeLessThanOrEqual(100 + JIGSAW_TAB * 100 + 0.01)
      // 凸的會超出格子、凹的不會
      expect(Math.min(...v) < 0).toBe(k === 1)
    }
  })
  it('相鄰兩片的凹凸是同一條線（拼起來沒有縫）', () => {
    // 左邊那片的右邊（凸）＝ 右邊那片的左邊（凹）平移一片的寬度
    const pts = (d: string) => {
      const v = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
      const out: string[] = []
      for (let i = 0; i < v.length; i += 2) out.push(`${v[i].toFixed(1)},${v[i + 1].toFixed(1)}`)
      return out
    }
    const a = pts(jigsawPath(jigsawEdges(0, 3, 3), 100)).filter((q) => Number(q.split(',')[0]) >= 100)
    const b = pts(jigsawPath(jigsawEdges(1, 3, 3), 100))
      .filter((q) => Number(q.split(',')[0]) <= 22.01)
      .map((q) => `${(Number(q.split(',')[0]) + 100).toFixed(1)},${q.split(',')[1]}`)
    expect(a.length).toBeGreaterThan(10)
    expect(new Set(a)).toEqual(new Set(b))
  })
  it('排版：凸出去的部分留在桌面裡（靠邊的那幾邊多留一點），片數夠放', () => {
    for (const [w, h, n] of [
      [1156, 660, 16],
      [1156, 660, 9],
      [796, 1040, 9],
      [366, 700, 16],
    ] as const) {
      const L = puzzleLayout(w, h, n, JIGSAW_TAB)
      const pd = JIGSAW_TAB * L.piece
      expect(L.spots.length).toBeGreaterThanOrEqual(n)
      const base = puzzleLayout(w, h, n)
      // 一片不會因為形狀變小超過一成
      expect(L.piece).toBeGreaterThanOrEqual(base.piece * 0.9)
      for (const s of L.spots.slice(0, n)) {
        expect(s.x).toBeGreaterThanOrEqual(pd - 0.01)
        expect(s.x + L.piece).toBeLessThanOrEqual(w - pd + 0.01)
        expect(s.y + L.piece).toBeLessThanOrEqual(h - pd + 0.01)
      }
    }
  })
  it('排版：不給 tab 時跟原本一模一樣', () => {
    expect(puzzleLayout(1156, 660, 16, 0)).toEqual(puzzleLayout(1156, 660, 16))
  })
})
