import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import {
  BLOCK_COLORS,
  BLOCK_SHAPES,
  BLOCK_SIZE,
  PET_ROWS,
  autoColumn,
  blueprintFor,
  canPlace,
  dropY,
  matchesBlueprint,
  maxRows,
  scatter,
  settle,
  snapColumn,
  topBlock,
  towerTop,
  viewScale,
  type Block,
  type BlockColor,
  type BlockShape,
  type Blueprint,
} from '../../../domain/blocks'
import { localDateStr } from '../../../domain/date'
import { playSound } from '../../../learning/audioEngine'
import { useArtStatus } from '../../artProbe'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell, type GameProps } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'
import { petHop, reducedMotion, useBand, useFinishLater, useTrackedSay } from '../playground/playU'
import { GestureHint, playSfx, useTimers } from '../playground/vShared'
import '../playground/playU.css'
import './blocks.css'

// 積木工地：從盤子拖積木到沙地上，會對齊格線、疊在下面那塊上面（不做真的物理、不會自己倒）。
// 寵物爬到最高那塊上面；按「推倒」積木彈開散一地、寵物大笑。6–7 歲多一張可以照著蓋的小藍圖。
// 玩完（finish）：推倒一次、照著蓋好一張，或這次一共放了 8 塊（只想一直蓋、不想推倒的也算玩過）。
// 不用「放 5 塊」：禮物卡是蓋住畫面的，蓋到一半跳出來會打斷正在蓋的塔；8 塊通常已經想推倒了。

export default function Blocks({ onExit }: GameRootProps) {
  return (
    <GameShell id="blocks" scene="scene-town-build" intro="pet.play.blocks.intro" onExit={onExit}>
      {(p) => <BlocksGame {...p} />}
    </GameShell>
  )
}

/** 一直蓋不推倒也算玩完：這次一共放了幾塊（推倒或照著蓋好會更早） */
const FINISH_PLACED = 8
/** 手指移動超過這個距離才算拖 */
const DRAG_SLOP = 10
/** 說「我爬到最上面了」的門檻（格）與間隔 */
const TOP_SAY_ROWS = 4
const TOP_SAY_GAP_MS = 4000
/** 寵物圖下面有留白：往下壓一點才像站在積木上（佔寵物邊長的比例） */
const PET_SINK = 0.1

const FALLBACK_FILL: Record<BlockColor, string> = { coral: '#ff7a6b', sun: '#ffc23d', leaf: '#5fc46c', sky: '#4fa8ec', grape: '#a483ee' }

/** 積木的樣子：有 3D 圖就用（珊瑚紅，靜態 CSS filter 換色），沒有就畫一塊形狀大致對的色塊 */
function BlockArt({ shape, color }: { shape: BlockShape; color: BlockColor }) {
  const st = useArtStatus(`ui-blk-${shape}`)
  if (st === 'ok') return <img className={`blk-img blk-c-${color}`} src={`${import.meta.env.BASE_URL}art/ui-blk-${shape}.png`} alt="" draggable={false} />
  return <BlockSvg shape={shape} fill={FALLBACK_FILL[color]} />
}

function BlockSvg({ shape, fill, line }: { shape: BlockShape; fill: string; line?: string }) {
  const { w, h } = BLOCK_SIZE[shape]
  const W = w * 20
  const H = h * 20
  const stroke = line ?? 'rgb(0 0 0 / 0.16)'
  const sw = line ? 2.5 : 1.5
  const common = { fill, stroke, strokeWidth: sw, strokeLinejoin: 'round' as const, vectorEffect: 'non-scaling-stroke' as const }
  let body: ReactNode
  switch (shape) {
    case 'arch':
      body = <path d={`M0.5 ${H}V6.5Q0.5 0.5 6.5 0.5H${W - 6.5}Q${W - 0.5} 0.5 ${W - 0.5} 6.5V${H}H${W / 2 + 17}A17 17 0 0 0 ${W / 2 - 17} ${H}Z`} {...common} />
      break
    case 'roof':
      body = <path d={`M3 ${H - 1}L${W / 2} 3L${W - 3} ${H - 1}Z`} {...common} strokeWidth={line ? 2.5 : 3} stroke={line ?? fill} />
      break
    case 'cyl':
      body = (
        <>
          <path d={`M0.5 7V${H - 6.5}A${W / 2 - 0.5} 6 0 0 0 ${W - 0.5} ${H - 6.5}V7Z`} {...common} />
          <ellipse cx={W / 2} cy={7} rx={W / 2 - 1} ry={6} {...common} fill={line ? fill : 'rgb(255 255 255 / 0.35)'} />
        </>
      )
      break
    case 'half':
      body = <path d={`M1 ${H - 1}A${W / 2 - 1} ${H - 2} 0 0 1 ${W - 1} ${H - 1}Z`} {...common} />
      break
    default:
      body = <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={6} {...common} />
  }
  return (
    <svg className="blk-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      {body}
      {!line && shape !== 'roof' && shape !== 'half' && <rect x={4} y={3} width={W - 8} height={Math.min(5, H / 5)} rx={2.5} fill="rgb(255 255 255 / 0.32)" />}
    </svg>
  )
}

interface Dims {
  unit: number
  cols: number
  /** 舞台在不縮放時裝得下幾格高 */
  rows: number
}
interface Ghost {
  /** 每次拖都是新的 id：手指的 pointerId 會重複用（飛回盤子的影子還在時又拖同一根手指） */
  gid: number
  shape: BlockShape
  color: BlockColor
  x: number
  y: number
  back?: { x: number; y: number }
}
type Drag = { kind: 'tray' | 'block'; shape: BlockShape; color: BlockColor; sx: number; sy: number; moved: boolean; id?: number; gid?: number; from?: Block }
interface Rubble extends Block {
  fromX: number
  fromY: number
  rot: number
  lift: number
}

/** 量舞台：一格的大小跟著畫面寬度走（44–64px），地面有幾格就是幾欄 */
function measure(el: HTMLElement | null): Dims | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  const unit = Math.max(44, Math.min(64, r.width / 14))
  return { unit, cols: Math.max(8, Math.floor(r.width / unit)), rows: r.height / unit }
}

function BlocksGame({ say: rawSay, finish }: GameProps) {
  const band = useBand()
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const later = useTimers()
  const [blocks, setBlocks] = useState<Block[]>([])
  const blocksRef = useRef<Block[]>([])
  const [rubble, setRubble] = useState<Rubble[] | null>(null)
  const [rubbleOut, setRubbleOut] = useState(false)
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  /**
   * 拿起來的積木：從堆疊裡拿掉（上面的往下掉），但元素先留著（看不見）。
   * iPad 的觸控事件會一直送到按下去的那個元素，元素被移掉的話後面的移動與放開就收不到了。
   */
  const [lifted, setLifted] = useState<Block[]>([])
  const nextGid = useRef(1)
  const [color, setColor] = useState<BlockColor>('coral')
  const [dims, setDims] = useState<Dims>({ unit: 56, cols: 16, rows: 10 })
  const dimsRef = useRef(dims)
  const [pose, setPose] = useState<Pose>('happy')
  const [acted, setActed] = useState(false)
  const [crashes, setCrashes] = useState(0)
  const [planRound, setPlanRound] = useState(0)
  const [matched, setMatched] = useState(false)
  const [booms, setBooms] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const hopRef = useRef<HTMLSpanElement>(null)
  const nextId = useRef(1)
  const placedTotal = useRef(0)
  const record = useRef(0)
  const lastTopSay = useRef(-Infinity)
  const drags = useRef(new Map<number, Drag>())
  /** 新放的積木從哪裡落下來（世界座標的位移，px） */
  const landFrom = useRef(new Map<number, { dx: number; dy: number }>())

  const date = useMemo(() => localDateStr(Date.now()), [])
  const plan: Blueprint | null = band === '6-7' ? blueprintFor(date, planRound) : null

  const commit = useCallback((next: Block[]) => {
    blocksRef.current = next
    setBlocks(next)
  }, [])

  // ---------- 量舞台（旋轉、改尺寸時重量；欄數變了積木夾回地面內） ----------
  useLayoutEffect(() => {
    const update = () => {
      const d = measure(stageRef.current)
      if (!d) return
      const prev = dimsRef.current
      if (Math.abs(prev.unit - d.unit) < 0.5 && prev.cols === d.cols && Math.abs(prev.rows - d.rows) < 0.05) return
      dimsRef.current = d
      setDims(d)
      if (d.cols !== prev.cols && blocksRef.current.length) {
        commit(settle(blocksRef.current.map((b) => ({ ...b, x: Math.min(b.x, Math.max(0, d.cols - BLOCK_SIZE[b.shape].w)) }))))
      }
    }
    update()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    if (stageRef.current) ro?.observe(stageRef.current)
    window.addEventListener('resize', update)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [commit])

  const top = towerTop(blocks)
  const scale = viewScale(top, dims.rows)
  const limit = maxRows(dims.rows)
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // ---------- 寵物：爬到最高那塊上面 ----------
  const tb = topBlock(blocks)
  const petX = tb ? tb.x + BLOCK_SIZE[tb.shape].w / 2 : rubble ? dims.cols / 2 : dims.cols - 2.5
  const petY = tb ? tb.y + BLOCK_SIZE[tb.shape].h : 0
  const petSize = PET_ROWS * dims.unit

  useEffect(() => {
    if (top > record.current) {
      record.current = top
      if (top >= TOP_SAY_ROWS && performance.now() - lastTopSay.current > TOP_SAY_GAP_MS) {
        lastTopSay.current = performance.now()
        say('pet.play.blocks.top')
        setPose('cheer')
        later(() => setPose((p) => (p === 'cheer' ? 'happy' : p)), 1400)
      }
    }
  }, [top, say, later])

  // ---------- 6–7 歲：照著蓋 ----------
  useEffect(() => {
    if (band !== '6-7') return
    const t = later(() => say('pet.play.blocks.copy'), 3600)
    return () => window.clearTimeout(t)
  }, [band, say, later])

  useEffect(() => {
    if (!plan || matched || !blocks.length || !matchesBlueprint(blocks, plan)) return
    setMatched(true)
    setBooms((n) => n + 1)
    setPose('cheer')
    playSfx('sparkle')
    playSound('correct')
    say('pet.play.blocks.match')
    petHop(hopRef.current, '-30%')
    finishLater()
    // 煙火放完換下一張藍圖（同一天可以一直蓋）
    later(() => {
      setMatched(false)
      setPlanRound((r) => r + 1)
      setPose('happy')
    }, 3200)
  }, [blocks, plan, matched, say, later, finishLater])

  // ---------- 放積木 ----------
  const clearRubble = useCallback(() => {
    if (!rubble || rubbleOut) return
    setRubbleOut(true)
    later(
      () => {
        setRubble(null)
        setRubbleOut(false)
      },
      reducedMotion() ? 0 : 320,
    )
  }, [rubble, rubbleOut, later])

  /** 放下一塊（x 已對齊）。from = 從畫面上哪一點落下（沒有就從上面掉下來） */
  const place = (shape: BlockShape, c: BlockColor, x: number, from: { x: number; y: number } | null, keepId?: number): boolean => {
    const cur = blocksRef.current
    if (!canPlace(cur, shape, x, limit)) return false
    const y = dropY(cur, shape, x)
    const id = keepId ?? nextId.current++
    const { w, h } = BLOCK_SIZE[shape]
    const wr = worldRef.current?.getBoundingClientRect()
    const s = scaleRef.current
    const u = dimsRef.current.unit
    if (from && wr) {
      const fx = wr.left + (x + w / 2) * u * s
      const fy = wr.bottom - (y + h / 2) * u * s
      landFrom.current.set(id, { dx: (from.x - fx) / s, dy: (from.y - fy) / s })
    } else landFrom.current.set(id, { dx: 0, dy: -3 * u })
    commit([...cur, { id, shape, color: c, x, y }])
    clearRubble()
    setActed(true)
    playSound('drop')
    if (!keepId) {
      placedTotal.current += 1
      if (placedTotal.current === FINISH_PLACED) finishLater()
    }
    later(() => petHop(hopRef.current), 160)
    return true
  }

  const tapPlace = (shape: BlockShape) => {
    if (!place(shape, color, autoColumn(shape, dimsRef.current.cols), null)) refuse()
  }

  /** 太高了放不下：寵物害羞一下，積木回盤子 */
  const refuse = () => {
    playSound('tap')
    setPose('shy')
    later(() => setPose((p) => (p === 'shy' ? 'happy' : p)), 900)
  }

  const ghostEl = (gid: number) => rootRef.current?.querySelector<HTMLElement>(`[data-gid="${gid}"]`)
  const trayHome = (shape: BlockShape) => {
    const r = trayRef.current?.querySelector(`[data-shape="${shape}"]`)?.getBoundingClientRect()
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight }
  }

  const onTrayDown = (e: RPointerEvent<HTMLButtonElement>, shape: BlockShape) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drags.current.set(e.pointerId, { kind: 'tray', shape, color, sx: e.clientX, sy: e.clientY, moved: false })
  }

  const onBlockDown = (e: RPointerEvent<HTMLDivElement>, b: Block) => {
    if ([...drags.current.values()].some((d) => d.id === b.id)) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drags.current.set(e.pointerId, { kind: 'block', shape: b.shape, color: b.color, sx: e.clientX, sy: e.clientY, moved: false, id: b.id })
  }

  // 拖的過程掛在 window：拿起來的積木會從畫面上移走，不能靠它自己的事件
  const handlers = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent, cancel: boolean) => void }>({ move: () => {}, up: () => {} })
  handlers.current.move = (e: PointerEvent) => {
    const d = drags.current.get(e.pointerId)
    if (!d) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return
      d.moved = true
      setActed(true)
      if (d.kind === 'block') {
        // 拿起來：上面的往下掉
        const cur = blocksRef.current
        const b = cur.find((x) => x.id === d.id)
        if (!b) {
          drags.current.delete(e.pointerId)
          return
        }
        d.from = b
        setLifted((l) => [...l, b])
        commit(settle(cur.filter((x) => x.id !== d.id)))
        playSound('tap')
      }
      const gid = nextGid.current++
      d.gid = gid
      setGhosts((g) => [...g, { gid, shape: d.shape, color: d.color, x: e.clientX, y: e.clientY }])
      return
    }
    const el = ghostEl(d.gid!)
    if (el) el.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`
  }
  handlers.current.up = (e: PointerEvent, cancel: boolean) => {
    const d = drags.current.get(e.pointerId)
    if (!d) return
    drags.current.delete(e.pointerId)
    const gid = d.gid
    if (!d.moved) {
      if (cancel) return
      if (d.kind === 'tray') tapPlace(d.shape)
      else wiggle(d.id!)
      return
    }
    const stage = stageRef.current?.getBoundingClientRect()
    const wr = worldRef.current?.getBoundingClientRect()
    if (d.kind === 'block') setLifted((l) => l.filter((x) => x.id !== d.id))
    const onStage = stage && wr && e.clientY <= stage.bottom + 8 && e.clientX >= stage.left - 20 && e.clientX <= stage.right + 20
    // 系統打斷（來電、多指手勢）：拿起來的積木放回原本那一格
    const at = cancel ? (d.from ? { x: d.from.x, pt: null } : null) : onStage ? { x: snapColumn((e.clientX - wr.left) / (wr.width / dimsRef.current.cols), d.shape, dimsRef.current.cols), pt: { x: e.clientX, y: e.clientY } } : null
    if (at) {
      if (place(d.shape, d.color, at.x, at.pt, d.kind === 'block' ? d.id : undefined)) {
        setGhosts((g) => g.filter((x) => x.gid !== gid))
        return
      }
      refuse()
    }
    // 放在盤子上（或放不下）：飛回盤子收起來
    const home = trayHome(d.shape)
    if (d.kind === 'block') playSfx('whoosh')
    setGhosts((g) => g.map((x) => (x.gid === gid ? { ...x, back: home } : x)))
    later(() => setGhosts((g) => g.filter((x) => x.gid !== gid)), reducedMotion() ? 0 : 320)
  }
  useEffect(() => {
    const move = (e: PointerEvent) => handlers.current.move(e)
    const up = (e: PointerEvent) => handlers.current.up(e, false)
    const cancel = (e: PointerEvent) => handlers.current.up(e, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [])

  const wiggle = (id: number) => {
    playSound('tap')
    const el = worldRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)
    if (el && !reducedMotion() && typeof el.animate === 'function')
      el.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(4deg)' }, { transform: 'rotate(0)' }], { duration: 300 })
  }

  // ---------- 推倒 ----------
  const crash = () => {
    const cur = blocksRef.current
    if (cur.length < 2) return
    drags.current.clear()
    setGhosts([])
    setLifted([])
    const sc = scatter(cur, dimsRef.current.cols)
    setRubble(cur.map((b) => ({ ...b, ...sc.find((s) => s.id === b.id)!, fromX: b.x, fromY: b.y, y: 0 })))
    setRubbleOut(false)
    commit([])
    record.current = 0
    setCrashes((n) => n + 1)
    setPose('dizzy')
    playSfx('whoosh')
    for (let i = 0; i < Math.min(5, cur.length); i++) later(() => playSound('drop'), 260 + i * 90)
    later(() => {
      setPose('laugh')
      say('pet.play.blocks.crash')
      petHop(hopRef.current, '-26%')
    }, reducedMotion() ? 100 : 720)
    later(() => setPose((p) => (p === 'laugh' ? 'happy' : p)), 3200)
    // 讓孩子先看完散一地、聽完寵物大笑，禮物才出來
    later(finishLater, 1800)
  }

  const again = () => {
    clearRubble()
    playSound('pop')
  }

  const firstShape = useCallback(() => trayRef.current?.querySelector('[data-shape]') ?? null, [])
  const stageEl = useCallback(() => worldRef.current?.querySelector('.blk-ground-mark') ?? stageRef.current, [])

  const worldW = dims.cols * dims.unit
  const s = scale
  const canCrash = blocks.length >= 2 && !rubble

  return (
    <div
      className="blk-root"
      ref={rootRef}
      data-testid="blocks"
      data-band={band}
      data-top={top}
      data-scale={s.toFixed(3)}
      data-cols={dims.cols}
      data-limit={limit}
      data-crashes={crashes}
      data-placed={blocks.length}
    >
      <div className="blk-stage" ref={stageRef} data-testid="blk-stage">
        <div
          className="blk-world"
          ref={worldRef}
          data-testid="blk-world"
          style={{ width: worldW, height: `${100 / s}%`, transform: `translateX(-50%) scale(${s})` } as CSSProperties}
        >
          <span className="blk-ground-mark" style={{ left: (dims.cols / 2 - 1) * dims.unit, width: 2 * dims.unit, height: dims.unit }} aria-hidden />
          {/* 同一個 key 空間：拿起來再放下時是同一個元素，不會重掛 */}
          {[...blocks.map((b) => [b, false] as const), ...lifted.map((b) => [b, true] as const)].map(([b, up]) => (
            <BlockView key={b.id} b={b} lifted={up} unit={dims.unit} landFrom={landFrom.current} onDown={onBlockDown} />
          ))}
          {rubble?.map((r, i) => (
            <RubbleView key={`r${r.id}`} r={r} i={i} unit={dims.unit} out={rubbleOut} />
          ))}
          <div
            className="blk-pet"
            data-testid="blk-pet"
            data-on={tb ? tb.id : 'ground'}
            style={{ width: petSize, height: petSize, transform: `translate(${petX * dims.unit - petSize / 2}px, ${-petY * dims.unit + petSize * PET_SINK}px)` }}
          >
            <span className="blk-pet-hop" ref={hopRef}>
              <Companion pose={pose} size={petSize} />
            </span>
          </div>
          {booms > 0 && matched && <Fireworks key={booms} />}
        </div>
      </div>

      <div className="blk-side">
        {plan && <PlanCard plan={plan} matched={matched} onTap={() => say('pet.play.blocks.copy')} />}
        {canCrash && (
          <button type="button" className="blk-crash" onClick={crash} data-testid="blk-crash" aria-label="推倒">
            <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden>
              <path d="M32 3l6 15 15-7-6 15 15 6-15 6 6 15-15-7-6 15-6-15-15 7 6-15-15-6 15-6-6-15 15 7z" fill="#ffd34d" stroke="#e8902a" strokeWidth="3" strokeLinejoin="round" />
              <circle cx="32" cy="32" r="9" fill="#ff7a5c" />
            </svg>
            <span>推倒</span>
          </button>
        )}
        {rubble && !rubbleOut && (
          <button type="button" className="blk-again" onClick={again} data-testid="blk-again" aria-label="收乾淨再蓋">
            <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden>
              <path d="M38 24a14 14 0 1 1-4.500-10.300" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              <path d="M36 4v12H24" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>再蓋</span>
          </button>
        )}
      </div>

      <div className="blk-tray" ref={trayRef} data-testid="blk-tray">
        <div className="blk-shapes">
          {BLOCK_SHAPES.map((sh) => (
            <button
              key={sh}
              type="button"
              className="blk-pick"
              data-shape={sh}
              data-testid={`blk-pick-${sh}`}
              aria-label={SHAPE_LABEL[sh]}
              onPointerDown={(e) => onTrayDown(e, sh)}
              onClick={(e) => {
                // 鍵盤或輔助工具按下去（沒有 pointer 事件）
                if (e.detail === 0) tapPlace(sh)
              }}
            >
              <span className="blk-pick-art" style={{ aspectRatio: `${BLOCK_SIZE[sh].w} / ${BLOCK_SIZE[sh].h}`, width: `${Math.min(1, BLOCK_SIZE[sh].w / BLOCK_SIZE[sh].h) * 100}%` }}>
                <BlockArt shape={sh} color={color} />
              </span>
            </button>
          ))}
        </div>
        <div className="blk-colors" role="radiogroup" aria-label="顏色">
          {BLOCK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={COLOR_LABEL[c]}
              className="blk-swatch"
              data-testid={`blk-color-${c}`}
              data-on={c === color ? '1' : undefined}
              onClick={() => {
                setColor(c)
                playSound('tap')
              }}
            >
              <i style={{ background: FALLBACK_FILL[c] }} />
            </button>
          ))}
        </div>
      </div>

      {ghosts.map((g) => {
        const { w, h } = BLOCK_SIZE[g.shape]
        const k = dims.unit * s
        return (
          <span
            key={g.gid}
            className="blk-ghost"
            data-gid={g.gid}
            data-back={g.back ? '1' : undefined}
            data-testid="blk-ghost"
            style={{ width: w * k, height: h * k, transform: `translate(${g.back?.x ?? g.x}px, ${g.back?.y ?? g.y}px) translate(-50%, -50%)${g.back ? ' scale(0.4)' : ''}` }}
            aria-hidden
          >
            <BlockArt shape={g.shape} color={g.color} />
          </span>
        )
      })}

      {!acted && <GestureHint from={firstShape} to={stageEl} />}
    </div>
  )
}

const SHAPE_LABEL: Record<BlockShape, string> = { cube: '方塊', long: '長條', arch: '拱門', roof: '三角屋頂', cyl: '圓柱', half: '半圓' }
const COLOR_LABEL: Record<BlockColor, string> = { coral: '紅色', sun: '黃色', leaf: '綠色', sky: '藍色', grape: '紫色' }

/** 一塊放好的積木。新放的從手指放開的地方落下；底下被拿走時往下掉（FLIP，只動 transform） */
function BlockView({ b, lifted, unit, landFrom, onDown }: { b: Block; lifted: boolean; unit: number; landFrom: Map<number, { dx: number; dy: number }>; onDown: (e: RPointerEvent<HTMLDivElement>, b: Block) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const prevY = useRef<number | null>(null)
  const { w, h } = BLOCK_SIZE[b.shape]
  useLayoutEffect(() => {
    const el = ref.current
    const from = landFrom.get(b.id)
    const old = prevY.current
    prevY.current = b.y
    if (!el || typeof el.animate !== 'function' || reducedMotion()) {
      landFrom.delete(b.id)
      return
    }
    if (from) {
      landFrom.delete(b.id)
      el.animate(
        [
          { transform: `translate(${from.dx}px, ${from.dy}px)` },
          { transform: 'translate(0, 0) scale(1.06, 0.92)', offset: 0.8 },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 300, easing: 'ease-in' },
      )
    } else if (old !== null && old !== b.y) {
      el.animate([{ transform: `translateY(${(b.y - old) * unit}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'ease-in' })
    }
  }, [b.id, b.y, unit, landFrom])
  return (
    <div
      ref={ref}
      className="blk-block"
      data-testid={lifted ? 'blk-lifted' : 'blk-block'}
      data-lifted={lifted ? '1' : undefined}
      data-id={b.id}
      data-shape={b.shape}
      data-color={b.color}
      data-x={b.x}
      data-y={b.y}
      style={{ left: b.x * unit, bottom: b.y * unit, width: w * unit, height: h * unit }}
      onPointerDown={(e) => !lifted && onDown(e, b)}
    >
      <BlockArt shape={b.shape} color={b.color} />
    </div>
  )
}

/** 推倒後散在地上的積木：從原本的位置彈起來、轉著落地（WAAPI，只動 transform） */
function RubbleView({ r, i, unit, out }: { r: Rubble; i: number; unit: number; out: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const { w, h } = BLOCK_SIZE[r.shape]
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof el.animate !== 'function' || reducedMotion()) return
    const dx = (r.fromX - r.x) * unit
    const y0 = -r.fromY * unit
    el.animate(
      [
        { transform: `translate(${dx}px, ${y0}px) rotate(0deg)` },
        { transform: `translate(${dx * 0.45}px, ${y0 - r.lift * unit}px) rotate(${r.rot * 0.5}deg)`, offset: 0.42, easing: 'ease-in' },
        { transform: `translate(0, 0) rotate(${r.rot * 1.15}deg)`, offset: 0.82 },
        { transform: `translate(0, 0) rotate(${r.rot}deg)` },
      ],
      { duration: 680 + (i % 4) * 60, easing: 'ease-out' },
    )
    // 只在剛推倒時演一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div
      ref={ref}
      className="blk-block blk-rubble"
      data-testid="blk-rubble"
      data-out={out ? '1' : undefined}
      style={{ left: r.x * unit, bottom: 0, width: w * unit, height: h * unit, transform: `rotate(${r.rot}deg)`, transformOrigin: r.rot < 0 ? '0% 100%' : '100% 100%' }}
    >
      <BlockArt shape={r.shape} color={r.color} />
    </div>
  )
}

/** 6–7 歲的小藍圖：藍底白線，點了寵物說「照著藍圖蓋」 */
function PlanCard({ plan, matched, onTap }: { plan: Blueprint; matched: boolean; onTap: () => void }) {
  const W = Math.max(...plan.blocks.map((b) => b.x + BLOCK_SIZE[b.shape].w))
  const H = Math.max(...plan.blocks.map((b) => b.y + BLOCK_SIZE[b.shape].h))
  const cell = 100 / Math.max(W, H)
  return (
    <button type="button" className="blk-plan" data-testid="blk-plan" data-plan={JSON.stringify(plan.blocks)} data-plan-id={plan.id} data-matched={matched ? '1' : undefined} onClick={onTap} aria-label="藍圖">
      <span className="blk-plan-paper" style={{ aspectRatio: `${W} / ${H}`, width: W >= H ? '100%' : `${(W / H) * 100}%` }}>
        {plan.blocks.map((b, i) => {
          const { w, h } = BLOCK_SIZE[b.shape]
          return (
            <span key={i} className="blk-plan-blk" style={{ left: `${(b.x / W) * 100}%`, bottom: `${(b.y / H) * 100}%`, width: `${(w / W) * 100}%`, height: `${(h / H) * 100}%` }}>
              <BlockSvg shape={b.shape} fill="rgb(255 255 255 / 0.18)" line="#fff" />
            </span>
          )
        })}
      </span>
      {matched && (
        <span className="blk-plan-ok" aria-hidden style={{ '--cell': cell } as CSSProperties}>
          ✓
        </span>
      )}
    </button>
  )
}

/** 煙火：三朵，每朵 10 顆火花（只動 transform 與 opacity） */
function Fireworks() {
  const COLORS = ['#ff6f91', '#ffc23d', '#5fc46c', '#4fa8ec', '#a483ee']
  return (
    <span className="blk-fireworks" aria-hidden data-testid="blk-fireworks">
      {[0, 1, 2].map((k) => (
        <span key={k} className="blk-burst" style={{ left: `${20 + k * 30}%`, top: `${18 + (k % 2) * 14}%`, '--d': `${k * 260}ms` } as CSSProperties}>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ '--a': `${i * 36}deg`, background: COLORS[(i + k) % COLORS.length] } as CSSProperties} />
          ))}
        </span>
      ))}
    </span>
  )
}

