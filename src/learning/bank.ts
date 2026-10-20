import numberJson from './content/number.json'
import classifyJson from './content/classify.json'
import patternJson from './content/pattern.json'
import type { Difficulty, Question, SkillId } from './types'

/** 題庫（固定 JSON，由 scripts/gen-questions.mjs 產生後人工審閱） */
export const QUESTIONS: Question[] = [
  ...(numberJson as unknown as Question[]),
  ...(classifyJson as unknown as Question[]),
  ...(patternJson as unknown as Question[]),
]

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]))

export function getQuestion(id: string): Question | undefined {
  return BY_ID.get(id)
}

export function questionsFor(skill: SkillId, difficulty: Difficulty, bank: Question[] = QUESTIONS): Question[] {
  return bank.filter((q) => q.skill === skill && q.difficulty === difficulty)
}
