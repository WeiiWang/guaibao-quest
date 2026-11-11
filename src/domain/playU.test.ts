import { describe, expect, it } from 'vitest'
import { FOOD_IDS } from './constants'
import {
  BUBBLE_ANIMALS,
  BUBBLE_ANIMAL_EVERY,
  BUBBLE_BIG_EVERY,
  BUBBLE_GOAL,
  BUBBLE_MAX,
  BUBBLE_MAX_ALL,
  BUBBLE_MIN,
  BUBBLE_MINIS,
  BUBBLE_TUNE,
  CATCH_FRUITS,
  CATCH_FRUITS_MORE,
  CATCH_RAIN,
  CATCH_RAIN_DELAY_MS,
  CATCH_RAIN_MIN_FALL_MS,
  CATCH_TOTAL,
  CATCH_TUNE,
  CATCH_X_MAX,
  CATCH_X_MIN,
  MEMORY_ANIMALS,
  MEMORY_CARDS,
  MEMORY_PEEK_MS,
  MEMORY_PET,
  MEMORY_SNACKS,
  bubbleMiniCount,
  bubbleShouldSpawn,
  bubbleSpec,
  bubbleWandRoom,
  catchAtRim,
  catchClampBasket,
  catchEndLine,
  catchFall,
  catchHit,
  catchMagnetX,
  catchPlan,
  catchRainPlan,
  catchRainTune,
  memoryCanPeek,
  memoryDeck,
  memoryDeckChoices,
  memoryDeckOr,
  memoryFlip,
  memoryLayout,
  memoryPeeks,
  memorySayMiss,
  memorySettle,
  memoryStart,
  pickCircle,
  wandPuffs,
} from './playU'
import type { AgeBand } from './types'

const BANDS: AgeBand[] = ['3', '4-5', '6-7']

describe('泡泡派對', () => {
  it('戳滿的數量依年齡', () => {
    expect(BUBBLE_GOAL).toEqual({ '3': 15, '4-5': 20, '6-7': 25 })
  })

  it('固定節奏：每 12 顆一顆大泡泡，其他都不是', () => {
    const bigs = Array.from({ length: 60 }, (_, n) => bubbleSpec(n)).filter((b) => b.big).map((b) => b.n)
    expect(bigs).toEqual([11, 23, 35, 47, 59])
    expect(BUBBLE_BIG_EVERY).toBe(12)
  })

  it('同一顆永遠長一樣（不靠機率）、位置都在畫面內、內容是食物或星星或空的', () => {
    for (let n = 0; n < 200; n++) {
      const a = bubbleSpec(n)
      expect(bubbleSpec(n)).toEqual(a)
      expect(a.x).toBeGreaterThanOrEqual(0.1)
      expect(a.x).toBeLessThanOrEqual(0.9)
      expect(a.restY).toBeGreaterThan(0.2)
      expect(a.restY).toBeLessThan(0.74)
      if (a.content.kind === 'food') expect(FOOD_IDS as readonly string[]).toContain(a.content.id)
      if (a.big) expect(a.content.kind).toBe('none')
    }
    const kinds = new Set(Array.from({ length: 12 }, (_, n) => bubbleSpec(n).content.kind))
    expect(kinds).toEqual(new Set(['food', 'star', 'none']))
  })

  it('相鄰的泡泡不會擠在同一邊', () => {
    for (let n = 0; n < 50; n++) expect(Math.abs(bubbleSpec(n).x - bubbleSpec(n + 1).x)).toBeGreaterThan(0.2)
  })

  it('冒泡規則：到上限就停，太少馬上補，其他照節奏', () => {
    const tune = BUBBLE_TUNE['4-5']
    expect(bubbleShouldSpawn(BUBBLE_MAX, 99999, tune)).toBe(false)
    expect(bubbleShouldSpawn(BUBBLE_MIN - 1, 0, tune)).toBe(true)
    expect(bubbleShouldSpawn(BUBBLE_MIN, 0, tune)).toBe(false)
    expect(bubbleShouldSpawn(BUBBLE_MIN, tune.gapMs, tune)).toBe(true)
  })

  it('大泡泡噴的小泡泡不會讓畫面超過總上限', () => {
    expect(bubbleMiniCount(0)).toBe(BUBBLE_MINIS)
    expect(bubbleMiniCount(BUBBLE_MAX_ALL - 2)).toBe(2)
    expect(bubbleMiniCount(BUBBLE_MAX_ALL)).toBe(0)
    expect(bubbleMiniCount(BUBBLE_MAX_ALL + 5)).toBe(0)
    expect(BUBBLE_MAX + BUBBLE_MINIS).toBeLessThanOrEqual(BUBBLE_MAX_ALL)
  })

  it('點中判定：挑最近的一顆，含手指寬容距離', () => {
    const cs = [
      { x: 100, y: 100, r: 50 },
      { x: 180, y: 100, r: 50 },
    ]
    expect(pickCircle(cs, 110, 100, 0)).toBe(0)
    expect(pickCircle(cs, 170, 100, 0)).toBe(1)
    expect(pickCircle(cs, 100, 170, 0)).toBe(-1)
    expect(pickCircle(cs, 100, 170, 25)).toBe(0)
    expect(pickCircle([], 0, 0, 100)).toBe(-1)
  })
})

describe('接水果', () => {
  it('每個年齡、每個種子都剛好 15 顆，位置在範圍內，時間不倒退', () => {
    for (const band of BANDS) {
      for (let seed = 0; seed < 50; seed++) {
        const plan = catchPlan(band, seed)
        expect(plan).toHaveLength(CATCH_TOTAL)
        plan.forEach((d, i) => {
          expect(d.i).toBe(i)
          expect(d.x).toBeGreaterThanOrEqual(CATCH_X_MIN - 1e-9)
          expect(d.x).toBeLessThanOrEqual(CATCH_X_MAX + 1e-9)
          expect(CATCH_FRUITS as readonly string[]).toContain(d.foodId)
          if (i) expect(d.at).toBeGreaterThanOrEqual(plan[i - 1].at)
        })
      }
    }
  })

  it('同一個種子同一張表', () => {
    expect(catchPlan('6-7', 42)).toEqual(catchPlan('6-7', 42))
    expect(catchPlan('6-7', 42)).not.toEqual(catchPlan('6-7', 43))
  })

  it('只有 6–7 歲會同時兩顆，而且兩顆離得夠遠', () => {
    const pairsOf = (band: AgeBand, seed: number) => {
      const plan = catchPlan(band, seed)
      return plan.filter((d, i) => i && plan[i - 1].at === d.at).map((d) => Math.abs(d.x - plan[d.i - 1].x))
    }
    for (let seed = 0; seed < 30; seed++) {
      expect(pairsOf('3', seed)).toEqual([])
      expect(pairsOf('4-5', seed)).toEqual([])
      const gaps = pairsOf('6-7', seed)
      expect(gaps.length).toBeGreaterThan(0)
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(0.35 - 1e-9)
    }
  })

  it('越大越快', () => {
    expect(CATCH_TUNE['3'].fallMs).toBeGreaterThan(CATCH_TUNE['4-5'].fallMs)
    expect(CATCH_TUNE['4-5'].fallMs).toBeGreaterThan(CATCH_TUNE['6-7'].fallMs)
    expect(CATCH_TUNE['3'].basketVmin).toBeGreaterThan(CATCH_TUNE['6-7'].basketVmin)
  })

  it('3 歲下一顆不會離上一顆太遠', () => {
    for (let seed = 0; seed < 30; seed++) {
      const plan = catchPlan('3', seed)
      for (let i = 1; i < plan.length; i++) expect(Math.abs(plan[i].x - plan[i - 1].x)).toBeLessThanOrEqual(CATCH_TUNE['3'].maxStep + 1e-9)
    }
  })

  it('掉落進度從 0 到 1，單調增加', () => {
    const tune = CATCH_TUNE['4-5']
    const drop = { i: 0, at: 1000, x: 0.5, foodId: 'apple' }
    expect(catchFall(0, drop, tune)).toBe(0)
    expect(catchFall(1000 + tune.fallMs, drop, tune)).toBe(1)
    expect(catchFall(9e9, drop, tune)).toBe(1)
    let prev = 0
    for (let t = 1000; t <= 1000 + tune.fallMs; t += 100) {
      const f = catchFall(t, drop, tune)
      expect(f).toBeGreaterThanOrEqual(prev)
      prev = f
    }
  })

  it('吸力只有 3 歲有，只在下半段，範圍邊界不會跳', () => {
    const t3 = CATCH_TUNE['3']
    expect(catchMagnetX(0.5, 0.6, 0.9, CATCH_TUNE['4-5'])).toBe(0.5)
    expect(catchMagnetX(0.5, 0.6, 0.3, t3)).toBe(0.5)
    const pulled = catchMagnetX(0.5, 0.6, 0.9, t3)
    expect(pulled).toBeGreaterThan(0.5)
    expect(pulled).toBeLessThan(0.6)
    expect(catchMagnetX(0.5, 0.5 + t3.magnet, 0.9, t3)).toBe(0.5)
    expect(catchMagnetX(0.5, 0.5 + t3.magnet - 0.001, 0.9, t3) - 0.5).toBeLessThan(0.01)
    expect(catchMagnetX(0.5, 0.5 + t3.magnet + 0.1, 0.9, t3)).toBe(0.5)
  })

  it('籃子不跑出畫面，而且最邊邊的水果也接得到', () => {
    const half = 0.15
    expect(catchClampBasket(-1, half)).toBe(half)
    expect(catchClampBasket(2, half)).toBe(1 - half)
    expect(catchClampBasket(0.4, half)).toBe(0.4)
    expect(catchHit(CATCH_X_MIN, catchClampBasket(0, half), half)).toBe(true)
    expect(catchHit(CATCH_X_MAX, catchClampBasket(1, half), half)).toBe(true)
    expect(catchHit(0.2, 0.8, half)).toBe(false)
  })

  it('籃口判定看走過的整段：卡頓一大步也不會穿過籃子，掉到籃子下面就來不及', () => {
    expect(catchAtRim(100, 200, 300, 370)).toBe(false)
    expect(catchAtRim(290, 310, 300, 370)).toBe(true)
    expect(catchAtRim(320, 340, 300, 370)).toBe(true)
    expect(catchAtRim(250, 450, 300, 370)).toBe(true)
    expect(catchAtRim(380, 400, 300, 370)).toBe(false)
  })

  it('結束的台詞：破紀錄 more、平常 done、一顆都沒接到不誇', () => {
    expect(catchEndLine(5, true)).toBe('pet.play.catch.more')
    expect(catchEndLine(5, false)).toBe('pet.play.catch.done')
    expect(catchEndLine(0, false)).toBeNull()
  })
})

describe('翻翻配對', () => {
  it('張數依年齡，每種剛好兩張，一定有寵物', () => {
    for (const band of BANDS) {
      for (let seed = 0; seed < 30; seed++) {
        const deck = memoryDeck(band, seed)
        expect(deck).toHaveLength(MEMORY_CARDS[band])
        const count = new Map<string, number>()
        for (const c of deck) count.set(c, (count.get(c) ?? 0) + 1)
        for (const n of count.values()) expect(n).toBe(2)
        expect(count.has(MEMORY_PET)).toBe(true)
      }
    }
    expect(MEMORY_CARDS).toEqual({ '3': 4, '4-5': 8, '6-7': 12 })
  })

  it('會洗牌：不同種子排法不同', () => {
    const decks = new Set(Array.from({ length: 10 }, (_, s) => memoryDeck('6-7', s).join()))
    expect(decks.size).toBeGreaterThan(1)
  })

  const deck = ['a', 'b', 'a', 'b']

  it('翻到一樣的：留著、鎖到動作做完', () => {
    const r1 = memoryFlip(memoryStart(deck), 0)
    expect(r1.event).toBe('first')
    const r2 = memoryFlip(r1.state, 2)
    expect(r2.event).toBe('match')
    expect(r2.state.matched).toEqual([0, 2])
    expect(r2.state.locked).toBe(true)
    const s = memorySettle(r2.state)
    expect(s.up).toEqual([])
    expect(s.locked).toBe(false)
    expect(s.matched).toEqual([0, 2])
  })

  it('翻到不一樣：動作中不能翻第三張，等一下翻回去', () => {
    const r1 = memoryFlip(memoryStart(deck), 0)
    const r2 = memoryFlip(r1.state, 1)
    expect(r2.event).toBe('miss')
    expect(r2.state.up).toEqual([0, 1])
    const third = memoryFlip(r2.state, 2)
    expect(third.event).toBe('none')
    expect(third.state).toBe(r2.state)
    expect(memorySettle(r2.state).up).toEqual([])
    expect(memorySettle(r2.state).matched).toEqual([])
  })

  it('點已翻開、已配對、不存在的牌都不算數', () => {
    const r1 = memoryFlip(memoryStart(deck), 0)
    expect(memoryFlip(r1.state, 0).event).toBe('none')
    expect(memoryFlip(r1.state, 99).event).toBe('none')
    const done = memorySettle(memoryFlip(r1.state, 2).state)
    expect(memoryFlip(done, 0).event).toBe('none')
  })

  it('全部翻完是 win', () => {
    let s = memoryStart(deck)
    s = memorySettle(memoryFlip(memoryFlip(s, 0).state, 2).state)
    const last = memoryFlip(memoryFlip(s, 1).state, 3)
    expect(last.event).toBe('win')
  })

  it('連續翻錯只說第一次，配對成功後重新算', () => {
    const six = ['a', 'b', 'c', 'a', 'b', 'c']
    const two = (s: ReturnType<typeof memoryStart>, a: number, b: number) => memoryFlip(memoryFlip(s, a).state, b).state
    let s = two(memoryStart(six), 0, 1)
    expect(memorySayMiss(s)).toBe(true)
    s = two(memorySettle(s), 0, 1)
    expect(memorySayMiss(s)).toBe(false)
    s = two(memorySettle(s), 1, 2)
    expect(memorySayMiss(s)).toBe(false)
    s = two(memorySettle(s), 0, 3)
    expect(s.missStreak).toBe(0)
    s = two(memorySettle(s), 1, 2)
    expect(memorySayMiss(s)).toBe(true)
  })

  it('版面：橫向用寬的排法、直向用高的排法，不會超出可用空間', () => {
    const land = memoryLayout(12, 1000, 700, 12)
    expect([land.cols, land.rows]).toEqual([4, 3])
    const port = memoryLayout(12, 700, 1000, 12)
    expect([port.cols, port.rows]).toEqual([3, 4])
    const phone = memoryLayout(8, 360, 640, 10)
    expect([phone.cols, phone.rows]).toEqual([2, 4])
    expect(memoryLayout(4, 1000, 700, 12)).toMatchObject({ cols: 2, rows: 2 })
    for (const [n, w, h] of [
      [4, 366, 600],
      [8, 366, 600],
      [12, 366, 600],
      [12, 1000, 700],
      [12, 700, 1000],
    ] as const) {
      const l = memoryLayout(n, w, h, 10)
      expect(l.cols * l.rows).toBe(n)
      expect(l.cols * l.cardW + (l.cols - 1) * 10).toBeLessThanOrEqual(w)
      expect(l.rows * l.cardH + (l.rows - 1) * 10).toBeLessThanOrEqual(h)
      expect(Math.min(l.cardW, l.cardH)).toBeGreaterThanOrEqual(56)
    }
  })
})

describe('v8.5 新玩具：泡泡派對', () => {
  it('沒有新玩具：每一顆都跟原本一模一樣，沒有動物', () => {
    for (let n = 0; n < 240; n++) {
      expect(bubbleSpec(n, 0)).toEqual(bubbleSpec(n))
      expect(bubbleSpec(n).content.kind).not.toBe('animal')
    }
  })

  it('動物泡泡：固定每 5 顆一顆，六種輪流，其他的泡泡不變', () => {
    const seen: string[] = []
    for (let n = 0; n < 240; n++) {
      const a = bubbleSpec(n, 1)
      const base = bubbleSpec(n)
      if (a.content.kind === 'animal') {
        expect(n % BUBBLE_ANIMAL_EVERY).toBe(BUBBLE_ANIMAL_EVERY - 1)
        expect(a.big).toBe(false)
        expect(BUBBLE_ANIMALS as readonly string[]).toContain(a.content.id)
        seen.push(a.content.id)
        // 只換裡面的東西：位置、大小、搖擺都一樣
        expect({ ...a, content: base.content }).toEqual(base)
      } else expect(a).toEqual(base)
    }
    // 每 5 顆一顆；剛好撞到大彩虹泡泡的那顆（每 60 顆一次）還是大泡泡
    expect(seen.length).toBe(240 / BUBBLE_ANIMAL_EVERY - 240 / 60)
    expect(seen.slice(0, 6)).toEqual([...BUBBLE_ANIMALS])
    expect(new Set(seen).size).toBe(BUBBLE_ANIMALS.length)
    expect(bubbleSpec(59, 2).big).toBe(true)
    expect(bubbleSpec(59, 2).content.kind).toBe('none')
  })

  it('泡泡棒：每走一段固定的距離吹一顆，慢慢拖和快快拖一樣密', () => {
    const one = wandPuffs({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 30)
    expect(one.points.map((p) => p.x)).toEqual([30, 60, 90])
    expect(one.carry).toBeCloseTo(10)
    // 拆成很多小段走同一條路：吹出來的位置一樣
    let carry = 0
    const xs: number[] = []
    for (let x = 0; x < 100; x += 4) {
      const r = wandPuffs({ x, y: 0 }, { x: x + 4, y: 0 }, carry, 30)
      carry = r.carry
      xs.push(...r.points.map((p) => p.x))
    }
    expect(xs.map((x) => Math.round(x))).toEqual([30, 60, 90])
    expect(carry).toBeCloseTo(10)
  })

  it('泡泡棒：手指不動不吹；斜著拖泡泡在路上', () => {
    expect(wandPuffs({ x: 5, y: 5 }, { x: 5, y: 5 }, 12, 30)).toEqual({ points: [], carry: 12 })
    const r = wandPuffs({ x: 0, y: 0 }, { x: 30, y: 40 }, 0, 25)
    expect(r.points).toHaveLength(2)
    for (const p of r.points) expect(p.y / p.x).toBeCloseTo(40 / 30)
    expect(wandPuffs({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, 0).points).toEqual([])
  })

  it('泡泡棒：畫面上的泡泡上限照舊', () => {
    expect(bubbleWandRoom(0)).toBe(BUBBLE_MAX_ALL)
    expect(bubbleWandRoom(BUBBLE_MAX_ALL - 3)).toBe(3)
    expect(bubbleWandRoom(BUBBLE_MAX_ALL)).toBe(0)
    expect(bubbleWandRoom(BUBBLE_MAX_ALL + 5)).toBe(0)
  })
})

describe('v8.5 新玩具：接水果', () => {
  it('沒有新玩具：掉落表跟原本一模一樣，沒有金色、沒有新水果', () => {
    for (const band of BANDS)
      for (let seed = 0; seed < 30; seed++) {
        const plan = catchPlan(band, seed)
        expect(catchPlan(band, seed, 0)).toEqual(plan)
        expect(plan.some((d) => d.gold)).toBe(false)
        for (const d of plan) expect(CATCH_FRUITS as readonly string[]).toContain(d.foodId)
      }
  })

  it('金色水果：第 5、10、15 顆是金色的，草莓和橘子每回都會出現，掉的位置與時間不變', () => {
    for (const band of BANDS)
      for (let seed = 0; seed < 30; seed++) {
        const base = catchPlan(band, seed)
        const plan = catchPlan(band, seed, 1)
        expect(plan).toHaveLength(CATCH_TOTAL)
        expect(plan.filter((d) => d.gold).map((d) => d.i + 1)).toEqual([5, 10, 15])
        expect(plan.map((d) => [d.i, d.at, d.x])).toEqual(base.map((d) => [d.i, d.at, d.x]))
        const kinds = new Set(plan.map((d) => d.foodId))
        expect(kinds.has('strawberry')).toBe(true)
        expect(kinds.has('orange')).toBe(true)
        for (const d of plan) expect(CATCH_FRUITS_MORE as readonly string[]).toContain(d.foodId)
        // 有水果雨（2 個新玩具）時主回合還是同一張表
        expect(catchPlan(band, seed, 2)).toEqual(plan)
      }
  })

  it('水果雨：剛好 8 顆，編號接在主回合後面，平均撒開，幾乎一起掉', () => {
    for (let seed = 0; seed < 40; seed++) {
      const rain = catchRainPlan(seed)
      expect(catchRainPlan(seed)).toEqual(rain)
      expect(rain).toHaveLength(CATCH_RAIN)
      expect(rain.map((d) => d.i)).toEqual(Array.from({ length: CATCH_RAIN }, (_, k) => CATCH_TOTAL + k))
      expect(rain.some((d) => d.gold)).toBe(false)
      const xs = rain.map((d) => d.x).sort((a, b) => a - b)
      expect(xs[0]).toBeGreaterThanOrEqual(CATCH_X_MIN)
      expect(xs[xs.length - 1]).toBeLessThanOrEqual(CATCH_X_MAX)
      // 每顆一格：不會疊在一起，也不會全擠在一邊
      for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeGreaterThan(0.03)
      expect(xs[xs.length - 1] - xs[0]).toBeGreaterThan(0.6)
      expect(rain[0].at).toBe(CATCH_RAIN_DELAY_MS)
      expect(rain[rain.length - 1].at - rain[0].at).toBeLessThanOrEqual(1200)
      // 從一邊掃到另一邊
      const dir = Math.sign(rain[1].x - rain[0].x)
      for (let k = 1; k < rain.length; k++) expect(Math.sign(rain[k].x - rain[k - 1].x)).toBe(dir)
    }
    // 兩個方向都會出現（看種子，不是亂數）
    const dirs = new Set(Array.from({ length: 40 }, (_, seed) => Math.sign(catchRainPlan(seed)[1].x - catchRainPlan(seed)[0].x)))
    expect(dirs.size).toBe(2)
  })

  it('水果雨不會掉得比主回合快，大孩子也看得清楚；籃子與吸力不變', () => {
    for (const band of BANDS) {
      const t = catchRainTune(band)
      expect(t.fallMs).toBeGreaterThanOrEqual(CATCH_TUNE[band].fallMs)
      expect(t.fallMs).toBeGreaterThanOrEqual(CATCH_RAIN_MIN_FALL_MS)
      expect({ ...t, fallMs: 0 }).toEqual({ ...CATCH_TUNE[band], fallMs: 0 })
    }
    expect(catchRainTune('3').fallMs).toBe(CATCH_TUNE['3'].fallMs)
  })
})

describe('v8.5 新玩具：翻翻配對', () => {
  it('沒有新玩具：牌跟原本一模一樣，只有水果一組可以選', () => {
    for (const band of BANDS) for (let seed = 0; seed < 20; seed++) expect(memoryDeck(band, seed, 'fruit')).toEqual(memoryDeck(band, seed))
    expect(memoryDeckChoices(0)).toEqual(['fruit'])
  })

  it('牌組：玩完 1 次多動物，玩完 3 次再多點心', () => {
    expect(memoryDeckChoices(1)).toEqual(['fruit', 'animal'])
    expect(memoryDeckChoices(2)).toEqual(['fruit', 'animal', 'snack'])
  })

  it('上次選的牌組：還沒有那個新玩具或存壞了就回到水果', () => {
    expect(memoryDeckOr('animal', 1)).toBe('animal')
    expect(memoryDeckOr('animal', 0)).toBe('fruit')
    expect(memoryDeckOr('snack', 1)).toBe('fruit')
    expect(memoryDeckOr('snack', 2)).toBe('snack')
    expect(memoryDeckOr(null, 2)).toBe('fruit')
    expect(memoryDeckOr(undefined, 2)).toBe('fruit')
    expect(memoryDeckOr('<script>', 2)).toBe('fruit')
  })

  it('動物牌與點心牌：張數依年齡，每種兩張，一定有寵物，牌面都是那一組的', () => {
    for (const [deck, pool] of [
      ['animal', MEMORY_ANIMALS],
      ['snack', MEMORY_SNACKS],
    ] as const)
      for (const band of BANDS)
        for (let seed = 0; seed < 20; seed++) {
          const cards = memoryDeck(band, seed, deck)
          expect(cards).toHaveLength(MEMORY_CARDS[band])
          const count = new Map<string, number>()
          for (const c of cards) count.set(c, (count.get(c) ?? 0) + 1)
          expect([...count.values()].every((n) => n === 2)).toBe(true)
          expect(count.has(MEMORY_PET)).toBe(true)
          for (const c of count.keys()) if (c !== MEMORY_PET) expect(pool).toContain(c)
        }
    // 動物牌的牌面就是圖的名字；點心牌是食物 id（都要是真的食物）
    for (const a of MEMORY_ANIMALS) expect(a.startsWith('obj-')).toBe(true)
    for (const s of MEMORY_SNACKS) expect(FOOD_IDS as readonly string[]).toContain(s)
    // 最多的那一檔要 5 種（加寵物 6 對）
    expect(MEMORY_ANIMALS.length).toBeGreaterThanOrEqual(MEMORY_CARDS['6-7'] / 2 - 1)
    expect(MEMORY_SNACKS.length).toBeGreaterThanOrEqual(MEMORY_CARDS['6-7'] / 2 - 1)
  })

  it('魔法棒：3 歲不限次數，其他年齡一回 1 次', () => {
    expect(memoryPeeks('3')).toBe(Infinity)
    expect(memoryPeeks('4-5')).toBe(1)
    expect(memoryPeeks('6-7')).toBe(1)
    expect(MEMORY_PEEK_MS).toBe(1200)
    const s = memoryStart(memoryDeck('4-5', 3))
    expect(memoryCanPeek(s, 0, '4-5')).toBe(true)
    expect(memoryCanPeek(s, 1, '4-5')).toBe(false)
    expect(memoryCanPeek(s, 1, '6-7')).toBe(false)
    expect(memoryCanPeek(s, 99, '3')).toBe(true)
  })

  it('魔法棒：兩張牌正在翻、全部配完時不能用；翻著一張時可以', () => {
    const deck = ['a', 'b', 'a', 'b']
    const one = memoryFlip(memoryStart(deck), 0).state
    expect(memoryCanPeek(one, 0, '3')).toBe(true)
    const miss = memoryFlip(one, 1).state
    expect(miss.locked).toBe(true)
    expect(memoryCanPeek(miss, 0, '3')).toBe(false)
    expect(memoryCanPeek(memorySettle(miss), 0, '3')).toBe(true)
    let s = memoryStart(deck)
    for (const i of [0, 2]) s = memoryFlip(s, i).state
    s = memorySettle(s)
    for (const i of [1, 3]) s = memoryFlip(s, i).state
    s = memorySettle(s)
    expect(s.matched).toHaveLength(4)
    expect(memoryCanPeek(s, 0, '3')).toBe(false)
  })
})
