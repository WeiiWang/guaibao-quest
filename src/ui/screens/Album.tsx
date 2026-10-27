import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { sortAlbum } from '../../domain/album'
import type { AlbumCard } from '../../domain/types'
import { sayText } from '../../learning/speech'
import { useLearningSettings } from '../learningHooks'
import { MemoryCard } from '../components/MemoryCard'
import { Modal } from '../components/Modal'
import { ScreenHeader } from '../components/Header'
import '../wardrobe.css'

/** 成長相簿：翻閱阿悟的回憶卡。點一張放大，並唸出那一句話 */
export function AlbumScreen({ onBack }: { onBack: () => void }) {
  const { voiceOn } = useLearningSettings()
  const cards = useLiveQuery(() => repo.getAlbum(), [], undefined)
  const petName = useLiveQuery(async () => (await db.pets.get('pet'))?.name ?? '阿悟', [], '阿悟')
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
      <p className="al-progress" data-testid="album-count">
        {list.length === 0 ? '還沒有回憶卡' : `${petName}的 ${list.length} 張回憶卡`}
        <small>{list.length === 0 ? '一起冒險、照顧阿悟，回憶卡就會自己出現' : '點一張卡片，聽阿悟說那一天的事'}</small>
      </p>
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
