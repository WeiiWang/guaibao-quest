import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FOOD_EMOJI } from '../../../art/items'
import { db } from '../../../db/db'
import { playSound } from '../../../learning/audioEngine'
import { MEMORY_MATCH_MS, MEMORY_MISS_MS, MEMORY_PET, memoryDeck, memoryFlip, memoryLayout, memorySayMiss, memorySettle, memoryStart } from '../../../domain/playU'
import { speciesEmoji } from '../../../domain/species'
import type { AgeBand } from '../../../domain/types'
import { Art } from '../../components/Art'
import { Icon } from '../../components/Icon'
import { useFirstArt } from '../../artProbe'
import { Companion, companionArt, type Pose } from '../adventure/Companion'
import type { GameRootProps } from './GameScreen'
import { GameShell, type GameProps } from './GameShell'
import { AgainButton, HandHint, petHop, useBand, useFinishLater, useTrackedSay } from './playU'
import './playU.css'
import './memory.css'

const GAP_PX = 10

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

function MemoryBoard({ band, finish, say: rawSay }: GameProps & { band: AgeBand }) {
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const [round, setRound] = useState(0)
  // 洗牌一局一次，只決定排法，跟獎勵無關
  const [game, setGame] = useState(() => memoryStart(memoryDeck(band, Date.now() % 1000000)))
  // 真正的狀態（多指同時翻時，第二根手指要看到第一根的結果，不能等 render）
  const stateRef = useRef(game)
  const settleT = useRef<number | null>(null)
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

  useEffect(
    () => () => {
      if (settleT.current !== null) window.clearTimeout(settleT.current)
    },
    [],
  )

  const commit = (s: typeof game) => {
    stateRef.current = s
    setGame(s)
  }

  const flip = (i: number) => {
    setTouched(true)
    const { state, event } = memoryFlip(stateRef.current, i)
    if (event === 'none') return
    commit(state)
    playSound('page')
    if (event === 'first') return
    if (event === 'miss' && memorySayMiss(state)) say('pet.play.memory.miss')
    if (event === 'match' || event === 'win') {
      playSound('sparkle')
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

  const again = () => {
    if (settleT.current !== null) window.clearTimeout(settleT.current)
    settleT.current = null
    setRound((r) => r + 1)
    commit(memoryStart(memoryDeck(band, Date.now() % 1000000 + round + 1)))
    setPose('happy')
  }

  const won = game.matched.length === game.deck.length
  const layout = size.w && size.h ? memoryLayout(game.deck.length, size.w, size.h, GAP_PX) : null
  const grid = layout ? ({ gridTemplateColumns: `repeat(${layout.cols}, ${layout.cardW}px)`, gridTemplateRows: `repeat(${layout.rows}, ${layout.cardH}px)`, gap: GAP_PX } as CSSProperties) : undefined

  return (
    <div ref={rootRef} className="pg-mem" data-testid="memory" data-band={band} data-won={won} data-cols={layout?.cols} data-rows={layout?.rows}>
      <span ref={petRef} className="pg-mem-pet" data-testid="memory-pet">
        <Companion pose={pose} size="100%" />
      </span>
      <div ref={boardRef} className="pg-mem-board">
        {layout && (
          <div className="pg-mem-grid" style={grid} key={round}>
            {game.deck.map((id, i) => {
              const up = game.up.includes(i)
              const matched = game.matched.includes(i)
              const shown = up || matched
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
