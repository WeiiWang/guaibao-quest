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

const CHAPTER_KEY = 'gq-chapter-'
const chapterNow = new Map<string, string>()

/** 這個科目最後選的章節（從關卡回到地圖時還是同一章）。讀不到就是 null（用第 1 章） */
export function readChapter(subject: SubjectId): string | null {
  const m = chapterNow.get(subject)
  if (m) return m
  try {
    return localStorage.getItem(CHAPTER_KEY + subject)
  } catch {
    return null
  }
}

export function writeChapter(subject: SubjectId, chapterId: string): void {
  chapterNow.set(subject, chapterId)
  try {
    localStorage.setItem(CHAPTER_KEY + subject, chapterId)
  } catch {
    /* ignore */
  }
}
