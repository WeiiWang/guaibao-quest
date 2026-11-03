import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { repo } from '../db/repo'
import { localDateStr } from '../domain/date'
import { CelebrateContext, ToastContext, useNow, type CelebrateInfo, type ToastFn, type ToastTone } from './hooks'
import { Celebration } from './components/Celebration'
import { Home } from './screens/Home'
import {
  AlbumScreen,
  BackdropPreview,
  BagScreen,
  Ceremony,
  ColoringListScreen,
  ColoringPlayScreen,
  CrashProbe,
  DotsPlayScreen,
  FriendsScreen,
  GalleryScreen,
  HatPreview,
  MapScreen,
  Onboarding,
  ParentArea,
  preloadCommonScreens,
  ShopScreen,
  StageScreen,
  TasksScreen,
  WorkshopScreen,
} from './lazyScreens'
import { isDotsPageId } from '../art/dots/dots'
import { LockScreen, PlayTimeWatcher } from './components/PlayTime'
import { ProfileGate } from '../profiles/ProfileGate'
import { profiles } from '../profiles/manager'
import type { ChildProfile } from '../profiles/registry'
import { parseBackdropHash } from './screens/backdropHash'
import { APP_THEME, Title } from './screens/Title'
import { Loading } from './components/Loading'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ScreenTransition, screenTransitionKey } from './components/ScreenTransition'
import { readTitleEnv, shouldShowTitle } from './titleGate'
import { requestPersistentStorage } from './persist'
import { appUpdate } from './updateController'
import { isCelebrating } from './celebrating'
import { RESTORED_FLAG } from './screens/parent/restoredFlag'
import { normSpecies, speciesOf, type Species } from '../domain/species'
import { setVoiceSpecies } from '../learning/speech'
import { playSound, setMusicEnabled, setMusicScene, setSfxEnabled } from '../learning/audioEngine'
import { musicSceneFor } from '../learning/musicScene'
import { learningSettingsOf } from '../learning/playtime'
import { useTodMode } from './pet/hooks'
import { SpeciesContext } from './species'
import './ux.css'
// v7.3 線 G：遊戲性與版面覆蓋規則，要在所有 adventure*.css 之後載入
import './screens/adventure/adventure-v73.css'

export type Screen =
  | { name: 'home'; edit?: boolean; wardrobe?: boolean }
  | { name: 'tasks' }
  | { name: 'shop'; tab?: 'food' | 'coloring' | 'hat' }
  | { name: 'bag' }
  | { name: 'coloring' }
  | { name: 'paint'; pageId: string }
  | { name: 'dots'; pageId: string }
  | { name: 'map' }
  | { name: 'workshop'; wish?: string }
  | { name: 'parent' }
  | { name: 'map' }
  | { name: 'stage'; chapterId: string; station: number; ceremony?: boolean }
  | { name: 'workshop'; wish?: string }
  | { name: 'gallery' }
  | { name: 'friends' }
  | { name: 'album' }
  | { name: 'hatpreview'; hat: string; species?: Species }
  | { name: 'backdrop'; hash: string }
  | { name: 'crash' }

/** 兒童端畫面中，時間到會被鎖住的（學習與餵食）；任務、著色、家長區不鎖 */
const LOCKABLE: Screen['name'][] = ['home', 'map', 'stage', 'workshop']

/** 網址 hash 直達畫面（#map、#workshop），開發與 e2e 用；首頁入口由首頁自己提供 */
function screenFromHash(): Screen {
  const h = typeof location === 'undefined' ? '' : location.hash.replace(/^#\/?/, '')
  if (h === 'map') return { name: 'map' }
  if (h === 'workshop') return { name: 'workshop' }
  if (h === 'gallery') return { name: 'gallery' }
  if (h === 'friends') return { name: 'friends' }
  if (h === 'album') return { name: 'album' }
  if (h.startsWith('hatpreview')) return { name: 'hatpreview', hat: `hat-${h.split('/')[1] ?? 'crown'}`, species: normSpecies(h.split('/')[2]) }
  if (h.startsWith('backdrop')) return { name: 'backdrop', hash: h }
  if (h === 'crash') return { name: 'crash' } // 開發與 e2e：驗證錯誤邊界
  return { name: 'home' }
}

export function App() {
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: ToastTone; id: number } | null>(null)
  const [celebration, setCelebration] = useState<CelebrateInfo | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const toast: ToastFn = useCallback((text, tone = 'info') => {
    window.clearTimeout(toastTimer.current)
    setToastMsg({ text, tone, id: Date.now() })
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2800)
  }, [])

  // v8 線 N：每次冷啟動先看開場畫面（e2e 與 hash 直達頁跳過，見 titleGate.ts）；按下開始之後才進 ProfileGate（PIN 設定 / 選孩子 / 首頁）
  // 從首頁套用新版本後的重新整理不算冷啟動：不再看一次開場，直接回到孩子的首頁
  const [titleOpen, setTitleOpen] = useState(() => shouldShowTitle(readTitleEnv()) && !appUpdate.resumeInfo())

  // 跳過開場直接回首頁時，狀態列顏色要自己換回其他畫面的米色（平常是開場畫面離開時換的）
  useEffect(() => {
    if (appUpdate.resumeInfo()) document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', APP_THEME)
  }, [])

  // 開場畫面開著 = 孩子還沒開始玩，是套用新版本的安全時機
  useEffect(() => appUpdate.setTitleOpen(titleOpen), [titleOpen])

  // 還原備份後頁面會重新載入：告訴家長完成了
  useEffect(() => {
    try {
      if (sessionStorage.getItem(RESTORED_FLAG)) {
        sessionStorage.removeItem(RESTORED_FLAG)
        toast('已從備份還原', 'ok')
      }
    } catch {
      /* 頂多少一句提示 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 開場到進首頁之前（PIN、選孩子、建立孩子）都放開場音樂；iOS 要等按下開始才出聲，所以這段就是實際聽得到的時候
  useEffect(() => {
    if (titleOpen) setMusicScene('title')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      <CelebrateContext.Provider value={setCelebration}>
        <ErrorBoundary where="app">
          {titleOpen ? (
            <Title
              onStart={() => {
                playSound('sparkle')
                setTitleOpen(false)
                requestPersistentStorage()
              }}
            />
          ) : (
            <ProfileGate>{(child) => <ChildApp key={child.id} child={child} />}</ProfileGate>
          )}
        </ErrorBoundary>
        <ScreenTransition screenKey={titleOpen ? 'title' : 'app'} />
      </CelebrateContext.Provider>
      {celebration && <Celebration info={celebration} onClose={() => setCelebration(null)} />}
      {toastMsg && (
        <div key={toastMsg.id} className={`toast ${toastMsg.tone}`} role="status">
          {toastMsg.text}
        </div>
      )}
    </ToastContext.Provider>
  )
}

/** 一個孩子的整個 App：資料庫已經切到他的檔案。資料是空的（重設之後）就走簡化 onboarding，不再問 PIN */
function ChildApp({ child }: { child: ChildProfile }) {
  const settings = useLiveQuery(async () => ({ value: await db.settings.get('main') }), [])
  // v7.5：這個孩子的寵物物種（舊存檔沒有 = 猴子）。回傳字串（不是物件），寵物資料常常更新時這裡不會跟著重畫整個 App
  const species = useLiveQuery(async () => speciesOf(await db.pets.get('pet')), [])
  // 語音挑檔在 render 時就設定：子元件 mount 時說的第一句也要用對的聲音
  setVoiceSpecies(species)
  if (!settings || !species) return <Loading />
  if (!settings.value?.onboarded) {
    return (
      <Suspense fallback={<Loading />}>
        <Onboarding
          withPin={false}
          defaultName={child.name}
          defaultAge={child.ageBand}
          onFinish={(i) => profiles.onboardExisting(child.id, { childName: i.childName, species: i.species, ageBand: i.ageBand })}
        />
      </Suspense>
    )
  }
  return (
    <SpeciesContext.Provider value={species}>
      <Main childName={settings.value.childName} childId={child.id} />
    </SpeciesContext.Provider>
  )
}

function Main({ childName, childId }: { childName: string; childId: string }) {
  const [screen, setScreen] = useState<Screen>(screenFromHash)
  const [locked, setLocked] = useState(false)
  const now = useNow()
  const today = localDateStr(now)
  const todMode = useTodMode()

  // v8 線 M：家長區的音效 / 音樂開關同步給音訊引擎（設定讀到之前不動，避免關著音樂的孩子先響一下）
  const audioPrefs = useLiveQuery(async () => {
    const s = await db.settings.get('main')
    return s ? learningSettingsOf(s) : null
  }, [])
  useEffect(() => {
    if (!audioPrefs) return
    setSfxEnabled(audioPrefs.soundOn)
    setMusicEnabled(audioPrefs.musicOn)
  }, [audioPrefs])

  useEffect(() => {
    // 商品資料就緒後，送新使用者免費著色頁（只送一次）
    void repo.seedShop().then(() => repo.grantFreeColoring()).then(() => repo.grantFreeRaster())
  }, [])

  // 當天（本地日期）第一次開啟 / 跨日時產生每日任務（idempotent）
  useEffect(() => {
    void repo.ensureDailyTasks(now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  // 更新不打斷：回到首頁（關卡、著色的進度都已經存好）才套用新版本；從背景回來時正停在首頁也算
  // 帶著任務回首頁（佈置模式、衣櫃）不算：孩子正要做事，重新整理會把模式弄丟
  const atPlainHome = screen.name === 'home' && !screen.edit && !screen.wardrobe
  const lastScreen = useRef(screen.name)
  useEffect(() => {
    const cameBack = screen.name === 'home' && lastScreen.current !== 'home'
    lastScreen.current = screen.name
    if (!atPlainHome) return
    const applyIfSafe = () => {
      if (!isCelebrating()) appUpdate.arrivedHome(childId)
    }
    if (cameBack) applyIfSafe()
    const onVisible = () => {
      if (document.visibilityState === 'visible') applyIfSafe()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [screen.name, atPlainHome, childId])

  // 首頁畫好、閒下來之後，先把孩子最常去的畫面載好，點下去才不會看到載入畫面
  useEffect(() => preloadCommonScreens(), [])

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

  // v8 線 M：背景音樂場景跟著畫面走（undefined = 維持目前那首；時間到被鎖住時安靜）
  const scene = musicSceneFor(screen, { locked, lockable: LOCKABLE, now, todMode })
  useEffect(() => {
    if (scene !== undefined) setMusicScene(scene)
  }, [scene])

  let body
  if (locked && LOCKABLE.includes(screen.name)) body = <LockScreen go={go} />
  else {
    switch (screen.name) {
      case 'home':
        body = <Home key={screen.edit ? 'edit' : screen.wardrobe ? 'wardrobe' : 'home'} childName={childName} go={go} now={now} initialEdit={screen.edit} initialWardrobe={screen.wardrobe} />
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
        body = <ColoringListScreen onBack={home} onOpen={(pageId) => go(isDotsPageId(pageId) ? { name: 'dots', pageId } : { name: 'paint', pageId })} onGallery={() => go('gallery')} onShop={() => go({ name: 'shop', tab: 'coloring' })} />
        break
      case 'paint':
        body = <ColoringPlayScreen pageId={screen.pageId} onBack={() => go('coloring')} go={go} />
        break
      case 'dots':
        body = <DotsPlayScreen key={screen.pageId} pageId={screen.pageId} onBack={() => go('coloring')} go={go} />
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
        body = <WorkshopScreen onBack={home} go={go} wish={screen.wish} />
        break
      case 'gallery':
        body = <GalleryScreen onBack={() => go('coloring')} go={go} />
        break
      case 'friends':
        body = <FriendsScreen onBack={home} />
        break
      case 'album':
        body = <AlbumScreen onBack={home} go={go} />
        break
      case 'hatpreview':
        body = <HatPreview hat={screen.hat} species={screen.species} />
        break
      case 'crash':
        body = <CrashProbe />
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
      <ErrorBoundary where={screen.name === 'parent' ? 'parent' : 'child'} resetKey={screen.name} onHome={home}>
        {/* 分塊載入的畫面還沒到時顯示品牌載入畫面（藍天 + 蛋，不閃白）；載入失敗由外面的錯誤邊界接 */}
        <Suspense fallback={<Loading />}>{body}</Suspense>
      </ErrorBoundary>
      <ScreenTransition screenKey={screenTransitionKey(screen)} />
    </>
  )
}

