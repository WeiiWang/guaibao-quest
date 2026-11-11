import { describe, expect, it } from 'vitest'
import {
  BAKERY_BASES,
  BAKERY_TOPPINGS,
  MAX_TOPPINGS,
  PIPING_EAT_STEPS,
  PIPING_MIN_STEP,
  autoSpot,
  bakeryBasesFor,
  canPipeAt,
  eatIntervalMs,
  eatSteps,
  onBase,
  pipeAccepts,
  pipePath,
  snapToBase,
  sprinkleDots,
} from './bakery'

describe('點心屋：放在哪裡算放在點心上', () => {
  it('每種底座的中間都算（甜甜圈的中間是洞，看洞旁邊），四個角都不算', () => {
    for (const b of BAKERY_BASES) {
      expect(onBase(b.id, b.id === 'donut' ? 22 : 50, 50)).toBe(true)
      for (const [x, y] of [[0, 0], [100, 0], [0, 100], [100, 100]]) expect(onBase(b.id, x, y)).toBe(false)
    }
  })
  it('冰淇淋是一球加甜筒：甜筒旁邊的空白不算', () => {
    expect(onBase('icecream', 50, 90)).toBe(true)
    expect(onBase('icecream', 10, 85)).toBe(false)
  })
  it('稍微超出吸回邊上，離太遠回傳 null', () => {
    const s = snapToBase('cake', 50, 52 - 38 * 1.1)
    expect(s).not.toBeNull()
    expect(onBase('cake', s!.x, s!.y + 0.01)).toBe(true)
    expect(snapToBase('cake', 50, 50)).toEqual({ x: 50, y: 50 })
    expect(snapToBase('cake', 0, 0)).toBeNull()
    expect(snapToBase('cake', 50, 120)).toBeNull()
  })
})

describe('點心屋：固定的排列', () => {
  it('點一下放上去的位置都在點心上，也不靠亂數', () => {
    for (const b of BAKERY_BASES) {
      const seen = new Set<string>()
      for (let i = 0; i < MAX_TOPPINGS; i++) {
        const p = autoSpot(b.id, i)
        expect(onBase(b.id, p.x, p.y)).toBe(true)
        seen.add(`${p.x},${p.y}`)
        expect(autoSpot(b.id, i)).toEqual(p)
      }
      expect(seen.size).toBe(MAX_TOPPINGS)
    }
  })
  it('糖珠都在點心上，每層不一樣', () => {
    for (const b of BAKERY_BASES) {
      const a = sprinkleDots(b.id, 0)
      for (const d of a) expect(onBase(b.id, d.x, d.y)).toBe(true)
      expect(sprinkleDots(b.id, 1)).not.toEqual(a)
      expect(sprinkleDots(b.id, 0)).toEqual(a)
    }
  })
  it('吃的間隔：少的慢慢吃，30 個也不用等超過 3.5 秒', () => {
    expect(eatIntervalMs(0)).toBe(0)
    expect(eatIntervalMs(1)).toBe(420)
    expect(eatIntervalMs(MAX_TOPPINGS) * MAX_TOPPINGS).toBeLessThanOrEqual(3500)
  })
  it('裝飾有 10 種，id 不重複', () => {
    expect(new Set(BAKERY_TOPPINGS.map((t) => t.id)).size).toBe(10)
  })
})

describe('v8.5 新底座', () => {
  it('沒有新玩具：原本的三種；有了：多甜甜圈和杯子蛋糕，原本的排在前面', () => {
    expect(bakeryBasesFor(0).map((b) => b.id)).toEqual(['cake', 'icecream', 'pancake'])
    expect(bakeryBasesFor(1).map((b) => b.id)).toEqual(['cake', 'icecream', 'pancake', 'donut', 'cupcake'])
    expect(bakeryBasesFor(2)).toEqual(bakeryBasesFor(1))
    expect(new Set(BAKERY_BASES.map((b) => b.icon)).size).toBe(5)
  })
  it('甜甜圈：洞裡不算，圈上才算', () => {
    expect(onBase('donut', 50, 47)).toBe(false)
    expect(onBase('donut', 55, 50)).toBe(false)
    expect(onBase('donut', 20, 50)).toBe(true)
    expect(onBase('donut', 50, 20)).toBe(true)
    expect(onBase('donut', 50, 80)).toBe(true)
  })
  it('甜甜圈：放在洞裡會吸到洞口外面，不會懸在洞上；正中間也有地方去', () => {
    for (const [x, y] of [[50, 47], [53, 49], [45, 44], [50, 52]]) {
      const s = snapToBase('donut', x, y)
      expect(s).not.toBeNull()
      expect(onBase('donut', s!.x, s!.y)).toBe(true)
    }
    // 圈上的照放
    expect(snapToBase('donut', 20, 50)).toEqual({ x: 20, y: 50 })
  })
  it('杯子蛋糕：上面的奶油和下面的紙杯都算，紙杯旁邊的空白不算', () => {
    expect(onBase('cupcake', 50, 20)).toBe(true)
    expect(onBase('cupcake', 50, 85)).toBe(true)
    expect(onBase('cupcake', 12, 86)).toBe(false)
    expect(onBase('cupcake', 88, 86)).toBe(false)
  })
})

describe('v8.5 擠花袋', () => {
  it('只有在點心上才擠得出來', () => {
    expect(canPipeAt('cake', 50, 42)).toBe(true)
    expect(canPipeAt('cake', 2, 2)).toBe(false)
    expect(canPipeAt('donut', 50, 47)).toBe(false)
  })
  it('離上一個點夠遠才多記一個點；第一個點一定記', () => {
    expect(pipeAccepts('cake', null, 50, 42)).toBe(true)
    expect(pipeAccepts('cake', { x: 50, y: 42 }, 50 + PIPING_MIN_STEP / 2, 42)).toBe(false)
    expect(pipeAccepts('cake', { x: 50, y: 42 }, 50 + PIPING_MIN_STEP, 42)).toBe(true)
    expect(pipeAccepts('cake', { x: 50, y: 42 }, 0, 0)).toBe(false)
  })
  it('路徑：一個點是一小球，多個點連成線', () => {
    expect(pipePath([])).toBe('')
    expect(pipePath([{ x: 10, y: 20 }])).toBe('M10 20l0.01 0')
    expect(pipePath([{ x: 10, y: 20 }, { x: 30.26, y: 40 }])).toBe('M10 20L30.3 40')
  })
})

describe('v8.5 送給寵物吃的順序', () => {
  it('沒有奶油：跟原本一樣，一口一個裝飾', () => {
    expect(eatSteps(3, 0)).toEqual([
      { decos: 2, strokes: 0 },
      { decos: 1, strokes: 0 },
      { decos: 0, strokes: 0 },
    ])
    expect(eatSteps(0, 0)).toEqual([])
  })
  it('有奶油：先吃完裝飾，再吃奶油，最後一定全部吃完', () => {
    const steps = eatSteps(2, 3)
    expect(steps.map((s) => s.decos)).toEqual([1, 0, 0, 0, 0])
    expect(steps.map((s) => s.strokes)).toEqual([3, 3, 2, 1, 0])
  })
  it('奶油再多也只分 6 口，每一口都有變少', () => {
    for (const n of [1, 5, 6, 7, 13, 24]) {
      const steps = eatSteps(0, n)
      expect(steps).toHaveLength(Math.min(n, PIPING_EAT_STEPS))
      expect(steps.at(-1)).toEqual({ decos: 0, strokes: 0 })
      let prev = n
      for (const s of steps) {
        expect(s.strokes).toBeLessThan(prev)
        prev = s.strokes
      }
    }
  })
})
