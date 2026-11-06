import { GameShell } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'

// 骨架：由對應的線補上玩法
export default function Blocks({ onExit }: GameRootProps) {
  return (
    <GameShell id="blocks" scene="scene-town-build" intro="pet.play.blocks.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
