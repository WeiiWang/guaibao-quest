import { describe, expect, it } from 'vitest'
import { SHOP_ITEMS } from '../domain/constants'
import { buyLine, CRAFT_SHORT_LINE, feedbackLines } from './feedbackLines'

describe('feedbackLines（v7.2 商店／工坊回饋句預錄清單）', () => {
  it('每樣商品都有「買到…囉！」與「…退回囉」，畫面用的句型一樣', () => {
    const texts = new Set(Object.values(feedbackLines()))
    for (const it of SHOP_ITEMS) expect(texts.has(buyLine(it.name)), it.name).toBe(true)
    expect(texts.has(CRAFT_SHORT_LINE)).toBe(true)
    expect(buyLine('著色頁：小魚')).toBe('買到小魚囉！')
  })
})
