import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 假的播放器：play() 回傳的 promise 由測試控制；換 src 時上一個 play() 以 AbortError 失敗（跟瀏覽器一樣） */
class FakeAudio {
  static last: FakeAudio | null = null
  src = ''
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  paused = true
  private reject: ((e: unknown) => void) | null = null
  constructor() {
    FakeAudio.last = this
    return new Proxy(this, {
      set(t, k, v) {
        if (k === 'src' && t.reject) {
          t.reject(new DOMException('The play() request was interrupted by a new load request.', 'AbortError'))
          t.reject = null
        }
        ;(t as unknown as Record<string | symbol, unknown>)[k] = v
        return true
      },
    })
  }
  play() {
    this.paused = false
    return new Promise<void>((_res, rej) => (this.reject = rej))
  }
  pause() {
    this.paused = true
  }
  failNow(name = 'NotSupportedError') {
    this.reject?.(new DOMException('fail', name))
    this.reject = null
  }
}

const spoken: string[] = []
beforeEach(() => {
  spoken.length = 0
  vi.stubGlobal('window', globalThis) // 測試環境是 node：speech.ts 用 window 判斷瀏覽器能力
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  vi.stubGlobal('speechSynthesis', { cancel: () => {}, getVoices: () => [], speak: (u: { text: string }) => spoken.push(u.text) })
  vi.resetModules()
})
afterEach(() => vi.unstubAllGlobals())

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('say：預錄音檔被下一句打斷', () => {
  it('上一句被打斷時不退回機器語音，也不會停掉新的那句', async () => {
    const sp = await import('./speech')
    sp.registerLineAudio({ a: { url: 'a.m4a', text: '第一句' }, b: { url: 'b.m4a', text: '第二句' } })
    sp.say('a', '第一句')
    sp.say('b', '第二句')
    await flush()
    expect(spoken).toEqual([])
    expect(FakeAudio.last?.src).toBe('b.m4a')
    expect(FakeAudio.last?.paused).toBe(false)
  })

  it('真的播不出來（不是被打斷）才退回機器語音唸同一句', async () => {
    const sp = await import('./speech')
    sp.registerLineAudio({ a: { url: 'a.m4a', text: '第一句' } })
    sp.say('a', '第一句')
    FakeAudio.last?.failNow()
    await flush()
    expect(spoken).toEqual(['第一句'])
  })

  it('沒有錄音的句子記進 __gqVoiceMiss', async () => {
    const sp = await import('./speech')
    sp.registerLineAudio({})
    ;(window as unknown as { __gqVoiceMiss?: unknown[] }).__gqVoiceMiss = []
    sp.sayText('沒有錄過的句子')
    expect((window as unknown as { __gqVoiceMiss: { reason: string; text: string }[] }).__gqVoiceMiss).toEqual([{ reason: 'no-recording', text: '沒有錄過的句子' }])
    expect(spoken).toEqual(['沒有錄過的句子'])
  })
})
