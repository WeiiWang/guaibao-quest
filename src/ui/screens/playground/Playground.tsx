import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { PLAY_GAMES, type PlayGameId } from '../../../domain/playground'
import { ScreenHeader } from '../../components/Header'
import { Icon } from '../../components/Icon'
import { PlaceBackdrop, usePlaceGreeting } from '../../components/Place'
import { PlaceStand } from '../../components/PlaceStand'
import './playground.css'

/** v8.3 遊樂場：大圖示選玩法，不用識字。學我說話要家長開了才出現 */
export function PlaygroundScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (id: PlayGameId) => void }) {
  usePlaceGreeting('playground')
  const talkOn = useLiveQuery(async () => !!(await db.settings.get('main'))?.talkOn, [], false)
  const games = PLAY_GAMES.filter((g) => g.id !== 'talk' || talkOn)
  return (
    <main className="screen place pg-hub theme-sky">
      <PlaceBackdrop place="playground" />
      <ScreenHeader title="遊樂場" onBack={onBack} />
      <div className="pg-hub-body">
        <div className="pg-grid" data-testid="playground-grid">
          {games.map((g) => (
            <button key={g.id} className={`pg-tile tone-${g.tone}`} onClick={() => onOpen(g.id)} data-testid={`game-${g.id}`} aria-label={g.label}>
              <Icon name={g.icon} emoji={g.emoji} size={96} alt="" />
              <span>{g.label}</span>
            </button>
          ))}
        </div>
        <PlaceStand floor pose="happy" />
      </div>
    </main>
  )
}
