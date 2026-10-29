import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { sortAlbum } from '../../domain/album'
import type { AlbumCard } from '../../domain/types'
import { sayText } from '../../learning/speech'
import { useLearningSettings } from '../learningHooks'
import { ALBUM_EMPTY } from '../../domain/home74'
import { EmptyState } from '../components/EmptyState'
import { MemoryCard } from '../components/MemoryCard'
import { Modal } from '../components/Modal'
import { ScreenHeader } from '../components/Header'
import type { Screen } from '../App'
import '../wardrobe.css'
import { speciesName } from '../../domain/species'

/** 成長相簿：翻閱阿悟的回憶卡。點一張放大，並唸出那一句話 */
export function AlbumScreen({ onBack, go }: { onBack: () => void; go?: (s: Screen) => void }) {
  const { voiceOn } = useLearningSettings()
  const cards = useLiveQuery(() => repo.getAlbum(), [], undefined)
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const petName = pet?.name ?? speciesName(pet?.species)
  const [view, setView] = useState<AlbumCard | null>(null)
  const open = (c: AlbumCard) => {
    setView(c)
    sayText(c.caption, { enabled: voiceOn })
    if (c.fresh) void repo.seeAlbumCard(c.id)
  }
  if (!cards) return <main className="screen theme-bubblegum" data-testid="album"><ScreenHeader title="成長相簿" onBack={onBack} /></main>
  const list = sortAlbum(cards)
  return (
    <main className="screen album theme-bubblegum" data-testid="album">
      <ScreenHeader title="成長相簿" onBack={onBack} />
      {list.length === 0 ? (
        <EmptyState pet={pet} line={ALBUM_EMPTY.line} button={ALBUM_EMPTY.button} onGo={() => (go ? go({ name: 'map' }) : onBack())} testId="album-empty" />
      ) : (
        <p className="al-progress" data-testid="album-count">
          {`${petName}的 ${list.length} 張回憶卡`}
          <small>點一張卡片，聽{speciesName(pet?.species)}說那一天的事</small>
        </p>
      )}
      <ul className="al-grid">
        {list.map((c) => (
          <li key={c.id}>
            <MemoryCard card={c} petName={petName} onClick={() => open(c)} />
          </li>
        ))}
      </ul>
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
