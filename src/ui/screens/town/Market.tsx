import { GameShell } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'

// 骨架：由對應的線補上玩法
export default function Market({ onExit }: GameRootProps) {
  return (
    <GameShell id="market" scene="scene-town-market" intro="pet.play.market.intro" onExit={onExit}>
      {() => null}
    </GameShell>
  )
}
