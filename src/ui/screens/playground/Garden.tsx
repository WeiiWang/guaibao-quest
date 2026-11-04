import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FOOD_EMOJI } from '../../../art/items'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { now } from '../../../domain/clock'
import { localDateStr } from '../../../domain/date'
import { CROP_LABELS, GARDEN_CROPS, gardenIntroLine, normalizeGarden, plantArt, plotState, type Garden as GardenData } from '../../../domain/garden'
import type { GardenPlot } from '../../../domain/types'
import { playSound } from '../../../learning/audioEngine'
import { Icon } from '../../components/Icon'
import { flyOne, iconNode } from '../../fly'
import { Companion, type Pose } from '../adventure/Companion'
import { GameShell, type GameProps } from './GameShell'
import type { GameRootProps } from './GameScreen'
import { GestureHint, playSfx, useTimers } from './vShared'
import './garden.css'

// 小菜園：種下 → 澆水 → 隔天再澆 → 收成進背包。不會枯萎、沒有倒數、不用 finish()（獎勵是收成本身）。

const DRAG_SLOP = 10
const FX_MS = 1100

const plantEmoji = (p: GardenPlot) => (p.stage === 0 ? '🌱' : p.stage === 1 ? '🌿' : (FOOD_EMOJI[p.crop] ?? '🌱'))

export default function Garden({ onExit }: GameRootProps) {
  const garden = useLiveQuery(async () => normalizeGarden((await db.settings.get('main'))?.garden), [])
  // 進場那一句只看進來時的狀態，之後田怎麼變都不重講
  const [intro, setIntro] = useState<string | null>(null)
  if (garden && intro === null) setIntro(gardenIntroLine(garden, localDateStr(now())))
  if (!garden || !intro) return null
  return (
    <GameShell id="garden" scene="scene-play-garden" intro={intro} onExit={onExit}>
      {(p) => <GardenGame garden={garden} {...p} />}
    </GameShell>
  )
}

type FxKind = 'water' | 'grow'

function GardenGame({ garden, say }: { garden: GardenData } & GameProps) {
  const [today, setToday] = useState(() => localDateStr(now()))
  const [picking, setPicking] = useState<number | null>(null)
  const [fx, setFx] = useState<Record<number, { kind: FxKind; key: number }>>({})
  const [pose, setPose] = useState<Pose>('happy')
  const [watered, setWatered] = useState(false)
  const later = useTimers()
  const plotEls = useRef<(HTMLButtonElement | null)[]>([])
  const canRef = useRef<HTMLButtonElement>(null)
  const bagRef = useRef<HTMLSpanElement>(null)
  const canDrag = useRef<{ pid: number; sx: number; sy: number; moved: boolean; over: number | null } | null>(null)
  const busy = useRef(new Set<number>())
  const fxKey = useRef(0)

  // 開著過夜、或從背景回來：換成今天的樣子
  useEffect(() => {
    const refresh = () => setToday(localDateStr(now()))
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('gq-time', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('gq-time', refresh)
    }
  }, [])

  const cheer = (p: Pose, ms = 1200) => {
    setPose(p)
    later(() => setPose('happy'), ms)
  }

  const showFx = (i: number, kind: FxKind) => {
    const key = ++fxKey.current
    setFx((f) => ({ ...f, [i]: { kind, key } }))
    later(() => {
      setFx((f) => {
        if (f[i]?.key !== key) return f
        const rest = { ...f }
        delete rest[i]
        return rest
      })
    }, FX_MS)
  }

  const plant = (crop: string) => {
    const i = picking
    if (i === null) return
    setPicking(null)
    void repo.gardenPlant(i, crop).then((ok) => {
      if (!ok) return
      playSfx('drop')
      cheer('cheer', 800)
      say('pet.play.garden.water')
    })
  }

  const water = (i: number) => {
    // 動畫還沒演完就不再算一次（不然「長大了」馬上被「要睡覺了」蓋掉）
    if (busy.current.has(i)) return
    busy.current.add(i)
    later(() => busy.current.delete(i), FX_MS)
    setToday(localDateStr(now()))
    setWatered(true)
    playSfx('drop')
    showFx(i, 'water')
    void repo.gardenWater(i).then((outcome) => {
      if (outcome === 'grew') {
        showFx(i, 'grow')
        playSfx('sparkle')
        cheer('cheer')
        say('pet.play.garden.grow')
      } else if (outcome === 'asleep') {
        showFx(i, 'grow')
        cheer('happy')
        say('pet.play.garden.tomorrow')
      } else if (outcome === 'ready') {
        cheer('happy')
        say('pet.play.garden.ready')
      }
    })
  }

  const harvest = (i: number) => {
    const rect = plotEls.current[i]?.querySelector('.pg-gard-plant')?.getBoundingClientRect()
    void repo.gardenHarvest(i).then((r) => {
      if (!r) return
      playSound('reward')
      cheer('cheer', 1400)
      say('pet.play.garden.harvest')
      if (!rect) return
      const size = Math.min(rect.width, rect.height, 120)
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      for (let k = 0; k < r.qty; k++) {
        const box = { left: x - size / 2 + (k ? 20 : -20), top: y - size / 2, width: size, height: size }
        void flyOne({ rect: box, node: iconNode(`food-${r.crop}`, FOOD_EMOJI[r.crop] ?? '🥕', size) }, bagRef.current, { delay: k * 140, duration: 760 })
      }
    })
  }

  const tapPlot = (i: number) => {
    const state = plotState(garden[i], localDateStr(now()))
    if (state === 'empty') {
      playSound('tap')
      setPicking(i)
    } else if (state === 'ready') harvest(i)
    else water(i)
  }

  // ---------- 拖澆水壺 ----------
  const plotAt = (x: number, y: number): number | null => {
    for (const [i, el] of plotEls.current.entries()) {
      const r = el?.getBoundingClientRect()
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i
    }
    return null
  }
  const markOver = (i: number | null) => {
    plotEls.current.forEach((el, k) => {
      if (el) el.dataset.over = k === i ? '1' : '0'
    })
  }
  const onCanDown = (e: RPointerEvent<HTMLButtonElement>) => {
    if (canDrag.current) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.currentTarget.dataset.dragging = '1'
    canDrag.current = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, over: null }
  }
  const onCanMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = canDrag.current
    if (!d || d.pid !== e.pointerId) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return
    d.moved = true
    e.currentTarget.style.transform = `translate(${dx}px, ${dy}px) rotate(-14deg) scale(1.08)`
    d.over = plotAt(e.clientX, e.clientY)
    markOver(d.over)
  }
  const endCan = (el: HTMLElement) => {
    canDrag.current = null
    delete el.dataset.dragging
    el.style.transform = ''
    markOver(null)
  }
  const onCanUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = canDrag.current
    if (!d || d.pid !== e.pointerId) return
    const hit = d.moved ? plotAt(e.clientX, e.clientY) : null
    const moved = d.moved
    endCan(e.currentTarget)
    if (hit !== null) water(hit)
    else if (!moved) say('pet.play.garden.water')
  }
  const onCanCancel = (e: RPointerEvent<HTMLButtonElement>) => {
    if (canDrag.current?.pid === e.pointerId) endCan(e.currentTarget)
  }

  // ---------- 手勢示範 ----------
  const states = garden.map((p) => plotState(p, today))
  const hasPlant = states.some((s) => s !== 'empty')
  const firstThirsty = states.indexOf('thirsty')
  const canEl = useCallback(() => canRef.current, [])
  const thirstyEl = useCallback(() => plotEls.current[firstThirsty] ?? null, [firstThirsty])
  const firstPlotEl = useCallback(() => plotEls.current[0] ?? null, [])

  return (
    <div className="pg-gard" data-testid="garden">
      <div className="pg-gard-field" data-testid="garden-field">
        {garden.map((plot, i) => (
          <button
            key={i}
            type="button"
            ref={(el) => {
              plotEls.current[i] = el
            }}
            className="pg-gard-plot"
            data-testid={`plot-${i}`}
            data-state={states[i]}
            data-stage={plot?.stage ?? ''}
            data-crop={plot?.crop ?? ''}
            aria-label={plot ? (states[i] === 'ready' ? '收成' : '澆水') : '種東西'}
            onClick={() => tapPlot(i)}
          >
            {plot ? (
              <span key={`plant-${plot.stage}`} className="pg-gard-plant" data-shake={fx[i] ? '1' : undefined}>
                <Icon name={plantArt(plot)} emoji={plantEmoji(plot)} size="100%" alt="" />
              </span>
            ) : (
              <span className="pg-gard-plus" aria-hidden>
                +
              </span>
            )}
            {states[i] === 'thirsty' && <i className="pg-gard-wants" aria-hidden />}
            {states[i] === 'sleeping' && (
              <span className="pg-gard-zzz" aria-hidden data-testid={`plot-zzz-${i}`}>
                z<small>z</small>
              </span>
            )}
            {states[i] === 'ready' && (
              <span className="pg-gard-sparks" aria-hidden data-testid={`plot-spark-${i}`}>
                <i>✦</i>
                <i>✦</i>
                <i>✦</i>
              </span>
            )}
            {fx[i] && (
              <span key={`fx-${fx[i].key}`} className="pg-gard-fx" aria-hidden data-testid={`plot-fx-${i}`}>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <i key={n} className="pg-gard-drop" style={{ '--n': n } as React.CSSProperties} />
                ))}
                {fx[i].kind === 'grow' &&
                  [0, 1, 2, 3].map((n) => (
                    <i key={n} className="pg-gard-star" style={{ '--n': n } as React.CSSProperties}>
                      ★
                    </i>
                  ))}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="pg-gard-dock">
        <Companion pose={pose} size="var(--pg-gard-pet-size)" />
        <button
          ref={canRef}
          type="button"
          className="pg-gard-can"
          aria-label="澆水壺"
          data-testid="garden-can"
          onPointerDown={onCanDown}
          onPointerMove={onCanMove}
          onPointerUp={onCanUp}
          onPointerCancel={onCanCancel}
        >
          <Icon name="ui-play-can" emoji="💧" size="100%" alt="" />
        </button>
        <span ref={bagRef} className="pg-gard-bag" data-testid="garden-bag" aria-hidden>
          <Icon name="ui-bag" emoji="🎒" size="100%" alt="" />
        </span>
      </div>

      {picking !== null && (
        <div className="pg-gard-picker" data-testid="seed-picker" role="dialog" aria-label="選一種種子" onClick={() => setPicking(null)}>
          <div className="pg-gard-seeds" onClick={(e) => e.stopPropagation()}>
            {GARDEN_CROPS.map((c) => (
              <button key={c} type="button" className="pg-gard-seed" onClick={() => plant(c)} aria-label={CROP_LABELS[c]} data-testid={`seed-${c}`}>
                <Icon name={`food-${c}`} emoji={FOOD_EMOJI[c]} size="100%" alt="" />
              </button>
            ))}
          </div>
          <button type="button" className="pg-gard-close" aria-label="先不種" data-testid="seed-close" onClick={() => setPicking(null)}>
            ✕
          </button>
        </div>
      )}

      {picking === null && !hasPlant && <GestureHint from={firstPlotEl} to={firstPlotEl} />}
      {picking === null && hasPlant && !watered && firstThirsty >= 0 && <GestureHint from={canEl} to={thirstyEl} />}
    </div>
  )
}
