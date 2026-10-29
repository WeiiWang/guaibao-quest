import { describe, expect, it } from 'vitest'
import { albumDateText, albumId, expectedCards, freshCards, missingCards, parseCardArt, sortAlbum } from './album'
import { TRICKS } from './tricks'
import { HATS } from './hats'
import { staticLineList } from '../learning/lines'
import type { AlbumCard } from './types'

const NOW = new Date(2026, 9, 27, 10, 0, 0).getTime()
const base = { petName: '阿悟', tricks: [], chapters: [] }

describe('expectedCards：依現況算出應該有的回憶卡', () => {
  it('蛋：一張都沒有', () => {
    expect(expectedCards({ ...base, stage: 'egg' })).toEqual([])
  })
  it('幼猴：孵化 1 張；成猴：孵化 + 長大', () => {
    expect(expectedCards({ ...base, stage: 'baby' }).map((c) => c.id)).toEqual([albumId.hatch])
    expect(expectedCards({ ...base, stage: 'adult' }).map((c) => c.id)).toEqual([albumId.hatch, albumId.grow])
  })
  it('孵化那張用幼猴的圖、長大那張用成猴的圖', () => {
    const [hatch, grow] = expectedCards({ ...base, stage: 'adult' })
    expect(parseCardArt(hatch.art).stage).toBe('baby')
    expect(parseCardArt(grow.art).stage).toBe('adult')
  })
  it('每一招、每個通關的章節、第一頂帽子各一張；不認得的招略過', () => {
    const cards = expectedCards({
      ...base,
      stage: 'adult',
      tricks: ['count', 'flip', 'nope'],
      chapters: [{ id: 'huaguoshan', name: '花果山', at: NOW - 86400000 }],
      firstHat: { id: 'hat-crown', at: NOW },
    })
    expect(cards.map((c) => c.id)).toEqual(['hatch', 'grow', 'trick:count', 'trick:flip', 'chapter:huaguoshan', 'hat:first'])
    expect(cards.find((c) => c.id === 'chapter:huaguoshan')).toMatchObject({ kind: 'chapter', caption: '我們一起通關了花果山！', at: NOW - 86400000 })
    expect(cards.find((c) => c.id === 'chapter:huaguoshan')?.approx).toBeUndefined()
    expect(cards.find((c) => c.id === 'hat:first')).toMatchObject({ kind: 'hat', hat: 'hat-crown', caption: '阿悟有第一頂帽子了：皇冠！' })
  })
  it('時間不明的卡標成 approx（畫面顯示「以前」）', () => {
    const cards = expectedCards({ ...base, stage: 'adult', tricks: ['count'], chapters: [{ id: 'huaguoshan', name: '花果山' }] })
    expect(cards.every((c) => c.approx)).toBe(true)
  })
})

describe('missingCards：扣掉已經有的、三種模式', () => {
  const exp = expectedCards({ ...base, stage: 'adult', tricks: ['hello'], chapters: [{ id: 'huaguoshan', name: '花果山', at: NOW - 1000 }] })
  it('補建（backfill）：不標新、日期維持估計', () => {
    const add = missingCards([], exp, NOW, 'backfill')
    expect(add).toHaveLength(exp.length)
    expect(add.every((c) => !c.fresh)).toBe(true)
    expect(add.find((c) => c.id === 'hatch')).toMatchObject({ at: 0, approx: true })
  })
  it('剛發生（event）：全部標新、時間記成現在', () => {
    const add = missingCards([], exp.filter((c) => c.id === 'hatch'), NOW, 'event')
    expect(add).toEqual([expect.objectContaining({ id: 'hatch', at: NOW, fresh: true })])
    expect(add[0].approx).toBeUndefined()
  })
  it('進首頁發現（sync）：新招、通關標新（通關保留真實時間）；孵化、長大安靜補上', () => {
    const add = missingCards([], exp, NOW, 'sync')
    expect(add.find((c) => c.id === 'hatch')).toMatchObject({ at: NOW })
    expect(add.find((c) => c.id === 'hatch')?.fresh).toBeUndefined()
    expect(add.find((c) => c.id === 'grow')?.fresh).toBeUndefined()
    expect(add.find((c) => c.id === 'trick:hello')).toMatchObject({ at: NOW, fresh: true })
    expect(add.find((c) => c.id === 'chapter:huaguoshan')).toMatchObject({ at: NOW - 1000, fresh: true })
  })
  it('已經有的 id 不會重複', () => {
    const have: AlbumCard[] = [{ id: 'hatch', at: 5, kind: 'hatch', art: 'pet-baby-cheer', caption: 'x' }]
    const add = missingCards(have, exp, NOW, 'sync')
    expect(add.map((c) => c.id)).not.toContain('hatch')
    expect(missingCards([...have, ...add], exp, NOW, 'sync')).toEqual([])
  })
})

describe('排序、日期、新卡', () => {
  const mk = (id: string, at: number, kind: AlbumCard['kind'], extra: Partial<AlbumCard> = {}): AlbumCard => ({ id, at, kind, art: 'pet-adult-happy', caption: id, ...extra })
  it('新的在前；估計日期的排最後（依孵化、長大、新招…的順序）', () => {
    const list = sortAlbum([mk('grow', 0, 'grow', { approx: true }), mk('a', 300, 'trick'), mk('hatch', 0, 'hatch', { approx: true }), mk('b', 500, 'chapter')])
    expect(list.map((c) => c.id)).toEqual(['b', 'a', 'hatch', 'grow'])
  })
  it('日期：幾月幾日；估計日期顯示「以前」', () => {
    expect(albumDateText({ at: NOW })).toBe('10月27日')
    expect(albumDateText({ at: 0, approx: true })).toBe('以前')
    expect(albumDateText({ at: NOW, approx: true })).toBe('以前')
  })
  it('freshCards 只挑還沒看過的，依時間先後', () => {
    expect(freshCards([mk('x', 9, 'trick', { fresh: true }), mk('y', 1, 'chapter', { fresh: true }), mk('z', 5, 'hat')]).map((c) => c.id)).toEqual(['y', 'x'])
    expect(freshCards(undefined)).toEqual([])
  })
  it('parseCardArt', () => {
    // v7.5：多一個物種（舊卡片的圖名 = 猴子）
    expect(parseCardArt('pet-adult-cheer')).toEqual({ species: 'monkey', stage: 'adult', pose: 'cheer' })
    expect(parseCardArt('pet-baby-think')).toEqual({ species: 'monkey', stage: 'baby', pose: 'think' })
    expect(parseCardArt('pet-rabbit-baby-happy')).toEqual({ species: 'rabbit', stage: 'baby', pose: 'happy' })
    expect(parseCardArt('pet-tiger-adult-dance')).toEqual({ species: 'tiger', stage: 'adult', pose: 'dance' })
  })
})

describe('回憶卡的話和 STATIC_LINES 一字不差（預錄的媽媽聲才找得到）', () => {
  const texts = new Set(staticLineList().map((l) => l.text))
  it('孵化、長大、每一招、第一頂帽子、已知的章節', () => {
    const cards = expectedCards({
      ...base,
      stage: 'adult',
      tricks: TRICKS.map((t) => t.id),
      chapters: [
        { id: 'huaguoshan', name: '花果山' },
        { id: 'english-island', name: '英文小島' },
      ],
      firstHat: { id: HATS[0].id },
    })
    for (const c of cards) expect(texts.has(c.caption), c.caption).toBe(true)
    for (const h of HATS) {
      const c = expectedCards({ ...base, stage: 'baby', firstHat: { id: h.id } }).find((x) => x.id === 'hat:first')!
      expect(texts.has(c.caption), c.caption).toBe(true)
    }
  })
})
