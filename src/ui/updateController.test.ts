import { describe, expect, it, vi } from 'vitest'
import { createUpdateController } from './updateController'

function setup(start = 1_000_000) {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
  let now = start
  const make = () => createUpdateController({ storage: () => storage, now: () => now })
  const apply = vi.fn()
  const c = make()
  c.setApply(apply)
  return { c, apply, make, map, tick: (ms: number) => (now += ms) }
}

describe('更新不打斷', () => {
  it('新版本裝好時，孩子在玩（不在開場）就不套用，等回到首頁', () => {
    const { c, apply } = setup()
    c.markReady()
    expect(c.isReady()).toBe(true)
    expect(apply).not.toHaveBeenCalled()
    expect(c.arrivedHome('kid1')).toBe(true)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('還沒有新版本時回到首頁什麼都不做', () => {
    const { c, apply } = setup()
    expect(c.arrivedHome('kid1')).toBe(false)
    expect(apply).not.toHaveBeenCalled()
  })

  it('開場畫面開著時新版本一到就套用（冷啟動）', () => {
    const { c, apply } = setup()
    c.setTitleOpen(true)
    expect(apply).not.toHaveBeenCalled()
    c.markReady()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('開場畫面關掉之後不再自動套用', () => {
    const { c, apply } = setup()
    c.setTitleOpen(true)
    c.setTitleOpen(false)
    c.markReady()
    expect(apply).not.toHaveBeenCalled()
  })

  it('已經在等待的新版本，開場畫面一開就套用', () => {
    const { c, apply } = setup()
    c.markReady()
    c.setTitleOpen(true)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('忙碌中（離線內容包下載中）不套用，忙完回到首頁才套用', () => {
    const { c, apply } = setup()
    let busy = true
    c.setBusyCheck(() => busy)
    c.markReady()
    expect(c.arrivedHome('kid1')).toBe(false)
    busy = false
    expect(c.arrivedHome('kid1')).toBe(true)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('只套用一次', () => {
    const { c, apply } = setup()
    c.markReady()
    c.arrivedHome('a')
    c.arrivedHome('a')
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('從首頁套用：重新整理後知道要回到哪個孩子，而且只讀一次就清掉', () => {
    const { c, make, map } = setup()
    c.markReady()
    c.arrivedHome('kid1')
    const after = make()
    expect(after.resumeInfo()).toEqual({ childId: 'kid1' })
    expect(after.resumeInfo()).toEqual({ childId: 'kid1' }) // React StrictMode 會呼叫兩次
    expect(map.has('gq-update-resume')).toBe(false)
    expect(make().resumeInfo()).toBeNull()
  })

  it('從開場套用：重新整理後照常出現開場（不算回到首頁）', () => {
    const { c, make } = setup()
    c.setTitleOpen(true)
    c.markReady()
    expect(make().resumeInfo()).toBeNull()
  })

  it('套用失敗（重整後還是舊版）不會無限重整：冷卻時間內不再試，過了才再試', () => {
    const { c, apply, make, tick } = setup()
    c.markReady()
    c.arrivedHome('a')
    expect(apply).toHaveBeenCalledTimes(1)
    // 重新整理後還是同一個 waiting
    const second = make()
    const apply2 = vi.fn()
    second.setApply(apply2)
    second.markReady()
    expect(second.arrivedHome('a')).toBe(false)
    tick(11 * 60_000)
    expect(second.arrivedHome('a')).toBe(true)
    expect(apply2).toHaveBeenCalledTimes(1)
  })
})
