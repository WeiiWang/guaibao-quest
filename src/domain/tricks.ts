// 阿悟的新招（SPEC-v5 長期目標 9）：孩子的學習里程碑 → 阿悟學會一招。
// 只「讀」skillState 與章節進度，不改學習邏輯。純函式。
import type { Difficulty, SkillState } from '../learning/types'

export type TrickId = 'count' | 'tidy' | 'rhythm' | 'hello' | 'flip' | 'bow' | 'height' | 'hide' | 'memory'

export interface TrickDef {
  id: TrickId
  name: string
  emoji: string
  /** 數感 / 分類 / 規律 / 比較與排序 / 空間方位 / 觀察與記憶 / 英文 / 生活：該技能難度升級或首次 mastered 就學會；chapter：通關第一章 */
  unlock: { skill: string } | { chapter: string }
  /** 一句話說明（家長看的） */
  hint: string
}

/** 第一章（花果山）通關 → 翻筋斗 */
export const FIRST_CHAPTER_ID = 'huaguoshan'

export const TRICKS: TrickDef[] = [
  { id: 'count', name: '數香蕉', emoji: '🍌', unlock: { skill: 'number' }, hint: '數感進步了：阿悟一根一根數香蕉' },
  { id: 'tidy', name: '整理房間', emoji: '🧹', unlock: { skill: 'classify' }, hint: '分類進步了：阿悟繞房間走一圈整理' },
  { id: 'rhythm', name: '節奏舞', emoji: '🎵', unlock: { skill: 'pattern' }, hint: '規律進步了：阿悟跟著節拍左右跳' },
  // 英文科目還沒上線；技能 id 先預留成 'english'，上線後自然生效
  { id: 'hello', name: '說 Hello', emoji: '👋', unlock: { skill: 'english' }, hint: '英文進步了：阿悟揮手說 Hello' },
  { id: 'flip', name: '翻筋斗', emoji: '🤸', unlock: { chapter: FIRST_CHAPTER_ID }, hint: '通關第一章：阿悟翻筋斗' },
  // v6：生活與禮儀科目進步了，阿悟學會有禮貌地鞠躬
  { id: 'bow', name: '有禮貌地鞠躬', emoji: '🙇', unlock: { skill: 'life' }, hint: '生活禮儀進步了：阿悟有禮貌地鞠躬說謝謝' },
  // v6 數學第 2 章的三個新技能
  { id: 'height', name: '量身高', emoji: '📏', unlock: { skill: 'measure' }, hint: '比較與排序進步了：阿悟蹲下又站高，比比誰高' },
  { id: 'hide', name: '捉迷藏', emoji: '🙈', unlock: { skill: 'space' }, hint: '空間方位進步了：阿悟躲起來又跳出來' },
  { id: 'memory', name: '記憶魔術', emoji: '🎩', unlock: { skill: 'observe' }, hint: '觀察與記憶進步了：阿悟讓香蕉消失又變回來' },
]

export const TRICK_IDS: TrickId[] = TRICKS.map((t) => t.id)
export const isTrickId = (v: unknown): v is TrickId => typeof v === 'string' && (TRICK_IDS as string[]).includes(v)
export const trickOf = (id: string): TrickDef | undefined => TRICKS.find((t) => t.id === id)

/** 技能有沒有達到里程碑：難度比起始難度高（升級過），或任何一個難度掌握過 */
export function skillMilestone(state: Pick<SkillState, 'difficulty' | 'mastered'> | undefined, startDifficulty: Difficulty): boolean {
  if (!state) return false
  return state.difficulty > startDifficulty || Object.keys(state.mastered ?? {}).length > 0
}

export interface TrickInput {
  /** 各技能狀態（沒有的技能 = 還沒開始） */
  states: Partial<Record<string, Pick<SkillState, 'difficulty' | 'mastered'>>>
  startDifficulty: Difficulty
  /** 已通關的章節 id */
  clearedChapters: readonly string[]
}

/** 依目前進度，應該學會哪些招（不看已學會的；呼叫端自己扣掉） */
export function earnedTricks(input: TrickInput): TrickId[] {
  return TRICKS.filter((t) =>
    'skill' in t.unlock ? skillMilestone(input.states[t.unlock.skill], input.startDifficulty) : input.clearedChapters.includes(t.unlock.chapter),
  ).map((t) => t.id)
}

/** 還沒學會、這次新學會的招 */
export function newTricks(input: TrickInput, known: readonly string[]): TrickId[] {
  return earnedTricks(input).filter((id) => !known.includes(id))
}

/** 隨機挑一招已學會的（沒有就 null；avoid = 上一招，盡量不連續重複） */
export function pickTrick(known: readonly string[], rng: () => number, avoid?: string | null): TrickId | null {
  const ids = known.filter(isTrickId)
  if (ids.length === 0) return null
  const others = ids.filter((i) => i !== avoid)
  const list = others.length > 0 ? others : ids
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]
}

export const learnLine = (petName: string, trickName: string): string => `${petName}學會了新本領：${trickName}！`
