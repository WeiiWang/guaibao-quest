import type { AgeBand } from '../domain/types'
import type { Difficulty } from './types'

export const AGE_BANDS: AgeBand[] = ['3', '4-5', '6-7']
export const AGE_LABEL: Record<AgeBand, string> = { '3': '3 歲', '4-5': '4–5 歲', '6-7': '6–7 歲' }

/** 學習相關的「這個孩子是誰」：年齡檔、起始難度、是否幼幼模式。目前存在 settings，之後改成每個孩子各自一份 */
export interface LearnerProfile {
  ageBand: AgeBand
  /** 還沒設定年齡時是 false（用 4–5 歲的預設值） */
  configured: boolean
  startDifficulty: Difficulty
  /** 幼幼模式：只有 2 選 1、題目限縮、升級要連續 5 題獨立答對、答錯馬上示範 */
  gentle: boolean
}

export function learnerProfileOf(s: { ageBand?: AgeBand } | undefined): LearnerProfile {
  const band: AgeBand = s?.ageBand && AGE_BANDS.includes(s.ageBand) ? s.ageBand : '4-5'
  return {
    ageBand: band,
    configured: !!s?.ageBand && AGE_BANDS.includes(s.ageBand),
    startDifficulty: band === '6-7' ? 2 : 1,
    gentle: band === '3',
  }
}
