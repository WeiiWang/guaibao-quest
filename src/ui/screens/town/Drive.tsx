import { GameShell } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'

// 骨架：由對應的線補上玩法
export default function Drive({ onExit }: GameRootProps) {
  return (
    <GameShell id="drive" scene="scene-town-map" intro="pet.play.drive.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
