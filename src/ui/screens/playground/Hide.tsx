import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { playSound } from '../../../learning/audioEngine'
import { HIDE_SURPRISE, hideLayout, hidePlan, hideSpotsFor, nextHideSpot, peekLevelAt, saysEmptyLine, shouldWiggle, type HideSpot, type HideSurprise, type PeekLevel } from '../../../domain/hide'
import { speciesEmoji } from '../../../domain/species'
import { Art } from '../../components/Art'
import { Icon } from '../../components/Icon'
import { useFirstArt } from '../../artProbe'
import { useLearnerProfile } from '../../learningHooks'
import { Companion, companionArt } from '../adventure/Companion'
import { GameShell, type GameProps } from './GameShell'
import type { GameRootProps } from './GameScreen'
import { TapHint, useReducedMotion, useTimers } from './wHelpers'
import './pg-hide.css'

export default function Hide({ onExit }: GameRootProps) {
  return (
    <GameShell id="hide" scene="scene-play-hide" intro="pet.play.hide.intro" onExit={onExit}>
      {(p) => <HideGame {...p} />}
    </GameShell>
  )
}

type Phase = 'intro' | 'count' | 'run' | 'seek' | 'found'

// 只有第一輪有開場白要等；之後的輪次「再玩一次」那句話講完就跑
const INTRO_MS = 3200
const COUNT_MS = 2500
const AGAIN_COUNT_MS = 2600
const RUN_MS = 650
/** 找到後先看寵物跳出來、聽牠說話，再送禮物（送禮的台詞會蓋掉前一句） */
const FOUND_FINISH_MS = 1500
/** 同一個躲藏物的驚喜演完前不再觸發 */
const SPOT_COOLDOWN_MS = 800
/** 第一輪這麼久沒點任何東西，就出現手勢示範 */
const HAND_AFTER_MS = 5000

/**
 * 躲著時寵物框的位置（占物件框的百分比）。寵物整隻都在，靠物件自己遮住，所以不會有切一半的頭。
 * 灌木、箱子、木桶、溜滑梯從上面冒出來；大樹、帳篷從旁邊探出來（對著 public/art 的圖校過）。
 */
const PEEK: Record<HideSpot, { w: number; at: Record<1 | 2 | 3, { left: number; top: number }> }> = {
  bush: { w: 56, at: { 1: { left: 22, top: 44 }, 2: { left: 22, top: 36 }, 3: { left: 22, top: 26 } } },
  box: { w: 56, at: { 1: { left: 22, top: 14 }, 2: { left: 22, top: 6 }, 3: { left: 22, top: -4 } } },
  barrel: { w: 52, at: { 1: { left: 24, top: -4 }, 2: { left: 24, top: -10 }, 3: { left: 24, top: -20 } } },
  tree: { w: 40, at: { 1: { left: 41, top: 58 }, 2: { left: 48, top: 58 }, 3: { left: 54, top: 58 } } },
  slide: { w: 40, at: { 1: { left: 14, top: 27 }, 2: { left: 14, top: 19 }, 3: { left: 14, top: 9 } } },
  tent: { w: 40, at: { 1: { left: 60, top: 56 }, 2: { left: 72, top: 56 }, 3: { left: 80, top: 56 } } },
}

function useBoxSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const r = el.getBoundingClientRect()
      setSize((s) => (s && s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

function HideGame({ finish, say }: GameProps) {
  const { ageBand } = useLearnerProfile()
  const spots = useMemo(() => hideSpotsFor(ageBand), [ageBand])
  const plan = hidePlan(ageBand)
  const reduced = useReducedMotion()
  const fieldRef = useRef<HTMLDivElement>(null)
  const size = useBoxSize(fieldRef)
  const rects = useMemo(() => (size ? hideLayout(spots.length, size.w, size.h) : []), [size, spots.length])
  const { after, cancel } = useTimers()

  const [phase, setPhase] = useState<Phase>('intro')
  const [round, setRound] = useState(1)
  const [hiding, setHiding] = useState<HideSpot | null>(null)
  const [misses, setMisses] = useState(0)
  const [peek, setPeek] = useState<PeekLevel>(0)
  const [surprises, setSurprises] = useState<Partial<Record<HideSpot, number>>>({})
  const [showAgain, setShowAgain] = useState(false)
  const [hand, setHand] = useState(false)
  const [saidEmpty, setSaidEmpty] = useState(0)

  // 同一個 tick 裡的多指要立刻看到新狀態（不等重畫），所以判斷都看 ref
  const live = useRef({ phase: 'intro' as Phase, hiding: null as HideSpot | null, misses: 0, tapped: false, cooldown: new Map<HideSpot, number>(), pendingFinish: null as number | null })
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  }, [finish])

  const go = useCallback((p: Phase) => {
    live.current.phase = p
    setPhase(p)
  }, [])

  // 開場 → 數數 → 跑走 → 找
  useEffect(() => {
    const timers: number[] = []
    if (phase === 'intro') timers.push(after(INTRO_MS, () => go('count')))
    else if (phase === 'count') {
      say(round === 1 ? 'pet.play.hide.count' : 'pet.play.hide.again')
      timers.push(
        after(round === 1 ? COUNT_MS : AGAIN_COUNT_MS, () => {
          // 在這裡才決定位置：年齡檔已經載好；跑走的方向不透露躲在哪
          const spot = nextHideSpot(spots, live.current.hiding)
          live.current.hiding = spot
          setHiding(spot)
          go('run')
        }),
      )
    } else if (phase === 'run') {
      timers.push(
        after(RUN_MS, () => {
          setPeek(peekLevelAt(plan, 0))
          go('seek')
        }),
      )
    } else if (phase === 'seek') {
      for (const p of plan.peeks) if (p.afterMs > 0) timers.push(after(p.afterMs, () => setPeek(p.level)))
      if (round === 1 && !live.current.tapped) timers.push(after(HAND_AFTER_MS, () => setHand(true)))
    }
    return () => timers.forEach(cancel)
  }, [phase, round, spots, plan, after, cancel, go, say])

  // 離開時還沒送出的禮物照送：隨時可以離開，不會損失東西
  useEffect(() => {
    const s = live.current
    return () => {
      if (s.pendingFinish !== null) {
        s.pendingFinish = null
        finishRef.current()
      }
    }
  }, [])

  const tap = (spot: HideSpot, el: HTMLElement) => {
    const s = live.current
    if (s.phase !== 'seek') return
    s.tapped = true
    setHand(false)
    const now = performance.now()
    if (spot === s.hiding) {
      go('found')
      playSound('correct')
      say('pet.play.hide.found')
      s.pendingFinish = after(FOUND_FINISH_MS, () => {
        s.pendingFinish = null
        finishRef.current()
        setShowAgain(true)
      })
      return
    }
    if (now < (s.cooldown.get(spot) ?? 0)) return
    s.cooldown.set(spot, now + SPOT_COOLDOWN_MS)
    s.misses++
    const missNo = s.misses
    setMisses(missNo)
    setSurprises((m) => ({ ...m, [spot]: (m[spot] ?? 0) + 1 }))
    playSound('pop')
    if (saysEmptyLine(missNo)) {
      say('pet.play.hide.empty')
      setSaidEmpty((n) => n + 1)
    }
    if (!reduced) el.querySelector('.pg-hide-obj')?.animate?.([{ rotate: '0deg' }, { rotate: '-6deg' }, { rotate: '5deg' }, { rotate: '-3deg' }, { rotate: '0deg' }], { duration: 420, easing: 'ease-out' })
  }

  const again = () => {
    const s = live.current
    if (s.phase !== 'found' || s.pendingFinish !== null) return
    s.misses = 0
    s.cooldown.clear()
    setMisses(0)
    setPeek(0)
    setSurprises({})
    setShowAgain(false)
    setRound((r) => r + 1)
    go('count')
  }

  const wiggle = phase === 'seek' && shouldWiggle(plan, misses)
  // 減少動態時不晃，改用露出來提示：3 歲還是要找得到
  const shownPeek: PeekLevel = phase !== 'seek' ? 0 : wiggle && reduced ? 3 : peek
  const foundAt = hiding ? spots.indexOf(hiding) : -1
  const foundRect = foundAt >= 0 ? rects[foundAt] : undefined

  const petBox: CSSProperties | undefined = (() => {
    if (!size) return undefined
    if (phase === 'found' && foundRect) {
      const s = foundRect.size * 0.92
      return { width: s, height: s, left: foundRect.x + (foundRect.size - s) / 2, top: foundRect.y + foundRect.size - s }
    }
    const s = Math.min(Math.min(size.w, size.h) * 0.55, 320)
    return { width: s, height: s, left: (size.w - s) / 2, top: (size.h - s) / 2 }
  })()

  return (
    <div className="pg-hide" data-testid="pg-hide" data-phase={phase} data-round={round} data-misses={misses} data-peek={shownPeek} data-said-empty={saidEmpty} data-age={ageBand}>
      <div className="pg-hide-field" ref={fieldRef}>
        {rects.length === spots.length &&
          spots.map((spot, i) => {
            const r = rects[i]
            const isHere = spot === hiding && (phase === 'seek' || phase === 'found')
            return (
              <button
                key={spot}
                type="button"
                className={`pg-hide-spot ${isHere && wiggle ? 'is-wiggle' : ''} ${isHere && phase === 'found' ? 'is-found' : ''}`}
                style={{ left: r.x, top: r.y, width: r.size, height: r.size, zIndex: 1 + Math.round(r.y) }}
                onPointerDown={(e) => {
                  if (e.button === 0) tap(spot, e.currentTarget)
                }}
                onClick={(e) => {
                  // 鍵盤（detail 0）；手指與滑鼠在 pointerdown 就處理了
                  if (e.detail === 0) tap(spot, e.currentTarget)
                }}
                aria-label="找找看"
                data-no-tap
                data-testid={`pg-hide-spot-${spot}`}
                data-hiding={isHere ? '1' : undefined}
                data-wiggle={isHere && wiggle ? '1' : undefined}
              >
                <span className="pg-hide-ground" aria-hidden />
                {isHere && shownPeek > 0 && <PeekPet spot={spot} level={shownPeek as 1 | 2 | 3} />}
                <span className="pg-hide-obj">
                  <Icon name={`ui-hide-${spot}`} emoji={SPOT_EMOJI[spot]} alt="" className="pg-hide-obj-img" />
                </span>
                {surprises[spot] ? <Surprise key={surprises[spot]} kind={HIDE_SURPRISE[spot]} onDone={() => setSurprises((m) => ({ ...m, [spot]: undefined }))} /> : null}
                {hand && i === 0 && <TapHint />}
              </button>
            )
          })}

        {(phase === 'intro' || phase === 'count' || phase === 'run' || phase === 'found') && petBox && (
          <div className={`pg-hide-pet is-${phase} ${round % 2 === 0 ? 'to-left' : 'to-right'}`} style={petBox} key={`${phase === 'found' ? 'found' : 'center'}-${round}`} data-testid="pg-hide-pet">
            <Companion pose={phase === 'found' ? 'cheer' : phase === 'count' ? 'shy' : 'happy'} size="100%" />
            {phase === 'found' && (
              <span className="pg-hide-hearts" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
        )}

        {phase === 'count' && (
          <div className="pg-hide-count" key={round} aria-hidden data-testid="pg-hide-count">
            <span>1</span>
            <span>2</span>
            <span>3</span>
          </div>
        )}
      </div>

      {showAgain && phase === 'found' && (
        <button type="button" className="pg-hide-again" onClick={again} data-testid="pg-hide-again">
          <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden>
            <path d="M38 24a14 14 0 1 1-4.5-10.3" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
            <path d="M36 5v11H25z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          再玩一次
        </button>
      )}
    </div>
  )
}

/** 圖還沒生好時的退路 */
const SPOT_EMOJI: Record<HideSpot, string> = { bush: '🌳', box: '📦', barrel: '🛢️', tree: '🌲', slide: '🛝', tent: '⛺' }

/** 躲在物件後面的寵物：框的底部切齊物件底部，往上露出；不切頭，靠物件自己遮住身體 */
function PeekPet({ spot, level }: { spot: HideSpot; level: 1 | 2 | 3 }) {
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const chosen = useFirstArt(companionArt(pet?.stage ?? 'adult', 'idle', pet?.feedCount ?? 0, pet?.species))
  const { w, at } = PEEK[spot]
  const pos = at[level]
  return (
    <span className="pg-hide-peek" aria-hidden data-testid="pg-hide-peek" data-level={level}>
      <span className="pg-hide-peek-pet" style={{ left: `${pos.left}%`, top: `${pos.top}%`, width: `${w}%`, height: `${w}%` }}>
        {chosen ? <Art name={chosen} alt="" className="pg-hide-peek-img" /> : <span className="pg-hide-peek-emoji">{speciesEmoji(pet?.species)}</span>}
      </span>
    </span>
  )
}

/** 點開沒有寵物的驚喜：一個物件一種，用簡單圖形畫，不靠素材 */
function Surprise({ kind, onDone }: { kind: HideSurprise; onDone: () => void }) {
  return (
    <span className={`pg-hide-sur pg-hide-sur-${kind}`} aria-hidden data-testid="pg-hide-surprise" data-kind={kind} onAnimationEnd={(e) => e.target === e.currentTarget && onDone()}>
      {kind === 'bird' && <Bird />}
      {kind === 'butterfly' && <Butterfly />}
      {kind === 'frog' && <Frog />}
      {kind === 'ball' && <Ball />}
      {kind === 'stars' && (
        <>
          <Star fill="#ffd34d" />
          <Star fill="#ff9ec4" />
          <Star fill="#8fd6ff" />
        </>
      )}
      {kind === 'flowers' && (
        <>
          <Flower petal="#ff9ec4" />
          <Flower petal="#fff" />
          <Flower petal="#ffcf5a" />
        </>
      )}
    </span>
  )
}

const Bird = () => (
  <svg viewBox="0 0 64 64">
    <ellipse cx="32" cy="36" rx="18" ry="14" fill="#5db4ef" />
    <circle cx="44" cy="26" r="10" fill="#5db4ef" />
    <circle cx="47" cy="24" r="2.4" fill="#2b2b2b" />
    <path d="M53 26l8 2.5-8 3z" fill="#ffb13d" />
    <path className="pg-hide-wing" d="M30 32C20 18 12 16 6 18c2 10 10 20 24 18z" fill="#3a97d8" />
  </svg>
)
const Butterfly = () => (
  <svg viewBox="0 0 64 64">
    <g className="pg-hide-flap">
      <ellipse cx="20" cy="24" rx="14" ry="16" fill="#ff8cc0" />
      <ellipse cx="44" cy="24" rx="14" ry="16" fill="#ff8cc0" />
      <ellipse cx="22" cy="46" rx="10" ry="11" fill="#ffc44d" />
      <ellipse cx="42" cy="46" rx="10" ry="11" fill="#ffc44d" />
    </g>
    <rect x="29.5" y="14" width="5" height="40" rx="2.5" fill="#5a4a3f" />
  </svg>
)
const Frog = () => (
  <svg viewBox="0 0 64 64">
    <ellipse cx="32" cy="42" rx="24" ry="17" fill="#6cc65a" />
    <circle cx="20" cy="24" r="9" fill="#6cc65a" />
    <circle cx="44" cy="24" r="9" fill="#6cc65a" />
    <circle cx="20" cy="23" r="5" fill="#fff" />
    <circle cx="44" cy="23" r="5" fill="#fff" />
    <circle cx="20" cy="23" r="2.5" fill="#2b2b2b" />
    <circle cx="44" cy="23" r="2.5" fill="#2b2b2b" />
    <path d="M20 44q12 8 24 0" fill="none" stroke="#3b8a2e" strokeWidth="3" strokeLinecap="round" />
  </svg>
)
const Ball = () => (
  <svg viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="28" fill="#ff6b6b" />
    <path d="M32 4a28 28 0 0 1 0 56 44 44 0 0 0 0-56z" fill="#ffd34d" />
    <path d="M6 24h52v16H6z" fill="#fff" opacity="0.65" />
    <circle cx="32" cy="32" r="7" fill="#5db4ef" />
  </svg>
)
const Star = ({ fill }: { fill: string }) => (
  <svg viewBox="0 0 64 64">
    <path d="M32 5l8 18 20 2-15 13 4 20-17-10-17 10 4-20L4 25l20-2z" fill={fill} stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
  </svg>
)
const Flower = ({ petal }: { petal: string }) => (
  <svg viewBox="0 0 64 64">
    <circle cx="32" cy="14" r="12" fill={petal} />
    <circle cx="50" cy="28" r="12" fill={petal} />
    <circle cx="43" cy="49" r="12" fill={petal} />
    <circle cx="21" cy="49" r="12" fill={petal} />
    <circle cx="14" cy="28" r="12" fill={petal} />
    <circle cx="32" cy="33" r="10" fill="#ffb13d" />
  </svg>
)
