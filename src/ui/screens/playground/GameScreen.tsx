import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'
import type { PlayGameId } from '../../../domain/playground'
import type { Screen } from '../../App'

// 每個玩法各自一塊，不拖慢開機
export interface GameRootProps {
  onExit: () => void
  go: (s: Screen['name'] | Screen) => void
}

const GAMES: Record<PlayGameId, LazyExoticComponent<ComponentType<GameRootProps>>> = {
  bubbles: lazy(() => import('./Bubbles')),
  catch: lazy(() => import('./Catch')),
  memory: lazy(() => import('./Memory')),
  hide: lazy(() => import('./Hide')),
  music: lazy(() => import('./Music')),
  bath: lazy(() => import('./Bath')),
  talk: lazy(() => import('./Talk')),
  bakery: lazy(() => import('./Bakery')),
  garden: lazy(() => import('./Garden')),
}

export function GameScreen({ id, onExit, go }: { id: PlayGameId } & GameRootProps) {
  const Game = GAMES[id]
  return (
    <Suspense fallback={null}>
      <Game onExit={onExit} go={go} />
    </Suspense>
  )
}
