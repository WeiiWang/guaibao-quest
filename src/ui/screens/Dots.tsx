import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { VIEWBOX, fromUnit } from '../../art/coloring/render'
import { renderArtworkPng, renderDotsArtworkPng } from '../../art/coloring/export'
import {
  DOTS_IDS,
  DOTS_LINES,
  DOTS_NAMES,
  dotLabel,
  dotsItem,
  dotsLevel,
  dotsPageName,
  dotsPoints,
  hitDot,
  leaderFor,
  parseDotsId,
  placeLabels,
  silhouettePath,
  tapDot,
  type Pt,
} from '../../art/dots/dots'
import { docIsEmpty } from '../../domain/coloring'
import type { FrameId } from '../../domain/frames'
import { chineseNumber, say, sayEnglish, sayText } from '../../learning/speech'
import { numberKey as numKey } from '../../learning/lines'
import { ScreenHeader } from '../components/Header'
import { Icon } from '../components/Icon'
import { useToast } from '../hooks'
import { useLearningSettings } from '../learningHooks'
import { playChime, playPop } from '../sounds'
import { stickerEmoji } from './coloring/stickers'
import { FinishCelebration } from './Coloring'
import type { Screen } from '../App'
import './dots.css'

/** 閒置幾毫秒之後，下一個點放大脈動提示 */
export const DOTS_IDLE_MS = 5000
/** 點的點擊範圍半徑（螢幕 px）：直徑 52px，3 歲的手指也點得到 */
const HIT_PX = 26
const reduceMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

type Phase = 'play' | 'close' | 'solid' | 'reveal'

/** 連連看畫面：連點成圖 → 封閉成剪影 → 淡入 3D 圖 → 拿去塗色 / 完成 */
export function DotsPlayScreen({ pageId, onBack, go }: { pageId: string; onBack: () => void; go: (s: Screen['name'] | Screen) => void }) {
  const parsed = parseDotsId(pageId)
  const item = parsed ? dotsItem(parsed.name) : undefined
  const level = parsed ? dotsLevel(parsed.level) : undefined
  const toast = useToast()
  const { voiceOn } = useLearningSettings()
  const soundOn = useLiveQuery(async () => (await db.settings.get('main'))?.soundOn !== false, [], true)
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const dots = useMemo<Pt[]>(() => (parsed ? dotsPoints(parsed.name, parsed.level) : []), [parsed])
  const n = dots.length
  const sil = useMemo(() => (parsed ? silhouettePath(parsed.name) : ''), [parsed])

  const [at, setAt] = useState<number | null>(null) // null = 讀取中
  const [phase, setPhase] = useState<Phase>('play')
  const [idle, setIdle] = useState(false)
  const [touchN, setTouchN] = useState(0)
  const [wobble, setWobble] = useState<{ i: number; n: number } | null>(null)
  const [ptr, setPtr] = useState<Pt | null>(null)
  const [boardPx, setBoardPx] = useState(560)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ galleryId: string; png: string; hung: boolean; frame?: FrameId; newFrames: FrameId[]; framesDone: number; counted: boolean; stars: number } | null>(null)
  const atRef = useRef(0)
  const dragging = useRef(false)
  const celebrate = useRef(false)
  const boardRef = useRef<HTMLDivElement>(null)
  const startedLine = useRef(false)

  // ---- 讀進度：接著上次連到的地方；連完的直接顯示結果 ----
  useEffect(() => {
    let alive = true
    void (async () => {
      if (!parsed || !(await repo.dotsUnlocked(pageId))) {
        if (alive) go('coloring')
        return
      }
      const p = await repo.getDotsProgress(pageId)
      if (!alive) return
      atRef.current = p.at
      setAt(p.at)
      setPhase(p.done ? 'reveal' : 'play')
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId])

  // ---- 量畫板大小（決定點、字的大小與點擊範圍） ----
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const update = () => setBoardPx(Math.max(200, Math.round(el.getBoundingClientRect().width)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- 開場提示（只唸一次） ----
  const loaded = at !== null
  useEffect(() => {
    if (at === null || startedLine.current || phase !== 'play' || at > 0 || !level) return
    startedLine.current = true
    sayText(DOTS_LINES[level.letters ? 'ui.dots.startAbc' : 'ui.dots.start'] as string, { enabled: voiceOn })
    // 只在剛進來時唸一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  // ---- 點錯的晃動播完就清掉 ----
  useEffect(() => {
    if (!wobble) return
    const t = window.setTimeout(() => setWobble(null), 600)
    return () => window.clearTimeout(t)
  }, [wobble])

  // ---- 閒置提示：5 秒沒有動作，下一個點放大脈動 ----
  useEffect(() => {
    if (phase !== 'play' || at === null) return
    const t = window.setTimeout(() => setIdle(true), DOTS_IDLE_MS)
    return () => window.clearTimeout(t)
  }, [phase, at, touchN])

  // ---- 連完之後：封閉 → 剪影 → 3D 圖 ----
  useEffect(() => {
    const fast = reduceMotion()
    if (phase === 'close') {
      const t = window.setTimeout(() => setPhase('solid'), fast ? 40 : 520)
      return () => window.clearTimeout(t)
    }
    if (phase === 'solid') {
      const t = window.setTimeout(() => setPhase('reveal'), fast ? 40 : 800)
      return () => window.clearTimeout(t)
    }
    if (phase === 'reveal' && celebrate.current) {
      celebrate.current = false
      playChime(soundOn, [523, 659, 784, 1047, 1319])
      const t = window.setTimeout(() => {
        const i = Math.max(0, DOTS_IDS.indexOf(parsed?.name ?? ''))
        sayText((DOTS_LINES['pet.dots.done'] as string[])[i] ?? '', { enabled: voiceOn })
      }, fast ? 80 : 650)
      return () => window.clearTimeout(t)
    }
  }, [phase, soundOn, voiceOn, parsed?.name])

  // ---- 單位換算 ----
  const scale = boardPx / VIEWBOX.size // 螢幕 px / 座標單位
  const hitR = HIT_PX / scale
  const easy = parsed?.level === 'e'
  const dotRpx = easy ? clamp(boardPx * 0.03, 12, 20) : clamp(boardPx * 0.022, 8, 14)
  const fontPx = easy ? clamp(boardPx * 0.05, 18, 32) : clamp(boardPx * 0.036, 14, 24)
  const dotR = dotRpx / scale
  const font = fontPx / scale
  const labels = useMemo(
    () => placeLabels(dots, dots.map((_, i) => dotLabel(parsed?.level ?? 'e', i)), Math.round(font * 2) / 2, Math.round(dotR * 2) / 2),
    [dots, parsed?.level, font, dotR],
  )

  /** 標籤離自己的點比較遠時（擠的地方），從點的邊緣拉一條線到標籤外框，孩子才不會認錯（見 dots.leaderFor） */
  const leaders = useMemo(
    () => dots.map((p, i) => leaderFor(p, labels[i], dotLabel(parsed?.level ?? 'e', i), Math.round(font * 2) / 2, Math.round(dotR * 2) / 2)),
    [dots, labels, parsed?.level, font, dotR],
  )

  const unitOf = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const r = boardRef.current!.getBoundingClientRect()
    return [fromUnit((e.clientX - r.left) / r.width), fromUnit((e.clientY - r.top) / r.height)]
  }, [])

  const sayLabel = (i: number) => {
    if (!level) return
    if (level.letters) sayEnglish(dotLabel('a', i), { enabled: voiceOn })
    else say(numKey(i + 1), chineseNumber(i + 1), { enabled: voiceOn })
  }

  const connect = (i: number) => {
    const r = tapDot(atRef.current, n, i)
    if (!r.connected) return
    atRef.current = r.at
    setAt(r.at)
    setIdle(false)
    void repo.saveDotsProgress(pageId, r.at)
    playPop(soundOn)
    if (r.closed) {
      celebrate.current = true
      sayLabel(i)
      setPhase('close')
    } else sayLabel(i)
  }

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phase !== 'play' || at === null || !e.isPrimary) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = unitOf(e)
    setTouchN((v) => v + 1)
    setIdle(false)
    const hit = hitDot(dots, p, atRef.current, hitR)
    if (hit?.next) connect(hit.index)
    else if (hit) setWobble((w) => ({ i: hit.index, n: (w?.n ?? 0) + 1 })) // 點錯：那個點輕晃一下，不算錯
    dragging.current = true
    setPtr(p)
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || phase !== 'play') return
    const p = unitOf(e)
    setPtr(p)
    const next = atRef.current
    if (next < n && Math.hypot(dots[next][0] - p[0], dots[next][1] - p[1]) <= hitR) connect(next)
  }
  const onUp = () => {
    dragging.current = false
    setPtr(null)
  }

  // ---- 連完之後 ----
  const toPaint = () => go({ name: 'paint', pageId })
  const again = async () => {
    await repo.resetDots(pageId)
    atRef.current = 0
    celebrate.current = false
    startedLine.current = false
    setDone(null)
    setAt(0)
    setPhase('play')
    setIdle(false)
    setTouchN((v) => v + 1)
  }
  /** 直接完成：還沒塗過就存 3D 圖；塗過了就存塗好的樣子。算畫框收藏的一幅（同樣的作品重複按不會重複累計） */
  const finish = async () => {
    if (!parsed) return
    setBusy(true)
    try {
      const doc = await repo.getColoringDoc(pageId)
      const colored = !docIsEmpty(doc)
      const png = colored ? await renderArtworkPng({ pageId, bg: doc.bg, fills: doc.fills, strokes: doc.strokes, stickers: doc.stickers }, stickerEmoji) : await renderDotsArtworkPng(parsed.name)
      const r = await repo.completeColoring(pageId, doc, png, undefined, { counts: true })
      if (!r.ok) throw new Error(r.error)
      playChime(soundOn, r.newFrames.length ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047])
      setDone({ galleryId: r.galleryId, png, hung: false, frame: r.frame, newFrames: r.newFrames, framesDone: r.framesDone, counted: r.counted, stars: r.stars })
    } catch {
      toast('這張畫存不起來，再按一次試試看', 'warn')
    } finally {
      setBusy(false)
    }
  }
  const hang = async () => {
    if (!done) return
    const r = await repo.hangArtwork(done.galleryId)
    if (!r.ok) return toast(r.error, 'warn')
    setDone({ ...done, hung: true })
    toast('掛到房間了！到首頁「佈置」可以移動它', 'ok')
  }

  if (!parsed || !item || !level) return null
  const cur = at ?? 0
  const title = dotsPageName(parsed.name, parsed.level)
  const revealed = phase === 'reveal'
  const closing = phase !== 'play'
  const connected = dots.slice(0, cur)
  const poly = connected.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('')
  const nextLabel = cur < n ? dotLabel(parsed.level, cur) : ''
  const stage = pet?.stage ?? 'baby'
  const petArt = stage === 'egg' ? 'pet-egg' : `pet-${stage}-cheer`
  const doneLine = (DOTS_LINES['pet.dots.done'] as string[])[Math.max(0, DOTS_IDS.indexOf(parsed.name))]
  const [ix, iy, iw, ih] = item.img
  const wob = wobble

  return (
    <main className="screen dt-screen theme-lavender" data-testid="dots-screen" data-page={pageId} data-phase={phase} data-at={cur} data-n={n} data-ready={at !== null ? '1' : '0'}>
      <ScreenHeader title={title} onBack={onBack} backLabel="← 著色本" right={<span className="autosave dt-progress" data-testid="dots-progress">{revealed ? '連好了' : `${cur} / ${n}`}</span>} />
      <div className="dt-layout">
        <div className="dt-stage card">
          <div
            ref={boardRef}
            className={`dt-board dt-phase-${phase} ${idle && phase === 'play' ? 'dt-idle' : ''}`}
            data-testid="dots-board"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <svg className="dt-svg" viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.size} ${VIEWBOX.size}`} role="group" aria-label={`${title}，把點從 ${dotLabel(parsed.level, 0)} 連到 ${dotLabel(parsed.level, n - 1)}`}>
              {/* 剪影：連完之後出現（實心），3D 圖淡入之後淡出 */}
              <path className="dt-sil" d={sil} data-testid="dots-sil" />
              <image className="dt-img" href={`${import.meta.env.BASE_URL}art/${parsed.name}.png`} x={ix} y={iy} width={iw} height={ih} data-testid="dots-img" preserveAspectRatio="xMidYMid meet" />
              <g className="dt-lines">
                {poly && <path className="dt-line" d={poly} data-testid="dots-line" />}
                {closing && n > 1 && <path className="dt-line dt-close" d={`M${dots[n - 1][0]} ${dots[n - 1][1]}L${dots[0][0]} ${dots[0][1]}`} pathLength={1} data-testid="dots-close" />}
                {ptr && cur > 0 && cur < n && phase === 'play' && <path className="dt-line dt-rubber" d={`M${dots[cur - 1][0]} ${dots[cur - 1][1]}L${ptr[0]} ${ptr[1]}`} />}
              </g>
              <g className="dt-dots">
                {dots.map((p, i) => {
                  const state = i < cur ? 'on' : i === cur ? 'next' : 'off'
                  return (
                    <g key={wob?.i === i ? `${i}-${wob.n}` : i} className={`dt-dot ${state} ${wob?.i === i ? 'dt-wobble' : ''}`} data-dot={i} data-state={state} data-x={p[0]} data-y={p[1]} style={{ transformOrigin: `${p[0]}px ${p[1]}px` }}>
                      {state === 'next' && <circle className="dt-glow" cx={p[0]} cy={p[1]} r={dotR * 2.1} />}
                      <circle className="dt-dot-c" cx={p[0]} cy={p[1]} r={state === 'next' ? dotR * 1.25 : dotR} />
                      {leaders[i] && <line className="dt-leader" data-testid="dots-leader" {...leaders[i]!} />}
                      <text className="dt-num" x={labels[i][0]} y={labels[i][1]} fontSize={font} textAnchor="middle" dominantBaseline="central" aria-hidden>
                        {dotLabel(parsed.level, i)}
                      </text>
                    </g>
                  )
                })}
              </g>
            </svg>
          </div>
        </div>

        <div className="dt-panel card">
          {!revealed ? (
            <>
              <div className="dt-next" data-testid="dots-next" aria-live="polite">
                {closing ? (
                  <span>連起來囉！</span>
                ) : (
                  <>
                    <span className="dt-next-lab">下一個</span>
                    <b className="dt-next-num">{nextLabel}</b>
                  </>
                )}
              </div>
              <div className="dt-bar" role="progressbar" aria-valuemin={0} aria-valuemax={n} aria-valuenow={cur}>
                <i style={{ width: `${(cur / n) * 100}%` }} />
              </div>
              <button className="btn dt-big" onClick={() => void again()} disabled={cur === 0 || closing} data-testid="dots-restart">
                重新連
              </button>
            </>
          ) : (
            <>
              <div className="dt-cheer">
                <div className="dt-pet">
                  <Icon name={petArt} emoji="🐵" alt="阿悟" size="100%" />
                </div>
                <div className="dt-bubble" data-testid="dots-line-text">{doneLine || `你連出${DOTS_NAMES[parsed.name]}了！`}</div>
              </div>
              <div className="dt-actions">
                <button className="btn primary dt-big" onClick={toPaint} data-testid="dots-to-paint">
                  🎨 拿去塗色
                </button>
                <button className="btn dt-big" onClick={() => void finish()} disabled={busy} data-testid="dots-finish">
                  {busy ? '收好中…' : '✓ 完成，放進畫廊'}
                </button>
                <button className="btn dt-big" onClick={() => void again()} data-testid="dots-again">
                  再連一次
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {done && (
        <FinishCelebration
          png={done.png}
          hung={done.hung}
          frame={done.frame}
          newFrames={done.newFrames}
          framesDone={done.framesDone}
          counted={done.counted}
          stars={done.stars}
          voiceOn={voiceOn}
          stage={pet?.stage ?? 'baby'}
          free={false}
          onHang={hang}
          onGallery={() => go('gallery')}
          onKeep={() => setDone(null)}
          onRestart={() => setDone(null)}
          onBack={onBack}
        />
      )}
    </main>
  )
}
