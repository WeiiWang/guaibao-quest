import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import {
  ANIMAL_EMOJI,
  AUTO_SPEED,
  CROSS_HALF,
  CROSS_S,
  FOLLOW_SPEED,
  LIGHT_S,
  ROAD_W,
  SPURS,
  STOP_S,
  BOARD_MS,
  OFF_MS,
  advance,
  angleToView,
  autoDrive,
  carPose,
  crossProgress,
  crosserAt,
  driveLimit,
  hasSpurs,
  lightColor,
  loopAt,
  loopPath,
  moveToward,
  offsetPt,
  riderAt,
  spurAt,
  startDrive,
  stepDrive,
  toView,
  viewSize,
  type DriveCue,
  type DriveState,
  type Pt,
} from '../../../domain/drive'
import type { AgeBand } from '../../../domain/types'
import { playSound } from '../../../learning/audioEngine'
import { Icon } from '../../components/Icon'
import { useLearningSettings } from '../../learningHooks'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell, type GameProps } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'
import { reducedMotion, useBand, useFinishLater, useTrackedSay } from '../playground/playU'
import { GestureHint } from '../playground/vShared'
import { ArtOr, CarTopSvg, HouseSvg, useSceneOk } from './aaArt'
import { playHorn } from './aaSfx'
import './drive.css'

// 開車兜風：俯視的小鎮，手指拖著小車沿路開。紅綠燈、斑馬線、站牌載客都是 domain/drive.ts 的純函式決定，畫面只負責畫。
// 沒有撞車、沒有失敗、沒有計時。

export default function Drive({ onExit }: GameRootProps) {
  return (
    <GameShell id="drive" scene="scene-town-map" intro="pet.play.drive.intro" onExit={onExit}>
      {(p) => <DriveBand {...p} />}
    </GameShell>
  )
}

/** 年齡載入後重新開始（年齡是非同步讀進來的） */
function DriveBand(p: GameProps) {
  const band = useBand()
  return <DriveGame key={band} band={band} {...p} />
}

const usePortrait = () => {
  const read = () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth
  const [portrait, setPortrait] = useState(read)
  useEffect(() => {
    const on = () => setPortrait(read())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return portrait
}

const deg = (a: number) => (a * 180) / Math.PI
const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })
const ease = (k: number) => 1 - (1 - k) * (1 - k)

/** 乘客等車的位置（站牌旁邊的人行道） */
const WAIT_AT = offsetPt(loopAt(STOP_S - 26), ROAD_W / 2 + 46)
/** 3–5 歲下車的位置 */
const OFF_AT = offsetPt(loopAt(STOP_S + 64), ROAD_W / 2 + 50)

function DriveGame({ band, say: rawSay, finish }: GameProps & { band: AgeBand }) {
  const { soundOn } = useLearningSettings()
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const portrait = usePortrait()
  const sceneOk = useSceneOk('scene-town-map')
  const spurs = hasSpurs(band)
  const auto = autoDrive(band)
  const view = viewSize(portrait)

  const st = useRef<DriveState>(startDrive(band))
  const [, setFrame] = useState(0)
  const [moved, setMoved] = useState(false)
  const [pose, setPose] = useState<Pose>('happy')
  const poseTimer = useRef<number | null>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const carRef = useRef<HTMLDivElement>(null)
  const aheadRef = useRef<HTMLSpanElement>(null)
  const petRef = useRef<HTMLDivElement>(null)
  /** 正在開車的那根手指（只認一根；喇叭是另一個按鈕，可以同時按） */
  const finger = useRef<{ id: number; at: Pt } | null>(null)
  const lastTick = useRef(performance.now())
  const soundRef = useRef(soundOn)
  soundRef.current = soundOn

  const flashPose = useCallback((p: Pose, ms: number) => {
    setPose(p)
    if (poseTimer.current !== null) window.clearTimeout(poseTimer.current)
    poseTimer.current = window.setTimeout(() => {
      poseTimer.current = null
      setPose('happy')
    }, ms)
  }, [])
  useEffect(
    () => () => {
      if (poseTimer.current !== null) window.clearTimeout(poseTimer.current)
    },
    [],
  )

  const onCues = useCallback(
    (cues: DriveCue[]) => {
      for (const c of cues) {
        say(`pet.play.drive.${c}`)
        if (c === 'red') {
          if (poseTimer.current !== null) window.clearTimeout(poseTimer.current)
          poseTimer.current = null
          setPose('think')
        } else if (c === 'green') flashPose('cheer', 900)
        else if (c === 'rider') {
          playSound('pop')
          flashPose('cheer', 900)
        } else if (c === 'arrive') {
          playSound('correct')
          flashPose('dance', 1800)
          finishLater()
        } else if (c === 'cross') setPose('happy')
      }
    },
    [say, flashPose, finishLater],
  )

  /** 推進一步：車子跟著手指（或 3 歲按著自己開），再看路上發生什麼事 */
  const step = useCallback(
    (now: number) => {
      const dt = Math.min(0.12, Math.max(0, (now - lastTick.current) / 1000))
      lastTick.current = now
      const s0 = st.current
      let car = s0.car
      const f = finger.current
      if (f) {
        const lim = driveLimit(s0, now)
        car = auto ? advance(car, AUTO_SPEED * dt, lim) : moveToward(car, f.at, lim, spurs, FOLLOW_SPEED * Math.max(dt, 0.016))
      }
      const r = stepDrive({ ...s0, car }, now)
      st.current = r.st
      if (r.cues.length) onCues(r.cues)
      if (car !== s0.car || r.st !== s0) setFrame((n) => (n + 1) % 1e9)
    },
    [auto, spurs, onCues],
  )

  // 計時：有動靜時每一幀，平常 100ms 看一次（無頭 WebKit 不跑 requestAnimationFrame，靠 interval 也能動）
  useEffect(() => {
    let raf = 0
    let alive = true
    const busy = () => {
      const s = st.current
      const now = performance.now()
      return !!finger.current || s.rider.phase === 'board' || s.rider.phase === 'off' || crossProgress(s, now) !== null
    }
    const loop = () => {
      raf = 0
      if (!alive) return
      step(performance.now())
      if (busy()) raf = requestAnimationFrame(loop)
    }
    const iv = window.setInterval(() => {
      step(performance.now())
      if (busy() && !raf) raf = requestAnimationFrame(loop)
    }, 100)
    return () => {
      alive = false
      window.clearInterval(iv)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [step])

  /** 螢幕座標 → 世界座標（直向畫面 x、y 對調） */
  const toWorld = (cx: number, cy: number): Pt | null => {
    const r = mapRef.current?.getBoundingClientRect()
    if (!r || !r.width) return null
    const vx = ((cx - r.left) / r.width) * view.w
    const vy = ((cy - r.top) / r.height) * view.h
    return portrait ? { x: vy, y: vx } : { x: vx, y: vy }
  }

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (finger.current) return
    const p = toWorld(e.clientX, e.clientY)
    if (!p) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    lastTick.current = performance.now()
    finger.current = { id: e.pointerId, at: p }
    if (!moved) setMoved(true)
    step(performance.now())
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const f = finger.current
    if (!f || f.id !== e.pointerId) return
    const p = toWorld(e.clientX, e.clientY)
    if (!p) return
    if (auto) {
      // 3 歲：手指往哪裡拖都算往前開
      const d = Math.min(40, Math.hypot(p.x - f.at.x, p.y - f.at.y))
      const s0 = st.current
      st.current = { ...s0, car: advance(s0.car, d * 0.6, driveLimit(s0, performance.now())) }
    }
    f.at = p
    step(performance.now())
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (finger.current?.id !== e.pointerId) return
    finger.current = null
    setFrame((n) => n + 1)
  }

  const honk = () => {
    if (soundRef.current) playHorn()
    flashPose('laugh', 700)
    const el = carRef.current
    if (el && typeof el.animate === 'function' && !reducedMotion()) el.animate([{ scale: '1' }, { scale: '1.18' }, { scale: '1' }], { duration: 260, easing: 'ease-out' })
    if (el) el.dataset.honks = String(Number(el.dataset.honks ?? 0) + 1)
  }

  // ---------- 畫面 ----------
  const now = performance.now()
  const s = st.current
  const pct = (p: Pt): CSSProperties => {
    const v = toView(p, portrait)
    return { left: `${(v.x / view.w) * 100}%`, top: `${(v.y / view.h) * 100}%` }
  }
  const size = (w: number): CSSProperties => ({ width: `${(w / view.w) * 100}%` })
  const light = lightColor(s, now)
  const cp = carPose(s.car)
  const carAngle = deg(angleToView(cp.a, portrait)) + 90
  const crossK = crossProgress(s, now)
  const rider = s.rider
  const who = riderAt(rider.n)
  // 前面一點的路（手勢示範的終點；e2e 也用它當手指要去的地方）
  const ahead = s.car.spur < 0 ? loopAt(s.car.s + 70) : spurAt(s.car.spur, s.car.t + 50)

  let riderPos: Pt | null = null
  if (rider.phase === 'wait') riderPos = WAIT_AT
  else if (rider.phase === 'board') riderPos = lerp(WAIT_AT, cp, ease(Math.min(1, (now - rider.at) / (BOARD_MS * 0.75))))
  else if (rider.phase === 'off') riderPos = lerp(cp, s.car.spur >= 0 ? SPURS[s.car.spur].houseAt : OFF_AT, ease(Math.min(1, (now - rider.at) / (OFF_MS * 0.75))))
  const riding = rider.phase === 'ride'
  const offFade = rider.phase === 'off' ? Math.max(0, 1 - (now - rider.at) / OFF_MS) : 1

  const lightAt = offsetPt(loopAt(LIGHT_S + 14), ROAD_W / 2 + 68)
  const stopSign = offsetPt(loopAt(STOP_S + 20), ROAD_W / 2 + 30)
  const crossAt = loopAt(CROSS_S)
  const crosser = s.cross ? crosserAt(s.cross.n) : null
  const crosserPos = crossK !== null ? lerp(offsetPt(crossAt, ROAD_W / 2 + 34), offsetPt(crossAt, -(ROAD_W / 2 + 34)), crossK) : null

  const road = useMemo(() => <RoadLayer portrait={portrait} spurs={spurs} />, [portrait, spurs])
  const carEl = useCallback(() => carRef.current, [])
  const aheadEl = useCallback(() => aheadRef.current, [])

  return (
    <div
      className="drive-root"
      ref={rootRef}
      data-testid="drive"
      data-band={band}
      data-s={Math.round(s.car.s)}
      data-spur={s.car.spur}
      data-light={light}
      data-rider={rider.phase}
      data-served={s.served}
      data-want={spurs && (riding || rider.phase === 'board') ? who.house : undefined}
      data-cross={crossK !== null ? '1' : undefined}
      data-portrait={portrait ? '1' : '0'}
      data-scene={sceneOk === false ? 'none' : 'ok'}
      style={{ '--drive-ar': `${view.w} / ${view.h}`, '--drive-arn': view.w / view.h } as CSSProperties}
    >
      <div className="drive-map" ref={mapRef} data-testid="drive-map" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {road}

        {/* 6–7 歲：三棟房子 */}
        {spurs &&
          SPURS.map((sp) => (
            <div key={sp.house} className="drive-sprite drive-house" style={{ ...pct(sp.houseAt), ...size(104) }} data-testid={`drive-house-${sp.house}`} data-house={sp.house}>
              <ArtOr name={`ui-drive-house-${sp.house}`}>
                <HouseSvg color={sp.house} />
              </ArtOr>
            </div>
          ))}

        {/* 紅綠燈（圓角、三個燈） */}
        <div className="drive-sprite drive-light" style={{ ...pct(lightAt), ...size(46) }} data-testid="drive-light" data-color={light} aria-label={light === 'green' ? '綠燈' : light === 'red' ? '紅燈' : '黃燈'} role="img">
          <svg viewBox="0 0 40 100" width="100%" height="100%" aria-hidden>
            <rect x="17" y="70" width="6" height="30" rx="3" fill="#7b7884" />
            <rect x="2" y="2" width="36" height="74" rx="16" fill="#4a4752" stroke="#35333c" strokeWidth="2" />
            <circle cx="20" cy="18" r="10" fill={light === 'red' ? '#ff5a52' : '#6b3b3b'} />
            <circle cx="20" cy="39" r="10" fill={light === 'yellow' ? '#ffd23f' : '#6b5d33'} />
            <circle cx="20" cy="60" r="10" fill={light === 'green' ? '#4be07a' : '#2f5a3c'} />
          </svg>
        </div>

        {/* 站牌 */}
        <div className="drive-sprite drive-stop" style={{ ...pct(stopSign), ...size(40) }} data-testid="drive-stop" aria-hidden>
          <svg viewBox="0 0 40 90" width="100%" height="100%">
            <rect x="17" y="30" width="6" height="58" rx="3" fill="#7b7884" />
            <circle cx="20" cy="20" r="17" fill="#4f8fe0" stroke="#fff" strokeWidth="4" />
            <rect x="11" y="15" width="18" height="10" rx="3" fill="#fff" />
          </svg>
        </div>

        {/* 等車、上車、下車中的乘客 */}
        {riderPos && (
          <div key={`rider-${rider.n}`} className="drive-sprite drive-rider" style={{ ...pct(riderPos), ...size(62), opacity: offFade }} data-testid="drive-rider" data-phase={rider.phase}>
            <Icon name={who.animal} emoji={ANIMAL_EMOJI[who.animal]} size="100%" alt="" />
          </div>
        )}

        {/* 過馬路的小動物 */}
        {crosser && crosserPos && (
          <div className="drive-sprite drive-crosser" style={{ ...pct(crosserPos), ...size(60) }} data-testid="drive-crosser" data-animal={crosser}>
            <Icon name={crosser} emoji={ANIMAL_EMOJI[crosser]} size="100%" alt="" />
          </div>
        )}

        {/* 寵物：在環線中間的草地上看你開車 */}
        <div className="drive-sprite drive-pet" ref={petRef} style={{ ...pct({ x: 500, y: 380 }), ...size(portrait ? 200 : 210) }} onPointerDown={(e) => e.stopPropagation()} data-testid="drive-pet">
          <Companion pose={pose} size="100%" />
        </div>

        {/* 小車 */}
        <div className="drive-sprite drive-car" ref={carRef} style={{ ...pct(cp), ...size(96) }} data-testid="drive-car">
          <div className="drive-car-body" style={{ transform: `rotate(${carAngle}deg)` }}>
            <ArtOr name="ui-car-top" alt="小車">
              <CarTopSvg />
            </ArtOr>
          </div>
          {riding && (
            <span className="drive-seat" data-testid="drive-seat" data-animal={who.animal}>
              <Icon name={who.animal} emoji={ANIMAL_EMOJI[who.animal]} size="100%" alt="" />
            </span>
          )}
          {spurs && (riding || rider.phase === 'board') && (
            <span className="drive-want" data-testid="drive-want" data-house={who.house}>
              <ArtOr name={`ui-drive-house-${who.house}`}>
                <HouseSvg color={who.house} />
              </ArtOr>
            </span>
          )}
        </div>

        <span className="drive-ahead" ref={aheadRef} style={pct(ahead)} data-testid="drive-ahead" aria-hidden />
      </div>

      <button
        type="button"
        className="drive-horn"
        // 按下去馬上叭（不等放開）；開車的手指不放也可以用另一根手指按。鍵盤或輔助工具走 onClick
        onPointerDown={honk}
        onClick={(e) => {
          if (e.detail === 0) honk()
        }}
        aria-label="按喇叭"
        data-testid="drive-horn"
      >
        {/* 方向盤：中間按下去就是喇叭 */}
        <svg viewBox="0 0 64 64" width="72%" height="72%" aria-hidden>
          <circle cx="32" cy="32" r="25" fill="none" stroke="#fff" strokeWidth="7" />
          <path d="M9 30 Q32 22 55 30 M32 40 V56" stroke="#fff" strokeWidth="7" strokeLinecap="round" fill="none" />
          <circle cx="32" cy="34" r="10" fill="#ffd23f" stroke="#fff" strokeWidth="3" />
        </svg>
      </button>

      {!moved && <GestureHint from={carEl} to={aheadEl} />}
    </div>
  )
}

/** 路面（不會變的部分）：直向畫面整層對調 x、y */
function RoadLayer({ portrait, spurs }: { portrait: boolean; spurs: boolean }) {
  const view = viewSize(portrait)
  const path = loopPath()
  const stopLine = loopAt(LIGHT_S)
  const cross = loopAt(CROSS_S)
  const stop = loopAt(STOP_S)
  const tf = (p: { x: number; y: number; a: number }) => `translate(${p.x} ${p.y}) rotate(${deg(p.a)})`
  const stripes = [-26, -13, 0, 13, 26]
  return (
    <svg className="drive-road" viewBox={`0 0 ${view.w} ${view.h}`} preserveAspectRatio="none" aria-hidden data-testid="drive-road">
      <g transform={portrait ? 'matrix(0 1 1 0 0 0)' : undefined}>
        {/* 人行道與路面 */}
        <path d={path} fill="none" stroke="#f3ead8" strokeWidth={ROAD_W + 22} strokeLinejoin="round" />
        {spurs &&
          SPURS.map((sp, j) => {
            const a = spurAt(j, 0)
            return <path key={`w${j}`} d={`M${a.x} ${a.y} L${sp.end.x} ${sp.end.y}`} stroke="#f3ead8" strokeWidth={ROAD_W + 22} strokeLinecap="round" />
          })}
        <path d={path} fill="none" stroke="#9b98a6" strokeWidth={ROAD_W + 6} strokeLinejoin="round" />
        {spurs &&
          SPURS.map((sp, j) => {
            const a = spurAt(j, 0)
            return <path key={`e${j}`} d={`M${a.x} ${a.y} L${sp.end.x} ${sp.end.y}`} stroke="#9b98a6" strokeWidth={ROAD_W + 6} strokeLinecap="round" />
          })}
        <path d={path} fill="none" stroke="#b9b6c3" strokeWidth={ROAD_W} strokeLinejoin="round" />
        {spurs &&
          SPURS.map((sp, j) => {
            const a = spurAt(j, 0)
            return <path key={`r${j}`} d={`M${a.x} ${a.y} L${sp.end.x} ${sp.end.y}`} stroke="#b9b6c3" strokeWidth={ROAD_W} strokeLinecap="round" />
          })}
        {/* 白色虛線 */}
        <path d={path} fill="none" stroke="#fff" strokeWidth={5} strokeDasharray="22 18" strokeLinecap="round" opacity={0.95} />
        {/* 停止線 */}
        <rect x={-5} y={-(ROAD_W / 2 - 5)} width={10} height={ROAD_W - 10} rx={3} fill="#fff" transform={tf(stopLine)} />
        {/* 斑馬線 */}
        <g transform={tf(cross)}>
          <rect x={-CROSS_HALF - 2} y={-ROAD_W / 2} width={CROSS_HALF * 2 + 4} height={ROAD_W} fill="#b9b6c3" />
          {stripes.map((v) => (
            <rect key={v} x={-CROSS_HALF} y={v - 4} width={CROSS_HALF * 2} height={8} rx={3} fill="#fff" />
          ))}
        </g>
        {/* 站牌前的黃色停車格 */}
        <rect x={-34} y={ROAD_W / 2 - 12} width={68} height={8} rx={4} fill="#ffd23f" transform={tf(stop)} />
      </g>
    </svg>
  )
}
