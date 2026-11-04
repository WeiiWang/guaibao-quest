import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { FOOD_EMOJI } from '../../../art/items'
import { playSound } from '../../../learning/audioEngine'
import { BUBBLE_GOAL, BUBBLE_TUNE, bubbleMiniCount, bubbleShouldSpawn, bubbleSpec, pickCircle, type BubbleContent, type BubbleSpec } from '../../../domain/playU'
import type { AgeBand } from '../../../domain/types'
import { Icon } from '../../components/Icon'
import { Companion, type Pose } from '../adventure/Companion'
import type { GameRootProps } from './GameScreen'
import { GameShell, type GameProps } from './GameShell'
import { HandHint, petHop, useBand, useFinishLater, useTrackedSay } from './playU'
import './playU.css'
import './bubbles.css'

/** 排程只用一個計時器（不用 rAF，無頭 WebKit 不跑 rAF；也不靠 animationend，同樣的原因）。動作交給 CSS */
const TICK_MS = 200
/** 碎片演多久，到了就從畫面拿掉 */
const FX_MS = 950
const FX_MAX = 24
/** 小泡泡活多久 */
const MINI_MS = 5600
/** 一開始天空就有幾顆，不用等 */
const PRESPAWN = 4
/** 大彩虹泡泡每幾顆說一次「好大」：固定節奏，免得一直念 */
const BIG_SAY_EVERY = 3

interface Live {
  id: number
  spec: BubbleSpec
  born: number
  lifeMs: number
  /** 預先長好的進度（ms）：一開始的幾顆從半空中開始 */
  headStart: number
  /** 小泡泡才有：從哪裡噴出來、往哪裡噴 */
  mini?: { x: number; y: number; dx: number; dy: number }
}

interface Fx {
  id: number
  x: number
  y: number
  born: number
  big: boolean
  /** 裡面的東西往上飛或掉下來（固定交替） */
  up: boolean
  content: BubbleContent
}

function Content({ content }: { content: BubbleContent }) {
  if (content.kind === 'food') return <Icon name={`food-${content.id}`} emoji={FOOD_EMOJI[content.id]} alt="" className="pg-bub-thing" size="100%" />
  if (content.kind === 'star') return <Icon name="ui-star" emoji="⭐" alt="" className="pg-bub-thing" size="100%" />
  return null
}

function BubblesGame({ band, finish, say: rawSay }: GameProps & { band: AgeBand }) {
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const tune = BUBBLE_TUNE[band]
  const goal = BUBBLE_GOAL[band]
  const [bubbles, setBubbles] = useState<Live[]>([])
  const [fx, setFx] = useState<Fx[]>([])
  const [popped, setPopped] = useState(0)
  const [touched, setTouched] = useState(false)
  const [pose, setPose] = useState<Pose>('happy')
  const petRef = useRef<HTMLSpanElement>(null)
  // 真正的狀態在這裡（多指同一瞬間連續進來時不能靠 React 的下一次 render），state 只是拿來畫
  const live = useRef<Live[]>([])
  const fxLive = useRef<Fx[]>([])
  const seq = useRef({ id: 0, n: 0, last: 0, popped: 0, bigs: 0 })

  // 排程：冒新泡泡、收掉飄走的泡泡與演完的碎片。離開畫面就清掉，這是整個玩法唯一的循環計時器
  useEffect(() => {
    const s = seq.current
    const make = (now: number, headStart = 0): Live => {
      const spec = bubbleSpec(s.n++)
      return { id: s.id++, spec, born: now - headStart, lifeMs: tune.riseMs * (spec.big ? 1.15 : 1), headStart }
    }
    const now0 = performance.now()
    s.last = now0
    if (live.current.length === 0) {
      for (let i = 0; i < PRESPAWN; i++) live.current.push(make(now0, tune.riseMs * (0.18 + i * 0.16)))
      setBubbles([...live.current])
    }
    const tick = () => {
      const now = performance.now()
      const keep = live.current.filter((b) => now - b.born < b.lifeMs)
      let changed = keep.length !== live.current.length
      if (bubbleShouldSpawn(keep.length, now - s.last, tune)) {
        const b = make(now)
        keep.push(b)
        s.last = now
        changed = true
        if (b.spec.big && s.bigs++ % BIG_SAY_EVERY === 0) say('pet.play.bubbles.big')
      }
      if (changed) {
        live.current = keep
        setBubbles(keep)
      }
      const fxKeep = fxLive.current.filter((f) => now - f.born < FX_MS)
      if (fxKeep.length !== fxLive.current.length) {
        fxLive.current = fxKeep
        setFx(fxKeep)
      }
    }
    const t = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(t)
  }, [say, tune])

  const pop = useCallback(
    (b: Live, x: number, y: number) => {
      const now = performance.now()
      const s = seq.current
      live.current = live.current.filter((o) => o.id !== b.id)
      if (b.spec.big) {
        // 噴出一圈小泡泡，飛一下再往上飄
        const count = bubbleMiniCount(live.current.length)
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + 0.4
          const spec: BubbleSpec = { ...bubbleSpec(s.n + i), big: false, content: { kind: 'none' } }
          live.current.push({ id: s.id++, spec, born: now, lifeMs: MINI_MS, headStart: 0, mini: { x, y, dx: Math.cos(a), dy: Math.sin(a) } })
        }
      }
      setBubbles([...live.current])
      fxLive.current = [...fxLive.current, { id: s.id++, x, y, born: now, big: b.spec.big, up: b.spec.n % 2 === 0, content: b.spec.content }].slice(-FX_MAX)
      setFx(fxLive.current)
      playSound('pop')
      if (b.spec.big) playSound('sparkle')
      petHop(petRef.current)
      s.popped++
      setPopped(s.popped)
      if (s.popped === goal) {
        say('pet.play.bubbles.done')
        setPose('cheer')
        finishLater()
      }
    },
    [finishLater, goal, say],
  )

  // 每根手指各自判定一次：pointerdown 彼此獨立，不需要記手指
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      setTouched(true)
      const root = rootRef.current
      if (!root) return
      const box = root.getBoundingClientRect()
      const items = live.current
      const circles = items.map((b) => {
        const r = root.querySelector<HTMLElement>(`[data-bubble="${b.id}"]`)?.getBoundingClientRect()
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 } : { x: -9999, y: -9999, r: 0 }
      })
      // 手指比滑鼠寬：真機回報的接觸面積也算進去（上限 20，避免整隻手掌都算）
      const slop = 10 + Math.min(e.width / 2, 20)
      const i = pickCircle(circles, e.clientX, e.clientY, slop)
      if (i >= 0) pop(items[i], circles[i].x - box.left, circles[i].y - box.top)
    },
    [pop, rootRef],
  )

  return (
    <div ref={rootRef} className="pg-bub" data-testid="bubbles" data-band={band} data-popped={popped} data-goal={goal} data-alive={bubbles.length} onPointerDown={onPointerDown} style={{ '--pg-bub-size': `${tune.sizeVmin}vmin` } as CSSProperties}>
      <div className="pg-bub-meter" data-done={popped >= goal} aria-hidden>
        <i style={{ transform: `scaleX(${Math.min(1, popped / goal)})` }} />
      </div>
      <span ref={petRef} className="pg-bub-pet" data-testid="bubbles-pet">
        <Companion pose={pose} size="100%" />
      </span>
      {bubbles.map((b) => {
        const vars = {
          '--x': b.spec.x,
          '--rest-y': b.spec.restY,
          '--sway': `${b.spec.swayMs}ms`,
          '--rise': `${b.lifeMs}ms`,
          animationDelay: b.headStart ? `-${b.headStart}ms` : undefined,
          ...(b.mini ? { left: b.mini.x, top: b.mini.y, '--dx': b.mini.dx, '--dy': b.mini.dy } : null),
        } as CSSProperties
        return (
          <div key={b.id} className={`pg-bub-rise ${b.mini ? 'mini' : ''}`} style={vars}>
            <div className="pg-bub-sway">
              <div className={`pg-bub-ball ${b.spec.big ? 'big' : ''}`} data-bubble={b.id} data-big={b.spec.big || undefined} data-mini={b.mini ? true : undefined}>
                <span className="pg-bub-inside">
                  <Content content={b.spec.content} />
                </span>
              </div>
            </div>
          </div>
        )
      })}
      {fx.map((f) => (
        <div key={f.id} className={`pg-bub-fx ${f.big ? 'big' : ''}`} style={{ left: f.x, top: f.y }} data-testid="bubble-fx" aria-hidden>
          <span className="pg-bub-ring" />
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} style={{ '--a': `${i * 60 + 20}deg` } as CSSProperties} />
          ))}
          {f.content.kind !== 'none' && (
            <span className={`pg-bub-fly ${f.up ? 'up' : 'down'}`}>
              <Content content={f.content} />
            </span>
          )}
        </div>
      ))}
      {!touched && <HandHint mode="tap" className="pg-bub-hand" />}
    </div>
  )
}

export default function Bubbles({ onExit }: GameRootProps) {
  const band = useBand()
  return (
    <GameShell id="bubbles" scene="scene-play-sky" intro="pet.play.bubbles.intro" onExit={onExit}>
      {(p) => <BubblesGame key={band} band={band} {...p} />}
    </GameShell>
  )
}
