// v8 線 O：關卡場景背景。章節（或每日冒險的科目）對應 public/art/scene-stage-<key>.jpg
import { getChapter } from './chapter'
import { CHALLENGE_PREFIX, DAILY_PREFIX, REPLAY_PREFIX, getSubject } from './subject'

export type StageSceneKey = 'huaguoshan' | 'shuiliandong' | 'english' | 'life' | 'nature'
export const STAGE_SCENE_KEYS: readonly StageSceneKey[] = ['huaguoshan', 'shuiliandong', 'english', 'life', 'nature']

const BY_CHAPTER: Record<string, StageSceneKey> = {
  huaguoshan: 'huaguoshan',
  shuiliandong: 'shuiliandong',
  'english-island': 'english',
  'life-town': 'life',
  'nature-forest': 'nature',
}
const BY_SUBJECT: Record<string, StageSceneKey> = { math: 'huaguoshan', english: 'english', life: 'life', nature: 'nature' }

/** 章節 id → 場景 key。每日冒險（daily:<科目>）用該科第一章的場景；挑戰站、重玩用原章節的場景。找不到回傳 null */
export function stageSceneKey(chapterId: string): StageSceneKey | null {
  let id = chapterId
  if (id.startsWith(DAILY_PREFIX)) {
    const s = getSubject(id.slice(DAILY_PREFIX.length))
    return s ? (BY_SUBJECT[s.id] ?? null) : null
  }
  if (id.startsWith(CHALLENGE_PREFIX)) id = id.slice(CHALLENGE_PREFIX.length)
  else if (id.startsWith(REPLAY_PREFIX)) id = id.slice(REPLAY_PREFIX.length)
  return getChapter(id) ? (BY_CHAPTER[id] ?? null) : null
}

/** 場景圖網址（相對於 BASE_URL） */
export const stageSceneFile = (key: StageSceneKey): string => `art/scene-stage-${key}.jpg`
