import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 語音播放時壓低背景音樂：機器語音開始 → duck(true)，結束 → duck(false)；被取消的上一句晚到的結束不能放開新那句
const duck = vi.fn()
type U = { onstart?: () => void; onend?: () => void; onerror?: () => void }
let utterances: U[] = []

beforeEach(() => {
  duck.mockClear()
  utterances = []
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      onstart?: () => void
      onend?: () => void
      onerror?: () => void
      constructor(public text: string) {}
    },
  )
  vi.stubGlobal('speechSynthesis', { cancel: () => {}, getVoices: () => [], speak: (u: U) => utterances.push(u) })
  vi.resetModules()
  vi.doMock('./audioEngine', () => ({ duckMusic: (on: boolean) => duck(on) }))
})
afterEach(() => {
  vi.doUnmock('./audioEngine')
  vi.unstubAllGlobals()
})

describe('語音時壓低音樂（機器語音）', () => {
  it('開始唸就壓低，唸完放開，並照常呼叫呼叫端的 onEnd', async () => {
    const sp = await import('./speech')
    const onEnd = vi.fn()
    expect(sp.speak('你好', { onEnd })).toBe(true)
    expect(duck).not.toHaveBeenCalled() // 還沒真的出聲
    utterances[0].onstart?.()
    expect(duck).toHaveBeenLastCalledWith(true)
    utterances[0].onend?.()
    expect(duck).toHaveBeenLastCalledWith(false)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('沒有 onEnd 也會放開；出錯也會放開', async () => {
    const sp = await import('./speech')
    sp.speak('一')
    utterances[0].onstart?.()
    utterances[0].onerror?.()
    expect(duck).toHaveBeenLastCalledWith(false)
  })

  it('連續兩句：被取消的上一句晚到的 end 不會把新那句的壓低放掉', async () => {
    const sp = await import('./speech')
    sp.speak('第一句')
    sp.speak('第二句')
    utterances[1].onstart?.()
    duck.mockClear()
    utterances[0].onend?.() // 上一句被取消後才送達
    expect(duck).not.toHaveBeenCalledWith(false)
    utterances[1].onend?.()
    expect(duck).toHaveBeenLastCalledWith(false)
  })

  it('cancelSpeech 放開壓低', async () => {
    const sp = await import('./speech')
    sp.speak('一')
    utterances[0].onstart?.()
    sp.cancelSpeech()
    expect(duck).toHaveBeenLastCalledWith(false)
  })

  it('關掉語音（enabled:false）不壓低', async () => {
    const sp = await import('./speech')
    sp.speak('一', { enabled: false })
    expect(duck).not.toHaveBeenCalled()
  })
})
