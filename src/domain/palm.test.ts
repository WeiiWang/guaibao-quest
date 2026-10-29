import { describe, expect, it } from 'vitest'
import { PALM_INIT, PALM_MIN_PX, PALM_TRUST_AFTER, palmCheck, type PalmState } from './palm'

const touch = (w: number) => ({ pointerType: 'touch', width: w, height: w })
const fresh = (): PalmState => ({ ...PALM_INIT })

describe('palmCheck', () => {
  it('iPhone 回報的一般手指（寬 40–80px）不算手掌', () => {
    const s = fresh()
    for (const w of [1, 40, 46, 60, 80, PALM_MIN_PX]) expect(palmCheck(s, touch(w), true)).toBe(false)
  })

  it('大面積的單獨觸控先當成手掌，連續第 3 下起自動信任並照常畫', () => {
    const s = fresh()
    const big = touch(PALM_MIN_PX + 40)
    for (let i = 1; i < PALM_TRUST_AFTER; i++) expect(palmCheck(s, big, true)).toBe(true)
    expect(palmCheck(s, big, true)).toBe(false)
    expect(s.off).toBe(true)
    expect(palmCheck(s, big, true)).toBe(false)
    expect(palmCheck(s, big, false)).toBe(false)
  })

  it('中間有一下正常的觸控就重新計數（偶爾手掌碰到不會關掉防護）', () => {
    const s = fresh()
    const big = touch(PALM_MIN_PX + 40)
    expect(palmCheck(s, big, true)).toBe(true)
    expect(palmCheck(s, big, true)).toBe(true)
    expect(palmCheck(s, touch(20), true)).toBe(false)
    expect(palmCheck(s, big, true)).toBe(true)
    expect(s.off).toBe(false)
  })

  it('手指畫線中手掌壓上來（不是單獨的觸控）一律擋掉，也不累計', () => {
    const s = fresh()
    for (let i = 0; i < 10; i++) expect(palmCheck(s, touch(PALM_MIN_PX + 40), false)).toBe(true)
    expect(s.streak).toBe(0)
  })

  it('筆和滑鼠不看面積', () => {
    const s = fresh()
    expect(palmCheck(s, { pointerType: 'pen', width: 500, height: 500 }, true)).toBe(false)
    expect(palmCheck(s, { pointerType: 'mouse', width: 500, height: 500 }, true)).toBe(false)
  })
})
