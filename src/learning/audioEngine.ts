/**
 * 單一 AudioContext 音訊引擎（SPEC-v8 線 M）。
 *
 * - 背景音樂：每個場景一首原創 m4a（design/tools/gen_music.py 算繪），AudioBuffer + loopStart/loopEnd 無縫循環，
 *   換場景交叉淡入淡出約 0.8 秒；循環點記在 public/audio/manifest.json。
 * - 音效：同樣是預先算繪的 m4a。檔案還沒載好或載入失敗時，退回原本的 WebAudio 合成音（不會無聲、也不丟錯）。
 * - 語音播放時自動壓低音樂（duckMusic，由 speech.ts 呼叫）；頁面切到背景時暫停、回來恢復。
 * - 全部延遲載入：第一次需要才 fetch + decodeAudioData，不擋啟動；任何失敗都安靜略過。
 * - 自動化測試（navigator.webdriver）預設不載入音檔（比照語音包的 gq-voice-pack-test），讓既有 e2e 維持可重現；
 *   要測音檔本身時在 localStorage 設 gq-audio-test=1。
 */

export type MusicScene = 'title' | 'home-day' | 'home-night' | 'map' | 'stage' | 'boss' | 'ceremony' | 'paint'
export const MUSIC_SCENES: readonly MusicScene[] = ['title', 'home-day', 'home-night', 'map', 'stage', 'boss', 'ceremony', 'paint']

export type SoundName = 'tap' | 'pop' | 'correct' | 'wrong' | 'reward' | 'coin' | 'whoosh' | 'page' | 'unlock' | 'hatch' | 'drop' | 'sparkle'
export const SOUND_NAMES: readonly SoundName[] = ['tap', 'pop', 'correct', 'wrong', 'reward', 'coin', 'whoosh', 'page', 'unlock', 'hatch', 'drop', 'sparkle']

/** 音樂音量（相對於檔案的 −24 LUFS）：預設偏小，不蓋過語音 */
export const MUSIC_VOLUME = 0.5
/** 音效音量（檔案約 −18 LUFS） */
export const SFX_VOLUME = 0.8
/** 語音播放時音樂降到這個比例（約 −10 dB） */
export const DUCK_RATIO = 0.3
/** 場景交叉淡入淡出（秒） */
export const FADE_SECONDS = 0.8
const DUCK_DOWN_S = 0.18
const DUCK_UP_DELAY_S = 0.35
const DUCK_UP_TC = 0.25
/** 壓低狀態的保險：這麼久沒收到「語音結束」就自動放開（語音事件在 iOS 上偶爾不會來） */
const DUCK_MAX_S = 30
/** 同一個音效的最短間隔（毫秒），避免一次觸發多次疊成一團 */
const MIN_GAP_MS = 55
/** 記憶體裡最多留幾首解碼好的音樂（一首立體聲約 15MB） */
const MAX_MUSIC_BUFFERS = 2

interface MusicEntry {
  file: string
  /** 檔案內容雜湊：換檔時網址跟著變，runtime cache 才不會拿到舊檔配新的循環點 */
  v?: string
  loopStart: number
  loopEnd: number
}
interface SfxEntry {
  file: string
  v?: string
}
interface Manifest {
  music: Partial<Record<MusicScene, MusicEntry>>
  sfx: Partial<Record<SoundName, SfxEntry>>
}

/** 可注入的環境（單元測試用） */
export interface AudioEnv {
  createContext: () => AudioContext | null
  fetchFn: (url: string) => Promise<Response>
  baseUrl: string
  /** false = 不載入音檔（自動化測試預設） */
  loadingAllowed: () => boolean
  nowMs: () => number
  isHidden: () => boolean
}

function defaultLoadingAllowed(): boolean {
  try {
    if (typeof navigator !== 'undefined' && navigator.webdriver && localStorage.getItem('gq-audio-test') !== '1') return false
  } catch {
    /* 讀不到 localStorage 就照常載入 */
  }
  return true
}

function defaultEnv(): AudioEnv {
  return {
    createContext: () => {
      try {
        if (typeof window === 'undefined') return null
        const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        return C ? new C() : null
      } catch {
        return null
      }
    },
    fetchFn: (url) => fetch(url),
    baseUrl: typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/',
    loadingAllowed: defaultLoadingAllowed,
    nowMs: () => Date.now(),
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  }
}

let env: AudioEnv = defaultEnv()

// ---------- 狀態 ----------
let ctx: AudioContext | null = null
let musicOut: GainNode | null = null
let sfxOut: GainNode | null = null
/** 每個孩子的設定載入之前（開場、PIN、選孩子）就要知道音樂開不開：記著最後一次的選擇 */
let musicEnabled = (() => {
  try {
    return localStorage.getItem('gq-music-on') !== '0'
  } catch {
    return true
  }
})()
let sfxEnabled = true
let wantedScene: MusicScene | null = null
let ducked = false
let hiddenPause = false

interface Playing {
  scene: MusicScene
  source: AudioBufferSourceNode
  gain: GainNode
}
let current: Playing | null = null

let manifest: Manifest | null = null
let manifestLoading: Promise<Manifest | null> | null = null
let manifestRetryAt = 0
const musicBuffers = new Map<MusicScene, AudioBuffer>()
const musicLoading = new Map<MusicScene, Promise<AudioBuffer | null>>()
const sfxBuffers = new Map<SoundName, AudioBuffer>()
const sfxLoading = new Map<SoundName, Promise<AudioBuffer | null>>()
const failedUntil = new Map<string, number>()
const lastPlayedAt = new Map<SoundName, number>()
const stats = { played: {} as Record<string, { file: number; synth: number }>, started: 0 }

function bump(name: string, kind: 'file' | 'synth'): void {
  const s = (stats.played[name] ??= { file: 0, synth: 0 })
  s[kind]++
}

// ---------- AudioContext ----------

/** 共用的 AudioContext（合成音、寵物音效、著色音效都用這個）；不支援時回 null */
export function getAudioContext(): AudioContext | null {
  if (ctx) return ctx
  const c = env.createContext()
  if (!c) return null
  try {
    ctx = c
    const master = c.createGain()
    master.connect(c.destination)
    musicOut = c.createGain()
    musicOut.gain.value = MUSIC_VOLUME * (ducked ? DUCK_RATIO : 1)
    musicOut.connect(master)
    sfxOut = c.createGain()
    sfxOut.gain.value = SFX_VOLUME
    sfxOut.connect(master)
    c.onstatechange = () => {
      if (c.state === 'running') reconcile()
    }
    return ctx
  } catch {
    ctx = null
    return null
  }
}

/** 舊名稱（src/learning/sfx.ts 的 audio()） */
export const audio = getAudioContext

/** 在使用者手勢裡呼叫：讓 AudioContext 從 suspended 起來（iOS Safari 的限制） */
export function unlockAudio(): void {
  const c = getAudioContext()
  if (!c) return
  try {
    if (c.state !== 'running') void c.resume()?.catch?.(() => {})
  } catch {
    /* ignore */
  }
  preloadSounds()
}

function resumeIfNeeded(c: AudioContext): void {
  try {
    if (c.state === 'suspended' && !hiddenPause) void c.resume()?.catch?.(() => {})
  } catch {
    /* ignore */
  }
}

// ---------- 載入 ----------

function url(file: string, v?: string): string {
  return `${env.baseUrl}audio/${file}${v ? `?v=${v}` : ''}`
}

async function getManifest(): Promise<Manifest | null> {
  if (manifest) return manifest
  if (manifestLoading) return manifestLoading
  if (env.nowMs() < manifestRetryAt) return null
  manifestLoading = (async () => {
    try {
      const res = await env.fetchFn(url('manifest.json'))
      if (!res.ok) throw new Error(`manifest ${res.status}`)
      const m = (await res.json()) as Partial<Manifest>
      manifest = { music: m.music ?? {}, sfx: m.sfx ?? {} }
      return manifest
    } catch {
      manifestRetryAt = env.nowMs() + 30_000
      return null
    } finally {
      manifestLoading = null
    }
  })()
  return manifestLoading
}

async function fetchDecode(file: string, v?: string): Promise<AudioBuffer | null> {
  const c = getAudioContext()
  if (!c) return null
  const key = file
  if ((failedUntil.get(key) ?? 0) > env.nowMs()) return null
  try {
    const res = await env.fetchFn(url(file, v))
    if (!res.ok) throw new Error(`audio ${res.status}`)
    const data = await res.arrayBuffer()
    return await new Promise<AudioBuffer>((resolve, reject) => {
      // 舊版 Safari 只有 callback 形式；新的兩種都支援，包起來統一
      const p = c.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined
      p?.then?.(resolve, reject)
    })
  } catch {
    failedUntil.set(key, env.nowMs() + 60_000)
    return null
  }
}

function loadMusic(scene: MusicScene): Promise<AudioBuffer | null> {
  const have = musicBuffers.get(scene)
  if (have) return Promise.resolve(have)
  const pending = musicLoading.get(scene)
  if (pending) return pending
  const p = (async () => {
    const m = await getManifest()
    const entry = m?.music[scene]
    if (!entry) return null
    const buf = await fetchDecode(entry.file, entry.v)
    if (buf) musicBuffers.set(scene, buf)
    return buf
  })().finally(() => musicLoading.delete(scene))
  musicLoading.set(scene, p)
  return p
}

function loadSfx(name: SoundName): Promise<AudioBuffer | null> {
  const have = sfxBuffers.get(name)
  if (have) return Promise.resolve(have)
  const pending = sfxLoading.get(name)
  if (pending) return pending
  if (!env.loadingAllowed()) return Promise.resolve(null)
  const p = (async () => {
    const m = await getManifest()
    const entry = m?.sfx[name]
    if (!entry) return null
    const buf = await fetchDecode(entry.file, entry.v)
    if (buf) sfxBuffers.set(name, buf)
    return buf
  })().finally(() => sfxLoading.delete(name))
  sfxLoading.set(name, p)
  return p
}

let preloaded = false
/** 第一次觸碰後在背景載入全部音效（十幾個小檔，合計約 150KB），之後就不會退回合成音 */
export function preloadSounds(): void {
  if (preloaded || !env.loadingAllowed()) return
  preloaded = true
  void (async () => {
    for (const n of SOUND_NAMES) await loadSfx(n)
  })()
}

// ---------- 背景音樂 ----------

function rampTo(p: AudioParam, v: number, t: number, dur: number): void {
  p.cancelScheduledValues(t)
  p.setValueAtTime(p.value, t)
  p.linearRampToValueAtTime(v, t + dur)
}

function stopPlaying(pl: Playing, c: AudioContext, fade: number): void {
  const t = c.currentTime
  try {
    rampTo(pl.gain.gain, 0, t, fade)
    pl.source.stop(t + fade + 0.05)
    pl.source.onended = () => {
      try {
        pl.source.disconnect()
        pl.gain.disconnect()
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* 已經停了 */
  }
}

function begin(scene: MusicScene, buf: AudioBuffer, entry: MusicEntry): void {
  const c = getAudioContext()
  if (!c || !musicOut) return
  const t = c.currentTime
  if (current) stopPlaying(current, c, FADE_SECONDS)
  const source = c.createBufferSource()
  source.buffer = buf
  source.loop = true
  source.loopStart = entry.loopStart
  source.loopEnd = entry.loopEnd
  const gain = c.createGain()
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(1, t + FADE_SECONDS)
  source.connect(gain)
  gain.connect(musicOut)
  // 從 loopStart 開始：檔案開頭那一小段是循環尾巴的前導（吸收 AAC 編碼延遲），不從那裡開始播
  source.start(t, entry.loopStart)
  current = { scene, source, gain }
  stats.started++
  // 只留目前與上一首的解碼資料，避免吃掉太多記憶體
  musicBuffers.delete(scene)
  musicBuffers.set(scene, buf)
  while (musicBuffers.size > MAX_MUSIC_BUFFERS) {
    const oldest = musicBuffers.keys().next().value as MusicScene | undefined
    if (oldest === undefined) break
    musicBuffers.delete(oldest)
  }
}

/** 讓「實際在播的」對齊「想要的」：音樂開、頁面可見、AudioContext 在跑、有指定場景才播 */
function reconcile(): void {
  if (!env.loadingAllowed()) return
  const desired = musicEnabled && !hiddenPause ? wantedScene : null
  if (current?.scene === desired) return
  if (desired === null) {
    if (current && ctx) {
      stopPlaying(current, ctx, musicEnabled ? FADE_SECONDS : 0.35)
      current = null
    }
    return
  }
  const c = getAudioContext()
  if (!c) return
  void (async () => {
    const buf = await loadMusic(desired)
    const entry = manifest?.music[desired]
    if (!buf || !entry) return
    // 載入期間情況可能變了（換了場景、關了音樂、切到背景）
    if (wantedScene !== desired || !musicEnabled || hiddenPause || current?.scene === desired) return
    if (c.state !== 'running') {
      resumeIfNeeded(c)
      return // 等 statechange → reconcile
    }
    begin(desired, buf, entry)
  })()
}

/** 設定目前的背景音樂場景；null = 停掉。同一個場景重複呼叫不會重播 */
export function setMusicScene(scene: MusicScene | null): void {
  try {
    wantedScene = scene
    reconcile()
  } catch {
    /* 音樂失敗不影響遊戲 */
  }
}

export function setMusicEnabled(on: boolean): void {
  try {
    musicEnabled = on
    try {
      localStorage.setItem('gq-music-on', on ? '1' : '0')
    } catch {
      /* 存不了就只影響開場那段 */
    }
    reconcile()
  } catch {
    /* ignore */
  }
}

export function setSfxEnabled(on: boolean): void {
  sfxEnabled = on
}

/** 語音播放中壓低音樂（true），結束後放開（false，稍微延遲，連續唸幾句時不會忽大忽小） */
export function duckMusic(on: boolean): void {
  try {
    ducked = on
    const c = ctx
    if (!c || !musicOut) return
    const base = MUSIC_VOLUME
    const p = musicOut.gain
    const t = c.currentTime
    p.cancelScheduledValues(t)
    p.setValueAtTime(p.value, t)
    if (on) {
      p.linearRampToValueAtTime(base * DUCK_RATIO, t + DUCK_DOWN_S)
      // 保險：太久沒收到結束事件就自動放開（用 AudioParam 排程，不用計時器）
      p.setTargetAtTime(base, t + DUCK_MAX_S, DUCK_UP_TC)
    } else {
      p.setTargetAtTime(base, t + DUCK_UP_DELAY_S, DUCK_UP_TC)
    }
  } catch {
    /* ignore */
  }
}

// ---------- 音效 ----------

type Synth = (c: AudioContext) => void

function tone(c: AudioContext, t0: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType): void {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(f0, t0)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.8)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + (dur > 0.1 ? 0.02 : 0.012))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(c.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.04)
}

function notes(c: AudioContext, list: { f: number; t: number; d: number }[], type: OscillatorType, vol = 0.18): void {
  const t0 = c.currentTime
  for (const n of list) tone(c, t0 + n.t, n.f, n.f, n.d, vol, type)
}

/** 原本的合成音（檔案還沒載好、載入失敗、或自動化測試時用）。只有這五種有原本的聲音；其他新音效沒有檔案就安靜 */
const SYNTH: Partial<Record<SoundName, Synth>> = {
  tap: (c) => notes(c, [{ f: 520, t: 0, d: 0.05 }], 'triangle'),
  correct: (c) =>
    notes(
      c,
      [
        { f: 659, t: 0, d: 0.12 },
        { f: 880, t: 0.1, d: 0.2 },
      ],
      'triangle',
    ),
  wrong: (c) => notes(c, [{ f: 294, t: 0, d: 0.22 }], 'sine'),
  reward: (c) =>
    notes(
      c,
      [
        { f: 523, t: 0, d: 0.12 },
        { f: 659, t: 0.1, d: 0.12 },
        { f: 784, t: 0.2, d: 0.12 },
        { f: 1047, t: 0.3, d: 0.3 },
      ],
      'triangle',
    ),
  pop: (c) => tone(c, c.currentTime, 380, 900, 0.12, 0.2, 'sine'),
}

export interface PlayOptions {
  /** false = 檔案沒載好就安靜；函式 = 用自己的合成音當備援；沒給 = 用原本的合成音（如果有） */
  synth?: boolean | Synth
}

/**
 * 播一個音效。音效開關關掉時不發聲。回傳是否有發聲（檔案或合成音）。
 * 任何錯誤都吞掉，不影響遊戲。
 */
export function playSound(name: SoundName, opts: PlayOptions = {}): boolean {
  if (!sfxEnabled) return false
  try {
    const c = getAudioContext()
    if (!c) return false
    const nowMs = env.nowMs()
    resumeIfNeeded(c)
    const buf = sfxBuffers.get(name)
    if (buf && sfxOut) {
      // 同一個音檔太密集（一次觸發好幾次）就略過，避免疊成一團；合成音備援維持原本的行為（每次都響）
      if (nowMs - (lastPlayedAt.get(name) ?? -Infinity) < MIN_GAP_MS) return false
      lastPlayedAt.set(name, nowMs)
      const src = c.createBufferSource()
      src.buffer = buf
      src.connect(sfxOut)
      src.onended = () => {
        try {
          src.disconnect()
        } catch {
          /* ignore */
        }
      }
      src.start(c.currentTime)
      bump(name, 'file')
      return true
    }
    // 還沒載好：背景載入（下次就有檔案），這一次用合成音備援
    void loadSfx(name)
    const fb = typeof opts.synth === 'function' ? opts.synth : opts.synth === false ? undefined : SYNTH[name]
    if (!fb) return false
    fb(c)
    bump(name, 'synth')
    return true
  } catch {
    return false
  }
}

// ---------- 事件接線 ----------

let installed = false

function onVisibility(): void {
  try {
    if (env.isHidden()) {
      hiddenPause = true
      if (ctx && ctx.state === 'running') void ctx.suspend()?.catch?.(() => {})
    } else {
      hiddenPause = false
      if (ctx && ctx.state !== 'running') void ctx.resume()?.catch?.(() => {})
      reconcile()
    }
  } catch {
    /* ignore */
  }
}

function onPointerDown(e: Event): void {
  try {
    // iOS：任何觸碰都順便確認 AudioContext 還活著（被電話或鎖屏打斷後要在手勢裡 resume）
    if (ctx) {
      if (ctx.state !== 'running') resumeIfNeeded(ctx)
    } else unlockAudio()
    preloadSounds()
    const t = e.target as Element | null
    if (!t || typeof t.closest !== 'function') return
    // 繪圖畫布上不要響（畫圖時按下去一直 tap 很吵）
    if (t.closest('canvas, [data-no-tap]')) return
    const b = t.closest('button, [role="button"]')
    if (!b) return
    if (b.matches(':disabled, [aria-disabled="true"]')) return
    playSound('tap', { synth: false })
  } catch {
    /* ignore */
  }
}

/** 安裝全域監聽（idempotent）：背景暫停／恢復、按鈕觸碰音、觸碰時確保 AudioContext 在跑 */
export function installAudioEngine(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('pointerdown', onPointerDown, true)
  try {
    if (typeof navigator !== 'undefined' && navigator.webdriver) (window as unknown as { __gqAudio?: () => AudioState }).__gqAudio = getAudioState
  } catch {
    /* ignore */
  }
}

// ---------- 除錯與測試 ----------

export interface AudioState {
  wantedScene: MusicScene | null
  /** 目前實際在播（或淡入中）的場景 */
  scene: MusicScene | null
  musicEnabled: boolean
  sfxEnabled: boolean
  ducked: boolean
  /** 音樂輸出增益（含壓低） */
  musicGain: number | null
  ctxState: string | null
  loadedMusic: MusicScene[]
  loadedSfx: SoundName[]
  started: number
  played: Record<string, { file: number; synth: number }>
}

export function getAudioState(): AudioState {
  return {
    wantedScene,
    scene: current?.scene ?? null,
    musicEnabled,
    sfxEnabled,
    ducked,
    musicGain: musicOut ? musicOut.gain.value : null,
    ctxState: ctx?.state ?? null,
    loadedMusic: [...musicBuffers.keys()],
    loadedSfx: [...sfxBuffers.keys()],
    started: stats.started,
    played: JSON.parse(JSON.stringify(stats.played)) as AudioState['played'],
  }
}

/** 單元測試用：清掉所有狀態並換上假的環境 */
export function __resetAudioEngineForTest(over: Partial<AudioEnv> = {}): void {
  ctx = null
  musicOut = null
  sfxOut = null
  musicEnabled = true
  sfxEnabled = true
  wantedScene = null
  ducked = false
  hiddenPause = false
  current = null
  manifest = null
  manifestLoading = null
  manifestRetryAt = 0
  preloaded = false
  musicBuffers.clear()
  musicLoading.clear()
  sfxBuffers.clear()
  sfxLoading.clear()
  failedUntil.clear()
  lastPlayedAt.clear()
  stats.played = {}
  stats.started = 0
  env = { ...defaultEnv(), ...over }
}

export function __audioVisibilityForTest(hidden: boolean): void {
  env = { ...env, isHidden: () => hidden }
  onVisibility()
}
