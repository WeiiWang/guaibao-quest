import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo, type PlayOutcome } from '../../../db/repo'
import { playSound } from '../../../learning/audioEngine'
import { STATIC_LINES } from '../../../learning/lines'
import { sayRecorded } from '../../../learning/speech'
import { isTownGame, type PlayGameId } from '../../../domain/playground'
import { toysUnlocked } from '../../../domain/playToys'
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
  /** 回遊樂場（小街的地方回小街） */
  onExit: () => void
  /** 這一回玩完了：今天第一次會送禮物（殼負責演）。可以呼叫很多次，同一天不會重複送 */
  finish: () => void
  /** 寵物說一句話（pet.play.* 的 key） */
  say: (key: string) => void
  /**
   * v8.5 這個遊戲現在有幾個新玩具（0–2，見 domain/playToys.ts）。新玩具卡收掉之後才會變。
   * 遊戲在「下一回合開始」時套用；模式按鈕之類不影響進行中回合的東西可以馬上出現。
   */
  toys: 0 | 1 | 2
}

const STAR_COUNT = 14
/** 沒有禮物也沒有新玩具時的小慶祝要留多久 */
const CHEER_MS = 1400

/** 玩法共用的殼：場景背景、回去按鈕、一進來寵物說怎麼玩、玩完的禮物與新玩具。玩法自己決定畫面裡其他所有東西 */
export function GameShell({ id, scene, intro, children, onExit }: { id: PlayGameId; scene: string; intro: string; onExit: () => void; children: (p: GameProps) => ReactNode }) {
  const say = usePetLine()
  // 還沒讀到存檔是 undefined：先不畫玩法，免得玩法一開始拿到「沒有新玩具」又馬上變
  const plays = useLiveQuery(async () => (await db.settings.get('main'))?.playCount?.[id] ?? 0, [id], undefined)
  // 一張一張排隊：卡還開著時又玩完一次（小菜園連續收成），後面那張等前一張收掉再出來
  const [cards, setCards] = useState<PlayOutcome[]>([])
  const card = cards[0] ?? null
  const [cheer, setCheer] = useState(0)
  // 卡還開著的時候不換：孩子收下卡之後，新玩具才出現在玩法裡
  const [toys, setToys] = useState<0 | 1 | 2 | null>(null)
  const giftArmed = useRef(false)
  const giftShownAt = useRef(0)
  useEffect(() => {
    if (plays !== undefined && !card) setToys(toysUnlocked(plays))
  }, [plays, card])
  useEffect(() => {
    const t = window.setTimeout(() => say(intro), 500)
    return () => window.clearTimeout(t)
  }, [intro, say])
  // 每張卡出現的那一刻：重新計算「0.5 秒內點不掉」，播聲音、寵物介紹
  useEffect(() => {
    if (!card) return
    giftArmed.current = false
    giftShownAt.current = performance.now()
    if (card.toy || card.crowned) playSound('fanfare', { synth: false })
    playSound('reward')
    say(card.toy ? card.toy.line : card.crowned ? 'pet.play.crown' : 'pet.play.reward')
  }, [card, say])
  useEffect(() => {
    if (!cheer) return
    const t = window.setTimeout(() => setCheer(0), CHEER_MS)
    return () => window.clearTimeout(t)
  }, [cheer])
  const finish = useCallback(() => {
    void repo.completePlayGame(id).then((r) => {
      if (!r.foodId && !r.toy && !r.crowned) {
        // 什麼都沒有的那幾次也要有結尾：星星和歡呼，不擋操作、不用點掉
        if (r.plays > 0) {
          setCheer((n) => n + 1)
          playSound('cheer', { synth: false })
        }
        return
      }
      setCards((q) => [...q, r])
    })
  }, [id])
  return (
    <main className="screen place pg-game" data-testid={`play-${id}`} data-toys={toys ?? undefined}>
      <div className="place-backdrop" aria-hidden>
        <div style={{ backgroundImage: `url("${import.meta.env.BASE_URL}art/${scene}.jpg")` }} />
      </div>
      <button className="pg-back" onClick={onExit} aria-label={isTownGame(id) ? '回快樂小街' : '回遊樂場'} data-testid="game-back">
        <span aria-hidden>‹</span>
      </button>
      {toys !== null && children({ onExit, finish, say, toys })}
      {cheer > 0 && (
        <div className="pg-cheer" key={cheer} data-testid="play-cheer" aria-hidden>
          {Array.from({ length: STAR_COUNT }, (_, i) => (
            <i key={i} style={{ '--a': `${(360 / STAR_COUNT) * i}deg`, '--d': `${(i % 3) * 60}ms` } as React.CSSProperties} />
          ))}
        </div>
      )}
      {card && (
        // Companion 本身是 button，外層不能再是 button。
        // 只有卡出現之後才按下的手指算數：連續點擊的玩法，放開手指那一下不會把剛跳出來的卡點掉
        <div
          className="pg-gift"
          role="button"
          tabIndex={0}
          onPointerDown={() => {
            // 再多等一下：狂戳泡泡的孩子下一下馬上就來，還沒看到就關掉了
            giftArmed.current = performance.now() - giftShownAt.current > 500
          }}
          onClick={() => {
            if (giftArmed.current) setCards((q) => q.slice(1))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setCards((q) => q.slice(1))
          }}
          data-testid="play-gift"
          aria-label={card.toy ? `收下新玩具：${card.toy.label}` : '收下禮物'}
        >
          <span className="pg-gift-card" key={card.plays}>
            <Companion pose="happy" size="var(--pg-gift-pet, min(30vmin, 180px))" />
            <span className="pg-gift-items">
              {card.toy && (
                <span className="pg-gift-toy" data-testid="play-toy" data-toy={card.toy.id}>
                  <b>新玩具</b>
                  <Icon name={card.toy.icon} emoji={card.toy.emoji} size={96} alt="" />
                  <em>{card.toy.label}</em>
                </span>
              )}
              {card.crowned && (
                <span className="pg-gift-toy" data-testid="play-crown">
                  <Icon name="ui-crown" emoji="👑" size={96} alt="" />
                </span>
              )}
              {card.foodId && <Icon name={`food-${card.foodId}`} emoji="🎁" size={96} alt="" />}
            </span>
          </span>
        </div>
      )}
    </main>
  )
}
