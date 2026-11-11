import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { FOOD_EMOJI } from '../../../art/items'
import { repo } from '../../../db/repo'
import { CATCH_TUNE, catchAtRim, catchClampBasket, catchEndLine, catchFall, catchHit, catchMagnetX, catchPlan, catchRainPlan, catchRainTune, type CatchDrop } from '../../../domain/playU'
import type { AgeBand } from '../../../domain/types'
import { Icon } from '../../components/Icon'
import { Companion, type Pose } from '../adventure/Companion'
import type { GameRootProps } from './GameScreen'
import { GameShell, type GameProps } from './GameShell'
import { AgainButton, HandHint, petHop, playTracked, reducedMotion, useBand, useFinishLater, useTrackedSay } from './playU'
import './playU.css'
import './catch.css'

/** 開場多久後開始掉（讓寵物先把話說完） */
const START_DELAY_MS = 1800
/** 沒接到的水果滾多久 */
const ROLL_MS = 900
/** 一幀最多算多久：切回來或卡頓時不會一口氣跳完 */
const MAX_STEP_MS = 200
/** rAF 沒在跑（無頭 WebKit、某些省電情況）時，靠這個計時器推進 */
const WATCHDOG_MS = 100
/** 籃子裡最多疊幾顆給你看（多的算在數字裡） */
const PILE_MAX = 6
/** 寵物開心的姿勢維持多久 */
const CHEER_MS = 800
/** v8.5 接到金色水果，畫面亮多久 */
const FLASH_MS = 650

/** v8.5 新水果的圖在 obj-*（原本的水果在 food-*） */
const MORE_ART: Record<string, { name: string; emoji: string }> = {
  strawberry: { name: 'obj-strawberry', emoji: '🍓' },
  orange: { name: 'obj-orange', emoji: '🍊' },
}

function Fruit({ id, size = '100%' }: { id: string; size?: string }) {
  const more = MORE_ART[id]
  return <Icon name={more ? more.name : `food-${id}`} emoji={more ? more.emoji : FOOD_EMOJI[id]} alt="" size={size} />
}

interface EndResult {
  caught: string[]
  /** v8.5 水果雨接到的（不算紀錄） */
  bonus: string[]
  broke: boolean
  best: number
}

type RainState = 'no' | 'wait' | 'falling' | 'done'

function CatchRound({ band, finish, say: rawSay, toys, onAgain }: GameProps & { band: AgeBand; onAgain: () => void }) {
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const tune = CATCH_TUNE[band]
  // 一回一張表：只決定掉哪裡，跟獎勵無關
  const [seed] = useState(() => Date.now() % 1000000)
  // v8.5 新玩具在這一回開始時就定下來：玩到一半收下新玩具卡，正在掉的水果不會變
  const [level] = useState(toys)
  const plan = useMemo(() => catchPlan(band, seed, level), [band, seed, level])
  const rainPlan = useMemo(() => (level >= 2 ? catchRainPlan(seed) : []), [level, seed])
  const [caught, setCaught] = useState<string[]>([])
  const [bonus, setBonus] = useState<string[]>([])
  const [rain, setRain] = useState<RainState>(level >= 2 ? 'wait' : 'no')
  const [flash, setFlash] = useState(0)
  const [missed, setMissed] = useState(0)
  const [end, setEnd] = useState<EndResult | null>(null)
  const [touched, setTouched] = useState(false)
  const [pose, setPose] = useState<Pose>('happy')
  const basketRef = useRef<HTMLDivElement>(null)
  const petRef = useRef<HTMLSpanElement>(null)
  const fruitEls = useRef(new Map<number, HTMLElement>())
  // 籃子中心（0–1）：手指只改這個數字，下一步才畫，一幀裡手指動很多次也只畫一次
  const basketX = useRef(0.5)
  const drag = useRef<{ id: number; offset: number } | null>(null)
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  }, [finish])

  useEffect(() => {
    const root = rootRef.current
    const basket = basketRef.current
    if (!root || !basket) return
    let simT = -START_DELAY_MS
    let last = performance.now()
    let raf = 0
    let over = false
    let alive = true
    let cheerT = 0
    let flashT = 0
    const caughtIds: string[] = []
    const bonusIds: string[] = []
    const reduce = reducedMotion()
    const make = (drop: CatchDrop) => ({ drop, state: 'wait' as 'wait' | 'fall' | 'roll' | 'gone', rollFrom: 0, y: -Infinity, x: drop.x, dir: 1 })
    let fruits = plan.map(make)
    // v8.5 水果雨：主回合掉完才開始；時間從那一刻重新算
    let raining = false
    let t0 = 0
    let fallTune = tune
    let goldSaid = false
    /** 主回合玩完了、禮物還沒送（水果雨還在下，或正在寫紀錄）：這時候離開，禮物照送 */
    let owed = false
    let best: Promise<{ prev: number; broke: boolean }> | null = null

    const place = () => {
      const W = root.clientWidth
      // 水果大小只算一次：跟著畫面短邊走，判定和畫面用同一個數字
      const size = Math.min(104, Math.max(58, Math.min(W, root.clientHeight) * 0.11))
      root.style.setProperty('--pg-catch-f', `${size}px`)
      const half = basket.offsetWidth / 2 / (W || 1)
      basketX.current = catchClampBasket(basketX.current, half)
      basket.style.transform = `translate3d(${basketX.current * W - basket.offsetWidth / 2}px, 0, 0)`
      return { W, half, size }
    }

    const stop = () => {
      cancelAnimationFrame(raf)
      window.clearInterval(watchdog)
    }

    /** 個人紀錄只看主回合的 15 顆，主回合一掉完就記（水果雨接到的不算） */
    const recordBest = () =>
      (best ??= (async () => {
        const prev = (await repo.getSettings())?.playBest?.catch ?? 0
        const broke = await repo.recordPlayBest('catch', caughtIds.length)
        return { prev, broke }
      })())

    const finishRound = () => {
      over = true
      owed = true
      stop()
      const n = caughtIds.length
      void (async () => {
        const { prev, broke } = await recordBest()
        if (!alive) return
        owed = false
        if (raining) setRain('done')
        setEnd({ caught: [...caughtIds], bonus: [...bonusIds], broke, best: Math.max(prev, n) })
        const line = catchEndLine(n, broke)
        if (line) say(line)
        setPose('cheer')
        playTracked(root, 'sparkle')
        finishLater()
      })()
    }

    const startRain = () => {
      raining = true
      owed = true
      void recordBest()
      t0 = simT
      fallTune = catchRainTune(band)
      fruits = rainPlan.map(make)
      setRain('falling')
      say('pet.play.catch.rain')
      playTracked(root, 'whoosh')
    }

    const step = () => {
      const now = performance.now()
      const dt = Math.min(now - last, MAX_STEP_MS)
      last = now
      if (over || document.hidden) return
      simT += dt
      const H = root.clientHeight
      const { W, half, size } = place()
      // 籃口：水果中心碰到這條線就算進籃
      const rimY = basket.offsetTop + basket.offsetHeight * 0.3
      const rimBottom = rimY + basket.offsetHeight * 0.45
      const groundY = H - size * 0.55
      const halfHit = half + size * 0.28 / W
      let remaining = 0
      for (const f of fruits) {
        if (f.state === 'gone') continue
        remaining++
        const el = fruitEls.current.get(f.drop.i)
        if (!el) continue
        if (f.state === 'wait') {
          if (simT - t0 < f.drop.at) continue
          f.state = 'fall'
          el.style.display = 'block'
        }
        if (f.state === 'fall') {
          const fall = catchFall(simT - t0, f.drop, fallTune)
          const y = -size + (groundY + size) * fall
          const prevY = f.y
          f.y = y
          f.x = catchMagnetX(f.drop.x, basketX.current, fall, fallTune)
          const spin = reduce ? 0 : (simT - t0 - f.drop.at) * 0.05 * (f.drop.i % 2 ? 1 : -1)
          el.style.transform = `translate3d(${f.x * W - size / 2}px, ${y - size / 2}px, 0) rotate(${spin}deg)`
          // 水果在籃口這一段高度裡碰到籃子就算接到（從側邊撈也算）；掉到籃子下面就來不及了
          if (catchAtRim(prevY, y, rimY, rimBottom) && catchHit(f.x, basketX.current, halfHit)) {
            f.state = 'gone'
            el.style.display = 'none'
            if (raining) {
              bonusIds.push(f.drop.foodId)
              setBonus([...bonusIds])
            } else {
              caughtIds.push(f.drop.foodId)
              setCaught([...caughtIds])
            }
            playTracked(root, 'drop')
            if (f.drop.gold) {
              root.dataset.gold = String(Number(root.dataset.gold ?? 0) + 1)
              // 金色的：畫面亮一下。一樣只算一顆；台詞一回說一次就好
              playTracked(root, 'sparkle')
              setFlash((n) => n + 1)
              window.clearTimeout(flashT)
              flashT = window.setTimeout(() => setFlash(0), FLASH_MS)
              if (!goldSaid) {
                goldSaid = true
                say('pet.play.catch.gold')
              }
            }
            petHop(petRef.current)
            setPose('cheer')
            window.clearTimeout(cheerT)
            cheerT = window.setTimeout(() => setPose('happy'), CHEER_MS)
          } else if (fall >= 1) {
            f.state = 'roll'
            f.rollFrom = simT
            f.dir = f.x < 0.5 ? -1 : 1
            if (!raining) setMissed((m) => m + 1)
            // 沒接到：彈一下滾走（不是扣分的聲音）
            playTracked(root, 'boing')
          }
        } else if (f.state === 'roll') {
          const p = (simT - f.rollFrom) / ROLL_MS
          if (p >= 1) {
            f.state = 'gone'
            el.style.display = 'none'
          } else if (reduce) {
            el.style.opacity = String(1 - p)
          } else {
            const dist = (0.5 * W + size) * p * (1.2 - 0.2 * p) * f.dir
            el.style.transform = `translate3d(${f.x * W + dist - size / 2}px, ${groundY - size / 2}px, 0) rotate(${p * 540 * f.dir}deg)`
          }
        }
      }
      if (remaining > 0) return
      if (!raining && rainPlan.length > 0) startRain()
      else finishRound()
    }

    const loop = () => {
      step()
      if (!over) raf = requestAnimationFrame(loop)
    }
    const watchdog = window.setInterval(() => {
      if (performance.now() - last > WATCHDOG_MS * 0.9) step()
    }, WATCHDOG_MS)
    raf = requestAnimationFrame(loop)
    place()
    return () => {
      alive = false
      stop()
      window.clearTimeout(cheerT)
      window.clearTimeout(flashT)
      if (owed) {
        owed = false
        finishRef.current()
      }
    }
  }, [band, finishLater, plan, rainPlan, rootRef, say, tune])

  const moveTo = useCallback(
    (clientX: number, offset: number) => {
      const root = rootRef.current
      if (!root) return
      const box = root.getBoundingClientRect()
      basketX.current = (clientX + offset - box.left) / (box.width || 1)
    },
    [rootRef],
  )

  // 只跟第一根手指；它放開後下一根才接手。碰到籃子就保持手指和籃子的相對位置，碰別的地方籃子直接過去
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      setTouched(true)
      if (drag.current) return
      const b = basketRef.current?.getBoundingClientRect()
      const onBasket = !!b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top - 20
      const offset = onBasket && b ? b.left + b.width / 2 - e.clientX : 0
      drag.current = { id: e.pointerId, offset }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* 合成的指標 */
      }
      moveTo(e.clientX, offset)
    },
    [moveTo],
  )
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (drag.current?.id === e.pointerId) moveTo(e.clientX, drag.current.offset)
    },
    [moveTo],
  )
  const onPointerEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }, [])

  // 籃子裡看得到的：主回合接到的加上水果雨接到的
  const inBasket = bonus.length ? [...caught, ...bonus] : caught
  const basketVars = { '--pg-catch-w': `max(${tune.basketMinPx}px, ${tune.basketVmin}vmin)` } as CSSProperties

  return (
    <div
      ref={rootRef}
      className="pg-catch"
      data-testid="catch"
      data-band={band}
      data-caught={caught.length}
      data-missed={missed}
      data-ended={end ? 'true' : 'false'}
      data-rain={rain}
      data-bonus={bonus.length}
      onPointerDown={end ? undefined : onPointerDown}
      onPointerMove={end ? undefined : onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      style={basketVars}
    >
      <span ref={petRef} className="pg-catch-pet" data-testid="catch-pet">
        <Companion pose={pose} size="100%" />
      </span>
      {!end &&
        [...plan, ...rainPlan].map((d) => (
          <div
            key={d.i}
            className={`pg-catch-fruit ${d.gold ? 'gold' : ''}`}
            data-testid={d.i < plan.length ? 'catch-fruit' : 'catch-rain-fruit'}
            data-food={d.foodId}
            data-gold={d.gold || undefined}
            ref={(el) => {
              if (el) fruitEls.current.set(d.i, el)
              else fruitEls.current.delete(d.i)
            }}
          >
            <Fruit id={d.foodId} />
          </div>
        ))}
      <div ref={basketRef} className="pg-catch-basket" data-testid="catch-basket" hidden={!!end}>
        <span className="pg-catch-pile" aria-hidden>
          {inBasket.slice(-PILE_MAX).map((id, i) => (
            <span key={`${id}-${i + Math.max(0, inBasket.length - PILE_MAX)}`} className="pg-catch-pile-one" style={{ '--i': i, '--up': i % 2 } as CSSProperties}>
              <Fruit id={id} />
            </span>
          ))}
        </span>
        <Icon name="ui-play-basket" emoji="🧺" alt="竹籃" size="100%" className="pg-catch-basket-img" />
        {!touched && <HandHint mode="drag" className="pg-catch-hand" />}
      </div>
      {!end && (
        <div className="pg-catch-count" aria-hidden data-testid="catch-count">
          <Fruit id="apple" size="1.3em" />
          <b>{inBasket.length}</b>
        </div>
      )}
      {flash > 0 && <div key={flash} className="pg-catch-flash" data-testid="catch-flash" aria-hidden />}
      {end && (
        <div className="pg-catch-end" data-testid="catch-end" data-caught={end.caught.length} data-broke={end.broke}>
          <div className="pg-catch-end-card">
            <div className="pg-catch-end-pile" data-count={end.caught.length}>
              <div className="pg-catch-end-fruits">
                {[...end.caught, ...end.bonus].map((id, i) => (
                  <span key={i}>
                    <Fruit id={id} />
                  </span>
                ))}
              </div>
              <span className="pg-catch-end-basket">
                <Icon name="ui-play-basket" emoji="🧺" alt="" size="100%" />
              </span>
            </div>
            <div className="pg-catch-end-num" aria-label={`接到 ${end.caught.length} 顆`}>
              <Fruit id="apple" size="0.7em" />
              <b data-testid="catch-end-num">{end.caught.length}</b>
              {end.bonus.length > 0 && (
                <span className="pg-catch-bonus" data-testid="catch-bonus" aria-label={`水果雨多接到 ${end.bonus.length} 顆`}>
                  +{end.bonus.length}
                </span>
              )}
            </div>
            {end.broke && (
              <div className="pg-catch-more" data-testid="catch-more">
                比上次多！
              </div>
            )}
            {!end.broke && band === '6-7' && end.best > 0 && (
              <div className="pg-catch-best" data-testid="catch-best">
                最多 {end.best} 顆
              </div>
            )}
            <AgainButton onClick={onAgain} />
          </div>
        </div>
      )}
    </div>
  )
}

function CatchGame(p: GameProps & { band: AgeBand }) {
  const [round, setRound] = useState(0)
  return <CatchRound key={round} {...p} onAgain={() => setRound((r) => r + 1)} />
}

export default function Catch({ onExit }: GameRootProps) {
  const band = useBand()
  return (
    <GameShell id="catch" scene="scene-play-orchard" intro="pet.play.catch.intro" onExit={onExit}>
      {(p) => <CatchGame key={band} band={band} {...p} />}
    </GameShell>
  )
}
