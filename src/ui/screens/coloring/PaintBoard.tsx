import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BrushKind, ColoringSticker, ColoringStroke } from '../../../domain/types'
import { clampScale, clampStickerPos, mirrorStroke, STICKER_BASE, strokeNear, type PaintDoc } from '../../../domain/coloring'
import { clientToUnit, clampView, panBy, pinchView, stepZoom, VIEW_HOME, zoomAt, type View } from '../../../domain/viewport'
import { drawBackground } from '../../../art/coloring/backgrounds'
import { drawStroke } from '../../../art/coloring/brushes'
import { getColoringPage, isFreePage } from '../../../art/coloring/pages'
import { useRasterArt } from '../../../art/coloring/rasterArt'
import { hitRadiusAt, regionAt, regionIdOf, REGION_SIZE } from '../../../art/coloring/regions'
import { fromUnit, toUnit, VIEWBOX } from '../../../art/coloring/render'
import { newId } from '../../../db/repo'
import { ColoringSvg } from '../../components/ColoringThumb'
import { Icon } from '../../components/Icon'
import { playBrush } from '../../sounds'
import { stickerDropPoint } from '../../../domain/stickerDrop'
import { Minimap } from './Minimap'
import type { DropApi } from './StickerTray'
import { RasterLayer, type Ripple } from './RasterLayer'
import { stickerEmoji } from './stickers'

export type PaintTool = 'fill' | 'brush' | 'sticker' | 'eraser'

interface Props {
  pageId: string
  doc: PaintDoc
  tool: PaintTool
  color: string
  brushWidth: number
  /** 橡皮擦寬度（座標空間單位） */
  eraseWidth: number
  brushKind: BrushKind
  stamp: string
  mirror: boolean
  soundOn: boolean
  selected: string | null
  popped: Ripple | null
  /** at：點擊位置（著色頁座標空間 0–400），點陣頁拿來當漣漪的中心 */
  onFill: (regionId: string, at?: [number, number]) => void
  /** 空白畫紙：點一下 = 換背景色 */
  onFillBg: () => void
  onClearRegion: (regionId: string) => void
  /** 一次畫完的筆（開了鏡像會是兩筆；橡皮擦擦過的路徑是 kind 'erase' 的一筆）一起進復原堆疊 */
  onStrokes: (s: ColoringStroke[]) => void
  onSelect: (id: string | null) => void
  /** 貼紙手勢進行中（連續更新，不進復原堆疊） */
  onStickersLive: (next: ColoringSticker[]) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  /** D1：托盤拖貼紙時，畫板把「螢幕位置 → 貼紙位置」的換算放在這裡（放大時也正確） */
  dropApi?: React.MutableRefObject<DropApi | null>
  /** 托盤正在拖貼紙：畫板不接受別的手勢（不會誤畫、也不會被第二根手指縮放） */
  dragging?: boolean
  /** v7.3 F2：縮放鈕不壓在畫布上，改放進這個外面的節點（標題列右側）。沒給（undefined）= 畫在畫布角落（舊行為）；null = 節點還沒準備好，先不畫 */
  zoomHost?: HTMLElement | null
  /** v7.3 F3：這些區塊（regionId）閃動提示「還沒塗」；空陣列 / 沒給 = 不閃 */
  flashIds?: readonly string[]
}

/** 筆刷畫布的解析度倍率：放大時畫細一點，但畫布邊長不超過 2048（iPad 的記憶體） */
const zoomRes = (z: number) => (z <= 1.25 ? 1 : z <= 1.75 ? 1.5 : z <= 2.5 ? 2 : 3)
const MAX_CANVAS = 2048
const TAP_SLOP = 12 // 手指移動超過這麼多 css px 就不算「點一下」

type Mode = 'idle' | 'brush' | 'eraser' | 'fill' | 'pinch' | 'spinch' | 'ignore'
interface LiveStroke {
  main: ColoringStroke
  /** 鏡像那一筆（開鏡像才有）；id 在一開始就定好，預覽和存檔的圖樣才會一樣 */
  twin: ColoringStroke | null
}

/**
 * 畫板：（背景 / SVG 線稿 / 點陣線稿與填色）→ 筆刷 canvas → 即時筆畫 canvas → 貼紙層。
 * 座標空間與著色頁相同（0–400）。放大只改「顯示」：整個畫面包在 .pb-world 裡用 CSS transform 縮放，
 * 手指位置一律經 viewport.clientToUnit 換算回座標空間，所以存下來的點不受放大影響。
 * 單指 = 工具照常作用；雙指 = 縮放與平移（會取消進行中的那一筆）。
 */
export function PaintBoard(props: Props) {
  const { pageId, doc, tool, color, brushWidth, eraseWidth, brushKind, stamp, mirror, popped } = props
  const page = getColoringPage(pageId)
  const free = isFreePage(pageId)
  const art = useRasterArt(page?.kind === 'raster' ? pageId : undefined)
  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const bgRef = useRef<HTMLCanvasElement>(null)
  const [px, setPx] = useState(0)
  const [view, setView] = useState<View>(VIEW_HOME)
  const viewRef = useRef(view)
  viewRef.current = view
  const [redraw, setRedraw] = useState(0) // 橡皮擦被取消時，整張筆刷層要重畫
  const moved = useRef(false)
  const docRef = useRef(doc)
  docRef.current = doc
  const toolRef = useRef(tool)
  toolRef.current = tool
  const draggingRef = useRef(false)
  draggingRef.current = !!props.dragging

  // 量畫板大小，決定 canvas 解析度
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => setPx(Math.round(el.getBoundingClientRect().width))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2)
  const res = px ? Math.min(MAX_CANVAS / px, dpr * zoomRes(view.z)) : 1
  const B = Math.round(px * res) // 筆刷與背景畫布的邊長（像素）

  // ---- 背景（空白畫紙） ----
  useLayoutEffect(() => {
    const c = bgRef.current
    if (!c || !free || !B) return
    c.width = B
    c.height = B
    const ctx = c.getContext('2d')
    if (ctx) drawBackground(ctx, doc.bg, B)
  }, [free, doc.bg, B])

  // ---- 筆刷：新增的筆只補畫新的；有刪除、換解析度才整個重畫 ----
  const drawn = useRef<{ key: string; ids: string[] }>({ key: '', ids: [] })
  const live = useRef<LiveStroke | null>(null)
  const clearLive = () => {
    const c = liveCanvasRef.current
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
  }
  useLayoutEffect(() => {
    const c = canvasRef.current
    const lc = liveCanvasRef.current
    if (!c || !B) return
    const key = `${B}:${redraw}`
    const ids = doc.strokes.map((s) => s.id)
    const prev = drawn.current
    const append = prev.key === key && prev.ids.length <= ids.length && prev.ids.every((id, i) => id === ids[i])
    if (c.width !== B || !append) {
      c.width = B
      c.height = B
      if (lc) {
        lc.width = B
        lc.height = B
      }
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    const from = append ? prev.ids.length : 0
    for (const s of doc.strokes.slice(from)) drawStroke(ctx, s, B)
    drawn.current = { key, ids }
    if (!live.current) clearLive() // 剛存檔的那一筆已經畫進主畫布，即時層可以清掉了
  }, [doc.strokes, B, redraw])

  // ---- 即時筆畫（rAF 合併：一個畫面最多重畫一次） ----
  const raf = useRef(0)
  const paintLive = useCallback(() => {
    raf.current = 0
    const lc = liveCanvasRef.current
    const l = live.current
    const ctx = lc?.getContext('2d')
    if (!lc || !ctx || !l) return
    ctx.clearRect(0, 0, lc.width, lc.height)
    drawStroke(ctx, l.main, lc.width)
    if (l.twin) drawStroke(ctx, l.twin, lc.width)
  }, [])
  const scheduleLive = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(paintLive)
  }, [paintLive])
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    },
    [],
  )

  // ---- 座標換算 ----
  const unitOf = useCallback((clientX: number, clientY: number): [number, number] => {
    const r = viewportRef.current!.getBoundingClientRect()
    return clientToUnit(viewRef.current, r, clientX, clientY)
  }, [])
  /** 螢幕位置 → 著色頁座標空間（0–400） */
  const pointOf = useCallback(
    (e: { clientX: number; clientY: number }): [number, number] => {
      const [ux, uy] = unitOf(e.clientX, e.clientY)
      return [fromUnit(ux), fromUnit(uy)]
    },
    [unitOf],
  )

  // ---- D1：貼紙從托盤拖進來 ----
  const dropApi = props.dropApi
  useEffect(() => {
    if (!dropApi) return
    dropApi.current = {
      pointAt: (cx, cy) => {
        const el = viewportRef.current
        if (!el) return null
        // 放在放大鈕、小地圖上 = 取消（那不是畫布）
        if (document.elementFromPoint(cx, cy)?.closest('[data-pb-ui]')) return null
        return stickerDropPoint(clampView(viewRef.current), el.getBoundingClientRect(), cx, cy)
      },
      stickerPx: (scale) => {
        const el = viewportRef.current
        return el ? ((STICKER_BASE * scale) / VIEWBOX.size) * el.getBoundingClientRect().width * clampView(viewRef.current).z : 84
      },
    }
    return () => {
      dropApi.current = null
    }
  }, [dropApi])

  // ---- 點一下（填色 / 橡皮擦清區塊） ----
  const regionFromPoint = (clientX: number, clientY: number): string | null => {
    if (page?.kind === 'raster') {
      if (!art) return null
      const [ux, uy] = unitOf(clientX, clientY)
      const label = regionAt(art.map, ux * REGION_SIZE, uy * REGION_SIZE, hitRadiusAt(viewRef.current.z))
      return label ? regionIdOf(label) : null
    }
    const hit = document.elementsFromPoint(clientX, clientY).find((n) => n.hasAttribute('data-region'))
    return hit?.getAttribute('data-region') ?? null
  }

  // ---- 指標：筆畫開始時鎖定 pointerId（owner），其他指標忽略；雙指 = 縮放平移（或選取中的貼紙的縮放旋轉）----
  type Ptr = { x: number; y: number; type: string }
  const ptrs = useRef(new Map<number, Ptr>())
  const owner = useRef<number | null>(null)
  const mode = useRef<Mode>('idle')
  const pinch = useRef<{ d0: number; a0: number; c0: [number, number]; v0: View; st?: { id: string; s0: number; r0: number } } | null>(null)
  const down = useRef<{ x: number; y: number } | null>(null)
  const sndAt = useRef({ t: 0, n: 0 })
  const eraseLive = useRef<ColoringStroke | null>(null)
  const gestureOpen = useRef(false)
  const openGesture = () => {
    if (!gestureOpen.current) {
      gestureOpen.current = true
      props.onGestureStart()
    }
  }
  const closeGesture = () => {
    if (gestureOpen.current) {
      gestureOpen.current = false
      props.onGestureEnd()
    }
  }
  /** 手掌：touch 的接觸面積很大（半徑 > 20 = 寬 > 40px）就不畫、也不算手指 */
  const isPalm = (e: { pointerType: string; width: number; height: number }) => e.pointerType === 'touch' && Math.max(e.width, e.height) > 40

  const cancelSingle = () => {
    if (mode.current === 'brush') {
      live.current = null
      clearLive()
    }
    if (mode.current === 'eraser' && eraseLive.current) {
      eraseLive.current = null
      setRedraw((n) => n + 1) // 已經擦在畫布上的部分要還原：整層重畫
    }
    gesture.current = null // 貼紙拖曳也中止（復原堆疊的那一組留給 closeGesture）
    down.current = null
  }

  const twoFingers = () => {
    const [a, b] = [...ptrs.current.values()]
    const r = viewportRef.current!.getBoundingClientRect()
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y) / r.width,
      px: Math.hypot(a.x - b.x, a.y - b.y),
      ang: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      c: [((a.x + b.x) / 2 - r.left) / r.width, ((a.y + b.y) / 2 - r.top) / r.height] as [number, number],
    }
  }
  const startPinch = () => {
    cancelSingle()
    const t = twoFingers()
    const sel = toolRef.current === 'sticker' ? docRef.current.stickers.find((x) => x.id === props.selected) : undefined
    if (sel) {
      mode.current = 'spinch'
      openGesture()
      pinch.current = { d0: t.px, a0: t.ang, c0: t.c, v0: viewRef.current, st: { id: sel.id, s0: sel.scale, r0: sel.rot } }
    } else {
      mode.current = 'pinch'
      pinch.current = { d0: t.d, a0: t.ang, c0: t.c, v0: viewRef.current }
    }
  }
  const updatePinch = () => {
    const p = pinch.current
    if (!p || ptrs.current.size < 2) return
    const t = twoFingers()
    if (p.st) updateSticker(p.st.id, { scale: clampScale((p.st.s0 * t.px) / Math.max(1, p.d0)), rot: Math.round(p.st.r0 + (t.ang - p.a0)) })
    else setView(pinchView(p.v0, p.d0, p.c0, t.d, t.c))
  }
  /** 手指放開（viewport 與貼紙共用）：回傳 true = 已經當成雙指手勢的一部分處理掉了 */
  const releasePointer = (id: number): boolean => {
    const wasPinch = mode.current === 'pinch' || mode.current === 'spinch'
    if (!ptrs.current.delete(id)) return true
    if (wasPinch) {
      if (ptrs.current.size < 2) {
        if (mode.current === 'spinch') closeGesture()
        pinch.current = null
        mode.current = ptrs.current.size === 0 ? 'idle' : 'ignore' // 還有一根手指：等全部放開才開始下一筆
      }
      if (ptrs.current.size === 0) owner.current = null
      return true
    }
    if (mode.current === 'ignore') {
      if (ptrs.current.size === 0) {
        mode.current = 'idle'
        owner.current = null
      }
      return true
    }
    return id !== owner.current // 不是筆畫的擁有者放開：忽略
  }

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-pb-ui]')) return
    if (draggingRef.current) return // 托盤正在拖貼紙
    if (isPalm(e)) return
    const all = [...ptrs.current.values()]
    // 已經有一根手指 / 一支筆在畫：只有「全部都是 touch」才可能是雙指手勢，其他（筆、滑鼠、手掌）一律忽略
    if (all.length >= 1 && !(e.pointerType === 'touch' && all.every((p) => p.type === 'touch'))) return
    if (toolRef.current === 'sticker' && all.length === 0 && !(e.target as HTMLElement).closest('.pt-sticker')) props.onSelect(null)
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    e.currentTarget.setPointerCapture(e.pointerId)
    if (ptrs.current.size >= 2) {
      startPinch()
      return
    }
    owner.current = e.pointerId
    if (mode.current === 'ignore' || mode.current === 'pinch' || mode.current === 'spinch') return
    startSingle(e)
  }

  const startSingle = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = toolRef.current
    const [x, y] = pointOf(e)
    moved.current = false
    down.current = { x: e.clientX, y: e.clientY }
    if (t === 'brush') {
      mode.current = 'brush'
      const base: ColoringStroke = { id: newId(), color, kind: brushKind, width: brushWidth, points: [[x, y]], ...(brushKind === 'stamp' ? { stamp } : {}) }
      live.current = { main: base, twin: mirror ? mirrorStroke(base, newId()) : null }
      sndAt.current = { t: performance.now(), n: 0 }
      playBrush(props.soundOn, brushKind, 0)
      scheduleLive()
    } else if (t === 'eraser') {
      mode.current = 'eraser'
      eraseLive.current = { id: newId(), color: '#000000', kind: 'erase', width: eraseWidth, points: [[x, y]] }
    } else if (t === 'fill') {
      mode.current = 'fill'
    } else mode.current = 'idle'
  }

  /** 橡皮擦即時效果：直接擦在筆刷層上（放開時整條 erase 筆畫存檔，再畫一次結果相同） */
  const eraseSegment = (a: [number, number], b: [number, number]) => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    const l = eraseLive.current
    if (!c || !ctx || !l) return
    drawStroke(ctx, { ...l, points: [a, b] }, c.width)
  }

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = ptrs.current.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY
    if (mode.current === 'pinch' || mode.current === 'spinch') return updatePinch()
    if (e.pointerId !== owner.current) return
    if (down.current && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > TAP_SLOP) moved.current = true
    const m = mode.current
    if (m === 'brush' && live.current) {
      const [x, y] = pointOf(e)
      const pts = live.current.main.points
      const [lx, ly] = pts[pts.length - 1]
      const min2 = 2 / (viewRef.current.z * viewRef.current.z)
      if ((lx - x) ** 2 + (ly - y) ** 2 < min2) return
      pts.push([x, y])
      live.current.twin?.points.push([400 - x, y])
      const now = performance.now()
      if (now - sndAt.current.t > 150) {
        sndAt.current = { t: now, n: sndAt.current.n + 1 }
        playBrush(props.soundOn, live.current.main.kind ?? 'pen', sndAt.current.n)
      }
      scheduleLive()
    } else if (m === 'eraser' && eraseLive.current) {
      const [x, y] = pointOf(e)
      const pts = eraseLive.current.points
      const last = pts[pts.length - 1]
      if ((last[0] - x) ** 2 + (last[1] - y) ** 2 < 1) return
      if (!moved.current) return // 還在「點一下」的範圍內：先不擦，放開時才決定是清區塊還是擦一點
      if (pts.length === 1) eraseSegment(last, [x, y])
      else eraseSegment(last, [x, y])
      pts.push([x, y])
    }
  }

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (releasePointer(e.pointerId)) return
    const m = mode.current
    mode.current = 'idle'
    owner.current = null
    if (m === 'brush' && live.current) {
      const l = live.current
      live.current = null
      props.onStrokes(l.twin ? [l.main, l.twin] : [l.main])
    } else if (m === 'eraser' && eraseLive.current) {
      const l = eraseLive.current
      eraseLive.current = null
      if (moved.current) {
        // 滑過去：局部擦掉（存成一條 erase 筆畫，可復原）
        l.points.push(pointOf(e))
        props.onStrokes([l])
      } else {
        // 點一下：點在有填色的區塊上就清掉顏色；否則擦掉那一點的筆刷
        const id = free ? null : regionFromPoint(e.clientX, e.clientY)
        const [x, y] = l.points[0]
        if (id && id in docRef.current.fills) props.onClearRegion(id)
        else if (docRef.current.strokes.some((st) => st.kind !== 'erase' && strokeNear(st, x, y, l.width / 2))) props.onStrokes([l])
      }
    } else if (m === 'fill' && !moved.current) {
      if (free) props.onFillBg()
      else {
        const id = regionFromPoint(e.clientX, e.clientY)
        if (id) props.onFill(id, pointOf(e))
      }
    }
    down.current = null
  }

  const onCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (releasePointer(e.pointerId)) return
    cancelSingle()
    mode.current = ptrs.current.size ? 'ignore' : 'idle'
    if (!ptrs.current.size) owner.current = null
  }

  // 電腦：Ctrl + 滾輪（觸控板雙指張開）縮放，放大時滾輪平移
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const v = viewRef.current
      if (!e.ctrlKey && v.z <= 1.001) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey) setView(zoomAt(v, v.z * Math.exp(-e.deltaY * 0.01), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height))
      else setView(panBy(v, -e.deltaX / r.width, -e.deltaY / r.height))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 放大按鈕 / 小地圖用的：以目前視窗中心縮放
  const zoomBy = (dir: 1 | -1) => setView((v) => zoomAt(v, stepZoom(v.z, dir)))
  const zoomLabel = `${Math.round(view.z * 10) / 10}×`

  // ---- 貼紙 ----
  const gesture = useRef<
    | { kind: 'move'; id: string; dx: number; dy: number }
    | { kind: 'xform'; id: string; cx: number; cy: number; d0: number; a0: number; s0: number; r0: number }
    | null
  >(null)

  const updateSticker = (id: string, patch: Partial<ColoringSticker>) =>
    props.onStickersLive(docRef.current.stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const onStickerDown = (e: React.PointerEvent<HTMLDivElement>, st: ColoringSticker) => {
    if (tool !== 'sticker') return
    e.stopPropagation()
    if (draggingRef.current || isPalm(e)) return
    const all = [...ptrs.current.values()]
    if (all.length >= 1 && !(e.pointerType === 'touch' && all.every((p) => p.type === 'touch'))) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    e.currentTarget.setPointerCapture(e.pointerId)
    if (ptrs.current.size >= 2) {
      // 第二根手指落在貼紙上：雙指縮放旋轉（選取中的貼紙），或縮放畫面
      if (!props.selected) props.onSelect(st.id)
      startPinch()
      return
    }
    owner.current = e.pointerId
    mode.current = 'idle'
    props.onSelect(st.id)
    openGesture()
    const [x, y] = pointOf(e)
    gesture.current = { kind: 'move', id: st.id, dx: st.x - x, dy: st.y - y }
  }
  const onHandleDown = (e: React.PointerEvent<HTMLElement>, st: ColoringSticker) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    openGesture()
    const r = worldRef.current!.getBoundingClientRect() // 已含縮放與平移
    const cx = r.left + toUnit(st.x) * r.width
    const cy = r.top + toUnit(st.y) * r.height
    gesture.current = {
      kind: 'xform',
      id: st.id,
      cx,
      cy,
      d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      a0: (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI,
      s0: st.scale,
      r0: st.rot,
    }
  }
  const onGestureMove = (e: React.PointerEvent<HTMLElement>) => {
    const pt = ptrs.current.get(e.pointerId)
    if (pt) {
      pt.x = e.clientX
      pt.y = e.clientY
    }
    if (mode.current === 'spinch' || mode.current === 'pinch') return updatePinch()
    const g = gesture.current
    if (!g) return
    if (g.kind === 'move') {
      const [x, y] = pointOf(e)
      updateSticker(g.id, { x: clampStickerPos(x + g.dx), y: clampStickerPos(y + g.dy) })
    } else {
      const d = Math.hypot(e.clientX - g.cx, e.clientY - g.cy) || 1
      const a = (Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * 180) / Math.PI
      updateSticker(g.id, { scale: clampScale((g.s0 * d) / g.d0), rot: Math.round(g.r0 + (a - g.a0)) })
    }
  }
  const onGestureUp = (e: React.PointerEvent<HTMLElement>) => {
    if (ptrs.current.has(e.pointerId) && releasePointer(e.pointerId)) return
    if (ptrs.current.size === 0) owner.current = null
    if (!gesture.current) return
    gesture.current = null
    closeGesture()
  }

  const v = clampView(view)
  const zoomUi = (
    <div className={`pb-zoom ${props.zoomHost ? 'f73-zoom-out' : ''}`} data-pb-ui data-testid="pb-zoom" role="group" aria-label="畫面拉近拉遠">
      <button className="pb-zbtn" onClick={() => zoomBy(-1)} disabled={v.z <= 1.001} aria-label="畫面拉遠" data-testid="zoom-out">－</button>
      <span className="pb-zlabel" data-testid="zoom-label" aria-live="polite">{zoomLabel}</span>
      <button className="pb-zbtn" onClick={() => zoomBy(1)} disabled={v.z >= 2.999} aria-label="畫面拉近" data-testid="zoom-in">＋</button>
    </div>
  )
  const tx = -v.ox * v.z * px
  const ty = -v.oy * v.z * px
  const brushOn = tool === 'brush' || tool === 'eraser'
  return (
    <div
      className={`pt-board pb-viewport tool-${tool} ${free ? 'is-free' : ''}`}
      ref={viewportRef}
      data-testid="paint-board"
      data-zoom={v.z.toFixed(2)}
      data-view={`${v.ox.toFixed(3)},${v.oy.toFixed(3)}`}
      style={{ touchAction: 'none', ['--pb-z' as string]: v.z }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
    >
      <div className="pb-world" ref={worldRef} style={{ transform: `translate(${tx}px, ${ty}px) scale(${v.z})` }}>
        {free && <canvas ref={bgRef} className="pb-bg" data-testid="free-bg" data-bg={doc.bg ?? 'white'} />}
        {!free && page?.kind === 'raster' && art && <RasterLayer art={art} fills={doc.fills} ripple={popped} flashIds={props.flashIds} />}
        {!free && page?.kind !== 'raster' && <ColoringSvg pageId={pageId} fills={doc.fills} regionClass={tool === 'fill'} popped={popped} flashIds={props.flashIds} reference className="pt-svg" />}
        <canvas
          ref={canvasRef}
          className="pt-canvas"
          data-testid="brush-canvas"
          style={{ pointerEvents: brushOn ? 'auto' : 'none', touchAction: 'none' }}
        />
        <canvas ref={liveCanvasRef} className="pt-canvas pb-live" data-testid="live-canvas" />
        {mirror && tool === 'brush' && <i className="pb-mirror-line" data-testid="mirror-line" />}
        <div className="pt-stickers">
          {doc.stickers.map((st) => {
            const on = tool === 'sticker'
            return (
              <div
                key={st.id}
                className={`pt-sticker ${props.selected === st.id && on ? 'sel' : ''}`}
                data-testid="sticker"
                data-art={st.art}
                style={{
                  left: `${toUnit(st.x) * 100}%`,
                  top: `${toUnit(st.y) * 100}%`,
                  width: `${((STICKER_BASE * st.scale) / VIEWBOX.size) * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${st.rot}deg)`,
                  pointerEvents: on ? 'auto' : 'none',
                  touchAction: 'none',
                }}
                onPointerDown={(e) => onStickerDown(e, st)}
                onPointerMove={onGestureMove}
                onPointerUp={onGestureUp}
                onPointerCancel={onGestureUp}
              >
                <Icon name={st.art} emoji={stickerEmoji(st.art)} alt="" className="pt-sticker-art" size="100%" />
                {props.selected === st.id && on && (
                  <i
                    className="pt-handle"
                    data-testid="sticker-handle"
                    style={{ touchAction: 'none' }}
                    onPointerDown={(e) => onHandleDown(e, st)}
                    onPointerMove={onGestureMove}
                    onPointerUp={onGestureUp}
                    onPointerCancel={onGestureUp}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {props.zoomHost === undefined ? zoomUi : props.zoomHost ? createPortal(zoomUi, props.zoomHost) : null}
      {v.z > 1.01 && <Minimap pageId={pageId} doc={doc} view={v} onView={setView} />}
    </div>
  )
}
