import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary, ErrorScreen } from './components/ErrorBoundary'
import { screenTransitionKey } from './components/ScreenTransition'
import {
  ERROR_LOG_KEY,
  ERROR_LOG_MAX,
  clearErrorLog,
  errorMessage,
  isChunkLoadError,
  readErrorLog,
  recordError,
  reloadOnceForChunkError,
} from './errorLog'
import { requestPersistentStorage } from './persist'
import { shouldShowTitle } from './titleGate'

// Icon 靠 useSyncExternalStore 探測圖檔，沒有 server snapshot，不能在 renderToStaticMarkup 裡畫；換成單純的 span
vi.mock('./components/Icon', () => ({ Icon: ({ alt }: { alt?: string }) => createElement('span', { 'data-icon': alt ?? '' }) }))

/** 最小的 Storage 假物件 */
function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  }
}

describe('開場畫面：要不要出現', () => {
  it('一般瀏覽器：每次冷啟動都出現（新安裝、老玩家一樣）', () => {
    expect(shouldShowTitle({ webdriver: false, testFlag: false, hash: '' })).toBe(true)
  })
  it('自動化瀏覽器（e2e）預設跳過', () => {
    expect(shouldShowTitle({ webdriver: true, testFlag: false, hash: '' })).toBe(false)
  })
  it('自動化瀏覽器設了 gq-title-test 才出現', () => {
    expect(shouldShowTitle({ webdriver: true, testFlag: true, hash: '' })).toBe(true)
  })
  it('hash 直達的開發頁（#hatpreview、#map…）不被擋，不論是不是自動化', () => {
    for (const hash of ['#hatpreview', '#hatpreview/crown/rabbit', '#/map', '#backdrop/x', '#crash']) {
      expect(shouldShowTitle({ webdriver: false, testFlag: false, hash })).toBe(false)
      expect(shouldShowTitle({ webdriver: true, testFlag: true, hash })).toBe(false)
    }
  })
  it('空的 hash（只有 # 或 #/）不算直達', () => {
    expect(shouldShowTitle({ webdriver: false, testFlag: false, hash: '#' })).toBe(true)
    expect(shouldShowTitle({ webdriver: false, testFlag: false, hash: '#/' })).toBe(true)
  })
})

describe('雲朵轉場：哪些畫面要播', () => {
  it('兒童端畫面用畫面名稱當識別', () => {
    expect(screenTransitionKey({ name: 'home' })).toBe('home')
    expect(screenTransitionKey({ name: 'map' })).toBe('map')
    expect(screenTransitionKey({ name: 'shop' })).toBe('shop')
  })
  it('家長區與開發預覽頁不播（null）', () => {
    expect(screenTransitionKey({ name: 'parent' })).toBeNull()
    expect(screenTransitionKey({ name: 'hatpreview' })).toBeNull()
    expect(screenTransitionKey({ name: 'backdrop' })).toBeNull()
  })
  it('關卡換下一站、進結算典禮都算換畫面', () => {
    const a = screenTransitionKey({ name: 'stage', chapterId: 'c1', station: 1 })
    const b = screenTransitionKey({ name: 'stage', chapterId: 'c1', station: 2 })
    const c = screenTransitionKey({ name: 'stage', chapterId: 'c1', station: 2, ceremony: true })
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('錯誤紀錄', () => {
  it('最近 5 筆，最新的在最後；超過會丟掉最舊的', () => {
    const st = fakeStorage()
    for (let i = 1; i <= 8; i++) recordError(new Error(`e${i}`), 'child', undefined, st, 1000 + i)
    const log = readErrorLog(st)
    expect(log).toHaveLength(ERROR_LOG_MAX)
    expect(log.map((e) => e.msg)).toEqual(['e4', 'e5', 'e6', 'e7', 'e8'])
    expect(log[4].t).toBe(1008)
    expect(log[0].where).toBe('child')
  })
  it('壞掉的內容讀成空陣列、不丟錯', () => {
    expect(readErrorLog(fakeStorage({ [ERROR_LOG_KEY]: '{not json' }))).toEqual([])
    expect(readErrorLog(fakeStorage({ [ERROR_LOG_KEY]: '{"a":1}' }))).toEqual([])
    expect(readErrorLog(fakeStorage({ [ERROR_LOG_KEY]: JSON.stringify([{ nope: 1 }, { t: 1, msg: 'ok' }]) }))).toEqual([{ t: 1, msg: 'ok' }])
    expect(readErrorLog(null)).toEqual([])
  })
  it('寫不進去（容量滿、無痕）也不丟錯', () => {
    const st = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => undefined }
    expect(() => recordError(new Error('x'), 'app', undefined, st)).not.toThrow()
  })
  it('非 Error 的丟出物也能記', () => {
    expect(errorMessage('字串')).toBe('字串')
    expect(errorMessage({ a: 1 })).toBe('{"a":1}')
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })
  it('清除', () => {
    const st = fakeStorage()
    recordError(new Error('x'), 'app', undefined, st)
    clearErrorLog(st)
    expect(readErrorLog(st)).toEqual([])
  })
})

describe('動態載入失敗（新版部署後舊 chunk 找不到）', () => {
  it('辨識各瀏覽器的訊息', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a-1.js'))).toBe(true) // Chrome
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true) // Firefox
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true) // Safari
    expect(isChunkLoadError(new Error('Loading chunk 12 failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
  it('重新整理一次；一分鐘內不會再整理（避免無限重整）', () => {
    const st = fakeStorage()
    const reload = vi.fn()
    expect(reloadOnceForChunkError(reload, st, 1_000_000)).toBe(true)
    expect(reloadOnceForChunkError(reload, st, 1_030_000)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reloadOnceForChunkError(reload, st, 1_000_000 + 61_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})

describe('ErrorBoundary', () => {
  beforeEach(() => {
    const st = fakeStorage()
    vi.stubGlobal('localStorage', st)
    vi.stubGlobal('sessionStorage', fakeStorage())
    vi.stubGlobal('location', { reload: vi.fn(), replace: vi.fn(), hash: '' })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('正常時直接顯示 children', () => {
    const html = renderToStaticMarkup(createElement(ErrorBoundary, null, createElement('p', { id: 'ok' }, 'hi')))
    expect(html).toContain('id="ok"')
    expect(html).not.toContain('error-screen')
  })

  it('子元件丟錯：getDerivedStateFromError 進入錯誤狀態，畫面有寵物、溫柔的話、回首頁與重新整理', () => {
    const state = ErrorBoundary.getDerivedStateFromError(new Error('boom'))
    expect(state.error?.message).toBe('boom')
    const b = new ErrorBoundary({ children: null })
    b.state = state
    const html = renderToStaticMarkup(b.render() as never)
    expect(html).toContain('data-testid="error-screen"')
    expect(html).toContain('回首頁')
    expect(html).toContain('重新整理')
    expect(html).toContain('暈暈')
  })

  it('componentDidCatch 記一筆到 localStorage', () => {
    const b = new ErrorBoundary({ children: null, where: 'child' })
    b.componentDidCatch(new Error('壞掉了'), { componentStack: '\n    at Foo' })
    const log = readErrorLog()
    expect(log).toHaveLength(1)
    expect(log[0].msg).toBe('壞掉了')
    expect(log[0].where).toBe('child')
    expect(log[0].stack).toContain('at Foo')
  })

  it('動態載入失敗：記錄之後自動重新整理一次', () => {
    const b = new ErrorBoundary({ children: null })
    b.componentDidCatch(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'), { componentStack: '' })
    expect(location.reload).toHaveBeenCalledTimes(1)
    b.componentDidCatch(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'), { componentStack: '' })
    expect(location.reload).toHaveBeenCalledTimes(1) // 一分鐘內不再整理
  })

  it('一般錯誤不會自動重新整理', () => {
    const b = new ErrorBoundary({ children: null })
    b.componentDidCatch(new Error('普通錯誤'), { componentStack: '' })
    expect(location.reload).not.toHaveBeenCalled()
  })

  it('ErrorScreen 單獨可以畫（不需要資料庫或其他 Provider）', () => {
    const html = renderToStaticMarkup(createElement(ErrorScreen, { onHome: () => undefined, onReload: () => undefined }))
    expect(html).toContain('data-testid="error-home"')
    expect(html).toContain('data-testid="error-reload"')
  })
})

describe('持久儲存', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('有 API 時呼叫 persist', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: { persist, persisted: vi.fn().mockResolvedValue(false) } })
    requestPersistentStorage()
    await new Promise((r) => setTimeout(r, 0))
    expect(persist).toHaveBeenCalledTimes(1)
  })
  it('已經是持久的就不再要', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: { persist, persisted: vi.fn().mockResolvedValue(true) } })
    requestPersistentStorage()
    await new Promise((r) => setTimeout(r, 0))
    expect(persist).not.toHaveBeenCalled()
  })
  it('舊瀏覽器沒有 navigator.storage：什麼都不做、不丟錯', () => {
    vi.stubGlobal('navigator', {})
    expect(() => requestPersistentStorage()).not.toThrow()
  })
  it('persist 丟錯 / reject 也吞掉', async () => {
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.reject(new Error('no')), persisted: () => Promise.reject(new Error('no')) } })
    expect(() => requestPersistentStorage()).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })
})
