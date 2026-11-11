import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { unlockAudio } from '../../../learning/audioEngine'
import { playBell, playDrum, playMeow, playXylophone, type DrumKind } from '../../../learning/instruments'
import { FREE_PLAY_GOAL, MUSIC_NOTES, NOTE_COLOR, NOTE_FREQ, anyKeyAdvances, nextNote, songStep, songsFor, voicesFor, type MusicNote, type MusicVoice, type Song, type SongId } from '../../../domain/music'
import { Icon } from '../../components/Icon'
import { useLearnerProfile, useLearningSettings } from '../../learningHooks'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell, type GameProps } from './GameShell'
import type { GameRootProps } from './GameScreen'
import { TapHint, useReducedMotion, useTimers } from './wHelpers'
import './pg-music.css'

export default function Music({ onExit }: GameRootProps) {
  return (
    <GameShell id="music" scene="scene-play-music" intro="pet.play.music.intro" onExit={onExit}>
      {(p) => <MusicGame {...p} />}
    </GameShell>
  )
}

const DANCE_MS = 900
const FINISH_DELAY_MS = 1800
/**
 * 玩完了但手還在敲：等停下來這麼久才跳禮物。禮物是整片可點的浮層，
 * 敲到一半跳出來會被下一下（甚至這一下放開的手指）直接點掉，孩子根本沒看到；也不該打斷演奏。
 */
const FINISH_QUIET_MS = 900
const BIG_DANCE_MS = 3400
const HAND_AFTER_MS = 4000
/** 魔法演奏（任何鍵都前進）時，幾乎同時按下的多根手指或手掌只算一下：旋律不會被一掌跳過好幾個音 */
const SAME_PRESS_MS = 45
const MAX_NOTES = 14
/** 換聲音時試聽的那個音 */
const VOICE_PREVIEW: MusicNote = 'G5'

/** v8.5 木琴鍵用哪種聲音發聲（鼓不變） */
function playKey(voice: MusicVoice, freq: number): void {
  if (voice === 'bell') playBell(freq)
  else if (voice === 'cat') playMeow(freq)
  else playXylophone(freq)
}
const VOICE_LABEL: Record<MusicVoice, string> = { xylo: '木琴的聲音', bell: '鈴鐺的聲音', cat: '喵喵的聲音' }

interface Fly {
  id: number
  x: number
  y: number
  color: string
}

function MusicGame({ finish, say, toys }: GameProps) {
  const { ageBand } = useLearnerProfile()
  const { soundOn } = useLearningSettings()
  const reduced = useReducedMotion()
  const { after, cancel } = useTimers()

  const [song, setSong] = useState<Song | null>(null)
  const [index, setIndex] = useState(0)
  const [dancing, setDancing] = useState(false)
  const [big, setBig] = useState(false)
  const [fly, setFly] = useState<Fly[]>([])
  const [hint, setHint] = useState(false)
  const [last, setLast] = useState<string>('')
  const [free, setFree] = useState(0)
  // v8.5：玩完第 1 次多兩首歌（歌卡變成只有圖的小卡），第 3 次可以換聲音
  const songs = songsFor(toys)
  const voices = voicesFor(toys)
  const [voice, setVoice] = useState<MusicVoice>('xylo')

  const rootRef = useRef<HTMLDivElement>(null)
  const petRef = useRef<HTMLDivElement>(null)
  const keyRefs = useRef(new Map<string, HTMLElement>())
  // 同一個 tick 裡的多指不等重畫，所以聲音與進度的判斷都看這包 ref
  const live = useRef({
    cur: null as { song: Song; index: number } | null,
    soundOn: true,
    band: ageBand,
    voice: 'xylo' as MusicVoice,
    meowSaid: false,
    free: 0,
    freeDone: false,
    lastAdvanceAt: -Infinity,
    nextFly: 1,
    danceTimer: null as number | null,
    hintTimer: null as number | null,
    celebrate: [] as number[],
    pendingFinish: null as number | null,
  })
  const finishRef = useRef(finish)
  useEffect(() => {
    live.current.soundOn = soundOn
    live.current.band = ageBand
    finishRef.current = finish
  }, [soundOn, ageBand, finish])

  // 這麼久沒敲就示範一下：自由彈指中間的鍵，魔法演奏指下一個音
  useEffect(() => {
    const id = after(HAND_AFTER_MS, () => setHint(true))
    const s = live.current
    s.hintTimer = id
    return () => {
      cancel(id)
      s.hintTimer = null
    }
  }, [song, after, cancel])

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

  const flash = (name: string, color: string) => {
    const el = keyRefs.current.get(name)
    const bar = el?.querySelector<HTMLElement>('[data-bar]')
    if (!el || !bar) return
    // 只動 opacity 與 transform。不要動畫 filter：WebKit 動畫 filter 會讓整個 App 閃退（CAPresentationModifier，實測重現過）
    el.querySelector<HTMLElement>('[data-flash]')?.animate?.([{ opacity: 0.6 }, { opacity: 0 }], { duration: 220, easing: 'ease-out' })
    if (!reduced) bar.animate?.([{ transform: 'translateY(4px) scale(0.97)' }, { transform: 'none' }], { duration: 200, easing: 'ease-out' })
    const root = rootRef.current
    if (!root) return
    const r = el.getBoundingClientRect()
    const o = root.getBoundingClientRect()
    const s = live.current
    const item: Fly = { id: s.nextFly++, x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height * 0.3, color }
    setFly((list) => [...list.slice(-(MAX_NOTES - 1)), item])
  }

  const dance = () => {
    const s = live.current
    cancel(s.danceTimer)
    setDancing(true)
    s.danceTimer = after(DANCE_MS, () => setDancing(false))
    if (!reduced) petRef.current?.animate?.([{ transform: 'none' }, { transform: 'translateY(-9%) rotate(-3deg)' }, { transform: 'none' }], { duration: 240, easing: 'ease-out' })
  }

  const armFinish = (ms: number) => {
    const s = live.current
    cancel(s.pendingFinish)
    s.pendingFinish = after(ms, () => {
      s.pendingFinish = null
      finishRef.current()
    })
  }

  const countFree = () => {
    const s = live.current
    s.free++
    setFree(s.free)
    if (!s.freeDone && s.free >= FREE_PLAY_GOAL) {
      s.freeDone = true
      armFinish(FINISH_QUIET_MS)
    }
  }

  const touched = () => {
    const s = live.current
    cancel(s.hintTimer)
    s.hintTimer = null
    setHint(false)
    unlockAudio()
    if (s.pendingFinish !== null) armFinish(FINISH_QUIET_MS)
  }

  const celebrate = () => {
    const s = live.current
    s.cur = null
    setBig(true)
    say('pet.play.music.song')
    armFinish(FINISH_DELAY_MS)
    s.celebrate.push(
      after(BIG_DANCE_MS, () => {
        setBig(false)
        setSong(null)
        setIndex(0)
      }),
    )
  }

  const pressKey = (pressed: MusicNote) => {
    touched()
    const s = live.current
    const cur = s.cur
    if (cur) {
      if (anyKeyAdvances(s.band) && performance.now() - s.lastAdvanceAt < SAME_PRESS_MS) return
      const r = songStep(cur.song, cur.index, pressed, s.band)
      if (s.soundOn) playKey(s.voice, NOTE_FREQ[r.play])
      setLast(r.play)
      if (r.advanced) {
        s.lastAdvanceAt = performance.now()
        cur.index = r.index
        setIndex(r.index)
      }
      flash(r.play, NOTE_COLOR[r.play])
      dance()
      if (r.done) celebrate()
      return
    }
    if (s.soundOn) playKey(s.voice, NOTE_FREQ[pressed])
    setLast(pressed)
    flash(pressed, NOTE_COLOR[pressed])
    dance()
    countFree()
  }

  const pressDrum = (kind: DrumKind) => {
    touched()
    const s = live.current
    if (s.soundOn) playDrum(kind)
    setLast(`drum-${kind}`)
    flash(`drum-${kind}`, kind === 'low' ? '#e8743b' : '#3f9fe6')
    dance()
    if (!s.cur) countFree()
  }

  const pickSong = (id: SongId) => {
    const s = live.current
    // 正在演彈完的慶祝：把排好的收場取消，禮物照送
    s.celebrate.forEach(cancel)
    s.celebrate = []
    setBig(false)
    if (s.cur?.song.id === id) {
      // 再點一次選中的歌卡 = 回到自由彈
      s.cur = null
      setSong(null)
      setIndex(0)
      return
    }
    const next = songs.find((x) => x.id === id) ?? null
    s.cur = next ? { song: next, index: 0 } : null
    s.lastAdvanceAt = -Infinity
    setSong(next)
    setIndex(0)
  }

  /** v8.5 換聲音：馬上用新的聲音彈一個音給孩子聽。不算自由彈的下數，也不動正在彈的歌 */
  const pickVoice = (v: MusicVoice) => {
    touched()
    const s = live.current
    s.voice = v
    setVoice(v)
    if (s.soundOn) playKey(v, NOTE_FREQ[VOICE_PREVIEW])
    dance()
    if (v === 'cat' && !s.meowSaid) {
      s.meowSaid = true
      say('pet.play.music.meow')
    }
  }

  const lit = song && !big ? nextNote(song, index) : null
  const hintKey: MusicNote = lit ?? 'F5'
  const pose: Pose = big || dancing ? 'dance' : 'happy'

  return (
    <div
      className={`pg-mus ${song && !big ? 'is-song' : ''}`}
      ref={rootRef}
      data-testid="pg-mus"
      data-mode={song ? song.id : 'free'}
      data-index={index}
      data-total={song ? song.notes.length : 0}
      data-next={lit ?? ''}
      data-last={last}
      data-free={free}
      data-big={big ? '1' : undefined}
      data-age={ageBand}
      data-voice={voice}
      onPointerUp={unlockAudio}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={`pg-mus-cards ${songs.length > 2 ? 'is-many' : ''}`}>
        {songs.map((x) => (
          <button key={x.id} type="button" className={`pg-mus-card ${song?.id === x.id ? 'is-on' : ''}`} onClick={() => pickSong(x.id)} aria-pressed={song?.id === x.id} aria-label={x.title} data-testid={`pg-mus-song-${x.id}`}>
            <span className="pg-mus-card-art" aria-hidden>
              {SONG_ART[x.id]}
            </span>
            <span className="pg-mus-card-title">{x.title}</span>
          </button>
        ))}
      </div>

      <div className="pg-mus-progress" data-testid="pg-mus-progress" aria-hidden>
        {song?.notes.map((note, i) => (
          <i key={i} className={i < index ? 'is-done' : i === index ? 'is-next' : ''} style={{ '--c': NOTE_COLOR[note] } as CSSProperties} />
        ))}
      </div>

      <div className="pg-mus-stage">
        <Drum kind="low" onPress={pressDrum} keyRefs={keyRefs.current} />
        <div className={`pg-mus-pet ${big ? 'is-big' : ''}`} ref={petRef}>
          <Companion pose={pose} size="100%" />
        </div>
        <Drum kind="high" onPress={pressDrum} keyRefs={keyRefs.current} />
        {voices.length > 0 && (
          <div className="pg-mus-voices" role="group" aria-label="換聲音" data-testid="pg-mus-voices">
            {voices.map((v) => (
              <button
                key={v}
                type="button"
                className={`pg-mus-voice ${voice === v ? 'is-on' : ''}`}
                onPointerDown={(e) => {
                  if (e.button === 0) pickVoice(v)
                }}
                onClick={(e) => {
                  // 鍵盤（detail 0）；手指與滑鼠在 pointerdown 就換了
                  if (e.detail === 0) pickVoice(v)
                }}
                aria-pressed={voice === v}
                aria-label={VOICE_LABEL[v]}
                data-no-tap
                data-testid={`pg-mus-voice-${v}`}
              >
                {v === 'xylo' ? <XyloArt /> : <Icon name={v === 'bell' ? 'ui-music-bell' : 'ui-music-cat'} emoji={v === 'bell' ? '🔔' : '🐱'} size="100%" alt="" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pg-mus-xylo" data-testid="pg-mus-xylo">
        <span className="pg-mus-rail is-a" aria-hidden />
        <span className="pg-mus-rail is-b" aria-hidden />
        {MUSIC_NOTES.map((note, i) => (
          <button
            key={note}
            type="button"
            ref={(el) => {
              if (el) keyRefs.current.set(note, el)
              else keyRefs.current.delete(note)
            }}
            className={`pg-mus-key ${lit === note ? 'is-lit' : ''}`}
            style={{ '--c': NOTE_COLOR[note], '--len': `${100 - i * 3.6}%` } as CSSProperties}
            onPointerDown={(e) => {
              if (e.button === 0) pressKey(note)
            }}
            onClick={(e) => {
              // 鍵盤（detail 0）；手指與滑鼠在 pointerdown 就發聲了
              if (e.detail === 0) pressKey(note)
            }}
            aria-label={`木琴第 ${i + 1} 鍵`}
            data-no-tap
            data-testid={`pg-mus-key-${note}`}
            data-lit={lit === note ? '1' : undefined}
          >
            <span className="pg-mus-bar" data-bar>
              <span className="pg-mus-flash" data-flash />
              <span className="pg-mus-peg" />
              <span className="pg-mus-peg" />
            </span>
            {hint && note === hintKey && <TapHint />}
          </button>
        ))}
      </div>

      <div className="pg-mus-fx" aria-hidden>
        {fly.map((f) => (
          <span key={f.id} className="pg-mus-note" style={{ left: f.x, top: f.y, color: f.color }} data-testid="pg-mus-note" onAnimationEnd={() => setFly((list) => list.filter((x) => x.id !== f.id))}>
            <svg viewBox="0 0 40 48" width="100%" height="100%">
              <ellipse cx="13" cy="39" rx="11" ry="8" fill="currentColor" transform="rotate(-18 13 39)" />
              <path d="M22 37V6c6 5 14 6 14 16" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </span>
        ))}
      </div>
    </div>
  )
}

function Drum({ kind, onPress, keyRefs }: { kind: DrumKind; onPress: (k: DrumKind) => void; keyRefs: Map<string, HTMLElement> }) {
  return (
    <button
      type="button"
      className={`pg-mus-drum is-${kind}`}
      ref={(el) => {
        if (el) keyRefs.set(`drum-${kind}`, el)
        else keyRefs.delete(`drum-${kind}`)
      }}
      onPointerDown={(e) => {
        if (e.button === 0) onPress(kind)
      }}
      onClick={(e) => {
        if (e.detail === 0) onPress(kind)
      }}
      aria-label={kind === 'low' ? '大鼓' : '小鼓'}
      data-no-tap
      data-testid={`pg-mus-drum-${kind}`}
    >
      <span className="pg-mus-drum-body" data-bar>
        <span className="pg-mus-drum-head">
          <span className="pg-mus-flash" data-flash />
        </span>
      </span>
    </button>
  )
}

const StarArt = () => (
  <svg viewBox="0 0 64 64" width="100%" height="100%">
    <path d="M32 5l8.5 17.500L60 25 46 39l3.5 19.500L32 49l-17.5 9.500L18 39 4 25l19.5-2.500z" fill="#ffd34d" stroke="#e8a92a" strokeWidth="3" strokeLinejoin="round" />
    <circle cx="25" cy="30" r="2.8" fill="#5a4a3f" />
    <circle cx="39" cy="30" r="2.8" fill="#5a4a3f" />
    <path d="M26 38q6 5 12 0" fill="none" stroke="#5a4a3f" strokeWidth="3" strokeLinecap="round" />
  </svg>
)

const TigerArt = () => (
  <svg viewBox="0 0 64 64" width="100%" height="100%">
    <circle cx="14" cy="16" r="9" fill="#f59a3c" />
    <circle cx="50" cy="16" r="9" fill="#f59a3c" />
    <circle cx="32" cy="34" r="25" fill="#f59a3c" />
    <ellipse cx="32" cy="44" rx="14" ry="11" fill="#fff3df" />
    <path d="M32 10v9M24 12l2 8M40 12l-2 8M8 34h8M48 34h8M10 42l7-2M54 42l-7-2" stroke="#5a3a1f" strokeWidth="3.5" strokeLinecap="round" />
    <circle cx="23" cy="31" r="3" fill="#3a2a1f" />
    <circle cx="41" cy="31" r="3" fill="#3a2a1f" />
    <ellipse cx="32" cy="40" rx="3.5" ry="2.5" fill="#3a2a1f" />
    <path d="M26 46q6 4 12 0" fill="none" stroke="#3a2a1f" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
)

/** v8.5 瑪莉有隻小綿羊 */
const LambArt = () => (
  <svg viewBox="0 0 64 64" width="100%" height="100%">
    <path d="M22 50v9M42 50v9" stroke="#5a4a3f" strokeWidth="5" strokeLinecap="round" />
    <g fill="#fff" stroke="#d9cfc4" strokeWidth="2.5">
      <circle cx="20" cy="34" r="11" />
      <circle cx="44" cy="34" r="11" />
      <circle cx="26" cy="24" r="11" />
      <circle cx="40" cy="24" r="11" />
      <circle cx="32" cy="42" r="12" />
    </g>
    <circle cx="32" cy="33" r="13" fill="#fff" />
    <ellipse cx="13" cy="33" rx="5" ry="3.5" fill="#5a4a3f" transform="rotate(-24 13 33)" />
    <ellipse cx="51" cy="33" rx="5" ry="3.5" fill="#5a4a3f" transform="rotate(24 51 33)" />
    <ellipse cx="32" cy="38" rx="11" ry="12" fill="#5a4a3f" />
    <circle cx="27.5" cy="35" r="2.4" fill="#fff" />
    <circle cx="36.5" cy="35" r="2.4" fill="#fff" />
    <path d="M28 43q4 3 8 0" fill="none" stroke="#ffb7c8" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="32" cy="20" r="6" fill="#fff" stroke="#d9cfc4" strokeWidth="2.5" />
  </svg>
)

/** v8.5 倫敦鐵橋 */
const BridgeArt = () => (
  <svg viewBox="0 0 64 64" width="100%" height="100%">
    <path d="M2 50h60v8H2z" fill="#6fc3ee" />
    <path d="M2 53q5-4 10 0t10 0 10 0 10 0 10 0 10 0" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
    <path d="M4 40h56v7H4z" fill="#8a6a55" />
    <path d="M14 24q18 14 36 0" fill="none" stroke="#e8743b" strokeWidth="3" strokeLinecap="round" />
    <path d="M4 38l10-14M60 38L50 24" fill="none" stroke="#e8743b" strokeWidth="3" strokeLinecap="round" />
    <g fill="#f6c36b" stroke="#c98f3a" strokeWidth="2" strokeLinejoin="round">
      <path d="M10 50V20l5-9 5 9v30z" />
      <path d="M44 50V20l5-9 5 9v30z" />
    </g>
    <path d="M13 44v-5a2 2 0 0 1 4 0v5zM47 44v-5a2 2 0 0 1 4 0v5z" fill="#5a4a3f" />
    <rect x="13" y="24" width="4" height="6" rx="1.5" fill="#fff8ec" />
    <rect x="47" y="24" width="4" height="6" rx="1.5" fill="#fff8ec" />
  </svg>
)

const SONG_ART: Record<SongId, JSX.Element> = { twinkle: <StarArt />, tigers: <TigerArt />, mary: <LambArt />, bridge: <BridgeArt /> }

/** v8.5 換聲音的「木琴」按鈕：三根彩色的琴鍵 */
const XyloArt = () => (
  <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden>
    <path d="M6 20l52 8M6 46l52-6" stroke="#8a6a48" strokeWidth="4" strokeLinecap="round" />
    <rect x="9" y="12" width="12" height="42" rx="5" fill="#ef5350" />
    <rect x="26" y="15" width="12" height="36" rx="5" fill="#f7c631" />
    <rect x="43" y="18" width="12" height="30" rx="5" fill="#3f9fe6" />
    <g fill="#fff" opacity="0.8">
      <circle cx="15" cy="21" r="2" />
      <circle cx="15" cy="45" r="2" />
      <circle cx="32" cy="23" r="2" />
      <circle cx="32" cy="43" r="2" />
      <circle cx="49" cy="25" r="2" />
      <circle cx="49" cy="41" r="2" />
    </g>
  </svg>
)
