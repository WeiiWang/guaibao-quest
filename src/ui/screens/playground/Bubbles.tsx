import { GameShell } from './GameShell'
import type { GameRootProps } from './GameScreen'

// 骨架：由對應的線補上玩法
export default function Bubbles({ onExit }: GameRootProps) {
  return (
    <GameShell id="bubbles" scene="scene-play-sky" intro="pet.play.bubbles.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
