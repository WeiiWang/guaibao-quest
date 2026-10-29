import { describe, expect, it } from 'vitest'
import { allLines } from '../learning/lines'
import { hatEmptyLine } from './hats'
import { WELCOME_STARS, windowBoxes } from './home7'
import {
  ALBUM_EMPTY,
  BAG_EMPTY,
  BAG_TABS,
  countUpValue,
  giftReveal,
  HUD_BADGE_W,
  HUD_GAP,
  HUD_LEFT,
  HUD_MIN_CARD,
  hudLayout,
  hudRoomLeft,
  HUNGRY_BACK_LINE,
  HUNGRY_MOOD_TEXT,
  J74_LINES,
} from './home74'
import { PET_X, ROOM_WIDTH_FACTOR } from './room'
import type { Gift } from './types'

const g = (p: Partial<Gift>): Gift => ({ at: 1, from: 'station', ...p })

describe('J74 句子', () => {
  it('每一句都在 lines.ts 的固定台詞裡（一字不差），阿悟說的話 key 以 pet. 開頭', () => {
    const all = allLines([])
    for (const [k, t] of Object.entries(J74_LINES)) {
      expect(all[k], k).toBe(t)
      expect(k.startsWith('pet.'), k).toBe(true)
    }
  })
  it('溫暖的回家第一句：不是負面的「好餓，無精打采」', () => {
    expect(HUNGRY_BACK_LINE).toBe('你回來了！我肚子有點餓餓的')
    expect(HUNGRY_MOOD_TEXT).not.toMatch(/無精打采|好餓/)
  })
  it('空狀態：帽子、家具的句子沿用既有的 ui 句子（不重複錄）', () => {
    expect(BAG_EMPTY.hat.line).toBe(hatEmptyLine())
    expect(Object.values(allLines([]))).toContain(BAG_EMPTY.furniture.line)
    for (const t of BAG_TABS) expect(Object.values(allLines([])), t.id).toContain(BAG_EMPTY[t.id].line)
    expect(Object.values(allLines([]))).toContain(ALBUM_EMPTY.line)
  })
  it('每個空狀態都有「去做」的按鈕', () => {
    for (const t of BAG_TABS) expect(BAG_EMPTY[t.id].button.length).toBeGreaterThan(1)
    expect(BAG_EMPTY.material.goto).toBe('map')
    expect(BAG_EMPTY.material.button).toBe('去冒險找材料')
  })
})

describe('禮物袋攤開（J4）', () => {
  it('歡迎禮物：星星 +20、香蕉 +1（星星排第一）', () => {
    const r = giftReveal([g({ foodId: 'banana', from: 'welcome' })])
    expect(r).toEqual([
      { id: 'star', kind: 'star', qty: WELCOME_STARS },
      { id: 'food:banana', kind: 'food', ref: 'banana', qty: 1 },
    ])
  })
  it('同一種東西合併：2 根香蕉 +2；材料用 qty；順序固定 星星 > 食物 > 材料 > 貼紙', () => {
    const r = giftReveal([g({ stickerId: 'obj-star' }), g({ materialId: 'wood', qty: 2 }), g({ foodId: 'banana' }), g({ foodId: 'apple' }), g({ foodId: 'banana' }), g({ materialId: 'wood', qty: 2 })])
    expect(r.map((x) => [x.id, x.qty])).toEqual([['food:banana', 2], ['food:apple', 1], ['mat:wood', 4], ['sticker:obj-star', 1]])
  })
  it('沒有歡迎禮物就沒有星星；空袋子回空；超過上限只留前面幾項', () => {
    expect(giftReveal([g({ foodId: 'apple' })]).some((x) => x.kind === 'star')).toBe(false)
    expect(giftReveal([])).toEqual([])
    const many = ['apple', 'banana', 'carrot', 'cookie', 'grape', 'milk', 'peach', 'riceball'].map((f) => g({ foodId: f }))
    expect(giftReveal(many, 5)).toHaveLength(5)
  })
  it('數字跳動：從小到大、最後剛好是 qty；qty 1 不計數', () => {
    expect(countUpValue(1, 0)).toBe(1)
    expect(countUpValue(20, 0)).toBe(1)
    expect(countUpValue(20, 1)).toBe(20)
    let prev = 0
    for (let i = 0; i <= 10; i++) {
      const v = countUpValue(20, i / 10)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(countUpValue(20, 0.5)).toBeGreaterThan(10)
  })
})

describe('狀態卡不壓窗簾（J5）', () => {
  const lefts = (w: number, h: number) => {
    const win = windowBoxes(w / h)[0]
    const roomW = w * ROOM_WIDTH_FACTOR
    return (win.x - win.w / 2) * roomW - Math.max(0, PET_X * roomW - w / 2)
  }
  it('可用寬度 = 第一扇窗（含窗簾）左緣 − 狀態卡左邊與空隙', () => {
    expect(hudRoomLeft(390, 590)).toBeCloseTo(lefts(390, 590) - HUD_LEFT - HUD_GAP, 5)
  })
  it('手機（390 / 360 / 320 寬）放不下完整卡片 → 縮小版徽章；徽章本身塞得進空隙', () => {
    for (const [w, h] of [[390, 590], [360, 520], [320, 440]]) {
      expect(hudLayout(w, h).mode, `${w}`).toBe('badge')
      expect(hudRoomLeft(w, h), `${w}`).toBeGreaterThanOrEqual(HUD_BADGE_W - 10)
    }
  })
  it('平板（直向 820 / 768、橫向 1180 / 1024）放得下卡片，而且卡片不會超過窗簾左緣', () => {
    for (const [w, h] of [[820, 900], [768, 740], [1180, 560], [1024, 520], [1366, 1060]]) {
      const l = hudLayout(w, h)
      expect(l.mode, `${w}x${h}`).toBe('card')
      if (l.mode === 'card' && l.maxW !== undefined) expect(l.maxW, `${w}x${h}`).toBeGreaterThanOrEqual(HUD_MIN_CARD)
    }
  })
  it('還沒量到大小（0）時不限制', () => {
    expect(hudLayout(0, 0)).toEqual({ mode: 'card', maxW: undefined })
  })
})
