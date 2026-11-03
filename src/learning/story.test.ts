import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHAPTERS } from './chapter'
import { forSpecies, speciesLines } from './speciesLines'
import { staticLineList } from './lines'
import {
  allChaptersCleared,
  finaleSeen,
  isStoryId,
  pageCapMs,
  pageLine,
  pageReadMs,
  STORIES,
  STORY_CHAPTERS,
  STORY_ORDER,
  storiesAfterChest,
  storiesBeforeStage,
  storyChapterOf,
  storyLabel,
  storyUnlocked,
  withPrologue,
  type StoryId,
} from './story'

const started = (chapterId: string) => ({ chapterId, stations: [{ done: true, independent: 0, total: 0 }, { done: false, independent: 0, total: 0 }], completedRuns: 0, chestClaimed: false })
const fresh = (chapterId: string) => ({ chapterId, stations: [{ done: false, independent: 0, total: 0 }], completedRuns: 0, chestClaimed: false })
const cleared = (chapterId: string) => ({ chapterId, stations: [{ done: true, independent: 0, total: 0 }], completedRuns: 1, chestClaimed: true })
const allCleared = () => CHAPTERS.map((c) => cleared(c.id))

describe('線 P 故事內容', () => {
  it('五章（CHAPTERS）都有對照；12 個故事各兩頁', () => {
    expect(STORY_CHAPTERS.map((c) => c.chapterId).sort()).toEqual(CHAPTERS.map((c) => c.id).sort())
    expect(STORY_ORDER).toHaveLength(12)
    for (const id of STORY_ORDER) expect(STORIES[id]).toHaveLength(2)
  })

  it('旁白和 SPEC-v8 台詞表一字不差（24 句、順序照表）', () => {
    const spec = readFileSync(join(__dirname, '../../SPEC-v8.md'), 'utf8')
    const table = [...spec.slice(spec.indexOf('### 線 P'), spec.indexOf('### 線 Q')).matchAll(/^\| (.+?) (\d) \| (.+?) \|$/gm)].map((m) => ({ page: `${m[1]} ${m[2]}`, text: m[3] }))
    expect(table).toHaveLength(24)
    const specNameOf = (id: StoryId) => (id === 'prologue' ? '序章' : id === 'finale' ? '終章' : `${STORY_CHAPTERS.find((c) => id.startsWith(c.key))?.name} ${id.endsWith('open') ? '開場' : '結尾'}`)
    const got = STORY_ORDER.flatMap((id) => STORIES[id].map((p, i) => ({ page: `${specNameOf(id)} ${i + 1}`, text: pageLine(p).text })))
    // 表裡五章的順序是花果山、水簾洞、英文小島、生活小鎮、自然森林，跟 STORY_CHAPTERS 一樣
    expect(got).toEqual(table)
  })

  it('每一頁的語音 key 都有台詞；提到阿悟的句子有兔兔、虎虎版本（走媽媽聲）', () => {
    const lines = Object.fromEntries(staticLineList().map((l) => [l.key, l.text]))
    const named: string[] = []
    for (const id of STORY_ORDER) {
      for (const p of STORIES[id]) {
        const l = pageLine(p)
        expect(lines[l.key]).toBe(l.text)
        expect(l.text).not.toBe('')
        if (l.text.includes('阿悟')) {
          named.push(l.key)
          expect(forSpecies(l, 'monkey')).toEqual(l)
          expect(forSpecies(l, 'rabbit')).toEqual({ key: `${l.key}@rabbit`, text: l.text.replaceAll('阿悟', '兔兔') })
          expect(forSpecies(l, 'tiger')).toEqual({ key: `${l.key}@tiger`, text: l.text.replaceAll('阿悟', '虎虎') })
        } else {
          expect(forSpecies(l, 'rabbit')).toEqual(l)
        }
      }
    }
    expect(named).toEqual(['story.prologue.2', 'story.shuiliandong.open.2', 'story.finale.2'])
    const sp = speciesLines(lines)
    for (const k of named) {
      expect(sp[`${k}@rabbit`]).toContain('兔兔')
      expect(sp[`${k}@tiger`]).toContain('虎虎')
    }
  })

  it('圖檔名照美術清單；書架標題；id 檢查', () => {
    expect(STORIES.prologue.map((p) => p.art)).toEqual(['story-prologue-1', 'story-prologue-2'])
    expect(STORIES['english-close'].map((p) => p.art)).toEqual(['story-english-close-1', 'story-english-close-2'])
    expect(STORIES.finale.map((p) => p.art)).toEqual(['story-finale-1', 'story-finale-2'])
    expect(storyLabel('life-open')).toBe('生活小鎮・開場')
    expect(storyLabel('finale')).toBe('終章')
    expect(isStoryId('nature-close')).toBe(true)
    expect(isStoryId('nature')).toBe(false)
    expect(storyChapterOf('english-island')?.key).toBe('english')
    expect(storyChapterOf('replay:huaguoshan')).toBeUndefined()
  })
})

describe('線 P 觸發規則', () => {
  it('第一次看任何故事先演序章', () => {
    expect(withPrologue(['life-open'], [])).toEqual(['prologue', 'life-open'])
    expect(withPrologue(['life-open'], ['prologue'])).toEqual(['life-open'])
    expect(withPrologue(['prologue'], [])).toEqual(['prologue'])
    expect(withPrologue([], [])).toEqual([])
  })

  it('第一次進某章第一站演開場（任何順序），之後不再演', () => {
    expect(storiesBeforeStage('huaguoshan', 1, [], undefined)).toEqual(['prologue', 'huaguoshan-open'])
    expect(storiesBeforeStage('nature-forest', 1, ['prologue', 'huaguoshan-open'], fresh('nature-forest'))).toEqual(['nature-open'])
    expect(storiesBeforeStage('huaguoshan', 1, ['prologue', 'huaguoshan-open'], undefined)).toEqual([])
  })

  it('只有第一站；重玩、每日、挑戰站不演', () => {
    expect(storiesBeforeStage('huaguoshan', 2, [], undefined)).toEqual([])
    expect(storiesBeforeStage('replay:huaguoshan', 1, [], undefined)).toEqual([])
    expect(storiesBeforeStage('daily:math', 1, [], undefined)).toEqual([])
    expect(storiesBeforeStage('challenge:huaguoshan', 1, [], undefined)).toEqual([])
  })

  it('舊存檔：通關過或第一站已過的章節不強迫補演開場', () => {
    expect(storiesBeforeStage('huaguoshan', 1, [], cleared('huaguoshan'))).toEqual([])
    expect(storiesBeforeStage('huaguoshan', 1, [], started('huaguoshan'))).toEqual([])
    expect(storiesBeforeStage('huaguoshan', 1, [], fresh('huaguoshan'))).toEqual(['prologue', 'huaguoshan-open'])
  })

  it('寶箱開完演結尾；看過不重演；沒看過序章要先補', () => {
    const one = [cleared('huaguoshan')]
    expect(storiesAfterChest('huaguoshan', ['prologue', 'huaguoshan-open'], one)).toEqual(['huaguoshan-close'])
    expect(storiesAfterChest('huaguoshan', [], one)).toEqual(['prologue', 'huaguoshan-close'])
    expect(storiesAfterChest('huaguoshan', ['prologue', 'huaguoshan-close'], one)).toEqual([])
  })

  it('五章全破接終章；只演一次；看過結尾但沒看過終章也會演', () => {
    const all = allCleared()
    expect(allChaptersCleared(all)).toBe(true)
    expect(allChaptersCleared(all.slice(1))).toBe(false)
    expect(storiesAfterChest('life-town', ['prologue'], all)).toEqual(['life-close', 'finale'])
    expect(storiesAfterChest('life-town', ['prologue', 'life-close'], all)).toEqual(['finale'])
    expect(storiesAfterChest('life-town', ['prologue', 'life-close', 'finale'], all)).toEqual([])
    expect(storiesAfterChest('life-town', ['prologue'], all.slice(1))).toEqual(['life-close'])
  })

  it('書架：序章永遠開；看過的開；舊存檔通關的章節開場與結尾都開；其他鎖著', () => {
    expect(storyUnlocked('prologue', [], [])).toBe(true)
    expect(storyUnlocked('huaguoshan-open', [], [])).toBe(false)
    expect(storyUnlocked('huaguoshan-open', ['huaguoshan-open'], [])).toBe(true)
    const old = [cleared('huaguoshan')]
    expect(storyUnlocked('huaguoshan-open', [], old)).toBe(true)
    expect(storyUnlocked('huaguoshan-close', [], old)).toBe(true)
    expect(storyUnlocked('life-open', [], old)).toBe(false)
    expect(storyUnlocked('finale', [], old)).toBe(false)
    expect(storyUnlocked('finale', [], allCleared())).toBe(true)
    // 玩到一半：開場開、結尾還沒
    expect(storyUnlocked('huaguoshan-open', [], [started('huaguoshan')])).toBe(true)
    expect(storyUnlocked('huaguoshan-close', [], [started('huaguoshan')])).toBe(false)
  })

  it('終章之後窗外才有星星', () => {
    expect(finaleSeen(undefined)).toBe(false)
    expect(finaleSeen(['prologue'])).toBe(false)
    expect(finaleSeen(['finale'])).toBe(true)
  })
})

describe('線 P 翻頁時間', () => {
  it('上限一定長過音檔（gen_voice 的 max_len），也不會無限久', () => {
    for (const id of STORY_ORDER) {
      for (const p of STORIES[id]) {
        const t = pageLine(p).text
        expect(pageCapMs(t)).toBeGreaterThan(Math.max(3, t.length * 0.45 + 1.5) * 1000)
        expect(pageCapMs(t)).toBeLessThan(25_000)
        expect(pageReadMs(t)).toBeGreaterThanOrEqual(4500)
        expect(pageReadMs(t)).toBeLessThan(pageCapMs(t))
      }
    }
  })
})
