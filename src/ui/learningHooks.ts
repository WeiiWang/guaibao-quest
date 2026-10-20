import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { learningSettingsOf, type LearningSettings } from '../learning/playtime'
import { balanceOfMaterials, type MaterialBalance } from '../learning/materials'

/** 時間限制 / 音效 / 語音設定（即時；尚未載入時用預設值） */
export function useLearningSettings(): LearningSettings {
  return useLiveQuery(async () => learningSettingsOf(await db.settings.get('main')), [], learningSettingsOf(undefined))
}

/** 材料餘額（木材/石頭/花朵），由 materialLedger 加總 */
export function useMaterials(): MaterialBalance {
  return useLiveQuery(async () => balanceOfMaterials(await db.materialLedger.toArray()), [], { wood: 0, stone: 0, flower: 0 })
}
