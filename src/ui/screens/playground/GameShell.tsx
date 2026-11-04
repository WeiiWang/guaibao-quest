import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { repo } from '../../../db/repo'
import { playSound } from '../../../learning/audioEngine'
import { STATIC_LINES } from '../../../learning/lines'
import { sayRecorded } from '../../../learning/speech'
import type { PlayGameId } from '../../../domain/playground'
import { Icon } from '../../components/Icon'
import { Companion } from '../adventure/Companion'
import { placeVoiceOn } from '../../feelFlags'
import { useLearningSettings } from '../../learningHooks'
import './playground.css'

/** 寵物說一句遊樂場的預錄台詞（key 是 lines.ts 的 pet.play.*）。只播預錄、沒錄就安靜；自動化瀏覽器要設 gq-place-test 才出聲 */
export function usePetLine() {
  const { voiceOn } = useLearningSettings()
  return useCallback(
    (key: string) => {
      if (!voiceOn || !placeVoiceOn()) return
      const line = STATIC_LINES[key]
      if (typeof line === 'string') sayRecorded('pet.', line, { enabled: true })
    },
    [voiceOn],
  )
}

/** 每個玩法元件拿到的東西 */
export interface GameProps {
  /** 回遊樂場 */
  onExit: () => void
  /** 這一回玩完了：今天第一次會送禮物（殼負責演）。可以呼叫很多次，同一天不會重複送 */
  finish: () => void
  /** 寵物說一句話（pet.play.* 的 key） */
  say: (key: string) => void
}

/** 玩法共用的殼：場景背景、回去按鈕、一進來寵物說怎麼玩、玩完的禮物。玩法自己決定畫面裡其他所有東西 */
export function GameShell({ id, scene, intro, children, onExit }: { id: PlayGameId; scene: string; intro: string; onExit: () => void; children: (p: GameProps) => ReactNode }) {
  const say = usePetLine()
  const [gift, setGift] = useState<string | null>(null)
  useEffect(() => {
    const t = window.setTimeout(() => say(intro), 500)
    return () => window.clearTimeout(t)
  }, [intro, say])
  const finish = useCallback(() => {
    void repo.finishPlayGame(id).then((foodId) => {
      if (!foodId) return
      setGift(foodId)
      playSound('reward')
      say('pet.play.reward')
    })
  }, [id, say])
  return (
    <main className="screen place pg-game" data-testid={`play-${id}`}>
      <div className="place-backdrop" aria-hidden>
        <div style={{ backgroundImage: `url("${import.meta.env.BASE_URL}art/${scene}.jpg")` }} />
      </div>
      <button className="pg-back" onClick={onExit} aria-label="回遊樂場" data-testid="game-back">
        <span aria-hidden>‹</span>
      </button>
      {children({ onExit, finish, say })}
      {gift && (
        // 裡面的 Companion 本身是 <button>，外層不能再是 <button>
        <div
          className="pg-gift"
          role="button"
          tabIndex={0}
          onClick={() => setGift(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setGift(null)
          }}
          data-testid="play-gift"
          aria-label="收下禮物"
        >
          <span className="pg-gift-card">
            <Companion pose="happy" size="min(30vmin, 180px)" />
            <Icon name={gift} emoji="🎁" size={96} alt="" />
          </span>
        </div>
      )}
    </main>
  )
}
