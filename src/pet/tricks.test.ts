import { describe, expect, it } from 'vitest'
import { makeRng } from '../learning/rng'
import { TRICK_IDS } from '../domain/tricks'
import { BehaviorScheduler, candidates, type Gate, type PickContext } from './behavior'
import { PET_COMMANDS } from './bus'
import { BEHAVIOR_IDS, planBehavior, planGift, planReaction, TRICK_BEHAVIOR, type PlanEnv, type Scene } from './plan'
import { soundVoices } from './sounds'

const w = (toX: number, dir: 1 | -1, ms = 1500) => ({ toX, dir, blocked: false, ms })
const env: PlanEnv = {
  rng: makeRng(1),
  childName: '小寶',
  stage: 'adult',
  walk: w(0.5, 1),
  centerWalk: w(0.5, -1),
  ballWalk: null,
  wishIcons: [],
  tidyPath: [w(0.2, -1), w(0.8, 1, 2200), w(0.5, -1)],
}
const doing = (s: Scene, kind: string) => s.steps.filter((x) => x.act.do === kind).map((x) => x.act)

describe('新招動畫腳本', () => {
  it('每個新招 id 都對得到一個行為，行為有場景、時間排序、都在場景結束前', () => {
    for (const id of TRICK_IDS) {
      const s = planBehavior(TRICK_BEHAVIOR[id], env)
      expect(s.kind).toBe('behavior')
      let prev = 0
      for (const st of s.steps) {
        expect(st.at).toBeGreaterThanOrEqual(prev)
        expect(st.at).toBeLessThanOrEqual(s.ms)
        prev = st.at
        if (st.act.do === 'sound') expect(soundVoices(st.act.sound, makeRng(1)).length).toBeGreaterThan(0)
      }
      expect(BEHAVIOR_IDS).toContain(TRICK_BEHAVIOR[id])
    }
  })
  it('數香蕉：頭上依序冒出 1、2、3，並一個一個唸數字', () => {
    const s = planBehavior('trickCount', env)
    expect(doing(s, 'say').filter((a) => a.do === 'say' && a.text).map((a) => (a as { text: string }).text)).toEqual(['1', '2', '3'])
    expect(doing(s, 'voice').map((a) => (a as { text: string }).text)).toEqual(['一', '二', '三'])
  })
  it('整理房間：繞房間走（左、右、回中間）後，家具閃一下再關掉', () => {
    const s = planBehavior('trickTidy', env)
    const walks = doing(s, 'walk') as { toX: number }[]
    expect(walks.map((x) => x.toX)).toEqual([0.2, 0.8, 0.5])
    const flash = doing(s, 'flash') as { on: boolean }[]
    expect(flash.map((f) => f.on)).toEqual([true, false])
    // 閃之前先走完
    const lastWalkEnd = Math.max(...s.steps.filter((x) => x.act.do === 'walk').map((x) => x.at + (x.act as { ms: number }).ms))
    expect(s.steps.find((x) => x.act.do === 'flash')!.at).toBeGreaterThanOrEqual(lastWalkEnd)
    // 沒有路可走也不會壞
    expect(planBehavior('trickTidy', { ...env, tidyPath: [] }).steps.some((x) => x.act.do === 'flash')).toBe(true)
  })
  it('節奏舞：8 拍，左右交替翻面、每拍有音效', () => {
    const s = planBehavior('trickRhythm', env)
    const flips = s.steps.filter((x) => x.act.do === 'flip').map((x) => (x.act as { on: boolean }).on)
    expect(flips.slice(0, 8)).toEqual([false, true, false, true, false, true, false, true])
    expect(doing(s, 'sound')).toHaveLength(8)
    expect(doing(s, 'anim')[0]).toMatchObject({ anim: 'hop' })
  })
  it('說 Hello：揮手、泡泡寫 Hello', () => {
    const s = planBehavior('trickHello', env)
    expect(doing(s, 'anim')[0]).toMatchObject({ anim: 'wave' })
    expect(doing(s, 'say')[0]).toMatchObject({ text: 'Hello!' })
  })
  it('翻筋斗：翻轉動畫（兩次），用 cheer 姿勢', () => {
    const s = planBehavior('trickFlip', env)
    expect(doing(s, 'anim').filter((a) => (a as { anim: string }).anim === 'flip')).toHaveLength(2)
    expect(doing(s, 'pose')[0]).toMatchObject({ pose: 'cheer' })
  })
})

describe('自主行為：學會的招才會自己表演', () => {
  const ctx: PickContext = { stage: 'adult', hunger: 80, poopCount: 0, tod: 'day', hasBall: false }
  const ids = (c: PickContext) => candidates(c).map((x) => x.id)
  it('沒學會就不會演；學會的才進候選', () => {
    expect(ids(ctx).filter((i) => i.startsWith('trick'))).toEqual([])
    expect(ids({ ...ctx, tricks: ['flip', 'count'] }).filter((i) => i.startsWith('trick')).sort()).toEqual(['trickCount', 'trickFlip'])
  })
  it('晚上、餓肚子、蛋都不表演', () => {
    const t = ['flip']
    expect(ids({ ...ctx, tricks: t, tod: 'night' })).not.toContain('trickFlip')
    expect(ids({ ...ctx, tricks: t, hunger: 5 })).not.toContain('trickFlip')
    expect(ids({ ...ctx, tricks: t, stage: 'egg' })).not.toContain('trickFlip')
  })
  it('排程器偶爾真的會挑到新招', () => {
    const gate: Gate = { edit: false, dragging: false, busy: false, hidden: false, asleep: false, overlay: false }
    const s = new BehaviorScheduler({ rng: makeRng(4), minMs: 10, maxMs: 20 }, 0)
    const got = new Set<string>()
    for (let t = 100; t < 100 * 400; t += 100) {
      const id = s.tick(t, gate, { ...ctx, tricks: TRICK_IDS })
      if (id) got.add(id)
    }
    expect([...got].some((i) => i.startsWith('trick'))).toBe(true)
  })
  it('禮物展示中（overlay gate）不會自己亂動', () => {
    const s = new BehaviorScheduler({ rng: makeRng(4), minMs: 10, maxMs: 20 }, 0)
    expect(s.tick(5000, { edit: false, dragging: false, busy: false, hidden: false, asleep: false, overlay: true }, ctx)).toBeNull()
  })
})

describe('禮物展示腳本', () => {
  it('阿悟先走到畫面中間，再拿出禮物：cheer 姿勢、說話、唸出來；禮物在走到之後才彈出', () => {
    const { scene, popAt } = planGift(env, '今天的小禮物！')
    expect(scene.kind).toBe('reaction')
    expect(doing(scene, 'walk')[0]).toMatchObject({ toX: 0.5 })
    expect(popAt).toBeGreaterThan(1500)
    expect(doing(scene, 'say')[0]).toMatchObject({ text: '今天的小禮物！' })
    expect(doing(scene, 'voice')[0]).toMatchObject({ text: '今天的小禮物！' })
    expect(doing(scene, 'pose')).toContainEqual({ do: 'pose', pose: 'cheer' })
    const say = scene.steps.find((x) => x.act.do === 'say')!
    expect(say.at).toBeGreaterThanOrEqual(popAt)
    expect(say.at + (say.act as { ms: number }).ms).toBeLessThanOrEqual(scene.ms + 400)
  })
  it('已經在中間或蛋：不走路也能演', () => {
    const { scene, popAt } = planGift({ ...env, centerWalk: null, stage: 'egg' }, '今天的小禮物！')
    expect(doing(scene, 'walk')).toHaveLength(0)
    expect(popAt).toBeLessThan(500)
    expect(doing(scene, 'anim')[0]).toMatchObject({ anim: 'wiggle' })
  })
  it('收下禮物：開心跳一下', () => {
    expect(planReaction('gifted').steps.some((x) => x.act.do === 'fx')).toBe(true)
  })
})

describe('PM 指令', () => {
  it('每個新招、以及「依序表演每一招」都有指令', () => {
    for (const id of TRICK_IDS) expect(PET_COMMANDS).toContain(`trick:${id}`)
    expect(PET_COMMANDS).toContain('trick:all')
  })
})
