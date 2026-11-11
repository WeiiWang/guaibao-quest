import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __audioVisibilityForTest,
  __resetAudioEngineForTest,
  DUCK_RATIO,
  duckMusic,
  getAudioContext,
  getAudioState,
  MUSIC_SCENES,
  MUSIC_VOLUME,
  playSound,
  preloadSounds,
  setMusicEnabled,
  setMusicScene,
  setSfxEnabled,
  SOUND_NAMES,
  unlockAudio,
} from './audioEngine'

// ---------- 假的 Web Audio ----------
class FakeParam {
  value: number
  events: { type: string; v: number; t: number }[] = []
  constructor(v = 1) {
    this.value = v
  }
  setValueAtTime(v: number, t: number) {
    this.events.push({ type: 'set', v, t })
    this.value = v
    return this
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push({ type: 'ramp', v, t })
    this.value = v // 假的：直接當作到位，方便斷言目標值
    return this
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push({ type: 'expramp', v, t })
    return this
  }
  setTargetAtTime(v: number, t: number) {
    this.events.push({ type: 'target', v, t })
    return this
  }
  cancelScheduledValues(t: number) {
    this.events.push({ type: 'cancel', v: 0, t })
    return this
  }
}
class FakeNode {
  gain = new FakeParam()
  frequency = new FakeParam()
  connected: unknown[] = []
  connect(n: unknown) {
    this.connected.push(n)
    return n
  }
  disconnect() {
    this.connected = []
  }
}
class FakeSource extends FakeNode {
  buffer: unknown = null
  loop = false
  loopStart = 0
  loopEnd = 0
  started: { when: number; offset?: number } | null = null
  stopped: number | null = null
  onended: (() => void) | null = null
  start(when: number, offset?: number) {
    this.started = { when, offset }
  }
  stop(when: number) {
    this.stopped = when
  }
}
class FakeCtx {
  static instances: FakeCtx[] = []
  state = 'running'
  currentTime = 0
  destination = new FakeNode()
  sources: FakeSource[] = []
  oscillators = 0
  gains: FakeNode[] = []
  onstatechange: (() => void) | null = null
  decodeFail = false
  resumed = 0
  suspended = 0
  /** 模擬瀏覽器的自動播放限制：沒有使用者手勢時 resume() 不會真的啟動 */
  gesture = true
  constructor() {
    FakeCtx.instances.push(this)
  }
  createGain() {
    const g = new FakeNode()
    this.gains.push(g)
    return g
  }
  createBufferSource() {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }
  createOscillator() {
    this.oscillators++
    const o = new FakeNode() as FakeNode & { type: string; start(): void; stop(): void }
    o.type = 'sine'
    o.start = () => {}
    o.stop = () => {}
    return o
  }
  decodeAudioData(data: ArrayBuffer, ok?: (b: unknown) => void, fail?: (e: unknown) => void) {
    if (this.decodeFail) {
      const err = new Error('decode')
      fail?.(err)
      return Promise.reject(err)
    }
    const b = { length: data.byteLength, tag: 'buf' }
    ok?.(b)
    return Promise.resolve(b)
  }
  resume() {
    this.resumed++
    if (this.gesture) {
      this.state = 'running'
      this.onstatechange?.()
    }
    return Promise.resolve()
  }
  suspend() {
    this.suspended++
    this.state = 'suspended'
    this.onstatechange?.()
    return Promise.resolve()
  }
}

const MANIFEST = {
  version: 1,
  music: Object.fromEntries(
    ['title', 'home-day', 'home-night', 'map', 'stage', 'boss', 'ceremony', 'paint', 'playground', 'town'].map((s) => [s, { file: `music-${s}.m4a`, v: 'abc', loopStart: 0.37, loopEnd: 40.1 }]),
  ),
  sfx: Object.fromEntries(
    ['tap', 'pop', 'correct', 'wrong', 'reward', 'coin', 'whoosh', 'page', 'unlock', 'hatch', 'drop', 'sparkle', 'boing', 'splash', 'munch', 'cheer', 'fanfare', 'squeak'].map((s) => [s, { file: `sfx-${s}.m4a`, v: 'abc' }]),
  ),
}
/** v8.5 線 AF 的六個新音效 */
const NEW_SOUNDS = ['boing', 'splash', 'munch', 'cheer', 'fanfare', 'squeak'] as const

let fetched: string[] = []
function okFetch(url: string): Promise<Response> {
  fetched.push(url)
  if (url.endsWith('manifest.json')) return Promise.resolve(new Response(JSON.stringify(MANIFEST), { status: 200 }))
  return Promise.resolve(new Response(new ArrayBuffer(64), { status: 200 }))
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function setup(over: Partial<Parameters<typeof __resetAudioEngineForTest>[0]> = {}) {
  FakeCtx.instances = []
  fetched = []
  let now = 1000
  __resetAudioEngineForTest({
    createContext: () => new FakeCtx() as unknown as AudioContext,
    fetchFn: okFetch,
    baseUrl: '/gq/',
    loadingAllowed: () => true,
    nowMs: () => (now += 100),
    isHidden: () => false,
    ...over,
  })
  return () => FakeCtx.instances[0]
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('背景音樂：場景切換', () => {
  it('第一次設定場景才 fetch 清單與那一首（延遲載入），從 loopStart 開始、循環點設好', async () => {
    const ctx = setup()
    expect(fetched).toEqual([]) // 什麼都還沒要求，不載入
    setMusicScene('home-day')
    await flush()
    expect(fetched).toEqual(['/gq/audio/manifest.json', '/gq/audio/music-home-day.m4a?v=abc'])
    const src = ctx().sources[0]
    expect(src.loop).toBe(true)
    expect(src.loopStart).toBeCloseTo(0.37)
    expect(src.loopEnd).toBeCloseTo(40.1)
    expect(src.started?.offset).toBeCloseTo(0.37)
    expect(getAudioState().scene).toBe('home-day')
  })

  it('同一個場景重複設定不重播；換場景時舊的淡出（約 0.8 秒）、新的淡入', async () => {
    const ctx = setup()
    setMusicScene('map')
    await flush()
    setMusicScene('map')
    await flush()
    expect(ctx().sources).toHaveLength(1)
    ctx().currentTime = 5
    setMusicScene('stage')
    await flush()
    expect(ctx().sources).toHaveLength(2)
    const [oldSrc, newSrc] = ctx().sources
    expect(oldSrc.stopped).toBeGreaterThanOrEqual(5.8) // 5 + 0.8 淡出之後才停
    expect(oldSrc.stopped).toBeLessThan(6.2)
    const gainOf = (s: FakeSource) => s.connected[0] as FakeNode
    const lastOld = gainOf(oldSrc).gain.events.at(-1)
    expect(lastOld).toMatchObject({ type: 'ramp', v: 0 })
    expect(lastOld!.t).toBeCloseTo(5.8)
    const newRamp = gainOf(newSrc).gain.events.find((e) => e.type === 'ramp')
    expect(newRamp).toMatchObject({ v: 1 })
    expect(newRamp!.t).toBeCloseTo(5.8)
    expect(getAudioState().scene).toBe('stage')
  })

  it('setMusicScene(null) 淡出並停掉；之後設回同一個場景會重新開始', async () => {
    const ctx = setup()
    setMusicScene('boss')
    await flush()
    setMusicScene(null)
    expect(getAudioState().scene).toBeNull()
    expect(ctx().sources[0].stopped).not.toBeNull()
    setMusicScene('boss')
    await flush()
    expect(ctx().sources).toHaveLength(2)
    expect(getAudioState().scene).toBe('boss')
  })

  it('載入期間又換場景：只會播最後要的那一首', async () => {
    const ctx = setup()
    setMusicScene('title')
    setMusicScene('paint')
    await flush()
    expect(ctx().sources).toHaveLength(1)
    expect(getAudioState().scene).toBe('paint')
  })

  it('音樂開關：關掉就停、不載入；打開後從目前想要的場景重新開始', async () => {
    const ctx = setup()
    setMusicEnabled(false)
    setMusicScene('home-night')
    await flush()
    expect(fetched).toEqual([]) // 關著音樂：連檔案都不抓
    expect(getAudioState().scene).toBeNull()
    setMusicEnabled(true)
    await flush()
    expect(getAudioState().scene).toBe('home-night')
    setMusicEnabled(false)
    expect(getAudioState().scene).toBeNull()
    expect(ctx().sources[0].stopped).not.toBeNull()
  })

  it('AudioContext 還沒被手勢啟動（suspended）時不開始播，等 resume 之後才播', async () => {
    const ctx = setup()
    getAudioContext() // 先建立 context
    ctx().state = 'suspended'
    ctx().gesture = false
    setMusicScene('map')
    await flush()
    expect(ctx().sources).toHaveLength(0)
    ctx().gesture = true
    unlockAudio() // 使用者第一次觸碰
    await flush()
    expect(ctx().resumed).toBeGreaterThan(0)
    expect(getAudioState().scene).toBe('map')
  })

  it('頁面切到背景就暫停（suspend），回來恢復', async () => {
    const ctx = setup()
    setMusicScene('map')
    await flush()
    __audioVisibilityForTest(true)
    expect(ctx().suspended).toBe(1)
    expect(ctx().state).toBe('suspended')
    __audioVisibilityForTest(false)
    await flush()
    expect(ctx().state).toBe('running')
    expect(getAudioState().scene).toBe('map')
  })

  it('同時只留最近兩首解碼好的音樂（記憶體）', async () => {
    setup()
    for (const s of ['title', 'home-day', 'map', 'stage'] as const) {
      setMusicScene(s)
      await flush()
    }
    expect(getAudioState().loadedMusic).toEqual(['map', 'stage'])
  })

  it('v8.5：遊樂場與小街各有一首，互相切換時交叉淡入淡出，只抓自己那一首', async () => {
    const ctx = setup()
    setMusicScene('playground')
    await flush()
    expect(getAudioState().scene).toBe('playground')
    expect(fetched).toEqual(['/gq/audio/manifest.json', '/gq/audio/music-playground.m4a?v=abc'])
    const first = ctx().sources[0]
    expect(first.loop).toBe(true)
    expect(first.started?.offset).toBeCloseTo(0.37)
    setMusicScene('town')
    await flush()
    expect(getAudioState().scene).toBe('town')
    expect(fetched.at(-1)).toBe('/gq/audio/music-town.m4a?v=abc')
    expect(first.stopped).not.toBeNull() // 舊的排了停止（淡出後）
    expect(ctx().sources).toHaveLength(2)
    // 進小遊戲還是同一首：不重播
    setMusicScene('town')
    await flush()
    expect(ctx().sources).toHaveLength(2)
  })
})

describe('背景音樂：缺檔與失敗都不丟錯', () => {
  it('清單 404：安靜略過，不丟錯、也沒有聲音', async () => {
    const ctx = setup({ fetchFn: () => Promise.resolve(new Response('no', { status: 404 })) })
    expect(() => setMusicScene('home-day')).not.toThrow()
    await flush()
    expect(ctx().sources).toHaveLength(0)
    expect(getAudioState().scene).toBeNull()
  })

  it('網路錯誤（fetch reject）：安靜略過', async () => {
    const ctx = setup({ fetchFn: () => Promise.reject(new TypeError('offline')) })
    setMusicScene('map')
    await flush()
    expect(ctx().sources).toHaveLength(0)
  })

  it('清單裡沒有這個場景：安靜略過', async () => {
    const ctx = setup({
      fetchFn: (u) => (u.endsWith('manifest.json') ? Promise.resolve(new Response(JSON.stringify({ music: {}, sfx: {} }))) : okFetch(u)),
    })
    setMusicScene('boss')
    await flush()
    expect(ctx().sources).toHaveLength(0)
  })

  it('解碼失敗：安靜略過；這個檔案一分鐘內不再重試', async () => {
    const ctx = setup()
    getAudioContext()
    ctx().decodeFail = true
    setMusicScene('paint')
    await flush()
    expect(ctx().sources).toHaveLength(0)
    const n = fetched.filter((f) => f.includes('music-paint')).length
    setMusicScene('map')
    setMusicScene('paint')
    await flush()
    expect(fetched.filter((f) => f.includes('music-paint')).length).toBe(n)
  })

  it('不支援 WebAudio（建不出 AudioContext）：什麼都不做', async () => {
    setup({ createContext: () => null })
    expect(() => {
      setMusicScene('map')
      playSound('correct')
      duckMusic(true)
      unlockAudio()
    }).not.toThrow()
    await flush()
    expect(playSound('tap')).toBe(false)
  })
})

describe('自動化測試（webdriver）不載音檔', () => {
  it('loadingAllowed=false：不 fetch、不建音源；音效退回合成音', async () => {
    const ctx = setup({ loadingAllowed: () => false })
    setMusicScene('home-day')
    await flush()
    preloadSounds()
    await flush()
    expect(fetched).toEqual([])
    expect(ctx()?.sources ?? []).toHaveLength(0)
    expect(playSound('correct')).toBe(true) // 合成音 2 個振盪器，跟 v7 一樣
    expect(ctx().oscillators).toBe(2)
    expect(fetched).toEqual([])
  })
})

describe('音效', () => {
  it('舊的五種音效退回合成音時，振盪器數量和 v7 一樣（tap 1、correct 2、wrong 1、reward 4、pop 1）', () => {
    const ctx = setup({ loadingAllowed: () => false })
    const counts: Record<string, number> = {}
    for (const n of ['tap', 'correct', 'wrong', 'reward', 'pop'] as const) {
      const before = (ctx() ?? { oscillators: 0 }).oscillators
      playSound(n)
      counts[n] = ctx().oscillators - before
    }
    expect(counts).toEqual({ tap: 1, correct: 2, wrong: 1, reward: 4, pop: 1 })
  })

  it('音效開關關掉：不發聲（不建音源、不起振盪器）', async () => {
    const ctx = setup()
    setSfxEnabled(false)
    expect(playSound('correct')).toBe(false)
    expect(ctx()?.oscillators ?? 0).toBe(0)
    setSfxEnabled(true)
    expect(playSound('correct')).toBe(true)
  })

  it('檔案載好之後播檔（不再用合成音）；沒載好之前先用合成音並在背景載入', async () => {
    const ctx = setup()
    expect(playSound('correct')).toBe(true) // 第一次：檔案還沒好 → 合成音
    expect(ctx().oscillators).toBe(2)
    expect(getAudioState().played.correct).toEqual({ file: 0, synth: 1 })
    await flush()
    expect(getAudioState().loadedSfx).toContain('correct')
    expect(playSound('correct')).toBe(true)
    expect(ctx().oscillators).toBe(2) // 沒有再多
    expect(getAudioState().played.correct).toEqual({ file: 1, synth: 1 })
    expect(ctx().sources.at(-1)?.started).not.toBeNull()
  })

  it('synth:false 或沒有原本合成音的新音效，檔案沒載好就安靜、不丟錯', () => {
    const ctx = setup({ loadingAllowed: () => false })
    expect(playSound('tap', { synth: false })).toBe(false)
    expect(playSound('coin')).toBe(false)
    expect(playSound('hatch')).toBe(false)
    expect(ctx().oscillators).toBe(0)
  })

  it('自訂備援（synth 函式）被用到', () => {
    setup({ loadingAllowed: () => false })
    const fb = vi.fn()
    expect(playSound('coin', { synth: fb })).toBe(true)
    expect(fb).toHaveBeenCalledTimes(1)
  })

  it('同一個音檔太密集（55ms 內）只響一次，避免疊成一團', async () => {
    let t = 0
    setup({ nowMs: () => t })
    preloadSounds()
    await flush()
    t = 1000
    expect(playSound('coin')).toBe(true)
    t = 1020
    expect(playSound('coin')).toBe(false)
    t = 1100
    expect(playSound('coin')).toBe(true)
  })

  it('preloadSounds 把 18 個音效都載進來（原本 12 個加 v8.5 的 6 個）', async () => {
    setup()
    preloadSounds()
    await flush()
    expect(SOUND_NAMES).toHaveLength(18)
    expect([...getAudioState().loadedSfx].sort()).toEqual([...SOUND_NAMES].sort())
  })

  it('v8.5 的六個新音效：檔案載好就播檔；沒載好時安靜（沒有合成音備援）、不丟錯，並在背景載入', async () => {
    const ctx = setup()
    for (const n of NEW_SOUNDS) expect(playSound(n)).toBe(false) // 第一次：還沒有檔案 → 安靜
    expect(ctx().oscillators).toBe(0)
    await flush()
    for (const n of NEW_SOUNDS) {
      expect(getAudioState().loadedSfx).toContain(n)
      expect(fetched).toContain(`/gq/audio/sfx-${n}.m4a?v=abc`)
      expect(playSound(n)).toBe(true)
      expect(getAudioState().played[n]).toEqual({ file: 1, synth: 0 })
    }
    expect(ctx().oscillators).toBe(0)
    expect(ctx().sources).toHaveLength(NEW_SOUNDS.length)
  })

  it('清單裡還沒有某個音效（舊版清單配新程式）：安靜略過，其他音效照常', async () => {
    const old = { ...MANIFEST, sfx: Object.fromEntries(Object.entries(MANIFEST.sfx).filter(([k]) => !(NEW_SOUNDS as readonly string[]).includes(k))) }
    setup({
      fetchFn: (url) => {
        fetched.push(url)
        return Promise.resolve(url.endsWith('manifest.json') ? new Response(JSON.stringify(old), { status: 200 }) : new Response(new ArrayBuffer(64), { status: 200 }))
      },
    })
    preloadSounds()
    await flush()
    expect(getAudioState().loadedSfx).toHaveLength(12)
    expect(playSound('munch')).toBe(false)
    expect(playSound('coin')).toBe(true)
    expect(fetched.some((f) => f.includes('sfx-munch'))).toBe(false)
  })

  it('單一 AudioContext：音樂、音效、合成音共用同一個', async () => {
    setup()
    setMusicScene('map')
    await flush()
    playSound('correct')
    expect(getAudioContext()).toBe(getAudioContext())
    expect(FakeCtx.instances).toHaveLength(1)
  })
})

describe('語音壓低音樂（duck）', () => {
  it('duckMusic(true) 把音樂輸出壓到 DUCK_RATIO，false 之後排程放回（延遲放開，不用計時器）', async () => {
    const ctx = setup()
    setMusicScene('home-day')
    await flush()
    const musicOut = ctx().gains[1] // master、music、sfx
    expect(musicOut.gain.value).toBeCloseTo(MUSIC_VOLUME)
    duckMusic(true)
    expect(getAudioState().ducked).toBe(true)
    expect(musicOut.gain.events.find((e) => e.type === 'ramp')?.v).toBeCloseTo(MUSIC_VOLUME * DUCK_RATIO)
    // 保險：太久沒收到結束就自動放開（AudioParam 排程）
    expect(musicOut.gain.events.some((e) => e.type === 'target' && e.t > 20)).toBe(true)
    ctx().currentTime = 3
    duckMusic(false)
    expect(getAudioState().ducked).toBe(false)
    const rel = musicOut.gain.events.filter((e) => e.type === 'target').at(-1)!
    expect(rel.v).toBeCloseTo(MUSIC_VOLUME)
    expect(rel.t).toBeGreaterThan(3) // 稍微延遲才放開
    expect(rel.t).toBeLessThan(4)
  })

  it('在 context 建立之前就壓低，建立後音量從壓低的值開始', () => {
    const ctx = setup()
    duckMusic(true)
    getAudioContext()
    expect(ctx().gains[1].gain.value).toBeCloseTo(MUSIC_VOLUME * DUCK_RATIO)
  })
})

// ---------- 真的檔案：public/audio 與清單、程式裡的名稱要對得上 ----------
describe('public/audio：清單、檔案、程式裡的名稱一致', () => {
  const dir = join(process.cwd(), 'public', 'audio')
  const real = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    music: Record<string, { file: string; v: string; loopStart: number; loopEnd: number; loopSeconds: number }>
    sfx: Record<string, { file: string; v: string; duration: number }>
  }

  it('每個 MusicScene 都有一首（含 v8.5 的 playground、town），清單沒有多的', () => {
    expect(Object.keys(real.music).sort()).toEqual([...MUSIC_SCENES].sort())
    expect(MUSIC_SCENES).toContain('playground')
    expect(MUSIC_SCENES).toContain('town')
  })

  it('每個 SoundName 都有檔案（含 v8.5 的六個），清單沒有多的', () => {
    expect(Object.keys(real.sfx).sort()).toEqual([...SOUND_NAMES].sort())
    for (const n of NEW_SOUNDS) expect(real.sfx[n]?.file).toBe(`sfx-${n}.m4a`)
  })

  it('清單裡的檔案都存在、有內容雜湊；音樂單首 ≤ 800KB、音效單個 ≤ 40KB', () => {
    for (const [k, e] of Object.entries(real.music)) {
      expect(e.file).toBe(`music-${k}.m4a`)
      expect(existsSync(join(dir, e.file)), e.file).toBe(true)
      expect(e.v).toMatch(/^[0-9a-f]{8}$/)
      expect(statSync(join(dir, e.file)).size, e.file).toBeLessThanOrEqual(800 * 1024)
    }
    for (const e of Object.values(real.sfx)) {
      expect(existsSync(join(dir, e.file)), e.file).toBe(true)
      expect(e.v).toMatch(/^[0-9a-f]{8}$/)
      expect(statSync(join(dir, e.file)).size, e.file).toBeLessThanOrEqual(40 * 1024)
    }
  })

  it('循環點合理：loopStart 留了前導、loopEnd − loopStart 就是一圈的長度', () => {
    for (const [k, e] of Object.entries(real.music)) {
      expect(e.loopStart, k).toBeGreaterThan(0.2)
      expect(e.loopEnd - e.loopStart, k).toBeCloseTo(e.loopSeconds, 4)
    }
  })

  it('v8.5 新音樂一圈 30–45 秒；新音效都短（cheer 不到 1 秒、fanfare 約 1.2 秒、其餘不到 0.8 秒）', () => {
    for (const k of ['playground', 'town']) {
      expect(real.music[k].loopSeconds, k).toBeGreaterThanOrEqual(30)
      expect(real.music[k].loopSeconds, k).toBeLessThanOrEqual(45)
    }
    expect(real.sfx.cheer.duration).toBeLessThan(1)
    expect(real.sfx.fanfare.duration).toBeGreaterThanOrEqual(1.0)
    expect(real.sfx.fanfare.duration).toBeLessThanOrEqual(1.4)
    for (const n of ['boing', 'splash', 'munch', 'squeak']) expect(real.sfx[n].duration, n).toBeLessThan(0.8)
  })

  it('既有的 9 首音樂與 12 個音效沒有被重算（內容雜湊不變，使用者不必重新下載）', () => {
    const frozen: Record<string, string> = {
      'music-title': '7ad2edaf',
      'music-home-day': 'a705e9fb',
      'music-home-night': '1a2dd315',
      'music-map': 'cc413346',
      'music-stage': 'bfedb421',
      'music-boss': '44e53697',
      'music-ceremony': '16d40e9d',
      'music-paint': 'baabe6f2',
      'music-story': '015f9890',
      'sfx-tap': '04056dc6',
      'sfx-pop': 'b1fddcaa',
      'sfx-correct': 'de118e74',
      'sfx-wrong': 'e36e4560',
      'sfx-reward': 'fad05b4c',
      'sfx-coin': '7ba93056',
      'sfx-whoosh': '23387952',
      'sfx-page': 'a2bc4007',
      'sfx-unlock': 'a6ac4963',
      'sfx-hatch': 'fc7ae913',
      'sfx-drop': 'c32237cb',
      'sfx-sparkle': '00ff7099',
    }
    const now = Object.fromEntries([...Object.values(real.music), ...Object.values(real.sfx)].map((e) => [e.file.replace('.m4a', ''), e.v]))
    for (const [k, v] of Object.entries(frozen)) expect(now[k], k).toBe(v)
  })
})
