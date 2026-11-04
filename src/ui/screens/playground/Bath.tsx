import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { getAudioContext, getAudioState, playSound, type SoundName } from '../../../learning/audioEngine'
import { BATH_CELLS, BATH_COLS, BATH_MASK, bathProgress, bathStroke, bathTuning, cellCenter, newBath, type BathPoint, type BathState, type BathStep } from '../../../domain/bath'
import { Icon } from '../../components/Icon'
import { useLearnerProfile } from '../../learningHooks'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell, type GameProps } from './GameShell'
import type { GameRootProps } from './GameScreen'
import './bath.css'

type ToolStep = Exclude<BathStep, 'done'>

const TOOLS: readonly { step: ToolStep; icon: string; emoji: string; label: string; sound: SoundName; pose: Pose }[] = [
  { step: 'soap', icon: 'ui-play-sponge', emoji: '🧽', label: '海綿', sound: 'pop', pose: 'laugh' },
  { step: 'rinse', icon: 'ui-play-shower', emoji: '🚿', label: '蓮蓬頭', sound: 'drop', pose: 'sing' },
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

interface DuckDrag {
  id: number
  startX: number
  startY: number
  moved: boolean
}

function BathPlay({ finish, say }: GameProps) {
  const { ageBand } = useLearnerProfile()
  const tuning = bathTuning(ageBand)
  const [bath, setBath] = useState<BathState>(newBath)
  const [holding, setHolding] = useState<ToolStep | null>(null)
  const [hint, setHint] = useState<CSSProperties | null>(null)
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
  useEffect(() => () => flushRef.current(), [])

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
    playSound('sparkle')
    if (next !== 'soap') say(NEXT_LINE[next])
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
    const r = bathStroke(bathRef.current, d.last ?? to, to, tuning)
    d.last = to
    if (r.state === bathRef.current) return
    bathRef.current = r.state
    setBath(r.state)
    const now = performance.now()
    if (r.changed > 0 && now - lastSfx.current >= SFX_GAP_MS) {
      lastSfx.current = now
      playSound(d.tool.sound)
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
    if (toolDrag.current?.id === e.pointerId) moveTool(e.clientX, e.clientY)
    if (duckDrag.current?.id === e.pointerId) moveDuck(duckDrag.current, e.clientX, e.clientY)
  }
  const onEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (toolDrag.current?.id === e.pointerId) releaseTool()
    if (duckDrag.current?.id === e.pointerId) dropDuck(duckDrag.current, e.type === 'pointercancel')
  }

  const again = () => {
    flushGift()
    const fresh = newBath()
    bathRef.current = fresh
    setBath(fresh)
    say('pet.play.bath.intro')
  }

  const done = step === 'done'
  const held = TOOLS.find((t) => t.step === holding)
  const pose: Pose = done ? 'cheer' : (held?.pose ?? 'happy')
  const activeIdx = TOOLS.findIndex((t) => t.step === step)

  return (
    <div ref={rootRef} className={`pg-bath ${done ? 'is-done' : ''}`} data-testid="bath" data-step={step} data-progress={bathProgress(bath).toFixed(2)} onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onEnd}>
      <div ref={petRef} className="pg-bath-pet" data-testid="bath-pet" onPointerDown={(e) => !done && grabTool(e, step as ToolStep)}>
        <Companion pose={pose} size="100%" className="pg-bath-companion" />
        <Foam soap={bath.soap} soaped={bath.soaped} wet={bath.wet} />
        {done && <Sparkles />}
      </div>

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
