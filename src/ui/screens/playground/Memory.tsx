import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FOOD_EMOJI, OBJ_EMOJI } from '../../../art/items'
import { db } from '../../../db/db'
import {
  MEMORY_MATCH_MS,
  MEMORY_MISS_MS,
  MEMORY_PEEK_MS,
  MEMORY_PET,
  memoryCanPeek,
  memoryDeck,
  memoryDeckChoices,
  memoryDeckOr,
  memoryFlip,
  memoryLayout,
  memoryPeeks,
  memorySayMiss,
  memorySettle,
  memoryStart,
  type MemoryDeckId,
} from '../../../domain/playU'
import { speciesEmoji } from '../../../domain/species'
import type { AgeBand } from '../../../domain/types'
import { Art } from '../../components/Art'
import { Icon } from '../../components/Icon'
import { useFirstArt } from '../../artProbe'
import { Companion, companionArt, type Pose } from '../adventure/Companion'
import type { GameRootProps } from './GameScreen'
import { GameShell, type GameProps } from './GameShell'
import { AgainButton, HandHint, petHop, playTracked, useBand, useFinishLater, useTrackedSay } from './playU'
import './playU.css'
import './memory.css'

const GAP_PX = 10

/** v8.5 牌組按鈕：大圖示，不用字 */
const DECKS: Record<MemoryDeckId, { icon: string; emoji: string; label: string }> = {
  fruit: { icon: 'food-apple', emoji: '🍎', label: '水果牌' },
  animal: { icon: 'obj-rabbit', emoji: '🐰', label: '動物牌' },
  snack: { icon: 'food-cake', emoji: '🍰', label: '點心牌' },
}

/** 上次選的牌組：只是偏好，記在這台裝置上（跟地圖最後選的科目一樣），不進存檔 */
const DECK_KEY = 'gq-memory-deck'
const readDeck = (): string | null => {
  try {
    return localStorage.getItem(DECK_KEY)
  } catch {
    return null
  }
}
const writeDeck = (deck: MemoryDeckId): void => {
  try {
    localStorage.setItem(DECK_KEY, deck)
  } catch {
    /* 沒有 localStorage（隱私模式）：這次照選的玩，下次回到水果 */
  }
}

/** 牌面上的寵物：孩子自己的寵物（圖沒好就用物種的 emoji 當退路） */
function PetFace() {
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const chosen = useFirstArt(companionArt(pet?.stage ?? 'adult', 'happy', pet?.feedCount ?? 0, pet?.species))
  if (chosen) return <Art name={chosen} alt="" className="pg-mem-art" />
  return (
    <span className="pg-mem-petmoji" aria-hidden>
      {speciesEmoji(pet?.species)}
    </span>
  )
}

function Face({ id }: { id: string }) {
  if (id === MEMORY_PET) return <PetFace />
  // 動物牌的牌面 id 就是圖的名字
  if (id.startsWith('obj-')) return <Icon name={id} emoji={OBJ_EMOJI[id] ?? '🐾'} alt="" className="pg-mem-art" size="100%" />
  return <Icon name={`food-${id}`} emoji={FOOD_EMOJI[id]} alt="" className="pg-mem-art" size="100%" />
}

/** 卡背統一：桃紅色加一顆星 */
function Back() {
  return (
    <svg viewBox="0 0 48 48" className="pg-mem-star" aria-hidden>
      <path d="M24 5l5.700 12.300 13.300 1.600-9.800 9.100 2.600 13.200L24 34.600l-11.800 6.600 2.600-13.200L5 18.900l13.300-1.600z" fill="#fff3b0" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function MemoryBoard({ band, finish, say: rawSay, toys }: GameProps & { band: AgeBand }) {
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const [round, setRound] = useState(0)
  // v8.5 牌組：不選就用上次的；還沒有那個新玩具（或沒有新玩具）就是原本的水果
  const [deck, setDeck] = useState<MemoryDeckId>(() => memoryDeckOr(readDeck(), toys))
  // 洗牌一局一次，只決定排法，跟獎勵無關
  const [game, setGame] = useState(() => memoryStart(memoryDeck(band, Date.now() % 1000000, deck)))
  // 真正的狀態（多指同時翻時，第二根手指要看到第一根的結果，不能等 render）
  const stateRef = useRef(game)
  const settleT = useRef<number | null>(null)
  // v8.5 魔法棒：全部翻開一下。翻開的這段時間不能翻牌
  const [peeking, setPeeking] = useState(false)
  const [peeks, setPeeks] = useState(0)
  const peek = useRef({ on: false, used: 0, timer: null as number | null })
  const [touched, setTouched] = useState(false)
  const [pose, setPose] = useState<Pose>('happy')
  const boardRef = useRef<HTMLDivElement>(null)
  const petRef = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const p = peek.current
    return () => {
      if (settleT.current !== null) window.clearTimeout(settleT.current)
      if (p.timer !== null) window.clearTimeout(p.timer)
    }
  }, [])

  const commit = (s: typeof game) => {
    stateRef.current = s
    setGame(s)
  }

  const flip = (i: number) => {
    setTouched(true)
    if (peek.current.on) return
    const { state, event } = memoryFlip(stateRef.current, i)
    if (event === 'none') return
    commit(state)
    playTracked(rootRef.current, 'page')
    if (event === 'first') return
    if (event === 'miss' && memorySayMiss(state)) say('pet.play.memory.miss')
    if (event === 'match' || event === 'win') {
      playTracked(rootRef.current, 'sparkle')
      petHop(petRef.current)
    }
    if (event === 'match') say('pet.play.memory.match')
    if (event === 'win') {
      say('pet.play.memory.done')
      setPose('cheer')
      finishLater()
    }
    settleT.current = window.setTimeout(
      () => {
        settleT.current = null
        commit(memorySettle(stateRef.current))
      },
      event === 'miss' ? MEMORY_MISS_MS : MEMORY_MATCH_MS,
    )
  }

  /** 重新發一局（用哪一組牌）。偷看的次數也重新算 */
  const deal = (d: MemoryDeckId) => {
    if (settleT.current !== null) window.clearTimeout(settleT.current)
    settleT.current = null
    const p = peek.current
    if (p.timer !== null) window.clearTimeout(p.timer)
    peek.current = { on: false, used: 0, timer: null }
    setPeeking(false)
    setPeeks(0)
    setRound((r) => r + 1)
    commit(memoryStart(memoryDeck(band, Date.now() % 1000000 + round + 1, d)))
    setPose('happy')
  }
  const again = () => deal(deck)

  /** 換牌組：只有還沒翻第一張、或這一局已經翻完時可以換，不會把玩到一半的牌換掉 */
  const pickDeck = (d: MemoryDeckId) => {
    const s = stateRef.current
    const done = s.matched.length === s.deck.length
    const fresh = s.up.length === 0 && s.matched.length === 0
    if (peek.current.on || (!done && !fresh)) return
    if (d === deck && !done) return
    setDeck(d)
    writeDeck(d)
    deal(d)
  }

  const doPeek = () => {
    const p = peek.current
    if (p.on || !memoryCanPeek(stateRef.current, p.used, band)) return
    setTouched(true)
    // 台詞一回說一次（3 歲可以一直按，不要每次都念）
    if (p.used === 0) say('pet.play.memory.peek')
    p.used++
    p.on = true
    setPeeks(p.used)
    setPeeking(true)
    playTracked(rootRef.current, 'sparkle')
    p.timer = window.setTimeout(() => {
      p.timer = null
      p.on = false
      setPeeking(false)
    }, MEMORY_PEEK_MS)
  }

  const won = game.matched.length === game.deck.length
  const fresh = game.up.length === 0 && game.matched.length === 0
  const choices = memoryDeckChoices(toys)
  const canPick = !peeking && (won || fresh)
  const canPeek = !peeking && memoryCanPeek(game, peeks, band)
  const layout = size.w && size.h ? memoryLayout(game.deck.length, size.w, size.h, GAP_PX) : null
  const grid = layout ? ({ gridTemplateColumns: `repeat(${layout.cols}, ${layout.cardW}px)`, gridTemplateRows: `repeat(${layout.rows}, ${layout.cardH}px)`, gap: GAP_PX } as CSSProperties) : undefined

  return (
    <div
      ref={rootRef}
      className={`pg-mem ${toys >= 1 ? 'has-tools' : ''}`}
      data-testid="memory"
      data-band={band}
      data-won={won}
      data-cols={layout?.cols}
      data-rows={layout?.rows}
      data-deck={deck}
      data-peek={peeking}
      data-peeks={peeks}
    >
      <span ref={petRef} className="pg-mem-pet" data-testid="memory-pet">
        <Companion pose={pose} size="100%" />
      </span>
      <div ref={boardRef} className="pg-mem-board">
        {layout && (
          <div className="pg-mem-grid" style={grid} key={round}>
            {game.deck.map((id, i) => {
              const up = game.up.includes(i)
              const matched = game.matched.includes(i)
              const shown = up || matched || peeking
              return (
                <button
                  key={i}
                  type="button"
                  className={`pg-mem-card ${shown ? 'up' : ''} ${matched ? 'matched' : ''}`}
                  data-testid="memory-card"
                  data-face={id}
                  data-state={matched ? 'matched' : up ? 'up' : 'down'}
                  aria-label={shown ? `第 ${i + 1} 張，翻開了` : `第 ${i + 1} 張`}
                  // 用 pointerdown：多指同時碰時，iPad 不一定會補發 click；鍵盤按 Enter 的 click 才另外接（detail 是 0）
                  onPointerDown={(e: ReactPointerEvent) => {
                    e.preventDefault()
                    flip(i)
                  }}
                  onClick={(e) => {
                    if (e.detail === 0) flip(i)
                  }}
                >
                  <span className="pg-mem-inner">
                    <span className="pg-mem-face pg-mem-back">
                      <Back />
                    </span>
                    <span className="pg-mem-face pg-mem-front">
                      <span className="pg-mem-pic">
                        <Face id={id} />
                      </span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {!touched && layout && <HandHint mode="tap" className="pg-mem-hand" />}
      </div>
      {toys >= 1 && (
        <div className="pg-mem-tools" data-testid="memory-tools">
          {/* 魔法棒排第一個：玩到一半牌組按鈕收起來時，它還是待在角落 */}
          {toys >= 2 && (
            <button type="button" className="pg-mem-tool wand" data-testid="memory-peek" aria-label="魔法棒：偷看一下" aria-disabled={!canPeek} data-left={Number.isFinite(memoryPeeks(band)) ? Math.max(0, memoryPeeks(band) - peeks) : 'many'} onClick={doPeek}>
              <span className="pg-mem-tool-pic">
                <Icon name="ui-magic-wand" emoji="🪄" alt="" size="100%" />
              </span>
            </button>
          )}
          {choices.map((d) => (
            <button
              key={d}
              type="button"
              className={`pg-mem-tool ${d === deck ? 'on' : ''} ${canPick ? '' : 'away'}`}
              data-testid={`memory-deck-${d}`}
              aria-label={DECKS[d].label}
              aria-pressed={d === deck}
              disabled={!canPick}
              onClick={() => pickDeck(d)}
            >
              <span className="pg-mem-tool-pic">
                <Icon name={DECKS[d].icon} emoji={DECKS[d].emoji} alt="" size="100%" />
              </span>
            </button>
          ))}
        </div>
      )}
      {won && (
        <div className="pg-mem-again">
          <AgainButton onClick={again} />
        </div>
      )}
    </div>
  )
}

export default function Memory({ onExit }: GameRootProps) {
  const band = useBand()
  return (
    <GameShell id="memory" scene="scene-place-art" intro="pet.play.memory.intro" onExit={onExit}>
      {(p) => <MemoryBoard key={band} band={band} {...p} />}
    </GameShell>
  )
}
