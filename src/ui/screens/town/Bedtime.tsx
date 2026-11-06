import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getAudioContext, getAudioState, playSound, type SoundName } from '../../../learning/audioEngine'
import { BED_STEP_LINE, STORY_PAGES, STORY_PAGE_MS, brushGain, brushProgress, lullabySchedule, lullabySeconds, type BedStep } from '../../../domain/bedtime'
import { onPetBox } from '../../../domain/doctor'
import { FOOD_EMOJI } from '../../../art/items'
import { Icon } from '../../components/Icon'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell, type GameProps } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'
import { AgainButton, petHop, reducedMotion, useBand, useFinishLater, useTrackedSay } from '../playground/playU'
import { GestureHint } from '../playground/vShared'
import { useTimers } from '../playground/wHelpers'
import '../playground/playU.css'
import './bedtime.css'

// v8.4 晚安小屋：刷牙 → 換睡衣 → 聽故事或搖籃曲 → 關燈 → 睡著，點牠會翻身說夢話。
// 只是扮演：不改寵物真正的作息、不讓寵物進入睡覺狀態、不寫任何寵物資料。不分年齡檔。

/** 手指拿著東西時，東西浮在手指上面一點 */
const LIFT = 26
/** 移動超過這麼多才算拖，不然是點 */
const TAP_SLOP = 12
/** 刷牙的音效最短間隔 */
const SFX_GAP_MS = 220
/** 每一步說完一句話之後多久換下一步 */
const STEP_PAUSE_MS = 1600
/** 換步驟後多久出現手勢提示 */
const HINT_FIRST_MS = 1200
const HINT_SHOW_MS = 4400
const HINT_IDLE_MS = 6000
/** 夢話泡泡留多久 */
const DREAM_MS = 2600
/** 夢到的東西：依序輪替（不靠亂數） */
const DREAMS = ['banana', 'cake', 'apple', 'cookie', 'peach'] as const

type Tool = 'brush' | 'pajamas'

// ---- 搖籃曲：音樂盒的聲音（Web Audio 合成，音效關掉時不響） ----

function playLullaby(): () => void {
  if (!getAudioState().sfxEnabled) return () => {}
  try {
    const c = getAudioContext()
    if (!c) return () => {}
    if (c.state !== 'running') void c.resume()?.catch?.(() => {})
    const master = c.createGain()
    master.gain.value = 0.5
    master.connect(c.destination)
    const t0 = c.currentTime + 0.08
    const oscs: OscillatorNode[] = []
    for (const n of lullabySchedule()) {
      for (const [mult, vol] of [[1, 0.42], [2, 0.08]] as const) {
        const o = c.createOscillator()
        const g = c.createGain()
        o.type = 'sine'
        o.frequency.value = n.freq * mult
        const t = t0 + n.at
        const end = t + Math.max(0.35, n.dur * 1.4)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(vol, t + 0.03)
        g.gain.exponentialRampToValueAtTime(0.0001, end)
        o.connect(g).connect(master)
        o.onended = () => g.disconnect()
        o.start(t)
        o.stop(end + 0.02)
        oscs.push(o)
      }
    }
    return () => {
      try {
        const now = c.currentTime
        master.gain.setValueAtTime(master.gain.value, now)
        master.gain.linearRampToValueAtTime(0, now + 0.15)
        for (const o of oscs) o.stop(now + 0.16)
      } catch {
        /* 已經停了 */
      }
    }
  } catch {
    return () => {}
  }
}

// ---- 畫的小東西 ----

function Nightcap() {
  return (
    <svg className="bed-cap" data-testid="bed-cap" viewBox="0 0 90 70" aria-hidden>
      <path d="M8 56C14 30 34 8 62 6c10-.6 16 4 18 12-10-6-20-2-24 8-4 11-2 22 2 30z" fill="#6aa8f0" stroke="#4a86d0" strokeWidth="3" strokeLinejoin="round" />
      <path d="M30 36l2 4.400 4.700.6-3.400 3.300.8 4.700-4.100-2.200-4.200 2.200.8-4.700-3.400-3.300 4.700-.6z" fill="#ffe27a" />
      <path d="M50 18c3 0 4 2 3 4-2-1-4 0-5 2-1-3 0-6 2-6z" fill="#ffe27a" />
      <rect x="2" y="50" width="62" height="16" rx="8" fill="#fff" stroke="#d6e4f5" strokeWidth="2" />
      <circle cx="80" cy="20" r="9" fill="#fff" stroke="#d6e4f5" strokeWidth="2" />
    </svg>
  )
}

/** 故事書（沒有字，只有圖）：月亮 → 雲 → 星星 */
function StoryBook({ page }: { page: number }) {
  return (
    <span className="bed-book" data-testid="bed-story" data-page={page} aria-hidden>
      <svg viewBox="0 0 120 80">
        <path d="M60 10C46 4 22 4 6 8v64c16-4 40-4 54 2z" fill="#fff8ee" stroke="#f0b8c8" strokeWidth="3" strokeLinejoin="round" />
        <path d="M60 10c14-6 38-6 54-2v64c-16-4-40-4-54 2z" fill="#fff8ee" stroke="#f0b8c8" strokeWidth="3" strokeLinejoin="round" />
        <path d="M60 10v64" stroke="#f0b8c8" strokeWidth="3" />
        <g key={page} className="bed-book-pic">
          {page === 0 && <path d="M36 24a16 16 0 1 0 14 24 13 13 0 1 1-14-24z" fill="#ffd166" />}
          {page === 1 && <path d="M18 50c-6 0-8-9-1-10 0-8 11-10 14-4 3-5 12-4 12 3 7 0 8 11 0 11z" fill="#bcd8ff" />}
          {page === 2 && <path d="M33 22l4.300 9 9.700 1.300-7 6.800 1.700 9.600-8.700-4.700-8.700 4.700 1.700-9.600-7-6.800 9.700-1.300z" fill="#ffd166" />}
          {page === 0 && <circle cx="90" cy="40" r="5" fill="#bcd8ff" />}
          {page === 1 && <path d="M80 48c3-10 18-10 21 0z" fill="#ffd1dc" />}
          {page === 2 && <path d="M78 52c8-6 18-6 26 0" fill="none" stroke="#b99cf0" strokeWidth="4" strokeLinecap="round" />}
        </g>
      </svg>
    </span>
  )
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 48 48" width="70%" height="70%" aria-hidden>
      <path d="M18 34V10l20-5v24" fill="none" stroke="#8a6ad6" strokeWidth="4.500" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="13" cy="35" rx="7" ry="5.500" fill="#b99cf0" />
      <ellipse cx="33" cy="30" rx="7" ry="5.500" fill="#b99cf0" />
    </svg>
  )
}

interface Drag {
  id: number
  tool: Tool
  el: HTMLElement
  homeX: number
  homeY: number
  startX: number
  startY: number
  moved: boolean
  last: { x: number; y: number } | null
}

function BedtimePlay({ finish, say: rawSay }: GameProps) {
  const { rootRef, say } = useTrackedSay(rawSay)
  // 不分年齡檔；只記在畫面上給測試等資料載入
  const band = useBand()
  const finishLater = useFinishLater(finish)
  const { after, cancel } = useTimers()
  const [step, setStep] = useState<BedStep>('brush')
  const stepRef = useRef<BedStep>('brush')
  const [brush, setBrush] = useState(0)
  const brushRef = useRef(0)
  const [shiny, setShiny] = useState(false)
  const [capOn, setCapOn] = useState(false)
  const [story, setStory] = useState<'book' | 'song' | null>(null)
  const [page, setPage] = useState(0)
  const [dark, setDark] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [dream, setDream] = useState<number | null>(null)
  /** 點過睡著的寵物幾次（夢到的東西依序輪替；點過之後就不再示範） */
  const [dreams, setDreams] = useState(0)
  const [holding, setHolding] = useState<Tool | null>(null)
  const [hint, setHint] = useState(false)
  const [moving, setMoving] = useState(false)
  const petRef = useRef<HTMLDivElement>(null)
  const mouthRef = useRef<HTMLSpanElement>(null)
  const headRef = useRef<HTMLSpanElement>(null)
  const lampRef = useRef<HTMLButtonElement>(null)
  const bookRef = useRef<HTMLButtonElement>(null)
  const toolRefs = useRef<Partial<Record<Tool, HTMLDivElement | null>>>({})
  const drag = useRef<Drag | null>(null)
  const lastSfx = useRef(0)
  const stopSong = useRef<(() => void) | null>(null)
  const pageTimer = useRef<number | null>(null)
  const dreamTimer = useRef<number | null>(null)

  // 離開時搖籃曲要停
  useEffect(
    () => () => {
      stopSong.current?.()
      stopSong.current = null
    },
    [],
  )

  const goStep = useCallback(
    (s: BedStep) => {
      stepRef.current = s
      setStep(s)
      say(BED_STEP_LINE[s])
    },
    [say],
  )

  // 開場（殼說完「天黑了」）之後說第一步
  useEffect(() => {
    const id = after(2200, () => {
      if (stepRef.current === 'brush' && brushRef.current === 0) say(BED_STEP_LINE.brush)
    })
    return () => cancel(id)
  }, [after, cancel, say])

  // 手勢提示：換步驟後出現，演兩輪收起來，沒動作再出現；拿著東西或在講故事時不打擾
  const hintOn = !holding && !moving && story === null && !(step === 'asleep' && dreams > 0)
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
      id = after(HINT_IDLE_MS, show)
    }
    id = after(step === 'brush' ? 2600 : HINT_FIRST_MS, show)
    return () => cancel(id)
  }, [hintOn, step, after, cancel])

  const sfx = (name: SoundName) => {
    const now = performance.now()
    if (now - lastSfx.current < SFX_GAP_MS) return
    lastSfx.current = now
    playSound(name)
  }

  const petPoint = (x: number, y: number) => {
    const pet = petRef.current?.getBoundingClientRect()
    return pet ? { x: (x - pet.left) / pet.width, y: (y - LIFT - pet.top) / pet.height } : null
  }

  const sendHome = (el: HTMLElement) => {
    el.classList.add('flying')
    el.style.transform = ''
    after(400, () => el.classList.remove('flying'))
  }

  /** 牙刷刷好了 */
  const brushed = () => {
    setMoving(true)
    setShiny(true)
    playSound('sparkle')
    say('pet.play.bedtime.brushed')
    petHop(petRef.current, '-8%')
    after(STEP_PAUSE_MS, () => {
      setMoving(false)
      goStep('pajamas')
    })
  }

  /** 睡衣穿上：戴睡帽 */
  const dressed = (el: HTMLElement, homeX: number, homeY: number) => {
    const head = headRef.current?.getBoundingClientRect()
    setMoving(true)
    if (head) {
      el.classList.add('flying')
      el.style.transform = `translate(${head.left - homeX}px, ${head.top - homeY}px) scale(0.6)`
    }
    playSound('whoosh')
    after(reducedMotion() ? 50 : 380, () => {
      el.classList.remove('flying')
      el.style.transform = ''
      setCapOn(true)
      playSound('sparkle')
      petHop(petRef.current, '-8%')
      after(STEP_PAUSE_MS - 400, () => {
        setMoving(false)
        goStep('story')
      })
    })
  }

  const grab = (e: ReactPointerEvent<HTMLElement>, tool: Tool) => {
    if (drag.current || moving || stepRef.current !== tool) return
    const slot = toolRefs.current[tool]
    const el = slot?.querySelector<HTMLElement>('.bed-tool')
    if (!slot || !el) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 指標已經放開 */
    }
    const home = slot.getBoundingClientRect()
    drag.current = { id: e.pointerId, tool, el, homeX: home.left + home.width / 2, homeY: home.top + home.height / 2, startX: e.clientX, startY: e.clientY, moved: false, last: null }
    // 3 歲會直接在寵物嘴巴上抹：牙刷飛到手指下面
    if (e.currentTarget === petRef.current) {
      drag.current.moved = true
      setHolding(tool)
      moveTool(e.clientX, e.clientY)
    }
  }

  const moveTool = (x: number, y: number) => {
    const d = drag.current
    if (!d) return
    d.el.style.transform = `translate(${x - d.homeX}px, ${y - LIFT - d.homeY}px) scale(1.08)`
    if (d.tool !== 'brush') return
    const p = petPoint(x, y)
    if (!p) return
    const gain = d.last ? brushGain(d.last, p) : 0
    d.last = p
    if (gain <= 0) return
    sfx('tap')
    brushRef.current += gain
    setBrush(brushRef.current)
    if (brushProgress(brushRef.current) >= 1) {
      drag.current = null
      setHolding(null)
      sendHome(d.el)
      brushed()
    }
  }

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > TAP_SLOP) {
      d.moved = true
      setHolding(d.tool)
    }
    if (d.moved) moveTool(e.clientX, e.clientY)
  }

  const onEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    setHolding(null)
    if (d.tool === 'pajamas' && e.type !== 'pointercancel') {
      const p = petPoint(e.clientX, e.clientY)
      // 點一下睡衣：自己飛過去穿上（3 歲）；拖到寵物身上放開也是
      if (!d.moved || (p && onPetBox(p))) return dressed(d.el, d.homeX, d.homeY)
    }
    if (d.tool === 'brush' && !d.moved) {
      // 點牙刷：牙刷跳一下，提示要拿著刷
      playSound('tap')
      petHop(d.el, '-12%')
    }
    sendHome(d.el)
  }

  const storyDone = () => {
    stopSong.current = null
    setStory(null)
    setMoving(true)
    say('pet.play.bedtime.sleepy')
    after(STEP_PAUSE_MS + 400, () => {
      setMoving(false)
      goStep('lamp')
    })
  }

  const turnPage = (to: number) => {
    if (pageTimer.current !== null) cancel(pageTimer.current)
    if (to >= STORY_PAGES) {
      pageTimer.current = null
      storyDone()
      return
    }
    setPage(to)
    playSound('page')
    pageTimer.current = after(STORY_PAGE_MS, () => turnPage(to + 1))
  }

  const pickBook = () => {
    if (stepRef.current !== 'story' || story) return
    setStory('book')
    turnPage(0)
  }
  /** 正在講故事時點書：翻快一點 */
  const tapStory = () => {
    if (story === 'book') turnPage(page + 1)
  }

  const pickSong = () => {
    if (stepRef.current !== 'story' || story) return
    setStory('song')
    stopSong.current = playLullaby()
    after(Math.round(lullabySeconds() * 1000) + 400, storyDone)
  }

  const tapLamp = () => {
    if (stepRef.current !== 'lamp' || moving) {
      playSound('tap')
      return
    }
    playSound('tap')
    setDark(true)
    stepRef.current = 'asleep'
    setStep('asleep')
    after(reducedMotion() ? 100 : 900, () => {
      playSound('sparkle')
      say('pet.play.bedtime.night')
      finishLater()
    })
  }

  const tapPet = () => {
    if (stepRef.current !== 'asleep') return
    // 翻個身、說夢話
    setFlipped((f) => !f)
    setDreams(dreams + 1)
    setDream(dreams % DREAMS.length)
    playSound('pop')
    say('pet.play.bedtime.dream')
    if (dreamTimer.current !== null) cancel(dreamTimer.current)
    dreamTimer.current = after(DREAM_MS, () => {
      dreamTimer.current = null
      setDream(null)
    })
  }

  const again = () => {
    stopSong.current?.()
    stopSong.current = null
    brushRef.current = 0
    setBrush(0)
    setShiny(false)
    setCapOn(false)
    setStory(null)
    setPage(0)
    setDark(false)
    setFlipped(false)
    setDreams(0)
    setDream(null)
    goStep('brush')
  }

  const asleep = step === 'asleep'
  const pose: Pose = asleep ? 'sleep' : story !== null || step === 'lamp' ? 'sleepy' : holding === 'brush' ? 'laugh' : shiny && step === 'brush' ? 'cheer' : 'happy'
  const foam = step === 'brush' ? Math.min(6, Math.floor(brushProgress(brush) * 7)) : 0
  const hintFrom = useCallback((): Element | null => {
    if (step === 'brush' || step === 'pajamas') return toolRefs.current[step] ?? null
    if (step === 'story') return bookRef.current
    if (step === 'lamp') return lampRef.current
    return petRef.current
  }, [step])
  const hintTo = useCallback((): Element | null => {
    if (step === 'brush') return mouthRef.current
    if (step === 'pajamas') return headRef.current
    return hintFrom()
  }, [step, hintFrom])

  return (
    <div
      ref={rootRef}
      className={`bed-root ${dark ? 'is-dark' : ''}`}
      data-testid="bed"
      data-age={band}
      data-step={step}
      data-brush={brushProgress(brush).toFixed(2)}
      data-cap={capOn ? '1' : '0'}
      data-story={story ?? ''}
      data-dark={dark ? '1' : '0'}
      data-flipped={flipped ? '1' : '0'}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
    >
      <div className="bed-dark" data-testid="bed-dark" aria-hidden />
      {dark && (
        <div className="bed-stars" data-testid="bed-stars" aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 37) % 96 + 2}%`, top: `${(i * 23) % 44 + 4}%`, animationDelay: `${(i % 5) * 0.4}s` }} />
          ))}
        </div>
      )}

      <div className="bed-stage">
        <div className="bed-bed" data-testid="ui-bed-bed">
          <Icon name="ui-bed-bed" emoji="🛏️" size="100%" alt="" />
        </div>
        <div
          ref={petRef}
          className={`bed-pet ${asleep ? 'is-asleep' : ''} ${flipped ? 'is-flipped' : ''}`}
          data-testid="bed-pet"
          onPointerDown={(e) => (step === 'brush' ? grab(e, 'brush') : tapPet())}
        >
          <div className="bed-pet-body">
            <Companion pose={pose} size="100%" className="bed-companion" />
            <span ref={mouthRef} className="bed-spot bed-spot-mouth" aria-hidden />
            <span ref={headRef} className="bed-spot bed-spot-head" aria-hidden />
            {foam > 0 && (
              <span className="bed-foam" data-testid="bed-foam" data-n={foam} aria-hidden>
                {Array.from({ length: foam }, (_, i) => (
                  <i key={i} style={{ left: `${10 + ((i * 29) % 80)}%`, top: `${20 + ((i * 41) % 60)}%` }} />
                ))}
              </span>
            )}
            {shiny && step === 'brush' && (
              <span className="bed-shine" data-testid="bed-shine" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            )}
            {capOn && <Nightcap />}
          </div>
          {asleep && (
            <span className="bed-zzz" data-testid="bed-zzz" aria-hidden>
              <i>Z</i>
              <i>z</i>
              <i>z</i>
            </span>
          )}
          {dream !== null && (
            <span className="bed-dream" data-testid="bed-dream" aria-hidden>
              <Icon name={`food-${DREAMS[dream]}`} emoji={FOOD_EMOJI[DREAMS[dream]]} size="100%" alt="" />
            </span>
          )}
        </div>
        <button ref={lampRef} type="button" className={`bed-lamp ${step === 'lamp' ? 'ready' : ''} ${dark ? 'on' : ''}`} data-testid="ui-bed-lamp" aria-label="夜燈" onPointerDown={tapLamp}>
          <span className="bed-lamp-glow" aria-hidden />
          <Icon name="ui-bed-lamp" emoji="🌙" size="100%" alt="" />
        </button>
      </div>

      {story === 'book' && (
        <button type="button" className="bed-story-wrap" onPointerDown={tapStory} aria-label="翻下一頁">
          <StoryBook page={page} />
        </button>
      )}
      {story === 'song' && (
        <span className="bed-notes" data-testid="bed-notes" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.7}s`, left: `${i * 22}%` }}>
              <NoteIcon />
            </i>
          ))}
        </span>
      )}

      {asleep ? (
        <div className="bed-again">
          <AgainButton onClick={again} />
        </div>
      ) : (
        <div className="bed-tray" data-testid="bed-tray">
          {(['brush', 'pajamas'] as const).map((t) => (
            <div
              key={t}
              ref={(el) => {
                toolRefs.current[t] = el
              }}
              className={`bed-slot ${step === t && !moving ? 'active' : ''}`}
            >
              <div className={`bed-tool ${holding === t ? 'held' : ''}`} data-testid={`ui-bed-${t}`} role="button" aria-label={t === 'brush' ? '牙刷' : '睡衣'} onPointerDown={(e) => grab(e, t)}>
                <Icon name={`ui-bed-${t}`} emoji={t === 'brush' ? '🪥' : '👕'} size="100%" alt="" />
              </div>
            </div>
          ))}
          <div className={`bed-slot ${step === 'story' && !story ? 'active' : ''}`}>
            <button ref={bookRef} type="button" className="bed-tool bed-pick" data-testid="ui-bed-book" aria-label="故事書" onPointerDown={pickBook}>
              <Icon name="ui-bed-book" emoji="📖" size="100%" alt="" />
            </button>
          </div>
          <div className={`bed-slot ${step === 'story' && !story ? 'active' : ''}`}>
            <button type="button" className="bed-tool bed-pick bed-song" data-testid="bed-song" aria-label="唱搖籃曲" onPointerDown={pickSong}>
              <NoteIcon />
            </button>
          </div>
        </div>
      )}

      {hint && <GestureHint from={hintFrom} to={hintTo} />}
    </div>
  )
}

export default function Bedtime({ onExit }: GameRootProps) {
  return (
    <GameShell id="bedtime" scene="scene-town-bedroom" intro="pet.play.bedtime.intro" onExit={onExit}>
      {(p) => <BedtimePlay {...p} />}
    </GameShell>
  )
}
