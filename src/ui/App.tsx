import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { repo } from '../db/repo'
import { localDateStr } from '../domain/date'
import { CelebrateContext, ToastContext, useNow, type CelebrateInfo, type ToastFn, type ToastTone } from './hooks'
import { Celebration } from './components/Celebration'
import { Onboarding } from './screens/Onboarding'
import { Home } from './screens/Home'
import { TasksScreen } from './screens/Tasks'
import { ShopScreen } from './screens/Shop'
import { BagScreen } from './screens/Bag'
import { ColoringListScreen, ColoringPlayScreen } from './screens/Coloring'
import { ParentArea } from './screens/parent/ParentArea'
import { MapScreen } from './screens/adventure/MapScreen'
import { StageScreen } from './screens/adventure/StageScreen'
import { Ceremony } from './screens/adventure/Ceremony'
import { WorkshopScreen } from './screens/Workshop'
import { LockScreen, PlayTimeWatcher } from './components/PlayTime'
import { BackdropPreview, parseBackdropHash } from './screens/BackdropPreview'
import { GalleryScreen } from './screens/Gallery'
import './ux.css'

export type Screen =
  | { name: 'home'; edit?: boolean }
  | { name: 'tasks' }
  | { name: 'shop'; tab?: 'food' | 'coloring' }
  | { name: 'bag' }
  | { name: 'coloring' }
  | { name: 'paint'; pageId: string }
  | { name: 'map' }
  | { name: 'workshop' }
  | { name: 'parent' }
  | { name: 'map' }
  | { name: 'stage'; chapterId: string; station: number; ceremony?: boolean }
  | { name: 'workshop' }
  | { name: 'gallery' }
  | { name: 'backdrop'; hash: string }

/** 兒童端畫面中，時間到會被鎖住的（學習與餵食）；任務、著色、家長區不鎖 */
const LOCKABLE: Screen['name'][] = ['home', 'map', 'stage', 'workshop']

/** 網址 hash 直達畫面（#map、#workshop），開發與 e2e 用；首頁入口由首頁自己提供 */
function screenFromHash(): Screen {
  const h = typeof location === 'undefined' ? '' : location.hash.replace(/^#\/?/, '')
  if (h === 'map') return { name: 'map' }
  if (h === 'workshop') return { name: 'workshop' }
  if (h === 'gallery') return { name: 'gallery' }
  if (h.startsWith('backdrop')) return { name: 'backdrop', hash: h }
  return { name: 'home' }
}

export function App() {
  const settings = useLiveQuery(async () => ({ value: await db.settings.get('main') }), [])
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: ToastTone; id: number } | null>(null)
  const [celebration, setCelebration] = useState<CelebrateInfo | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const toast: ToastFn = useCallback((text, tone = 'info') => {
    window.clearTimeout(toastTimer.current)
    setToastMsg({ text, tone, id: Date.now() })
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2800)
  }, [])

  let body
  if (!settings) body = <div className="splash">載入中…</div>
  else if (!settings.value?.onboarded) body = <Onboarding />
  else body = <Main childName={settings.value.childName} />

  return (
    <ToastContext.Provider value={toast}>
      <CelebrateContext.Provider value={setCelebration}>{body}</CelebrateContext.Provider>
      {celebration && <Celebration info={celebration} onClose={() => setCelebration(null)} />}
      {toastMsg && (
        <div key={toastMsg.id} className={`toast ${toastMsg.tone}`} role="status">
          {toastMsg.text}
        </div>
      )}
    </ToastContext.Provider>
  )
}

function Main({ childName }: { childName: string }) {
  const [screen, setScreen] = useState<Screen>(screenFromHash)
  const [locked, setLocked] = useState(false)
  const now = useNow()
  const today = localDateStr(now)

  useEffect(() => {
    // 商品資料就緒後，送新使用者免費著色頁（只送一次）
    void repo.seedShop().then(() => repo.grantFreeColoring())
  }, [])

  // 當天（本地日期）第一次開啟 / 跨日時產生每日任務（idempotent）
  useEffect(() => {
    void repo.ensureDailyTasks(now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  useEffect(() => {
    const onHash = () => setScreen(screenFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (s: Screen['name'] | Screen) => {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search)
    setScreen(typeof s === 'string' ? ({ name: s } as Screen) : s)
  }
  const home = () => go('home')

  let body
  if (locked && LOCKABLE.includes(screen.name)) body = <LockScreen go={go} />
  else {
    switch (screen.name) {
      case 'home':
        body = <Home key={screen.edit ? 'edit' : 'home'} childName={childName} go={go} now={now} initialEdit={screen.edit} />
        break
      case 'tasks':
        body = <TasksScreen onBack={home} now={now} />
        break
      case 'shop':
        body = <ShopScreen onBack={home} initialTab={screen.tab} />
        break
      case 'bag':
        body = <BagScreen onBack={home} go={go} />
        break
      case 'coloring':
        body = <ColoringListScreen onBack={home} onOpen={(pageId) => go({ name: 'paint', pageId })} onGallery={() => go('gallery')} onShop={() => go({ name: 'shop', tab: 'coloring' })} />
        break
      case 'paint':
        body = <ColoringPlayScreen pageId={screen.pageId} onBack={() => go('coloring')} go={go} />
        break
      case 'parent':
        body = <ParentArea onExit={home} />
        break
      case 'map':
        body = <MapScreen onBack={home} go={go} />
        break
      case 'stage':
        body = screen.ceremony ? (
          <Ceremony chapterId={screen.chapterId} onMap={() => go('map')} go={go} />
        ) : (
          <StageScreen
            key={`${screen.chapterId}-${screen.station}`}
            chapterId={screen.chapterId}
            station={screen.station}
            onExit={() => go('map')}
            onNextStation={(n) => go({ name: 'stage', chapterId: screen.chapterId, station: n })}
            onCeremony={() => go({ name: 'stage', chapterId: screen.chapterId, station: screen.station, ceremony: true })}
          />
        )
        break
      case 'workshop':
        body = <WorkshopScreen onBack={home} go={go} />
        break
      case 'gallery':
        body = <GalleryScreen onBack={() => go('coloring')} go={go} />
        break
      case 'backdrop': {
        const p = parseBackdropHash(screen.hash)
        body = p ? <BackdropPreview {...p} /> : null
        break
      }
    }
  }

  return (
    <>
      <PlayTimeWatcher counting={screen.name !== 'parent' && !locked} onLocked={setLocked} />
      {body}
    </>
  )
}

