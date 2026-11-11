import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { getAudioContext, getAudioState, type SoundName } from '../../../learning/audioEngine'
import {
  BATH_BOMBS,
  BATH_CELLS,
  BATH_COLS,
  BATH_MASK,
  bathProgress,
  bathStroke,
  bathTuning,
  bombInBath,
  cellCenter,
  newBath,
  nextFoamHat,
  rinseHitsHat,
  type BathBombId,
  type BathPoint,
  type BathState,
  type BathStep,
  type FoamHat,
} from '../../../domain/bath'
import { Icon } from '../../components/Icon'
import { useLearnerProfile } from '../../learningHooks'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell, type GameProps } from './GameShell'
import type { GameRootProps } from './GameScreen'
import { playTracked } from './playU'
import './bath.css'

type ToolStep = Exclude<BathStep, 'done'>

const TOOLS: readonly { step: ToolStep; icon: string; emoji: string; label: string; sound: SoundName; pose: Pose }[] = [
  { step: 'soap', icon: 'ui-play-sponge', emoji: '🧽', label: '海綿', sound: 'pop', pose: 'laugh' },
  { step: 'rinse', icon: 'ui-play-shower', emoji: '🚿', label: '蓮蓬頭', sound: 'splash', pose: 'sing' },
  { step: 'dry', icon: 'ui-play-towel', emoji: '🧣', label: '毛巾', sound: 'whoosh', pose: 'shy' },
]

const NEXT_LINE: Record<Exclude<BathStep, 'soap'>, string> = {
  rinse: 'pet.play.bath.rinse',
  dry: 'pet.play.bath.dry',
  done: 'pet.play.bath.done',
}

/** 手指蓋住工具的高度差：工具浮在手指上面一點，孩子才看得到抹到哪 */
const LIFT = 22
/** 工具抹東西的音效最短間隔 */
const SFX_GAP_MS = 180
/** 手勢提示一輪多久（兩次 2.4 秒的動畫） */
const HINT_SHOW_MS = 4800
/** 沒動作多久再提示一次（不催促、不扣東西） */
const HINT_IDLE_MS = 5000
/** 換步驟後多久出現提示（讓寵物先說完前半句） */
const HINT_FIRST_MS = 900
/** 洗好後等寵物說完「香香的」才送禮物，不然兩句台詞會互相打斷 */
const GIFT_DELAY_MS = 2400
/** v8.5 沐浴球嘶嘶冒泡多久（到了由計時器拿掉，不靠 animationend） */
const FIZZ_MS = 1900
const FIZZ_BUBBLES = 14
/** 手指動超過這麼多才算拖，不然算點一下 */
const TAP_SLOP = 14

/** 同一個格子每次都長一樣的泡泡（不用亂數，重畫才不會跳） */
const jitter = (i: number, salt = 0) => {
  const h = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return h - Math.floor(h)
}

const onFace = (i: number) => {
  const { x, y } = cellCenter(i)
  return Math.abs(x - 0.5) < 0.24 && y > 0.3 && y < 0.58
}

const cellStyle = (i: number, scale: number): CSSProperties => {
  const c = cellCenter(i)
  const size = (100 / BATH_COLS) * scale
  return {
    left: `${(c.x + (jitter(i) - 0.5) / BATH_COLS) * 100}%`,
    top: `${(c.y + (jitter(i, 7) - 0.5) / BATH_COLS) * 100}%`,
    width: `${size}%`,
    height: `${size}%`,
  }
}

/** 泡泡與水珠：格子變了才重畫 */
const Foam = memo(function Foam({ soap, soaped, wet }: Pick<BathState, 'soap' | 'soaped' | 'wet'>) {
  const out = []
  for (let i = 0; i < BATH_CELLS; i++) {
    // 臉上的泡泡小一點：抹滿了還是看得到寵物的表情
    if (soaped[i]) out.push(<i key={`f${i}`} className={`pg-bath-foam ${soap[i] ? 'on' : ''}`} style={cellStyle(i, (onFace(i) ? 0.55 : 1.05) + jitter(i, 3) * (onFace(i) ? 0.3 : 0.75))} data-testid={soap[i] ? 'bath-foam' : undefined} />)
    // 水珠只畫一半的格子，不然太密；擦乾的進度還是算全部
    if (BATH_MASK[i] && i % 2 === 0) out.push(<i key={`d${i}`} className={`pg-bath-drop ${wet[i] ? 'on' : ''}`} style={cellStyle(i, 0.55 + jitter(i, 5) * 0.4)} data-testid={wet[i] ? 'bath-drop' : undefined} />)
  }
  return <div className="pg-bath-layer">{out}</div>
})

const Sparkles = memo(function Sparkles() {
  return (
    <div className="pg-bath-layer" data-testid="bath-sparkles">
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} className="pg-bath-sparkle" style={{ left: `${8 + jitter(i, 11) * 84}%`, top: `${6 + jitter(i, 23) * 88}%`, animationDelay: `${jitter(i, 31) * 1.2}s`, width: `${6 + jitter(i, 41) * 8}%`, height: `${6 + jitter(i, 41) * 8}%` }} />
      ))}
    </div>
  )
})

type Blob = readonly [cx: number, cy: number, rx: number, ry: number]
/** v8.5 泡泡造型：一顆一顆泡泡疊出來的形狀（viewBox 120×104，底部貼著頭頂） */
const HAT_BASE: readonly Blob[] = [
  [20, 84, 14, 14],
  [38, 86, 16, 16],
  [60, 87, 17, 16],
  [82, 86, 16, 16],
  [100, 84, 14, 14],
]
const HAT_SHAPES: Record<FoamHat, readonly Blob[]> = {
  puff: [
    [60, 56, 27, 25],
    [38, 66, 18, 17],
    [82, 66, 18, 17],
    [54, 36, 15, 14],
    [74, 42, 12, 11],
  ],
  spike: [
    [60, 64, 22, 20],
    [60, 46, 16, 15],
    [62, 31, 11.5, 11],
    [65, 19, 8, 7.5],
    [68, 10, 5, 5],
  ],
  bunny: [
    [41, 40, 11.5, 33],
    [79, 40, 11.5, 33],
    [60, 70, 22, 15],
  ],
  crown: [
    [27, 66, 13, 13],
    [25, 48, 9, 9],
    [23, 35, 6, 6],
    [60, 62, 15, 15],
    [60, 41, 10.5, 10.5],
    [60, 25, 7, 7],
    [93, 66, 13, 13],
    [95, 48, 9, 9],
    [97, 35, 6, 6],
    [43, 72, 11, 11],
    [77, 72, 11, 11],
  ],
}

/** 頭上那坨泡泡。顏色跟身上的泡泡一樣（丟了沐浴球就跟著變色） */
const FoamHatShape = memo(function FoamHatShape({ hat }: { hat: FoamHat }) {
  const blobs = [...HAT_SHAPES[hat], ...HAT_BASE]
  return (
    <svg viewBox="0 0 120 104" width="100%" height="100%" aria-hidden>
      <defs>
        {/* 跟身上的泡泡同一種光澤：左上亮、邊緣帶顏色 */}
        <radialGradient id="pg-bath-hat-g" cx="36%" cy="30%" r="78%">
          <stop offset="0.12" className="pg-bath-hat-s0" />
          <stop offset="0.62" className="pg-bath-hat-s1" />
          <stop offset="1" className="pg-bath-hat-s2" />
        </radialGradient>
      </defs>
      <g className="pg-bath-hat-line">
        {blobs.map(([cx, cy, rx, ry], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} />
        ))}
      </g>
      <g className="pg-bath-hat-fill">
        {blobs.map(([cx, cy, rx, ry], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} />
        ))}
      </g>
      <g className="pg-bath-hat-gloss">
        {blobs.map(([cx, cy, rx, ry], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#pg-bath-hat-g)" />
        ))}
      </g>
      <g className="pg-bath-hat-shine">
        {blobs.map(([cx, cy, rx, ry], i) => (
          <ellipse key={i} cx={cx - rx * 0.36} cy={cy - ry * 0.42} rx={rx * 0.22} ry={ry * 0.15} />
        ))}
      </g>
    </svg>
  )
})

/** 沐浴球冒的泡泡：每顆固定的位置與大小（不用亂數，重畫才不會跳） */
const Fizz = memo(function Fizz() {
  return (
    <>
      {Array.from({ length: FIZZ_BUBBLES }, (_, i) => (
        <i
          key={i}
          style={
            {
              left: `${(jitter(i, 51) - 0.5) * 150}px`,
              top: `${(jitter(i, 57) - 0.5) * 40}px`,
              width: `${12 + jitter(i, 61) * 20}px`,
              height: `${12 + jitter(i, 61) * 20}px`,
              animationDelay: `${jitter(i, 67) * 0.9}s`,
              '--rise': `${-(60 + jitter(i, 71) * 110)}px`,
            } as CSSProperties
          }
        />
      ))}
    </>
  )
})

function HandHint() {
  return (
    <svg viewBox="0 0 64 72" width="100%" height="100%" aria-hidden>
      <path d="M26 8a6.5 6.5 0 0 1 13 0v22l9.5 2.2c5 1.2 8 5.6 7.3 10.6l-2.3 15.7c-.8 5.5-5.5 9.5-11 9.5H31c-3.600 0-7-1.700-9.100-4.600L8.500 45c-2-2.800-1.400-6.700 1.400-8.700s6.400-1.500 8.600 1.100L26 46V8Z" fill="#fff" stroke="#6a5a4e" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  )
}

function AgainIcon() {
  return (
    <svg viewBox="0 0 48 48" width="62%" height="62%" aria-hidden>
      <path d="M41 25a17 17 0 1 1-5.2-12.2" fill="none" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" />
      <path d="M38 4v10H28" fill="none" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 小鴨叫（短的 Web Audio 合成）。音效開關關掉時不響 */
function quack() {
  if (!getAudioState().sfxEnabled) return
  try {
    const c = getAudioContext()
    if (!c) return
    if (c.state !== 'running') void c.resume()?.catch?.(() => {})
    for (const at of [0, 0.15]) {
      const t = c.currentTime + at
      const osc = c.createOscillator()
      const filter = c.createBiquadFilter()
      const gain = c.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(560, t)
      osc.frequency.exponentialRampToValueAtTime(340, t + 0.11)
      filter.type = 'bandpass'
      filter.frequency.value = 1100
      filter.Q.value = 1.4
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.32, t + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      osc.connect(filter).connect(gain).connect(c.destination)
      osc.onended = () => gain.disconnect()
      osc.start(t)
      osc.stop(t + 0.13)
    }
  } catch {
    /* 沒聲音也不影響玩 */
  }
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

interface ToolDrag {
  id: number
  tool: (typeof TOOLS)[number]
  el: HTMLElement
  /** 工具在托盤裡的中心 */
  homeX: number
  homeY: number
  pet: DOMRect
  last: BathPoint | null
}

interface BombDrag {
  id: number
  bomb: BathBombId
  el: HTMLElement
  homeX: number
  homeY: number
  startX: number
  startY: number
  moved: boolean
}

interface DuckDrag {
  id: number
  startX: number
  startY: number
  moved: boolean
}

function BathPlay({ finish, say, toys }: GameProps) {
  const { ageBand } = useLearnerProfile()
  const tuning = bathTuning(ageBand)
  const [bath, setBath] = useState<BathState>(newBath)
  const [holding, setHolding] = useState<ToolStep | null>(null)
  const [hint, setHint] = useState<CSSProperties | null>(null)
  // v8.5 沐浴球：丟進去的那顆的顏色（這一回都是這個顏色，再丟一顆就換）；用掉的這一回不再出現
  const [tint, setTint] = useState<BathBombId | null>(null)
  const [usedBombs, setUsedBombs] = useState<readonly BathBombId[]>([])
  const [fizz, setFizz] = useState<{ key: number; x: number; y: number } | null>(null)
  const bombDrag = useRef<BombDrag | null>(null)
  const bombSaid = useRef(false)
  const fizzTimer = useRef<number | undefined>(undefined)
  // v8.5 泡泡造型：抹滿後頭上的那坨泡泡；沖到就沒了
  const [hat, setHat] = useState<FoamHat | null>(null)
  const hatRef = useRef<FoamHat | null>(null)
  const hatEl = useRef<HTMLButtonElement>(null)
  const hatTap = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const putHat = (h: FoamHat | null) => {
    hatRef.current = h
    setHat(h)
  }
  const rootRef = useRef<HTMLDivElement>(null)
  const petRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<Partial<Record<ToolStep, HTMLDivElement | null>>>({})
  const duckRef = useRef<HTMLButtonElement>(null)
  // 一次事件可能連續進來好幾個：同步讀最新的狀態，不等 React 重畫
  const bathRef = useRef(bath)
  const toolDrag = useRef<ToolDrag | null>(null)
  const duckDrag = useRef<DuckDrag | null>(null)
  const lastSfx = useRef(0)
  const giftTimer = useRef<number | undefined>(undefined)
  const giftPending = useRef(false)
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  }, [finish])

  /** 送禮物：等寵物說完；提早離開或馬上再洗一次也不會少送 */
  const flushGift = () => {
    window.clearTimeout(giftTimer.current)
    if (!giftPending.current) return
    giftPending.current = false
    finishRef.current()
  }
  const flushRef = useRef(flushGift)
  useEffect(() => {
    flushRef.current = flushGift
  })
  useEffect(
    () => () => {
      flushRef.current()
      window.clearTimeout(fizzTimer.current)
    },
    [],
  )

  // 手勢提示：換步驟或放開工具後開始算，一直沒動作才再出現；拿著工具時不打擾
  const step = bath.step
  const hintStep = useRef<BathStep | null>(null)
  useEffect(() => {
    if (step === 'done' || holding) return
    const first = hintStep.current !== step
    let timer = 0
    const show = () => {
      hintStep.current = step
      const slot = slotRefs.current[step]?.getBoundingClientRect()
      const pet = petRef.current?.getBoundingClientRect()
      if (slot && pet) {
        setHint({
          '--fx': `${slot.left + slot.width / 2}px`,
          '--fy': `${slot.top + slot.height / 2}px`,
          '--tx': `${pet.left + pet.width / 2}px`,
          '--ty': `${pet.top + pet.height * 0.45}px`,
          '--sw': `${pet.width * 0.2}px`,
        } as CSSProperties)
      }
      timer = window.setTimeout(hide, HINT_SHOW_MS)
    }
    const hide = () => {
      setHint(null)
      timer = window.setTimeout(show, HINT_IDLE_MS)
    }
    timer = window.setTimeout(show, first ? HINT_FIRST_MS : HINT_IDLE_MS)
    return () => {
      window.clearTimeout(timer)
      setHint(null)
    }
  }, [step, holding])

  const releaseTool = () => {
    const d = toolDrag.current
    if (!d) return
    d.el.style.transform = ''
    toolDrag.current = null
    setHolding(null)
  }

  const afterAdvance = (next: BathStep) => {
    releaseTool()
    playTracked(rootRef.current, 'sparkle')
    if (next !== 'soap') say(NEXT_LINE[next])
    // v8.5 泡泡抹滿了：頭上多一坨可以捏造型的泡泡；沖完水一定沒了
    if (next === 'rinse' && toys >= 2) putHat('puff')
    else if (next !== 'rinse') putHat(null)
    if (next === 'done') {
      giftPending.current = true
      giftTimer.current = window.setTimeout(flushGift, GIFT_DELAY_MS)
    }
  }

  const moveTool = (x: number, y: number) => {
    const d = toolDrag.current
    if (!d) return
    const ty = y - LIFT
    d.el.style.transform = `translate(${x - d.homeX}px, ${ty - d.homeY}px) scale(1.08)`
    const to = { x: (x - d.pet.left) / d.pet.width, y: (ty - d.pet.top) / d.pet.height }
    const from = d.last ?? to
    const r = bathStroke(bathRef.current, from, to, tuning)
    d.last = to
    const now = performance.now()
    if (d.tool.step === 'rinse' && hatRef.current && rinseHitsHat(from, to, tuning)) {
      putHat(null)
      lastSfx.current = now
      playTracked(rootRef.current, 'splash')
    }
    if (r.state === bathRef.current) return
    bathRef.current = r.state
    setBath(r.state)
    if (r.changed > 0 && now - lastSfx.current >= SFX_GAP_MS) {
      lastSfx.current = now
      playTracked(rootRef.current, d.tool.sound)
    }
    if (r.advanced) afterAdvance(r.state.step)
  }

  /** 拿起這一步的工具。手指直接抹在寵物身上也算（3 歲一定會這樣做）：工具飛到手指下面 */
  const grabTool = (e: ReactPointerEvent<HTMLElement>, s: ToolStep) => {
    if (toolDrag.current || s !== bathRef.current.step) return
    const slot = slotRefs.current[s]
    const el = slot?.querySelector<HTMLElement>('.pg-bath-tool')
    const pet = petRef.current?.getBoundingClientRect()
    if (!slot || !el || !pet) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 指標已經放開 */
    }
    const home = slot.getBoundingClientRect()
    toolDrag.current = { id: e.pointerId, tool: TOOLS.find((t) => t.step === s)!, el, homeX: home.left + home.width / 2, homeY: home.top + home.height / 2, pet, last: null }
    setHolding(s)
    moveTool(e.clientX, e.clientY)
  }
  /** 沐浴球丟進去了：水和泡泡變成它的顏色，嘶嘶冒泡 */
  const dropBomb = (bomb: BathBombId, x: number, y: number) => {
    const box = rootRef.current?.getBoundingClientRect()
    setTint(bomb)
    setUsedBombs((u) => (u.includes(bomb) ? u : [...u, bomb]))
    if (box) setFizz((f) => ({ key: (f?.key ?? 0) + 1, x: x - box.left, y: y - box.top }))
    window.clearTimeout(fizzTimer.current)
    fizzTimer.current = window.setTimeout(() => setFizz(null), FIZZ_MS)
    playTracked(rootRef.current, 'splash')
    // 台詞一回說一次：連丟三顆不會念三次
    if (!bombSaid.current) {
      bombSaid.current = true
      say('pet.play.bath.bomb')
    }
  }
  const grabBomb = (e: ReactPointerEvent<HTMLButtonElement>, bomb: BathBombId) => {
    if (bombDrag.current) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 指標已經放開 */
    }
    const el = e.currentTarget
    const home = el.getBoundingClientRect()
    bombDrag.current = { id: e.pointerId, bomb, el, homeX: home.left + home.width / 2, homeY: home.top + home.height / 2, startX: e.clientX, startY: e.clientY, moved: false }
    el.classList.add('held')
  }
  const moveBomb = (d: BombDrag, x: number, y: number) => {
    if (Math.hypot(x - d.startX, y - d.startY) > TAP_SLOP) d.moved = true
    if (d.moved) d.el.style.transform = `translate(${x - d.homeX}px, ${y - LIFT - d.homeY}px) scale(1.12)`
  }
  const endBomb = (d: BombDrag, x: number, y: number, cancelled: boolean) => {
    bombDrag.current = null
    d.el.classList.remove('held')
    d.el.style.transform = ''
    const pet = petRef.current?.getBoundingClientRect()
    if (cancelled || !pet) return
    // 點一下也算（3 歲還不太會拖）：直接掉到寵物腳邊。拖的要放在洗澡的地方，放太遠就回托盤
    if (!d.moved) dropBomb(d.bomb, pet.left + pet.width / 2, pet.top + pet.height * 0.88)
    else if (bombInBath({ x: (x - pet.left) / pet.width, y: (y - LIFT - pet.top) / pet.height })) dropBomb(d.bomb, x, y - LIFT)
  }

  /** 換一個泡泡造型 */
  const squishHat = () => {
    const h = hatRef.current
    if (!h) return
    putHat(nextFoamHat(h))
    playTracked(rootRef.current, 'boing')
    if (!reducedMotion()) hatEl.current?.animate?.([{ transform: 'scale(1.18, 0.7)' }, { transform: 'scale(0.92, 1.12)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' })
  }

  const grabDuck = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (duckDrag.current) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 指標已經放開 */
    }
    duckDrag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false }
    duckRef.current?.classList.add('held')
  }

  const moveDuck = (d: DuckDrag, x: number, y: number) => {
    if (Math.hypot(x - d.startX, y - d.startY) > 14) d.moved = true
    const box = rootRef.current?.getBoundingClientRect()
    const el = duckRef.current
    if (!d.moved || !box || !el) return
    // 用比例存：轉 iPad 之後小鴨還在畫面裡
    const clamp = (v: number) => Math.min(0.94, Math.max(0.06, v))
    el.style.left = `${clamp((x - box.left) / box.width) * 100}%`
    el.style.top = `${clamp((y - box.top) / box.height) * 100}%`
  }

  const dropDuck = (d: DuckDrag, cancelled: boolean) => {
    duckDrag.current = null
    const el = duckRef.current
    el?.classList.remove('held')
    if (cancelled || d.moved || !el) return
    quack()
    el.dataset.quacks = String(Number(el.dataset.quacks ?? 0) + 1)
    if (!reducedMotion()) el.animate?.([{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: 'translate(-50%, -50%) scale(1.25, 0.8)' }, { transform: 'translate(-50%, -50%) scale(0.9, 1.15)' }, { transform: 'translate(-50%, -50%) scale(1)' }], { duration: 320, easing: 'ease-out' })
  }

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 從頭上的泡泡開始抹：手指一拖開就當成拿蓮蓬頭沖水（不是換造型）
    const tap = hatTap.current
    if (tap?.id === e.pointerId && !tap.moved && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP) {
      tap.moved = true
      grabTool(e, 'rinse')
    }
    if (toolDrag.current?.id === e.pointerId) moveTool(e.clientX, e.clientY)
    if (duckDrag.current?.id === e.pointerId) moveDuck(duckDrag.current, e.clientX, e.clientY)
    if (bombDrag.current?.id === e.pointerId) moveBomb(bombDrag.current, e.clientX, e.clientY)
  }
  const onEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (toolDrag.current?.id === e.pointerId) releaseTool()
    if (duckDrag.current?.id === e.pointerId) dropDuck(duckDrag.current, e.type === 'pointercancel')
    if (bombDrag.current?.id === e.pointerId) endBomb(bombDrag.current, e.clientX, e.clientY, e.type === 'pointercancel')
    const tap = hatTap.current
    if (tap?.id === e.pointerId) {
      hatTap.current = null
      if (!tap.moved && e.type !== 'pointercancel') squishHat()
    }
  }

  const again = () => {
    flushGift()
    const fresh = newBath()
    bathRef.current = fresh
    setBath(fresh)
    // 新的一回：水變回原本的顏色，沐浴球都回來
    setTint(null)
    setUsedBombs([])
    bombSaid.current = false
    putHat(null)
    say('pet.play.bath.intro')
  }

  const done = step === 'done'
  const held = TOOLS.find((t) => t.step === holding)
  const pose: Pose = done ? 'cheer' : (held?.pose ?? 'happy')
  const activeIdx = TOOLS.findIndex((t) => t.step === step)

  return (
    <div
      ref={rootRef}
      className={`pg-bath ${done ? 'is-done' : ''}`}
      data-testid="bath"
      data-step={step}
      data-progress={bathProgress(bath).toFixed(2)}
      data-tint={tint ?? undefined}
      data-hat={hat ?? undefined}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
    >
      <div ref={petRef} className="pg-bath-pet" data-testid="bath-pet" onPointerDown={(e) => !done && grabTool(e, step as ToolStep)}>
        {tint && !done && <span key={tint} className="pg-bath-puddle" data-testid="bath-puddle" aria-hidden />}
        <Companion pose={pose} size="100%" className="pg-bath-companion" />
        <Foam soap={bath.soap} soaped={bath.soaped} wet={bath.wet} />
        {toys >= 2 && step === 'rinse' && (
          // 沖掉之後按鈕還留在畫面裡（只是看不到、碰不到）：手指從它身上開始拖去沖水時，事件才不會跟著元素一起不見
          <button
            ref={hatEl}
            type="button"
            className={`pg-bath-hat ${hat ? '' : 'gone'}`}
            data-testid="bath-hat"
            data-hat={hat ?? 'none'}
            data-no-tap
            aria-label="泡泡造型，點一下換一個"
            aria-hidden={!hat}
            tabIndex={hat ? 0 : -1}
            onPointerDown={(e) => {
              // 不讓寵物那一層把它當成「開始沖水」；是點還是拖，等手指動了才知道
              e.stopPropagation()
              hatTap.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
            }}
            onClick={(e) => {
              // 鍵盤（Enter / 空白鍵）沒有 pointer 事件
              if (e.detail === 0) squishHat()
            }}
          >
            {hat && <FoamHatShape hat={hat} />}
          </button>
        )}
        {done && <Sparkles />}
      </div>

      {toys >= 1 && !done && (
        <div className="pg-bath-bombs" data-testid="bath-bombs">
          {BATH_BOMBS.map((b) => (
            <div key={b.id} className={`pg-bath-bomb-slot ${b.id}`}>
              {!usedBombs.includes(b.id) && (
                <button type="button" className="pg-bath-bomb" data-testid={`bath-bomb-${b.id}`} data-no-tap aria-label={`${b.label}沐浴球`} style={{ '--hue': `${b.hue}deg` } as CSSProperties} onPointerDown={(e) => grabBomb(e, b.id)}>
                  <Icon name="ui-bath-bomb" emoji="🔮" size="100%" alt="" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {fizz && (
        <div key={fizz.key} className="pg-bath-fizz" style={{ left: fizz.x, top: fizz.y }} data-testid="bath-fizz" aria-hidden>
          <Fizz />
        </div>
      )}

      <button ref={duckRef} className="pg-bath-duck" data-testid="bath-duck" aria-label="小鴨" data-no-tap onPointerDown={grabDuck}>
        <Icon name="ui-play-duck" emoji="🦆" size="100%" alt="" />
      </button>

      {done ? (
        <div className="pg-bath-tray">
          <button className="pg-bath-again" onClick={again} data-testid="bath-again" aria-label="再洗一次">
            <AgainIcon />
          </button>
        </div>
      ) : (
        <div className="pg-bath-tray" data-testid="bath-tray">
          {TOOLS.map((t, i) => (
            <div
              key={t.step}
              ref={(el) => {
                slotRefs.current[t.step] = el
              }}
              className={`pg-bath-slot ${i === activeIdx ? 'active' : ''} ${i < activeIdx ? 'used' : ''}`}
            >
              <div className={`pg-bath-tool ${holding === t.step ? 'held' : ''}`} data-testid={`bath-tool-${t.step}`} role="img" aria-label={t.label} onPointerDown={(e) => grabTool(e, t.step)}>
                <Icon name={t.icon} emoji={t.emoji} size="100%" alt="" />
                {t.step === 'rinse' && holding === 'rinse' && (
                  <span className="pg-bath-water" data-testid="bath-water">
                    {Array.from({ length: 7 }, (_, n) => (
                      <i key={n} style={{ left: `${n * 15 + 4}%`, animationDelay: `${(n % 3) * 0.09}s` }} />
                    ))}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hint && (
        <div className="pg-bath-hint" style={hint} data-testid="bath-hint" aria-hidden>
          <HandHint />
        </div>
      )}
    </div>
  )
}

export default function Bath({ onExit }: GameRootProps) {
  return (
    <GameShell id="bath" scene="scene-play-bath" intro="pet.play.bath.intro" onExit={onExit}>
      {(p) => <BathPlay {...p} />}
    </GameShell>
  )
}
