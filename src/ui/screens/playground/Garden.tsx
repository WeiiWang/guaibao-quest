import { GameShell } from './GameShell'
import type { GameRootProps } from './GameScreen'

// 骨架：由對應的線補上玩法
export default function Garden({ onExit }: GameRootProps) {
  return (
    <GameShell id="garden" scene="scene-play-garden" intro="pet.play.garden.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
