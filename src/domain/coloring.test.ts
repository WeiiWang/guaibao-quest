import { describe, expect, it } from 'vitest'
import {
  difficultyStars,
  clampScale,
  completionPercent,
  completionRatio,
  docIsEmpty,
  docOf,
  emptyDoc,
  makeSpecialFill,
  PALETTE_24,
  parseFill,
  popUndo,
  pushRecent,
  pushUndo,
  strokeNear,
  UNDO_LIMIT,
} from './coloring'
import { COLORING_PAGES } from '../art/coloring/pages'
import { coloringSvgString, defsMarkup, fillAttr } from '../art/coloring/render'

describe('色盤與填色值', () => {
  it('24 色、不重複、都是 #rrggbb', () => {
    expect(PALETTE_24).toHaveLength(24)
    expect(new Set(PALETTE_24).size).toBe(24)
    expect(PALETTE_24.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
  })
  it('parseFill：純色與四種特殊填色；壞資料回 null', () => {
    expect(parseFill('#aabbcc')).toEqual({ type: 'solid', color: '#aabbcc' })
    expect(parseFill('rainbow')).toMatchObject({ type: 'special', kind: 'rainbow' })
    expect(parseFill('glitter:#aabbcc')).toEqual({ type: 'special', kind: 'glitter', base: '#aabbcc' })
    expect(parseFill(makeSpecialFill('stripes', '#112233'))).toMatchObject({ kind: 'stripes', base: '#112233' })
    expect(parseFill(makeSpecialFill('rainbow', '#112233'))).toMatchObject({ kind: 'rainbow' })
    for (const bad of [undefined, '', 'red', '#fff', 'dots:red', 'x:#aabbcc', '<script>']) expect(parseFill(bad)).toBeNull()
  })
  it('SVG：只輸出用到的圖樣定義，壞資料不會進 SVG', () => {
    expect(defsMarkup({ a: '#aabbcc' })).toBe('')
    const d = defsMarkup({ a: 'rainbow', b: 'dots:#aabbcc', c: 'dots:#aabbcc', d: 'stripes:#112233', e: 'evil"><script>' })
    expect(d).toContain('id="gq-rainbow"')
    expect(d.match(/id="gq-dots-aabbcc"/g)).toHaveLength(1)
    expect(d).toContain('id="gq-stripes-112233"')
    expect(d).not.toContain('script')
    expect(fillAttr('dots:#AABBCC')).toBe('url(#gq-dots-aabbcc)')
    expect(fillAttr('???')).toBe('#ffffff')
  })
  it('匯出用的 SVG 字串包含每個區域', () => {
    const page = COLORING_PAGES[0]
    const svg = coloringSvgString(page.id, { [page.regions[0].id]: 'rainbow' })!
    expect(svg.match(/<path d=/g)!.length).toBeGreaterThanOrEqual(page.regions.length)
    expect(svg).toContain('gq-rainbow')
    expect(coloringSvgString('nope', {})).toBeNull()
  })
})

describe('完成度', () => {
  const ids = ['a', 'b', 'c', 'd']
  it('已填區域比例；只算這張頁面有的區域與有效填色', () => {
    expect(completionRatio({}, ids)).toBe(0)
    expect(completionRatio({ a: '#aabbcc', b: 'rainbow' }, ids)).toBe(0.5)
    expect(completionRatio({ a: '#aabbcc', zzz: '#aabbcc', b: 'bad' }, ids)).toBe(0.25)
    expect(completionPercent({ a: '#aabbcc', b: '#aabbcc', c: '#aabbcc' }, ids)).toBe(75)
    expect(completionRatio(undefined, ids)).toBe(0)
    expect(completionRatio({}, [])).toBe(0)
  })
})

describe('復原 undo（最多 20 步）', () => {
  it('push 後 pop 回到前一個畫面', () => {
    let past: ReturnType<typeof emptyDoc>[] = []
    const a = emptyDoc()
    const b = { ...a, fills: { r1: '#aabbcc' } }
    past = pushUndo(past, a)
    past = pushUndo(past, b)
    const r1 = popUndo(past)!
    expect(r1.doc).toEqual(b)
    const r2 = popUndo(r1.past)!
    expect(r2.doc).toEqual(a)
    expect(popUndo(r2.past)).toBeNull()
  })
  it('超過上限只留最近 20 步，丟掉最舊的', () => {
    let past: number[] = []
    for (let i = 0; i < 35; i++) past = pushUndo(past, i)
    expect(past).toHaveLength(UNDO_LIMIT)
    expect(past[0]).toBe(15)
    expect(past.at(-1)).toBe(34)
  })
  it('不會改動原本的陣列', () => {
    const past = [1, 2]
    pushUndo(past, 3)
    popUndo(past)
    expect(past).toEqual([1, 2])
  })
})

describe('最近用過的顏色', () => {
  it('新的放最前、去重、最多 6 個', () => {
    let r: string[] = []
    for (const c of ['#111111', '#222222', '#333333', '#111111']) r = pushRecent(r, c)
    expect(r).toEqual(['#111111', '#333333', '#222222'])
    for (let i = 0; i < 10; i++) r = pushRecent(r, `#00000${i}`)
    expect(r).toHaveLength(6)
  })
})

describe('作品資料', () => {
  it('舊資料沒有筆刷 / 貼紙欄位時當成空陣列', () => {
    expect(docOf({ fills: { a: '#aabbcc' } })).toEqual({ fills: { a: '#aabbcc' }, strokes: [], stickers: [] })
    expect(docOf(undefined)).toEqual(emptyDoc())
    expect(docIsEmpty(emptyDoc())).toBe(true)
    expect(docIsEmpty({ ...emptyDoc(), strokes: [{ id: 's', color: '#000000', width: 5, points: [[1, 1]] }] })).toBe(false)
  })
  it('strokeNear：線附近算碰到、遠的不算', () => {
    const s = { id: 's', color: '#000000', width: 10, points: [[0, 0], [100, 0]] as [number, number][] }
    expect(strokeNear(s, 50, 3)).toBe(true)
    expect(strokeNear(s, 50, 30)).toBe(false)
    expect(strokeNear(s, 120, 0)).toBe(false)
    expect(strokeNear({ ...s, points: [[10, 10]] }, 12, 12)).toBe(true)
  })
  it('貼紙縮放限制在 0.4–3', () => {
    expect(clampScale(0.1)).toBe(0.4)
    expect(clampScale(9)).toBe(3)
    expect(clampScale(1.5)).toBe(1.5)
  })
})

describe('difficultyStars（v7.2 難度星等）', () => {
  it('依區塊數分三級：≤20、21–60、>60', () => {
    expect(difficultyStars(14)).toBe(1)
    expect(difficultyStars(20)).toBe(1)
    expect(difficultyStars(21)).toBe(2)
    expect(difficultyStars(60)).toBe(2)
    expect(difficultyStars(61)).toBe(3)
    expect(difficultyStars(103)).toBe(3)
  })
})
