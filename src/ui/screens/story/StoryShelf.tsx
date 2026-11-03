import { useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { STORIES, STORY_CHAPTERS, storyLabel, storyUnlocked, withPrologue, closeId, openId, type StoryId } from '../../../learning/story'
import { playSound } from '../../../learning/audioEngine'
import { Art } from '../../components/Art'
import { ScreenHeader } from '../../components/Header'
import { Icon } from '../../components/Icon'
import { Loading } from '../../components/Loading'
import type { PlayStory } from './useStoryDirector'
import './story.css'

/** 一格書架一組：序章、每章的開場與結尾、終章 */
const SHELVES: readonly (readonly StoryId[])[] = [['prologue'], ...STORY_CHAPTERS.map((c) => [openId(c), closeId(c)]), ['finale']]

/**
 * 故事書架：封面就是故事的第一頁。打得開的點了就演（第一次看任何故事先補序章），
 * 還沒解鎖的是小星的剪影加一個小鎖。沒有倒數、沒有「還差幾本」。
 */
export function StoryShelf({ onBack, play }: { onBack: () => void; play: PlayStory }) {
  const seen = useLiveQuery(async () => (await repo.getSettings())?.storySeen ?? [], [])
  const progs = useLiveQuery(() => db.progress.toArray(), [])
  const [wobble, setWobble] = useState<StoryId | null>(null)
  if (!seen || !progs) return <Loading />

  return (
    <main className="screen ss" data-testid="story-shelf">
      <ScreenHeader title="小星的故事" onBack={onBack} backLabel="回地圖" right={<span aria-hidden />} />
      <div className="ss-shelves">
        {SHELVES.map((group) => (
          <section key={group[0]} className="ss-shelf" data-count={group.length}>
            <div className="ss-books">
              {group.map((id) => {
                const open = storyUnlocked(id, seen, progs)
                const fresh = open && !seen.includes(id)
                const first = STORIES[id][0]
                const cover: CSSProperties = { background: `linear-gradient(180deg, ${first.tint[0]}, ${first.tint[1]})` }
                return (
                  <button
                    key={id}
                    type="button"
                    className={`ss-book ${open ? 'open' : 'locked'} ${wobble === id ? 'wobble' : ''}`}
                    style={cover}
                    data-testid={`story-book-${id}`}
                    data-state={open ? (fresh ? 'new' : 'seen') : 'locked'}
                    aria-disabled={!open}
                    aria-label={open ? `看${storyLabel(id)}` : `${storyLabel(id)}還沒看到`}
                    onClick={() => {
                      if (open) play(withPrologue([id], seen))
                      else {
                        playSound('tap')
                        setWobble(id)
                      }
                    }}
                    onAnimationEnd={() => setWobble((w) => (w === id ? null : w))}
                  >
                    {open ? (
                      <Cover art={first.art} />
                    ) : (
                      <span className="ss-silhouette" aria-hidden>
                        <Art name="ui-xiaoxing" alt="" className="ss-star-shape" />
                        <span className="ss-lock">
                          <Icon name="ui-lock" emoji="🔒" size="100%" />
                        </span>
                      </span>
                    )}
                    {fresh && <i className="ss-new" aria-hidden />}
                    <span className="ss-label">{open ? storyLabel(id) : ''}</span>
                  </button>
                )
              })}
            </div>
            <i className="ss-plank" aria-hidden />
          </section>
        ))}
      </div>
    </main>
  )
}

/** 封面：還沒生成的圖就留底色漸層，不破圖 */
function Cover({ art }: { art: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) return null
  return <img className="ss-cover" src={`${import.meta.env.BASE_URL}art/${art}.jpg`} alt="" loading="lazy" draggable={false} onError={() => setMissing(true)} />
}

/** 地圖上的入口：小星圖示，不識字也看得懂；自動化瀏覽器沒開 gq-story-test 時不顯示（見 StoryEntry 的呼叫端） */
export function StoryEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="ss-entry" onClick={onOpen} data-testid="story-shelf-btn" aria-label="小星的故事">
      <Art name="ui-xiaoxing" alt="" className="ss-entry-star" />
      <span>故事</span>
    </button>
  )
}
