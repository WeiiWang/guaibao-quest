import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { FOOD_EMOJI } from '../../../art/items'
import { now } from '../../../domain/clock'
import { localDateStr } from '../../../domain/date'
import { JUICE_FRUITS, JUICE_PEEK_MS, JUICE_PER_ROUND, juiceCanAdd, juiceColor, juiceCustomer, juiceMatches, juiceOrder, type JuiceCustomer, type JuiceFruit } from '../../../domain/juice'
import type { AgeBand } from '../../../domain/types'
import { playSound } from '../../../learning/audioEngine'
import { Icon } from '../../components/Icon'
import { Companion, type Pose } from '../adventure/Companion'
import type { GameRootProps } from '../playground/GameScreen'
import { GameShell, type GameProps } from '../playground/GameShell'
import { AgainButton, petHop, reducedMotion, useBand, useFinishLater, useTrackedSay } from '../playground/playU'
import { GestureHint, useTimers } from '../playground/vShared'
import { ArtOr, bop, hitEl, useDragLayer, useFlyers, wiggle } from './yShared'
import '../playground/playU.css'
import './juice.css'

// 果汁攤：動物客人帶著點單泡泡來 → 把水果丟進果汁機 → 按下去轉 → 倒進杯子 → 拿給客人。
// 做錯客人也會喝，只是表情好笑、再點一次。沒有倒數、不扣分；飲料是假裝的，不進背包。

/**
 * 一位客人的狀態：
 * arrive 走過來 → make 做果汁 → blend 果汁機在轉 → ready 杯子滿了 → drink 客人在喝 → (yum 走掉 | funny 再點一次) → done 這回做完
 */
type Phase = 'arrive' | 'make' | 'blend' | 'ready' | 'drink' | 'yum' | 'funny' | 'done'

const WHO_EMOJI: Record<JuiceCustomer, string> = { bear: '🐻', chick: '🐥', cow: '🐮', rabbit: '🐰' }
const WHO_NAME: Record<JuiceCustomer, string> = { bear: '小熊', chick: '小雞', cow: '小牛', rabbit: '小兔子' }

const ARRIVE_MS = 900
const BLEND_MS = 1400
const DRINK_MS = 1100
const LEAVE_MS = 1300
const FUNNY_MS = 1900

function Fruit({ id }: { id: string }) {
  return <Icon name={`food-${id}`} emoji={FOOD_EMOJI[id]} alt="" size="100%" />
}

/** 果汁機缺圖時：透明杯身 + 珊瑚色底座（杯身要透，裡面的果汁才看得到） */
function BlenderArt() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <path d="M20 6h60l-4 58H24z" fill="rgb(220 240 255 / 0.35)" stroke="#9cc7e4" strokeWidth="3" strokeLinejoin="round" />
      <rect x="40" y="2" width="20" height="6" rx="3" fill="#9cc7e4" />
      <path d="M16 64h68l-4 30H20z" fill="#ff8a70" stroke="#e5664c" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="50" cy="79" r="8" fill="#fff3e8" stroke="#e5664c" strokeWidth="3" />
    </svg>
  )
}

/** 杯子缺圖時：透明杯 + 條紋吸管 */
function CupArt() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <path d="M62 4l-8 34" stroke="#ff8fab" strokeWidth="6" strokeLinecap="round" />
      <path d="M62 4l-8 34" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeDasharray="5 6" />
      <path d="M22 28h56l-6 64H28z" fill="rgb(230 245 255 / 0.3)" stroke="#9cc7e4" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}

/** 好笑的表情：頭上冒出轉轉的圈圈和問號（只用 transform 動） */
function Funny() {
  return (
    <span className="jc-funny" aria-hidden data-testid="juice-funny">
      <svg viewBox="0 0 60 60" className="jc-swirl">
        <path d="M30 30m-4 0a4 4 0 1 1 8 0a8 8 0 1 1-16 0a12 12 0 1 1 24 0a16 16 0 1 1-32 0" fill="none" stroke="#8e6cd8" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <b>?</b>
      <b>!</b>
    </span>
  )
}

function Hearts() {
  return (
    <span className="jc-hearts" aria-hidden data-testid="juice-hearts">
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} style={{ '--i': i } as CSSProperties}>
          ♥
        </i>
      ))}
    </span>
  )
}

function JuiceGame({ band, say: rawSay, finish }: GameProps & { band: AgeBand }) {
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const later = useTimers()
  const { fly, layer: flyLayer } = useFlyers(380)
  const [date] = useState(() => localDateStr(now()))
  const [round, setRound] = useState(0)
  /** 這一回第幾位客人（0–2） */
  const [guest, setGuest] = useState(0)
  /** 這一回做好了幾杯（客人開心喝完的） */
  const [served, setServed] = useState(0)
  const who = juiceCustomer(round, guest)
  const order = useMemo(() => juiceOrder(date, round, guest, band), [date, round, guest, band])

  const [phase, setPhase] = useState<Phase>('arrive')
  const phaseNow = useRef<Phase>('arrive')
  const [blender, setBlender] = useState<JuiceFruit[]>([])
  const blenderNow = useRef<JuiceFruit[]>([])
  /** 杯子裡的果汁（倒進去時記下用了哪些水果） */
  const [cup, setCup] = useState<JuiceFruit[] | null>(null)
  const [bubble, setBubble] = useState(true)
  const bubbleT = useRef<number | null>(null)
  const saidPeek = useRef(false)
  const [pose, setPose] = useState<Pose>('happy')
  const [acted, setActed] = useState(false)
  const blenderEl = useRef<HTMLButtonElement>(null)
  const cupEl = useRef<HTMLButtonElement>(null)
  const guestEl = useRef<HTMLButtonElement>(null)
  const petEl = useRef<HTMLDivElement>(null)
  const trayEl = useRef<HTMLDivElement>(null)

  const go = useCallback((p: Phase) => {
    phaseNow.current = p
    setPhase(p)
  }, [])
  const putBlender = (b: JuiceFruit[]) => {
    blenderNow.current = b
    setBlender(b)
  }

  /** 點單泡泡：6–7 歲看 4 秒收起來；其他年齡一直在 */
  const showBubble = useCallback(() => {
    setBubble(true)
    if (band !== '6-7') return
    if (bubbleT.current !== null) window.clearTimeout(bubbleT.current)
    bubbleT.current = window.setTimeout(() => {
      bubbleT.current = null
      setBubble(false)
      if (!saidPeek.current) {
        saidPeek.current = true
        say('pet.play.juice.peek')
      }
    }, JUICE_PEEK_MS)
  }, [band, say])
  useEffect(
    () => () => {
      if (bubbleT.current !== null) window.clearTimeout(bubbleT.current)
    },
    [],
  )

  // 每位客人走過來；到了才開始計泡泡的 4 秒
  useEffect(() => {
    if (phaseNow.current !== 'arrive') return
    const t = window.setTimeout(
      () => {
        if (phaseNow.current === 'arrive') go('make')
        showBubble()
      },
      reducedMotion() ? 0 : ARRIVE_MS,
    )
    return () => window.clearTimeout(t)
  }, [round, guest, go, showBubble])

  // ---------- 水果丟進果汁機 ----------
  const canTouch = () => phaseNow.current === 'arrive' || phaseNow.current === 'make'
  const addFruit = (id: JuiceFruit): boolean => {
    if (!canTouch()) return false
    if (!juiceCanAdd(blenderNow.current)) {
      wiggle(blenderEl.current)
      playSound('drop')
      return false
    }
    putBlender([...blenderNow.current, id])
    setActed(true)
    playSound('pop')
    bop(blenderEl.current?.querySelector('.jc-blender-body'))
    return true
  }
  const drag = useDragLayer<JuiceFruit | 'cup'>({
    enabled: (item) => (item === 'cup' ? phaseNow.current === 'ready' : canTouch()),
    render: (item) => (item === 'cup' ? <CupView fill={cup} /> : <Fruit id={item} />),
    onTap: (item, el) => {
      if (item === 'cup') {
        serve()
        return
      }
      if (addFruit(item)) fly(<Fruit id={item} />, el, blenderEl.current, 64)
    },
    onDrop: (item, x, y) => {
      if (item === 'cup') {
        if (!hitEl(guestEl.current, x, y, 48)) return false
        serve(true)
        return true
      }
      return hitEl(blenderEl.current, x, y) && addFruit(item)
    },
  })

  // ---------- 打果汁 ----------
  const blend = () => {
    if (!canTouch()) return
    const inside = blenderNow.current
    if (!inside.length) {
      // 還沒放水果：晃一下，手勢再示範
      wiggle(blenderEl.current)
      setActed(false)
      return
    }
    go('blend')
    setPose('dance')
    playSound('whoosh')
    say('pet.play.juice.blend')
    later(
      () => {
        setCup(inside)
        putBlender([])
        go('ready')
        setPose('happy')
        playSound('drop')
      },
      reducedMotion() ? 300 : BLEND_MS,
    )
  }

  // ---------- 拿給客人 ----------
  const nextGuest = () => {
    setCup(null)
    if (guest + 1 >= JUICE_PER_ROUND) {
      go('done')
      setPose('cheer')
      playSound('reward')
      say('pet.play.juice.done')
      finishLater()
      return
    }
    setGuest((g) => g + 1)
    setBubble(band !== '6-7')
    go('arrive')
  }

  const serve = (dragged = false) => {
    if (phaseNow.current !== 'ready' || !cup) return
    if (!dragged) fly(<CupView fill={cup} />, cupEl.current, guestEl.current, 96)
    go('drink')
    playSound('pop')
    const ok = juiceMatches(order, cup)
    later(() => {
      setCup(null)
      if (ok) {
        go('yum')
        setServed((n) => n + 1)
        setPose('cheer')
        petHop(petEl.current)
        playSound('correct')
        say('pet.play.juice.yum')
        later(nextGuest, reducedMotion() ? 600 : LEAVE_MS)
      } else {
        go('funny')
        setPose('laugh')
        playSound('sparkle')
        say('pet.play.juice.funny')
        later(
          () => {
            go('make')
            setPose('happy')
            showBubble()
          },
          reducedMotion() ? 900 : FUNNY_MS,
        )
      }
    }, DRINK_MS)
  }

  const tapGuest = () => {
    if (phaseNow.current === 'ready') {
      serve()
      return
    }
    // 想再看一次點單（6–7 歲）：不扣分
    if (canTouch()) {
      showBubble()
      playSound('tap')
    }
  }

  const again = () => {
    setRound((r) => r + 1)
    setGuest(0)
    setServed(0)
    putBlender([])
    setCup(null)
    setPose('happy')
    setBubble(band !== '6-7')
    saidPeek.current = false
    drag.clear()
    go('arrive')
    playSound('pop')
    say('pet.play.juice.intro')
  }

  const trayFirst = useCallback(() => trayEl.current?.querySelector('button') ?? null, [])
  const blenderTarget = useCallback(() => blenderEl.current, [])
  const cupTarget = useCallback(() => cupEl.current, [])
  const guestTarget = useCallback(() => guestEl.current, [])

  const mixing = phase === 'blend' ? juiceColor(blender) : null
  const mood = phase === 'yum' ? 'happy' : phase === 'funny' ? 'funny' : phase === 'drink' ? 'drink' : 'wait'
  const leaving = phase === 'yum'
  const showGuest = phase !== 'done'
  const bubbleOn = bubble && (phase === 'make' || phase === 'blend' || phase === 'ready' || phase === 'arrive')

  return (
    <div
      ref={rootRef}
      className="jc"
      data-testid="juice"
      data-band={band}
      data-phase={phase}
      data-round={round}
      data-guest={guest}
      data-served={served}
      data-who={who}
      data-order={order.join(',')}
      data-blender={blender.join(',')}
    >
      <div className="jc-pet" ref={petEl} data-testid="juice-pet">
        <Companion pose={pose} size="100%" />
      </div>

      <div className="jc-stage">
        {showGuest && (
          <button
            key={`${round}-${guest}`}
            ref={guestEl}
            type="button"
            className="jc-guest"
            data-testid="juice-customer"
            data-who={who}
            data-mood={mood}
            data-leaving={leaving ? '1' : undefined}
            onClick={tapGuest}
            aria-label={WHO_NAME[who]}
          >
            <span className="jc-guest-body">
              <Icon name={`obj-${who}`} emoji={WHO_EMOJI[who]} alt="" size="100%" />
            </span>
            {mood === 'funny' && <Funny />}
            {mood === 'happy' && <Hearts />}
            <span className="jc-bubble" data-testid="juice-bubble" data-shown={bubbleOn ? '1' : '0'} aria-hidden={!bubbleOn}>
              {order.map((f) => (
                <span key={f} className="jc-bubble-fruit" data-testid="juice-order-fruit" data-id={f}>
                  <Fruit id={f} />
                </span>
              ))}
            </span>
          </button>
        )}
        {phase === 'done' && (
          <div className="jc-again">
            <AgainButton onClick={again} />
          </div>
        )}
      </div>

      <div className="jc-counter">
        <div className="jc-tray" ref={trayEl} data-testid="juice-tray">
          {JUICE_FRUITS.map((f) => (
            <button key={f} type="button" className="jc-fruit" data-testid={`juice-fruit-${f}`} aria-label={f} {...drag.bind(f)}>
              <Fruit id={f} />
            </button>
          ))}
        </div>

        <button
          type="button"
          ref={blenderEl}
          className="jc-blender"
          data-testid="juice-blender"
          data-count={blender.length}
          data-spinning={phase === 'blend' ? '1' : '0'}
          onClick={blend}
          aria-label="按下去打果汁"
        >
          <span className="jc-blender-body">
            <span className="jc-jar-juice" style={mixing ? ({ '--jc-juice': mixing } as CSSProperties) : undefined} data-on={mixing ? '1' : '0'} />
            <span className="jc-jar-fruits" data-spin={phase === 'blend' ? '1' : '0'}>
              {blender.map((f, i) => (
                <span key={i} className="jc-jar-fruit" data-testid="juice-blender-fruit" style={{ '--i': i } as CSSProperties}>
                  <Fruit id={f} />
                </span>
              ))}
            </span>
            <ArtOr name="ui-juice-blender" fallback={<BlenderArt />} className="jc-blender-art" />
            <span className="jc-blender-go" data-ready={blender.length && phase !== 'blend' ? '1' : '0'} aria-hidden />
          </span>
        </button>

        <button type="button" ref={cupEl} className="jc-cup" data-testid="juice-cup" data-full={cup ? '1' : '0'} aria-label="果汁" {...drag.bind('cup')}>
          <CupView fill={cup} />
        </button>
      </div>

      {!acted && (phase === 'make' || phase === 'arrive') && <GestureHint from={trayFirst} to={blenderTarget} />}
      {acted && phase === 'make' && blender.length > 0 && served === 0 && guest === 0 && <GestureHint from={blenderTarget} to={blenderTarget} />}
      {phase === 'ready' && served === 0 && guest === 0 && <GestureHint from={cupTarget} to={guestTarget} />}
      {drag.layer}
      {flyLayer}
    </div>
  )
}

/** 杯子（裡面的果汁顏色是水果混出來的） */
function CupView({ fill }: { fill: readonly string[] | null }) {
  const color = fill ? juiceColor(fill) : null
  return (
    <span className="jc-cup-body">
      <span className="jc-cup-juice" data-on={color ? '1' : '0'} style={color ? ({ '--jc-juice': color } as CSSProperties) : undefined} />
      <ArtOr name="ui-juice-cup" fallback={<CupArt />} className="jc-cup-art" />
    </span>
  )
}

export default function Juice({ onExit }: GameRootProps) {
  const band = useBand()
  return (
    <GameShell id="juice" scene="scene-town-juice" intro="pet.play.juice.intro" onExit={onExit}>
      {(p) => <JuiceGame key={band} band={band} {...p} />}
    </GameShell>
  )
}
