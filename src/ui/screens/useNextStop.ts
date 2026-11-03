import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { CHAPTERS, getChapter } from '../../learning/chapter'
import { nextStopOf, type NextStop } from '../../learning/nextStop'
import { chaptersOf, mustSubject } from '../../learning/subject'
import { readChapter, readSubject } from './adventure/subjectPref'

/**
 * 首頁要顯示的「下一站」：跟著地圖上最後選的科目與章節（沒選過就是數學第 1 章），
 * 章節還沒開放就退回該科第 1 章。讀不到資料（載入中）回傳 undefined。
 */
export function useNextStop(): NextStop | undefined {
  return useLiveQuery(async () => {
    const subject = mustSubject(readSubject())
    const chapters = chaptersOf(subject)
    const picked = getChapter(readChapter(subject.id) ?? '') ?? chapters[0]
    const unlocks = await repo.getChapterUnlocks()
    const ch = chapters.includes(picked) && unlocks[picked.id] !== false ? picked : chapters[0] ?? CHAPTERS[0]
    return nextStopOf(ch, await db.progress.get(ch.id))
  }, [])
}
