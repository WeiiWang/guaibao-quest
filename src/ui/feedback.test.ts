import { beforeEach, describe, expect, it, vi } from 'vitest'

const speak = vi.fn(() => true)
const playSfx = vi.fn()
// feedback.ts 唸話走 sayText（先找預錄音檔、沒有才退回 speak）；測試只關心「唸了哪句、開關有沒有傳對」
vi.mock('../learning/speech', () => ({ speak: (...a: unknown[]) => speak(...(a as [])), sayText: (...a: unknown[]) => speak(...(a as [])) }))
vi.mock('../learning/sfx', () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }))

const { celebrateSmall, FEEDBACK } = await import('./feedback')

beforeEach(() => {
  speak.mockClear()
  playSfx.mockClear()
})

describe('統一成功回饋 celebrateSmall', () => {
  it('每個情境都有一句短語音，而且字都不長（4–7 歲聽得完）', () => {
    for (const [k, v] of Object.entries(FEEDBACK)) {
      expect(v.phrase.length, k).toBeGreaterThan(0)
      expect(v.phrase.length, k).toBeLessThanOrEqual(8)
    }
  })
  it('音效、語音都開：各播一次', () => {
    const r = celebrateSmall('buy', { soundOn: true, voiceOn: true })
    expect(playSfx).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledWith('買到囉！', { enabled: true })
    expect(r.sound).toBe(true)
  })
  it('家長關音效：不發聲，但語音照常', () => {
    const r = celebrateSmall('craft', { soundOn: false, voiceOn: true })
    expect(playSfx).not.toHaveBeenCalled()
    expect(r.sound).toBe(false)
    expect(speak).toHaveBeenCalledWith('做好了！', { enabled: true })
  })
  it('家長關語音：交給 speak 的 enabled=false（speak 自己不唸）', () => {
    celebrateSmall('task', { soundOn: true, voiceOn: false })
    expect(speak).toHaveBeenCalledWith('好棒喔！', { enabled: false })
  })
  it('清便便沒有自己的音效（已經有「啵」），不重複發聲', () => {
    celebrateSmall('poop', { soundOn: true, voiceOn: true })
    expect(playSfx).not.toHaveBeenCalled()
  })
  it('可以覆寫語音句子', () => {
    celebrateSmall('buy', { phrase: '買到香蕉囉！' })
    expect(speak).toHaveBeenCalledWith('買到香蕉囉！', { enabled: true })
  })
})
