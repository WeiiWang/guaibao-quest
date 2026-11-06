import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { hatAnchor, hatFit } from '../../../art/hats'
import { HATS, canWearHat, hatOf } from '../../../domain/hats'
import {
  COUNT_FROM,
  COUNT_STEP_MS,
  PET_SIZES,
  PET_START,
  PHOTO_BACKDROPS,
  PHOTO_JPEG_Q,
  PHOTO_MAX_STICKERS,
  PHOTO_PX,
  STICKER_SIZE,
  clampPet,
  clampSticker,
  containIn,
  coverCrop,
  hatOnImage,
  insidePhoto,
  nextPose,
  nextSize,
  photoLine,
  pinchSize,
  stickerSpot,
  type PhotoPose,
  type Rect,
} from '../../../domain/photo'
import { playSound } from '../../../learning/audioEngine'
import { Icon } from '../../components/Icon'
import { PetSprite } from '../../components/PetSprite'
import { useLearningSettings } from '../../learningHooks'
import { GameShell, type GameProps } from '../playground/GameShell'
import type { GameRootProps } from '../playground/GameScreen'
import { reducedMotion, useBand, useFinishLater, useTrackedSay } from '../playground/playU'
import { GestureHint } from '../playground/vShared'
import { useUnlockedStickers } from '../coloring/useUnlockedStickers'
import { ArtOr, CameraSvg, GalleryFrameSvg } from './aaArt'
import { playShutter } from './aaSfx'
import './photo.css'

// 照相館：選佈景 → 擺寵物（拖、縮放、換姿勢）→ 戴帽子、貼貼紙 → 按快門（手指 3、2、1）→ 閃光、喀嚓 → 拍立得飛出來 → 存進畫廊。
// 照片用 canvas 合成成 JPEG 存在 coloring 表（g:photo-<時間戳>），不放 settings。沒有對錯，滿 30 張就只是不存。

type Phase = 'pick' | 'stage' | 'count' | 'shoot' | 'print'
interface Placed {
  id: number
  art: string
  emoji: string
  x: number
  y: number
}
type Item = { kind: 'hat'; id: string; emoji: string } | { kind: 'sticker'; art: string; emoji: string }
type Drag =
  | { kind: 'tray'; item: Item; sx: number; sy: number; moved: boolean }
  | { kind: 'sticker'; id: number; sx: number; sy: number; moved: boolean }
  | { kind: 'pet'; sx: number; sy: number; px: number; py: number; moved: boolean }
  | { kind: 'pinch' }

const DRAG_SLOP = 10
const base = import.meta.env.BASE_URL

export default function Photo({ onExit, go }: GameRootProps) {
  return (
    <GameShell id="photo" scene="scene-town-studio" intro="pet.play.photo.intro" onExit={onExit}>
      {(p) => <PhotoGame {...p} toGallery={() => go('gallery')} />}
    </GameShell>
  )
}

function PhotoGame({ say: rawSay, finish, toGallery }: GameProps & { toGallery: () => void }) {
  const { soundOn } = useLearningSettings()
  // 照相館是自由創作，不分年齡檔（只標在畫面上給測試看）
  const band = useBand()
  const { rootRef, say } = useTrackedSay(rawSay)
  const finishLater = useFinishLater(finish)
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])
  const { unlocked } = useUnlockedStickers()
  const hats = HATS.filter((h) => inventory.some((v) => v.itemId === h.id && v.qty > 0))
  const hatsOk = !!pet && canWearHat(pet.stage)

  const [phase, setPhase] = useState<Phase>('pick')
  const [backdrop, setBackdrop] = useState(PHOTO_BACKDROPS[0].id)
  const [petAt, setPetAt] = useState(PET_START)
  const [sizeIdx, setSizeIdx] = useState(1)
  const [pose, setPose] = useState<PhotoPose>('happy')
  const [hat, setHat] = useState<string | null>(null)
  const [stickers, setStickers] = useState<Placed[]>([])
  const [ghosts, setGhosts] = useState<{ pid: number; item: Item; x: number; y: number }[]>([])
  const [count, setCount] = useState(COUNT_FROM)
  const [print, setPrint] = useState<{ url: string; saved: boolean | null } | null>(null)
  const [acted, setActed] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const petRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const shutterRef = useRef<HTMLButtonElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const polaroidRef = useRef<HTMLDivElement>(null)
  const drags = useRef(new Map<number, Drag>())
  const pinch = useRef<{ ids: [number, number]; d0: number; size0: number } | null>(null)
  const nextId = useRef(1)
  const placedN = useRef(0)
  const timers = useRef(new Set<number>())
  const soundRef = useRef(soundOn)
  soundRef.current = soundOn

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
    return id
  }, [])
  useEffect(() => {
    const set = timers.current
    return () => {
      for (const id of set) window.clearTimeout(id)
      set.clear()
    }
  }, [])

  const pop = () => {
    if (soundRef.current) playSound('pop')
  }

  // ---------- 選佈景 ----------
  const chooseBackdrop = (id: string) => {
    setBackdrop(id)
    pop()
    const first = phase === 'pick' && !print && stickers.length === 0
    setPhase('stage')
    if (first) say(photoLine('pose'))
  }

  // ---------- 手指 ----------
  const frameRect = () => frameRef.current?.getBoundingClientRect() ?? null
  const toFrame = (cx: number, cy: number) => {
    const r = frameRect()
    if (!r || !r.width) return null
    return { x: ((cx - r.left) / r.width) * 100, y: ((cy - r.top) / r.height) * 100 }
  }
  const inFrame = (cx: number, cy: number) => {
    const p = toFrame(cx, cy)
    return !!p && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100
  }

  const wearHat = (id: string) => {
    if (!hatsOk) return
    setHat(id)
    setActed(true)
    pop()
  }
  const addSticker = (item: Extract<Item, { kind: 'sticker' }>, at?: { x: number; y: number }) => {
    if (stickers.length >= PHOTO_MAX_STICKERS) {
      if (soundRef.current) playSound('tap')
      return false
    }
    const p = at ?? stickerSpot(placedN.current)
    placedN.current += 1
    setStickers((s) => [...s, { id: nextId.current++, art: item.art, emoji: item.emoji, x: clampSticker(p.x), y: clampSticker(p.y) }])
    setActed(true)
    pop()
    return true
  }

  // 托盤：點一下 = 戴上 / 貼上；拖進照片放開 = 放在那裡；拖到別的地方 = 取消
  const onTrayDown = (e: RPointerEvent<HTMLButtonElement>, item: Item) => {
    if (phase !== 'stage') return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drags.current.set(e.pointerId, { kind: 'tray', item, sx: e.clientX, sy: e.clientY, moved: false })
  }
  const onTrayMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drags.current.get(e.pointerId)
    if (!d || d.kind !== 'tray') return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return
      d.moved = true
      setGhosts((g) => [...g, { pid: e.pointerId, item: d.item, x: e.clientX, y: e.clientY }])
      return
    }
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-pid="${e.pointerId}"]`)
    if (el) el.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`
  }
  const onTrayUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drags.current.get(e.pointerId)
    if (!d || d.kind !== 'tray') return
    drags.current.delete(e.pointerId)
    const pid = e.pointerId
    setGhosts((g) => g.filter((x) => x.pid !== pid))
    const it = d.item
    if (!d.moved) {
      if (it.kind === 'hat') {
        if (hat === it.id) {
          setHat(null)
          pop()
        } else wearHat(it.id)
      } else addSticker(it)
      return
    }
    if (!inFrame(e.clientX, e.clientY)) return
    if (it.kind === 'hat') wearHat(it.id)
    else addSticker(it, toFrame(e.clientX, e.clientY) ?? undefined)
  }
  const onTrayCancel = (e: RPointerEvent<HTMLButtonElement>) => {
    const pid = e.pointerId
    if (!drags.current.delete(pid)) return
    setGhosts((g) => g.filter((x) => x.pid !== pid))
  }

  // 照片上的貼紙：拖著移動，拖出照片就拿掉
  const onStickerDown = (e: RPointerEvent<HTMLButtonElement>, id: number) => {
    if (phase !== 'stage') return
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drags.current.set(e.pointerId, { kind: 'sticker', id, sx: e.clientX, sy: e.clientY, moved: false })
  }
  const onStickerMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drags.current.get(e.pointerId)
    if (!d || d.kind !== 'sticker') return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return
    d.moved = true
    const p = toFrame(e.clientX, e.clientY)
    if (!p) return
    const el = e.currentTarget
    el.style.left = `${p.x}%`
    el.style.top = `${p.y}%`
    el.dataset.out = insidePhoto(p.x, p.y) ? '0' : '1'
  }
  const onStickerUp = (e: RPointerEvent<HTMLButtonElement>, s: Placed) => {
    const d = drags.current.get(e.pointerId)
    if (!d || d.kind !== 'sticker') return
    drags.current.delete(e.pointerId)
    const el = e.currentTarget
    delete el.dataset.out
    if (!d.moved) {
      if (soundRef.current) playSound('tap')
      if (!reducedMotion() && typeof el.animate === 'function') el.animate([{ rotate: '0deg' }, { rotate: '-12deg' }, { rotate: '10deg' }, { rotate: '0deg' }], { duration: 360 })
      return
    }
    const p = toFrame(e.clientX, e.clientY)
    if (p && insidePhoto(p.x, p.y)) {
      const x = clampSticker(p.x)
      const y = clampSticker(p.y)
      el.style.left = `${x}%`
      el.style.top = `${y}%`
      setStickers((all) => all.map((v) => (v.id === s.id ? { ...v, x, y } : v)))
      return
    }
    setStickers((all) => all.filter((v) => v.id !== s.id))
    if (soundRef.current) playSound('whoosh')
  }
  const onStickerCancel = (e: RPointerEvent<HTMLButtonElement>, s: Placed) => {
    if (!drags.current.delete(e.pointerId)) return
    const el = e.currentTarget
    delete el.dataset.out
    el.style.left = `${s.x}%`
    el.style.top = `${s.y}%`
  }

  // 寵物：拖著走；點一下換姿勢；兩根手指捏 = 換大小
  const startPinch = () => {
    const ids = [...drags.current.entries()].filter(([, d]) => d.kind === 'pet' || d.kind === 'pinch').map(([id]) => id)
    if (ids.length < 2) return
    const pts = ids.slice(0, 2).map((id) => last.current.get(id)!)
    if (!pts[0] || !pts[1]) return
    pinch.current = { ids: [ids[0], ids[1]], d0: Math.max(20, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)), size0: sizeIdx }
    for (const id of ids) drags.current.set(id, { kind: 'pinch' })
  }
  const last = useRef(new Map<number, { x: number; y: number }>())
  const onStageDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (phase !== 'stage') return
    last.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const onPet = !!petRef.current?.contains(e.target as Node)
    const others = [...drags.current.values()].filter((d) => d.kind === 'pet' || d.kind === 'pinch').length
    if (!onPet && others === 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drags.current.set(e.pointerId, { kind: 'pet', sx: e.clientX, sy: e.clientY, px: petAt.x, py: petAt.y, moved: false })
    if (others > 0) startPinch()
  }
  const onStageMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drags.current.get(e.pointerId)
    if (!d) return
    last.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (d.kind === 'pinch') {
      const p = pinch.current
      if (!p) return
      const a = last.current.get(p.ids[0])
      const b = last.current.get(p.ids[1])
      if (!a || !b) return
      const k = pinchSize(p.size0, Math.hypot(a.x - b.x, a.y - b.y) / p.d0)
      setSizeIdx(k)
      return
    }
    if (d.kind !== 'pet') return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return
    d.moved = true
    const r = frameRect()
    if (!r) return
    const nx = d.px + ((e.clientX - d.sx) / r.width) * 100
    const ny = d.py + ((e.clientY - d.sy) / r.height) * 100
    setPetAt(clampPet(nx, ny, PET_SIZES[sizeIdx]))
    setActed(true)
  }
  const onStageUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drags.current.get(e.pointerId)
    last.current.delete(e.pointerId)
    if (!d) return
    drags.current.delete(e.pointerId)
    if (d.kind === 'pinch') {
      if (![...drags.current.values()].some((x) => x.kind === 'pinch')) pinch.current = null
      // 另一根手指還按著：不要變成拖曳（等它放開）
      for (const [id, x] of drags.current) if (x.kind === 'pinch') drags.current.delete(id)
      setActed(true)
      return
    }
    if (d.kind === 'pet' && !d.moved && e.type === 'pointerup') {
      setPose((p) => nextPose(p))
      setActed(true)
      if (soundRef.current) playSound('tap')
    }
  }

  const cycleSize = () => {
    setSizeIdx((i) => {
      const k = nextSize(i)
      setPetAt((p) => clampPet(p.x, p.y, PET_SIZES[k]))
      return k
    })
    setActed(true)
    pop()
  }

  // ---------- 快門 ----------
  const countTimer = useRef<number | null>(null)
  const startCount = () => {
    if (phase !== 'stage') return
    drags.current.clear()
    setGhosts([])
    setPhase('count')
    setCount(COUNT_FROM)
    setActed(true)
    say(photoLine('ready'))
    const tick = (n: number) => {
      countTimer.current = later(() => {
        if (n <= 1) {
          countTimer.current = null
          void shoot()
          return
        }
        setCount(n - 1)
        if (soundRef.current) playSound('tap')
        tick(n - 1)
      }, COUNT_STEP_MS)
    }
    tick(COUNT_FROM)
  }
  const shootNow = () => {
    if (countTimer.current !== null) {
      window.clearTimeout(countTimer.current)
      timers.current.delete(countTimer.current)
      countTimer.current = null
    }
    void shoot()
  }

  const shooting = useRef(false)
  const shoot = async () => {
    if (shooting.current) return
    shooting.current = true
    setPhase('shoot')
    if (soundRef.current) playShutter()
    const fl = flashRef.current
    if (fl && typeof fl.animate === 'function') {
      fl.animate([{ opacity: 0 }, { opacity: reducedMotion() ? 0.5 : 1, offset: 0.25 }, { opacity: 0 }], { duration: reducedMotion() ? 260 : 520, easing: 'ease-out' })
    }
    const url = await compose().catch(() => '')
    shooting.current = false
    if (!url) {
      // 合成失敗（不太會發生）：回到拍照畫面，什麼都不損失
      setPhase('stage')
      return
    }
    setPrint({ url, saved: null })
    setPhase('print')
    const r = await repo.savePhoto(url)
    setPrint({ url, saved: r.saved })
    say(photoLine(r.saved ? 'saved' : 'full'))
    finishLater()
  }

  // 拍立得從相機飛出來（只用 transform / opacity）
  useEffect(() => {
    if (phase !== 'print') return
    const el = polaroidRef.current
    const cam = shutterRef.current?.getBoundingClientRect()
    if (!el || !cam || typeof el.animate !== 'function' || reducedMotion()) return
    const r = el.getBoundingClientRect()
    const dx = cam.left + cam.width / 2 - (r.left + r.width / 2)
    const dy = cam.top + cam.height / 2 - (r.top + r.height / 2)
    el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(0.15) rotate(-20deg)`, opacity: 0.4 }, { transform: 'translate(0, 0) scale(1) rotate(-3deg)', opacity: 1 }], { duration: 620, easing: 'cubic-bezier(0.2, 1.2, 0.4, 1)' })
  }, [phase])

  /** canvas 合成：佈景（蓋滿）、貼紙、寵物、帽子。全部用畫面上已經載好的圖（同源），尺寸依照片框換算 */
  const compose = async (): Promise<string> => {
    const frame = frameRef.current
    const fr = frame?.getBoundingClientRect()
    if (!frame || !fr || !fr.width) return ''
    const N = PHOTO_PX
    const k = N / fr.width
    const c = document.createElement('canvas')
    c.width = N
    c.height = N
    const g = c.getContext('2d')
    if (!g) return ''
    const meta = PHOTO_BACKDROPS.find((b) => b.id === backdrop)
    g.fillStyle = meta?.tone ?? '#fde7ef'
    g.fillRect(0, 0, N, N)
    const bg = frame.querySelector<HTMLImageElement>('img.photo-bg')
    if (bg && (await ready(bg))) {
      const cr = coverCrop(bg.naturalWidth, bg.naturalHeight, N, N)
      g.drawImage(bg, cr.x, cr.y, cr.w, cr.h, 0, 0, N, N)
    }
    const local = (r: DOMRect): Rect => ({ x: (r.left - fr.left) * k, y: (r.top - fr.top) * k, w: r.width * k, h: r.height * k })
    // 寵物（在貼紙下面：貼紙可以貼在寵物身上）
    const pw = petRef.current
    if (pw) {
      const box = local(pw.getBoundingClientRect())
      const img = pw.querySelector<HTMLImageElement>('img.pet-img')
      if (img && (await ready(img))) {
        const ir = containIn(img.naturalWidth, img.naturalHeight, box, true)
        g.save()
        g.shadowColor = 'rgba(90, 50, 20, 0.22)'
        g.shadowBlur = 16 * (N / 1080)
        g.shadowOffsetY = 8 * (N / 1080)
        g.drawImage(img, ir.x, ir.y, ir.w, ir.h)
        g.restore()
        const artFile = (img.currentSrc || img.src).split('/').pop()?.replace(/\.png.*$/, '') ?? ''
        const anchor = hat ? hatAnchor(artFile) : null
        if (hat && anchor) {
          const hatImg = pw.querySelector<HTMLImageElement>('.wd-hat img')
          const ok = !!hatImg && (await ready(hatImg))
          const h = hatOnImage(anchor, hatFit(hat, ok), ir)
          g.save()
          g.translate(h.cx, h.cy)
          g.rotate(h.rot)
          if (ok && hatImg) {
            const hr = containIn(hatImg.naturalWidth, hatImg.naturalHeight, { x: -h.w / 2, y: -h.pivot * h.h, w: h.w, h: h.h }, true)
            g.drawImage(hatImg, hr.x, hr.y, hr.w, hr.h)
          } else emojiAt(g, hatOf(hat)?.emoji ?? '', 0, -h.pivot * h.h + h.h / 2, h.h)
          g.restore()
        }
      } else {
        const em = pw.querySelector('.l75-pet-emoji')?.textContent ?? ''
        emojiAt(g, em, box.x + box.w / 2, box.y + box.h * 0.6, box.h * 0.7)
      }
    }
    // 貼紙
    for (const el of frame.querySelectorAll<HTMLElement>('[data-testid=photo-sticker]')) {
      const r = local(el.getBoundingClientRect())
      const img = el.querySelector<HTMLImageElement>('img')
      if (img && (await ready(img))) {
        const ir = containIn(img.naturalWidth, img.naturalHeight, r)
        g.drawImage(img, ir.x, ir.y, ir.w, ir.h)
      } else emojiAt(g, el.querySelector('.art-emoji-glyph')?.textContent ?? '', r.x + r.w / 2, r.y + r.h / 2, r.h * 0.8)
    }
    return c.toDataURL('image/jpeg', PHOTO_JPEG_Q)
  }

  const again = () => {
    setPrint(null)
    setPhase('stage')
    pop()
  }

  const trayFirst = useCallback(() => trayRef.current?.querySelector('button') ?? null, [])
  const frameEl = useCallback(() => frameRef.current, [])

  const items: Item[] = [
    ...(hatsOk ? hats.map((h) => ({ kind: 'hat' as const, id: h.id, emoji: h.emoji })) : []),
    ...unlocked.map((s) => ({ kind: 'sticker' as const, art: s.art, emoji: s.emoji })),
  ]
  const petSize = PET_SIZES[sizeIdx]
  const studio = phase !== 'pick'

  return (
    <div
      className="photo-root"
      ref={rootRef}
      data-testid="photo"
      data-band={band}
      data-phase={phase}
      data-pose={pose}
      data-size={sizeIdx}
      data-hat={hat ?? ''}
      data-stickers={stickers.length}
      data-saved={print?.saved == null ? '' : print.saved ? '1' : '0'}
      data-backdrop={backdrop}
    >
      {phase === 'pick' && (
        <div className="photo-pick" data-testid="photo-pick">
          {PHOTO_BACKDROPS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`photo-pick-btn ${b.id === backdrop && stickers.length + (print ? 1 : 0) > 0 ? 'on' : ''}`}
              style={{ backgroundColor: b.tone, backgroundImage: `url("${base}art/${b.id}.jpg")` }}
              onClick={() => chooseBackdrop(b.id)}
              aria-label="選這個佈景"
              data-testid={`photo-bg-${b.id}`}
            />
          ))}
        </div>
      )}

      {studio && (
        <div className="photo-studio">
          <div className="photo-frame-wrap">
            <div className="photo-frame" ref={frameRef} data-testid="photo-frame" onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp}>
              <img className="photo-bg" src={`${base}art/${backdrop}.jpg`} alt="" draggable={false} style={{ backgroundColor: PHOTO_BACKDROPS.find((b) => b.id === backdrop)?.tone }} />
              {pet && (
                <div className="photo-pet" ref={petRef} data-testid="photo-pet" style={{ left: `${petAt.x}%`, top: `${petAt.y}%`, width: `${petSize * 100}%` } as CSSProperties}>
                  <PetSprite pet={pet} mood="happy" pose={pet.stage === 'egg' ? undefined : pose} hat={hatsOk ? hat : null} />
                </div>
              )}
              {stickers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="photo-sticker"
                  style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${STICKER_SIZE * 100}%` }}
                  data-testid="photo-sticker"
                  data-art={s.art}
                  aria-label="貼紙"
                  onPointerDown={(e) => onStickerDown(e, s.id)}
                  onPointerMove={onStickerMove}
                  onPointerUp={(e) => onStickerUp(e, s)}
                  onPointerCancel={(e) => onStickerCancel(e, s)}
                >
                  <Icon name={s.art} emoji={s.emoji} size="100%" alt="" />
                </button>
              ))}
              <div className="photo-flash" ref={flashRef} aria-hidden />
            </div>
          </div>

          <div className="photo-side">
            <div className="photo-tools">
              <button type="button" className="photo-tool" onClick={() => setPhase('pick')} disabled={phase !== 'stage'} aria-label="換佈景" data-testid="photo-change-bg">
                <span className="photo-tool-bg" style={{ backgroundImage: `url("${base}art/${backdrop}.jpg")` }} aria-hidden />
              </button>
              <button type="button" className="photo-tool" onClick={cycleSize} disabled={phase !== 'stage'} aria-label="換大小" data-testid="photo-size">
                <svg viewBox="0 0 62 40" width="80%" height="80%" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <circle key={i} cx={[8, 25, 45][i]} cy={32 - (6 + i * 4)} r={6 + i * 4} fill={i === sizeIdx ? '#f48fb1' : '#f3d3df'} stroke="#d96b93" strokeWidth="2" />
                  ))}
                </svg>
              </button>
            </div>
            <div className="photo-tray" ref={trayRef} data-testid="photo-tray">
              {items.map((it) => (
                <button
                  key={it.kind === 'hat' ? it.id : it.art}
                  type="button"
                  className={`photo-item ${it.kind === 'hat' ? 'photo-item-hat' : ''} ${it.kind === 'hat' && hat === it.id ? 'on' : ''}`}
                  aria-label={it.kind === 'hat' ? hatOf(it.id)?.name ?? '帽子' : '貼紙'}
                  data-testid={it.kind === 'hat' ? `photo-hat-${it.id}` : 'photo-tray-sticker'}
                  data-art={it.kind === 'sticker' ? it.art : undefined}
                  onPointerDown={(e) => onTrayDown(e, it)}
                  onPointerMove={onTrayMove}
                  onPointerUp={onTrayUp}
                  onPointerCancel={onTrayCancel}
                  onClick={(e) => {
                    // 鍵盤或輔助工具（沒有 pointer 事件）
                    if (e.detail !== 0 || phase !== 'stage') return
                    if (it.kind === 'hat') wearHat(it.id)
                    else addSticker(it)
                  }}
                >
                  <Icon name={it.kind === 'hat' ? it.id : it.art} emoji={it.emoji} size="100%" alt="" />
                </button>
              ))}
            </div>
            <button type="button" className="photo-shutter" ref={shutterRef} onClick={startCount} disabled={phase !== 'stage'} aria-label="拍照" data-testid="photo-shutter">
              <ArtOr name="ui-photo-camera">
                <CameraSvg />
              </ArtOr>
            </button>
          </div>
        </div>
      )}

      {ghosts.map((g) => (
        <span key={g.pid} className="photo-ghost" data-pid={g.pid} style={{ transform: `translate(${g.x}px, ${g.y}px) translate(-50%, -50%)` }} aria-hidden data-testid="photo-ghost">
          <Icon name={g.item.kind === 'hat' ? g.item.id : g.item.art} emoji={g.item.emoji} size="100%" alt="" />
        </span>
      ))}

      {phase === 'count' && (
        <div className="photo-count" data-testid="photo-count" data-count={count}>
          <span key={count} className="photo-count-bubble">
            <Fingers n={count} />
            <b>{count}</b>
          </span>
          <button type="button" className="photo-now" onClick={shootNow} data-testid="photo-now">
            現在拍
          </button>
        </div>
      )}

      {phase === 'print' && print && (
        <div className="photo-print" data-testid="photo-print">
          <div className="photo-polaroid" ref={polaroidRef}>
            <img src={print.url} alt="剛拍的照片" data-testid="photo-print-img" />
          </div>
          <div className="photo-print-btns">
            <button type="button" className="photo-again" onClick={again} data-testid="photo-again" aria-label="再拍一張">
              <ArtOr name="ui-photo-camera">
                <CameraSvg />
              </ArtOr>
              <span>再拍一張</span>
            </button>
            {print.saved && (
              <button type="button" className="photo-again photo-to-gallery" onClick={toGallery} data-testid="photo-gallery" aria-label="去畫廊看">
                <span className="photo-again-icon">
                  <GalleryFrameSvg />
                </span>
                <span>去畫廊看</span>
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'stage' && !acted && <GestureHint from={trayFirst} to={frameEl} />}
    </div>
  )
}

/** 等圖片解碼好（已經在畫面上的圖通常馬上好）；壞圖回 false */
async function ready(img: HTMLImageElement): Promise<boolean> {
  if (!(img.complete && img.naturalWidth > 0)) {
    await new Promise<void>((res) => {
      const done = () => res()
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })
      window.setTimeout(done, 1500)
    })
  }
  return img.naturalWidth > 0
}

function emojiAt(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number) {
  if (!text) return
  g.save()
  g.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, cx, cy)
  g.restore()
}

/** 可愛的手指：比出 1、2、3 */
function Fingers({ n }: { n: number }) {
  const xs = [26, 38, 50]
  return (
    <svg className="photo-fingers" viewBox="0 0 76 90" aria-hidden>
      <rect x="14" y="42" width="48" height="40" rx="18" fill="#ffe0c2" stroke="#b5835a" strokeWidth="3" />
      {xs.map((x, i) => (
        <rect key={i} x={x - 5} y={i < n ? 10 + Math.abs(i - 1) * 4 : 36} width="11" height={i < n ? 40 : 14} rx="5.5" fill="#ffe0c2" stroke="#b5835a" strokeWidth="3" />
      ))}
      <rect x="54" y="48" width="11" height="22" rx="5.5" fill="#ffe0c2" stroke="#b5835a" strokeWidth="3" transform="rotate(-30 59 59)" />
    </svg>
  )
}
