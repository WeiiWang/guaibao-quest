import { GameShell } from './GameShell'
import type { GameRootProps } from './GameScreen'

// 骨架：由對應的線補上玩法
export default function Talk({ onExit }: GameRootProps) {
  return (
    <GameShell id="talk" scene="scene-play-music" intro="pet.play.talk.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
