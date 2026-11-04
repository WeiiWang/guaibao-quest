import { GameShell } from './GameShell'
import type { GameRootProps } from './GameScreen'

// 骨架：由對應的線補上玩法
export default function Bakery({ onExit }: GameRootProps) {
  return (
    <GameShell id="bakery" scene="scene-play-bakery" intro="pet.play.bakery.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
