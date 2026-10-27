// 寵物動作腳本（SPEC-v3 A1/A2/A3/A4）：每個行為是一份「時間軸資料」（Scene），
// 純函式產生、不碰 DOM / 計時器；UI 的執行器照時間表逐步套用。這樣行為內容可以單元測試。
import type { TrickId } from '../domain/tricks'
import type { Stage } from '../domain/types'
import type { PetSound } from './sounds'
import type { WalkPlan } from './walk'

export type PoseId = 'idle' | 'cheer' | 'happy' | 'eating' | 'sing' | 'dance' | 'laugh' | 'dizzy' | 'sleep' | 'sleepy' | 'shy'
export type AnimId =
  | 'sway'
  | 'dance'
  | 'walk'
  | 'bounce'
  | 'shake'
  | 'spin'
  | 'sneeze'
  | 'yawn'
  | 'tummy'
  | 'squat'
  | 'chew'
  | 'gulp'
  | 'burp'
  | 'pat'
  | 'wiggle'
  | 'gaze'
  | 'wave'
  | 'wobble'
  /** 搖頭說「不要」（吃飽了） */
  | 'headshake'
  /** v5：翻筋斗（360 度翻轉） */
  | 'flip'
  /** v5：跟著節拍原地小跳 */
  | 'hop'
export type FxId = 'notes' | 'sparkles' | 'cloud' | 'hearts' | 'bigHearts' | 'orbit' | 'glow'
export type SceneKind = 'eat' | 'poop' | 'behavior' | 'reaction'

export type Action =
  | { do: 'pose'; pose: PoseId | null }
  | { do: 'anim'; anim: AnimId | null }
  | { do: 'flip'; on: boolean }
  /** 對話泡泡：text 或 icon（public/art 的圖名）；ms 之後消失 */
  | { do: 'say'; text?: string; icon?: string; ms: number }
  | { do: 'fx'; fx: FxId; ms: number }
  | { do: 'sound'; sound: PetSound }
  | { do: 'walk'; toX: number; ms: number }
  /** 便便從身後彈出來（由執行器寫進資料庫） */
  | { do: 'poop' }
  | { do: 'food'; phase: 'fly' | 'bite' | 'gulp' | 'absorb'; n?: number }
  | { do: 'ball'; on: boolean }
  /** v5：唸一句話（sayText，遵守語音開關） */
  | { do: 'voice'; text: string }
  /** v5：房間裡的家具閃一下（整理房間） */
  | { do: 'flash'; on: boolean }

export interface Step {
  at: number
  act: Action
}
export interface Scene {
  id: string
  kind: SceneKind
  steps: Step[]
  /** 整段結束時間（ms）；結束時執行器會清掉姿勢/動畫/特效 */
  ms: number
}

export type BehaviorId =
  | 'sing'
  | 'dance'
  | 'walk'
  | 'yawn'
  | 'sneeze'
  | 'gaze'
  | 'wave'
  | 'rubTummy'
  | 'pinchNose'
  | 'ballPlay'
  | 'eggWobble'
  | 'eggSparkle'
  // v5：阿悟學會的新招（見 domain/tricks.ts）
  | 'trickCount'
  | 'trickTidy'
  | 'trickRhythm'
  | 'trickHello'
  | 'trickFlip'
  // v6：數學第 2 章的新招
  | 'trickHeight'
  | 'trickHide'
  | 'trickMemory'

export const TRICK_BEHAVIORS = ['trickCount', 'trickTidy', 'trickRhythm', 'trickHello', 'trickFlip', 'trickHeight', 'trickHide', 'trickMemory'] as const satisfies readonly BehaviorId[]
/** 新招 id（domain/tricks.ts）→ 行為 id */
export const TRICK_BEHAVIOR: Record<TrickId, BehaviorId> = {
  count: 'trickCount',
  tidy: 'trickTidy',
  rhythm: 'trickRhythm',
  hello: 'trickHello',
  flip: 'trickFlip',
  height: 'trickHeight',
  hide: 'trickHide',
  memory: 'trickMemory',
}

export const BEHAVIOR_IDS: readonly BehaviorId[] = [
  'sing', 'dance', 'walk', 'yawn', 'sneeze', 'gaze', 'wave', 'rubTummy', 'pinchNose', 'ballPlay', 'eggWobble', 'eggSparkle',
  ...TRICK_BEHAVIORS,
]

export interface TimedWalk extends WalkPlan {
  ms: number
}

export interface PlanEnv {
  rng: () => number
  childName: string
  stage: Stage
  /** 散步目標（沒有可走的地方就是 null） */
  walk: TimedWalk | null
  /** 走到畫面中央（揮手用） */
  centerWalk: TimedWalk | null
  /** 走到球旁邊（追球用） */
  ballWalk: TimedWalk | null
  /** 想吃的食物圖名（餓肚子泡泡用） */
  wishIcons: readonly string[]
  /** v5：整理房間依序走的路徑（左 → 右 → 回中間）；沒有就原地表演 */
  tidyPath?: readonly TimedWalk[]
}

const step = (at: number, act: Action): Step => ({ at, act })

/** 發呆時腦中想的東西 */
export const DAYDREAM_ICONS = ['obj-banana', 'obj-peach', 'obj-star'] as const
export const FALLBACK_WISH_ICON = 'food-banana'

const pick = <T,>(arr: readonly T[], rng: () => number): T => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]

const walkSteps = (w: TimedWalk, at = 0): Step[] => [
  step(at, { do: 'flip', on: w.dir < 0 }),
  step(at, { do: 'anim', anim: 'walk' }),
  step(at, { do: 'walk', toX: w.toX, ms: w.ms }),
  step(at + w.ms, { do: 'anim', anim: null }),
]

export function planBehavior(id: BehaviorId, env: PlanEnv): Scene {
  const { rng } = env
  const name = env.childName.trim() || '小朋友'
  switch (id) {
    case 'sing':
      return {
        id,
        kind: 'behavior',
        ms: 3500,
        steps: [
          step(0, { do: 'pose', pose: 'sing' }),
          step(0, { do: 'anim', anim: 'sway' }),
          step(0, { do: 'fx', fx: 'notes', ms: 3300 }),
          step(0, { do: 'sound', sound: 'sing' }),
          step(1700, { do: 'sound', sound: 'sing' }),
        ],
      }
    case 'dance':
      return {
        id,
        kind: 'behavior',
        ms: 3200,
        steps: [
          step(0, { do: 'pose', pose: 'dance' }),
          step(0, { do: 'anim', anim: 'dance' }),
          step(0, { do: 'fx', fx: 'sparkles', ms: 3000 }),
          step(300, { do: 'sound', sound: 'boing' }),
          step(1000, { do: 'sound', sound: 'boing' }),
          step(1700, { do: 'sound', sound: 'boing' }),
          step(2400, { do: 'sound', sound: 'boing' }),
        ],
      }
    case 'walk': {
      if (!env.walk) return planBehavior('gaze', env)
      return { id, kind: 'behavior', ms: env.walk.ms + 250, steps: [step(0, { do: 'pose', pose: 'idle' }), ...walkSteps(env.walk)] }
    }
    case 'yawn':
      return {
        id,
        kind: 'behavior',
        ms: 2000,
        steps: [
          step(0, { do: 'pose', pose: 'sleepy' }),
          step(0, { do: 'anim', anim: 'yawn' }),
          step(150, { do: 'say', text: '哈～', ms: 1500 }),
          step(150, { do: 'sound', sound: 'yawn' }),
        ],
      }
    case 'sneeze':
      return {
        id,
        kind: 'behavior',
        ms: 2100,
        steps: [
          step(0, { do: 'pose', pose: 'dizzy' }),
          step(0, { do: 'anim', anim: 'wobble' }),
          step(0, { do: 'sound', sound: 'sneeze' }),
          step(650, { do: 'pose', pose: 'happy' }),
          step(650, { do: 'anim', anim: 'sneeze' }),
          step(650, { do: 'say', text: '哈啾！', ms: 1100 }),
          step(650, { do: 'fx', fx: 'cloud', ms: 1000 }),
        ],
      }
    case 'gaze':
      return {
        id,
        kind: 'behavior',
        ms: 3300,
        steps: [
          step(0, { do: 'pose', pose: 'idle' }),
          step(0, { do: 'anim', anim: 'gaze' }),
          step(500, { do: 'say', icon: pick(DAYDREAM_ICONS, rng), ms: 2500 }),
        ],
      }
    case 'wave': {
      const w = env.centerWalk
      const t0 = w ? w.ms + 200 : 0
      return {
        id,
        kind: 'behavior',
        ms: t0 + 2300,
        steps: [
          ...(w ? [step(0, { do: 'pose', pose: 'idle' } as Action), ...walkSteps(w)] : []),
          step(t0, { do: 'flip', on: false }),
          step(t0, { do: 'pose', pose: 'happy' }),
          step(t0, { do: 'anim', anim: 'wave' }),
          step(t0, { do: 'say', text: `${name}！`, ms: 1900 }),
          step(t0, { do: 'sound', sound: 'giggle' }),
        ],
      }
    }
    case 'rubTummy':
      return {
        id,
        kind: 'behavior',
        ms: 2800,
        steps: [
          step(0, { do: 'pose', pose: 'idle' }),
          step(0, { do: 'anim', anim: 'tummy' }),
          step(0, { do: 'sound', sound: 'rumble' }),
          step(300, { do: 'say', icon: env.wishIcons.length ? pick(env.wishIcons, rng) : FALLBACK_WISH_ICON, ms: 2300 }),
        ],
      }
    case 'pinchNose':
      return {
        id,
        kind: 'behavior',
        ms: 2200,
        steps: [
          step(0, { do: 'pose', pose: 'shy' }),
          step(0, { do: 'anim', anim: 'shake' }),
          step(100, { do: 'say', text: '臭臭～', ms: 1900 }),
        ],
      }
    case 'ballPlay': {
      const w = env.ballWalk
      const t0 = w ? w.ms + 150 : 0
      return {
        id,
        kind: 'behavior',
        ms: t0 + 2400,
        steps: [
          ...(w ? [step(0, { do: 'pose', pose: 'idle' } as Action), ...walkSteps(w)] : []),
          step(t0, { do: 'flip', on: false }),
          step(t0, { do: 'pose', pose: 'happy' }),
          step(t0, { do: 'anim', anim: 'bounce' }),
          step(t0, { do: 'ball', on: true }),
          step(t0 + 100, { do: 'sound', sound: 'boing' }),
          step(t0 + 800, { do: 'sound', sound: 'boing' }),
          step(t0 + 1500, { do: 'sound', sound: 'boing' }),
          step(t0 + 2200, { do: 'ball', on: false }),
        ],
      }
    }
    case 'trickCount': {
      // 數香蕉：一根一根數，頭上冒出 1、2、3，每數一個蹦一下
      const nums: [number, string][] = [[450, '1'], [1150, '2'], [1850, '3']]
      return {
        id,
        kind: 'behavior',
        ms: 3500,
        steps: [
          step(0, { do: 'pose', pose: 'happy' }),
          step(0, { do: 'anim', anim: 'bounce' }),
          ...nums.flatMap(([at, n], i): Step[] => [
            step(at, { do: 'say', text: n, ms: 620 }),
            step(at, { do: 'sound', sound: 'pop' }),
            step(at, { do: 'voice', text: ['一', '二', '三'][i] }),
          ]),
          step(2550, { do: 'say', icon: 'obj-banana', ms: 850 }),
          step(2550, { do: 'fx', fx: 'sparkles', ms: 850 }),
          step(2550, { do: 'sound', sound: 'sparkle' }),
          step(3400, { do: 'anim', anim: null }),
        ],
      }
    }
    case 'trickTidy': {
      // 整理房間：繞房間走一圈（左 → 右 → 回中間），最後家具一件一件閃一下
      const path = env.tidyPath ?? []
      const steps: Step[] = [step(0, { do: 'pose', pose: 'idle' })]
      let t = 0
      for (const w of path) {
        steps.push(...walkSteps(w, t))
        t += w.ms + 150
      }
      steps.push(
        step(t, { do: 'flip', on: false }),
        step(t, { do: 'pose', pose: 'happy' }),
        step(t, { do: 'anim', anim: 'bounce' }),
        step(t, { do: 'flash', on: true }),
        step(t, { do: 'say', text: '整理好囉！', ms: 1700 }),
        step(t, { do: 'sound', sound: 'sparkle' }),
        step(t + 1700, { do: 'flash', on: false }),
        step(t + 1700, { do: 'anim', anim: null }),
      )
      return { id, kind: 'behavior', ms: t + 1900, steps }
    }
    case 'trickRhythm': {
      // 節奏舞：左右左右跳，配節拍音效（每拍 420ms，共 8 拍）
      const beat = 420
      const steps: Step[] = [step(0, { do: 'pose', pose: 'dance' }), step(0, { do: 'anim', anim: 'hop' }), step(0, { do: 'fx', fx: 'notes', ms: beat * 8 })]
      for (let i = 0; i < 8; i++) {
        steps.push(step(i * beat, { do: 'flip', on: i % 2 === 1 }), step(i * beat, { do: 'sound', sound: i % 4 === 0 ? 'boing' : 'beat' }))
      }
      steps.push(step(beat * 8, { do: 'flip', on: false }), step(beat * 8, { do: 'anim', anim: null }))
      return { id, kind: 'behavior', ms: beat * 8 + 300, steps }
    }
    case 'trickHello':
      // 說 Hello：揮手，泡泡寫出 Hello（英文科目的新招）
      return {
        id,
        kind: 'behavior',
        ms: 2900,
        steps: [
          step(0, { do: 'flip', on: false }),
          step(0, { do: 'pose', pose: 'happy' }),
          step(0, { do: 'anim', anim: 'wave' }),
          step(300, { do: 'say', text: 'Hello!', ms: 2200 }),
          step(300, { do: 'sound', sound: 'giggle' }),
          step(300, { do: 'fx', fx: 'sparkles', ms: 2000 }),
        ],
      }
    case 'trickFlip':
      // 翻筋斗：跳起來轉 360 度，連翻兩次
      return {
        id,
        kind: 'behavior',
        ms: 3200,
        steps: [
          step(0, { do: 'flip', on: false }),
          step(0, { do: 'pose', pose: 'cheer' }),
          step(0, { do: 'anim', anim: 'flip' }),
          step(150, { do: 'sound', sound: 'boing' }),
          step(1500, { do: 'anim', anim: null }),
          step(1530, { do: 'anim', anim: 'flip' }),
          step(1650, { do: 'sound', sound: 'boing' }),
          step(2300, { do: 'fx', fx: 'sparkles', ms: 800 }),
          step(2300, { do: 'sound', sound: 'sparkle' }),
          step(2300, { do: 'say', text: '耶！', ms: 800 }),
          step(2900, { do: 'anim', anim: null }),
        ],
      }
    case 'trickHeight':
      // 量身高：先蹲下變矮，再跳起來變高（用現有的蹲下、彈跳動畫）
      return {
        id,
        kind: 'behavior',
        ms: 3500,
        steps: [
          step(0, { do: 'flip', on: false }),
          step(0, { do: 'pose', pose: 'idle' }),
          step(0, { do: 'anim', anim: 'squat' }),
          step(150, { do: 'say', text: '矮矮的', ms: 1000 }),
          step(150, { do: 'voice', text: '矮矮的' }),
          step(1300, { do: 'anim', anim: null }),
          step(1330, { do: 'pose', pose: 'cheer' }),
          step(1330, { do: 'anim', anim: 'bounce' }),
          step(1350, { do: 'say', text: '高高！', ms: 1000 }),
          step(1350, { do: 'voice', text: '高高！' }),
          step(1350, { do: 'sound', sound: 'boing' }),
          step(2500, { do: 'fx', fx: 'sparkles', ms: 800 }),
          step(2500, { do: 'sound', sound: 'sparkle' }),
          step(3400, { do: 'anim', anim: null }),
        ],
      }
    case 'trickHide':
      // 捉迷藏：用手蓋住臉躲起來，再跳出來「找到我了」
      return {
        id,
        kind: 'behavior',
        ms: 3600,
        steps: [
          step(0, { do: 'flip', on: false }),
          step(0, { do: 'pose', pose: 'shy' }),
          step(0, { do: 'anim', anim: 'wobble' }),
          step(150, { do: 'say', text: '我躲起來囉', ms: 1500 }),
          step(150, { do: 'voice', text: '我躲起來囉' }),
          step(1900, { do: 'anim', anim: null }),
          step(1930, { do: 'pose', pose: 'happy' }),
          step(1930, { do: 'anim', anim: 'bounce' }),
          step(1950, { do: 'say', text: '找到我了！', ms: 1300 }),
          step(1950, { do: 'voice', text: '找到我了！' }),
          step(1950, { do: 'sound', sound: 'giggle' }),
          step(1950, { do: 'fx', fx: 'hearts', ms: 1200 }),
          step(3500, { do: 'anim', anim: null }),
        ],
      }
    case 'trickMemory':
      // 記憶魔術：香蕉出現、消失，轉一圈再變回來
      return {
        id,
        kind: 'behavior',
        ms: 4000,
        steps: [
          step(0, { do: 'flip', on: false }),
          step(0, { do: 'pose', pose: 'idle' }),
          step(0, { do: 'anim', anim: 'gaze' }),
          step(100, { do: 'say', icon: 'obj-banana', ms: 900 }),
          step(100, { do: 'voice', text: '記住囉' }),
          step(100, { do: 'sound', sound: 'pop' }),
          step(1200, { do: 'say', text: '？', ms: 800 }),
          step(1200, { do: 'sound', sound: 'pop' }),
          step(2100, { do: 'anim', anim: null }),
          step(2130, { do: 'pose', pose: 'happy' }),
          step(2130, { do: 'anim', anim: 'spin' }),
          step(2200, { do: 'say', icon: 'obj-banana', ms: 1200 }),
          step(2200, { do: 'voice', text: '是香蕉！' }),
          step(2200, { do: 'fx', fx: 'sparkles', ms: 1200 }),
          step(2200, { do: 'sound', sound: 'sparkle' }),
          step(3500, { do: 'anim', anim: null }),
        ],
      }
    case 'eggWobble':
      return { id, kind: 'behavior', ms: 1800, steps: [step(0, { do: 'anim', anim: 'wiggle' })] }
    case 'eggSparkle':
      return {
        id,
        kind: 'behavior',
        ms: 2200,
        steps: [step(0, { do: 'anim', anim: 'wobble' }), step(0, { do: 'fx', fx: 'sparkles', ms: 2000 }), step(0, { do: 'sound', sound: 'sparkle' })],
      }
  }
}

// ---------- 互動反應（SPEC-v3 A4） ----------

export type ReactionId = 'tickle' | 'dizzy' | 'pat' | 'thanks' | 'wake' | 'full' | 'gifted'

export function planReaction(id: ReactionId): Scene {
  switch (id) {
    case 'tickle': // 連點 3 次：搔癢大笑
      return {
        id,
        kind: 'reaction',
        ms: 1900,
        steps: [
          step(0, { do: 'pose', pose: 'laugh' }),
          step(0, { do: 'anim', anim: 'shake' }),
          step(0, { do: 'say', text: '哈哈哈！', ms: 1700 }),
          step(0, { do: 'sound', sound: 'giggle' }),
          step(450, { do: 'sound', sound: 'giggle' }),
          step(900, { do: 'sound', sound: 'giggle' }),
          step(1300, { do: 'sound', sound: 'giggle' }),
        ],
      }
    case 'dizzy': // 連點 6 次：轉圈圈後頭暈
      return {
        id,
        kind: 'reaction',
        ms: 3500,
        steps: [
          step(0, { do: 'anim', anim: 'spin' }),
          step(0, { do: 'sound', sound: 'boing' }),
          step(900, { do: 'pose', pose: 'dizzy' }),
          step(900, { do: 'anim', anim: 'wobble' }),
          step(900, { do: 'fx', fx: 'orbit', ms: 2500 }),
          step(1200, { do: 'say', text: '不要再轉了啦～', ms: 2000 }),
        ],
      }
    case 'pat': // 長按：摸摸頭，閉眼享受
      return {
        id,
        kind: 'reaction',
        ms: 2800,
        steps: [
          step(0, { do: 'pose', pose: 'laugh' }),
          step(0, { do: 'anim', anim: 'pat' }),
          step(0, { do: 'fx', fx: 'hearts', ms: 2400 }),
          step(0, { do: 'say', text: '好舒服～', ms: 2000 }),
          step(0, { do: 'sound', sound: 'giggle' }),
        ],
      }
    case 'thanks': // 清掉便便
      return {
        id,
        kind: 'reaction',
        ms: 2200,
        steps: [
          step(0, { do: 'pose', pose: 'laugh' }),
          step(0, { do: 'anim', anim: 'bounce' }),
          step(0, { do: 'say', text: '謝謝你！', ms: 1800 }),
          step(0, { do: 'fx', fx: 'hearts', ms: 1400 }),
          step(0, { do: 'sound', sound: 'giggle' }),
        ],
      }
    case 'full': // 吃飽了還被餵：搖頭「我吃飽了～」（SPEC-v4 U2；食物沒有被扣）
      return {
        id,
        kind: 'reaction',
        ms: 2200,
        steps: [
          step(0, { do: 'pose', pose: 'shy' }),
          step(0, { do: 'anim', anim: 'headshake' }),
          step(0, { do: 'say', text: '我吃飽了～', ms: 1900 }),
          step(0, { do: 'sound', sound: 'gulp' }),
        ],
      }
    case 'gifted': // 孩子收下禮物：阿悟開心跳一下
      return {
        id,
        kind: 'reaction',
        ms: 1800,
        steps: [
          step(0, { do: 'pose', pose: 'laugh' }),
          step(0, { do: 'anim', anim: 'bounce' }),
          step(0, { do: 'fx', fx: 'hearts', ms: 1400 }),
          step(0, { do: 'sound', sound: 'giggle' }),
        ],
      }
    case 'wake': // 點睡著的阿悟
      return {
        id,
        kind: 'reaction',
        ms: 2600,
        steps: [
          step(0, { do: 'pose', pose: 'sleepy' }),
          step(0, { do: 'anim', anim: 'yawn' }),
          step(0, { do: 'say', text: '好睏喔…', ms: 2300 }),
          step(0, { do: 'sound', sound: 'yawn' }),
        ],
      }
  }
}

// ---------- 禮物（SPEC-v5 經濟） ----------

export interface GiftPlan {
  scene: Scene
  /** 禮物從身後彈出來的時間點（ms，阿悟走到中間之後） */
  popAt: number
}

/** 阿悟走到畫面中間，開心地拿出禮物並說一句話（禮物圖本身由 UI 在 popAt 時彈出） */
export function planGift(env: PlanEnv, text: string): GiftPlan {
  const w = env.centerWalk
  const t0 = w ? w.ms + 200 : 0
  const egg = env.stage === 'egg'
  return {
    popAt: t0 + 250,
    scene: {
      id: 'gift',
      kind: 'reaction',
      ms: t0 + 3400,
      steps: [
        ...(w ? [step(0, { do: 'pose', pose: 'idle' } as Action), ...walkSteps(w)] : []),
        step(t0, { do: 'flip', on: false }),
        step(t0, { do: 'pose', pose: 'cheer' }),
        step(t0, { do: 'anim', anim: egg ? 'wiggle' : 'bounce' }),
        step(t0 + 250, { do: 'say', text, ms: 3000 }),
        step(t0 + 250, { do: 'voice', text }),
        step(t0 + 250, { do: 'fx', fx: 'sparkles', ms: 1800 }),
        step(t0 + 250, { do: 'sound', sound: 'sparkle' }),
        step(t0 + 1500, { do: 'anim', anim: null }),
        step(t0 + 1500, { do: 'pose', pose: 'happy' }),
      ],
    },
  }
}

// ---------- 大便（SPEC-v3 A3） ----------

/** 蹲下 → 噗 → 便便從身後彈出來 */
export function planPoop(): Scene {
  return {
    id: 'poop',
    kind: 'poop',
    ms: 1700,
    steps: [
      step(0, { do: 'pose', pose: 'shy' }),
      step(0, { do: 'anim', anim: 'squat' }),
      step(750, { do: 'sound', sound: 'poop' }),
      step(750, { do: 'poop' }),
      step(900, { do: 'anim', anim: 'bounce' }),
      step(900, { do: 'pose', pose: 'happy' }),
    ],
  }
}

// ---------- 吃東西（SPEC-v3 A1） ----------

export interface EatOpts {
  stage: Stage
  /** 約 1/4 機率打嗝 */
  burp: boolean
  /** 蛋糕：吃完會跳舞（SPEC B2） */
  celebrate?: boolean
  /** 今天最喜歡的食物（SPEC B2）：愛心加倍、說「最喜歡了！」 */
  favorite?: boolean
}

/** 咀嚼的間隔 */
export const BITE_MS = 330
export const EAT_FLY_MS = 320

/**
 * 張嘴 → 食物飛到嘴邊 → 咀嚼 3 下（每口食物縮小、噴碎屑）→ 吞下去肚子鼓一下冒愛心 →（偶爾打嗝害羞）。
 * 沒打嗝約 1.9 秒、打嗝約 2.5 秒；蛋階段是食物被「吸收」，蛋晃動發光。
 */
export function planEat(o: EatOpts): Scene {
  if (o.stage === 'egg') {
    return {
      id: 'eat',
      kind: 'eat',
      ms: 1700,
      steps: [
        step(0, { do: 'sound', sound: 'ah' }),
        step(0, { do: 'food', phase: 'fly' }),
        step(EAT_FLY_MS, { do: 'food', phase: 'absorb' }),
        step(EAT_FLY_MS, { do: 'anim', anim: 'wiggle' }),
        step(EAT_FLY_MS, { do: 'fx', fx: 'glow', ms: 1200 }),
        step(EAT_FLY_MS, { do: 'sound', sound: 'gulp' }),
        step(EAT_FLY_MS + 350, { do: 'fx', fx: 'hearts', ms: 900 }),
      ],
    }
  }
  const b0 = EAT_FLY_MS + 130
  const steps: Step[] = [
    step(0, { do: 'pose', pose: 'eating' }),
    step(0, { do: 'sound', sound: 'ah' }),
    step(0, { do: 'food', phase: 'fly' }),
  ]
  for (let n = 1; n <= 3; n++) {
    const t = b0 + (n - 1) * BITE_MS
    steps.push(step(t, { do: 'pose', pose: 'happy' }), step(t, { do: 'anim', anim: 'chew' }), step(t, { do: 'food', phase: 'bite', n }), step(t, { do: 'sound', sound: 'chew' }))
  }
  const tg = b0 + 3 * BITE_MS + 40
  steps.push(step(tg, { do: 'food', phase: 'gulp' }), step(tg, { do: 'anim', anim: 'gulp' }), step(tg, { do: 'sound', sound: 'gulp' }), step(tg + 120, { do: 'fx', fx: o.favorite ? 'bigHearts' : 'hearts', ms: o.favorite ? 900 : 700 }))
  let end = tg + 420
  if (o.favorite) {
    // 最喜歡的食物：開心大笑、愛心加倍，不打嗝（維持在 2.5 秒內）
    steps.push(step(tg + 100, { do: 'pose', pose: 'laugh' }), step(tg + 100, { do: 'anim', anim: 'bounce' }), step(tg + 100, { do: 'say', text: '最喜歡了！', ms: 900 }), step(tg + 100, { do: 'sound', sound: 'giggle' }))
    end = tg + 1000
  } else if (o.burp) {
    const tb = tg + 300
    steps.push(
      step(tb, { do: 'pose', pose: 'shy' }),
      step(tb, { do: 'anim', anim: 'burp' }),
      step(tb, { do: 'say', text: '嗝～', ms: 800 }),
      step(tb, { do: 'sound', sound: 'burp' }),
    )
    end = tb + 700
  } else {
    steps.push(step(tg + 260, { do: 'anim', anim: null }))
  }
  if (o.celebrate) {
    steps.push(step(end, { do: 'pose', pose: 'dance' }), step(end, { do: 'anim', anim: 'dance' }), step(end, { do: 'fx', fx: 'sparkles', ms: 1600 }), step(end, { do: 'sound', sound: 'boing' }))
    end += 1700
  }
  return { id: 'eat', kind: 'eat', ms: end, steps }
}
