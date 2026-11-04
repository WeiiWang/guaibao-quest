import { useCallback, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { BAKERY_BASES, BAKERY_TOPPINGS, MAX_TOPPINGS, SPRINKLE_LAYERS, autoSpot, eatIntervalMs, snapToBase, sprinkleDots, type BakeryBaseId } from '../../../domain/bakery'
import { playSound } from '../../../learning/audioEngine'
import { Icon } from '../../components/Icon'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell, type GameProps } from './GameShell'
import type { GameRootProps } from './GameScreen'
import { GestureHint, playSfx, reducedMotion, useTimers } from './vShared'
import './bakery.css'

// 點心屋：選底座 → 裝飾 → 送給寵物吃。沒有對錯，不消耗背包、不增加成長。

type Phase = 'choose' | 'decorate' | 'give' | 'eat' | 'done'
type Topping = (typeof BAKERY_TOPPINGS)[number]

interface Deco {
  id: number
  top: Topping
  x: number
  y: number
  leaving?: boolean
}
interface Ghost {
  pid: number
  top: Topping
  x: number
  y: number
  back?: { x: number; y: number }
}
/** 手指正在做的事（每根手指一筆，可以多指） */
type Drag =
  | { kind: 'tray'; top: Topping; sx: number; sy: number; moved: boolean }
  | { kind: 'deco'; id: number; sx: number; sy: number; moved: boolean }
  | { kind: 'treat'; sx: number; sy: number; dx: number; dy: number; moved: boolean }

/** 手指移動超過這個距離才算拖（手指很大，太小會把點一下變成拖） */
const DRAG_SLOP = 10
/** 吃完到送禮物的間隔：讓「最好吃的」先說完 */
const FINISH_DELAY_MS = 2300

export default function Bakery({ onExit }: GameRootProps) {
  return (
    <GameShell id="bakery" scene="scene-play-bakery" intro="pet.play.bakery.intro" onExit={onExit}>
      {(p) => <BakeryGame {...p} />}
    </GameShell>
  )
}

function BakeryGame({ say, finish }: GameProps) {
  const [phase, setPhase] = useState<Phase>('choose')
  const [base, setBase] = useState<BakeryBaseId>('cake')
  const [decos, setDecos] = useState<Deco[]>([])
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [layers, setLayers] = useState(0)
  const [eaten, setEaten] = useState(0)
  const [bites, setBites] = useState(0)
  const [pose, setPose] = useState<Pose>('happy')
  const [reacts, setReacts] = useState(0)
  const [flyTo, setFlyTo] = useState<{ dx: number; dy: number } | null>(null)
  const [acted, setActed] = useState(false)
  const later = useTimers()
  const boxRef = useRef<HTMLDivElement>(null)
  const petRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)
  const placed = useRef(0)
  const eating = useRef(false)
  const drags = useRef(new Map<number, Drag>())

  const baseMeta = BAKERY_BASES.find((b) => b.id === base)!
  const dots = useMemo(() => Array.from({ length: layers }, (_, l) => sprinkleDots(base, l)).flat(), [base, layers])

  /** 寵物的小反應：彈一下、笑一下（不重掛 Companion，不然圖會閃） */
  const petReact = () => {
    setReacts((n) => n + 1)
    setPose('laugh')
    later(() => setPose((p) => (p === 'laugh' ? 'happy' : p)), 520)
    if (!reducedMotion()) petRef.current?.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-14px) scale(1.05)' }, { transform: 'translateY(0) scale(1)' }], { duration: 360, easing: 'ease-out' })
  }

  const chooseBase = (id: BakeryBaseId) => {
    setBase(id)
    setPhase('decorate')
    setActed(false)
    playSound('pop')
    say('pet.play.bakery.decorate')
  }

  // ---------- 裝飾 ----------
  /** 手指位置換算成底座圖框的百分比 */
  const toBox = (cx: number, cy: number) => {
    const r = boxRef.current?.getBoundingClientRect()
    if (!r || !r.width) return null
    return { x: ((cx - r.left) / r.width) * 100, y: ((cy - r.top) / r.height) * 100 }
  }
  const stick = (top: Topping, x: number, y: number): boolean => {
    if (decos.filter((d) => !d.leaving).length >= MAX_TOPPINGS) return false
    const id = nextId.current++
    placed.current += 1
    setDecos((ds) => [...ds, { id, top, x, y }])
    setActed(true)
    playSound('pop')
    petReact()
    return true
  }

  const ghostEl = (pid: number) => rootRef.current?.querySelector<HTMLElement>(`[data-pid="${pid}"]`)

  const onTrayDown = (e: RPointerEvent<HTMLButtonElement>, top: Topping) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drags.current.set(e.pointerId, { kind: 'tray', top, sx: e.clientX, sy: e.clientY, moved: false })
  }
  const onTrayMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drags.current.get(e.pointerId)
    if (!d || d.kind !== 'tray') return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return
      d.moved = true
      setGhosts((g) => [...g, { pid: e.pointerId, top: d.top, x: e.clientX, y: e.clientY }])
      return
    }
    const el = ghostEl(e.pointerId)
    if (el) el.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`
  }
  const onTrayUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drags.current.get(e.pointerId)
    if (!d || d.kind !== 'tray') return
    drags.current.delete(e.pointerId)
    if (!d.moved) {
      // 點一下：3 歲不一定會拖，點了也放得上去
      const p = autoSpot(base, placed.current)
      stick(d.top, p.x, p.y)
      return
    }
    const pid = e.pointerId
    const p = toBox(e.clientX, e.clientY)
    const spot = p && snapToBase(base, p.x, p.y)
    if (spot && stick(d.top, spot.x, spot.y)) {
      setGhosts((g) => g.filter((x) => x.pid !== pid))
      return
    }
    // 放在外面（或已經放滿）：溫和地飛回托盤再消失
    const home = e.currentTarget.getBoundingClientRect()
    setGhosts((g) => g.map((x) => (x.pid === pid ? { ...x, back: { x: home.left + home.width / 2, y: home.top + home.height / 2 } } : x)))
    later(() => setGhosts((g) => g.filter((x) => x.pid !== pid)), reducedMotion() ? 0 : 340)
  }
  const onTrayCancel = (e: RPointerEvent<HTMLButtonElement>) => {
    const pid = e.pointerId
    if (!drags.current.delete(pid)) return
    setGhosts((g) => g.filter((x) => x.pid !== pid))
  }

  const onDecoDown = (e: RPointerEvent<HTMLButtonElement>, id: number) => {
    if (phase !== 'decorate') return
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drags.current.set(e.pointerId, { kind: 'deco', id, sx: e.clientX, sy: e.clientY, moved: false })
  }
  const onDecoMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drags.current.get(e.pointerId)
    if (!d || d.kind !== 'deco') return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return
    d.moved = true
    const p = toBox(e.clientX, e.clientY)
    if (!p) return
    const el = e.currentTarget
    el.style.left = `${p.x}%`
    el.style.top = `${p.y}%`
    el.dataset.out = snapToBase(base, p.x, p.y) ? '0' : '1'
  }
  const onDecoUp = (e: RPointerEvent<HTMLButtonElement>, deco: Deco) => {
    const d = drags.current.get(e.pointerId)
    if (!d || d.kind !== 'deco') return
    drags.current.delete(e.pointerId)
    const el = e.currentTarget
    if (!d.moved) {
      // 點一下輕輕彈
      el.dataset.bop = String(Number(el.dataset.bop ?? 0) + 1)
      playSound('tap')
      if (!reducedMotion()) el.animate([{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: 'translate(-50%, -62%) scale(1.14)' }, { transform: 'translate(-50%, -50%) scale(1)' }], { duration: 320, easing: 'ease-out' })
      return
    }
    delete el.dataset.out
    const p = toBox(e.clientX, e.clientY)
    const spot = p && snapToBase(base, p.x, p.y)
    if (spot) {
      el.style.left = `${spot.x}%`
      el.style.top = `${spot.y}%`
      setDecos((ds) => ds.map((x) => (x.id === deco.id ? { ...x, x: spot.x, y: spot.y } : x)))
      playSound('tap')
      return
    }
    // 拖出點心外：消失
    setDecos((ds) => ds.map((x) => (x.id === deco.id ? { ...x, leaving: true } : x)))
    playSfx('whoosh')
    later(() => setDecos((ds) => ds.filter((x) => x.id !== deco.id)), reducedMotion() ? 0 : 240)
  }
  const onDecoCancel = (e: RPointerEvent<HTMLButtonElement>, deco: Deco) => {
    if (!drags.current.delete(e.pointerId)) return
    const el = e.currentTarget
    delete el.dataset.out
    el.style.left = `${deco.x}%`
    el.style.top = `${deco.y}%`
  }

  const sprinkle = () => {
    playSfx('sparkle')
    setActed(true)
    setLayers((n) => Math.min(SPRINKLE_LAYERS, n + 1))
    petReact()
  }

  const done = () => {
    drags.current.clear()
    setGhosts([])
    setDecos((ds) => ds.filter((d) => !d.leaving))
    setPhase('give')
    setActed(false)
    playSound('pop')
    say('pet.play.bakery.give')
  }

  // ---------- 送給寵物吃 ----------
  const startEat = (dragDx = 0, dragDy = 0) => {
    if (eating.current || phase !== 'give') return
    const box = boxRef.current?.getBoundingClientRect()
    const pet = petRef.current?.getBoundingClientRect()
    if (!box || !pet) return
    eating.current = true
    drags.current.clear()
    // 飛到寵物嘴邊（不是正中間，才看得到一口一口吃）
    const bx = box.left + box.width / 2 - dragDx
    const by = box.top + box.height / 2 - dragDy
    const px = pet.left + pet.width / 2
    const py = pet.top + pet.height / 2
    setFlyTo({ dx: (px - bx) * 0.72, dy: (py - by) * 0.72 + pet.height * 0.12 })
    setPhase('eat')
    setPose('eating')
    setActed(true)
    playSfx('whoosh')
    const count = decos.length
    const gap = eatIntervalMs(count)
    const step = (i: number) => {
      if (i < count) setEaten(i + 1)
      else if (i < count + 3) setBites(i - count + 1)
      else {
        eating.current = false
        setPhase('done')
        setPose('laugh')
        playSound('correct')
        say('pet.play.bakery.yum')
        later(finish, FINISH_DELAY_MS)
        return
      }
      setPose(i % 2 ? 'eating' : 'happy')
      playSound('pop')
      later(() => step(i + 1), i < count ? gap : 420)
    }
    later(() => step(0), reducedMotion() ? 120 : 520)
  }

  const onTreatDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (phase !== 'give' || drags.current.size) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.currentTarget.dataset.dragging = '1'
    drags.current.set(e.pointerId, { kind: 'treat', sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false })
  }
  const onTreatMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drags.current.get(e.pointerId)
    if (!d || d.kind !== 'treat') return
    d.dx = e.clientX - d.sx
    d.dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(d.dx, d.dy) < DRAG_SLOP) return
    d.moved = true
    e.currentTarget.style.transform = `translate(${d.dx}px, ${d.dy}px)`
  }
  const resetTreat = (el: HTMLElement) => {
    delete el.dataset.dragging
    el.style.transform = ''
  }
  const onTreatUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drags.current.get(e.pointerId)
    if (!d || d.kind !== 'treat') return
    drags.current.delete(e.pointerId)
    const el = e.currentTarget
    if (!d.moved) {
      resetTreat(el)
      startEat()
      return
    }
    const pet = petRef.current?.getBoundingClientRect()
    const slop = 40
    const hit = pet && e.clientX >= pet.left - slop && e.clientX <= pet.right + slop && e.clientY >= pet.top - slop && e.clientY <= pet.bottom + slop
    if (hit) {
      delete el.dataset.dragging
      startEat(d.dx, d.dy)
    } else resetTreat(el)
  }
  const onTreatCancel = (e: RPointerEvent<HTMLDivElement>) => {
    if (drags.current.delete(e.pointerId)) resetTreat(e.currentTarget)
  }

  const again = () => {
    setPhase('choose')
    setDecos([])
    setGhosts([])
    setLayers(0)
    setEaten(0)
    setBites(0)
    setFlyTo(null)
    setPose('happy')
    setActed(false)
    placed.current = 0
    playSound('pop')
    say('pet.play.bakery.intro')
  }

  const trayFirst = useCallback(() => trayRef.current?.querySelector('button') ?? null, [])
  const boxEl = useCallback(() => boxRef.current, [])
  const petEl = useCallback(() => petRef.current, [])

  const live = decos.filter((_, i) => i < decos.length - eaten)
  const showTreat = phase !== 'choose' && phase !== 'done'

  return (
    <div className="pg-bake" ref={rootRef} data-phase={phase} data-testid="bakery" data-base={base}>
      <div className="pg-bake-pet" ref={petRef} data-testid="bake-pet" data-reacts={reacts} onClick={() => phase === 'give' && startEat()}>
        <Companion pose={pose} size="var(--pg-bake-pet-size)" />
        {phase === 'done' && (
          <span className="pg-bake-hearts" aria-hidden data-testid="bake-hearts">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <i key={i} style={{ '--i': i } as React.CSSProperties}>
                ♥
              </i>
            ))}
          </span>
        )}
      </div>

      {phase === 'choose' && (
        <div className="pg-bake-choose">
          {BAKERY_BASES.map((b) => (
            <button key={b.id} className="pg-bake-base-btn" onClick={() => chooseBase(b.id)} aria-label={b.label} data-testid={`bake-base-${b.id}`}>
              <Icon name={b.icon} emoji={b.emoji} size="100%" alt="" />
            </button>
          ))}
        </div>
      )}

      {showTreat && (
        <div className="pg-bake-cell">
          <div
            className="pg-bake-box"
            ref={boxRef}
            data-testid="bake-treat"
            style={flyTo ? { transform: `translate(${flyTo.dx}px, ${flyTo.dy}px) scale(0.56)` } : undefined}
            onPointerDown={onTreatDown}
            onPointerMove={onTreatMove}
            onPointerUp={onTreatUp}
            onPointerCancel={onTreatCancel}
          >
            <span className="pg-bake-base-art" style={{ transform: `scale(${[1, 0.76, 0.5, 0.2][bites]})` }}>
              <Icon name={baseMeta.icon} emoji={baseMeta.emoji} size="100%" alt={baseMeta.label} />
            </span>
            {bites === 0 &&
              dots.map((d, i) => <i key={i} className="pg-bake-dot" style={{ left: `${d.x}%`, top: `${d.y}%`, background: d.color }} aria-hidden data-testid="bake-dot" />)}
            {live.map((d) => (
              <button
                key={d.id}
                type="button"
                className="pg-bake-deco"
                style={{ left: `${d.x}%`, top: `${d.y}%` }}
                aria-label={d.top.label}
                data-testid="bake-deco"
                data-leaving={d.leaving ? '1' : undefined}
                onPointerDown={(e) => onDecoDown(e, d.id)}
                onPointerMove={onDecoMove}
                onPointerUp={(e) => onDecoUp(e, d)}
                onPointerCancel={(e) => onDecoCancel(e, d)}
              >
                <Icon name={d.top.icon} emoji={d.top.emoji} size="100%" alt="" />
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'decorate' && (
        <>
          <div className="pg-bake-tools">
            <button className="pg-bake-tool" onClick={sprinkle} aria-label="撒糖珠" data-testid="bake-sprinkle">
              <span className="pg-bake-sprinkle-icon" aria-hidden>
                <i /><i /><i /><i /><i /><i />
              </span>
              <span>撒糖珠</span>
            </button>
            <button className="pg-bake-tool pg-bake-done" onClick={done} aria-label="完成" data-testid="bake-done">
              <span className="pg-bake-check" aria-hidden>✓</span>
              <span>完成</span>
            </button>
          </div>
          <div className="pg-bake-tray" ref={trayRef} data-testid="bake-tray">
            {BAKERY_TOPPINGS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="pg-bake-top"
                aria-label={t.label}
                data-testid={`bake-top-${t.id}`}
                onPointerDown={(e) => onTrayDown(e, t)}
                onPointerMove={onTrayMove}
                onPointerUp={onTrayUp}
                onPointerCancel={onTrayCancel}
                onClick={(e) => {
                  // 鍵盤或輔助工具按下去（沒有 pointer 事件）
                  if (e.detail === 0) {
                    const p = autoSpot(base, placed.current)
                    stick(t, p.x, p.y)
                  }
                }}
              >
                <Icon name={t.icon} emoji={t.emoji} size="100%" alt="" />
              </button>
            ))}
          </div>
        </>
      )}

      {ghosts.map((g) => (
        <span
          key={g.pid}
          className="pg-bake-ghost"
          data-pid={g.pid}
          data-back={g.back ? '1' : undefined}
          data-testid="bake-ghost"
          style={{ transform: `translate(${g.back?.x ?? g.x}px, ${g.back?.y ?? g.y}px) translate(-50%, -50%)${g.back ? ' scale(0.6)' : ''}` }}
          aria-hidden
        >
          <Icon name={g.top.icon} emoji={g.top.emoji} size="100%" alt="" />
        </span>
      ))}

      {phase === 'done' && (
        <button className="pg-bake-again" onClick={again} data-testid="bake-again" aria-label="再做一個">
          <Icon name={baseMeta.icon} emoji={baseMeta.emoji} size={64} alt="" />
          <span>再做一個</span>
        </button>
      )}

      {!acted && phase === 'decorate' && <GestureHint from={trayFirst} to={boxEl} />}
      {!acted && phase === 'give' && <GestureHint from={boxEl} to={petEl} />}
    </div>
  )
}
