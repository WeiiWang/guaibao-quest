import { createElement, lazy, useState, type ComponentType } from 'react'

/**
 * 分塊載入的畫面。首頁、開場、選孩子留在主 bundle；其他畫面第一次進去才載入。
 * 這些 chunk 都在 service worker 的 precache 裡（vite.config 的 globPatterns），所以離線也讀得到。
 * 載入失敗：先等一下重試一次（網路閃斷）；還是失敗就丟給錯誤邊界（ErrorBoundary：自動重新整理一次，不會白屏）。
 */

/** Vite 的預載失敗被 errorLog 的 vite:preloadError 接走時，import() 會回 undefined 而不是丟錯：轉成錯誤邊界認得的錯誤 */
const ensureLoaded = <T>(m: T): T => {
  if (m === undefined || m === null) throw new Error('ChunkLoadError: 動態載入的模組是空的')
  return m
}

/** 動態載入失敗時等一下再試一次 */
export function retryImport<T>(load: () => Promise<T>, waitMs = 400): Promise<T> {
  return load()
    .then(ensureLoaded)
    .catch(
      () =>
        new Promise<T>((resolve, reject) => {
          window.setTimeout(() => load().then(ensureLoaded).then(resolve, reject), waitMs)
        }),
    )
}

// 任何 props 的元件都可以；回傳型別會還原成原元件的 props
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>

/** 已經預先載好的畫面：掛上去時直接用真正的元件，畫面在同一幀切換，不會閃一下載入畫面（React.lazy 就算模組好了也要等一輪） */
const preloaders: (() => Promise<unknown>)[] = []

function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K, opts: { preload?: boolean } = {}): M[K] {
  let ready: AnyComponent | null = null
  const loadAndKeep = () =>
    retryImport(load).then((m) => {
      ready = m[name] as AnyComponent
      return { default: ready }
    })
  const Lazy = lazy(loadAndKeep)
  if (opts.preload) preloaders.push(() => loadAndKeep().catch(() => undefined))
  // 掛上去之後就固定用同一個元件（中途換掉會讓畫面重新掛載、丟掉狀態）
  return function LazyScreen(props: object) {
    const [Comp] = useState<AnyComponent>(() => ready ?? Lazy)
    return createElement(Comp, props)
  } as M[K]
}

const parent = () => import('./screens/parent/ParentArea')
const map = () => import('./screens/adventure/MapScreen')
const stage = () => import('./screens/adventure/StageScreen')
const ceremony = () => import('./screens/adventure/Ceremony')
const coloring = () => import('./screens/Coloring')
const shop = () => import('./screens/Shop')
const tasks = () => import('./screens/Tasks')
const bag = () => import('./screens/Bag')
const workshop = () => import('./screens/Workshop')

export const ParentArea = lazyNamed(parent, 'ParentArea', { preload: true })
export const MapScreen = lazyNamed(map, 'MapScreen', { preload: true })
export const StageScreen = lazyNamed(stage, 'StageScreen', { preload: true })
export const Ceremony = lazyNamed(ceremony, 'Ceremony', { preload: true })
export const ColoringListScreen = lazyNamed(coloring, 'ColoringListScreen', { preload: true })
export const ColoringPlayScreen = lazyNamed(coloring, 'ColoringPlayScreen', { preload: true })
export const ShopScreen = lazyNamed(shop, 'ShopScreen', { preload: true })
export const TasksScreen = lazyNamed(tasks, 'TasksScreen', { preload: true })
export const BagScreen = lazyNamed(bag, 'BagScreen', { preload: true })
export const WorkshopScreen = lazyNamed(workshop, 'WorkshopScreen', { preload: true })
export const DotsPlayScreen = lazyNamed(() => import('./screens/Dots'), 'DotsPlayScreen')
export const GalleryScreen = lazyNamed(() => import('./screens/Gallery'), 'GalleryScreen')
export const FriendsScreen = lazyNamed(() => import('./screens/Friends'), 'FriendsScreen')
export const AlbumScreen = lazyNamed(() => import('./screens/Album'), 'AlbumScreen')
export const HatPreview = lazyNamed(() => import('./screens/HatPreview'), 'HatPreview')
export const BackdropPreview = lazyNamed(() => import('./screens/BackdropPreview'), 'BackdropPreview')
export const CrashProbe = lazyNamed(() => import('./screens/CrashProbe'), 'CrashProbe')
export const Onboarding = lazyNamed(() => import('./screens/Onboarding'), 'Onboarding')

/**
 * 閒下來時先載孩子最常去的畫面，第一次點進去才不會看到載入畫面。回傳取消函式（給 useEffect 清理）。
 * 載入失敗不用管：之後真的進畫面時 lazy 會再試。
 */
export function preloadCommonScreens(): () => void {
  const run = () => {
    for (const p of preloaders) void p()
  }
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 2000 })
    return () => cancelIdleCallback(id)
  }
  // Safari 沒有 requestIdleCallback
  const id = window.setTimeout(run, 800)
  return () => window.clearTimeout(id)
}
