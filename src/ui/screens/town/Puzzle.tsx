import { GameShell } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'

// 骨架：由對應的線補上玩法
export default function Puzzle({ onExit }: GameRootProps) {
  return (
    <GameShell id="puzzle" scene="scene-town-toyroom" intro="pet.play.puzzle.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
