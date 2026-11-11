import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { repo } from '../../../db/repo'
import { localDateStr } from '../../../domain/date'
import type { AgeBand } from '../../../domain/types'
import {
  JIGSAW_TAB,
  PUZZLE_SIZES,
  cropRect,
  gridOf,
  jigsawEdges,
  jigsawPath,
  puzzleLayout,
  puzzleScenes,
  saySnap,
  shuffleOrder,
  slotOf,
  snaps,
  tiltOf,
  usesJigsaw,
  type PuzzleFocus,
  type PuzzleLayout,
} from '../../../domain/puzzle'
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
// v8.5 新玩具：toys >= 1 多 6 張故事圖可以選；toys >= 2 拼圖片變成有凹有凸的形狀（4 歲以上；3 歲維持方塊）。
// 形狀在選圖的那一下決定，拼到一半不會變。

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
  /** 只裁主體那一塊（新的故事圖） */
  focus?: PuzzleFocus
}
interface Piece {
  i: number
  x: number
  y: number
  locked: boolean
}

/** 把圖裁成 cols:rows 的比例（碎片都是正方形；裁哪一塊見 cropRect）。做不到就用原圖（會稍微變形，但不會壞） */
function cropTo(src: string, cols: number, rows: number, focus?: PuzzleFocus): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const want = cols / rows
        const { x: sx, y: sy, w: sw, h: sh } = cropRect(img.naturalWidth, img.naturalHeight, cols, rows, focus)
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
        g.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
        resolve(c.toDataURL('image/jpeg', 0.88))
      } catch {
        resolve(src)
      }
    }
    img.onerror = () => resolve(src)
    img.src = src
  })
}

function PuzzleGame({ say: rawSay, finish, toys }: GameProps) {
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
      ...puzzleScenes(toys).map((s) => ({ key: s.id, src: `${import.meta.env.BASE_URL}art/${s.id}.jpg`, mine: false, focus: s.focus })),
    ],
    [works, toys],
  )
  const hasMine = pics.some((p) => p.mine)
  const [phase, setPhase] = useState<'pick' | 'load' | 'play' | 'done'>('pick')
  const [pic, setPic] = useState<Pic | null>(null)
  const [img, setImg] = useState<string | null>(null)
  /** 這一張用不用凹凸形狀：選圖的時候決定，拼到一半拿到新玩具也不會變 */
  const [jigsaw, setJigsaw] = useState(false)
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
    setJigsaw(usesJigsaw(toys, band))
    setPhase('load')
    const { cols, rows } = gridOf(n)
    const url = await cropTo(p.src, cols, rows, p.focus)
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
    <div className="pzl-root" ref={rootRef} data-testid="puzzle" data-band={band} data-phase={phase} data-count={n} data-jigsaw={phase !== 'pick' && jigsaw ? '1' : undefined}>
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
                <img src={p.src} alt="" draggable={false} style={p.focus ? { objectPosition: `${p.focus.cx * 100}% ${p.focus.cy * 100}%` } : undefined} />
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

      {(phase === 'play' || phase === 'done') && img && pic && <Board key={`${pic.key}|${n}`} img={img} n={n} seedKey={seedKey} band={band} jigsaw={jigsaw} done={phase === 'done'} say={say} onDone={onDone} />}

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

function Board({ img, n, seedKey, band, jigsaw, done, say, onDone }: { img: string; n: number; seedKey: string; band: AgeBand; jigsaw: boolean; done: boolean; say: (k: string) => void; onDone: () => void }) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const { cols, rows } = gridOf(n)
  const order = useMemo(() => shuffleOrder(n, seedKey), [n, seedKey])
  const layout: PuzzleLayout | null = useMemo(() => (size ? puzzleLayout(size.w, size.h, n, jigsaw ? JIGSAW_TAB : 0) : null), [size, n, jigsaw])
  /** 凹凸形狀：每一片的外框（座標是那一片自己的，邊長 = layout.piece） */
  const shapes = useMemo(() => (jigsaw && layout ? Array.from({ length: n }, (_, i) => jigsawPath(jigsawEdges(i, cols, rows), layout.piece)) : null), [jigsaw, layout, n, cols, rows])
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
    if (!hit) {
      // 放回桌上也有聲音
      if (!cancel) playSound('drop')
      return
    }
    placed.current += 1
    playSfx('pop')
    if (!reducedMotion() && typeof d.el.animate === 'function')
      d.el.animate([{ transform: `translate(${x}px, ${y}px) scale(1.1)` }, { transform: `translate(${x}px, ${y}px) scale(1)` }], { duration: 220, easing: 'ease-out' })
    if (saySnap(placed.current, n)) say('pet.play.puzzle.snap')
    if (next.every((q) => q.locked)) onDone()
  }

  const firstLoose = pieces.find((p) => !p.locked)
  return (
    <div className="pzl-area" ref={areaRef} data-testid="pzl-area" data-done={done ? '1' : undefined} data-jigsaw={jigsaw ? '1' : undefined}>
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
            {shapes && (
              // 底板的提示也畫成凹凸的格線
              <svg className="pzl-board-jig" viewBox={`0 0 ${layout.board.w} ${layout.board.h}`} aria-hidden data-testid="pzl-board-jig">
                {shapes.map((d, i) => (
                  <path key={i} d={d} transform={`translate(${(i % cols) * layout.piece} ${Math.floor(i / cols) * layout.piece})`} />
                ))}
              </svg>
            )}
            {done && <span className="pzl-shine" data-testid="pzl-shine" aria-hidden />}
          </div>
          {pieces.map((p) => {
            const c = p.i % cols
            const r = Math.floor(p.i / cols)
            const P = layout.piece
            const transform = `translate(${p.x}px, ${p.y}px)${p.locked ? '' : ` rotate(${tiltOf(p.i, seedKey)}deg)`}`
            if (shapes) {
              // 凹凸形狀：可以按的範圍還是原本那一格（外面這個 div），形狀只是裡面那張 SVG 的樣子，不接手指
              const t = Math.ceil(P * JIGSAW_TAB) + 3
              return (
                <div
                  key={p.i}
                  className="pzl-piece"
                  data-testid="pzl-piece"
                  data-piece={p.i}
                  data-jigsaw="1"
                  data-locked={p.locked ? '1' : undefined}
                  style={{ width: P, height: P, transform }}
                  onPointerDown={(e) => onDown(e, p)}
                  onPointerMove={onMove}
                  onPointerUp={(e) => onUp(e)}
                  onPointerCancel={(e) => onUp(e, true)}
                >
                  <svg className="pzl-jig" width={P + t * 2} height={P + t * 2} viewBox={`${-t} ${-t} ${P + t * 2} ${P + t * 2}`} style={{ left: -t, top: -t }} aria-hidden>
                    <defs>
                      <clipPath id={`pzl-clip-${p.i}`}>
                        <path d={shapes[p.i]} />
                      </clipPath>
                    </defs>
                    <image href={img} x={-c * P} y={-r * P} width={cols * P} height={rows * P} preserveAspectRatio="none" clipPath={`url(#pzl-clip-${p.i})`} />
                    <path className="pzl-jig-edge" d={shapes[p.i]} />
                  </svg>
                </div>
              )
            }
            const style: CSSProperties = {
              width: P,
              height: P,
              transform,
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

