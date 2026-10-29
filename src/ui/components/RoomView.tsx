import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RoomAmbient, RoomBackdrop } from './RoomBackdrop'
import { GalleryFrame } from './GalleryFrame'
import { useRoomTheme } from '../roomTheme'
import { repo } from '../../db/repo'
import { artName, FOOD_EMOJI, isArtworkId, isFlatDecor, PET_ASPECT, PET_HEIGHT_FRAC, spriteSize } from '../../art/items'
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
import type { Gift, Pet, Placement, ShopItem } from '../../domain/types'
import { Art } from './Art'
import { Icon } from './Icon'
import { PetSprite } from './PetSprite'
import { useCelebrate, useToast } from '../hooks'
import { useCelebrateSmall } from '../feedback'
import { playSfx } from '../../learning/sfx'
import { baseIdOf, clampArtScale, GIFT_BAG_DONE_LINE, GIFT_THANKS_LINES, nextTint, tintFilter, unplacedCount, DECOR_TINTS } from '../../domain/home7'
import type { TrickId } from '../../domain/tricks'
import { GiftBag } from '../pet/GiftBag'
import { GiftReveal } from '../pet/GiftReveal'
import { giftReveal, hudLayout, HUNGRY_BACK_LINE, HUNGRY_MOOD_TEXT, type RevealItem } from '../../domain/home74'
import { ProgressEgg } from '../pet/ProgressEgg'
import { sayRecorded, sayText } from '../../learning/speech'
import { TAP_FEED_GAP_MS } from '../../domain/constants'
import { useLearningSettings } from '../learningHooks'
import { playPetSound } from '../../pet/sounds'
import { PetFx } from '../pet/PetFx'
import { PoopBurst, PoopSpot } from '../pet/PoopSpot'
import { foodMeta } from '../pet/foodFx'
import { useReducedMotion, useTodMode } from '../pet/hooks'
import { usePetLife, type Geometry } from '../pet/usePetLife'
import '../pet/pet.css'
import '../home7.css'
import '../j74.css'

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
  /** v7：佈置模式沒有家具時去工坊做 */
  goWorkshop?: () => void
  /** v7：每件家具擁有幾個（沒給 = 1；最多擺 3 個） */
  decorQty?: Record<string, number>
  /** 小孩的名字（阿悟揮手時會叫） */
  childName?: string
  /** 今天阿悟最喜歡的食物 id（SPEC B2）；吃到時愛心加倍、說「最喜歡了！」。沒有就不演 */
  favoriteFoodId?: string | null
  /** v5：待展示的禮物（依序展示；沒給就不展示） */
  gifts?: Gift[]
  /** v5：要阿悟表演新招的請求（seq 變了就表演一次；'random' = 從已學會的挑一招） */
  perform?: { seq: number; trick: TrickId | 'random' }
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

// v7.4 J3：餓的時候不再說「好餓，無精打采…」，改成溫暖的短句；隔天回來的第一句見下面的 greeted
const MOOD_TEXT = { happy: '好開心！', normal: '還不錯～', low: HUNGRY_MOOD_TEXT } as const
/** 這次開啟 App 是否已經打過招呼（模組層級：回到首頁重新掛載也不會再說一次） */
let greetedThisSession = false
const TOOLBAR_H = 64
/** 還沒擺出來的家具（每件家具可能有多個：回傳 [商品, 還剩幾個]） */
const unplacedOf = (decor: ShopItem[], placements: Placement[], qty?: Record<string, number>): [ShopItem, number][] => {
  const keys = placements.map((p) => p.itemId)
  return decor.map((d): [ShopItem, number] => [d, unplacedCount(d.id, qty?.[d.id] ?? 1, keys)]).filter(([, n]) => n > 0)
}
const unplacedKey = (decor: ShopItem[], placements: Placement[], qty?: Record<string, number>) =>
  unplacedOf(decor, placements, qty).map(([d, n]) => `${d.id}:${n}`).join()
const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
/** 由 id 算一個固定的小數，讓每坨便便的位置、蒼蠅有點不同 */
const hashOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

export function RoomView({ pet, now, foods, ownedDecor, placements, feedHintShown, initialEdit, goShop, goWorkshop, decorQty, childName = '', favoriteFoodId = null, gifts, perform }: Props) {
  const toast = useToast()
  const celebrate = useCelebrate()
  const { soundOn, voiceOn } = useLearningSettings()
  const small = useCelebrateSmall()
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
  /** 吃飽了被餵：那個食物圖示抖一下（食物沒有被扣） */
  const [nopeId, setNopeId] = useState<string | null>(null)
  const lastTapFeed = useRef(0)
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
  const dockContentKey = edit ? unplacedKey(ownedDecor, placements, decorQty) : foods.filter((f) => f.qty > 0).map((f) => f.item.id).join()
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
  // v7.4 J3：每次開啟 App 第一次進首頁，阿悟（孵出來了）餓著就說「你回來了！我肚子有點餓餓的」；狀態卡也顯示這一句一小段時間
  const [greeting, setGreeting] = useState(false)
  const greetOn = useRef(false)
  useEffect(() => {
    if (!greetOn.current) {
      if (greetedThisSession) return
      greetedThisSession = true
      if (edit || pet.stage === 'egg' || moodAt(pet, now) !== 'low') return
      greetOn.current = true // StrictMode 會把 effect 跑兩次：第二次只重新計時，不重複說
      setGreeting(true)
      sayText(HUNGRY_BACK_LINE, { enabled: voiceOn })
    }
    const t = window.setTimeout(() => setGreeting(false), 7000)
    return () => window.clearTimeout(t)
    // 只在第一次掛載時打招呼
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // v7.4 J5：狀態卡不壓窗簾：放得下就用卡片（寬度不超過窗簾左緣），手機放不下就縮成徽章（進度環 + 飽足條）
  const hudL = hudLayout(view.w, view.h)
  const itemById = useMemo(() => new Map(ownedDecor.map((d) => [d.id, d])), [ownedDecor])
  const roomTheme = useRoomTheme()
  const glows = placements.filter((p) => baseIdOf(p.itemId) === 'decor-lamp' || baseIdOf(p.itemId) === 'decor-cloudlamp').map((p) => ({ x: p.x, y: p.y }))
  const unplaced = unplacedOf(ownedDecor, placements, decorQty)

  // ---------- 餵食 ----------
  const dismissHint = useCallback(() => {
    if (!feedHintShown && !hintGone) {
      setHintGone(true)
      void repo.markFeedHintShown()
    }
  }, [feedHintShown, hintGone])

  const feed = async (foodId: string, from?: { x: number; y: number }, via: 'tap' | 'drag' = 'drag') => {
    // 輕點餵食：800ms 內只算一次（4–7 歲的孩子習慣狂點）；拖曳是刻意的動作，不受限制
    if (via === 'tap') {
      const t = Date.now()
      if (t - lastTapFeed.current < TAP_FEED_GAP_MS) return
      lastTapFeed.current = t
    }
    dismissHint()
    const stage = pet.stage
    const r = await repo.feedPet(foodId)
    if (!r.ok) {
      if (r.reason === 'capped') {
        // 今天的成長到上限了：食物沒有被扣；阿悟搖頭說「肚子撐撐的，明天再吃好不好？」，食物彈回（拖的飛回去、點的抖一下）
        life.refuseCapped()
        setNopeId(foodId)
        life.later(() => setNopeId((v) => (v === foodId ? null : v)), 700)
        if (from) flyBack(foodId, 'food', from.x, from.y)
        return
      }
      return toast(r.error, 'warn')
    }
    // 食物從放開的地方（或飼料欄）飛到嘴邊，接著咀嚼、吞下去（動畫腳本在 src/pet/plan.ts）
    const item = foods.find((f) => f.item.id === foodId)?.item
    if (item) {
      let origin = from ?? null
      if (!origin) {
        const el = document.querySelector(`[data-dock-item="${foodId}"]`)?.getBoundingClientRect()
        if (el) origin = { x: el.left + el.width / 2, y: el.top + el.height / 2 }
      }
      life.startEat({ ...foodMeta(item, item.id === favoriteFoodId), full: r.full }, origin, stage)
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
  /** scale：掛畫在手機上自動縮小的倍率（只有畫廊作品用） */
  const sizeOf = (it: ShopItem, scale?: number) => {
    const s = spriteSize(it.asset)
    const k = isArtworkId(it.id) ? clampArtScale(scale) : 1
    return spritePx(s.cols * k, s.rows * k, roomH)
  }
  // 高度依房間高度，並限制寬度不超過可視寬的 42%（手機直向時不會塞滿房間）
  const petH = Math.min(PET_HEIGHT_FRAC[pet.stage] * roomH, (view.w * 0.42) / PET_ASPECT[pet.stage])
  const petW = petH * PET_ASPECT[pet.stage]

  // ---------- 阿悟的生命感：行為、睡覺、便便、日夜 ----------
  const bedPl = placements.find((p) => baseIdOf(p.itemId) === 'decor-bed')
  const bedItem = bedPl ? itemById.get('decor-bed') : undefined
  const bed = bedPl && bedItem && roomH > 0 ? { x: bedPl.x, y: bedPl.y, h: sizeOf(bedItem).h / roomH } : null
  const geo = (): Geometry => {
    const obstacles: Geometry['obstacles'] = []
    let ball: Geometry['ball'] = null
    if (roomW > 0 && roomH > 0) {
      for (const pl of placements) {
        const it = itemById.get(baseIdOf(pl.itemId))
        if (!it || it.slot !== 'floor' || isFlatDecor(it.id)) continue
        const sz = sizeOf(it)
        const w = sz.w / roomW
        // 離地板前緣太遠（靠牆）的家具不擋阿悟的路
        if (pl.y + sz.h / roomH / 2 < PET_BOTTOM - 0.1) continue
        obstacles.push({ id: pl.itemId, left: pl.x - w / 2, right: pl.x + w / 2 })
        const sl = scrollerRef.current?.scrollLeft ?? 0
        if (it.id === 'decor-ball' && pl.x * roomW > sl && pl.x * roomW < sl + view.w) ball = { x: pl.x, halfW: w / 2 }
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
    voiceOn,
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
  // ---------- v7：禮物袋（點一次全部收下；孩子正在餵食或拖曳時不晃動）----------
  const giftList = gifts ?? []
  const [bagBusy, setBagBusy] = useState(false)
  const [reveal, setReveal] = useState<{ items: RevealItem[]; from: DOMRect; id: number } | null>(null)
  const takeAllGifts = async (el: HTMLElement) => {
    if (bagBusy || edit) return
    setBagBusy(true)
    const rect = el.getBoundingClientRect()
    const list = await repo.collectAllGifts()
    if (list.length === 0) {
      setBagBusy(false)
      return
    }
    // 星星炸開 + 一聲「收到」
    small('task', { at: el, phrase: '' })
    playSfx('reward', soundOn)
    // v7.4 J4：內容一項一項從袋子飛出來、數字跳動（星星 +20、香蕉 +1），攤完再各自飛向它該去的地方（GiftReveal）
    const items = giftReveal(list)
    if (items.length > 0) setReveal({ items, from: rect, id: Date.now() })
    // 阿悟收到禮物：開心跳一下、說一句（阿悟聲；沒有預錄音檔就退回介面旁白）
    life.reactGifted()
    const thanks = GIFT_THANKS_LINES[list.length % GIFT_THANKS_LINES.length]
    if (!sayRecorded('pet.', thanks, { enabled: voiceOn })) sayText(GIFT_BAG_DONE_LINE, { enabled: voiceOn })
    setBagBusy(false)
  }
  // 佈置模式沒有可擺的家具：唸「去工坊做家具吧」
  useEffect(() => {
    if (!edit) return
    if (unplacedOf(ownedDecor, placements, decorQty).length > 0) return
    sayText(ownedDecor.length === 0 ? '去工坊做家具吧' : '家具都擺好了，去工坊再做一些吧', { enabled: voiceOn })
    // 只在進入佈置模式時唸一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit])

  // v5：表演新招（首頁「表演」按鈕、新招慶祝時的示範）
  const performSeq = perform?.seq ?? 0
  useEffect(() => {
    if (!perform || performSeq === 0 || edit || roomW <= 0) return
    life.performTrick(perform.trick)
    // 只在請求編號變動時表演一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performSeq])

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
      const rr = roomRef.current?.getBoundingClientRect()
      if (rr) small('poop', { at: { x: rr.left + x * roomW, y: rr.top + PET_BOTTOM * roomH - 50 } })
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
      const it = itemById.get(baseIdOf(d.itemId))
      if (it?.slot) {
        const rr = room.getBoundingClientRect()
        const size = sizeOf(it, placements.find((p) => p.itemId === d.itemId)?.scale)
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
    if (baseIdOf(itemId) === 'decor-ball' && Math.abs(x - life.petXRef.current) < 0.2) ballPending.current = true
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
    const it = ownedDecor.find((d) => d.id === baseIdOf(p.itemId))
    if (!p.started) {
      // 點一下
      if (p.kind === 'food') void feed(p.itemId, undefined, 'tap')
      else if (p.kind === 'new' && it) {
        const c = defaultSpot(it)
        const r = await repo.placeNewDecor(it.id, c.x, c.y)
        if (r.ok) {
          setSelected(r.key)
          small('place', { at: p.target })
        } else toast(r.error, 'warn')
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
        const r = await repo.placeNewDecor(p.itemId, ev.preview.x, ev.preview.y)
        if (r.ok) {
          setSelected(r.key)
          noteBall(p.itemId, ev.preview.x)
          small('place', { at: { x: fx, y: fy } })
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
  /** 食物欄只能從空白處或這兩顆箭頭捲動（從食物上開始的手勢一律是拖曳） */
  const scrollDock = (dir: -1 | 1) => dockRef.current?.scrollBy({ left: dir * Math.max(160, dockRef.current.clientWidth * 0.7), behavior: 'smooth' })
  const canLeft = scrollLeft > 4
  const canRight = roomW > 0 && scrollLeft < roomW - view.w - 4

  // ---------- 渲染用資料 ----------
  const entries = renderOrder([
    ...placements
      .filter((p) => itemById.has(baseIdOf(p.itemId)))
      .map((p) => {
        const it = itemById.get(baseIdOf(p.itemId))!
        const size = sizeOf(it, p.scale)
        return { id: p.itemId, bottom: isFlatDecor(it.id) ? -1 : p.y + size.h / roomH / 2, z: p.z, p, it, size }
      }),
    { id: '__pet', bottom: life.onBed && bed ? bed.y + bed.h / 2 + 0.002 : PET_BOTTOM, z: 0 },
  ])
  const zOf = (id: string) => entries.findIndex((e) => e.id === id) + 1

  const dv = drag ? evaluate(drag, drag.x, drag.y) : null
  const draggingFood = drag?.kind === 'food'
  const hovering = !!(dv && dv.overPet)
  const selPlacement = selected ? placements.find((p) => p.itemId === selected) : undefined
  const selItem = selected ? itemById.get(baseIdOf(selected)) : undefined
  const showHint = !feedHintShown && !hintGone && !edit && !drag && foods.some((f) => f.qty > 0)
  // O5：提示條用「剛收到的食物」（禮物袋裡最新的食物，背包裡確實有），沒有再用背包裡第一個有的
  const gotFoodId = [...giftList].reverse().find((g) => g.foodId && (foods.find((f) => f.item.id === g.foodId)?.qty ?? 0) > 0)?.foodId
  const hintFood = (gotFoodId ? foods.find((f) => f.item.id === gotFoodId)?.item : undefined) ?? foods.find((f) => f.qty > 0)?.item

  const ghostItem = drag ? (drag.kind === 'food' ? foods.find((f) => f.item.id === drag.itemId)?.item : itemById.get(baseIdOf(drag.itemId))) : undefined
  const ghostSize = ghostItem && drag && drag.kind !== 'food' ? sizeOf(ghostItem, placements.find((p) => p.itemId === drag.itemId)?.scale) : { w: 56, h: 56 }

  const flyItem = fly ? (foods.find((f) => f.item.id === fly.itemId)?.item ?? itemById.get(baseIdOf(fly.itemId))) : undefined

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
          <div
            className={`pet-hud ${hudL.mode === 'badge' ? 'j74-hud-badge' : ''} ${hudL.mode === 'card' && hudL.maxW !== undefined && hudL.maxW < 220 ? 'j74-hud-tight' : ''} ${greeting && mood === 'low' ? 'j74-greeting' : ''}`}
            data-hud={hudL.mode}
            style={hudL.mode === 'card' && hudL.maxW ? { maxWidth: `min(280px, 60%, ${hudL.maxW}px)` } : undefined}
          >
            <div className="pet-name">{pet.name}<span className="mood-text"> {pv.food || hovering ? '好好吃～' : greeting && mood === 'low' ? HUNGRY_BACK_LINE : MOOD_TEXT[mood]}</span></div>
            <div className="hunger" role="meter" aria-valuemin={0} aria-valuemax={HUNGER_MAX} aria-valuenow={Math.round(hunger)} aria-label="飽足度">
              <span>飽足</span>
              <div className="bar"><i style={{ width: `${hunger}%` }} className={`m-${mood}`} /></div>
            </div>
            {next !== null && (
              <div className="grow-hint h7-grow">
                <ProgressEgg pet={pet} />
                <span>{pet.stage === 'egg' ? `再餵 ${next} 次就會孵化` : `再餵 ${next} 次會長大`}</span>
              </div>
            )}
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
            <div className={`room ${edit ? 'edit' : ''} ${pv.roomFlash ? 'pf-tidy' : ''}`} ref={roomRef} aria-label="寵物房間" data-testid="room" style={{ width: roomW || undefined }}>
              {/* 背景自成一層（z-index: 0）：窗簾等內部圖層不會蓋到阿悟的對話泡泡與家具 */}
              <div className="pf-backdrop-layer" aria-hidden>
                <RoomBackdrop timeOfDay={life.tod} theme={roomTheme} glows={glows} />
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
                              hat={pet.hat}
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
                  const tint = tintFilter(ent.p.tint)
                  return (
                    <div
                      key={ent.id}
                      data-nodrag
                      data-placed={ent.id}
                      data-slot={ent.it.slot}
                      data-tint={ent.p.tint || undefined}
                      className={`placed ${edit ? 'editable' : ''} ${selected === ent.id ? 'selected' : ''} ${ent.it.id === 'decor-ball' && pv.ballBounce ? 'pf-ball-play' : ''}`}
                      style={{
                        left: ent.p.x * roomW - ent.size.w / 2,
                        top: ent.p.y * roomH - ent.size.h / 2,
                        width: ent.size.w,
                        height: ent.size.h,
                        zIndex: zOf(ent.id),
                        opacity: moving ? 0.25 : 1,
                        transform: ent.p.flipped ? 'scaleX(-1)' : undefined,
                        ...(tint ? { filter: tint } : {}),
                      }}
                      role={edit ? 'button' : undefined}
                      aria-label={edit ? `${ent.it.name}，可拖曳移動` : undefined}
                      {...(edit ? bind('move', ent.id) : {})}
                    >
                      {isArtworkId(ent.it.id) ? (
                        <GalleryFrame artId={ent.it.id} className="placed-art" />
                      ) : (
                        <Art name={artName(ent.it)} alt={ent.it.name} className="placed-art" />
                      )}
                    </div>
                  )
                })}

              <RoomAmbient timeOfDay={life.tod} />

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
                const size = sizeOf(selItem, selPlacement.scale)
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
                    style={{ left: Math.min(scrollLeft + view.w - 150, Math.max(scrollLeft + 150, selPlacement.x * roomW)), top: toolTop, transform: `translate(-50%, ${shift})`, zIndex: 1000 }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button className="btn" onClick={() => repo.flipDecor(selected!)} aria-label="左右翻轉">↔ 翻轉</button>
                    <button className="btn" onClick={() => repo.bringToFront(selected!)} aria-label="移到最前">⬆ 最前</button>
                    {!isArtworkId(selItem.id) && (
                      <button className="btn h7-tint-btn" onClick={() => { void repo.tintDecor(selected!, nextTint(selPlacement.tint)); sayText('換個顏色吧', { enabled: voiceOn }) }} aria-label={`換色，目前${DECOR_TINTS[selPlacement.tint ?? 0]?.name ?? '原色'}`} data-testid="tint-btn" data-tint={selPlacement.tint ?? 0}>
                        <span className="h7-tint-dot" aria-hidden style={{ background: ['#f2a65a', '#ee7aa2', '#5a9be6', '#4fb58f', '#8f78e0'][selPlacement.tint ?? 0] }} /> 換色
                      </button>
                    )}
                    <button className="btn" onClick={async () => { await repo.removeDecor(selected!); setSelected(null) }} aria-label="收回">✕ 收回</button>
                  </div>
                )
              })()}
            </div>
          </div>

          {canLeft && <button className="room-arrow left" onClick={() => scrollBy(-1)} aria-label="往左看房間" data-testid="room-left"><span aria-hidden>👈</span></button>}
          {!edit && <GiftBag gifts={giftList} calm={dragging || !!pv.food || bagBusy} onTake={(el) => void takeAllGifts(el)} />}
          {canRight && <button className="room-arrow right" onClick={() => scrollBy(1)} aria-label="往右看房間" data-testid="room-right"><span aria-hidden>👉</span></button>}
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
          {/* v7.4 J5：原本是一顆白色的「▶」（像影片播放鈕）；改成寫明「更多食物」「前面」的黃色按鈕，高度和食物一樣、不蓋住食物。
              位置維持在食物列前面（左邊）：箭頭出現 / 消失時，食物列的右緣不動，捲到底的那幾個食物不會被箭頭蓋住 */}
          {dockFade.left && (
            <button className="dock-arrow left j74-dock-arrow" onClick={() => scrollDock(-1)} aria-label={edit ? '看前面的家具' : '看前面的食物'} data-testid="dock-arrow-left">
              <span className="j74-da-chev" aria-hidden>‹</span>
              <span className="j74-da-label" aria-hidden>前面</span>
            </button>
          )}
          {dockFade.right && (
            <button className="dock-arrow right j74-dock-arrow" onClick={() => scrollDock(1)} aria-label={edit ? '更多家具' : '更多食物'} data-testid="dock-arrow-right">
              <span className="j74-da-chev" aria-hidden>›</span>
              <span className="j74-da-label" aria-hidden>{edit ? '更多家具' : '更多食物'}</span>
            </button>
          )}
        <div className="dock" ref={dockRef} onScroll={measureDock} data-testid="dock" aria-label={edit ? '尚未擺放的裝飾' : '飼料'}>
          {!edit &&
            foods
              .filter((f) => f.qty > 0)
              .map(({ item, qty }) => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={`dock-item food ${drag?.itemId === item.id && drag.kind === 'food' ? 'lifted' : ''} ${nopeId === item.id ? 'nope' : ''}`}
                  data-dock-item={item.id}
                  aria-label={`餵${item.name}，剩 ${qty} 個，可拖到${pet.name}身上`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      void feed(item.id, undefined, 'tap')
                    }
                  }}
                  {...bind('food', item.id)}
                >
                  <Icon name={artName(item)} emoji={FOOD_EMOJI[item.asset]} alt={item.name} className="dock-icon" />
                  <span className="dock-name">{item.name}</span>
                  <span className="dock-sub">x{qty}</span>
                </div>
              ))}
          {/* v7（V6）：庫存 0 的食物不再灰色排一整排，統一收進這一個「去商店」圖示 */}
          {!edit && (
            <button className="dock-item h7-dock-shop" onClick={goShop} data-testid="dock-shop" aria-label={foods.some((f) => f.qty > 0) ? '去商店買更多食物' : '食物都沒有了，去商店買'}>
              <Icon name="ui-shop" emoji="🛒" className="dock-icon" />
              <span className="dock-name">去商店</span>
              <span className="dock-sub">買食物</span>
            </button>
          )}
          {edit &&
            unplaced.map(([d, n]) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                className={`dock-item decor-item ${drag?.itemId === d.id && drag.kind === 'new' ? 'lifted' : ''}`}
                data-dock-item={d.id}
                data-left={n}
                aria-label={`${d.name}，${n > 1 ? `還有 ${n} 個，` : ''}拖進房間擺放`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    const c = defaultSpot(d)
                    void repo.placeNewDecor(d.id, c.x, c.y)
                  }
                }}
                {...bind('new', d.id)}
              >
                {isArtworkId(d.id) ? <GalleryFrame artId={d.id} className="dock-icon" /> : <Icon name={artName(d)} alt={d.name} className="dock-icon" />}
                <span className="dock-name">{d.name}</span>
                <span className="dock-sub">{d.slot === 'wall' ? '牆面' : '地板'}{n > 1 ? ` · x${n}` : ''}</span>
              </div>
            ))}
          {edit && unplaced.length === 0 && (
            <div className="dock-empty h7-dock-empty" data-testid="dock-empty">
              <Icon name="ui-workshop" emoji="🔨" size={44} />
              <span>{ownedDecor.length === 0 ? '還沒有家具' : '家具都擺好了'}</span>
              <button className="btn primary h7-go-workshop" onClick={goWorkshop ?? goShop} data-testid="go-workshop">
                <Icon name="ui-workshop" emoji="🔨" size={32} /> 去工坊
              </button>
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
      {reveal && <GiftReveal key={reveal.id} items={reveal.items} from={reveal.from} soundOn={soundOn} onDone={() => setReveal((r) => (r && r.id === reveal.id ? null : r))} />}
      {fly && flyItem && (
        <div className={`drag-ghost fly ${fly.go ? 'go' : ''}`} style={{ left: fly.go ? fly.tx : fly.fx, top: fly.go ? fly.ty : fly.fy, width: 56, height: 56 }} aria-hidden>
          <Icon name={artName(flyItem)} emoji={FOOD_EMOJI[flyItem.asset]} alt="" className="ghost-art" />
        </div>
      )}
    </>
  )
}
