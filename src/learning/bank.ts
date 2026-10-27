import numberJson from './content/number.json'
import classifyJson from './content/classify.json'
import patternJson from './content/pattern.json'
import englishJson from './content/english.json'
import type { Difficulty, Question, SkillId } from './types'

/** 題庫（固定 JSON，由 scripts/gen-questions.mjs 產生後人工審閱） */
export const QUESTIONS: Question[] = [
  ...(numberJson as unknown as Question[]),
  ...(classifyJson as unknown as Question[]),
  ...(patternJson as unknown as Question[]),
  ...(englishJson as unknown as Question[]),
]

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]))

export function getQuestion(id: string): Question | undefined {
  return BY_ID.get(id)
}

/** 一般模式（非幼幼）能用的題：排除幼幼專用題 */
export const isStandard = (q: Question): boolean => !q.gentle

/**
 * 幼幼模式（3 歲）能用的題：幼幼專用題，加上「數 1–3 個」與「拿 1–3 個」這兩種一般題
 * （一般的數數題在出題時會被縮成 2 選 1，見 select.gentleView）。
 */
export function isGentleOk(q: Question): boolean {
  if (q.gentle) return true
  if (q.skill !== 'number' || q.difficulty !== 1) return false
  if (q.type === 'give') return Number(q.answer) <= 3
  return q.type === 'count' && Number(q.answer) <= 3
}

export function questionsFor(skill: SkillId, difficulty: Difficulty, bank: Question[] = QUESTIONS, gentle = false): Question[] {
  // 幼幼模式只有難度 1 有專屬題庫；升到難度 2 以上就用一般題（出題時縮成 2 選 1）
  const ok = gentle && difficulty === 1 ? isGentleOk : isStandard
  return bank.filter((q) => q.skill === skill && q.difficulty === difficulty && ok(q))
}
