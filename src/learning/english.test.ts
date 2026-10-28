import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QUESTIONS, questionsFor } from './bank'
import { EN_BY_WORD, EN_GENTLE_WORDS, EN_LANG, EN_LETTERS, EN_WORDS, enKey, englishLines, type EnWord } from './english'
import { englishAnswerParts, englishHintParts, englishPromptParts } from './englishSpeech'
import { feedbackLines } from './feedbackLines'
import { allLines } from './lines'
import { displayQuestion } from './select'
import { cancelSpeech, pickEnglishVoice, pickVoiceFor, registerLineAudio, say, sayChain, sayEnglish, speak } from './speech'
import { DIFFICULTIES, type Choice, type Question } from './types'

const EN = QUESTIONS.filter((q) => q.skill === 'english')
const standard = EN.filter((q) => !q.gentle)
const gentle = EN.filter((q) => q.gentle)
const cellOf = (q: Question) => `${q.difficulty}${q.gentle ? 'g' : ''}`

/** 圖 / 色塊 / 數字卡 → 它代表的單字（獨立於題庫的 id 欄位，用來驗證「單字與圖片對應」） */
function wordOfStem(s: { art?: string; swatch?: string; digit?: string }): EnWord[] {
  return EN_WORDS.filter((w) => (s.art && w.art === s.art) || (s.swatch && w.swatch === s.swatch) || (s.digit && w.digit === s.digit))
}
function wordOfChoice(c: Choice): EnWord[] {
  if (c.text !== undefined) return EN_WORDS.filter((w) => w.word === c.text)
  return wordOfStem({ art: c.art, swatch: c.swatch, digit: c.label })
}
const ZH_TEMPLATES = [(z: string) => `${z}，用英文怎麼說？`, (z: string) => `哪一個是${z}的英文？`, (z: string) => `找出${z}的英文字。`]

/** 獨立解題：不看 answer 欄位，從題幹算出正解單字，回傳所有「說得通」的選項 id */
function solve(q: Question): string[] {
  const p = q.params!
  switch (q.type) {
    case 'hear':
      // 聽到的單字 → 圖片（或色塊、數字卡）要對上這個單字
      return q.choices.filter((c) => wordOfChoice(c).some((w) => w.word === p.word)).map((c) => c.id)
    case 'pic2en': {
      const target = wordOfStem(p.stem!)
      expect(target, q.id).toHaveLength(1)
      return q.choices.filter((c) => c.text === target[0].word).map((c) => c.id)
    }
    case 'zh2en': {
      const target = EN_WORDS.filter((w) => ZH_TEMPLATES.some((t) => t(w.zh) === q.prompt))
      expect(target, q.id).toHaveLength(1)
      return q.choices.filter((c) => c.text === target[0].word).map((c) => c.id)
    }
    case 'spell': {
      const target = wordOfStem(p.stem!)
      expect(target, q.id).toHaveLength(1)
      return q.choices.filter((c) => p.pattern!.replace('_', c.text!) === target[0].word).map((c) => c.id)
    }
    default:
      throw new Error(`${q.id} 不是英文題型`)
  }
}

describe('英文題庫完整性', () => {
  it('四個難度每格 >= 36 題；幼幼專用題 >= 16 題；id 不重複且以 english-<難度>- 開頭', () => {
    for (const d of DIFFICULTIES) expect(questionsFor('english', d).length, `d${d}`).toBeGreaterThanOrEqual(36)
    expect(gentle.length).toBeGreaterThanOrEqual(16)
    expect(new Set(EN.map((q) => q.id)).size).toBe(EN.length)
    for (const q of EN) expect(q.id.startsWith(`english-${q.difficulty}-`), q.id).toBe(true)
    expect(EN.length).toBeGreaterThanOrEqual(190)
  })
  it('單字表：美術檔都存在、單字不重複、圖／色塊／數字各自唯一（單字與圖片一對一）', () => {
    expect(new Set(EN_WORDS.map((w) => w.word)).size).toBe(EN_WORDS.length)
    const arts = EN_WORDS.filter((w) => w.art).map((w) => w.art!)
    expect(new Set(arts).size).toBe(arts.length)
    for (const a of arts) expect(existsSync(join(process.cwd(), 'public/art', `${a}.png`)), a).toBe(true)
    const sw = EN_WORDS.filter((w) => w.swatch).map((w) => w.swatch)
    expect(new Set(sw).size).toBe(sw.length)
    expect(EN_WORDS.filter((w) => w.kind === 'thing')).toHaveLength(22)
    expect(EN_WORDS.filter((w) => w.kind === 'color').map((w) => w.word)).toEqual(['red', 'yellow', 'blue', 'green', 'pink', 'purple'])
    expect(EN_WORDS.filter((w) => w.kind === 'number').map((w) => w.word)).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'])
    for (const w of EN_GENTLE_WORDS) expect(EN_BY_WORD[w]?.kind, w).toBe('thing')
  })
  it('每題恰好一個正解，且與獨立解題邏輯一致', () => {
    for (const q of EN) expect(solve(q), q.id).toEqual([q.answer])
  })
  it('單字與圖片對應：每個選項的圖（或色塊、數字）就是它 id 那個單字', () => {
    for (const q of EN)
      for (const c of q.choices) {
        if (q.type === 'hear') expect(wordOfChoice(c).map((w) => w.word), `${q.id} ${c.id}`).toEqual([c.id])
        else expect(c.text, `${q.id} ${c.id}`).toBe(c.id)
      }
    // 題幹的圖也對得上 params.word（hear 沒有題幹圖）
    for (const q of EN.filter((x) => x.params?.stem)) expect(wordOfStem(q.params!.stem!).map((w) => w.word), q.id).toEqual([q.params!.word])
  })
  it('多屬性檢查：選項一律同一類（不會拿顏色字當物件圖的干擾項、也不會數字混物件）；沒有重複的單字', () => {
    for (const q of EN) {
      const kinds = new Set(q.choices.map((c) => (q.type === 'spell' ? 'letter' : EN_BY_WORD[c.id].kind)))
      expect(kinds.size, q.id).toBe(1)
      expect(new Set(q.choices.map((c) => c.id)).size, q.id).toBe(q.choices.length)
      if (q.type !== 'spell') {
        // 題幹的單字與所有選項同類（看圖選單字時，圖是物件，選項就不能有「yellow」）
        const w = EN_BY_WORD[q.params!.word!]
        expect([...kinds][0], q.id).toBe(w.kind)
      }
    }
  })
  it('拼字題：只缺一個字母，補上正解字母剛好拼成單字，別的字母都拼不成', () => {
    const spell = EN.filter((q) => q.type === 'spell')
    expect(spell.length).toBeGreaterThanOrEqual(36)
    for (const q of spell) {
      expect(q.params!.pattern!.split('_'), q.id).toHaveLength(2)
      expect(q.params!.pattern!.length, q.id).toBe(q.params!.word!.length)
      expect(q.params!.pattern!.indexOf('_'), q.id).toBe(q.params!.blankAt)
      expect(q.params!.word!.length, q.id).toBeLessThanOrEqual(5)
      expect(q.choices).toHaveLength(3)
      for (const c of q.choices) expect(c.text, q.id).toMatch(/^[a-z]$/)
    }
    // 缺字母的位置不是永遠同一個
    expect(new Set(spell.map((q) => q.params!.blankAt)).size).toBeGreaterThanOrEqual(3)
  })
  it('答案位置平均；數字選項由小到大', () => {
    for (const cellId of new Set(EN.map(cellOf))) {
      const qs = EN.filter((q) => cellOf(q) === cellId)
      const k = qs[0].choices.length
      const pos = Array(k).fill(0)
      for (const q of qs) pos[q.choices.findIndex((c) => c.id === q.answer)]++
      const floor = Math.floor((qs.length / k) * 0.6)
      expect(Math.min(...pos), `${cellId} ${pos}`).toBeGreaterThanOrEqual(floor)
      expect(Math.max(...pos), `${cellId} ${pos}`).toBeLessThanOrEqual(Math.ceil((qs.length / k) * 1.5))
    }
    for (const q of EN) {
      const nums = q.choices.filter((c) => c.label !== undefined).map((c) => Number(c.label))
      if (nums.length) expect(nums, q.id).toEqual([...nums].sort((a, b) => a - b))
    }
  })
  it('同一格沒有重複的題面（題目 + 單字 + 缺的位置 + 答案）；每種題型有 >= 2 種句型', () => {
    for (const cellId of new Set(EN.map(cellOf))) {
      const qs = EN.filter((q) => cellOf(q) === cellId)
      const sig = qs.map((q) => JSON.stringify([q.type, q.prompt, q.params?.word, q.params?.pattern, q.answer]))
      expect(new Set(sig).size, cellId).toBe(qs.length)
      for (const type of new Set(qs.map((q) => q.type))) {
        const mine = qs.filter((q) => q.type === type)
        if (mine.length < 8) continue
        const shapes = new Set(mine.map((q) => q.prompt.replace(new RegExp(EN_WORDS.map((w) => w.zh).join('|'), 'g'), '○')))
        expect(shapes.size, `${cellId} ${type}`).toBeGreaterThanOrEqual(2)
      }
    }
  })
  it('各難度的題型：1 聽英文選圖（物件）、2 顏色數字與看圖選單字、3 聽中文選單字、4 拼字；全部 3 選 1', () => {
    const types = (d: number) => new Set(questionsFor('english', d as 1).map((q) => q.type))
    expect(types(1)).toEqual(new Set(['hear', 'pic2en', 'zh2en'])) // v7：難度 1 除了聽英文選圖，也有看圖選字與中翻英
    expect(types(2)).toEqual(new Set(['hear', 'pic2en']))
    expect(types(3)).toEqual(new Set(['zh2en', 'pic2en']))
    expect(types(4)).toEqual(new Set(['spell']))
    for (const q of questionsFor('english', 1)) expect(EN_BY_WORD[q.params!.word!].kind).toBe('thing')
    for (const q of standard) expect(q.choices, q.id).toHaveLength(3)
    // 顏色與數字都有出現；每個單字至少在題庫出現過一次
    const used = new Set(EN.map((q) => q.params!.word))
    for (const w of EN_WORDS) expect(used.has(w.word), w.word).toBe(true)
    expect(questionsFor('english', 2).some((q) => q.type === 'hear' && q.choices[0].swatch)).toBe(true)
    expect(questionsFor('english', 2).some((q) => q.type === 'hear' && q.choices[0].label !== undefined)).toBe(true)
  })
  it('幼幼模式（3 歲）：聽英文選圖 2 選 1，限定最常見的字；一般模式不會抽到', () => {
    for (const q of gentle) {
      expect(q.type).toBe('hear')
      expect(q.difficulty).toBe(1)
      expect(q.choices, q.id).toHaveLength(2)
      for (const c of q.choices) expect(EN_GENTLE_WORDS, q.id).toContain(c.id)
    }
    expect(questionsFor('english', 1, QUESTIONS, true).every((q) => q.gentle)).toBe(true)
    for (const d of DIFFICULTIES) expect(questionsFor('english', d).some((q) => q.gentle)).toBe(false)
  })
  it('displayQuestion：選項順序穩定，數字選項維持由小到大，幼幼模式縮成 2 選 1', () => {
    const num = standard.find((q) => q.type === 'hear' && q.choices[0].label !== undefined)!
    const a = displayQuestion(num, 's1')
    expect(a.choices.map((c) => c.id)).toEqual(num.choices.map((c) => c.id))
    const t = standard.find((q) => q.type === 'zh2en')!
    expect(displayQuestion(t, 's1').choices).toEqual(displayQuestion(t, 's1').choices)
    const g = displayQuestion(t, 's1', true)
    expect(g.choices).toHaveLength(2)
    expect(g.choices.map((c) => c.id)).toContain(t.answer)
  })
  it('用字：提示不用括號，中文旁白不夾英文字母（英文單字在 params.word，由英文語音唸）', () => {
    for (const q of EN) {
      expect(q.prompt + q.hint, q.id).not.toMatch(/[A-Za-z「」]/)
      expect(q.params!.word, q.id).toBeTruthy()
    }
    expect(JSON.stringify(EN)).not.toMatch(/粉色/)
  })
})

describe('英文語音：key、語言、清單', () => {
  it('英文單字清單：key 是 en.<word>、文字就是單字；和中文清單分開，key 不衝突', () => {
    const en = englishLines()
    expect(Object.keys(en)).toHaveLength(EN_WORDS.length + EN_LETTERS.length) // v7.2：連連看字母版的 A–Z
    expect(en[enKey('apple')]).toBe('apple')
    expect(en['en.ten']).toBe('ten')
    const zh = allLines(QUESTIONS)
    expect(Object.keys(en).filter((k) => k in zh)).toEqual([])
    // 英文題的中文旁白（題目、提示、幼幼提示）有進中文清單
    for (const q of EN) {
      expect(zh[`q.${q.id}.prompt`]).toBe(q.prompt)
      expect(zh[`q.${q.id}.hint`]).toBe(q.hint)
    }
    expect(EN_LANG).toBe('en-US')
  })
  it('唸什麼：聽英文選圖與拼字在中文題目後接著唸英文；看圖選單字與聽中文選單字不唸（會洩漏答案）；提示一律接著唸英文', () => {
    const hear = standard.find((q) => q.type === 'hear')!
    expect(englishPromptParts(hear).map((p) => p.key)).toEqual([`q.${hear.id}.prompt`, enKey(hear.params!.word!)])
    expect(englishPromptParts(hear)[1]).toMatchObject({ text: hear.params!.word, lang: 'en-US' })
    expect(englishPromptParts(hear)[0].lang).toBeUndefined() // 中文旁白走預設語言
    const spell = standard.find((q) => q.type === 'spell')!
    expect(englishPromptParts(spell)).toHaveLength(2)
    for (const t of ['pic2en', 'zh2en'] as const) {
      const q = standard.find((x) => x.type === t)!
      expect(englishPromptParts(q)).toHaveLength(1)
      expect(englishHintParts(q, false).map((p) => p.key)).toEqual([`q.${q.id}.hint`, enKey(q.params!.word!)])
      expect(englishHintParts(q, true)[0].key).toBe(`q.${q.id}.hint.gentle`)
      expect(englishAnswerParts(q).map((p) => p.key)).toEqual(['hint.answer', enKey(q.params!.word!)])
    }
  })
  it('node scripts/export-speech-lines.mjs：預設中文（向下相容）、--lang en 英文、--out 兩個檔案', () => {
    const run = (args: string[]) => spawnSync(process.execPath, ['scripts/export-speech-lines.mjs', ...args], { encoding: 'utf8', cwd: process.cwd() })
    const zh = run([])
    expect(zh.status, zh.stderr).toBe(0)
    const zhLines = JSON.parse(zh.stdout) as Record<string, string>
    expect(Object.keys(zhLines).some((k) => k.startsWith('en.'))).toBe(false)
    // v7.2：另外加上商店／工坊的回饋句（feedbackLines）
    expect(zhLines).toEqual({ ...allLines(QUESTIONS), ...feedbackLines() })
    const en = run(['--lang', 'en'])
    expect(JSON.parse(en.stdout)).toEqual(englishLines())
    const all = JSON.parse(run(['--lang', 'all']).stdout) as Record<string, Record<string, string>>
    expect(Object.keys(all)).toEqual(['zh-TW', 'en-US'])
    const dir = mkdtempSync(join(tmpdir(), 'gq-lines-'))
    try {
      const r = run(['--out', join(dir, 'lines.json')])
      expect(r.status, r.stderr).toBe(0)
      expect(JSON.parse(readFileSync(join(dir, 'lines.json'), 'utf8'))).toEqual(zhLines)
      expect(JSON.parse(readFileSync(join(dir, 'lines.en.json'), 'utf8'))).toEqual(englishLines())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000) // 匯出腳本用 Vite 載入商品清單（feedbackLines），每次執行要幾秒，CI 上會超過預設 5 秒
})

// ---------- speech.ts：語言參數與連續唸 ----------
interface FakeU {
  text: string
  lang: string
  rate: number
  voice?: { lang: string; name: string }
  onend?: () => void
  onerror?: () => void
}
const g = globalThis as unknown as Record<string, unknown>
let spoken: FakeU[]
let autoEnd: boolean
let pending: FakeU[]
const VOICES = [
  { lang: 'zh_TW', name: 'Meijia' },
  { lang: 'en_GB', name: 'Daniel' },
  { lang: 'en-US', name: 'Samantha' },
]

beforeEach(() => {
  spoken = []
  pending = []
  autoEnd = true
  registerLineAudio({})
  g.window = globalThis
  g.speechSynthesis = {
    speak: (u: FakeU) => {
      spoken.push(u)
      if (autoEnd) queueMicrotask(() => u.onend?.())
      else pending.push(u)
    },
    cancel: () => {},
    getVoices: () => VOICES,
  }
  g.SpeechSynthesisUtterance = class {
    text: string
    lang = ''
    rate = 1
    pitch = 1
    constructor(t: string) {
      this.text = t
    }
  }
})
afterEach(() => {
  cancelSpeech()
  delete g.window
  delete g.speechSynthesis
  delete g.SpeechSynthesisUtterance
})
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('speech.ts：語言參數（向下相容）', () => {
  it('沒給 lang 還是 zh-TW、挑繁中語音（舊行為不變）', () => {
    expect(speak('你好')).toBe(true)
    expect(spoken[0]).toMatchObject({ lang: 'zh-TW', text: '你好' })
    expect(spoken[0].voice?.name).toBe('Meijia')
  })
  it('lang: en-US：用英語語音（優先 en-US）、語速放慢', () => {
    speak('apple', { lang: 'en-US' })
    expect(spoken[0]).toMatchObject({ lang: 'en-US', text: 'apple' })
    expect(spoken[0].voice?.name).toBe('Samantha')
    expect(spoken[0].rate).toBeLessThan(0.9)
    expect(pickEnglishVoice([{ lang: 'en_GB', name: 'a' }])?.name).toBe('a')
    expect(pickVoiceFor(VOICES, 'zh-TW')?.name).toBe('Meijia')
    expect(pickEnglishVoice([{ lang: 'zh-TW', name: 'z' }])).toBeUndefined()
  })
  it('sayEnglish(word) = say("en.<word>", word, {lang: en-US})：沒有預錄音檔就用 Web Speech 唸英文', () => {
    expect(sayEnglish('banana')).toBe(true)
    expect(spoken[0]).toMatchObject({ lang: 'en-US', text: 'banana' })
    expect(say('q.x.prompt', '哪一個是香蕉？')).toBe(true)
    expect(spoken[1].lang).toBe('zh-TW')
    expect(sayEnglish('banana', { enabled: false })).toBe(false)
  })
})

describe('speech.ts：sayChain 連續唸', () => {
  const parts = [
    { key: 'q.a.prompt', text: '聽聽看' },
    { key: 'en.apple', text: 'apple', lang: 'en-US' },
  ]
  it('依序唸：中文唸完才唸英文，英文用 en-US', async () => {
    expect(sayChain(parts)).toBe(true)
    await flush()
    await flush()
    expect(spoken.map((u) => [u.text, u.lang])).toEqual([['聽聽看', 'zh-TW'], ['apple', 'en-US']])
  })
  it('第一句還沒唸完不會搶先唸第二句', async () => {
    autoEnd = false
    sayChain(parts)
    await flush()
    expect(spoken).toHaveLength(1)
    pending[0].onend?.()
    expect(spoken.map((u) => u.text)).toEqual(['聽聽看', 'apple'])
  })
  it('被別句打斷（say / speak / cancelSpeech / 再呼叫一次）後，剩下的不再唸', async () => {
    autoEnd = false
    sayChain(parts)
    const first = pending[0]
    say('praise.1', '答對了！') // 打斷
    first.onerror?.() // 被取消的那句會觸發 onerror
    await flush()
    expect(spoken.map((u) => u.text)).toEqual(['聽聽看', '答對了！'])
    sayChain(parts)
    cancelSpeech()
    pending[2].onend?.()
    expect(spoken.map((u) => u.text)).toEqual(['聽聽看', '答對了！', '聽聽看'])
    sayChain(parts)
    sayChain([{ key: 'k', text: '另一句' }])
    pending[3].onend?.()
    expect(spoken.map((u) => u.text).slice(-2)).toEqual(['聽聽看', '另一句'])
  })
  it('家長關語音：什麼都不唸；沒有語音支援也不會出錯', () => {
    expect(sayChain(parts, { enabled: false })).toBe(false)
    expect(spoken).toHaveLength(0)
    delete g.speechSynthesis
    expect(() => sayChain(parts)).not.toThrow()
  })
})
