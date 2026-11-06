import { GameShell } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'

// 骨架：由對應的線補上玩法
export default function Bedtime({ onExit }: GameRootProps) {
  return (
    <GameShell id="bedtime" scene="scene-town-bedroom" intro="pet.play.bedtime.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
