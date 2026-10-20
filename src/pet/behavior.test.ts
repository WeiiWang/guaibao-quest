import { describe, expect, it } from 'vitest'
import { makeRng } from '../learning/rng'
import {
  BehaviorScheduler,
  BLOCKED_COOLDOWN_MS,
  candidates,
  IDLE_MAX_MS,
  IDLE_MIN_MS,
  pickBehavior,
  type Gate,
  type PickContext,
} from './behavior'

const ctx: PickContext = { stage: 'adult', hunger: 80, poopCount: 0, tod: 'day', hasBall: false }
const free: Gate = { edit: false, dragging: false, busy: false, hidden: false, asleep: false, overlay: false }
const ids = (c: PickContext) => candidates(c).map((x) => x.id)

describe('candidates', () => {
  it('吃飽的白天：唱歌、跳舞、散步等都有；不會摸肚子/捏鼻子/追球', () => {
    const l = ids(ctx)
    expect(l).toEqual(expect.arrayContaining(['sing', 'dance', 'walk', 'yawn', 'sneeze', 'gaze', 'wave']))
    expect(l).not.toContain('rubTummy')
    expect(l).not.toContain('pinchNose')
    expect(l).not.toContain('ballPlay')
  })
  it('飢餓（飽足 < 30）：改成摸肚子，不唱歌、不跳舞', () => {
    const l = ids({ ...ctx, hunger: 10 })
    expect(l).toContain('rubTummy')
    expect(l).not.toContain('sing')
    expect(l).not.toContain('dance')
    expect(l).not.toContain('wave')
  })
  it('飽足剛好 30 不算飢餓', () => {
    expect(ids({ ...ctx, hunger: 30 })).toContain('sing')
  })
  it('有便便才會捏鼻子；有球才會追球', () => {
    expect(ids({ ...ctx, poopCount: 1 })).toContain('pinchNose')
    expect(ids({ ...ctx, hasBall: true })).toContain('ballPlay')
  })
  it('晚上醒著：不唱歌、不跳舞', () => {
    const l = ids({ ...ctx, tod: 'night' })
    expect(l).not.toContain('sing')
    expect(l).not.toContain('dance')
    expect(l).toContain('yawn')
  })
  it('蛋只有蛋的行為', () => {
    const l = ids({ ...ctx, stage: 'egg' })
    expect(l.sort()).toEqual(['eggSparkle', 'eggWobble'])
  })
})

describe('pickBehavior', () => {
  it('同一個行為不連續出現', () => {
    const rng = makeRng(5)
    let last: ReturnType<typeof pickBehavior> = null
    for (let i = 0; i < 300; i++) {
      const next = pickBehavior(ctx, last, rng)
      expect(next).not.toBeNull()
      expect(next).not.toBe(last)
      last = next
    }
  })
  it('只剩一個候選時允許重複', () => {
    const only: PickContext = { ...ctx, stage: 'egg', hunger: 80 }
    // 蛋有兩個；夜晚只剩 eggWobble
    expect(pickBehavior({ ...only, tod: 'night' }, 'eggWobble', () => 0)).toBe('eggWobble')
  })
  it('權重生效：亂數 0 挑到第一個、接近 1 挑到最後一個', () => {
    const list = candidates(ctx)
    expect(pickBehavior(ctx, null, () => 0)).toBe(list[0].id)
    expect(pickBehavior(ctx, null, () => 0.999999)).toBe(list[list.length - 1].id)
  })
  it('各種行為都有機會出現', () => {
    const rng = makeRng(11)
    const seen = new Set<string>()
    let last = null as ReturnType<typeof pickBehavior>
    for (let i = 0; i < 500; i++) {
      last = pickBehavior({ ...ctx, poopCount: 1, hasBall: true }, last, rng)
      seen.add(last!)
    }
    expect(seen).toEqual(new Set(ids({ ...ctx, poopCount: 1, hasBall: true })))
  })
})

describe('BehaviorScheduler', () => {
  const T = 1_000_000
  const mk = (rng = makeRng(9)) => new BehaviorScheduler({ rng }, T)

  it('閒置 15–40 秒後才會觸發', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = new BehaviorScheduler({ rng: makeRng(seed) }, T)
      expect(s.nextAt - T).toBeGreaterThanOrEqual(IDLE_MIN_MS)
      expect(s.nextAt - T).toBeLessThanOrEqual(IDLE_MAX_MS)
    }
    const s = mk()
    expect(s.tick(T + IDLE_MIN_MS - 1, free, ctx)).toBeNull()
    expect(s.tick(T + IDLE_MAX_MS + 1, free, ctx)).not.toBeNull()
  })
  it('互動後重新計時', () => {
    const s = mk()
    const later = T + IDLE_MAX_MS - 100
    s.reset(later)
    expect(s.tick(later + 1000, free, ctx)).toBeNull()
  })
  it('佈置、拖曳、動畫中、隱藏、睡覺、慶祝覆蓋：都不觸發，而且解除後不會馬上補一個', () => {
    for (const k of ['edit', 'dragging', 'busy', 'hidden', 'asleep', 'overlay'] as const) {
      const s = mk()
      const t = T + IDLE_MAX_MS + 5000
      expect(s.tick(t, { ...free, [k]: true }, ctx)).toBeNull()
      // 被擋住時有冷卻：解除後不會立刻觸發
      expect(s.tick(t + 1000, free, ctx)).toBeNull()
      expect(s.tick(t + BLOCKED_COOLDOWN_MS + 1, free, ctx)).not.toBeNull()
    }
  })
  it('連續觸發不會重複同一個行為', () => {
    const s = mk(makeRng(2))
    let t = T
    let prev: string | null = null
    for (let i = 0; i < 100; i++) {
      t += IDLE_MAX_MS + 1
      const id = s.tick(t, free, ctx)
      expect(id).not.toBeNull()
      expect(id).not.toBe(prev)
      prev = id
      s.reset(t)
    }
  })
  it('夜晚的蛋仍有行為可做', () => {
    const s = mk()
    expect(s.tick(T + IDLE_MAX_MS + 1, free, { ...ctx, stage: 'egg', tod: 'night', hunger: 80 })).not.toBeNull()
  })
})
