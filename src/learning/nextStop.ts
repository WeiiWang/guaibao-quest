// v8 線 O：首頁「冒險地圖」大按鈕要寫的下一步（下一站的名字）。純函式。
import type { ChapterDef } from './chapter'
import type { Progress } from './types'

export interface NextStop {
  chapterId: string
  chapterName: string
  /** 'station' = 還有站沒過；'chest' = 5 站過了、寶箱還沒開；'again' = 這輪都完成了，可以再玩一輪 */
  kind: 'station' | 'chest' | 'again'
  /** kind = station 時：站序號（1 起算）與名字 */
  index?: number
  stationName?: string
}

/** 這一章接下來要去哪：第一個還沒過的站，沒有就是寶箱，寶箱開了就是再玩一輪 */
export function nextStopOf(ch: ChapterDef, prog: Pick<Progress, 'stations' | 'chestClaimed'> | undefined): NextStop {
  const done = prog ? prog.stations.filter((s) => s.done).length : 0
  if (done < ch.stations.length) {
    const st = ch.stations[done]
    return { chapterId: ch.id, chapterName: ch.name, kind: 'station', index: st.index, stationName: st.name }
  }
  return { chapterId: ch.id, chapterName: ch.name, kind: prog?.chestClaimed ? 'again' : 'chest' }
}
