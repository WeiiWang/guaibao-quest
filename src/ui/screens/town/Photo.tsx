import { GameShell } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'

// 骨架：由對應的線補上玩法
export default function Photo({ onExit }: GameRootProps) {
  return (
    <GameShell id="photo" scene="scene-town-studio" intro="pet.play.photo.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
