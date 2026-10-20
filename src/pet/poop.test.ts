import { describe, expect, it } from 'vitest'
import { makeRng } from '../learning/rng'
import {
  nextStreak,
  pickPoopX,
  planFeedPoop,
  POOP_CAP,
  POOP_DELAY_MAX_MS,
  POOP_DELAY_MIN_MS,
  poopChance,
  resolveDuePoops,
  rollPoopDelay,
  STREAK_WINDOW_MS,
  type FeedPoopInput,
} from './poop'

const T0 = 1_000_000
const base: FeedPoopInput = { stage: 'adult', streak: undefined, now: T0, poopOn: true, poopCount: 0, dueCount: 0, rng: () => 0 }

describe('poopChance', () => {
  it('第 1 次 30%、第 3 次以上 60%', () => {
    expect(poopChance(1)).toBe(0.3)
    expect(poopChance(2)).toBeGreaterThan(0.3)
    expect(poopChance(2)).toBeLessThan(0.6)
    expect(poopChance(3)).toBe(0.6)
    expect(poopChance(10)).toBe(0.6)
    expect(poopChance(0)).toBe(0)
  })
})

describe('nextStreak', () => {
  it('間隔內累加，超過視窗或時鐘倒退就重算', () => {
    expect(nextStreak(undefined, T0)).toEqual({ n: 1, at: T0 })
    expect(nextStreak({ n: 1, at: T0 }, T0 + 1000)).toEqual({ n: 2, at: T0 + 1000 })
    expect(nextStreak({ n: 5, at: T0 }, T0 + STREAK_WINDOW_MS + 1).n).toBe(1)
    expect(nextStreak({ n: 5, at: T0 }, T0 - 5).n).toBe(1)
  })
})

describe('rollPoopDelay', () => {
  it('落在 20–90 秒', () => {
    expect(rollPoopDelay(() => 0)).toBe(POOP_DELAY_MIN_MS)
    expect(rollPoopDelay(() => 0.999999)).toBeLessThanOrEqual(POOP_DELAY_MAX_MS)
    const rng = makeRng(7)
    for (let i = 0; i < 100; i++) {
      const d = rollPoopDelay(rng)
      expect(d).toBeGreaterThanOrEqual(POOP_DELAY_MIN_MS)
      expect(d).toBeLessThanOrEqual(POOP_DELAY_MAX_MS)
    }
  })
})

describe('planFeedPoop', () => {
  it('第 1 次吃：亂數 < 0.3 才排便便；之後延遲 20–90 秒', () => {
    const yes = planFeedPoop({ ...base, rng: () => 0.29 })
    expect(yes.due).not.toBeNull()
    expect(yes.due! - T0).toBeGreaterThanOrEqual(POOP_DELAY_MIN_MS)
    expect(yes.due! - T0).toBeLessThanOrEqual(POOP_DELAY_MAX_MS)
    expect(planFeedPoop({ ...base, rng: () => 0.31 }).due).toBeNull()
  })
  it('連續吃到第 3 次，機率變 60%', () => {
    const streak = { n: 2, at: T0 - 1000 }
    expect(planFeedPoop({ ...base, streak, rng: () => 0.5 }).due).not.toBeNull()
    expect(planFeedPoop({ ...base, streak, rng: () => 0.7 }).due).toBeNull()
  })
  it('機率分布：第 1 次約 30%、第 3 次以上約 60%', () => {
    const rng = makeRng(42)
    const N = 4000
    let one = 0
    let three = 0
    for (let i = 0; i < N; i++) {
      if (planFeedPoop({ ...base, rng }).due !== null) one++
      if (planFeedPoop({ ...base, streak: { n: 2, at: T0 }, rng }).due !== null) three++
    }
    expect(one / N).toBeGreaterThan(0.26)
    expect(one / N).toBeLessThan(0.34)
    expect(three / N).toBeGreaterThan(0.56)
    expect(three / N).toBeLessThan(0.64)
  })
  it('蛋不會大便、家長關掉開關不會大便，但連續餵食計數照算', () => {
    expect(planFeedPoop({ ...base, stage: 'egg' }).due).toBeNull()
    const off = planFeedPoop({ ...base, poopOn: false })
    expect(off.due).toBeNull()
    expect(off.streak.n).toBe(1)
  })
  it('已有 + 排定的便便達上限就不再排', () => {
    expect(planFeedPoop({ ...base, poopCount: 2, dueCount: 1 }).due).toBeNull()
    expect(planFeedPoop({ ...base, poopCount: 1, dueCount: 1 }).due).not.toBeNull()
  })
})

describe('pickPoopX', () => {
  it('寵物靠近可視範圍的邊緣時，便便只往放得下的那一側', () => {
    const spread = { min: 0.1, max: 0.2, lo: 0.2, hi: 0.6 }
    for (let seed = 1; seed <= 40; seed++) {
      const rng = makeRng(seed)
      expect(pickPoopX([], 0.55, rng, spread)).toBeLessThan(0.55) // 右邊放不下 → 往左
      expect(pickPoopX([], 0.25, rng, spread)).toBeGreaterThan(0.25) // 左邊放不下 → 往右
    }
    // 結果一定在範圍內
    expect(pickPoopX([], 0.4, () => 0, spread)).toBeGreaterThanOrEqual(0.2)
    expect(pickPoopX([], 0.4, () => 0.99, spread)).toBeLessThanOrEqual(0.6)
  })
  it('落在房間內，且盡量與既有便便保持距離', () => {
    const rng = makeRng(3)
    for (let i = 0; i < 50; i++) {
      const x = pickPoopX([{ x: 0.3 }, { x: 0.38 }], 0.3, rng)
      expect(x).toBeGreaterThanOrEqual(0.06)
      expect(x).toBeLessThanOrEqual(0.94)
    }
    // 空房間：不會跑出邊界
    expect(pickPoopX([], 0, () => 0)).toBeGreaterThanOrEqual(0.06)
    expect(pickPoopX([], 1, () => 0.99)).toBeLessThanOrEqual(0.94)
  })
})

describe('resolveDuePoops', () => {
  let n = 0
  const id = () => `p${n++}`
  const rng = makeRng(1)

  it('到期的變成便便（出現時間用到期時間），沒到期的留著', () => {
    const r = resolveDuePoops([], [T0 + 10, T0 + 99_999], T0 + 50, 0.3, rng, id)
    expect(r.added).toHaveLength(1)
    expect(r.added[0].at).toBe(T0 + 10)
    expect(r.poops).toHaveLength(1)
    expect(r.due).toEqual([T0 + 99_999])
  })
  it('離線很久：全部到期的都補上，但不超過上限（多的丟掉、不累積）', () => {
    const due = [T0, T0 + 1, T0 + 2, T0 + 3, T0 + 4]
    const r = resolveDuePoops([], due, T0 + 10 * 3_600_000, 0.3, rng, id)
    expect(r.poops).toHaveLength(POOP_CAP)
    expect(r.due).toEqual([])
  })
  it('房間已經有便便時，只補到上限', () => {
    const existing = [
      { id: 'a', x: 0.2, at: 1 },
      { id: 'b', x: 0.5, at: 2 },
    ]
    const r = resolveDuePoops(existing, [T0, T0 + 1], T0 + 100, 0.3, rng, id)
    expect(r.poops).toHaveLength(POOP_CAP)
    expect(r.added).toHaveLength(1)
  })
  it('沒有排定時什麼都不做', () => {
    const r = resolveDuePoops([], [], T0, 0.3, rng, id)
    expect(r.poops).toEqual([])
    expect(r.added).toEqual([])
  })
})
