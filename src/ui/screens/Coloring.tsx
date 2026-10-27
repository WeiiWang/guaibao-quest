import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo, newId } from '../../db/repo'
import { COLORING_PAGES } from '../../art/coloring/pages'
import { renderArtworkPng } from '../../art/coloring/export'
import {
  BRUSH_WIDTHS,
  completionPercent,
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
import type { ColoringSticker, ColoringStroke } from '../../domain/types'
import { ColoringSvg } from '../components/ColoringThumb'
import { ScreenHeader } from '../components/Header'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { useToast } from '../hooks'
import { useLearningSettings } from '../learningHooks'
import { speak } from '../../learning/speech'
import { SHOP_ITEMS } from '../../domain/constants'
import { playChime, playPop } from '../sounds'
import { PaintBoard, type PaintTool } from './coloring/PaintBoard'
import { STICKERS, stickerEmoji } from './coloring/stickers'
import type { Screen } from '../App'
import './coloring.css'

/** 舊名稱：12 色（v2）。新版色盤見 domain/coloring.ts 的 PALETTE_24 */
export const COLORING_PALETTE = PALETTE_24.slice(0, 12)

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

export function ColoringListScreen({ onBack, onOpen, onGallery, onShop }: { onBack: () => void; onOpen: (pageId: string) => void; onGallery?: () => void; onShop?: () => void }) {
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])
  const progress = useLiveQuery(() => db.coloring.toArray(), [], [])
  const { voiceOn } = useLearningSettings()
  const [guide, setGuide] = useState<{ id: string; name: string; price: number } | null>(null)
  const [shaking, setShaking] = useState<string | null>(null)
  const galleryCount = progress.filter((p) => p.pageId.startsWith('g:')).length
  const unlocked = new Set(inventory.filter((v) => v.qty > 0).map((v) => v.itemId))
  // 已擁有的（含新手送的 2 張）排最前面，上鎖的接在後面
  const open = COLORING_PAGES.filter((p) => unlocked.has(`coloring-${p.id}`))
  const locked = COLORING_PAGES.filter((p) => !unlocked.has(`coloring-${p.id}`))
  const priceOf = (id: string) => SHOP_ITEMS.find((i) => i.id === `coloring-${id}`)?.price ?? 30

  // 點鎖頭：卡片晃一下 + 語音說明 + 大大的「去商店」按鈕（不識字的小孩不會卡在死路）
  const tapLocked = (id: string, name: string) => {
    const price = priceOf(id)
    setShaking(id)
    window.setTimeout(() => setShaking((v) => (v === id ? null : v)), 520)
    setGuide({ id, name, price })
    speak(`這張要用${price}顆星星，在商店換喔`, { enabled: voiceOn })
  }

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
      {open.length === 0 && <p className="empty">還沒有著色頁，到商店用點數買一張吧！</p>}
      <ul className="shop-grid">
        {open.map((p) => {
          const pr = progress.find((x) => x.pageId === p.id)
          const pct = completionPercent(pr?.fills, p.regions.map((r) => r.id))
          return (
            <li key={p.id} className="card shop-item art-card" data-testid={`page-${p.id}`}>
              <button className="thumb-btn" onClick={() => onOpen(p.id)} aria-label={`畫${p.name}`}>
                <ColoringSvg pageId={p.id} fills={pr?.fills} className="shop-thumb" />
              </button>
              <div className="shop-name">{p.name}</div>
              <div className="page-progress" role="img" aria-label={`完成度 ${pct}%`} data-pct={pct}>
                <i style={{ width: `${pct}%` }} />
                <span>{pct === 0 ? '還沒開始' : pct === 100 ? '全部填好了' : `${pct}%`}</span>
              </div>
            </li>
          )
        })}
        {locked.map((p) => (
          <li key={p.id} className={`card shop-item art-card locked ${shaking === p.id ? 'ux-shake' : ''}`} data-testid={`locked-${p.id}`}>
            <button className="thumb-locked locked-btn" onClick={() => tapLocked(p.id, p.name)} aria-label={`${p.name}還沒有，要用${priceOf(p.id)}顆星星換`}>
              <Icon name="ui-lock" emoji="🔒" size={56} />
            </button>
            <div className="shop-name">{p.name}</div>
            <div className="shop-price"><Icon name="ui-star" emoji="⭐" size={22} /> {priceOf(p.id)}</div>
          </li>
        ))}
      </ul>
      {guide && (
        <div className="modal-back" role="presentation" onClick={() => setGuide(null)}>
          <div className="modal guide-card" role="dialog" aria-modal="true" aria-label="去商店換著色頁" data-testid="locked-guide" onClick={(e) => e.stopPropagation()}>
            <div className="guide-thumb" aria-hidden>
              <ColoringSvg pageId={guide.id} className="shop-thumb" />
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

export function ColoringPlayScreen({ pageId, onBack, go }: { pageId: string; onBack: () => void; go?: (s: Screen["name"] | Screen) => void }) {
  const page = COLORING_PAGES.find((p) => p.id === pageId)
  const toast = useToast()
  const soundOn = useSoundOn()
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const [doc, setDoc] = useState<PaintDoc | null>(null)
  const [past, setPast] = useState<PaintDoc[]>([])
  const [tool, setTool] = useState<PaintTool>('fill')
  const [color, setColor] = useState<string>(PALETTE_24[0])
  const [special, setSpecial] = useState<SpecialKind | null>(null)
  const [size, setSize] = useState<BrushSize>('m')
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [selected, setSelected] = useState<string | null>(null)
  const [popped, setPopped] = useState<{ id: string; n: number } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ galleryId: string; png: string; hung: boolean } | null>(null)
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

  if (!page || !doc) return null
  const d = doc

  const fillValue = special ? makeSpecialFill(special, color) : color
  const onFill = (regionId: string) => {
    if (d.fills[regionId] === fillValue) return
    commit({ ...d, fills: { ...d.fills, [regionId]: fillValue } })
    popN.current += 1
    setPopped({ id: regionId, n: popN.current })
    playPop(soundOn)
    if (!special || special !== 'rainbow') rememberColor(color)
  }
  const onClearRegion = (regionId: string) => {
    if (!(regionId in d.fills)) return
    const fills = { ...d.fills }
    delete fills[regionId]
    commit({ ...d, fills })
  }
  const onStroke = (s: ColoringStroke) => {
    commit({ ...d, strokes: [...d.strokes, s] })
    rememberColor(s.color)
  }
  const onEraseStrokes = (ids: string[]) => {
    commit({ ...d, strokes: d.strokes.filter((s) => !ids.includes(s.id)) })
  }

  const addSticker = (art: string) => {
    const n = d.stickers.length
    const st: ColoringSticker = { id: newId(), art, x: 200 + ((n * 37) % 90) - 45, y: 200 + ((n * 53) % 90) - 45, scale: 1.2, rot: 0 }
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

  const finish = async () => {
    if (docIsEmpty(d)) return toast('先畫一點顏色再按完成吧！', 'info')
    setBusy(true)
    try {
      const png = await renderArtworkPng({ pageId, fills: d.fills, strokes: d.strokes, stickers: d.stickers }, stickerEmoji)
      const r = await repo.completeColoring(pageId, d, png)
      if (!r.ok) throw new Error(r.error)
      playChime(soundOn, [523, 659, 784, 1047])
      setDone({ galleryId: r.galleryId, png, hung: false })
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

  const pct = completionPercent(d.fills, page.regions.map((r) => r.id))
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
        if (tool === 'eraser') setTool('fill')
      }}
    />
  )

  return (
    <main className="screen paint theme-lavender" data-testid="paint-screen">
      <ScreenHeader title={page.name} onBack={onBack} backLabel="← 著色本" right={<span className="autosave">自動儲存 · {pct}%</span>} />
      <div className="pt-layout">
        <div className="pt-stage card">
          <PaintBoard
            pageId={pageId}
            doc={d}
            tool={tool}
            color={color}
            brushWidth={BRUSH_WIDTHS[size]}
            selected={selected}
            popped={popped}
            onFill={onFill}
            onClearRegion={onClearRegion}
            onStroke={onStroke}
            onEraseStrokes={onEraseStrokes}
            onSelect={setSelected}
            onStickersLive={(stickers) => live({ ...docRef.current, stickers })}
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
              <button key={t.id} className={`pt-tool ${tool === t.id ? 'on' : ''}`} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} data-testid={`tool-${t.id}`}>
                <span className="pt-tool-ico" aria-hidden>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="pt-body" data-testid="pt-body">
          {tool === 'fill' && (
            <div className="pt-opts" data-testid="opts-fill">
              <button className={`pt-chip ${special === null ? 'on' : ''}`} onClick={() => setSpecial(null)} data-testid="special-none">純色</button>
              {SPECIAL_KINDS.map((k) => (
                <button key={k.kind} className={`pt-chip special-${k.kind} ${special === k.kind ? 'on' : ''}`} onClick={() => setSpecial(k.kind)} data-testid={`special-${k.kind}`}>
                  {k.label}
                </button>
              ))}
            </div>
          )}
          {tool === 'brush' && (
            <div className="pt-opts" data-testid="opts-brush">
              {(Object.keys(BRUSH_WIDTHS) as BrushSize[]).map((k) => (
                <button key={k} className={`pt-chip size ${size === k ? 'on' : ''}`} onClick={() => setSize(k)} aria-pressed={size === k} data-testid={`brush-${k}`}>
                  <i style={{ width: BRUSH_WIDTHS[k] * 0.9 + 4, height: BRUSH_WIDTHS[k] * 0.9 + 4, background: color }} />
                  {SIZE_LABEL[k]}
                </button>
              ))}
            </div>
          )}
          {tool === 'eraser' && <p className="pt-hint">點填色的地方清掉顏色，或在筆刷線上滑過去擦掉。</p>}
          {tool === 'sticker' && (
            <div className="pt-stickers-tray" data-testid="sticker-tray">
              {STICKERS.map((s) => (
                <button key={s.art} className="pt-sticker-btn" onClick={() => addSticker(s.art)} aria-label={`貼上${s.label}`} data-testid={`add-sticker-${s.art}`}>
                  <Icon name={s.art} emoji={s.emoji} alt={s.label} size="100%" />
                </button>
              ))}
            </div>
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
              {recent.length > 0 && (
                <div className="pt-recent" data-testid="recent-colors">
                  <span className="pt-recent-label">最近用過</span>
                  {recent.map((c) => swatch(c, `r-${c}`))}
                </div>
              )}
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
          stage={pet?.stage ?? 'baby'}
          onHang={hang}
          onGallery={() => (go ? go('gallery') : onBack())}
          onKeep={() => setDone(null)}
          onBack={onBack}
        />
      )}
    </main>
  )
}

/** 完成慶祝：阿悟拿著畫說「好漂亮！」 */
function FinishCelebration({ png, hung, stage, onHang, onGallery, onKeep, onBack }: { png: string; hung: boolean; stage: string; onHang: () => void; onGallery: () => void; onKeep: () => void; onBack: () => void }) {
  const art = stage === 'egg' ? 'pet-egg' : `pet-${stage}-cheer`
  const confetti = useMemo(
    () => Array.from({ length: 28 }, (_, i) => ({ left: (i * 37) % 100, delay: (i % 7) * 0.18, dur: 2.6 + (i % 5) * 0.4, hue: (i * 47) % 360 })),
    [],
  )
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
          <img className="fc-art" src={png} alt="完成的畫" />
        </div>
        <div className="fc-actions">
          {hung ? (
            <span className="fc-hung" data-testid="hung-ok">已掛到房間 ✓</span>
          ) : (
            <button className="btn primary" onClick={onHang} data-testid="hang-btn">掛到房間</button>
          )}
          <button className="btn" onClick={onGallery} data-testid="to-gallery">看我的畫廊</button>
          <button className="btn" onClick={onKeep}>繼續畫</button>
          <button className="btn" onClick={onBack}>回著色本</button>
        </div>
      </div>
    </div>
  )
}

