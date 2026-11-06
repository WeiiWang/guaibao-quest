import { GameShell } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'

// 骨架：由對應的線補上玩法
export default function Juice({ onExit }: GameRootProps) {
  return (
    <GameShell id="juice" scene="scene-town-juice" intro="pet.play.juice.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
