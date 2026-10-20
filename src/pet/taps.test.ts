import { describe, expect, it } from 'vitest'
import { DIZZY_TAPS, initialTapState, registerTap, TAP_GAP_MS, type TapReaction, type TapState } from './taps'

const run = (times: number[]) => {
  let s: TapState = initialTapState
  const out: TapReaction[] = []
  for (const t of times) {
    const r = registerTap(s, t)
    s = r.state
    out.push(r.reaction)
  }
  return out
}

describe('registerTap', () => {
  it('單點 = 嘻嘻', () => {
    expect(run([1000])).toEqual(['giggle'])
  })
  it('1.5 秒內連點 3 次 = 搔癢', () => {
    expect(run([1000, 1400, 1800])).toEqual(['giggle', 'giggle', 'tickle'])
  })
  it('點得太慢（每下間隔超過連點門檻）永遠只是嘻嘻', () => {
    expect(run([0, 800, 1600, 2400, 3200, 4000, 4800])).toEqual(Array(7).fill('giggle'))
  })
  it('連點 6 次 = 頭暈，之後重新計數', () => {
    const r = run([0, 200, 400, 600, 800, 1000, 1200])
    expect(r[2]).toBe('tickle')
    expect(r[DIZZY_TAPS - 1]).toBe('dizzy')
    // 頭暈後的下一下重新開始
    expect(r[6]).toBe('giggle')
  })
  it('間隔太久會重新計數', () => {
    expect(run([0, 200, 200 + TAP_GAP_MS + 100, 2000])).toEqual(['giggle', 'giggle', 'giggle', 'giggle'])
  })
  it('時鐘倒退不會壞掉', () => {
    expect(run([5000, 100])).toEqual(['giggle', 'giggle'])
  })
})
