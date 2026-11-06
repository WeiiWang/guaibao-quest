import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../../../db/repo'
import { localDateStr } from '../../../domain/date'
import type { AgeBand } from '../../../domain/types'
import { PUZZLE_SCENES, PUZZLE_SIZES, gridOf, puzzleLayout, saySnap, shuffleOrder, slotOf, snaps, tiltOf, type PuzzleLayout } from '../../../domain/puzzle'
import { playSound } from '../../../learning/audioEngine'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell, type GameProps } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'
import { HandHint, petHop, reducedMotion, useBand, useFinishLater, useTrackedSay } from '../playground/playU'
import { playSfx, useTimers } from '../playground/vShared'
import '../playground/playU.css'
import './puzzle.css'

// 拼圖屋：選一張圖（自己畫的排最前面）→ 碎片打散在桌上 → 拖到底板附近就吸過去 → 拼完圖亮一下、寵物鼓掌。
// 片數依年齡（4–5、6–7 歲可以選），洗牌固定（圖 + 日期 + 片數），不靠亂數。

export default function Puzzle({ onExit }: GameRootProps) {
  return (
    <GameShell id="puzzle" scene="scene-town-toyroom" intro="pet.play.puzzle.intro" onExit={onExit}>
      {(p) => <PuzzleGame {...p} />}
    </GameShell>
  )
}

/** 自己的作品最多排幾張（太多孩子挑不完；最新的在前面） */
const MAX_MINE = 8

interface Pic {
  key: string
  src: string
  mine: boolean
}
interface Piece {
  i: number
  x: number
  y: number
  locked: boolean
}

/** 把圖從中間裁成 cols:rows 的比例（碎片都是正方形）。做不到就用原圖（會稍微變形，但不會壞） */
function cropTo(src: string, cols: number, rows: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const want = cols / rows
        const iw = img.naturalWidth
        const ih = img.naturalHeight
        let sw = iw
        let sh = iw / want
        if (sh > ih) {
          sh = ih
          sw = ih * want
        }
        const outW = Math.min(1200, Math.round(sw))
        const outH = Math.round(outW / want)
        const c = document.createElement('canvas')
        c.width = outW
        c.height = outH
        const g = c.getContext('2d')
        if (!g) return resolve(src)
        // 畫廊作品可能有透明的地方：先鋪白，轉 JPEG 才不會變黑
        g.fillStyle = '#fff'
        g.fillRect(0, 0, outW, outH)
        g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, outW, outH)
        resolve(c.toDataURL('image/jpeg', 0.88))
      } catch {
        resolve(src)
      }
    }
    img.onerror = () => resolve(src)
    img.src = src
  })
}

function PuzzleGame({ say: rawSay, finish }: GameProps) {
  const band = useBand()
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const later = useTimers()
  const sizes = PUZZLE_SIZES[band]
  const [count, setCount] = useState<number>(sizes[0])
  const n = sizes.includes(count) ? count : sizes[0]
  const works = useLiveQuery(() => repo.listGallery(), [])
  const pics: Pic[] = useMemo(
    () => [
      ...(works ?? [])
        .filter((w) => !!w.png)
        .slice(0, MAX_MINE)
        .map((w) => ({ key: w.pageId, src: w.png!, mine: true })),
      ...PUZZLE_SCENES.map((s) => ({ key: s, src: `${import.meta.env.BASE_URL}art/${s}.jpg`, mine: false })),
    ],
    [works],
  )
  const hasMine = pics.some((p) => p.mine)
  const [phase, setPhase] = useState<'pick' | 'load' | 'play' | 'done'>('pick')
  const [pic, setPic] = useState<Pic | null>(null)
  const [img, setImg] = useState<string | null>(null)
  const [pose, setPose] = useState<Pose>('happy')
  const hopRef = useRef<HTMLSpanElement>(null)
  const saidMine = useRef(false)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // 有自己畫的圖：寵物說一句（等一進來的那句說完）
  useEffect(() => {
    if (phase !== 'pick' || !hasMine || saidMine.current) return
    saidMine.current = true
    // 已經選好圖開始拼了就不說（說了也對不上）
    later(() => phaseRef.current === 'pick' && say('pet.play.puzzle.mine'), 2600)
  }, [phase, hasMine, say, later])

  const choose = async (p: Pic) => {
    if (phase !== 'pick') return
    playSound('pop')
    setPic(p)
    setPhase('load')
    const { cols, rows } = gridOf(n)
    const url = await cropTo(p.src, cols, rows)
    setImg(url)
    setPhase('play')
    setPose('happy')
  }

  const onDone = () => {
    setPhase('done')
    setPose('cheer')
    playSfx('sparkle')
    playSound('correct')
    say('pet.play.puzzle.done')
    petHop(hopRef.current, '-28%')
    later(() => petHop(hopRef.current, '-20%'), 450)
    finishLater()
  }

  const again = () => {
    playSound('pop')
    setPhase('pick')
    setImg(null)
    setPic(null)
    setPose('happy')
  }

  const seedKey = pic ? `${pic.key}|${localDateStr(Date.now())}|${n}` : ''

  return (
    <div className="pzl-root" ref={rootRef} data-testid="puzzle" data-band={band} data-phase={phase} data-count={n}>
      <div className="pzl-pet" data-testid="pzl-pet" data-big={phase === 'done' ? '1' : undefined}>
        <span className="pzl-pet-hop" ref={hopRef}>
          <Companion pose={pose} size="var(--pzl-pet)" />
        </span>
      </div>

      {phase === 'pick' && (
        <div className="pzl-pick">
          {sizes.length > 1 && (
            <div className="pzl-sizes" role="radiogroup" aria-label="片數">
              {sizes.map((s) => {
                const g = gridOf(s)
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={s === n}
                    aria-label={`${s} 片`}
                    className="pzl-size"
                    data-on={s === n ? '1' : undefined}
                    data-testid={`pzl-size-${s}`}
                    onClick={() => {
                      setCount(s)
                      playSound('tap')
                    }}
                  >
                    <span className="pzl-size-grid" style={{ gridTemplateColumns: `repeat(${g.cols}, 1fr)`, aspectRatio: `${g.cols} / ${g.rows}` }} aria-hidden>
                      {Array.from({ length: s }, (_, i) => (
                        <i key={i} />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          <div className="pzl-pics" data-testid="pzl-pics">
            {pics.map((p) => (
              <button key={p.key} type="button" className="pzl-pic" data-testid="pzl-pic" data-key={p.key} data-mine={p.mine ? '1' : undefined} onClick={() => void choose(p)} aria-label={p.mine ? '我畫的圖' : '拼圖'}>
                <img src={p.src} alt="" draggable={false} />
                {p.mine && (
                  <span className="pzl-mine" aria-hidden>
                    <svg viewBox="0 0 32 32" width="30" height="30">
                      <path d="M16 3l3.900 8.400 9.100 1.100-6.700 6.200 1.800 9-8.100-4.500-8.100 4.500 1.800-9-6.700-6.200 9.100-1.100z" fill="#ffd34d" stroke="#fff" strokeWidth="2.500" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {(phase === 'play' || phase === 'done') && img && pic && <Board key={`${pic.key}|${n}`} img={img} n={n} seedKey={seedKey} band={band} done={phase === 'done'} say={say} onDone={onDone} />}

      {phase === 'done' && (
        <button type="button" className="pzl-again" onClick={again} data-testid="pzl-again" aria-label="換一張">
          <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden>
            <rect x="5" y="9" width="38" height="30" rx="5" fill="none" stroke="currentColor" strokeWidth="5" />
            <path d="M10 34l10-11 7 7 5-5 7 9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
          </svg>
          <span>換一張</span>
        </button>
      )}
    </div>
  )
}

function Board({ img, n, seedKey, band, done, say, onDone }: { img: string; n: number; seedKey: string; band: AgeBand; done: boolean; say: (k: string) => void; onDone: () => void }) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const { cols, rows } = gridOf(n)
  const order = useMemo(() => shuffleOrder(n, seedKey), [n, seedKey])
  const layout: PuzzleLayout | null = useMemo(() => (size ? puzzleLayout(size.w, size.h, n) : null), [size, n])
  const [pieces, setPieces] = useState<Piece[]>([])
  const piecesRef = useRef<Piece[]>([])
  const [touched, setTouched] = useState(false)
  const drags = useRef(new Map<number, { i: number; ox: number; oy: number; el: HTMLElement }>())
  const zTop = useRef(10)
  const placed = useRef(0)

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      setSize((s) => (s && Math.abs(s.w - r.width) < 2 && Math.abs(s.h - r.height) < 2 ? s : { w: r.width, h: r.height }))
    }
    update()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    ro?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  // 排版變了（第一次、旋轉）：拼好的回到底板上，還沒拼的回到桌上的位置
  useLayoutEffect(() => {
    if (!layout) return
    const prev = piecesRef.current
    const next = order.map((i, k) => {
      const was = prev.find((p) => p.i === i)
      if (was?.locked) return { i, ...slotOf(layout.board, n, i), locked: true }
      return { i, ...layout.spots[k], locked: false }
    })
    drags.current.clear()
    piecesRef.current = next
    setPieces(next)
  }, [layout, order, n])

  const toArea = (cx: number, cy: number) => {
    const r = areaRef.current!.getBoundingClientRect()
    return { x: cx - r.left, y: cy - r.top }
  }

  const onDown = (e: RPointerEvent<HTMLDivElement>, p: Piece) => {
    if (p.locked || done || !layout) return
    if ([...drags.current.values()].some((d) => d.i === p.i)) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const at = toArea(e.clientX, e.clientY)
    const el = e.currentTarget
    el.style.zIndex = String(++zTop.current)
    el.dataset.dragging = '1'
    drags.current.set(e.pointerId, { i: p.i, ox: at.x - p.x, oy: at.y - p.y, el })
    setTouched(true)
    playSound('tap')
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drags.current.get(e.pointerId)
    if (!d) return
    const at = toArea(e.clientX, e.clientY)
    d.el.style.transform = `translate(${at.x - d.ox}px, ${at.y - d.oy}px) scale(1.06)`
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>, cancel = false) => {
    const d = drags.current.get(e.pointerId)
    if (!d || !layout) return
    drags.current.delete(e.pointerId)
    delete d.el.dataset.dragging
    const at = toArea(e.clientX, e.clientY)
    const size = areaRef.current!.getBoundingClientRect()
    const p = layout.piece
    let x = Math.max(-p * 0.2, Math.min(size.width - p * 0.8, at.x - d.ox))
    let y = Math.max(-p * 0.2, Math.min(size.height - p * 0.8, at.y - d.oy))
    const slot = slotOf(layout.board, n, d.i)
    const hit = !cancel && snaps(x - slot.x, y - slot.y, p, band)
    if (hit) {
      x = slot.x
      y = slot.y
    }
    const next = piecesRef.current.map((q) => (q.i === d.i ? { ...q, x, y, locked: hit } : q))
    piecesRef.current = next
    setPieces(next)
    // 立刻放到新位置（不等 render，避免閃回原位）
    d.el.style.transform = `translate(${x}px, ${y}px)${hit ? '' : ` rotate(${tiltOf(d.i, seedKey)}deg)`}`
    if (!hit) return
    placed.current += 1
    playSfx('pop')
    if (!reducedMotion() && typeof d.el.animate === 'function')
      d.el.animate([{ transform: `translate(${x}px, ${y}px) scale(1.1)` }, { transform: `translate(${x}px, ${y}px) scale(1)` }], { duration: 220, easing: 'ease-out' })
    if (saySnap(placed.current, n)) say('pet.play.puzzle.snap')
    if (next.every((q) => q.locked)) onDone()
  }

  const firstLoose = pieces.find((p) => !p.locked)
  return (
    <div className="pzl-area" ref={areaRef} data-testid="pzl-area" data-done={done ? '1' : undefined}>
      {layout && (
        <>
          <div className="pzl-board" data-testid="pzl-board" style={{ left: layout.board.x, top: layout.board.y, width: layout.board.w, height: layout.board.h }}>
            <span className="pzl-ghostimg" style={{ backgroundImage: `url("${img}")` }} aria-hidden />
            {Array.from({ length: n }, (_, i) => (
              <span
                key={i}
                className="pzl-slot"
                data-testid="pzl-slot"
                data-slot={i}
                style={{ left: `${((i % cols) / cols) * 100}%`, top: `${(Math.floor(i / cols) / rows) * 100}%`, width: `${100 / cols}%`, height: `${100 / rows}%` }}
              />
            ))}
            {done && <span className="pzl-shine" data-testid="pzl-shine" aria-hidden />}
          </div>
          {pieces.map((p) => {
            const c = p.i % cols
            const r = Math.floor(p.i / cols)
            const style: CSSProperties = {
              width: layout.piece,
              height: layout.piece,
              transform: `translate(${p.x}px, ${p.y}px)${p.locked ? '' : ` rotate(${tiltOf(p.i, seedKey)}deg)`}`,
              backgroundImage: `url("${img}")`,
              backgroundSize: `${cols * 100}% ${rows * 100}%`,
              backgroundPosition: `${cols > 1 ? (c / (cols - 1)) * 100 : 0}% ${rows > 1 ? (r / (rows - 1)) * 100 : 0}%`,
            }
            return (
              <div
                key={p.i}
                className="pzl-piece"
                data-testid="pzl-piece"
                data-piece={p.i}
                data-locked={p.locked ? '1' : undefined}
                style={style}
                onPointerDown={(e) => onDown(e, p)}
                onPointerMove={onMove}
                onPointerUp={(e) => onUp(e)}
                onPointerCancel={(e) => onUp(e, true)}
              />
            )
          })}
          {!touched && firstLoose && (
            <span
              className="pzl-hint"
              aria-hidden
              style={
                {
                  left: firstLoose.x + layout.piece / 2,
                  top: firstLoose.y + layout.piece / 2,
                  '--pzl-dx': `${slotOf(layout.board, n, firstLoose.i).x - firstLoose.x}px`,
                  '--pzl-dy': `${slotOf(layout.board, n, firstLoose.i).y - firstLoose.y}px`,
                } as CSSProperties
              }
            >
              <HandHint mode="tap" />
            </span>
          )}
        </>
      )}
    </div>
  )
}

