// 阿悟的生命感：把 src/pet/ 的純邏輯（排程、腳本、日夜、便便）接到 React。
// 這裡只負責「執行」：照時間軸腳本逐步套用姿勢/動畫/泡泡/特效/音效，並管理計時器的清理。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { repo } from '../../db/repo'
import { sayRecorded, sayText } from '../../learning/speech'
import { pickTrick, type TrickId } from '../../domain/tricks'
import { now as clockNow } from '../../domain/clock'
import { PET_X } from '../../domain/room'
import type { Pet, Poop, Stage } from '../../domain/types'
import { BehaviorScheduler, type Gate, type PickContext } from '../../pet/behavior'
import { drainPetCommands, getFastSchedule, CMD_EVENT, type PetCommand } from '../../pet/bus'
import { getTimeOfDay, isSleepTime, type TimeOfDay, type TodMode } from '../../pet/daynight'
import {
  planBehavior,
  planEat,
  planGift,
  planPoop,
  planReaction,
  TRICK_BEHAVIOR,
  type Action,
  type AnimId,
  type BehaviorId,
  type FxId,
  type PlanEnv,
  type PoseId,
  type Scene,
  type SceneKind,
  type TimedWalk,
} from '../../pet/plan'
import { pickPoopX, type PoopSpread } from '../../pet/poop'
import { playPetSound } from '../../pet/sounds'
import { initialTapState, registerTap, type TapState } from '../../pet/taps'
import { pickWalk, walkDurationMs, walkTo, type Obstacle } from '../../pet/walk'
import { TRICK_IDS } from '../../domain/tricks'

export interface Bubble {
  id: number
  text?: string
  icon?: string
}
export type FoodPhase = 'fly' | 'chew' | 'gulp' | 'absorb'
export interface FoodFx {
  /** public/art 圖名與缺圖時的 emoji */
  art: string
  emoji?: string
  /** 碎屑顏色 */
  color: string
  /** 飛行起點，相對於「手部位置」的 px 偏移 */
  dx: number
  dy: number
  phase: FoodPhase
  bites: number
}
export interface PetView {
  pose: PoseId | null
  anim: AnimId | null
  flip: boolean
  fx: FxId[]
  bubble: Bubble | null
  food: FoodFx | null
  ballBounce: boolean
  /** v5：整理房間時，家具閃一下 */
  roomFlash: boolean
}
export const EMPTY_VIEW: PetView = { pose: null, anim: null, flip: false, fx: [], bubble: null, food: null, ballBounce: false, roomFlash: false }

export interface FoodMeta {
  art: string
  emoji?: string
  color: string
  /** 蛋糕：吃完會跳舞 */
  celebrate?: boolean
  /** 今天最喜歡的食物 */
  favorite?: boolean
}

export interface Geometry {
  roomW: number
  roomH: number
  viewW: number
  scrollLeft: number
  /** 寵物寬度（px） */
  petW: number
  /** 地板上擋路的家具 */
  obstacles: (Obstacle & { id: string })[]
  /** 玩具球（中心 x 與半寬，房間寬度比例），不在可視範圍就是 null */
  ball: { x: number; halfW: number } | null
}

export interface PetLifeParams {
  pet: Pet
  stage: Stage
  hunger: number
  childName: string
  now: number
  todMode: TodMode
  edit: boolean
  dragging: boolean
  soundOn: boolean
  /** 語音開關（禮物、數數會唸出來）；未給視為開 */
  voiceOn?: boolean
  wishIcons: readonly string[]
  slotRef: RefObject<HTMLDivElement | null>
  geo: () => Geometry
  /** 床（中心 x 與位置 y，比例）；沒擺就是 null。床是否擺放在渲染時就知道，所以不放在 geo() 裡 */
  bed: { x: number; y: number; h: number } | null
  /** 房間量測完成（可以執行 PM 指令） */
  ready: boolean
}

const PRIORITY: Record<SceneKind, number> = { behavior: 1, reaction: 2, poop: 3, eat: 3 }
/** 新便便出現多久內算「剛發生」（要演蹲下、噗）；更久以前的（離線補上）直接出現 */
const FRESH_POOP_MS = 5000
/** 點醒睡著的阿悟後，醒著的時間 */
export const AWAKE_MS = 10_000

interface Running {
  scene: Scene
  token: number
  timers: number[]
}

export function usePetLife(p: PetLifeParams) {
  const P = useRef(p)
  useLayoutEffect(() => {
    P.current = p
  })

  const [view, setView] = useState<PetView>(EMPTY_VIEW)
  const [petX, setPetXState] = useState(PET_X)
  const petXRef = useRef(PET_X)
  const [walkMs, setWalkMs] = useState(0)
  const walkingRef = useRef(false)
  const [forceSleep, setForceSleep] = useState(false)
  const [awake, setAwake] = useState(false)
  const [freshIds, setFreshIds] = useState<string[]>([])

  const sceneRef = useRef<Running | null>(null)
  const tokenRef = useRef(0)
  const timersRef = useRef<Set<number>>(new Set())
  const bubbleSeq = useRef(0)
  const foodRef = useRef<FoodMeta & { dx: number; dy: number }>({ art: '', color: '#f3c98b', dx: 0, dy: 0 })
  const schedRef = useRef<BehaviorScheduler | null>(null)
  const tapRef = useRef<TapState>(initialTapState)
  const awakeTimer = useRef<number | undefined>(undefined)
  const takingDue = useRef(false)
  const chainRef = useRef(0)
  const lastTrick = useRef<TrickId | null>(null)

  // ---------- 睡覺 / 日夜 ----------
  const tod: TimeOfDay = getTimeOfDay(p.now, p.todMode)
  const baseSleep = isSleepTime(p.now, p.todMode)
  const asleep = (forceSleep || baseSleep) && !awake
  const asleepRef = useRef(asleep)
  useLayoutEffect(() => {
    asleepRef.current = asleep
  })
  const bed = p.stage !== 'egg' ? p.bed : null
  const onBed = asleep && !!bed

  // ---------- 計時器 ----------
  const later = useCallback((fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id)
      fn()
    }, ms)
    timersRef.current.add(id)
    return id
  }, [])
  const clearLater = useCallback((id: number | undefined) => {
    if (id === undefined) return
    window.clearTimeout(id)
    timersRef.current.delete(id)
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
      timers.clear()
      sceneRef.current = null
    }
  }, [])

  /** 便便落在離寵物約 0.9–2.3 個身寬的地方（不會疊在寵物身上） */
  const poopSpread = useCallback((): PoopSpread => {
    const g = P.current.geo()
    const w = g.roomW ? g.petW / g.roomW : 0.06
    // 便便要出現在看得到的範圍內（房間是可視寬的 2.5 倍，不然小螢幕上便便可能在畫面外）
    const margin = g.roomW ? 56 / g.roomW : 0.03
    const lo = g.roomW ? Math.max(0.06, g.scrollLeft / g.roomW + margin) : undefined
    const hi = g.roomW ? Math.min(0.94, (g.scrollLeft + g.viewW) / g.roomW - margin) : undefined
    return { min: Math.max(0.04, w * 0.9), max: Math.max(0.1, w * 2.3), lo, hi }
  }, [])

  // ---------- 位置 ----------
  const movePet = useCallback((x: number, ms: number) => {
    petXRef.current = x
    setWalkMs(ms)
    setPetXState(x)
  }, [])

  /** 走到一半被打斷：停在目前的位置 */
  const freezePet = useCallback(() => {
    if (!walkingRef.current) return
    walkingRef.current = false
    const el = P.current.slotRef.current
    const g = P.current.geo()
    if (!el || !g.roomW) return
    const left = parseFloat(getComputedStyle(el).left)
    if (!Number.isFinite(left)) return
    movePet((left + g.petW / 2) / g.roomW, 0)
  }, [movePet])

  // ---------- 場景執行 ----------
  const showBubble = useCallback(
    (b: { text?: string; icon?: string }, ms: number, running: Running | null) => {
      const id = ++bubbleSeq.current
      setView((v) => ({ ...v, bubble: { id, ...b } }))
      const t = later(() => setView((v) => (v.bubble?.id === id ? { ...v, bubble: null } : v)), ms)
      running?.timers.push(t)
    },
    [later],
  )

  const apply = useCallback(
    (a: Action, running: Running) => {
      switch (a.do) {
        case 'pose':
          setView((v) => ({ ...v, pose: a.pose }))
          break
        case 'anim':
          setView((v) => ({ ...v, anim: a.anim }))
          break
        case 'flip':
          setView((v) => ({ ...v, flip: a.on }))
          break
        case 'say':
          showBubble({ text: a.text, icon: a.icon }, a.ms, running)
          if (a.text) sayRecorded('pet.', a.text, { enabled: P.current.voiceOn !== false })
          break
        case 'fx': {
          setView((v) => (v.fx.includes(a.fx) ? v : { ...v, fx: [...v.fx, a.fx] }))
          running.timers.push(later(() => setView((v) => ({ ...v, fx: v.fx.filter((f) => f !== a.fx) })), a.ms))
          break
        }
        case 'sound':
          playPetSound(a.sound, P.current.soundOn)
          break
        case 'walk':
          walkingRef.current = true
          movePet(a.toX, a.ms)
          running.timers.push(
            later(() => {
              walkingRef.current = false
            }, a.ms),
          )
          break
        case 'poop':
          break // 便便已經在資料庫裡，出現動畫由 CSS 延遲對上這一刻
        case 'food': {
          const f = foodRef.current
          setView((v) => {
            const base = v.food ?? { art: f.art, emoji: f.emoji, color: f.color, dx: f.dx, dy: f.dy, phase: 'fly' as FoodPhase, bites: 0 }
            if (a.phase === 'fly') return { ...v, food: { ...base, phase: 'fly', bites: 0 } }
            if (a.phase === 'bite') return { ...v, food: { ...base, phase: 'chew', bites: a.n ?? base.bites + 1 } }
            return { ...v, food: { ...base, phase: a.phase } }
          })
          break
        }
        case 'ball':
          setView((v) => ({ ...v, ballBounce: a.on }))
          break
        case 'voice':
          sayText(a.text, { enabled: P.current.voiceOn !== false })
          break
        case 'flash':
          setView((v) => ({ ...v, roomFlash: a.on }))
          break
      }
    },
    [later, movePet, showBubble],
  )

  const cancelScene = useCallback(() => {
    const r = sceneRef.current
    if (r) {
      r.timers.forEach(clearLater)
      sceneRef.current = null
    }
    freezePet()
    setView(EMPTY_VIEW)
  }, [clearLater, freezePet])

  const startScene = useCallback(
    (scene: Scene): boolean => {
      const cur = sceneRef.current
      if (cur && PRIORITY[cur.scene.kind] > PRIORITY[scene.kind]) return false
      cancelScene()
      const token = ++tokenRef.current
      const running: Running = { scene, token, timers: [] }
      sceneRef.current = running
      // 同一時間點的步驟照順序一起套用，其餘排計時器
      for (const s of scene.steps) {
        if (s.at <= 0) apply(s.act, running)
        else running.timers.push(later(() => apply(s.act, running), s.at))
      }
      running.timers.push(
        later(() => {
          if (sceneRef.current?.token !== token) return
          sceneRef.current = null
          walkingRef.current = false
          setView(EMPTY_VIEW)
          schedRef.current?.reset(Date.now())
        }, scene.ms),
      )
      schedRef.current?.reset(Date.now())
      return true
    },
    [apply, cancelScene, later],
  )

  /** 開始拖曳 / 進入佈置時：只中斷行為與反應，餵食與大便不受影響 */
  const cancelIdle = useCallback(() => {
    chainRef.current++ // 連續表演（PM 的「表演每一招」）也一併停掉
    const k = sceneRef.current?.scene.kind
    if (k === 'behavior' || k === 'reaction') cancelScene()
  }, [cancelScene])

  // ---------- 行為 ----------
  const buildEnv = useCallback((): PlanEnv => {
    const q = P.current
    const g = q.geo()
    const rng = Math.random
    const petWFrac = g.roomW ? g.petW / g.roomW : 0.1
    const halfW = petWFrac / 2
    const visL = g.roomW ? g.scrollLeft / g.roomW : 0
    const visR = g.roomW ? (g.scrollLeft + g.viewW) / g.roomW : 1
    const minX = Math.max(halfW + 0.01, visL + halfW * 1.1)
    const maxX = Math.min(1 - halfW - 0.01, visR - halfW * 1.1)
    const from = petXRef.current
    const timed = (w: ReturnType<typeof pickWalk>): TimedWalk | null => (w ? { ...w, ms: walkDurationMs(w.toX - from, petWFrac) } : null)
    const obstacles = g.obstacles
    const walk = timed(pickWalk({ fromX: from, rng, minX, maxX, halfW, obstacles }))
    const centerWalk = timed(walkTo(from, (visL + visR) / 2, halfW, obstacles, minX, maxX))
    let ballWalk: TimedWalk | null = null
    if (g.ball) {
      const side = from < g.ball.x ? -1 : 1
      const target = g.ball.x + side * (halfW * 1.05 + g.ball.halfW)
      ballWalk = timed(walkTo(from, target, halfW, obstacles.filter((o) => o.id !== 'decor-ball'), minX, maxX))
    }
    // 整理房間：左 → 右 → 回中間，每一段都從上一段的終點出發
    const tidyPath: TimedWalk[] = []
    let cur = from
    for (const target of [minX, maxX, (visL + visR) / 2]) {
      const w = walkTo(cur, target, halfW, obstacles, minX, maxX)
      if (!w) continue
      tidyPath.push({ ...w, ms: walkDurationMs(w.toX - cur, petWFrac) })
      cur = w.toX
    }
    return { rng, childName: q.childName, stage: q.stage, walk, centerWalk, ballWalk, wishIcons: q.wishIcons, tidyPath }
  }, [])

  const startBehavior = useCallback(
    (id: BehaviorId): boolean => startScene(planBehavior(id, buildEnv())),
    [buildEnv, startScene],
  )

  // ---------- 睡覺：移到床上 ----------
  const bedX = bed?.x
  useEffect(() => {
    if (!asleep) return
    cancelIdle() // 睡著了：正在演的行為（散步、唱歌…）直接結束
    if (bedX === undefined) return
    movePet(bedX, 900)
    walkingRef.current = false
  }, [asleep, bedX, cancelIdle, movePet])

  // ---------- 睡醒 ----------
  const wakeUp = useCallback(() => {
    setForceSleep(false)
    setAwake(true)
    clearLater(awakeTimer.current)
    awakeTimer.current = later(() => setAwake(false), AWAKE_MS)
  }, [clearLater, later])

  // PM 切換日夜時，恢復成跟著時間走
  useEffect(() => {
    setForceSleep(false)
    setAwake(false)
  }, [p.todMode])

  // ---------- 排程 ----------
  useEffect(() => {
    const fast = getFastSchedule()
    const s = new BehaviorScheduler({ rng: Math.random, ...(fast ? { minMs: 2000, maxMs: 4000 } : {}) }, Date.now())
    schedRef.current = s
    let id: number | undefined
    const tick = () => {
      const q = P.current
      // 到期的便便（含離線期間到期的）變成真的
      const due = q.pet.poopDue
      if (due?.length && !takingDue.current && Math.min(...due) <= clockNow()) {
        takingDue.current = true
        void repo.takeDuePoops(petXRef.current, undefined, poopSpread()).finally(() => {
          takingDue.current = false
        })
      }
      const gate: Gate = {
        edit: q.edit,
        dragging: q.dragging,
        busy: sceneRef.current !== null,
        hidden: document.hidden,
        asleep: asleepRef.current,
        // 全螢幕慶祝、新招慶祝、禮物展示中都暫停自主行為
        overlay: !!document.querySelector('.celebrate, .trick-celebrate, .gift-live'),
      }
      const g = q.geo()
      const ctx: PickContext = { stage: q.stage, hunger: q.hunger, poopCount: q.pet.poops?.length ?? 0, tod: getTimeOfDay(q.now, q.todMode), hasBall: !!g.ball, tricks: q.pet.tricks }
      const next = s.tick(Date.now(), gate, ctx)
      if (next) startBehavior(next)
    }
    const stop = () => {
      if (id !== undefined) window.clearInterval(id)
      id = undefined
    }
    const start = () => {
      stop()
      s.reset(Date.now())
      id = window.setInterval(tick, 1000)
    }
    const onVis = () => {
      if (document.hidden) {
        stop()
        const k = sceneRef.current?.scene.kind
        if (k === 'behavior') cancelScene()
      } else start()
    }
    document.addEventListener('visibilitychange', onVis)
    if (!document.hidden) start()
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      stop()
      schedRef.current = null
    }
  }, [cancelScene, startBehavior, poopSpread])

  // ---------- 便便：偵測新長出來的 ----------
  const poops: Poop[] = p.pet.poops ?? []
  const knownPoops = useRef<Set<string> | null>(null)
  useLayoutEffect(() => {
    const ids = poops.map((x) => x.id)
    const prev = knownPoops.current
    knownPoops.current = new Set(ids)
    if (prev === null) return
    const fresh = poops.filter((x) => !prev.has(x.id) && clockNow() - x.at < FRESH_POOP_MS)
    if (fresh.length === 0) return
    const ids2 = fresh.map((x) => x.id)
    setFreshIds((f) => [...f, ...ids2])
    later(() => setFreshIds((f) => f.filter((id) => !ids2.includes(id))), 4000)
    const q = P.current
    if (!asleepRef.current && !q.edit && q.stage !== 'egg' && !document.hidden) startScene(planPoop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poops.map((x) => x.id).join()])

  // ---------- 對外操作 ----------
  const startEat = useCallback(
    (food: FoodMeta, from: { x: number; y: number } | null, stage: Stage) => {
      cancelScene()
      let dx = 0
      let dy = 0
      const el = P.current.slotRef.current
      if (from && el) {
        const r = el.getBoundingClientRect()
        dx = from.x - (r.left + r.width / 2)
        dy = from.y - (r.top + r.height * 0.52)
      }
      foodRef.current = { ...food, dx, dy }
      startScene(planEat({ stage, burp: stage !== 'egg' && Math.random() < 0.25, celebrate: food.celebrate, favorite: food.favorite }))
    },
    [cancelScene, startScene],
  )

  /** 點寵物。回傳要不要讓外層做「戳一下」的彈跳（睡著時不彈） */
  const tap = useCallback((): void => {
    if (asleepRef.current) {
      wakeUp()
      startScene(planReaction('wake'))
      return
    }
    const r = registerTap(tapRef.current, Date.now())
    tapRef.current = r.state
    if (r.reaction === 'dizzy') startScene(planReaction('dizzy'))
    else if (r.reaction === 'tickle') startScene(planReaction('tickle'))
    else {
      const k = sceneRef.current?.scene.kind
      if (k === 'eat' || k === 'poop' || k === 'reaction') return
      cancelIdle()
      playPetSound('giggle', P.current.soundOn)
      showBubble({ text: '嘻嘻' }, 900, null)
      sayRecorded('pet.', '嘻嘻', { enabled: P.current.voiceOn !== false })
      schedRef.current?.reset(Date.now())
    }
  }, [cancelIdle, showBubble, startScene, wakeUp])

  const pat = useCallback((): void => {
    if (asleepRef.current) return
    startScene(planReaction('pat'))
  }, [startScene])

  /** 吃飽了還被餵：搖頭「我吃飽了～」（睡著時不演；吃東西中也不打斷，優先權比吃東西低） */
  const refuse = useCallback((): void => {
    if (asleepRef.current) return
    startScene(planReaction('full'))
  }, [startScene])

  const thanks = useCallback((): void => {
    if (asleepRef.current) return
    startScene(planReaction('thanks'))
  }, [startScene])

  /** v5：表演新招。id = 'random' 時從已學會的挑一招（盡量不連續同一招）。回傳有沒有開始 */
  const performTrick = useCallback(
    (id: TrickId | 'random'): boolean => {
      const q = P.current
      if (q.stage === 'egg') return false
      const t = id === 'random' ? pickTrick(q.pet.tricks ?? [], Math.random, lastTrick.current) : id
      if (!t) return false
      if (asleepRef.current) wakeUp()
      lastTrick.current = t
      return startBehavior(TRICK_BEHAVIOR[t])
    },
    [startBehavior, wakeUp],
  )

  /** 依序表演一串招（每一招演完停 0.5 秒）；PM 的「表演每一招」用 */
  const performChain = useCallback(
    (ids: readonly TrickId[]): void => {
      const token = ++chainRef.current
      const run = (i: number) => {
        if (chainRef.current !== token || i >= ids.length) return
        const scene = planBehavior(TRICK_BEHAVIOR[ids[i]], buildEnv())
        startScene(scene)
        later(() => run(i + 1), scene.ms + 500)
      }
      run(0)
    },
    [buildEnv, later, startScene],
  )

  /** v5：阿悟走到中間、拿出禮物並說話。回傳禮物該在幾 ms 後彈出來；現在不能演（正在吃東西等）回傳 null */
  const startGift = useCallback(
    (text: string): number | null => {
      const { scene, popAt } = planGift(buildEnv(), text)
      return startScene(scene) ? popAt : null
    },
    [buildEnv, startScene],
  )

  /** 孩子收下禮物：阿悟開心跳一下 */
  const reactGifted = useCallback((): void => {
    if (asleepRef.current) return
    startScene(planReaction('gifted'))
  }, [startScene])

  const runCommand = useCallback(
    (cmd: PetCommand): void => {
      const q = P.current
      switch (cmd) {
        case 'poop':
          if (q.stage !== 'egg') void repo.addPoop(pickPoopX(q.pet.poops ?? [], petXRef.current, Math.random, poopSpread()))
          return
        case 'sleep':
          cancelScene()
          setAwake(false)
          setForceSleep(true)
          return
        case 'wake':
          wakeUp()
          startScene(planReaction('wake'))
          return
        case 'trick:all': {
          if (q.stage === 'egg') return
          if (asleepRef.current) wakeUp()
          performChain(TRICK_IDS)
          return
        }
        case 'trick:count':
        case 'trick:tidy':
        case 'trick:rhythm':
        case 'trick:hello':
        case 'trick:flip':
        case 'trick:bow':
        case 'trick:height':
        case 'trick:hide':
        case 'trick:memory': {
          if (q.stage === 'egg') return
          if (asleepRef.current) wakeUp()
          startBehavior(TRICK_BEHAVIOR[cmd.slice(6) as TrickId])
          return
        }
        default: {
          if (asleepRef.current) wakeUp()
          // 蛋只有蛋的行為
          const id: BehaviorId = q.stage === 'egg' ? (cmd === 'sing' || cmd === 'dance' ? 'eggSparkle' : 'eggWobble') : cmd
          startBehavior(id)
        }
      }
    },
    [cancelScene, performChain, poopSpread, startBehavior, startScene, wakeUp],
  )

  /** 球被丟到阿悟附近：追球 */
  const playBall = useCallback((): void => {
    if (P.current.stage === 'egg' || asleepRef.current) return
    startBehavior('ballPlay')
  }, [startBehavior])

  // PM 指令：房間準備好才執行（延遲一下，讓版面量測完成；StrictMode 重掛載時 timer 會被清掉再重排）
  const ready = p.ready
  useEffect(() => {
    if (!ready) return
    const run = () => {
      for (const c of drainPetCommands()) runCommand(c)
    }
    const t = window.setTimeout(run, 350)
    window.addEventListener(CMD_EVENT, run)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener(CMD_EVENT, run)
    }
  }, [ready, runCommand])

  return {
    view,
    petX,
    petXRef,
    walkMs,
    asleep,
    onBed,
    tod,
    freshIds,
    startEat,
    tap,
    pat,
    refuse,
    thanks,
    playBall,
    cancelIdle,
    runCommand,
    performTrick,
    startGift,
    reactGifted,
    later,
  }
}
