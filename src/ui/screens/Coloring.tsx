import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { COLORING_PAGES } from '../../art/coloring/pages'
import { ColoringSvg } from '../components/ColoringThumb'
import { ScreenHeader } from '../components/Header'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'

export const COLORING_PALETTE = [
  '#e8a6a0', '#f0c18b', '#f1dd94', '#c9dc9a', '#b5d6a0', '#8fcfb7',
  '#9cc9e0', '#a9b3e3', '#c9aee0', '#e4aecb', '#b99a7c', '#9aa3a8',
]

export function ColoringListScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (pageId: string) => void }) {
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])
  const progress = useLiveQuery(() => db.coloring.toArray(), [], [])
  const unlocked = new Set(inventory.filter((v) => v.qty > 0).map((v) => v.itemId))
  const open = COLORING_PAGES.filter((p) => unlocked.has(`coloring-${p.id}`))
  const locked = COLORING_PAGES.filter((p) => !unlocked.has(`coloring-${p.id}`))

  return (
    <main className="screen theme-lavender">
      <ScreenHeader title="著色本" onBack={onBack} />
      {open.length === 0 && <p className="empty">還沒有著色頁，到商店用點數買一張吧！</p>}
      <ul className="shop-grid">
        {open.map((p) => (
          <li key={p.id} className="card shop-item art-card">
            <button className="thumb-btn" onClick={() => onOpen(p.id)} aria-label={`畫${p.name}`}>
              <ColoringSvg pageId={p.id} fills={progress.find((x) => x.pageId === p.id)?.fills} className="shop-thumb" />
            </button>
            <div className="shop-name">{p.name}</div>
          </li>
        ))}
        {locked.map((p) => (
          <li key={p.id} className="card shop-item art-card locked">
            <div className="thumb-locked" aria-hidden><Icon name="ui-lock" emoji="🔒" size={56} /></div>
            <div className="shop-name">{p.name}</div>
            <div className="shop-price">商店可購買</div>
          </li>
        ))}
      </ul>
    </main>
  )
}

export function ColoringPlayScreen({ pageId, onBack }: { pageId: string; onBack: () => void }) {
  const page = COLORING_PAGES.find((p) => p.id === pageId)
  const [fills, setFills] = useState<Record<string, string> | null>(null)
  const [color, setColor] = useState<string>(COLORING_PALETTE[0])
  const [eraser, setEraser] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const latest = useRef<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    void db.coloring.get(pageId).then((p) => {
      if (!alive) return
      latest.current = p?.fills ?? {}
      setFills(latest.current)
    })
    return () => {
      alive = false
    }
  }, [pageId])

  if (!page) return null

  const commit = (next: Record<string, string>) => {
    latest.current = next
    setFills(next)
    void repo.saveColoring(pageId, next) // 自動存
  }
  const paint = (regionId: string) => {
    if (!fills) return
    const next = { ...fills }
    if (eraser) delete next[regionId]
    else next[regionId] = color
    commit(next)
  }

  return (
    <main className="screen paint theme-lavender">
      <ScreenHeader title={page.name} onBack={onBack} backLabel="← 著色本" right={<span className="autosave">自動儲存</span>} />
      <div className="paint-layout">
        <div className="paint-canvas card">
          {fills && <ColoringSvg pageId={pageId} fills={fills} onRegion={paint} className="paint-svg" />}
        </div>
        <div className="palette card" role="toolbar" aria-label="色盤">
          <div className="swatches">
            {COLORING_PALETTE.map((c) => (
              <button
                key={c}
                className={`swatch ${!eraser && color === c ? 'on' : ''}`}
                style={{ background: c }}
                aria-label={`顏色 ${c}`}
                aria-pressed={!eraser && color === c}
                onClick={() => {
                  setColor(c)
                  setEraser(false)
                }}
              />
            ))}
          </div>
          <div className="palette-actions">
            <button className={`btn ${eraser ? 'primary' : ''}`} aria-pressed={eraser} onClick={() => setEraser((v) => !v)}>
              🧽 橡皮擦
            </button>
            <button className="btn" onClick={() => setConfirmClear(true)}>全部清除</button>
          </div>
        </div>
      </div>
      {confirmClear && (
        <Modal title="要全部清除嗎？" onClose={() => setConfirmClear(false)}>
          <p className="lead">清除後，這張畫的顏色都會不見喔。</p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => setConfirmClear(false)}>不要，留著</button>
            <button
              className="btn danger"
              onClick={() => {
                commit({})
                setConfirmClear(false)
              }}
            >
              清除
            </button>
          </div>
        </Modal>
      )}
    </main>
  )
}
