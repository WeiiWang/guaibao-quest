import { describe, expect, it } from 'vitest'
import { HIDE_SPOTS, HIDE_SURPRISE, hideLayout, hidePlan, hideSpotsFor, nextHideSpot, peekLevelAt, saysEmptyLine, shouldWiggle } from './hide'

describe('躲藏物數量', () => {
  it('3 歲 4 個、4–5 歲 5 個、6–7 歲 6 個', () => {
    expect(hideSpotsFor('3')).toHaveLength(4)
    expect(hideSpotsFor('4-5')).toHaveLength(5)
    expect(hideSpotsFor('6-7')).toHaveLength(6)
  })
  it('每個躲藏物一種驚喜，不重複', () => {
    const all = HIDE_SPOTS.map((s) => HIDE_SURPRISE[s])
    expect(new Set(all).size).toBe(HIDE_SPOTS.length)
  })
})

describe('躲藏位置', () => {
  it('不連續同一處（試過各種隨機值）', () => {
    const spots = hideSpotsFor('3')
    for (const prev of spots) for (let r = 0; r < 1; r += 0.05) expect(nextHideSpot(spots, prev, () => r)).not.toBe(prev)
  })
  it('rand 回傳接近 1 也不會超出範圍', () => {
    expect(hideSpotsFor('6-7')).toContain(nextHideSpot(hideSpotsFor('6-7'), null, () => 0.9999999))
  })
  it('每個位置都輪得到', () => {
    const spots = hideSpotsFor('4-5')
    const seen = new Set<string>()
    for (let r = 0; r < 1; r += 0.02) seen.add(nextHideSpot(spots, spots[0], () => r))
    expect(seen.size).toBe(spots.length - 1)
  })
})

describe('提示隨年齡', () => {
  it('3 歲：點 2 次沒找到才晃，也不靠時間露出', () => {
    const p = hidePlan('3')
    expect(shouldWiggle(p, 0)).toBe(false)
    expect(shouldWiggle(p, 1)).toBe(false)
    expect(shouldWiggle(p, 2)).toBe(true)
    expect(peekLevelAt(p, 999_999)).toBe(0)
  })
  it('4–5 歲：一開始完全躲好，久了才露，永遠不晃', () => {
    const p = hidePlan('4-5')
    expect(peekLevelAt(p, 0)).toBe(0)
    expect(peekLevelAt(p, 11_999)).toBe(0)
    expect(peekLevelAt(p, 12_000)).toBe(2)
    expect(peekLevelAt(p, 25_000)).toBe(3)
    expect(shouldWiggle(p, 50)).toBe(false)
  })
  it('6–7 歲：一開始就露很小一點，久了才露更多，不晃', () => {
    const p = hidePlan('6-7')
    expect(peekLevelAt(p, 0)).toBe(1)
    expect(peekLevelAt(p, 17_999)).toBe(1)
    expect(peekLevelAt(p, 18_000)).toBe(2)
    expect(peekLevelAt(p, 40_000)).toBe(3)
    expect(shouldWiggle(p, 50)).toBe(false)
  })
})

describe('點空的台詞節奏', () => {
  it('第一次講，第二、三次不講，之後每 3 次講一次', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(saysEmptyLine)).toEqual([true, false, false, true, false, false, true])
  })
})

describe('hideLayout', () => {
  const SIZES: [number, number][] = [
    [1150, 660], // iPad 橫向
    [796, 1020], // iPad 直向
    [366, 700], // 手機直向
    [820, 300], // 手機橫向
  ]
  const overlap = (a: { x: number; y: number; size: number }, b: { x: number; y: number; size: number }) =>
    a.x < b.x + b.size && b.x < a.x + a.size && a.y < b.y + b.size && b.y < a.y + a.size

  for (const [w, h] of SIZES) {
    for (const count of [4, 5, 6]) {
      it(`${w}x${h} 放 ${count} 個：不重疊、不出界、夠大`, () => {
        const r = hideLayout(count, w, h)
        expect(r).toHaveLength(count)
        for (let i = 0; i < r.length; i++) {
          expect(r[i].x).toBeGreaterThanOrEqual(0)
          expect(r[i].y).toBeGreaterThanOrEqual(0)
          expect(r[i].x + r[i].size).toBeLessThanOrEqual(w + 0.01)
          expect(r[i].y + r[i].size).toBeLessThanOrEqual(h + 0.01)
          expect(r[i].size).toBeGreaterThanOrEqual(90)
          for (let j = i + 1; j < r.length; j++) expect(overlap(r[i], r[j])).toBe(false)
        }
      })
    }
  }

  it('窄長的畫面排比較多排，寬扁的畫面排比較多欄', () => {
    const rows = (rs: { y: number; size: number }[]) => new Set(rs.map((a) => Math.round(a.y / a.size))).size
    expect(rows(hideLayout(6, 366, 700))).toBeGreaterThan(rows(hideLayout(6, 820, 300)))
  })

  it('尺寸不合理時回空陣列，不丟錯', () => {
    expect(hideLayout(4, 0, 100)).toEqual([])
    expect(hideLayout(0, 100, 100)).toEqual([])
  })

  it('有上限，大螢幕不會大到擋住背景', () => {
    for (const r of hideLayout(4, 2000, 2000)) expect(r.size).toBeLessThanOrEqual(340)
  })
})
