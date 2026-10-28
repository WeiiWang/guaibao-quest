import { coloringPriceLine } from '../../learning/feedbackLines'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo, newId } from '../../db/repo'
import regionCounts from '../../art/coloring/region-counts.json'
import { COLORING_PAGES, FREE_PAGE_IDS, getColoringPage, isFreePage, pageName, type ColoringPageDef } from '../../art/coloring/pages'
import { renderArtworkPng } from '../../art/coloring/export'
import { BRUSH_KINDS, DEFAULT_STAMP, STAMPS } from '../../art/coloring/brushes'
import { useRegionIds } from '../../art/coloring/rasterArt'
import {
  bgWithColor,
  freeStickerSpot,
  BG_SCENES,
  BRUSH_WIDTHS,
  completionPercent,
  difficultyStars,
  ERASER_WIDTHS,
  RECENT_MAX,
  docIsEmpty,
  emptyDoc,
  makeSpecialFill,
  PALETTE_24,
  popUndo,
  pushRecent,
  pushUndo,
  SPECIAL_KINDS,
  UNDO_LIMIT,
  type BrushSize,
  type PaintDoc,
  type SpecialKind,
} from '../../domain/coloring'
import type { BrushKind, ColoringProgress, ColoringSticker, ColoringStroke } from '../../domain/types'
import { PageThumb } from '../components/ColoringThumb'
import { ScreenHeader } from '../components/Header'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { useToast } from '../hooks'
import { useLearningSettings } from '../learningHooks'
import { sayText } from '../../learning/speech'
import { SHOP_ITEMS } from '../../domain/constants'
import { playChime, playPop } from '../sounds'
import { BrushPreview, StampShape } from './coloring/BrushIcons'
import { FreeThumb } from './coloring/FreeThumb'
import { PaintBoard, type PaintTool } from './coloring/PaintBoard'
import type { Ripple } from './coloring/RasterLayer'
import { StickerTray, type DropApi } from './coloring/StickerTray'
import { stickerEmoji } from './coloring/stickers'
import { COUNT_MIN_PCT, FRAME_UNLOCK_LINE, countsAsFinished, frameDef, framesToGo, nextFrame, type FrameId } from '../../domain/frames'
import { GalleryFrameView } from '../components/GalleryFrame'
import type { Screen } from '../App'
import './coloring.css'
import './paintboard.css'

/** 舊名稱：12 色（v2）。新版色盤見 domain/coloring.ts 的 PALETTE_24 */
export const COLORING_PALETTE = PALETTE_24.slice(0, 12)

/** 完成度低於這個百分比就先問「再畫一點好嗎？」 */
export const ASK_BELOW_PCT = COUNT_MIN_PCT

const RECENT_KEY = 'gq-recent-colors'
const loadRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}
const saveRecent = (r: string[]) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(r))
  } catch {
    /* ignore */
  }
}

const useSoundOn = () => useLiveQuery(async () => (await db.settings.get('main'))?.soundOn !== false, [], true)

/** 難度標示：簡單 / 挑戰 + 1–3 顆星與大約幾塊（點陣頁的區塊數由 scripts/gen-region-counts.mjs 預先算好） */
function TierChip({ page }: { page: ColoringPageDef }) {
  const hard = page.tier === 'hard'
  const n = page.kind === 'raster' ? (regionCounts as Record<string, number>)[page.id] : page.regions.length
  const stars = n ? difficultyStars(n) : hard ? 3 : 1
  return (
    <span
      className={`pb-tier ${hard ? 'hard' : 'easy'}`}
      data-testid="tier-chip"
      data-tier={hard ? 'hard' : 'easy'}
      data-stars={stars}
      aria-label={`${hard ? '挑戰' : '簡單'}，難度 ${stars} 顆星${n ? `，大約 ${n} 塊` : ''}`}
    >
      {hard ? '挑戰' : '簡單'} <span className="pb-tier-stars" aria-hidden>{'★'.repeat(stars)}<i>{'★'.repeat(3 - stars)}</i></span>
      {n ? <small className="pb-tier-n">約 {n} 塊</small> : null}
    </span>
  )
}

/** 著色本列表上的一張頁面卡（點陣頁的完成度要等區塊表算好才有，先顯示「還沒開始」） */
function PageCard({ page, pr, onOpen }: { page: ColoringPageDef; pr?: ColoringProgress; onOpen: (id: string) => void }) {
  const rasterIds = useRegionIds(page.kind === 'raster' ? page.id : undefined)
  const ids = page.kind === 'raster' ? (rasterIds ?? []) : page.regions.map((r) => r.id)
  const pct = completionPercent(pr?.fills, ids)
  return (
    <li className="card shop-item art-card" data-testid={`page-${page.id}`}>
      <button className="thumb-btn" onClick={() => onOpen(page.id)} aria-label={`畫${page.name}`}>
        <PageThumb pageId={page.id} fills={pr?.fills} className="shop-thumb" />
      </button>
      <div className="shop-name">{page.name}</div>
      <TierChip page={page} />
      <div className="page-progress" role="img" aria-label={`完成度 ${pct}%`} data-pct={pct}>
        <i style={{ width: `${pct}%` }} />
        <span>{pct === 0 ? '還沒開始' : pct === 100 ? '全部填好了' : `${pct}%`}</span>
      </div>
    </li>
  )
}

export function ColoringListScreen({ onBack, onOpen, onGallery, onShop }: { onBack: () => void; onOpen: (pageId: string) => void; onGallery?: () => void; onShop?: () => void }) {
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])
  const progress = useLiveQuery(() => db.coloring.toArray(), [], [])
  const { voiceOn } = useLearningSettings()
  const [guide, setGuide] = useState<{ id: string; name: string; price: number } | null>(null)
  const [shaking, setShaking] = useState<string | null>(null)
  const galleryCount = progress.filter((p) => p.pageId.startsWith('g:')).length
  const unlocked = new Set(inventory.filter((v) => v.qty > 0).map((v) => v.itemId))
  const priceOf = (id: string) => SHOP_ITEMS.find((i) => i.id === `coloring-${id}`)?.price ?? 30
  // 簡單 / 挑戰兩區：向量頁與點陣簡單版歸「簡單」，點陣豐富版歸「挑戰」；每區已擁有的排最前面，上鎖的接在後面
  const section = (tier: 'easy' | 'hard') => {
    const pages = COLORING_PAGES.filter((p) => (p.tier ?? 'easy') === tier)
    return { open: pages.filter((p) => unlocked.has(`coloring-${p.id}`)), locked: pages.filter((p) => !unlocked.has(`coloring-${p.id}`)) }
  }
  const easy = section('easy')
  const hard = section('hard')

  // 點鎖頭：卡片晃一下 + 語音說明 + 大大的「去商店」按鈕（不識字的小孩不會卡在死路）
  const tapLocked = (id: string, name: string) => {
    const price = priceOf(id)
    setShaking(id)
    window.setTimeout(() => setShaking((v) => (v === id ? null : v)), 520)
    setGuide({ id, name, price })
    sayText(coloringPriceLine(price), { enabled: voiceOn })
  }

  const grid = (sec: { open: ColoringPageDef[]; locked: ColoringPageDef[] }, tier: 'easy' | 'hard') => (
    <ul className="shop-grid" data-testid={`grid-${tier}`}>
      {sec.open.map((p) => (
        <PageCard key={p.id} page={p} pr={progress.find((x) => x.pageId === p.id)} onOpen={onOpen} />
      ))}
      {sec.locked.map((p) => (
        <li key={p.id} className={`card shop-item art-card locked ${shaking === p.id ? 'ux-shake' : ''}`} data-testid={`locked-${p.id}`}>
          <button className="thumb-btn locked-btn pb-locked-thumb" onClick={() => tapLocked(p.id, p.name)} aria-label={`${p.name}還沒有，要用${priceOf(p.id)}顆星星換`}>
            <PageThumb pageId={p.id} className="shop-thumb" />
            <span className="pb-lock-badge" aria-hidden><Icon name="ui-lock" emoji="🔒" size={34} /></span>
          </button>
          <div className="shop-name">{p.name}</div>
          <TierChip page={p} />
          <div className="shop-price"><Icon name="ui-star" emoji="⭐" size={22} /> {priceOf(p.id)}</div>
        </li>
      ))}
    </ul>
  )

  return (
    <main className="screen theme-lavender">
      <ScreenHeader
        title="著色本"
        onBack={onBack}
        right={
          onGallery && (
            <button className="btn primary gallery-btn" onClick={onGallery} data-testid="open-gallery">
              我的畫廊{galleryCount > 0 ? ` (${galleryCount})` : ''}
            </button>
          )
        }
      />
      <ul className="shop-grid pb-free-row">
        <li className="card shop-item art-card pb-free-card" data-testid="free-card">
          <div className="pb-free-title">空白畫紙</div>
          <div className="pb-free-slots">
            {FREE_PAGE_IDS.map((id, i) => (
              <button key={id} className="pb-free-slot" onClick={() => onOpen(id)} aria-label={`空白畫紙第${i + 1}張`} data-testid={`free-${i + 1}`}>
                <FreeThumb pr={progress.find((x) => x.pageId === id)} />
                <span className="pb-free-n">{i + 1}</span>
              </button>
            ))}
          </div>
          <div className="pb-free-hint">自己畫，沒有線稿</div>
        </li>
      
      </ul>
      <h2 className="pb-tier-title" data-testid="tier-easy">簡單</h2>
      {grid(easy, 'easy')}
      {hard.open.length + hard.locked.length > 0 && (
        <>
          <h2 className="pb-tier-title" data-testid="tier-hard">挑戰</h2>
          {grid(hard, 'hard')}
        </>
      )}
      {guide && (
        <div className="modal-back" role="presentation" onClick={() => setGuide(null)}>
          <div className="modal guide-card" role="dialog" aria-modal="true" aria-label="去商店換著色頁" data-testid="locked-guide" onClick={(e) => e.stopPropagation()}>
            <div className="guide-thumb" aria-hidden>
              <PageThumb pageId={guide.id} className="shop-thumb" />
              <span className="guide-lock"><Icon name="ui-lock" emoji="🔒" size={44} /></span>
            </div>
            <h2>{guide.name}</h2>
            <p className="guide-price"><Icon name="ui-star" emoji="⭐" size={40} /> <b>{guide.price}</b></p>
            <p className="lead">用星星在商店換，就能畫囉！</p>
            <button className="btn primary guide-go" onClick={() => (onShop ?? onBack)()} data-testid="guide-go-shop">
              <Icon name="ui-shop" emoji="🛒" size={44} /> 去商店
            </button>
            <button className="btn" onClick={() => setGuide(null)} data-testid="guide-close">再看看</button>
          </div>
        </div>
      )}
    </main>
  )
}

const TOOLS: { id: PaintTool; label: string; icon: string }[] = [
  { id: 'fill', label: '填色', icon: '🪣' },
  { id: 'brush', label: '筆刷', icon: '🖌️' },
  { id: 'sticker', label: '貼紙', icon: '⭐' },
  { id: 'eraser', label: '橡皮擦', icon: '🧽' },
]
const SIZE_LABEL: Record<BrushSize, string> = { s: '細', m: '中', l: '粗' }
/** 場景按鈕上的小預覽（純 CSS） */
const SCENE_CSS: Record<string, string> = {
  white: '#ffffff',
  meadow: 'linear-gradient(#8fd3ff 0 55%, #8fd05a 55%)',
  sea: 'linear-gradient(#7fd8f0, #1f5fa8)',
  night: 'linear-gradient(#161a4a, #5a4fa0)',
  grid: 'linear-gradient(rgba(80,130,200,.5) 1px, transparent 1px) 0 0 / 10px 10px, linear-gradient(90deg, rgba(80,130,200,.5) 1px, transparent 1px) 0 0 / 10px 10px, #fff',
}

export function ColoringPlayScreen({ pageId, onBack, go }: { pageId: string; onBack: () => void; go?: (s: Screen["name"] | Screen) => void }) {
  const page = getColoringPage(pageId)
  const free = isFreePage(pageId)
  const toast = useToast()
  const soundOn = useSoundOn()
  const { voiceOn } = useLearningSettings()
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const rasterIds = useRegionIds(page?.kind === 'raster' ? pageId : undefined)
  const [doc, setDoc] = useState<PaintDoc | null>(null)
  const [past, setPast] = useState<PaintDoc[]>([])
  const [tool, setTool] = useState<PaintTool>(free ? 'brush' : 'fill')
  const [color, setColor] = useState<string>(PALETTE_24[0])
  const [special, setSpecial] = useState<SpecialKind | null>(null)
  const [size, setSize] = useState<BrushSize>('m')
  const [kind, setKind] = useState<BrushKind>('pen')
  const [stamp, setStamp] = useState<string>(DEFAULT_STAMP)
  const [mirror, setMirror] = useState(false)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [selected, setSelected] = useState<string | null>(null)
  const [popped, setPopped] = useState<Ripple | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)
  const [done, setDone] = useState<{ galleryId: string; png: string; hung: boolean; frame?: FrameId; newFrames: FrameId[]; framesDone: number; counted: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dropApi = useRef<DropApi | null>(null)
  const docRef = useRef<PaintDoc>(emptyDoc())
  const gestureBefore = useRef<PaintDoc | null>(null)
  const popN = useRef(0)

  useEffect(() => {
    let alive = true
    void repo.getColoringDoc(pageId).then((d) => {
      if (!alive) return
      docRef.current = d
      setDoc(d)
      setPast([])
    })
    return () => {
      alive = false
    }
  }, [pageId])

  /** 正式變更：舊畫面進復原堆疊、存檔 */
  const commit = useCallback(
    (next: PaintDoc, before: PaintDoc = docRef.current) => {
      setPast((p) => pushUndo(p, before, UNDO_LIMIT))
      docRef.current = next
      setDoc(next)
      void repo.saveColoringDoc(pageId, next)
    },
    [pageId],
  )
  const live = (next: PaintDoc) => {
    docRef.current = next
    setDoc(next)
  }
  const rememberColor = (c: string) => {
    const next = pushRecent(recent, c)
    setRecent(next)
    saveRecent(next)
  }

  if ((!page && !free) || !doc) return null
  const d = doc

  const fillValue = special ? makeSpecialFill(special, color) : color
  const onFill = (regionId: string, at?: [number, number]) => {
    if (d.fills[regionId] === fillValue) return
    commit({ ...d, fills: { ...d.fills, [regionId]: fillValue } })
    popN.current += 1
    setPopped({ id: regionId, n: popN.current, at })
    playPop(soundOn)
    if (!special || special !== 'rainbow') rememberColor(color)
  }
  /** 空白畫紙：填色工具 = 換背景色 */
  const onFillBg = () => {
    const bg = bgWithColor(d.bg, color)
    if (d.bg === bg) return
    commit({ ...d, bg })
    playPop(soundOn)
    rememberColor(color)
  }
  const pickScene = (scene: string) => {
    if ((d.bg ?? 'white') === scene) return
    commit({ ...d, bg: scene === 'white' ? undefined : scene })
    playPop(soundOn)
  }
  const onClearRegion = (regionId: string) => {
    if (!(regionId in d.fills)) return
    const fills = { ...d.fills }
    delete fills[regionId]
    commit({ ...d, fills })
  }
  const onStrokes = (ss: ColoringStroke[]) => {
    commit({ ...d, strokes: [...d.strokes, ...ss] })
    if (ss[0]?.kind !== 'rainbow') rememberColor(ss[0].color)
  }

  /** 點一下托盤：自動偏移避開既有貼紙；拖進畫布放開：貼在放開的位置（at） */
  const addSticker = (art: string, at?: [number, number]) => {
    const spot = at ?? freeStickerSpot(d.stickers)
    const st: ColoringSticker = { id: newId(), art, x: spot[0], y: spot[1], scale: 1.2, rot: 0 }
    commit({ ...d, stickers: [...d.stickers, st] })
    setSelected(st.id)
    playChime(soundOn, [880, 1175])
  }
  const sel = d.stickers.find((s) => s.id === selected)
  const patchSel = (patch: Partial<ColoringSticker>) => {
    if (!sel) return
    commit({ ...d, stickers: d.stickers.map((s) => (s.id === sel.id ? { ...s, ...patch } : s)) })
  }
  const removeSel = () => {
    if (!sel) return
    commit({ ...d, stickers: d.stickers.filter((s) => s.id !== sel.id) })
    setSelected(null)
  }

  const undo = () => {
    const r = popUndo(past)
    if (!r) return
    setPast(r.past)
    docRef.current = r.doc
    setDoc(r.doc)
    setSelected(null)
    void repo.saveColoringDoc(pageId, r.doc)
  }

  /** 按「完成」：畫得太少（著色頁完成度 < 60%）先問「再畫一點好嗎？」；空白畫紙沒有完成度，不問 */
  const finish = () => {
    if (docIsEmpty(d)) return toast(free ? '先畫一點東西再按完成吧！' : '先畫一點顏色再按完成吧！', 'info')
    if (!free && pct < ASK_BELOW_PCT) {
      setAsk(true)
      sayText('再畫一點好嗎？', { enabled: voiceOn })
      return
    }
    void doFinish()
  }
  const doFinish = async () => {
    setAsk(false)
    setBusy(true)
    try {
      const png = await renderArtworkPng({ pageId, bg: d.bg, fills: d.fills, strokes: d.strokes, stickers: d.stickers }, stickerEmoji)
      const r = await repo.completeColoring(pageId, d, png, undefined, { counts: countsAsFinished(free, pct) })
      if (!r.ok) throw new Error(r.error)
      playChime(soundOn, r.newFrames.length ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047])
      setDone({ galleryId: r.galleryId, png, hung: false, frame: r.frame, newFrames: r.newFrames, framesDone: r.framesDone, counted: r.counted })
    } catch {
      toast('這張畫存不起來，再按一次試試看', 'warn')
    } finally {
      setBusy(false)
    }
  }
  const hang = async () => {
    if (!done) return
    const r = await repo.hangArtwork(done.galleryId)
    if (!r.ok) return toast(r.error, 'warn')
    setDone({ ...done, hung: true })
    toast('掛到房間了！到首頁「佈置」可以移動它', 'ok')
  }
  /** 空白畫紙：存進畫廊之後，清空這個欄位再畫一張新的 */
  const restart = async () => {
    await repo.resetFreeCanvas(pageId)
    const e = emptyDoc()
    docRef.current = e
    setDoc(e)
    setPast([])
    setSelected(null)
    setDone(null)
    setTool('brush')
  }

  const pickTool = (t: PaintTool) => {
    setTool(t)
    if (t === 'brush') sayText('選一支筆', { enabled: voiceOn })
    else if (t === 'eraser') sayText('擦掉不要的地方', { enabled: voiceOn })
    else if (t === 'fill' && free) sayText('換個背景吧', { enabled: voiceOn })
  }

  const ids = page?.kind === 'raster' ? (rasterIds ?? []) : (page?.regions.map((r) => r.id) ?? [])
  const pct = completionPercent(d.fills, ids)
  const swatch = (c: string, key: string) => (
    <button
      key={key}
      className={`swatch ${color === c && tool !== 'eraser' ? 'on' : ''}`}
      style={{ background: c }}
      aria-label={`顏色 ${c}`}
      aria-pressed={color === c}
      data-color={c}
      onClick={() => {
        setColor(c)
        if (tool === 'eraser') setTool(free ? 'brush' : 'fill')
      }}
    />
  )
  const title = free ? (pageName(pageId) ?? '空白畫紙') : (page?.name ?? '')

  return (
    <main className="screen paint theme-lavender" data-testid="paint-screen" data-page={pageId}>
      <ScreenHeader title={title} onBack={onBack} backLabel="← 著色本" right={<span className="autosave">自動儲存{free ? '' : ` · ${pct}%`}</span>} />
      <div className="pt-layout">
        <div className="pt-stage card">
          <PaintBoard
            key={pageId}
            pageId={pageId}
            doc={d}
            tool={tool}
            color={color}
            brushWidth={BRUSH_WIDTHS[size]}
            eraseWidth={ERASER_WIDTHS[size]}
            brushKind={kind}
            stamp={stamp}
            mirror={mirror}
            soundOn={soundOn}
            selected={selected}
            popped={popped}
            onFill={onFill}
            onFillBg={onFillBg}
            onClearRegion={onClearRegion}
            onStrokes={onStrokes}
            onSelect={setSelected}
            onStickersLive={(stickers) => live({ ...docRef.current, stickers })}
            dropApi={dropApi}
            dragging={dragging}
            onGestureStart={() => {
              gestureBefore.current = docRef.current
            }}
            onGestureEnd={() => {
              const before = gestureBefore.current
              gestureBefore.current = null
              if (!before) return
              const now = docRef.current
              if (JSON.stringify(before.stickers) === JSON.stringify(now.stickers)) return
              setPast((p) => pushUndo(p, before, UNDO_LIMIT))
              void repo.saveColoringDoc(pageId, now)
            }}
          />
        </div>

        <div className="pt-panel card" role="toolbar" aria-label="著色工具">
          <div className="pt-tools">
            {TOOLS.map((t) => (
              <button key={t.id} className={`pt-tool ${tool === t.id ? 'on' : ''}`} aria-pressed={tool === t.id} onClick={() => pickTool(t.id)} data-testid={`tool-${t.id}`}>
                <span className="pt-tool-ico" aria-hidden>{t.icon}</span>
                <span>{free && t.id === 'fill' ? '背景' : t.label}</span>
              </button>
            ))}
          </div>

          <div className="pt-body" data-testid="pt-body">
          {tool === 'fill' && !free && (
            <div className="pt-opts" data-testid="opts-fill">
              <button className={`pt-chip ${special === null ? 'on' : ''}`} onClick={() => setSpecial(null)} data-testid="special-none">純色</button>
              {SPECIAL_KINDS.map((k) => (
                <button key={k.kind} className={`pt-chip special-${k.kind} ${special === k.kind ? 'on' : ''}`} onClick={() => setSpecial(k.kind)} data-testid={`special-${k.kind}`}>
                  {k.label}
                </button>
              ))}
            </div>
          )}
          {tool === 'fill' && free && (
            <div className="pt-opts pb-scenes" data-testid="opts-bg">
              {BG_SCENES.map((b) => (
                <button
                  key={b.scene}
                  className={`pt-chip pb-scene ${(d.bg ?? 'white') === b.scene ? 'on' : ''}`}
                  onClick={() => pickScene(b.scene)}
                  aria-pressed={(d.bg ?? 'white') === b.scene}
                  data-testid={`bg-${b.scene}`}
                >
                  <i style={{ background: SCENE_CSS[b.scene] }} />
                  {b.label}
                </button>
              ))}
            </div>
          )}
          {tool === 'brush' && (
            <div className="pt-opts pb-brush-opts" data-testid="opts-brush">
              <div className="pb-group" role="group" aria-label="筆刷種類">
                {BRUSH_KINDS.map((k) => (
                  <button
                    key={k.kind}
                    className={`pb-kind ${kind === k.kind ? 'on' : ''}`}
                    onClick={() => setKind(k.kind)}
                    aria-pressed={kind === k.kind}
                    aria-label={k.label}
                    data-testid={`bk-${k.kind}`}
                  >
                    <BrushPreview kind={k.kind} color={color} stamp={stamp} />
                    <span>{k.label}</span>
                  </button>
                ))}
              </div>
              {/* 印章圖案：選了印章筆才出現（「最近用過」那列才是會跳的元凶，已固定） */}
              {(
                <div className={`pb-group pb-stamps ${kind === 'stamp' ? '' : 'pb-off'}`} role="group" aria-label="印章圖案" data-testid="stamp-picks" aria-hidden={kind !== 'stamp'}>
                  {STAMPS.map((st) => (
                    <button key={st.key} className={`pb-stamp ${stamp === st.key ? 'on' : ''}`} onClick={() => setStamp(st.key)} aria-pressed={stamp === st.key} aria-label={st.label} data-testid={`stamp-${st.key}`}>
                      <StampShape stamp={st.key} color={color} />
                    </button>
                  ))}
                </div>
              )}
              <div className="pb-group">
                {(Object.keys(BRUSH_WIDTHS) as BrushSize[]).map((k) => (
                  <button key={k} className={`pt-chip size ${size === k ? 'on' : ''}`} onClick={() => setSize(k)} aria-pressed={size === k} data-testid={`brush-${k}`}>
                    <i style={{ width: BRUSH_WIDTHS[k] * 0.9 + 4, height: BRUSH_WIDTHS[k] * 0.9 + 4, background: color }} />
                    {SIZE_LABEL[k]}
                  </button>
                ))}
                <button className={`pt-chip pb-mirror ${mirror ? 'on' : ''}`} onClick={() => setMirror((m) => !m)} aria-pressed={mirror} data-testid="mirror-toggle">
                  <span aria-hidden>🦋</span> 鏡像
                </button>
              </div>
            </div>
          )}
          {tool === 'eraser' && (
            <div className="pt-opts pb-eraser" data-testid="opts-eraser">
              <div className="pb-erase-hint" role="img" aria-label={free ? '在筆刷線上滑過去，就擦掉一點' : '點一下色塊，顏色就消失；在筆刷線上滑過去，就擦掉一點'}>
                {!free && (
                  <span className="pb-eh">
                    <b>👆</b>
                    <i className="pb-eh-color" style={{ background: color }} />
                    <em>→</em>
                    <i className="pb-eh-blank" />
                  </span>
                )}
                <span className="pb-eh">
                  <b>🧽</b>
                  <svg viewBox="0 0 60 24" width="60" height="24" aria-hidden>
                    <path d="M3 12Q15 2 28 12T55 12" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />
                    <path d="M26 4V20" stroke="#fff" strokeWidth="9" strokeLinecap="round" opacity="0.95" />
                  </svg>
                </span>
              </div>
              <div className="pb-group">
                {(Object.keys(ERASER_WIDTHS) as BrushSize[]).map((k) => (
                  <button key={k} className={`pt-chip size ${size === k ? 'on' : ''}`} onClick={() => setSize(k)} aria-pressed={size === k} data-testid={`erase-${k}`}>
                    <i style={{ width: ERASER_WIDTHS[k] * 0.55 + 4, height: ERASER_WIDTHS[k] * 0.55 + 4, background: '#fff' }} />
                    {SIZE_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {tool === 'sticker' && (
            <StickerTray dropApi={dropApi} onTap={(art) => addSticker(art)} onDrop={(art, at) => addSticker(art, at)} onDragChange={setDragging} />
          )}
          {tool === 'sticker' && (
            <div className="pt-opts sticker-ctl" data-testid="sticker-controls">
              <button className="pt-chip" disabled={!sel} onClick={() => patchSel({ scale: Math.min(3, (sel?.scale ?? 1) * 1.2) })} aria-label="放大">＋</button>
              <button className="pt-chip" disabled={!sel} onClick={() => patchSel({ scale: Math.max(0.4, (sel?.scale ?? 1) / 1.2) })} aria-label="縮小">－</button>
              <button className="pt-chip" disabled={!sel} onClick={() => patchSel({ rot: (sel?.rot ?? 0) - 15 })} aria-label="向左轉">⟲</button>
              <button className="pt-chip" disabled={!sel} onClick={() => patchSel({ rot: (sel?.rot ?? 0) + 15 })} aria-label="向右轉">⟳</button>
              <button className="pt-chip danger" disabled={!sel} onClick={removeSel} aria-label="刪除貼紙" data-testid="sticker-delete">刪掉</button>
            </div>
          )}

          {tool !== 'sticker' && (
            <div className="pt-palette">
              {/* 「最近用過」永遠佔一列（空的時候是 6 個空圈），第一次用色不會把下面的色票往下推 */}
              <div className="pt-recent" data-testid="recent-colors">
                <span className="pt-recent-label">最近用過</span>
                {recent.map((c) => swatch(c, `r-${c}`))}
                {Array.from({ length: Math.max(0, RECENT_MAX - recent.length) }, (_, i) => (
                  <i key={`e-${i}`} className="pb-recent-empty" aria-hidden />
                ))}
              </div>
              <div className="swatches pt-swatches" data-testid="palette">
                {PALETTE_24.map((c) => swatch(c, c))}
              </div>
            </div>
          )}

          </div>

          <div className="pt-actions">
            <button className="btn" onClick={undo} disabled={past.length === 0} data-testid="undo-btn" aria-label={`復原，還能復原 ${past.length} 步`}>
              ↶ 復原{past.length > 0 ? ` (${past.length})` : ''}
            </button>
            <button className="btn" onClick={() => setConfirmClear(true)} disabled={docIsEmpty(d)} data-testid="clear-btn">全部清除</button>
            <button className="btn primary pt-finish" onClick={finish} disabled={busy} data-testid="finish-btn">
              {busy ? '收好中…' : '✓ 完成'}
            </button>
          </div>
        </div>
      </div>

      {ask && (
        <Modal title="再畫一點好嗎？" onClose={() => setAsk(false)}>
          <p className="lead">還有很多地方沒有塗到喔。</p>
          <div className="row-actions pb-ask">
            <button className="btn primary pb-ask-btn" onClick={() => setAsk(false)} data-testid="finish-more">再畫一下</button>
            <button className="btn pb-ask-btn" onClick={() => void doFinish()} data-testid="finish-anyway">就這樣完成</button>
          </div>
        </Modal>
      )}

      {confirmClear && (
        <Modal title="要全部清除嗎？" onClose={() => setConfirmClear(false)}>
          <p className="lead">清除後，這張畫的顏色、筆刷和貼紙都會不見喔。（按「復原」可以救回來）</p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => setConfirmClear(false)}>不要，留著</button>
            <button
              className="btn danger"
              onClick={() => {
                commit(emptyDoc())
                setSelected(null)
                setConfirmClear(false)
              }}
            >
              清除
            </button>
          </div>
        </Modal>
      )}

      {done && (
        <FinishCelebration
          png={done.png}
          hung={done.hung}
          frame={done.frame}
          newFrames={done.newFrames}
          framesDone={done.framesDone}
          counted={done.counted}
          voiceOn={voiceOn}
          stage={pet?.stage ?? 'baby'}
          free={free}
          onHang={hang}
          onGallery={() => (go ? go('gallery') : onBack())}
          onKeep={() => setDone(null)}
          onRestart={restart}
          onBack={onBack}
        />
      )}
    </main>
  )
}

/** 完成慶祝：阿悟拿著畫說「好漂亮！」。累計到門檻會多一塊「解鎖新畫框！」 */
function FinishCelebration({ png, hung, frame, newFrames, framesDone, counted, voiceOn, stage, free, onHang, onGallery, onKeep, onRestart, onBack }: { png: string; hung: boolean; frame?: FrameId; newFrames: FrameId[]; framesDone: number; counted: boolean; voiceOn: boolean; stage: string; free: boolean; onHang: () => void; onGallery: () => void; onKeep: () => void; onRestart: () => void; onBack: () => void }) {
  const art = stage === 'egg' ? 'pet-egg' : `pet-${stage}-cheer`
  const confetti = useMemo(
    () => Array.from({ length: 28 }, (_, i) => ({ left: (i * 37) % 100, delay: (i % 7) * 0.18, dur: 2.6 + (i % 5) * 0.4, hue: (i * 47) % 360 })),
    [],
  )
  const unlocked = frameDef(newFrames.at(-1))
  const next = counted ? nextFrame(framesDone) : undefined
  useEffect(() => {
    if (unlocked) sayText(FRAME_UNLOCK_LINE, { enabled: voiceOn })
    // 只在剛完成時唸一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="fc-back" role="dialog" aria-modal="true" aria-label="完成了" data-testid="finish-celebration">
      <div className="fc-confetti" aria-hidden>
        {confetti.map((c, i) => (
          <i key={i} style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, background: `hsl(${c.hue} 85% 65%)` }} />
        ))}
      </div>
      <div className="fc-card">
        <h2 className="fc-title">完成了！</h2>
        <div className="fc-scene">
          <div className="fc-pet">
            <Icon name={art} emoji="🐵" alt="阿悟" size="100%" />
          </div>
          <div className="fc-bubble">好漂亮！</div>
          {frame ? (
            <div className="fc-art fc-art-framed" data-testid="fc-art-framed" data-frame={frame}>
              <GalleryFrameView png={png} frame={frame} />
            </div>
          ) : (
            <img className="fc-art" src={png} alt="完成的畫" />
          )}
        </div>
        {unlocked && (
          <div className="fr-unlock" data-testid="frame-unlock" data-frame={unlocked.id} role="status">
            <div className="fr-unlock-art">
              <GalleryFrameView png={png} frame={unlocked.id} />
            </div>
            <div className="fr-unlock-text">
              <h3 className="fr-unlock-title">解鎖新畫框！</h3>
              <span className="fr-unlock-name">{unlocked.name}</span>
            </div>
          </div>
        )}
        {!unlocked && next && (
          <p className="fr-next" data-testid="frame-next">
            再畫 {framesToGo(next.id, framesDone)} 幅，就能得到{next.name}
          </p>
        )}
        <div className="fc-actions">
          {hung ? (
            <span className="fc-hung" data-testid="hung-ok">已掛到房間 ✓</span>
          ) : (
            <button className="btn primary" onClick={onHang} data-testid="hang-btn">掛到房間</button>
          )}
          <button className="btn" onClick={onGallery} data-testid="to-gallery">看我的畫廊</button>
          <button className="btn" onClick={onKeep}>繼續畫</button>
          {free && <button className="btn" onClick={onRestart} data-testid="free-restart">再畫一張新的</button>}
          <button className="btn" onClick={onBack}>回著色本</button>
        </div>
      </div>
    </div>
  )
}
