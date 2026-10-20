import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RoomBackdrop } from './RoomBackdrop'
import { repo } from '../../db/repo'
import { artName, FOOD_EMOJI, isFlatDecor, PET_ASPECT, PET_HEIGHT_FRAC, spriteSize } from '../../art/items'
import { HUNGER_MAX } from '../../domain/constants'
import { currentHunger, feedsToNextStage, moodAt } from '../../domain/pet'
import {
  autoScrollSpeed,
  clampPlacement,
  DRAG_START_PX,
  FLOOR_TOP,
  inRect,
  PET_BOTTOM,
  PET_X,
  renderOrder,
  ROOM_WIDTH_FACTOR,
  spritePx,
  type Rect,
} from '../../domain/room'
import type { Pet, Placement, ShopItem } from '../../domain/types'
import { Art } from './Art'
import { Icon } from './Icon'
import { PetSprite } from './PetSprite'
import { useCelebrate, useToast } from '../hooks'
import { useLearningSettings } from '../learningHooks'
import { playPetSound } from '../../pet/sounds'
import { PetFx } from '../pet/PetFx'
import { PoopBurst, PoopSpot } from '../pet/PoopSpot'
import { foodMeta } from '../pet/foodFx'
import { useReducedMotion, useTodMode } from '../pet/hooks'
import { usePetLife, type Geometry } from '../pet/usePetLife'
import '../pet/pet.css'

interface Props {
  pet: Pet
  now: number
  /** 飼料（含數量） */
  foods: { item: ShopItem; qty: number }[]
  /** 已擁有的裝飾 */
  ownedDecor: ShopItem[]
  placements: Placement[]
  feedHintShown: boolean
  initialEdit: boolean
  goShop: () => void
  /** 小孩的名字（阿悟揮手時會叫） */
  childName?: string
  /** 今天阿悟最喜歡的食物 id（SPEC B2）；吃到時愛心加倍、說「最喜歡了！」。沒有就不演 */
  favoriteFoodId?: string | null
}

type DragKind = 'food' | 'new' | 'move'
interface Press {
  target: HTMLElement
  pointerId: number
  kind: DragKind
  itemId: string
  sx: number
  sy: number
  started: boolean
  /** 抓取點相對於物件中心的偏移（移動已擺放的裝飾時用） */
  grabDX: number
  grabDY: number
  lift: number
}
interface DragView {
  kind: DragKind
  itemId: string
  x: number
  y: number
  lift: number
  grabDX: number
  grabDY: number
}

const MOOD_TEXT = { happy: '好開心！', normal: '還不錯～', low: '好餓，無精打采…' } as const
const TOOLBAR_H = 64
const unplacedKey = (decor: ShopItem[], placements: Placement[]) => {
  const placed = new Set(placements.map((p) => p.itemId))
  return decor.filter((d) => !placed.has(d.id)).map((d) => d.id).join()
}
const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
/** 由 id 算一個固定的小數，讓每坨便便的位置、蒼蠅有點不同 */
const hashOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

export function RoomView({ pet, now, foods, ownedDecor, placements, feedHintShown, initialEdit, goShop, childName = '', favoriteFoodId = null }: Props) {
  const toast = useToast()
  const celebrate = useCelebrate()
  const { soundOn } = useLearningSettings()
  const todMode = useTodMode()
  const reducedMotion = useReducedMotion()

  const scrollerRef = useRef<HTMLDivElement>(null)
  const roomRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const petRef = useRef<HTMLButtonElement>(null)

  const [edit, setEdit] = useState(initialEdit)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState({ w: 0, h: 0 })
  const [scrollLeft, setScrollLeft] = useState(0)
  const [drag, setDrag] = useState<DragView | null>(null)
  const [, setTick] = useState(0)
  const [dockFade, setDockFade] = useState({ left: false, right: false })
  const [fly, setFly] = useState<{ itemId: string; kind: DragKind; fx: number; fy: number; tx: number; ty: number; go: boolean } | null>(null)
  const [poke, setPoke] = useState(0)
  const [popping, setPopping] = useState<string[]>([])
  const [bursts, setBursts] = useState<{ id: string; x: number }[]>([])
  const [hearts, setHearts] = useState<number[]>([])
  const [hintGone, setHintGone] = useState(false)
  const slotRef = useRef<HTMLDivElement>(null)
  const pressTimer = useRef<number | undefined>(undefined)
  const pressCleanup = useRef<(() => void) | null>(null)
  const longFired = useRef(false)
  const ballPending = useRef(false)
  const press = useRef<Press | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const bgDrag = useRef<{ id: number; sx: number; sl: number; moved: boolean } | null>(null)

  const roomW = view.w * ROOM_WIDTH_FACTOR
  const roomH = view.h

  // 卸載時清掉長按計時器與全域監聽
  useEffect(
    () => () => {
      window.clearTimeout(pressTimer.current)
      pressCleanup.current?.()
    },
    [],
  )

  // 量測可視區大小
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 首次載入捲到寵物可見
  const didInitScroll = useRef(false)
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || !view.w || didInitScroll.current) return
    didInitScroll.current = true
    el.scrollLeft = Math.max(0, PET_X * roomW - view.w / 2)
    setScrollLeft(el.scrollLeft)
  }, [view.w, roomW])

  const measureDock = useCallback(() => {
    const el = dockRef.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setDockFade((f) => (f.left === left && f.right === right ? f : { left, right }))
  }, [])
  const dockContentKey = edit ? unplacedKey(ownedDecor, placements) : foods.map((f) => `${f.item.id}${f.qty > 0 ? 1 : 0}`).join()
  useLayoutEffect(() => {
    measureDock()
    const el = dockRef.current
    if (!el) return
    const ro = new ResizeObserver(measureDock)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measureDock, dockContentKey, edit])

  const hunger = currentHunger(pet, now)
  const mood = moodAt(pet, now)
  const next = feedsToNextStage(pet)
  const itemById = useMemo(() => new Map(ownedDecor.map((d) => [d.id, d])), [ownedDecor])
  const placedIds = new Set(placements.map((p) => p.itemId))
  const unplaced = ownedDecor.filter((d) => !placedIds.has(d.id))

  // ---------- 餵食 ----------
  const dismissHint = useCallback(() => {
    if (!feedHintShown && !hintGone) {
      setHintGone(true)
      void repo.markFeedHintShown()
    }
  }, [feedHintShown, hintGone])

  const feed = async (foodId: string, from?: { x: number; y: number }) => {
    dismissHint()
    const stage = pet.stage
    const r = await repo.feedPet(foodId)
    if (!r.ok) return toast(r.error, 'warn')
    // 食物從放開的地方（或飼料欄）飛到嘴邊，接著咀嚼、吞下去（動畫腳本在 src/pet/plan.ts）
    const item = foods.find((f) => f.item.id === foodId)?.item
    if (item) {
      let origin = from ?? null
      if (!origin) {
        const el = document.querySelector(`[data-dock-item="${foodId}"]`)?.getBoundingClientRect()
        if (el) origin = { x: el.left + el.width / 2, y: el.top + el.height / 2 }
      }
      life.startEat(foodMeta(item, item.id === favoriteFoodId), origin, stage)
    }
    if (r.evolvedTo === 'baby' || r.evolvedTo === 'adult') {
      celebrate({ petName: r.pet.name, from: r.evolvedTo === 'baby' ? 'egg' : 'baby', to: r.evolvedTo, feedCount: r.pet.feedCount })
    } else toast('好好吃！', 'ok')
  }

  const addHeart = () => {
    const id = Date.now()
    setHearts((h) => [...h.slice(-3), id])
    life.later(() => setHearts((h) => h.filter((x) => x !== id)), 900)
  }
  const touchPet = () => {
    life.tap()
    if (life.asleep) return // 睡著的阿悟被點醒：只演「好睏喔…」，不彈跳
    setPoke((p) => p + 1)
    addHeart()
  }
  // 長按 1 秒：摸摸頭
  const onPetDown = (e: React.PointerEvent<HTMLElement>) => {
    if (edit) return
    longFired.current = false
    const sx = e.clientX
    const sy = e.clientY
    window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => {
      longFired.current = true
      life.pat()
      addHeart()
    }, 1000)
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 12) cancel()
    }
    const cancel = () => {
      window.clearTimeout(pressTimer.current)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cancel)
      window.removeEventListener('pointercancel', cancel)
      pressCleanup.current = null
    }
    pressCleanup.current?.()
    pressCleanup.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cancel)
    window.addEventListener('pointercancel', cancel)
  }
  const onPetClick = () => {
    if (longFired.current) {
      longFired.current = false
      return
    }
    touchPet()
  }

  // ---------- 幾何 ----------
  const sizeOf = (it: ShopItem) => {
    const s = spriteSize(it.asset)
    return spritePx(s.cols, s.rows, roomH)
  }
  // 高度依房間高度，並限制寬度不超過可視寬的 42%（手機直向時不會塞滿房間）
  const petH = Math.min(PET_HEIGHT_FRAC[pet.stage] * roomH, (view.w * 0.42) / PET_ASPECT[pet.stage])
  const petW = petH * PET_ASPECT[pet.stage]

  // ---------- 阿悟的生命感：行為、睡覺、便便、日夜 ----------
  const bedPl = placements.find((p) => p.itemId === 'decor-bed')
  const bedItem = bedPl ? itemById.get('decor-bed') : undefined
  const bed = bedPl && bedItem && roomH > 0 ? { x: bedPl.x, y: bedPl.y, h: sizeOf(bedItem).h / roomH } : null
  const geo = (): Geometry => {
    const obstacles: Geometry['obstacles'] = []
    let ball: Geometry['ball'] = null
    if (roomW > 0 && roomH > 0) {
      for (const pl of placements) {
        const it = itemById.get(pl.itemId)
        if (!it || it.slot !== 'floor' || isFlatDecor(pl.itemId)) continue
        const sz = sizeOf(it)
        const w = sz.w / roomW
        // 離地板前緣太遠（靠牆）的家具不擋阿悟的路
        if (pl.y + sz.h / roomH / 2 < PET_BOTTOM - 0.1) continue
        obstacles.push({ id: pl.itemId, left: pl.x - w / 2, right: pl.x + w / 2 })
        const sl = scrollerRef.current?.scrollLeft ?? 0
        if (pl.itemId === 'decor-ball' && pl.x * roomW > sl && pl.x * roomW < sl + view.w) ball = { x: pl.x, halfW: w / 2 }
      }
    }
    return { roomW, roomH, viewW: view.w, scrollLeft: scrollerRef.current?.scrollLeft ?? 0, petW, obstacles, ball }
  }
  const life = usePetLife({
    pet,
    stage: pet.stage,
    hunger,
    childName,
    now,
    todMode,
    edit,
    dragging: !!drag,
    soundOn,
    wishIcons: foods.map((f) => artName(f.item)),
    slotRef,
    geo,
    bed,
    ready: roomW > 0 && roomH > 0,
  })
  const { view: pv } = life
  const dragging = !!drag
  useEffect(() => {
    if (dragging || edit) life.cancelIdle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, edit])
  const petBottom = life.onBed && bed ? Math.min(0.97, bed.y + bed.h * 0.2) : PET_BOTTOM
  const poops = useMemo(() => pet.poops ?? [], [pet.poops])
  // 被清掉的便便不用再記著「正在消失」
  useEffect(() => {
    setPopping((a) => (a.length ? a.filter((id) => poops.some((p) => p.id === id)) : a))
  }, [poops])
  const cleanPoop = (id: string, x: number) => {
    if (popping.includes(id)) return
    setPopping((a) => [...a, id])
    life.later(() => {
      playPetSound('pop', soundOn)
      setBursts((b) => [...b, { id, x }])
    }, 650)
    life.later(() => {
      void repo.clearPoop(id)
      life.thanks()
    }, 700)
    life.later(() => setBursts((b) => b.filter((i) => i.id !== id)), 1400)
  }

  /** 以目前的 DOM 位置算出拖曳目標 */
  const evaluate = (d: DragView, fx: number, fy: number) => {
    const scroller = scrollerRef.current
    const room = roomRef.current
    const dock = dockRef.current
    const pe = petRef.current
    const viewRect = scroller ? toRect(scroller.getBoundingClientRect()) : null
    const overRoom = !!viewRect && inRect(fx, fy, viewRect)
    const overDock = !!dock && inRect(fx, fy, toRect(dock.getBoundingClientRect()), 6)
    const overPet = d.kind === 'food' && !!pe && inRect(fx, fy, toRect(pe.getBoundingClientRect()), 14)
    let preview: { x: number; y: number; w: number; h: number; invalid: boolean } | null = null
    if (d.kind !== 'food' && room && overRoom) {
      const it = itemById.get(d.itemId)
      if (it?.slot) {
        const rr = room.getBoundingClientRect()
        const size = sizeOf(it)
        const cx = fx + d.grabDX - rr.left
        const cy = fy + d.grabDY - d.lift - rr.top
        const c = clampPlacement(it.slot, cx / roomW, cy / roomH, size.w / roomW, size.h / roomH)
        // 影子（手指位置）與吸附後的合法位置差太遠 = 這裡放不下
        const invalid = Math.hypot(c.x * roomW - cx, c.y * roomH - cy) > 10
        preview = { x: c.x, y: c.y, w: size.w, h: size.h, invalid }
      }
    }
    return { overRoom, overDock, overPet, preview }
  }

  // 安全網：任何情況下指標放開/視窗失焦，都不能讓 press 殘留
  useEffect(() => {
    const clear = () => {
      const p = press.current
      if (p) void finishPress(p, pointer.current.x, pointer.current.y, true)
    }
    window.addEventListener('pointercancel', clear)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('pointercancel', clear)
      window.removeEventListener('blur', clear)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 拖曳中：靠近左右緣自動捲動
  useEffect(() => {
    if (!drag) return
    let raf = 0
    const loop = () => {
      const scroller = scrollerRef.current
      if (scroller) {
        const r = scroller.getBoundingClientRect()
        const { x, y } = pointer.current
        const vertical = y >= r.top - 30 && y <= r.bottom + 30
        const speed = vertical ? autoScrollSpeed(x, r.left, r.width) : 0
        if (speed !== 0) {
          const before = scroller.scrollLeft
          scroller.scrollLeft += speed
          if (scroller.scrollLeft !== before) setTick((t) => t + 1)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [drag])

  /** 開始拖飼料時，若寵物不在可視範圍就平滑捲動讓牠進入視野 */
  const revealPet = () => {
    const sc = scrollerRef.current
    if (!sc || !roomW) return
    const petCenter = life.petXRef.current * roomW
    const margin = petW / 2 + 24
    if (petCenter - margin >= sc.scrollLeft && petCenter + margin <= sc.scrollLeft + view.w) return
    sc.scrollTo({ left: Math.max(0, petCenter - view.w / 2), behavior: 'smooth' })
  }

  const flyBack = (itemId: string, kind: DragKind, fx: number, fy: number) => {
    const target = document.querySelector(`[data-dock-item="${itemId}"]`)
    if (!target) return
    const r = target.getBoundingClientRect()
    setFly({ itemId, kind, fx, fy, tx: r.left + r.width / 2, ty: r.top + r.height / 2, go: false })
    requestAnimationFrame(() => requestAnimationFrame(() => setFly((f) => (f ? { ...f, go: true } : f))))
    window.setTimeout(() => setFly(null), 380)
  }

  const defaultSpot = (it: ShopItem) => {
    // 點一下（沒拖）時：放在目前可視範圍的中間
    const size = sizeOf(it)
    const scroller = scrollerRef.current
    const cxPx = (scroller?.scrollLeft ?? 0) + view.w / 2
    const y = it.slot === 'wall' ? 0.3 : 0.86
    return clampPlacement(it.slot ?? 'floor', cxPx / roomW, y, size.w / roomW, size.h / roomH)
  }

  /** 把玩具球放到阿悟附近：離開佈置模式後，阿悟會跑去追球 */
  const noteBall = (itemId: string, x: number) => {
    if (itemId === 'decor-ball' && Math.abs(x - life.petXRef.current) < 0.2) ballPending.current = true
  }

  const finishPress = async (p: Press, fx: number, fy: number, cancelled: boolean) => {
    press.current = null
    setDrag(null)
    try {
      p.target.releasePointerCapture(p.pointerId)
    } catch {
      /* 已釋放 */
    }
    if (cancelled) return
    const it = ownedDecor.find((d) => d.id === p.itemId)
    if (!p.started) {
      // 點一下
      if (p.kind === 'food') void feed(p.itemId)
      else if (p.kind === 'new' && it) {
        const c = defaultSpot(it)
        const r = await repo.placeDecor(it.id, c.x, c.y)
        if (r.ok) setSelected(it.id)
        else toast(r.error, 'warn')
      } else if (p.kind === 'move') setSelected((s) => (s === p.itemId ? null : p.itemId))
      return
    }
    const d: DragView = { kind: p.kind, itemId: p.itemId, x: fx, y: fy, lift: p.lift, grabDX: p.grabDX, grabDY: p.grabDY }
    const ev = evaluate(d, fx, fy)
    if (p.kind === 'food') {
      if (ev.overPet) void feed(p.itemId, { x: fx, y: fy })
      else flyBack(p.itemId, 'food', fx, fy)
    } else if (p.kind === 'new') {
      if (ev.preview) {
        const r = await repo.placeDecor(p.itemId, ev.preview.x, ev.preview.y)
        if (r.ok) {
          setSelected(p.itemId)
          noteBall(p.itemId, ev.preview.x)
        } else toast(r.error, 'warn')
      } else flyBack(p.itemId, 'new', fx, fy)
    } else {
      if (ev.overDock) {
        await repo.removeDecor(p.itemId)
        setSelected(null)
      } else if (ev.preview) {
        await repo.moveDecor(p.itemId, ev.preview.x, ev.preview.y)
        noteBall(p.itemId, ev.preview.x)
      }
    }
  }

  /** 綁在可拖曳元素上的 pointer 事件 */
  const bind = (kind: DragKind, itemId: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      // 多指觸控時忽略第二根手指；其他情況一律覆寫，避免殘留的 press 卡住之後所有拖曳
      if (press.current && e.pointerType === 'touch' && press.current.pointerId !== e.pointerId) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      let grabDX = 0
      let grabDY = 0
      if (kind === 'move') {
        const r = e.currentTarget.getBoundingClientRect()
        grabDX = r.left + r.width / 2 - e.clientX
        grabDY = r.top + r.height / 2 - e.clientY
      }
      pointer.current = { x: e.clientX, y: e.clientY }
      press.current = {
        target: e.currentTarget,
        pointerId: e.pointerId,
        kind,
        itemId,
        sx: e.clientX,
        sy: e.clientY,
        started: false,
        grabDX,
        grabDY,
        lift: e.pointerType === 'mouse' ? 0 : 36,
      }
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const p = press.current
      if (!p || p.pointerId !== e.pointerId) return
      pointer.current = { x: e.clientX, y: e.clientY }
      if (!p.started) {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < DRAG_START_PX) return
        p.started = true
        if (p.kind === 'food') revealPet()
        if (p.kind === 'move') setSelected(null)
      }
      setDrag({ kind: p.kind, itemId: p.itemId, x: e.clientX, y: e.clientY, lift: p.lift, grabDX: p.grabDX, grabDY: p.grabDY })
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const p = press.current
      if (!p || p.pointerId !== e.pointerId) return
      void finishPress(p, e.clientX, e.clientY, false)
    },
    onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => {
      const p = press.current
      if (!p || p.pointerId !== e.pointerId) return
      void finishPress(p, e.clientX, e.clientY, true)
    },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
      const p = press.current
      if (!p || p.pointerId !== e.pointerId) return
      void finishPress(p, e.clientX, e.clientY, true)
    },
  })

  // ---------- 房間捲動（滑鼠拖背景 / 箭頭） ----------
  const onScrollerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || press.current) return
    if ((e.target as HTMLElement).closest('[data-nodrag]')) return
    bgDrag.current = { id: e.pointerId, sx: e.clientX, sl: e.currentTarget.scrollLeft, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelected(null)
  }
  const onScrollerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = bgDrag.current
    if (!b || b.id !== e.pointerId) return
    if (Math.abs(e.clientX - b.sx) > 3) b.moved = true
    e.currentTarget.scrollLeft = b.sl - (e.clientX - b.sx)
  }
  const onScrollerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (bgDrag.current?.id === e.pointerId) bgDrag.current = null
  }
  const scrollBy = (dir: -1 | 1) => scrollerRef.current?.scrollBy({ left: dir * view.w * 0.6, behavior: 'smooth' })
  const canLeft = scrollLeft > 4
  const canRight = roomW > 0 && scrollLeft < roomW - view.w - 4

  // ---------- 渲染用資料 ----------
  const entries = renderOrder([
    ...placements
      .filter((p) => itemById.has(p.itemId))
      .map((p) => {
        const it = itemById.get(p.itemId)!
        const size = sizeOf(it)
        return { id: p.itemId, bottom: isFlatDecor(p.itemId) ? -1 : p.y + size.h / roomH / 2, z: p.z, p, it, size }
      }),
    { id: '__pet', bottom: life.onBed && bed ? bed.y + bed.h / 2 + 0.002 : PET_BOTTOM, z: 0 },
  ])
  const zOf = (id: string) => entries.findIndex((e) => e.id === id) + 1

  const dv = drag ? evaluate(drag, drag.x, drag.y) : null
  const draggingFood = drag?.kind === 'food'
  const hovering = !!(dv && dv.overPet)
  const selPlacement = selected ? placements.find((p) => p.itemId === selected) : undefined
  const selItem = selected ? itemById.get(selected) : undefined
  const showHint = !feedHintShown && !hintGone && !edit && !drag && foods.some((f) => f.qty > 0)
  const hintFood = foods.find((f) => f.qty > 0)?.item

  const ghostItem = drag ? (drag.kind === 'food' ? foods.find((f) => f.item.id === drag.itemId)?.item : itemById.get(drag.itemId)) : undefined
  const ghostSize = ghostItem && drag && drag.kind !== 'food' ? sizeOf(ghostItem) : { w: 56, h: 56 }

  const flyItem = fly ? (foods.find((f) => f.item.id === fly.itemId)?.item ?? itemById.get(fly.itemId)) : undefined

  const toggleEdit = () => {
    if (edit && ballPending.current) {
      ballPending.current = false
      life.later(() => life.playBall(), 700)
    }
    setEdit((v) => !v)
    setSelected(null)
  }

  return (
    <>
      <section className="room-section">
        <div className={`room-frame ${edit ? 'editing' : ''}`}>
          <div className="pet-hud">
            <div className="pet-name">{pet.name}<span className="mood-text"> {pv.food || hovering ? '好好吃～' : MOOD_TEXT[mood]}</span></div>
            <div className="hunger" role="meter" aria-valuemin={0} aria-valuemax={HUNGER_MAX} aria-valuenow={Math.round(hunger)} aria-label="飽足度">
              <span>飽足</span>
              <div className="bar"><i style={{ width: `${hunger}%` }} className={`m-${mood}`} /></div>
            </div>
            {next !== null && <div className="grow-hint">{pet.stage === 'egg' ? `再餵 ${next} 次就會孵化` : `再餵 ${next} 次會長大`}</div>}
          </div>

          {edit && <div className="edit-banner" role="status">佈置中：把裝飾拖進房間，拖回下方可收回</div>}

          <div
            className="room-scroll"
            ref={scrollerRef}
            data-testid="room-scroller"
            onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
            onPointerDown={onScrollerDown}
            onPointerMove={onScrollerMove}
            onPointerUp={onScrollerUp}
            onPointerCancel={onScrollerUp}
          >
            <div className={`room ${edit ? 'edit' : ''}`} ref={roomRef} aria-label="寵物房間" data-testid="room" style={{ width: roomW || undefined }}>
              {/* 背景自成一層（z-index: 0）：窗簾等內部圖層不會蓋到阿悟的對話泡泡與家具 */}
              <div className="pf-backdrop-layer" aria-hidden>
                <RoomBackdrop timeOfDay={life.tod} />
              </div>
              {edit && <div className="floor-line" style={{ top: `${FLOOR_TOP * 100}%` }} aria-hidden><span>牆面</span><span>地板</span></div>}

              {roomH > 0 &&
                entries.map((e) => {
                  if (e.id === '__pet') {
                    return (
                      <div
                        key="pet"
                        ref={slotRef}
                        className="pet-slot"
                        data-testid="pet-slot"
                        style={{
                          left: life.petX * roomW - petW / 2,
                          top: petBottom * roomH - petH,
                          width: petW,
                          height: petH,
                          zIndex: zOf('__pet'),
                          transition: reducedMotion ? 'none' : `left ${life.walkMs}ms linear, top 0.8s ease-in-out`,
                        }}
                      >
                        <div className="pet-shadow" aria-hidden />
                        <button
                          key={poke}
                          ref={petRef}
                          data-nodrag
                          data-testid="pet"
                          data-pose={pv.pose ?? (life.asleep ? 'sleep' : 'idle')}
                          data-anim={pv.anim ?? undefined}
                          data-asleep={life.asleep || undefined}
                          className={`pet-btn ${poke > 0 ? 'poked' : ''} ${hovering ? 'pet-hover' : ''} ${edit ? 'pet-ghosted' : ''} ${pv.anim ? `pf-a-${pv.anim}` : ''} ${life.asleep && !pv.anim ? 'pf-asleep' : ''} ${pv.fx.includes('glow') ? 'pf-glow' : ''}`}
                          onClick={onPetClick}
                          onPointerDown={onPetDown}
                          onContextMenu={(e) => e.preventDefault()}
                          disabled={edit}
                          aria-label={`摸摸${pet.name}`}
                        >
                          <div className={`pf-flip ${pv.flip ? 'on' : ''}`}>
                            <PetSprite
                              pet={pet}
                              mood={mood}
                              eating={hovering}
                              pose={pv.pose ?? (life.asleep ? 'sleep' : undefined)}
                              className={pv.anim || life.asleep ? '' : `idle ${mood === 'low' ? 'idle-slow' : ''}`}
                            />
                          </div>
                        </button>
                        {hearts.map((id) => (
                          <span key={id} className="heart-pop" aria-hidden>💗</span>
                        ))}
                        <PetFx view={pv} asleep={life.asleep} lying={pet.stage !== 'egg'} />
                      </div>
                    )
                  }
                  const ent = e as typeof e & { p: Placement; it: ShopItem; size: { w: number; h: number } }
                  const moving = drag?.kind === 'move' && drag.itemId === ent.id
                  return (
                    <div
                      key={ent.id}
                      data-nodrag
                      data-placed={ent.id}
                      data-slot={ent.it.slot}
                      className={`placed ${edit ? 'editable' : ''} ${selected === ent.id ? 'selected' : ''} ${ent.id === 'decor-ball' && pv.ballBounce ? 'pf-ball-play' : ''}`}
                      style={{
                        left: ent.p.x * roomW - ent.size.w / 2,
                        top: ent.p.y * roomH - ent.size.h / 2,
                        width: ent.size.w,
                        height: ent.size.h,
                        zIndex: zOf(ent.id),
                        opacity: moving ? 0.25 : 1,
                        transform: ent.p.flipped ? 'scaleX(-1)' : undefined,
                      }}
                      role={edit ? 'button' : undefined}
                      aria-label={edit ? `${ent.it.name}，可拖曳移動` : undefined}
                      {...(edit ? bind('move', ent.id) : {})}
                    >
                      <Art name={artName(ent.it)} alt={ent.it.name} className="placed-art" />
                    </div>
                  )
                })}

              {roomH > 0 &&
                poops.map((po) => {
                  const size = Math.max(44, Math.min(96, petH * 0.38))
                  const dy = ((hashOf(po.id) % 5) - 2) * 0.008 * roomH
                  return (
                    <PoopSpot
                      key={po.id}
                      poop={po}
                      left={po.x * roomW - size / 2}
                      top={PET_BOTTOM * roomH - size + dy}
                      size={size}
                      z={entries.length + 2}
                      fresh={life.freshIds.includes(po.id)}
                      from={(life.petX - po.x) * roomW}
                      popping={popping.includes(po.id)}
                      disabled={edit}
                      fly={hashOf(po.id) % 2 === 0}
                      onClean={() => cleanPoop(po.id, po.x)}
                    />
                  )
                })}
              {roomH > 0 &&
                bursts.map((b) => <PoopBurst key={b.id} left={b.x * roomW} top={PET_BOTTOM * roomH - 40} z={entries.length + 3} />)}

              {dv?.preview && (
                <div className={`drop-preview ${dv.preview.invalid ? 'invalid' : ''}`} data-invalid={dv.preview.invalid || undefined} style={{ left: dv.preview.x * roomW - dv.preview.w / 2, top: dv.preview.y * roomH - dv.preview.h / 2, width: dv.preview.w, height: dv.preview.h, zIndex: 999 }} aria-hidden>
                  {dv.preview.invalid && <span className="invalid-label">這裡放不下</span>}
                </div>
              )}

              {edit && selPlacement && selItem && roomH > 0 && (() => {
                const size = sizeOf(selItem)
                const top = selPlacement.y * roomH - size.h / 2
                const bottom = top + size.h
                // 優先放物件上方；上方放不下改放下方；都放不下就貼在可視區頂端（不會蓋住物件的情況下盡量不遮）
                const placeAbove = top >= TOOLBAR_H + 8
                const placeBelow = !placeAbove && roomH - bottom >= TOOLBAR_H + 8
                const toolTop = placeAbove ? top - 8 : placeBelow ? bottom + 8 : 8
                const shift = placeAbove ? '-100%' : '0'
                return (
                  <div
                    className="decor-toolbar"
                    data-nodrag
                    style={{ left: Math.min(scrollLeft + view.w - 135, Math.max(scrollLeft + 135, selPlacement.x * roomW)), top: toolTop, transform: `translate(-50%, ${shift})`, zIndex: 1000 }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button className="btn" onClick={() => repo.flipDecor(selItem.id)} aria-label="左右翻轉">↔ 翻轉</button>
                    <button className="btn" onClick={() => repo.bringToFront(selItem.id)} aria-label="移到最前">⬆ 最前</button>
                    <button className="btn" onClick={async () => { await repo.removeDecor(selItem.id); setSelected(null) }} aria-label="收回">✕ 收回</button>
                  </div>
                )
              })()}
            </div>
          </div>

          {canLeft && <button className="room-arrow left" onClick={() => scrollBy(-1)} aria-label="往左看">‹</button>}
          {canRight && <button className="room-arrow right" onClick={() => scrollBy(1)} aria-label="往右看">›</button>}
        </div>
      </section>

      <section className={`dock-row ${edit ? 'editing' : ''}`}>
        {showHint && hintFood && (
          <button className="feed-hint" onClick={dismissHint} data-testid="feed-hint">
            把{hintFood.name}拖給{pet.name}吃吧 👇
          </button>
        )}
        <div className="dock-wrap">
          {dockFade.left && <span className="dock-fade left" aria-hidden data-testid="dock-fade-left" />}
          {dockFade.right && <span className="dock-fade right" aria-hidden data-testid="dock-fade-right" />}
        <div className="dock" ref={dockRef} onScroll={measureDock} data-testid="dock" aria-label={edit ? '尚未擺放的裝飾' : '飼料'}>
          {!edit &&
            foods.map(({ item, qty }) => {
              if (qty < 1) {
                return (
                  <button key={item.id} className="dock-item empty" data-dock-item={item.id} onClick={goShop} aria-label={`${item.name}沒有了，去商店買`}>
                    <Icon name={artName(item)} emoji={FOOD_EMOJI[item.asset]} alt={item.name} className="dock-icon" />
                    <span className="dock-name">{item.name}</span>
                    <span className="dock-sub">去商店買</span>
                  </button>
                )
              }
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={`dock-item food ${drag?.itemId === item.id && drag.kind === 'food' ? 'lifted' : ''}`}
                  data-dock-item={item.id}
                  aria-label={`餵${item.name}，剩 ${qty} 個，可拖到${pet.name}身上`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      void feed(item.id)
                    }
                  }}
                  {...bind('food', item.id)}
                >
                  <Icon name={artName(item)} emoji={FOOD_EMOJI[item.asset]} alt={item.name} className="dock-icon" />
                  <span className="dock-name">{item.name}</span>
                  <span className="dock-sub">x{qty}</span>
                </div>
              )
            })}
          {edit &&
            unplaced.map((d) => {
              return (
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  className={`dock-item decor-item ${drag?.itemId === d.id && drag.kind === 'new' ? 'lifted' : ''}`}
                  data-dock-item={d.id}
                  aria-label={`${d.name}，拖進房間擺放`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      const c = defaultSpot(d)
                      void repo.placeDecor(d.id, c.x, c.y)
                    }
                  }}
                  {...bind('new', d.id)}
                >
                  <Icon name={artName(d)} alt={d.name} className="dock-icon" />
                  <span className="dock-name">{d.name}</span>
                  <span className="dock-sub">{d.slot === 'wall' ? '牆面' : '地板'}</span>
                </div>
              )
            })}
          {edit && unplaced.length === 0 && (
            <div className="dock-empty">
              {ownedDecor.length === 0 ? '還沒有裝飾' : '裝飾都擺好了'}
              <button className="btn" onClick={goShop}>去商店</button>
            </div>
          )}
        </div>
        </div>
        <button className={`btn edit-toggle ${edit ? 'primary' : ''}`} onClick={toggleEdit} aria-pressed={edit}>
          {edit ? '✓ 完成' : '🪑 佈置'}
        </button>
      </section>

      {drag && ghostItem && (
        <div
          className={`drag-ghost ${draggingFood ? 'food' : 'decor'} ${dv?.preview?.invalid ? 'invalid' : ''}`}
          style={{
            left: drag.x + (draggingFood ? 0 : drag.grabDX),
            top: drag.y - drag.lift + (draggingFood ? 0 : drag.grabDY),
            width: ghostSize.w,
            height: ghostSize.h,
          }}
          aria-hidden
        >
          <Icon name={artName(ghostItem)} emoji={FOOD_EMOJI[ghostItem.asset]} alt="" className="ghost-art" />
        </div>
      )}
      {fly && flyItem && (
        <div className={`drag-ghost fly ${fly.go ? 'go' : ''}`} style={{ left: fly.go ? fly.tx : fly.fx, top: fly.go ? fly.ty : fly.fy, width: 56, height: 56 }} aria-hidden>
          <Icon name={artName(flyItem)} emoji={FOOD_EMOJI[flyItem.asset]} alt="" className="ghost-art" />
        </div>
      )}
    </>
  )
}
