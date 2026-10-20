import type { Attempt, MaterialCost, MaterialId, SkillId } from './types'
import { isIndependent, SKILLS } from './types'

/** 一站題數 */
export const STATION_SIZE = 5

/** 一站的材料數量（2–4）：依無提示答對數 */
export function stationRewardQty(independent: number): number {
  if (independent >= 4) return 4
  if (independent >= 2) return 3
  return 2
}

export interface SkillTally {
  total: number
  independent: number
}

export interface AttemptSummary extends SkillTally {
  bySkill: Record<SkillId, SkillTally>
}

/** 統計一批作答。提示後答對、答錯後再答對都不算獨立答對 */
export function summarize(attempts: Pick<Attempt, 'skill' | 'firstTryCorrect' | 'hintsUsed'>[]): AttemptSummary {
  const bySkill = Object.fromEntries(SKILLS.map((s) => [s, { total: 0, independent: 0 }])) as Record<SkillId, SkillTally>
  let independent = 0
  for (const a of attempts) {
    bySkill[a.skill].total += 1
    if (isIndependent(a)) {
      bySkill[a.skill].independent += 1
      independent += 1
    }
  }
  return { total: attempts.length, independent, bySkill }
}

export const emptyCost = (): MaterialCost => ({ wood: 0, stone: 0, flower: 0 })

export function addMaterial(cost: MaterialCost, id: MaterialId, qty: number): MaterialCost {
  return { ...cost, [id]: cost[id] + qty }
}
