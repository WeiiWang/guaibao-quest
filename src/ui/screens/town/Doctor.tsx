import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getAudioContext, getAudioState, playSound } from '../../../learning/audioEngine'
import { localDateStr } from '../../../domain/date'
import { AILMENT_STEPS, DOCTOR_TOOLS, SPOT_POS, TOOL_LINE, TOOL_SPOT, ailmentFor, applyDoctorTool, expectedTool, glowDelay, newVisit, onPetBox, visitDone, type Ailment, type DoctorTool, type ToolOutcome, type Visit } from '../../../domain/doctor'
import type { AgeBand } from '../../../domain/types'
import { Icon } from '../../components/Icon'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell, type GameProps } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'
import { AgainButton, petHop, reducedMotion, useBand, useFinishLater, useTrackedSay } from '../playground/playU'
import { GestureHint } from '../playground/vShared'
import { useTimers } from '../playground/wHelpers'
import '../playground/playU.css'
import './doctor.css'

// v8.4 寵物醫院：寵物帶一個小毛病來，拖（或點）工具幫牠看病。沒有打針、沒有血、沒有扣分。

const TOOL_INFO: Record<DoctorTool, { icon: string; emoji: string; label: string }> = {
  thermo: { icon: 'ui-doc-thermo', emoji: '🌡️', label: '體溫計' },
  stetho: { icon: 'ui-doc-stetho', emoji: '🩺', label: '聽診器' },
  light: { icon: 'ui-doc-light', emoji: '🔦', label: '手電筒' },
  bandage: { icon: 'ui-doc-bandage', emoji: '🩹', label: 'OK 繃' },
  spoon: { icon: 'ui-doc-spoon', emoji: '🥄', label: '藥水湯匙' },
}

/** 生病時的樣子 */
const SICK_POSE: Record<Ailment, Pose> = { sneeze: 'sleepy', tummy: 'think', knee: 'shy', throat: 'think' }
/** 用工具時的樣子：手電筒照喉嚨要張嘴（唱歌的圖嘴巴張開）、吃藥是吃東西的樣子 */
const TOOL_POSE: Record<DoctorTool, Pose> = { thermo: 'idle', stetho: 'happy', light: 'sing', bandage: 'happy', spoon: 'eating' }
/** 工具停的位置離目標偏一點：手電筒、湯匙停在嘴邊，不要整個蓋住嘴巴 */
const TOOL_NUDGE: Record<DoctorTool, { x: number; y: number }> = { thermo: { x: 0.04, y: -0.02 }, stetho: { x: 0, y: 0 }, light: { x: 0.13, y: 0.1 }, bandage: { x: 0, y: 0 }, spoon: { x: 0.14, y: 0.05 } }

/** 工具飛到位置要多久 */
const FLY_MS = 380
/** 工具停在寵物身上演多久 */
const REACT_MS = 1700
/** 進來後多久說哪裡不舒服（讓殼先說完開場） */
const SYMPTOM_MS = 2400
/** 看完後多久跳出貼紙（寵物先開心一下） */
const STICKER_MS = 500
/** 手勢提示演一輪多久（兩次 2.2 秒） */
const HINT_SHOW_MS = 4400
/** 沒動作多久再提示一次 */
const HINT_IDLE_MS = 6000
/** 手指拿著工具時，工具浮在手指上面一點 */
const LIFT = 26
/** 移動超過這麼多才算拖，不然是點 */
const TAP_SLOP = 12

/** 同一天第幾次看病（記在記憶體：看完一次換下一個毛病；重新整理就回到今天的第一個，不寫資料） */
const rounds = { date: '', n: 0 }
function currentRound(): { date: string; n: number } {
  const date = localDateStr(Date.now())
  if (rounds.date !== date) {
    rounds.date = date
    rounds.n = 0
  }
  return { date, n: rounds.n }
}

// ---- 聲音（Web Audio 合成，音效關掉時不響） ----

function withAudio(fn: (c: AudioContext, t: number) => void) {
  if (!getAudioState().sfxEnabled) return
  try {
    const c = getAudioContext()
    if (!c) return
    if (c.state !== 'running') void c.resume()?.catch?.(() => {})
    fn(c, c.currentTime)
  } catch {
    /* 沒聲音也不影響玩 */
  }
}

function tone(c: AudioContext, t: number, type: OscillatorType, f0: number, f1: number, vol: number, dur: number) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(f0, t)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(c.destination)
  o.onended = () => g.disconnect()
  o.start(t)
  o.stop(t + dur + 0.02)
}

/** 咚咚、咚咚：低低的心跳 */
const heartbeat = () =>
  withAudio((c, t) => {
    for (const at of [0, 0.62]) {
      tone(c, t + at, 'sine', 95, 50, 0.9, 0.16)
      tone(c, t + at + 0.2, 'sine', 80, 45, 0.7, 0.14)
    }
  })

/** 體溫計嗶嗶 */
const beep = () =>
  withAudio((c, t) => {
    for (const at of [0.3, 0.5]) tone(c, t + at, 'sine', 1500, 1500, 0.18, 0.09)
  })

// ---- 畫面上的小東西（都是 SVG：不用 emoji 當主圖） ----

/** 生病的樣子：打噴嚏的小雲、肚子的咕嚕線、膝蓋的淡粉紅擦痕（沒有血）、喉嚨的癢癢線 */
function Symptom({ ailment }: { ailment: Ailment }) {
  if (ailment === 'sneeze')
    return (
      <span className="doc-sym doc-sym-sneeze" data-testid="doc-symptom" aria-hidden>
        {[0, 1, 2].map((i) => (
          <i key={i} style={{ animationDelay: `${i * 0.35}s` }} />
        ))}
      </span>
    )
  if (ailment === 'tummy')
    return (
      <svg className="doc-sym doc-sym-tummy" data-testid="doc-symptom" viewBox="0 0 60 40" aria-hidden>
        <path d="M6 20c4-8 8-8 12 0s8 8 12 0 8-8 12 0 8 8 12 0" fill="none" stroke="#b99cf0" strokeWidth="4" strokeLinecap="round" />
        <path d="M14 33c3-5 6-5 9 0s6 5 9 0 6-5 9 0" fill="none" stroke="#d3c0ff" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  if (ailment === 'knee')
    return (
      <svg className="doc-sym doc-sym-knee" data-testid="doc-symptom" viewBox="0 0 40 30" aria-hidden>
        <ellipse cx="20" cy="15" rx="15" ry="10" fill="#ffd1dc" opacity="0.9" />
        <path d="M11 13l14-3M13 18l16-3M16 22l10-2" stroke="#f4a3b6" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    )
  return (
    <svg className="doc-sym doc-sym-throat" data-testid="doc-symptom" viewBox="0 0 50 24" aria-hidden>
      <path d="M4 12l6-6 6 12 6-12 6 12 6-12 6 12 6-6" fill="none" stroke="#ff9db4" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Bandage() {
  return (
    <svg className="doc-bandage-on" data-testid="doc-bandage-on" viewBox="0 0 64 30" aria-hidden>
      <rect x="2" y="3" width="60" height="24" rx="12" fill="#ffd9c2" stroke="#e8b39a" strokeWidth="2" />
      <rect x="22" y="6" width="20" height="18" rx="4" fill="#fff1e6" />
      <circle cx="10" cy="12" r="1.6" fill="#e8b39a" />
      <circle cx="13" cy="18" r="1.6" fill="#e8b39a" />
      <circle cx="51" cy="12" r="1.6" fill="#e8b39a" />
      <circle cx="54" cy="18" r="1.6" fill="#e8b39a" />
      <path d="M32 11.5c-1.6-2.400-5-1.200-4 1.400.6 1.600 4 4.100 4 4.100s3.400-2.500 4-4.100c1-2.600-2.400-3.800-4-1.400z" fill="#ff9db4" />
    </svg>
  )
}

/** 工具的效果：體溫計顯示愛心（沒發燒）、聽診器跳動的愛心、手電筒的光 */
function Effect({ tool }: { tool: DoctorTool }) {
  if (tool === 'thermo')
    return (
      <span className="doc-fx doc-fx-reading" data-testid="doc-fx-thermo" aria-hidden>
        <svg viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="21" fill="#e3f9ea" stroke="#5cc98f" strokeWidth="3" />
          <path d="M15 25l6 6 12-13" fill="none" stroke="#3ba56f" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  if (tool === 'stetho')
    return (
      <span className="doc-fx doc-fx-heart" data-testid="doc-fx-stetho" aria-hidden>
        <svg viewBox="0 0 48 44">
          <path d="M24 40S4 27 4 14C4 7 9 3 14.500 3c4.300 0 7.500 2.600 9.500 6 2-3.400 5.200-6 9.500-6C39 3 44 7 44 14c0 13-20 26-20 26z" fill="#ff7a9a" stroke="#fff" strokeWidth="3" />
        </svg>
      </span>
    )
  if (tool === 'light') return <span className="doc-fx doc-fx-beam" data-testid="doc-fx-light" aria-hidden />
  return null
}

/** 看完送的貼紙（純畫面，不存） */
function Sticker() {
  return (
    <span className="doc-sticker" data-testid="doc-sticker" aria-hidden>
      <svg viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="36" fill="#ffd166" stroke="#fff" strokeWidth="5" />
        <circle cx="40" cy="40" r="27" fill="#ffe7a3" />
        <path d="M40 19l6.200 12.700 14 2-10.100 9.900 2.400 13.900L40 51l-12.500 6.500 2.400-13.900-10.100-9.900 14-2z" fill="#ff9db4" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

interface Drag {
  id: number
  tool: DoctorTool
  el: HTMLElement
  homeX: number
  homeY: number
  startX: number
  startY: number
  moved: boolean
}

function DoctorPlay({ band, finish, say: rawSay }: GameProps & { band: AgeBand }) {
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const { after, cancel } = useTimers()
  const [visit, setVisit] = useState<Visit>(() => {
    const r = currentRound()
    return newVisit(ailmentFor(r.date, r.n))
  })
  const visitRef = useRef(visit)
  const [round, setRound] = useState(() => currentRound().n)
  const [busy, setBusy] = useState<{ tool: DoctorTool; outcome: ToolOutcome; acting: boolean } | null>(null)
  const busyRef = useRef(false)
  const [glow, setGlow] = useState(false)
  const [hint, setHint] = useState(false)
  const [sticker, setSticker] = useState(false)
  const [holding, setHolding] = useState<DoctorTool | null>(null)
  const petRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const toolRefs = useRef<Partial<Record<DoctorTool, HTMLDivElement | null>>>({})
  const spotRefs = useRef<Partial<Record<string, HTMLSpanElement | null>>>({})
  const drag = useRef<Drag | null>(null)
  /** 6–7 歲的「拖到寵物身上」示範只演第一次 */
  const [demoed, setDemoed] = useState(false)

  const done = visitDone(visit)
  const want = expectedTool(visit)

  // 一進來寵物說哪裡不舒服（殼先說開場）
  useEffect(() => {
    const id = after(SYMPTOM_MS, () => say(`pet.play.doctor.${visitRef.current.ailment}`))
    return () => cancel(id)
  }, [after, cancel, say])

  // 該用的工具發亮：3 歲馬上、4–5 歲 4 秒後、6–7 歲不亮。每一步重新算
  useEffect(() => {
    setGlow(false)
    const delay = glowDelay(band)
    if (delay === null || done) return
    const id = after(delay, () => setGlow(true))
    return () => cancel(id)
  }, [band, visit.step, visit.ailment, done, after, cancel])

  // 手勢提示：發亮時示範把那個工具拖到寵物身上；6–7 歲只有第一次示範「拖到寵物身上」（不透露答案）。
  // 演兩輪就收起來，一直沒動作才再出現；拿著工具或工具在演時不打擾
  const hintOn = !done && !busy && !holding && (glow || (band === '6-7' && !demoed))
  useEffect(() => {
    if (!hintOn) {
      setHint(false)
      return
    }
    let id = 0
    const show = () => {
      setHint(true)
      id = after(HINT_SHOW_MS, hide)
    }
    const hide = () => {
      setHint(false)
      if (band === '6-7') return
      id = after(HINT_IDLE_MS, show)
    }
    id = after(band === '6-7' ? SYMPTOM_MS + 1200 : 300, show)
    return () => cancel(id)
  }, [hintOn, band, visit.step, after, cancel])

  const toolEl = (t: DoctorTool) => toolRefs.current[t]?.querySelector<HTMLElement>('.doc-tool') ?? null

  /** 工具回托盤 */
  const sendHome = (el: HTMLElement) => {
    el.classList.add('flying')
    el.style.transform = ''
    after(FLY_MS, () => el.classList.remove('flying'))
  }

  /** 工具飛到它該用的位置，演反應，再回托盤 */
  const act = (tool: DoctorTool, el: HTMLElement, homeX: number, homeY: number) => {
    const pet = petRef.current?.getBoundingClientRect()
    if (!pet) return sendHome(el)
    busyRef.current = true
    setDemoed(true)
    const { visit: next, outcome } = applyDoctorTool(visitRef.current, tool, band)
    setBusy({ tool, outcome, acting: false })
    const spot = SPOT_POS[TOOL_SPOT[tool]]
    const tx = pet.left + pet.width * (spot.x + TOOL_NUDGE[tool].x)
    const ty = pet.top + pet.height * (spot.y + TOOL_NUDGE[tool].y)
    el.classList.add('flying')
    el.style.transform = `translate(${tx - homeX}px, ${ty - homeY}px) scale(0.86)`
    playSound('whoosh')
    after(reducedMotion() ? 60 : FLY_MS, () => {
      el.classList.remove('flying')
      setBusy({ tool, outcome, acting: true })
      if (outcome === 'wrong') {
        playSound('pop')
        say('pet.play.doctor.wrong')
        petHop(petRef.current, '-6%')
      } else {
        if (tool === 'stetho') heartbeat()
        else if (tool === 'thermo') beep()
        else playSound(tool === 'spoon' ? 'drop' : 'sparkle')
        // 用錯的 OK 繃不說「不痛了」（根本沒受傷）；其他工具都說它的話
        if (!(tool === 'bandage' && outcome === 'play')) say(TOOL_LINE[tool])
      }
      if (outcome === 'step' || outcome === 'done') {
        visitRef.current = next
        setVisit(next)
      }
      after(REACT_MS, () => {
        sendHome(el)
        busyRef.current = false
        setBusy(null)
        if (outcome === 'done') {
          rounds.n = round + 1
          playSound('sparkle')
          say('pet.play.doctor.done')
          petHop(petRef.current)
          after(STICKER_MS, () => setSticker(true))
          finishLater()
        }
      })
    })
  }

  const grab = (e: ReactPointerEvent<HTMLDivElement>, tool: DoctorTool) => {
    if (drag.current || busyRef.current || done) return
    const el = toolEl(tool)
    const slot = toolRefs.current[tool]
    if (!el || !slot) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 指標已經放開 */
    }
    const home = slot.getBoundingClientRect()
    drag.current = { id: e.pointerId, tool, el, homeX: home.left + home.width / 2, homeY: home.top + home.height / 2, startX: e.clientX, startY: e.clientY, moved: false }
  }

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > TAP_SLOP) {
      d.moved = true
      setHolding(d.tool)
    }
    if (d.moved) d.el.style.transform = `translate(${e.clientX - d.homeX}px, ${e.clientY - LIFT - d.homeY}px) scale(1.08)`
  }

  const onEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    setHolding(null)
    if (e.type === 'pointercancel') return sendHome(d.el)
    // 點一下：工具自己飛到對的位置（3 歲一定會這樣用）
    if (!d.moved) return act(d.tool, d.el, d.homeX, d.homeY)
    const pet = petRef.current?.getBoundingClientRect()
    const p = pet ? { x: (e.clientX - pet.left) / pet.width, y: (e.clientY - LIFT - pet.top) / pet.height } : null
    if (p && onPetBox(p)) act(d.tool, d.el, d.homeX, d.homeY)
    else sendHome(d.el)
  }

  const again = () => {
    const r = currentRound()
    const v = newVisit(ailmentFor(r.date, r.n))
    visitRef.current = v
    setVisit(v)
    setRound(r.n)
    setSticker(false)
    say(`pet.play.doctor.${v.ailment}`)
  }

  /** 點寵物：再說一次哪裡不舒服（6–7 歲忘了可以再聽） */
  const tapPet = () => {
    if (busyRef.current) return
    say(done ? 'pet.play.doctor.done' : `pet.play.doctor.${visitRef.current.ailment}`)
  }

  const acting = busy?.acting ? busy : null
  const pose: Pose = acting ? (acting.outcome === 'wrong' ? 'laugh' : TOOL_POSE[acting.tool]) : done ? 'cheer' : SICK_POSE[visit.ailment]
  // 擦傷：貼上 OK 繃之前擦痕都在；其他毛病看完就好了
  const showSymptom = visit.ailment === 'knee' ? !visit.bandaged : !done
  const hintFrom = useCallback(() => (glow && want ? toolRefs.current[want] ?? null : trayRef.current), [glow, want])
  const hintTo = useCallback(() => (glow && want ? spotRefs.current[TOOL_SPOT[want]] ?? null : petRef.current), [glow, want])

  return (
    <div
      ref={rootRef}
      className={`doc-root ${done ? 'is-done' : ''}`}
      data-testid="doc"
      data-age={band}
      data-ailment={visit.ailment}
      data-round={round}
      data-step={visit.step}
      data-next={want ?? ''}
      data-done={done ? '1' : '0'}
      data-busy={busy ? busy.tool : ''}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
    >
      <div ref={petRef} className="doc-pet" data-testid="doc-pet" onClick={tapPet}>
        <Companion pose={pose} size="100%" className="doc-companion" />
        {(['head', 'mouth', 'chest', 'knee'] as const).map((s) => (
          <span
            key={s}
            ref={(el) => {
              spotRefs.current[s] = el
            }}
            className={`doc-spot doc-spot-${s}`}
            style={{ left: `${SPOT_POS[s].x * 100}%`, top: `${SPOT_POS[s].y * 100}%` }}
            aria-hidden
          />
        ))}
        {showSymptom && <Symptom ailment={visit.ailment} />}
        {visit.bandaged && <Bandage />}
        {acting && acting.outcome !== 'wrong' && <Effect tool={acting.tool} />}
        {sticker && <Sticker />}
      </div>

      {done && !busy ? (
        <div className="doc-again">
          <AgainButton onClick={again} />
        </div>
      ) : (
        <div ref={trayRef} className="doc-tray" data-testid="doc-tray">
          {DOCTOR_TOOLS.map((t) => {
            const info = TOOL_INFO[t]
            const lit = glow && t === want && !busy
            const used = AILMENT_STEPS[visit.ailment].indexOf(t) > -1 && AILMENT_STEPS[visit.ailment].indexOf(t) < visit.step
            return (
              <div
                key={t}
                ref={(el) => {
                  toolRefs.current[t] = el
                }}
                className={`doc-slot ${lit ? 'lit' : ''} ${used ? 'used' : ''}`}
                data-glow={lit ? '1' : '0'}
              >
                <div className={`doc-tool ${holding === t ? 'held' : ''} ${busy?.tool === t ? 'busy' : ''}`} data-testid={`ui-doc-${t}`} role="button" aria-label={info.label} onPointerDown={(e) => grab(e, t)}>
                  <Icon name={info.icon} emoji={info.emoji} size="100%" alt="" />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {hint && <GestureHint from={hintFrom} to={hintTo} />}
    </div>
  )
}

export default function Doctor({ onExit }: GameRootProps) {
  const band = useBand()
  return (
    <GameShell id="doctor" scene="scene-town-clinic" intro="pet.play.doctor.intro" onExit={onExit}>
      {(p) => <DoctorPlay key={band} band={band} {...p} />}
    </GameShell>
  )
}

