import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../../../db/db'
import { hasReadyCrop } from '../../../domain/garden'
import { PLAY_GAMES, type PlayGameId } from '../../../domain/playground'
import { playSound } from '../../../learning/audioEngine'
import { ScreenHeader } from '../../components/Header'
import { Icon } from '../../components/Icon'
import { PlaceBackdrop, usePlaceGreeting } from '../../components/Place'
import { PlaceStand } from '../../components/PlaceStand'
import { usePetLine } from './GameShell'
import { PlayStars } from './PlayStars'
import './playground.css'
import './garden-hint.css'

/** 這次開啟 App 已經提醒過搭公車了 */
let busHinted = false

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** v8.3 遊樂場：大圖示選玩法，不用識字。學我說話要家長開了才出現。v8.4：下面有公車站，搭公車去快樂小街 */
export function PlaygroundScreen({ onBack, onOpen, onTown }: { onBack: () => void; onOpen: (id: PlayGameId) => void; onTown: () => void }) {
  usePlaceGreeting('playground')
  const say = usePetLine()
  const settings = useLiveQuery(async () => (await db.settings.get('main')) ?? null, [])
  const talkOn = !!settings?.talkOn
  const gardenReady = hasReadyCrop(settings?.garden)
  const games = PLAY_GAMES.filter((g) => g.id !== 'talk' || talkOn)
  const [leaving, setLeaving] = useState(false)
  // 還沒去過小街：等打完招呼再提一句（一次開啟只提一次）
  useEffect(() => {
    if (!settings || settings.townVisited || busHinted) return
    const t = window.setTimeout(() => {
      busHinted = true
      say('pet.play.town.hint')
    }, 3500)
    return () => window.clearTimeout(t)
  }, [settings, say])
  const takeBus = () => {
    if (leaving) return
    playSound('tap')
    if (reducedMotion()) return onTown()
    setLeaving(true)
    window.setTimeout(onTown, 700)
  }
  return (
    <main className="screen place pl-spot pg-hub theme-sky">
      <PlaceBackdrop place="playground" />
      <ScreenHeader title="遊樂場" onBack={onBack} />
      <div className="pg-hub-body">
        <div className="pg-grid" data-testid="playground-grid">
          {games.map((g) => (
            <button key={g.id} className={`pg-tile tone-${g.tone}${g.id === 'garden' && gardenReady ? ' pg-gard-ready-hint' : ''}`} onClick={() => onOpen(g.id)} data-testid={`game-${g.id}`} aria-label={g.label}>
              <Icon name={g.icon} emoji={g.emoji} size={96} alt="" />
              <span>{g.label}</span>
              <PlayStars id={g.id} plays={settings?.playCount?.[g.id]} />
            </button>
          ))}
        </div>
        <button className={`pg-bus${leaving ? ' leaving' : ''}${settings && !settings.townVisited ? ' fresh' : ''}`} onClick={takeBus} data-testid="town-bus" aria-label="搭公車去快樂小街">
          <Icon name="ui-town-bus" emoji="🚌" size={96} alt="" />
          <span>搭公車去快樂小街</span>
        </button>
        <PlaceStand floor pose="happy" />
      </div>
    </main>
  )
}
