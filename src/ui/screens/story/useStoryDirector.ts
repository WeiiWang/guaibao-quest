import { useCallback, useRef, useState } from 'react'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { storiesBeforeStage, storyChapterOf, type StoryId } from '../../../learning/story'
import { storyOn } from '../../feelFlags'

export interface StoryPlay {
  ids: StoryId[]
  /** 演完（或跳過）之後要做的事：進站、回書架 */
  after?: () => void
}

export type PlayStory = (ids: readonly StoryId[], after?: () => void) => void

/** App 用：目前在演哪些故事。畫面狀態不動，播放器蓋在上面，演完才執行 after（所以底下的寶箱畫面不會被重置） */
export function useStoryDirector() {
  const [play, setPlay] = useState<StoryPlay | null>(null)
  const playRef = useRef<StoryPlay | null>(null)

  const start: PlayStory = useCallback((ids, after) => {
    if (ids.length === 0) {
      after?.()
      return
    }
    const next = { ids: [...ids], after }
    playRef.current = next
    setPlay(next)
  }, [])

  const close = useCallback(() => {
    const cur = playRef.current
    playRef.current = null
    setPlay(null)
    cur?.after?.()
  }, [])

  /**
   * 要進關卡之前：第一次進某章第一站要先演開場（演完才進站）。
   * 回傳 true = 接手了，enter 由這裡呼叫；false = 跟故事無關，呼叫端照舊立刻進站（自動化瀏覽器、其他站、重玩都走這條）。
   */
  const beforeStage = useCallback(
    (chapterId: string, station: number, enter: () => void): boolean => {
      if (!storyOn() || station !== 1 || !storyChapterOf(chapterId)) return false
      void (async () => {
        let ids: StoryId[] = []
        try {
          const [settings, prog] = await Promise.all([repo.getSettings(), db.progress.get(chapterId)])
          ids = storiesBeforeStage(chapterId, station, settings?.storySeen ?? [], prog)
        } catch {
          /* 讀不到就不演，孩子照常進站 */
        }
        start(ids, enter)
      })()
      return true
    },
    [start],
  )

  return { play, start, close, beforeStage }
}
