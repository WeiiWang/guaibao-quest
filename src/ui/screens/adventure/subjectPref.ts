import { DEFAULT_SUBJECT, getSubject } from '../../../learning/subject'
import type { SubjectId } from '../../../learning/types'

const KEY = 'gq-subject'
let current: SubjectId | null = null

/** 地圖上最後選的科目（從關卡回到地圖時還是同一個科目）。存在 localStorage，讀不到就用數學 */
export function readSubject(): SubjectId {
  if (current) return current
  try {
    const v = localStorage.getItem(KEY)
    const s = v ? getSubject(v) : undefined
    if (s) return (current = s.id)
  } catch {
    /* 沒有 localStorage（隱私模式）就只記在記憶體 */
  }
  return DEFAULT_SUBJECT
}

export function writeSubject(id: SubjectId): void {
  current = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
}
