// v7 線 B：挑戰站與快速分級的純函式（資料操作在 repo.ts 的 openChallenge / completeChallenge / applyPlacement）。
import { questionsFor } from '../learning/bank'
import { CHALLENGE_BADGE_COMBO, MATH_ALL_SKILLS, type Attempt, type Difficulty, type Question, type SkillId, type SkillState } from '../learning/types'
import { MAX_DIFFICULTY } from '../learning/types'

/** 6–7 歲挑戰站的最低難度（v7.4 H3）：挑戰站不能比這個簡單 */
export const CHALLENGE_MIN_DIFFICULTY: Difficulty = 3

/**
 * 挑戰站的題目難度：比目前高 1 級（最高 4）。minDifficulty：最低從這一級起跳
 * （6–7 歲用 CHALLENGE_MIN_DIFFICULTY；其他年齡不設，維持原本「高 1 級」）。
 */
export function bumpStates(states: Record<SkillId, SkillState>, minDifficulty: Difficulty = 1): Record<SkillId, SkillState> {
  return Object.fromEntries(
    Object.entries(states).map(([k, v]) => [k, { ...v, difficulty: Math.min(MAX_DIFFICULTY, Math.max(minDifficulty, v.difficulty + 1)) as Difficulty }]),
  ) as Record<SkillId, SkillState>
}

/**
 * 6–7 歲數學第一站不出「請你指出水果」這種最簡單的種類題（v7.4 H3）：
 * 只在孩子的分類難度 >= 2（本來就不是從最簡單開始）時才擋；回傳要盡量避開的題型（沒有要擋就是 undefined）。
 */
export function easyTypesToSkip(ageBand: string | undefined, chapterId: string, stationIndex: number, classifyDifficulty: Difficulty): ReadonlySet<string> | undefined {
  if (ageBand !== '6-7' || chapterId !== 'huaguoshan' || stationIndex !== 0 || classifyDifficulty < 2) return undefined
  return new Set(['kind'])
}

/** 依作答先後算最高連對（第一次就答對且沒用提示才算；中斷就歸零） */
export function bestCombo(attempts: Pick<Attempt, 'at' | 'firstTryCorrect' | 'hintsUsed'>[]): number {
  let run = 0
  let best = 0
  for (const a of [...attempts].sort((x, y) => x.at - y.at)) {
    run = a.firstTryCorrect && a.hintsUsed === 0 ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

export const earnsBadge = (combo: number): boolean => combo >= CHALLENGE_BADGE_COMBO

/** 挑戰站一站的材料與食物用「答對比例換算成 5 題」的數量（站的規則是 5 題） */
export const scaledIndependent = (independent: number, total: number): number => (total > 0 ? Math.round((independent * 5) / total) : 0)

/** 快速分級的題數 */
export const PLACEMENT_SIZE = 3
/** 分級結果：全對從 3 起跳；錯 1 題從 2 起跳；錯 2 題以上從 1 起跳 */
export function placementLevel(correct: number, total = PLACEMENT_SIZE): Difficulty {
  const wrong = total - correct
  return wrong <= 0 ? 3 : wrong === 1 ? 2 : 1
}

/** 快速分級的 3 題：數感、分類、規律各一題難度 3 的點選題（固定，不隨機） */
export function placementQuestions(bank?: Question[]): Question[] {
  const out: Question[] = []
  for (const skill of ['number', 'classify', 'pattern'] as const) {
    const q = questionsFor(skill, 3, bank).find((x) => (x.interaction ?? 'pick') === 'pick')
    if (q) out.push(q)
  }
  return out
}

/** 分級結果寫進哪些技能（數學的六個；已經有作答紀錄的技能不改） */
export const PLACEMENT_SKILLS: SkillId[] = MATH_ALL_SKILLS
