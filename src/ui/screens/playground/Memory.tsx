import { GameShell } from './GameShell'
import type { GameRootProps } from './GameScreen'

// 骨架：由對應的線補上玩法
export default function Memory({ onExit }: GameRootProps) {
  return (
    <GameShell id="memory" scene="scene-place-art" intro="pet.play.memory.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
