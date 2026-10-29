import { describe, expect, it } from 'vitest'
import { GIFT_STICKERS } from './gifts'
import { DEFAULT_STICKERS, DEFAULT_STICKER_COUNT, STICKER_CATALOG, collectionGiftSticker, newStickerIds, trayOrder, unlockedStickers, usedStickerIds } from './stickers'

const arts = (l: { art: string }[]) => l.map((s) => s.art)

describe('v7.4 I4：貼紙盤會成長', () => {
  it('預設只開 8 張，而且不和每日禮物的貼紙重疊（不然貼紙禮物又是死獎勵）', () => {
    expect(DEFAULT_STICKERS).toHaveLength(DEFAULT_STICKER_COUNT)
    expect(DEFAULT_STICKER_COUNT).toBe(8)
    for (const g of GIFT_STICKERS) expect(DEFAULT_STICKERS, g).not.toContain(g)
    // 每日禮物的貼紙都在目錄裡（收到了貼紙盤才有得開）
    for (const g of GIFT_STICKERS) expect(STICKER_CATALOG.some((s) => s.art === g), g).toBe(true)
    expect(new Set(STICKER_CATALOG.map((s) => s.art)).size).toBe(STICKER_CATALOG.length)
  })
  it('沒有任何解鎖：就是預設 8 張（目錄順序）', () => {
    expect(arts(unlockedStickers(undefined))).toEqual([...DEFAULT_STICKERS])
    expect(arts(unlockedStickers([]))).toEqual([...DEFAULT_STICKERS])
  })
  it('settings.stickers 的貼紙解鎖，依目錄順序；目錄外的素材名忽略', () => {
    const u = arts(unlockedStickers(['obj-fish', 'obj-star', 'not-a-sticker']))
    expect(u).toHaveLength(10)
    expect(u.indexOf('obj-star')).toBeLessThan(u.indexOf('obj-fish'))
    expect(u).not.toContain('not-a-sticker')
  })
  it('舊作品用過的貼紙視為已解鎖（舊存檔相容）', () => {
    const used = usedStickerIds([{ stickers: [{ art: 'obj-chick' }, { art: 'obj-chick' }] }, { stickers: [{ art: 'decor-rainbow' }] }, {}])
    expect(used.sort()).toEqual(['decor-rainbow', 'obj-chick'])
    expect(arts(unlockedStickers([], used))).toEqual(expect.arrayContaining(['obj-chick', 'decor-rainbow', ...DEFAULT_STICKERS]))
  })
  it('標「新」：已解鎖、非預設、沒看過、舊作沒用過', () => {
    expect(newStickerIds(['obj-star', 'obj-fish'], [], [])).toEqual(['obj-star', 'obj-fish'])
    expect(newStickerIds(['obj-star', 'obj-fish'], ['obj-star'], [])).toEqual(['obj-fish'])
    expect(newStickerIds(['obj-star', 'obj-fish'], [], ['obj-fish'])).toEqual(['obj-star'])
    expect(newStickerIds(undefined, undefined, [])).toEqual([])
    expect(newStickerIds(['obj-banana'], [], [])).toEqual([]) // 預設的不算新
  })
  it('貼紙盤排列：新的在前，其餘照目錄順序', () => {
    const open = unlockedStickers(['obj-star', 'obj-fish'])
    const order = arts(trayOrder(open, ['obj-fish']))
    expect(order[0]).toBe('obj-fish')
    expect(order.slice(1)).toEqual(arts(open).filter((a) => a !== 'obj-fish'))
  })
  it('朋友收集禮物：第 1、3、5… 份送下一張沒有的貼紙（固定順序），偶數份送食物（undefined）', () => {
    expect(collectionGiftSticker([], 1)).toBe('pet-adult-cheer')
    expect(collectionGiftSticker(['pet-adult-cheer'], 3)).toBe('pet-baby-happy')
    expect(collectionGiftSticker([], 2)).toBeUndefined()
    expect(collectionGiftSticker([], 4)).toBeUndefined()
    // 全部都有了就改送食物
    expect(collectionGiftSticker(STICKER_CATALOG.map((s) => s.art), 5)).toBeUndefined()
  })
})
