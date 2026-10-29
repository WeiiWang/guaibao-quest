import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUESTIONS } from './bank'
import { feedbackLines } from './feedbackLines'
import { allLines, GENTLE_PREFIX, gentleHintText, pickLine, staticLineList } from './lines'
import { playLines } from './playLines'
import { baseKey, forSpecies, isNamedLineKey, isPetVoiceKey, keySpecies, namedLineKeys, PET_VOICE_PREFIXES, speciesKey, speciesLines, speciesNameKey } from './speciesLines'

const base = { ...allLines(QUESTIONS), ...feedbackLines(), ...playLines() }

describe('v7.5 語音：旁白去名字', () => {
  it('溫和提示的開頭不提寵物名字（三種寵物共用同一批音檔）', () => {
    expect(GENTLE_PREFIX).toBe('沒關係喔，我陪你一起看。')
    expect(gentleHintText('看看這裡。')).toBe('沒關係喔，我陪你一起看。看看這裡。答案在這裡，點點看。')
    expect(Object.values(base).some((t) => t.includes('沒關係喔，有阿悟陪你。'))).toBe(false)
  })
})

describe('v7.5 語音：物種後綴的 key', () => {
  it('key 加後綴、去後綴', () => {
    expect(speciesKey('praise.gentle.3', 'rabbit')).toBe('praise.gentle.3@rabbit')
    expect(speciesKey('praise.gentle.3', 'monkey')).toBe('praise.gentle.3')
    expect(baseKey('pet.bubble.1@tiger')).toBe('pet.bubble.1')
    expect(baseKey('pet.bubble.1')).toBe('pet.bubble.1')
    expect(keySpecies('pet.bubble.1@tiger')).toBe('tiger')
    expect(keySpecies('pet.bubble.1')).toBe('monkey')
  })
  it('PET_VOICE_PREFIXES 跟 gen_voice.py 的 PET_KEYS 一致', () => {
    const py = readFileSync(join(__dirname, '../../design/tools/gen_voice.py'), 'utf8')
    const m = /^PET_KEYS = \(([^)]*)\)/m.exec(py)
    expect(m).not.toBeNull()
    const keys = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1])
    expect(keys).toEqual([...PET_VOICE_PREFIXES])
  })
  it('gen_voice.py 有兔兔、虎虎的寵物聲（同一位底音改音高）', () => {
    const py = readFileSync(join(__dirname, '../../design/tools/gen_voice.py'), 'utf8')
    expect(py).toMatch(/'awu-rabbit': \{[^}]*'pitch': 1\.6[^}]*'species': 'rabbit'/)
    expect(py).toMatch(/'awu-tiger': \{[^}]*'pitch': 1\.25, 'tempo': 1\.0[^}]*'species': 'tiger'/)
  })
  it('需要唸名字的句子：提到阿悟的固定台詞，不含寵物自己說的、生活題、阿悟著色頁的商店句', () => {
    const named = namedLineKeys()
    expect(named).toContain('praise.gentle.3')
    expect(named).toContain('placement.done')
    expect(named).toContain('leave.ask')
    expect(named).toContain('gentle.wrong.2')
    expect(named).toContain('ui.hat.wear.1')
    expect(named).toContain('ui.album.card.1')
    expect(named).not.toContain('pet.dots.done.12') // 寵物自己說的（連連看「阿悟」那一頁），文字不變
    expect(named.every((k) => !k.startsWith('q.') && !k.startsWith('fb.'))).toBe(true)
    expect(named).toHaveLength(30)
    expect(isNamedLineKey('praise.gentle.3@rabbit')).toBe(true)
    expect(isNamedLineKey('praise.gentle.1')).toBe(false)
  })
  it('匯出：猴子維持原 key 與原文字；兔兔、虎虎各一份（寵物台詞文字不變、名字句換名字）', () => {
    const extra = speciesLines(base)
    // 不會改到原本的 key
    for (const k of Object.keys(extra)) expect(k in base, k).toBe(false)
    const pet = Object.keys(base).filter(isPetVoiceKey)
    expect(pet.length).toBeGreaterThan(100)
    for (const k of pet) {
      expect(extra[`${k}@rabbit`], k).toBe(base[k])
      expect(extra[`${k}@tiger`], k).toBe(base[k])
    }
    // 台詞裡提到香蕉、阿悟的保留原文
    expect(extra['pet.dots.done.12@rabbit']).toBe('哇，是阿悟！你連出來了！')
    expect(extra['ui.gift.food.3@tiger']).toBe('我在路上撿到一根香蕉，送給你！')
    expect(extra['praise.gentle.3@rabbit']).toBe('太棒了，兔兔好開心！')
    expect(extra['praise.gentle.3@tiger']).toBe('太棒了，虎虎好開心！')
    expect(extra['ui.hat.wear.6@rabbit']).toBe('兔兔戴上了皇冠！')
    expect(extra['praise.gentle.1@rabbit']).toBeUndefined() // 不提名字的旁白不用另錄
    // 生活題（圖裡畫的就是阿悟）、阿悟著色頁的商店句不另錄
    expect(Object.keys(extra).some((k) => k.startsWith('q.') || k.startsWith('word.') || k.startsWith('fb.'))).toBe(false)
    expect(extra[speciesNameKey('rabbit')]).toBe('兔兔')
    expect(Object.keys(extra)).toHaveLength(pet.length * 2 + 30 * 2 + 3)
  })
  it('畫面用 forSpecies：名字句換成兔兔的 key 與文字；猴子、不提名字的原樣', () => {
    const l = pickLine('praise.gentle', 2)
    expect(forSpecies(l, 'rabbit')).toEqual({ key: 'praise.gentle.3@rabbit', text: '太棒了，兔兔好開心！' })
    expect(forSpecies(l, 'monkey')).toBe(l)
    const p = pickLine('praise.gentle', 0)
    expect(forSpecies(p, 'tiger')).toBe(p)
    const pet = pickLine('companion.open', 0)
    expect(forSpecies(pet, 'tiger')).toBe(pet) // 寵物台詞的文字一樣，由 say() 依物種挑音檔
    // 每一句物種版本都等於 forSpecies 算出來的（畫面與匯出一字不差）
    const extra = speciesLines(base)
    for (const l of staticLineList()) {
      const r = forSpecies(l, 'rabbit')
      if (r !== l) expect(extra[r.key], r.key).toBe(r.text)
    }
  })
})

// ---------- 播放：依物種挑音檔，找不到才退回原 key ----------
class FakeAudio {
  static last: FakeAudio | null = null
  src = ''
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    FakeAudio.last = this
  }
  play() {
    return new Promise<void>(() => {})
  }
  pause() {}
}
const spoken: string[] = []
beforeEach(() => {
  spoken.length = 0
  FakeAudio.last = null
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  vi.stubGlobal('speechSynthesis', { cancel: () => {}, getVoices: () => [], speak: (u: { text: string }) => spoken.push(u.text) })
  vi.resetModules()
})
afterEach(() => vi.unstubAllGlobals())

describe('v7.5 播放：依目前孩子的物種挑音檔', () => {
  const manifest = {
    'pet.bubble.1': { url: 'awu.m4a', text: '嘻嘻' },
    'pet.bubble.1@rabbit': { url: 'rabbit.m4a', text: '嘻嘻' },
    'praise.gentle.3': { url: 'awu-named.m4a', text: '太棒了，阿悟好開心！' },
    'praise.gentle.3@tiger': { url: 'tiger-named.m4a', text: '太棒了，虎虎好開心！' },
    'ui.hat.wear.1@rabbit': { url: 'rabbit-hat.m4a', text: '兔兔戴上了派對帽！' },
  }
  it('舊孩子（沒設定 = 猴子）：照舊播原 key 的檔', async () => {
    const sp = await import('./speech')
    sp.registerLineAudio(manifest)
    expect(sp.getVoiceSpecies()).toBe('monkey')
    sp.say('pet.bubble.1', '嘻嘻')
    expect(FakeAudio.last?.src).toBe('awu.m4a')
    sp.say('praise.gentle.3', '太棒了，阿悟好開心！')
    expect(FakeAudio.last?.src).toBe('awu-named.m4a')
    expect(sp.voiceCandidates('pet.bubble.1')).toEqual(['pet.bubble.1'])
  })
  it('兔兔：寵物台詞播 @rabbit；虎虎沒有那一份就退回猴子那份', async () => {
    const sp = await import('./speech')
    sp.registerLineAudio(manifest)
    sp.setVoiceSpecies('rabbit')
    expect(sp.voiceCandidates('pet.bubble.1')).toEqual(['pet.bubble.1@rabbit', 'pet.bubble.1'])
    sp.say('pet.bubble.1', '嘻嘻')
    expect(FakeAudio.last?.src).toBe('rabbit.m4a')
    // 頭上泡泡只播預錄：用原文找到原 key，再依物種挑
    expect(sp.sayRecorded('pet.', '嘻嘻')).toBe(true)
    expect(FakeAudio.last?.src).toBe('rabbit.m4a')
    sp.setVoiceSpecies('tiger')
    sp.say('pet.bubble.1', '嘻嘻')
    expect(FakeAudio.last?.src).toBe('awu.m4a')
  })
  it('名字句：有這個物種的錄音就播；沒有就用機器聲唸換過名字的文字（不會播出「阿悟」）', async () => {
    const sp = await import('./speech')
    sp.registerLineAudio(manifest)
    sp.setVoiceSpecies('tiger')
    sp.say('praise.gentle.3@tiger', '太棒了，虎虎好開心！')
    expect(FakeAudio.last?.src).toBe('tiger-named.m4a')
    sp.setVoiceSpecies('rabbit')
    const before = FakeAudio.last?.src
    sp.say('praise.gentle.3@rabbit', '太棒了，兔兔好開心！')
    expect(FakeAudio.last?.src).toBe(before) // 沒換檔
    expect(spoken.at(-1)).toBe('太棒了，兔兔好開心！')
    // 沒有 key 的句子（帽子、新招、回憶卡用 pet.name 組出來的）：依原文找到兔兔那份
    sp.sayText('兔兔戴上了派對帽！')
    expect(FakeAudio.last?.src).toBe('rabbit-hat.m4a')
  })
})
