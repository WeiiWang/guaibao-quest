// 圖鑑「我認識的朋友」（SPEC-v5 長期目標 10）：答題時遇過的物件自動收錄。純函式。
import { OBJECTS, type LearnObject } from '../learning/objects'
import type { Question } from '../learning/types'

/** 圖鑑裡的格子（依物件表順序）。en = 英文名稱，英文科目上線後再填 */
export interface Friend {
  id: string
  name: string
  en?: string
}

/** 英文名稱預留：英文科目上線後在這裡補（key = 物件 id） */
export const FRIEND_ENGLISH: Record<string, string> = {}

export const FRIENDS: Friend[] = OBJECTS.map((o: LearnObject) => ({ id: o.id, name: o.name, ...(FRIEND_ENGLISH[o.id] ? { en: FRIEND_ENGLISH[o.id] } : {}) }))
const FRIEND_IDS = new Set(FRIENDS.map((f) => f.id))

/** 一題裡孩子看到的所有物件 id（題幹、選項、拖曳歸類的物件與籃子） */
export function objectsInQuestion(q: Pick<Question, 'items' | 'choices' | 'params'>): string[] {
  const out = new Set<string>()
  for (const it of q.items) if (it.obj) out.add(it.obj)
  for (const c of q.choices) if (c.obj) out.add(c.obj)
  if (q.params?.obj) out.add(q.params.obj)
  for (const b of q.params?.bins ?? []) if (b.obj) out.add(b.obj)
  return [...out].filter((id) => FRIEND_IDS.has(id))
}

/** 從作答過的題目算出認識的朋友 id 集合 */
export function knownFriendIds(questions: Iterable<Pick<Question, 'items' | 'choices' | 'params'>>): Set<string> {
  const known = new Set<string>()
  for (const q of questions) for (const id of objectsInQuestion(q)) known.add(id)
  return known
}

/** 圖鑑總格數 */
export const friendCount = (): number => FRIENDS.length
