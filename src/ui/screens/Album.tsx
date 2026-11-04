import { useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { sortAlbum } from '../../domain/album'
import type { AlbumCard } from '../../domain/types'
import { sayRecorded, sayText } from '../../learning/speech'
import { useLearningSettings } from '../learningHooks'
import { ALBUM_EMPTY } from '../../domain/home74'
import { EmptyState } from '../components/EmptyState'
import { MemoryCard } from '../components/MemoryCard'
import { Modal } from '../components/Modal'
import { ScreenHeader } from '../components/Header'
import { PlaceBackdrop, usePlaceGreeting } from '../components/Place'
import type { Screen } from '../App'
import '../wardrobe.css'
import './places2.css'
import { speciesName } from '../../domain/species'

/** 相片的微傾角度與膠帶顏色：依序號固定，同一張卡每次看都一樣 */
const TILTS = [-2.4, 1.8, 1.2, -1.6, 2.2, -1, -1.9, 1.4]
const TAPES = 3

/** iPad 橫向（同著色板的判斷）：一頁排得下 2×2 */
const LAND_QUERY = '(min-aspect-ratio: 5/4) and (min-width: 760px)'
const subscribeLand = (cb: () => void) => {
  const m = window.matchMedia(LAND_QUERY)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
const useLandscape = () => useSyncExternalStore(subscribeLand, () => window.matchMedia(LAND_QUERY).matches)

/**
 * 打開的相簿：一次一個跨頁（左右兩頁、中間書溝），用手指左右滑或按箭頭翻。
 * 所有卡片都在 DOM 裡（不是翻到才畫），橫向捲動靠瀏覽器原生的 scroll-snap，最簡單也最穩。
 */
function AlbumBook({ list, perPage, petName, onOpen }: { list: AlbumCard[]; perPage: number; petName: string; onOpen: (c: AlbumCard) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)
  const spreads = Math.max(1, Math.ceil(list.length / (perPage * 2)))
  const onScroll = () => {
    const el = ref.current
    if (el) setAt(Math.min(spreads - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth))))
  }
  const turn = (to: number) => {
    const el = ref.current
    if (!el) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ left: to * el.clientWidth, behavior: still ? 'auto' : 'smooth' })
  }
  const slot = (i: number) => {
    const c = list[i]
    return (
      <li key={c?.id ?? `blank-${i}`} className={`pm-book-slot ${c ? '' : 'blank'}`} style={{ '--pm-tilt': `${TILTS[i % TILTS.length]}deg` } as CSSProperties} data-tape={i % TAPES}>
        {c ? <MemoryCard card={c} petName={petName} onClick={() => onOpen(c)} /> : <span className="pm-book-mount" aria-hidden />}
      </li>
    )
  }
  const page = (start: number) => (
    <ul key={start} className="pm-book-page" data-per={perPage}>
      {Array.from({ length: perPage }, (_, k) => slot(start + k))}
    </ul>
  )
  return (
    <div className="pm-book-wrap" data-spreads={spreads}>
      {spreads > 1 && (
        <button className="pm-book-turn prev" onClick={() => turn(at - 1)} disabled={at === 0} aria-label="上一頁" data-testid="album-prev">
          <span aria-hidden>‹</span>
        </button>
      )}
      <div className="pm-book" data-testid="album-book">
        <div className="pm-book-spreads" ref={ref} onScroll={onScroll} data-testid="album-spreads">
          {Array.from({ length: spreads }, (_, s) => (
            <div key={s} className="pm-book-spread">
              {page(s * perPage * 2)}
              {page(s * perPage * 2 + perPage)}
            </div>
          ))}
        </div>
        <i className="pm-book-gutter" aria-hidden />
      </div>
      {spreads > 1 && (
        <div className="pm-book-dots" aria-hidden data-testid="album-page-dots">
          {Array.from({ length: spreads }, (_, s) => (
            <i key={s} className={s === at ? 'on' : ''} />
          ))}
        </div>
      )}
      {spreads > 1 && (
        <button className="pm-book-turn next" onClick={() => turn(at + 1)} disabled={at === spreads - 1} aria-label="下一頁" data-testid="album-next">
          <span aria-hidden>›</span>
        </button>
      )}
    </div>
  )
}

/** 成長相簿：翻閱阿悟的回憶卡。點一張放大，並唸出那一句話 */
export function AlbumScreen({ onBack, go }: { onBack: () => void; go?: (s: Screen) => void }) {
  const { voiceOn } = useLearningSettings()
  const cards = useLiveQuery(() => repo.getAlbum(), [], undefined)
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const petName = pet?.name ?? speciesName(pet?.species)
  const [view, setView] = useState<AlbumCard | null>(null)
  const land = useLandscape()
  // 相簿空的時候 EmptyState 自己會唸邀請的話，不再打招呼（兩句會互相打斷）
  usePlaceGreeting('album', { skip: !cards || cards.length === 0 })
  const open = (c: AlbumCard) => {
    setView(c)
    if (c.kind === 'festival') sayRecorded('play.fest.', c.caption, { enabled: voiceOn })
    else sayText(c.caption, { enabled: voiceOn })
    if (c.fresh) void repo.seeAlbumCard(c.id)
  }
  if (!cards) return <main className="screen place pm-wide pm-album theme-bubblegum" data-testid="album"><PlaceBackdrop place="album" /><ScreenHeader title="成長相簿" onBack={onBack} /></main>
  const list = sortAlbum(cards)
  // 橫向一頁 2×2、直向與手機一頁兩張；卡片少的時候放大一點（一兩張就一頁一張）
  const perPage = list.length <= 2 ? 1 : land && list.length > 4 ? 4 : 2
  return (
    <main className="screen place pm-wide pm-album album theme-bubblegum" data-testid="album">
      <PlaceBackdrop place="album" />
      <ScreenHeader title="成長相簿" onBack={onBack} />
      {list.length === 0 ? (
        <div className="pm-book-wrap">
          <div className="pm-book">
            <EmptyState pet={pet} line={ALBUM_EMPTY.line} button={ALBUM_EMPTY.button} onGo={() => (go ? go({ name: 'map' }) : onBack())} testId="album-empty" />
            <i className="pm-book-gutter" aria-hidden />
          </div>
        </div>
      ) : (
        <>
          <p className="al-progress" data-testid="album-count">
            {`${petName}的 ${list.length} 張回憶卡`}
            <small>點一張卡片，聽{speciesName(pet?.species)}說那一天的事</small>
          </p>
          <AlbumBook key={perPage} list={list} perPage={perPage} petName={petName} onOpen={open} />
        </>
      )}
      {view && (
        <Modal title={view.caption} onClose={() => setView(null)}>
          <div className="al-view" data-testid="album-view">
            <MemoryCard card={view} petName={petName} big />
          </div>
          <button className="btn primary" onClick={() => setView(null)}>好</button>
        </Modal>
      )}
    </main>
  )
}
