import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { getColoringPage } from '../../art/coloring/pages'
import type { ColoringProgress } from '../../domain/types'
import { ScreenHeader } from '../components/Header'
import { Modal } from '../components/Modal'
import { useToast } from '../hooks'
import type { Screen } from '../App'
import './coloring.css'

const dateText = (ms?: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 我的畫廊：完成的著色作品。可以放大看、掛到房間、取下、刪除。 */
export function GalleryScreen({ onBack, go }: { onBack: () => void; go: (s: Screen["name"] | Screen) => void }) {
  const toast = useToast()
  const works = useLiveQuery(() => repo.listGallery(), [], [] as ColoringProgress[])
  const placements = useLiveQuery(() => db.placements.toArray(), [], [])
  const [view, setView] = useState<ColoringProgress | null>(null)
  const [confirmDel, setConfirmDel] = useState<ColoringProgress | null>(null)

  const gid = (w: ColoringProgress) => w.pageId.slice(2)
  const hung = (w: ColoringProgress) => placements.some((p) => p.itemId === `art-${gid(w)}`)
  const nameOf = (w: ColoringProgress) => getColoringPage(w.basePageId ?? '')?.name ?? '作品'

  const hang = async (w: ColoringProgress) => {
    const r = await repo.hangArtwork(gid(w))
    if (!r.ok) return toast(r.error, 'warn')
    toast(r.already ? '這幅畫已經掛在房間了' : '掛到房間了！到首頁「佈置」可以移動它', 'ok')
  }
  const unhang = async (w: ColoringProgress) => {
    await repo.unhangArtwork(gid(w))
    toast('已經從房間取下，到佈置模式可以再掛', 'info')
  }

  return (
    <main className="screen gallery theme-lavender" data-testid="gallery">
      <ScreenHeader title="我的畫廊" onBack={onBack} backLabel="← 著色本" />
      {works.length === 0 && <p className="empty">還沒有完成的畫。畫好一張，按「完成」就會放進來！</p>}
      <ul className="gallery-grid">
        {works.map((w) => (
          <li key={w.pageId} className="card gallery-item" data-testid="gallery-item">
            <button className="gallery-thumb" onClick={() => setView(w)} aria-label={`看大圖：${nameOf(w)}`}>
              {w.png ? <img src={w.png} alt={nameOf(w)} /> : <span>🖼️</span>}
              {hung(w) && <b className="gallery-badge">掛在房間</b>}
            </button>
            <div className="gallery-name">
              {nameOf(w)} <small>{dateText(w.createdAt)}</small>
            </div>
          </li>
        ))}
      </ul>
      {view && (
        <Modal title={nameOf(view)} onClose={() => setView(null)}>
          <div className="gallery-view">{view.png && <img src={view.png} alt={nameOf(view)} />}</div>
          <div className="row-actions">
            {hung(view) ? (
              <button className="btn" onClick={() => unhang(view)}>從房間取下</button>
            ) : (
              <button className="btn primary" onClick={() => hang(view)} data-testid="hang-btn">掛到房間</button>
            )}
            <button className="btn" onClick={() => go({ name: 'home', edit: true })}>去佈置</button>
            <button className="btn danger" onClick={() => { setConfirmDel(view); setView(null) }}>刪除</button>
          </div>
        </Modal>
      )}
      {confirmDel && (
        <Modal title="要刪除這幅畫嗎？" onClose={() => setConfirmDel(null)}>
          <p className="lead">刪除後，這幅畫和房間裡的畫框都會不見喔。</p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => setConfirmDel(null)}>不要，留著</button>
            <button
              className="btn danger"
              onClick={async () => {
                await repo.deleteGalleryWork(gid(confirmDel))
                setConfirmDel(null)
                toast('已刪除', 'info')
              }}
            >
              刪除
            </button>
          </div>
        </Modal>
      )}
    </main>
  )
}
