import { GameShell } from './GameShell'
import type { GameRootProps } from './GameScreen'

// 骨架：由對應的線補上玩法
export default function Music({ onExit }: GameRootProps) {
  return (
    <GameShell id="music" scene="scene-play-music" intro="pet.play.music.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
