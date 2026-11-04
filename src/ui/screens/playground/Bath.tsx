import { GameShell } from './GameShell'
import type { GameRootProps } from './GameScreen'

// 骨架：由對應的線補上玩法
export default function Bath({ onExit }: GameRootProps) {
  return (
    <GameShell id="bath" scene="scene-play-bath" intro="pet.play.bath.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
