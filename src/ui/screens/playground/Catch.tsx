import { GameShell } from './GameShell'
import type { GameRootProps } from './GameScreen'

// 骨架：由對應的線補上玩法
export default function Catch({ onExit }: GameRootProps) {
  return (
    <GameShell id="catch" scene="scene-play-orchard" intro="pet.play.catch.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
