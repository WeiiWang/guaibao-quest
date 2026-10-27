import { describe, expect, it } from 'vitest'
import { makeRng } from '../learning/rng'
import { BEHAVIOR_IDS, planBehavior, planEat, planPoop, planReaction, type PlanEnv, type ReactionId, type Scene } from './plan'
import { soundVoices } from './sounds'

const walk = { toX: 0.5, dir: 1 as const, blocked: false, ms: 1800 }
const env: PlanEnv = {
  rng: makeRng(1),
  childName: '小寶',
  stage: 'adult',
  walk,
  centerWalk: { ...walk, dir: -1 },
  ballWalk: walk,
  wishIcons: ['food-peach'],
}

const acts = (s: Scene, type: string) => s.steps.filter((x) => x.act.do === type)
const say = (s: Scene) => s.steps.flatMap((x) => (x.act.do === 'say' ? [x.act] : []))
const poses = (s: Scene) => s.steps.flatMap((x) => (x.act.do === 'pose' ? [x.act.pose] : []))

describe('場景資料的共同規則', () => {
  const all: Scene[] = [
    ...BEHAVIOR_IDS.map((id) => planBehavior(id, env)),
    ...(['tickle', 'dizzy', 'pat', 'thanks', 'wake', 'full'] as ReactionId[]).map((id) => planReaction(id)),
    planPoop(),
    planEat({ stage: 'adult', burp: false }),
    planEat({ stage: 'adult', burp: true }),
    planEat({ stage: 'egg', burp: false }),
  ]
  it('步驟依時間排序，且都在場景結束前', () => {
    for (const s of all) {
      expect(s.ms).toBeGreaterThan(0)
      let prev = 0
      for (const st of s.steps) {
        expect(st.at).toBeGreaterThanOrEqual(0)
        expect(st.at).toBeLessThanOrEqual(s.ms)
        expect(st.at).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = st.at
      }
    }
  })
  it('泡泡、特效的持續時間不會超過場景太多', () => {
    for (const s of all) {
      for (const st of s.steps) {
        if (st.act.do === 'say' || st.act.do === 'fx') expect(st.at + st.act.ms).toBeLessThanOrEqual(s.ms + 400)
      }
    }
  })
  it('用到的音效都有配方', () => {
    for (const s of all) {
      for (const st of acts(s, 'sound')) {
        if (st.act.do === 'sound') expect(soundVoices(st.act.sound, makeRng(1)).length).toBeGreaterThan(0)
      }
    }
  })
})

describe('自主行為內容', () => {
  it('唱歌：sing 姿勢、音符、旋律', () => {
    const s = planBehavior('sing', env)
    expect(poses(s)).toContain('sing')
    expect(s.steps.some((x) => x.act.do === 'fx' && x.act.fx === 'notes')).toBe(true)
    expect(s.steps.some((x) => x.act.do === 'sound' && x.act.sound === 'sing')).toBe(true)
  })
  it('跳舞：dance 姿勢、閃小星星', () => {
    const s = planBehavior('dance', env)
    expect(poses(s)).toContain('dance')
    expect(s.steps.some((x) => x.act.do === 'fx' && x.act.fx === 'sparkles')).toBe(true)
  })
  it('散步：走到指定位置，往左走會翻轉圖片，結束後停下', () => {
    const right = planBehavior('walk', env)
    expect(acts(right, 'walk')[0].act).toMatchObject({ do: 'walk', toX: 0.5, ms: 1800 })
    expect(right.steps.find((x) => x.act.do === 'flip')?.act).toMatchObject({ on: false })
    const left = planBehavior('walk', { ...env, walk: { ...walk, dir: -1 } })
    expect(left.steps.find((x) => x.act.do === 'flip')?.act).toMatchObject({ on: true })
    expect(left.ms).toBeGreaterThan(1800)
  })
  it('散步沒有路可走時，退回發呆而不是壞掉', () => {
    expect(planBehavior('walk', { ...env, walk: null }).id).toBe('gaze')
  })
  it('打噴嚏：dizzy → happy，泡泡「哈啾！」，冒小雲', () => {
    const s = planBehavior('sneeze', env)
    expect(poses(s)).toEqual(['dizzy', 'happy'])
    expect(say(s)[0].text).toBe('哈啾！')
    expect(s.steps.some((x) => x.act.do === 'fx' && x.act.fx === 'cloud')).toBe(true)
  })
  it('發呆看窗外：想像泡泡是香蕉/桃子/星星其中之一', () => {
    const seen = new Set<string | undefined>()
    const rng = makeRng(8)
    for (let i = 0; i < 60; i++) seen.add(say(planBehavior('gaze', { ...env, rng }))[0].icon)
    expect(seen).toEqual(new Set(['obj-banana', 'obj-peach', 'obj-star']))
  })
  it('揮手：先走到畫面中央，泡泡用小孩名字', () => {
    const s = planBehavior('wave', env)
    expect(acts(s, 'walk')).toHaveLength(1)
    expect(say(s)[0].text).toBe('小寶！')
    const walkAt = acts(s, 'walk')[0].at
    expect(say(s).length).toBe(1)
    expect(s.steps.find((x) => x.act.do === 'say')!.at).toBeGreaterThan(walkAt)
  })
  it('揮手：小孩名字空白時用「小朋友」', () => {
    expect(say(planBehavior('wave', { ...env, childName: '  ' }))[0].text).toBe('小朋友！')
  })
  it('摸肚子：泡泡是想吃的食物圖', () => {
    expect(say(planBehavior('rubTummy', env))[0].icon).toBe('food-peach')
    expect(say(planBehavior('rubTummy', { ...env, wishIcons: [] }))[0].icon).toBe('food-banana')
  })
  it('捏鼻子：shy + 「臭臭～」', () => {
    const s = planBehavior('pinchNose', env)
    expect(poses(s)).toContain('shy')
    expect(say(s)[0].text).toBe('臭臭～')
  })
  it('追球：走到球旁邊後彈跳、球跟著動，結束時球停下', () => {
    const s = planBehavior('ballPlay', env)
    const balls = s.steps.filter((x) => x.act.do === 'ball').map((x) => (x.act as { on: boolean }).on)
    expect(balls).toEqual([true, false])
  })
})

describe('互動反應', () => {
  it('搔癢大笑：laugh', () => {
    const s = planReaction('tickle')
    expect(poses(s)).toContain('laugh')
    expect(say(s)[0].text).toBe('哈哈哈！')
  })
  it('頭暈：轉圈 → dizzy、繞小星星、說「不要再轉了啦～」，約 3 秒後恢復', () => {
    const s = planReaction('dizzy')
    expect(s.steps[0].act).toMatchObject({ do: 'anim', anim: 'spin' })
    expect(poses(s)).toContain('dizzy')
    expect(s.steps.some((x) => x.act.do === 'fx' && x.act.fx === 'orbit')).toBe(true)
    expect(say(s)[0].text).toBe('不要再轉了啦～')
    expect(s.ms).toBeGreaterThanOrEqual(3000)
  })
  it('長按摸頭：冒愛心；清便便：說「謝謝你！」；點睡著的：說「好睏喔…」', () => {
    expect(planReaction('pat').steps.some((x) => x.act.do === 'fx' && x.act.fx === 'hearts')).toBe(true)
    expect(say(planReaction('thanks'))[0].text).toBe('謝謝你！')
    expect(poses(planReaction('thanks'))).toContain('laugh')
    expect(say(planReaction('wake'))[0].text).toBe('好睏喔…')
  })
})

describe('吃飽了（SPEC-v4 U2）', () => {
  it('搖頭、說「我吃飽了～」，是優先權低於吃東西的反應', () => {
    const s = planReaction('full')
    expect(s.kind).toBe('reaction')
    expect(s.steps.some((x) => x.act.do === 'anim' && x.act.anim === 'headshake')).toBe(true)
    expect(say(s)[0].text).toBe('我吃飽了～')
    expect(s.ms).toBeGreaterThanOrEqual(2000)
  })
})

describe('大便', () => {
  it('先 shy 蹲下，再「噗」，然後便便才出現', () => {
    const s = planPoop()
    expect(s.kind).toBe('poop')
    expect(poses(s)[0]).toBe('shy')
    const sound = s.steps.find((x) => x.act.do === 'sound')!
    const spawn = s.steps.find((x) => x.act.do === 'poop')!
    expect(sound.at).toBeLessThanOrEqual(spawn.at)
    expect(s.steps[0].act).toMatchObject({ do: 'pose', pose: 'shy' })
  })
})

describe('吃東西（SPEC A1）', () => {
  const foods = (s: Scene) => s.steps.flatMap((x) => (x.act.do === 'food' ? [x.act] : []))
  const sounds = (s: Scene) => s.steps.flatMap((x) => (x.act.do === 'sound' ? [x.act.sound] : []))

  it('一般：張嘴(eating) → 飛 → 咀嚼 3 口(每口縮小) → 吞 → 愛心，音效依序 啊嗯/嚼嚼嚼/咕嚕', () => {
    const s = planEat({ stage: 'adult', burp: false })
    expect(s.kind).toBe('eat')
    expect(poses(s)[0]).toBe('eating')
    expect(foods(s).map((f) => f.phase)).toEqual(['fly', 'bite', 'bite', 'bite', 'gulp'])
    expect(foods(s).filter((f) => f.phase === 'bite').map((f) => f.n)).toEqual([1, 2, 3])
    expect(sounds(s)).toEqual(['ah', 'chew', 'chew', 'chew', 'gulp'])
    expect(s.steps.some((x) => x.act.do === 'fx' && x.act.fx === 'hearts')).toBe(true)
  })
  it('整段 1.5–2.5 秒（含打嗝）', () => {
    const a = planEat({ stage: 'adult', burp: false })
    const b = planEat({ stage: 'baby', burp: true })
    for (const s of [a, b]) {
      expect(s.ms).toBeGreaterThanOrEqual(1500)
      expect(s.ms).toBeLessThanOrEqual(2500)
    }
    expect(b.ms).toBeGreaterThan(a.ms)
  })
  it('打嗝：泡泡「嗝～」、嗝的音效、害羞', () => {
    const s = planEat({ stage: 'adult', burp: true })
    expect(say(s)[0].text).toBe('嗝～')
    expect(sounds(s)).toContain('burp')
    expect(poses(s)).toContain('shy')
    const noBurp = planEat({ stage: 'adult', burp: false })
    expect(sounds(noBurp)).not.toContain('burp')
    expect(say(noBurp)).toHaveLength(0)
  })
  it('蛋：食物被吸收、蛋晃動發光，沒有咀嚼', () => {
    const s = planEat({ stage: 'egg', burp: true })
    expect(foods(s).map((f) => f.phase)).toEqual(['fly', 'absorb'])
    expect(s.steps.some((x) => x.act.do === 'fx' && x.act.fx === 'glow')).toBe(true)
    expect(s.steps.some((x) => x.act.do === 'anim' && x.act.anim === 'wiggle')).toBe(true)
    expect(sounds(s)).not.toContain('chew')
    expect(sounds(s)).not.toContain('burp')
    expect(s.ms).toBeLessThanOrEqual(2500)
  })
  it('今天最喜歡的食物：愛心加倍、說「最喜歡了！」、仍在 2.5 秒內，不打嗝', () => {
    const s = planEat({ stage: 'adult', burp: true, favorite: true })
    expect(say(s)[0].text).toBe('最喜歡了！')
    expect(s.steps.some((x) => x.act.do === 'fx' && x.act.fx === 'bigHearts')).toBe(true)
    expect(sounds(s)).not.toContain('burp')
    expect(s.ms).toBeLessThanOrEqual(2500)
  })
  it('蛋糕（celebrate）：吃完會跳舞', () => {
    const s = planEat({ stage: 'adult', burp: false, celebrate: true })
    expect(poses(s)).toContain('dance')
    expect(s.ms).toBeGreaterThan(planEat({ stage: 'adult', burp: false }).ms)
  })
})
