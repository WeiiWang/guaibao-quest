import { describe, expect, it } from 'vitest'
import { FREE_MIN_STROKES, GALLERY_EMPTY_LINE, PAINT_FREE_LINE, countStrokes, freeCanvasEnough, PAINT_FULL_LINE, PAINT_LINES, PAINT_MORE_LINE, PAINT_REWARD_REASON, PAINT_STARS, PAINT_STARS_LINE, isFullyPainted, paintRewardKey } from './paintReward'
import { STATIC_LINES, allLines } from '../learning/lines'

describe('v7.3 F3：完成獎勵與新句子的規則', () => {
  it('固定 5 顆星星、理由「完成作品」', () => {
    expect(PAINT_STARS).toBe(5)
    expect(PAINT_REWARD_REASON).toBe('完成作品')
  })
  it('同一張只給一次的鍵：一般頁一張一次；空白畫紙每個欄位每天一次', () => {
    const d1 = new Date(2026, 9, 28, 9).getTime()
    const d1b = new Date(2026, 9, 28, 21).getTime()
    const d2 = new Date(2026, 9, 29, 9).getTime()
    expect(paintRewardKey('line-awu-banana', d1, false)).toBe('art:line-awu-banana')
    expect(paintRewardKey('line-awu-banana', d2, false)).toBe('art:line-awu-banana')
    expect(paintRewardKey('free-1', d1, true)).toBe(paintRewardKey('free-1', d1b, true))
    expect(paintRewardKey('free-1', d1, true)).not.toBe(paintRewardKey('free-1', d2, true))
    expect(paintRewardKey('free-1', d1, true)).not.toBe(paintRewardKey('free-2', d1, true))
  })
  it('「全部塗滿」只有著色頁 100% 才算（空白畫紙與連連看沒有）', () => {
    expect(isFullyPainted(100, false)).toBe(true)
    expect(isFullyPainted(99, false)).toBe(false)
    expect(isFullyPainted(100, true)).toBe(false)
  })
  it('PAINT_LINES 與 lines.ts 的固定台詞一字不差（預錄音檔靠它找）；阿悟說的話 key 以 pet. 開頭', () => {
    for (const [k, v] of Object.entries(PAINT_LINES)) {
      expect(STATIC_LINES[k], k).toEqual(v)
      expect(k.startsWith('pet.') || k.startsWith('companion.'), k).toBe(true)
    }
    expect(PAINT_MORE_LINE).toBe('還有這些地方喔')
    expect(PAINT_FULL_LINE).toBe('全部塗滿了！')
    expect(PAINT_STARS_LINE).toContain('五顆星星')
  })
  it('新句子進得了匯出的語音清單（allLines）', () => {
    const all = allLines([])
    expect(all['pet.paint.more']).toBe(PAINT_MORE_LINE)
    expect(all['pet.paint.full']).toBe(PAINT_FULL_LINE)
    expect(all['pet.paint.stars']).toBe(PAINT_STARS_LINE)
  })
  it('v7.4 I5：空白畫紙 ≥ 3 筆或有貼紙才算完成（橡皮擦、填色桶、鏡像多出的那一筆不算）', () => {
    const st = (kind?: 'pen' | 'erase' | 'fill', twin = false) => ({ kind, twin })
    const noSticker: { id: string }[] = []
    expect(FREE_MIN_STROKES).toBe(3)
    expect(freeCanvasEnough({ strokes: [st(), st()], stickers: noSticker })).toBe(false)
    expect(freeCanvasEnough({ strokes: [st(), st(), st()], stickers: noSticker })).toBe(true)
    expect(freeCanvasEnough({ strokes: [], stickers: [{ id: 's1' }] })).toBe(true)
    // 一筆鏡像 = 2 筆資料，只算 1 筆
    expect(countStrokes([st('pen'), st('pen', true)])).toBe(1)
    expect(freeCanvasEnough({ strokes: [st(), st(undefined, true), st('erase'), st('fill'), st('fill')], stickers: noSticker })).toBe(false)
    expect(freeCanvasEnough({ strokes: [st(), st(), st(), st('erase')], stickers: noSticker })).toBe(true)
  })
  it('v7.4 新句子：空白畫紙畫太少、畫廊還沒有畫（阿悟說的話，key 以 pet. 開頭）', () => {
    expect(PAINT_FREE_LINE).toBe('再多畫幾筆，或貼一張貼紙吧')
    expect(GALLERY_EMPTY_LINE).toBe('還沒有畫畫喔，我們去畫一張吧')
  })
})
