import { useEffect } from 'react'
import { repo } from '../../../db/repo'
import { TOWN_GAMES, type PlayGameId } from '../../../domain/playground'
import { ScreenHeader } from '../../components/Header'
import { Icon } from '../../components/Icon'
import { PlaceBackdrop, usePlaceGreeting } from '../../components/Place'
import { PlaceStand } from '../../components/PlaceStand'
import { PlayStars, usePlayCounts } from '../playground/PlayStars'
import './town.css'

/** v8.4 快樂小街：一條街上 8 棟小建築，點了走進去。不用識字（建築本身就是圖） */
export function TownScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (id: PlayGameId) => void }) {
  usePlaceGreeting('town')
  const counts = usePlayCounts()
  useEffect(() => {
    void repo.markTownVisited()
  }, [])
  return (
    <main className="screen place pl-spot town-hub theme-sky" data-testid="town">
      <PlaceBackdrop place="town" />
      <ScreenHeader title="快樂小街" onBack={onBack} backLabel="← 遊樂場" />
      <div className="town-body">
        <div className="town-street" data-testid="town-grid">
          {TOWN_GAMES.map((g) => (
            <button key={g.id} className={`town-house tone-${g.tone}`} onClick={() => onOpen(g.id)} data-testid={`game-${g.id}`} aria-label={g.label}>
              <Icon name={g.icon} emoji={g.emoji} size={120} alt="" />
              <span>{g.label}</span>
              <PlayStars id={g.id} plays={counts[g.id]} />
            </button>
          ))}
        </div>
        <PlaceStand floor pose="happy" />
      </div>
    </main>
  )
}
