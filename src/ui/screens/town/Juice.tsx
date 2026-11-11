import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { FOOD_EMOJI } from '../../../art/items'
import { now } from '../../../domain/clock'
import { localDateStr } from '../../../domain/date'
import {
  JUICE_DECOS,
  JUICE_PEEK_MS,
  JUICE_PER_ROUND,
  isNewFruit,
  juiceCanAdd,
  juiceCanDeco,
  juiceColor,
  juiceCustomer,
  juiceFruits,
  juiceMatches,
  juiceOrder,
  type JuiceCustomer,
  type JuiceDeco,
  type JuiceFruit,
} from '../../../domain/juice'
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
// v8.5 新玩具（下一回開始才套用）：toys >= 1 水果盤和點單多草莓、橘子；
//   toys >= 2 倒好之後水果盤換成裝飾（吸管、小雨傘、冰塊），拖或點到杯子上，有加的話客人更開心，不加也可以直接給。

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

const NEW_FRUIT_EMOJI: Record<string, string> = { strawberry: '🍓', orange: '🍊' }

/** 水果的圖：原本 5 種是 food-*，草莓和橘子是 obj-* */
function Fruit({ id }: { id: string }) {
  if (isNewFruit(id)) return <Icon name={`obj-${id}`} emoji={NEW_FRUIT_EMOJI[id]} alt="" size="100%" />
  return <Icon name={`food-${id}`} emoji={FOOD_EMOJI[id]} alt="" size="100%" />
}

const DECO_NAME: Record<JuiceDeco, string> = { straw: '吸管', umbrella: '小雨傘', ice: '冰塊' }
/** 拖的東西：水果、杯子、裝飾（加 deco: 開頭，跟水果的名字分開） */
type DragItem = JuiceFruit | 'cup' | `deco:${JuiceDeco}`
const decoOf = (item: DragItem): JuiceDeco | null => (item.startsWith('deco:') ? (item.slice(5) as JuiceDeco) : null)

/** 裝飾缺圖時自己畫：綠白條紋的吸管、小雨傘、兩顆冰塊 */
function DecoFallback({ id }: { id: JuiceDeco }) {
  if (id === 'straw')
    return (
      <svg viewBox="0 0 100 100" aria-hidden>
        <path d="M30 92L52 22l26-10" fill="none" stroke="#5cc98f" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M30 92L52 22l26-10" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="butt" strokeLinejoin="round" strokeDasharray="9 11" />
      </svg>
    )
  if (id === 'umbrella')
    return (
      <svg viewBox="0 0 100 100" aria-hidden>
        <path d="M50 30v62" stroke="#b5835a" strokeWidth="5" strokeLinecap="round" />
        <path d="M8 42C14 16 34 6 50 6s36 10 42 36c-8-6-14-6-21 0-7-6-14-6-21 0-7-6-14-6-21 0-7-6-13-6-21 0z" fill="#ff8fab" stroke="#e0587e" strokeWidth="3" strokeLinejoin="round" />
        <path d="M50 6c-8 10-12 22-13 36M50 6c8 10 12 22 13 36" fill="none" stroke="#ffd1dc" strokeWidth="3" />
        <circle cx="50" cy="6" r="4" fill="#ffd257" />
      </svg>
    )
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <rect x="10" y="38" width="42" height="42" rx="9" fill="rgb(214 240 255 / 0.9)" stroke="#8fd3ff" strokeWidth="4" transform="rotate(-10 31 59)" />
      <rect x="48" y="24" width="40" height="40" rx="9" fill="rgb(232 247 255 / 0.92)" stroke="#8fd3ff" strokeWidth="4" transform="rotate(12 68 44)" />
      <path d="M20 52l8-6M58 38l8-5" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}

function Deco({ id }: { id: JuiceDeco }) {
  return <ArtOr name={`ui-juice-${id}`} fallback={<DecoFallback id={id} />} className="jc-deco-art" />
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

/** 客人開心的愛心。more = 果汁有裝飾：愛心多一圈、還有小星星 */
function Hearts({ more }: { more: boolean }) {
  return (
    <span className="jc-hearts" aria-hidden data-testid="juice-hearts" data-more={more ? '1' : '0'}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} style={{ '--i': i } as CSSProperties}>
          ♥
        </i>
      ))}
      {more &&
        [0, 1, 2, 3, 4].map((i) => (
          <i key={`s${i}`} className="jc-star" data-testid="juice-star" style={{ '--i': i + 0.5 } as CSSProperties}>
            ★
          </i>
        ))}
    </span>
  )
}

function JuiceGame({ band, say: rawSay, finish, toys }: GameProps & { band: AgeBand }) {
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
  // 這一回開始時有幾個新玩具：新水果和裝飾下一回才出現，不在做果汁做到一半時換
  const [roundToys, setRoundToys] = useState(toys)
  const fruits = juiceFruits(roundToys)
  const canDeco = roundToys >= 2
  const who = juiceCustomer(round, guest)
  const order = useMemo(() => juiceOrder(date, round, guest, band, roundToys), [date, round, guest, band, roundToys])
  /** 杯子上加了哪些裝飾 */
  const [deco, setDeco] = useState<JuiceDeco[]>([])
  const decoNow = useRef<JuiceDeco[]>([])
  /** 客人喝的那一杯有沒有裝飾（有的話反應更開心） */
  const [fancy, setFancy] = useState(false)
  const saidDeco = useRef(false)
  const putDeco = (d: JuiceDeco[]) => {
    decoNow.current = d
    setDeco(d)
  }

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
  // ---------- 裝飾（倒好之後、給客人之前；不加也可以） ----------
  const addDeco = (d: JuiceDeco): boolean => {
    if (phaseNow.current !== 'ready' || !juiceCanDeco(decoNow.current, d)) return false
    putDeco([...decoNow.current, d])
    // 冰塊掉進果汁是水聲（音檔還沒載好時退回原本的聲音）
    if (d === 'ice') void (playSound('splash') || playSound('drop'))
    else playSound('pop')
    bop(cupEl.current)
    return true
  }

  const drag = useDragLayer<DragItem>({
    enabled: (item) => {
      const d = decoOf(item)
      if (d) return phaseNow.current === 'ready' && juiceCanDeco(decoNow.current, d)
      return item === 'cup' ? phaseNow.current === 'ready' : canTouch()
    },
    render: (item) => {
      const d = decoOf(item)
      if (d) return <Deco id={d} />
      return item === 'cup' ? <CupView fill={cup} deco={deco} /> : <Fruit id={item} />
    },
    onTap: (item, el) => {
      const d = decoOf(item)
      if (d) {
        if (addDeco(d)) fly(<Deco id={d} />, el, cupEl.current, 64)
        return
      }
      if (item === 'cup') {
        serve()
        return
      }
      if (addFruit(item as JuiceFruit)) fly(<Fruit id={item} />, el, blenderEl.current, 64)
    },
    onDrop: (item, x, y) => {
      const d = decoOf(item)
      if (d) return hitEl(cupEl.current, x, y) && addDeco(d)
      if (item === 'cup') {
        if (!hitEl(guestEl.current, x, y, 48)) return false
        serve(true)
        return true
      }
      return hitEl(blenderEl.current, x, y) && addFruit(item as JuiceFruit)
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
        putDeco([])
        go('ready')
        setPose('happy')
        // 倒果汁是水聲（音檔還沒載好時退回原本的聲音）
        void (playSound('splash') || playSound('drop'))
        // 有裝飾可以加：第一次倒好時寵物提一句
        if (canDeco && !saidDeco.current) {
          saidDeco.current = true
          say('pet.play.juice.deco')
        }
      },
      reducedMotion() ? 300 : BLEND_MS,
    )
  }

  // ---------- 拿給客人 ----------
  const nextGuest = () => {
    setCup(null)
    putDeco([])
    setFancy(false)
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
    const decorated = decoNow.current.length > 0
    if (!dragged) fly(<CupView fill={cup} deco={decoNow.current} />, cupEl.current, guestEl.current, 96)
    go('drink')
    playSound('pop')
    const ok = juiceMatches(order, cup)
    later(() => {
      setCup(null)
      putDeco([])
      if (ok) {
        go('yum')
        setServed((n) => n + 1)
        setPose('cheer')
        petHop(petEl.current)
        playSound('correct')
        // 有裝飾：客人更開心（多一圈愛心和星星、歡呼）
        setFancy(decorated)
        if (decorated) playSound('cheer')
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
    putDeco([])
    setFancy(false)
    // 新玩具在這裡才套用：收下新玩具卡之後的下一回
    setRoundToys(toys)
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
            data-fancy={mood === 'happy' && fancy ? '1' : '0'}
            data-leaving={leaving ? '1' : undefined}
            onClick={tapGuest}
            aria-label={WHO_NAME[who]}
          >
            <span className="jc-guest-body">
              <Icon name={`obj-${who}`} emoji={WHO_EMOJI[who]} alt="" size="100%" />
            </span>
            {mood === 'funny' && <Funny />}
            {mood === 'happy' && <Hearts more={fancy} />}
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
        {canDeco && phase === 'ready' ? (
          // 倒好了：水果盤換成裝飾盤（位置一樣，不會擠到別的東西）
          <div className="jc-tray jc-decos" data-testid="juice-decos">
            {JUICE_DECOS.map((d) => (
              <button key={d} type="button" className="jc-fruit jc-deco" data-testid={`juice-deco-${d}`} data-used={deco.includes(d) ? '1' : '0'} aria-label={DECO_NAME[d]} {...drag.bind(`deco:${d}`)}>
                <Deco id={d} />
              </button>
            ))}
          </div>
        ) : (
          <div className="jc-tray" ref={trayEl} data-testid="juice-tray" data-count={fruits.length}>
            {fruits.map((f) => (
              <button key={f} type="button" className="jc-fruit" data-testid={`juice-fruit-${f}`} aria-label={f} {...drag.bind(f)}>
                <Fruit id={f} />
              </button>
            ))}
          </div>
        )}

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

        <button type="button" ref={cupEl} className="jc-cup" data-testid="juice-cup" data-full={cup ? '1' : '0'} data-deco={deco.join(',')} aria-label="果汁" {...drag.bind('cup')}>
          <CupView fill={cup} deco={deco} />
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
function CupView({ fill, deco = [] }: { fill: readonly string[] | null; deco?: readonly JuiceDeco[] }) {
  const color = fill ? juiceColor(fill) : null
  return (
    <span className="jc-cup-body">
      <span className="jc-cup-juice" data-on={color ? '1' : '0'} style={color ? ({ '--jc-juice': color } as CSSProperties) : undefined} />
      <ArtOr name="ui-juice-cup" fallback={<CupArt />} className="jc-cup-art" />
      {deco.map((d) => (
        <span key={d} className={`jc-cup-deco jc-cup-deco-${d}`} data-testid="juice-cup-deco" data-id={d}>
          <Deco id={d} />
        </span>
      ))}
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
