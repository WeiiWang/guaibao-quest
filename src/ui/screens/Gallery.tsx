import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { FREE_PAGE_IDS, getColoringPage } from '../../art/coloring/pages'
import { Icon } from '../components/Icon'
import { artFileName, saveArtwork } from '../shareArt'
import { GALLERY_EMPTY_LINE } from '../../domain/paintReward'
import { say } from '../../learning/speech'
import type { ColoringProgress } from '../../domain/types'
import { FRAMES, FRAME_LOCKED_LINE, FRAME_PICK_LINE, framesToGo, isFrameId, isFrameUnlocked, nextFrame, type FrameId } from '../../domain/frames'
import { ScreenHeader } from '../components/Header'
import { GalleryFrameView } from '../components/GalleryFrame'
import { Modal } from '../components/Modal'
import { useToast } from '../hooks'
import { useLearningSettings } from '../learningHooks'
import { sayText } from '../../learning/speech'
import { playPop } from '../sounds'
import type { Screen } from '../App'
import './coloring.css'
import './coloring/i74.css'

const dateText = (ms?: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 我的畫廊：完成的著色作品。可以放大看、掛到房間、取下、刪除。 */
export function GalleryScreen({ onBack, go }: { onBack: () => void; go: (s: Screen["name"] | Screen) => void }) {
  const toast = useToast()
  const { voiceOn } = useLearningSettings()
  const soundOn = useLiveQuery(async () => (await db.settings.get('main'))?.soundOn !== false, [], true)
  const framesDone = useLiveQuery(() => repo.framesDone(), [], 0)
  const worksQ = useLiveQuery(() => repo.listGallery(), [])
  const works = worksQ ?? ([] as ColoringProgress[])
  const placements = useLiveQuery(() => db.placements.toArray(), [], [])
  const [view, setView] = useState<ColoringProgress | null>(null)
  const [confirmDel, setConfirmDel] = useState<ColoringProgress | null>(null)
  const pet = useLiveQuery(() => db.pets.get('pet'), [])

  // 彈窗裡的作品要跟著資料更新（換畫框後馬上看到），所以每次都從最新的清單找
  const cur = view ? (works.find((w) => w.pageId === view.pageId) ?? view) : null
  const [shaking, setShaking] = useState<string | null>(null)

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

  const pickFrame = async (w: ColoringProgress, id: FrameId | undefined) => {
    if (id && !isFrameUnlocked(id, framesDone)) {
      setShaking(id)
      window.setTimeout(() => setShaking((v) => (v === id ? null : v)), 520)
      sayText(FRAME_LOCKED_LINE, { enabled: voiceOn })
      return
    }
    const r = await repo.setArtworkFrame(gid(w), id)
    if (!r.ok) return toast(r.error, 'warn')
    playPop(soundOn)
  }
  const next = nextFrame(framesDone)

  /** v7.4 I2：存圖（分享面板，不支援就下載） */
  const savePng = async (w: ColoringProgress) => {
    if (!w.png) return
    const r = await saveArtwork(w.png, artFileName(w.createdAt, gid(w)), nameOf(w))
    if (r === 'shared') toast('分享好了！', 'ok')
    else if (r === 'downloaded') toast('存好了！在「下載」裡找得到', 'ok')
    else if (r === 'failed') toast('這張畫存不起來，再試一次看看', 'warn')
  }

  // v7.4 I2：還沒有畫的時候，阿悟說一句邀請的話（只在這個畫面第一次發現是空的時說）
  const empty = worksQ !== undefined && worksQ.length === 0
  useEffect(() => {
    if (empty) say('pet.gallery.empty', GALLERY_EMPTY_LINE, { enabled: voiceOn })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty])

  return (
    <main className="screen gallery theme-lavender" data-testid="gallery">
      <ScreenHeader title="我的畫廊" onBack={onBack} backLabel="← 著色本" />
      {empty && (
        <div className="i74-empty" data-testid="gallery-empty">
          <div className="i74-empty-pet" aria-hidden>
            <Icon name={pet?.stage === 'egg' ? 'pet-egg' : `pet-${pet?.stage ?? 'baby'}-happy`} emoji="🐵" alt="阿悟" size="100%" />
          </div>
          <p className="i74-empty-text">還沒有完成的畫。畫好一張，按「完成」就會放進來！</p>
          <button className="btn primary i74-empty-go" onClick={() => go({ name: 'paint', pageId: FREE_PAGE_IDS[0] })} data-testid="gallery-go-paint">
            <span aria-hidden>🎨</span> 去畫畫
          </button>
        </div>
      )}
      <ul className="gallery-grid">
        {works.map((w) => (
          <li key={w.pageId} className="card gallery-item" data-testid="gallery-item">
            <button className={`gallery-thumb ${isFrameId(w.frame) ? 'fr-framed' : ''}`} onClick={() => setView(w)} aria-label={`看大圖：${nameOf(w)}`}>
              {isFrameId(w.frame) ? <GalleryFrameView png={w.png} frame={w.frame} className="fr-thumb" /> : w.png ? <img src={w.png} alt={nameOf(w)} /> : <span>🖼️</span>}
              {hung(w) && <b className="gallery-badge">掛在房間</b>}
            </button>
            <div className="gallery-name">
              {nameOf(w)} <small>{dateText(w.createdAt)}</small>
            </div>
          </li>
        ))}
      </ul>
      {view && cur && (
        <Modal title={nameOf(cur)} onClose={() => setView(null)}>
          <div className="fr-big" data-testid="gallery-view">
            <GalleryFrameView png={cur.png} frame={cur.frame} className="fr-big-frame" />
          </div>
          <div className="fr-picker" data-testid="frame-picker" aria-label="畫框">
            <h3 className="fr-picker-title" onClick={() => sayText(FRAME_PICK_LINE, { enabled: voiceOn })}>畫框</h3>
            <div className="fr-row" role="group" aria-label="選畫框">
              <button className={`fr-opt ${!isFrameId(cur.frame) ? 'on' : ''}`} onClick={() => void pickFrame(cur, undefined)} aria-pressed={!isFrameId(cur.frame)} data-testid="frame-opt-plain">
                <span className="fr-opt-art"><GalleryFrameView png={cur.png} /></span>
                <span>簡單</span>
              </button>
              {FRAMES.map((f) => {
                const open = isFrameUnlocked(f.id, framesDone)
                return (
                  <button
                    key={f.id}
                    className={`fr-opt ${cur.frame === f.id ? 'on' : ''} ${open ? '' : 'locked'} ${shaking === f.id ? 'ux-shake' : ''}`}
                    onClick={() => void pickFrame(cur, f.id)}
                    aria-pressed={cur.frame === f.id}
                    aria-label={open ? f.name : `${f.name}，還沒解鎖，再畫完 ${framesToGo(f.id, framesDone)} 幅`}
                    data-testid={`frame-opt-${f.id}`}
                    data-locked={open ? '0' : '1'}
                  >
                    <span className="fr-opt-art"><GalleryFrameView png={cur.png} frame={f.id} /></span>
                    <span>{f.name}</span>
                    {!open && <span className="fr-opt-lock" aria-hidden>🔒</span>}
                    {!open && <span className="fr-opt-need">再 {framesToGo(f.id, framesDone)} 幅</span>}
                  </button>
                )
              })}
            </div>
            <p className="fr-progress" data-testid="frame-progress">{next ? `畫完 ${framesDone} 幅了，再畫 ${next.need - framesDone} 幅就能得到${next.name}` : `畫完 ${framesDone} 幅了，畫框都收集好了！`}</p>
          </div>
          <div className="row-actions">
            {hung(cur) ? (
              <button className="btn" onClick={() => unhang(cur)}>從房間取下</button>
            ) : (
              <button className="btn primary" onClick={() => hang(cur)} data-testid="hang-btn">掛到房間</button>
            )}
            <button className="btn" onClick={() => go({ name: 'home', edit: true })}>去佈置</button>
            <button className="btn" onClick={() => void savePng(cur)} data-testid="save-art">
              <span aria-hidden>💾</span> 存圖
            </button>
            <button className="btn danger" onClick={() => { setConfirmDel(cur); setView(null) }}>刪除</button>
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
