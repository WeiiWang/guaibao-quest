import { GameShell } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'

// 骨架：由對應的線補上玩法
export default function Doctor({ onExit }: GameRootProps) {
  return (
    <GameShell id="doctor" scene="scene-town-clinic" intro="pet.play.doctor.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
