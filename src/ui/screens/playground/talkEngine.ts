import { getAudioContext } from '../../../learning/audioEngine'
import { nudgeAfter, newGate, playbackGain, rms, speechRange, speechWindow, stepGate, TALK_DEAF_MS, type VoiceGate } from '../../../domain/talk'

// v8.3 學我說話：碰麥克風的部分。
// 錄音從開始聽就一直開著（只在記憶體）：MediaRecorder 真正開始要時間，等聽到聲音才開第一個字就沒了。
// 過一陣子都沒人說話就整段丟掉重開，播回完一句也丟掉。不存檔、不上傳，dispose 之後什麼都不留。

export type TalkPhase = 'asking' | 'listening' | 'hearing' | 'thinking' | 'playing' | 'speaking' | 'blocked'
/** denied = 被拒絕；unsupported = 這個瀏覽器不能錄 */
export type TalkBlock = 'denied' | 'unsupported'

export interface TalkEngineOptions {
  /** 播回的速度（同時決定音調） */
  rate: number
  onPhase: (p: TalkPhase, block?: TalkBlock) => void
  /** 每次取樣的音量（0..1，已放大到好看的範圍）：聽的時候是麥克風，播回時是播出去的聲音 */
  onLevel: (level: number) => void
  /** 學完一句了（n = 第幾句，從 1 算） */
  onRound: (n: number) => void
  /** 寵物要說一句話：等它說完才繼續聽，不然會錄到自己。回傳的 Promise 結束 = 說完了 */
  speak: (key: string) => Promise<void>
}

const TICK_MS = 60
/** 沒人說話多久就把錄到的丟掉重開（記憶體不累積） */
const RECORDER_RESTART_MS = 10_000
/** 麥克風被系統收走（電話、其他 App）後最多再試幾次 */
const MAX_REOPEN = 3
const AGAIN_LINE = 'pet.play.talk.again'

export const isTalkSupported = (): boolean => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && !!getAudioContext()

const stopNode = (n: AudioNode | null | undefined) => {
  try {
    n?.disconnect()
  } catch {
    /* 已經斷了 */
  }
}

export class TalkEngine {
  private o: TalkEngineOptions
  private disposed = false
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  /** 接到輸出但音量 0：有些瀏覽器的節點沒接到輸出就不會跑，接了也不會有回音 */
  private sink: GainNode | null = null
  private recorder: MediaRecorder | null = null
  private recorderAt = 0
  private tick: number | undefined
  private timers = new Set<number>()
  private gate: VoiceGate = newGate()
  private deaf = true
  private deafUntil = 0
  private listenSince = 0
  private nudges = 0
  private rounds = 0
  private reopens = 0
  private playback: { src: AudioBufferSourceNode; nodes: AudioNode[]; analyser: AnalyserNode } | null = null
  private generation = 0

  constructor(o: TalkEngineOptions) {
    this.o = o
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  /** 開始（要已經確定家長開了、寵物說完了） */
  start(): void {
    void this.open()
  }

  /** 離開畫面：麥克風、錄音、計時器、播放全部收掉 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.closeMic()
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id)
      fn()
    }, ms)
    this.timers.add(id)
  }

  private onVisibility = () => {
    if (this.disposed) return
    // 切到背景就關麥克風，回來再開（iPad 也會自己靜音，但不留著比較乾淨）
    if (document.hidden) this.closeMic()
    else if (!this.stream) void this.open()
  }

  private async open(): Promise<void> {
    if (this.disposed || this.stream) return
    if (!isTalkSupported()) return this.o.onPhase('blocked', 'unsupported')
    const gen = ++this.generation
    this.o.onPhase('asking')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      if (gen === this.generation && !this.disposed) this.o.onPhase('blocked', e instanceof DOMException && e.name === 'NotFoundError' ? 'unsupported' : 'denied')
      return
    }
    // 等權限的時候孩子可能已經離開了（或切到背景）：拿到也馬上還回去
    if (this.disposed || gen !== this.generation || document.hidden) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    const c = getAudioContext()
    if (!c) {
      stream.getTracks().forEach((t) => t.stop())
      return this.o.onPhase('blocked', 'unsupported')
    }
    this.stream = stream
    stream.getTracks().forEach((t) => t.addEventListener('ended', this.onTrackEnded))
    try {
      if (c.state !== 'running') void c.resume()?.catch?.(() => {})
      this.source = c.createMediaStreamSource(stream)
      this.analyser = c.createAnalyser()
      this.analyser.fftSize = 1024
      this.sink = c.createGain()
      this.sink.gain.value = 0
      this.source.connect(this.analyser)
      this.analyser.connect(this.sink)
      this.sink.connect(c.destination)
    } catch {
      this.closeMic()
      return this.o.onPhase('blocked', 'unsupported')
    }
    this.tick = window.setInterval(this.onTick, TICK_MS)
    this.listen()
  }

  /** 系統把麥克風收走（電話、權限被關）：再要一次，一直要不到才顯示沒辦法玩 */
  private onTrackEnded = () => {
    if (this.disposed || !this.stream) return
    this.closeMic()
    if (document.hidden) return
    if (++this.reopens > MAX_REOPEN) return this.o.onPhase('blocked', 'denied')
    void this.open()
  }

  private closeMic(): void {
    this.generation++
    window.clearInterval(this.tick)
    this.tick = undefined
    for (const id of this.timers) window.clearTimeout(id)
    this.timers.clear()
    this.deaf = true
    this.dropRecorder()
    this.stopPlayback()
    stopNode(this.source)
    stopNode(this.analyser)
    stopNode(this.sink)
    this.source = null
    this.analyser = null
    this.sink = null
    this.stream?.getTracks().forEach((t) => {
      t.removeEventListener('ended', this.onTrackEnded)
      t.stop()
    })
    this.stream = null
  }

  private startRecorder(): boolean {
    this.dropRecorder()
    if (!this.stream) return false
    try {
      // 不指定格式：各瀏覽器預設的（Safari mp4、Chrome webm）就是自己解得開的
      const r = new MediaRecorder(this.stream)
      r.start()
      this.recorder = r
      this.recorderAt = performance.now()
      return true
    } catch {
      this.closeMic()
      this.o.onPhase('blocked', 'unsupported')
      return false
    }
  }

  /** 丟掉現在的錄音，什麼都不留 */
  private dropRecorder(): void {
    const r = this.recorder
    this.recorder = null
    if (!r) return
    r.ondataavailable = null
    r.onstop = null
    try {
      if (r.state !== 'inactive') r.stop()
    } catch {
      /* 已經停了 */
    }
  }

  private listen(): void {
    if (this.disposed || !this.stream) return
    if (!this.startRecorder()) return
    this.gate = newGate(this.gate.floor)
    this.listenSince = performance.now()
    this.deaf = false
    this.deafUntil = performance.now() + TALK_DEAF_MS
    this.o.onPhase('listening')
  }

  private onTick = () => {
    if (this.playback) {
      const buf = new Float32Array(this.playback.analyser.fftSize)
      this.playback.analyser.getFloatTimeDomainData(buf)
      this.o.onLevel(Math.min(1, Math.sqrt(rms(buf) * 3)))
      return
    }
    const a = this.analyser
    if (!a || this.deaf) return
    const buf = new Float32Array(a.fftSize)
    a.getFloatTimeDomainData(buf)
    const level = rms(buf)
    this.o.onLevel(Math.min(1, Math.sqrt(level * 5)))
    const now = performance.now()
    if (now < this.deafUntil) return
    const { gate, event } = stepGate(this.gate, level, now)
    this.gate = gate
    if (event === 'start') {
      this.nudges = 0
      this.o.onPhase('hearing')
    } else if (event === 'blip') {
      this.listenSince = now
      this.o.onPhase('listening')
    } else if (event === 'stop') {
      void this.capture(gate.onsetAt, gate.lastLoudAt, now)
    } else if (gate.phase === 'quiet') {
      if (now - this.recorderAt >= RECORDER_RESTART_MS) this.startRecorder()
      const wait = nudgeAfter(this.nudges)
      if (wait !== null && now - this.listenSince >= wait) {
        this.nudges++
        void this.sayThenListen(AGAIN_LINE)
      }
    }
  }

  /** 寵物說一句：這段時間不聽，說完再從頭開始聽 */
  private async sayThenListen(key: string): Promise<void> {
    const gen = this.generation
    this.deaf = true
    this.dropRecorder()
    this.o.onLevel(0)
    this.o.onPhase('speaking')
    await this.o.speak(key)
    if (gen === this.generation) this.listen()
  }

  /** 這句說完了：停錄、解碼、截出說話的那段、播回去 */
  private async capture(onsetAt: number, lastLoudAt: number, stopAt: number): Promise<void> {
    const gen = this.generation
    const rec = this.recorder
    this.recorder = null
    this.deaf = true
    this.o.onPhase('thinking')
    this.o.onLevel(0)
    if (!rec) return this.listen()
    const blob = await new Promise<Blob | null>((res) => {
      const parts: Blob[] = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) parts.push(e.data)
      }
      rec.onstop = () => res(parts.length ? new Blob(parts, { type: rec.mimeType }) : null)
      rec.onerror = () => res(null)
      try {
        rec.stop()
      } catch {
        res(null)
      }
    })
    if (gen !== this.generation) return
    const c = getAudioContext()
    if (!blob || !c) return this.listen()
    let buffer: AudioBuffer | null = null
    try {
      const bytes = await blob.arrayBuffer()
      if (gen !== this.generation) return
      buffer = await new Promise<AudioBuffer>((res, rej) => void c.decodeAudioData(bytes, res, rej))
    } catch {
      /* 解不開（錄到空的）就當沒聽到，繼續聽 */
    }
    if (gen !== this.generation) return
    if (!buffer) return this.listen()
    const range = speechRange(buffer.getChannelData(0), buffer.sampleRate, speechWindow(buffer.duration, { onsetAt, lastLoudAt, stopAt }))
    if (!range) return this.listen()
    this.play(c, buffer, range.start, range.end - range.start, range.peak)
  }

  private play(c: AudioContext, buffer: AudioBuffer, offset: number, duration: number, peak: number): void {
    if (c.state !== 'running') void c.resume()?.catch?.(() => {})
    const src = c.createBufferSource()
    const gain = c.createGain()
    const comp = c.createDynamicsCompressor()
    const analyser = c.createAnalyser()
    src.buffer = buffer
    src.playbackRate.value = this.o.rate
    gain.gain.value = playbackGain(peak)
    analyser.fftSize = 512
    src.connect(gain)
    gain.connect(comp)
    comp.connect(analyser)
    analyser.connect(c.destination)
    this.playback = { src, nodes: [src, gain, comp, analyser], analyser }
    this.o.onPhase('playing')
    const gen = this.generation
    let ended = false
    const finish = () => {
      if (ended || gen !== this.generation) return
      ended = true
      this.stopPlayback()
      this.o.onLevel(0)
      this.rounds++
      this.o.onRound(this.rounds)
      this.listenSince = performance.now()
      // 第一句學完邀孩子再說；之後不每次都說，會很煩
      if (this.rounds === 1) void this.sayThenListen(AGAIN_LINE)
      else this.listen()
    }
    src.onended = finish
    src.start(0, offset, duration)
    // onended 在 iOS 被打斷時可能不會來
    this.later(finish, (duration / this.o.rate) * 1000 + 500)
  }

  private stopPlayback(): void {
    const p = this.playback
    this.playback = null
    if (!p) return
    p.src.onended = null
    try {
      p.src.stop()
    } catch {
      /* 已經停了 */
    }
    try {
      // 放開聲音資料，播完就丟
      p.src.buffer = null
    } catch {
      /* Safari 不讓清 buffer 也沒關係：節點斷開後就會被回收 */
    }
    p.nodes.forEach(stopNode)
  }
}
