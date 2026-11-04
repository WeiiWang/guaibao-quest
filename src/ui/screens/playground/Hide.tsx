import { GameShell } from './GameShell'
import type { GameRootProps } from './GameScreen'

// 骨架：由對應的線補上玩法
export default function Hide({ onExit }: GameRootProps) {
  return (
    <GameShell id="hide" scene="scene-play-hide" intro="pet.play.hide.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
