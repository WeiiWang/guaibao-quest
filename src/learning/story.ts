/**
 * v8.1 線 P：有聲繪本「小星的故事」的內容與觸發規則（純函式，不碰資料庫與畫面）。
 *
 * 一個「故事」（StoryId）= 序章、終章，或某章的開場 / 結尾，各兩頁。旁白在 lines.ts 的 story.* 固定台詞，
 * 背景圖是 public/art/story-<key>-<n>.jpg（底部三分之一留給角色與字幕，圖裡沒有畫角色）。
 * 已看過的故事記在 settings.storySeen（optional，舊存檔沒有這欄 = 都沒看過；每個孩子各自一份資料庫，所以各自獨立）。
 */
import { CHAPTERS, chapterCleared } from './chapter'
import { pickLine, type Line } from './lines'
import type { Progress } from './types'

/** 章節在故事裡的短名（圖檔與語音 key 用） */
export type StoryChapterKey = 'huaguoshan' | 'shuiliandong' | 'english' | 'life' | 'nature'
export type StoryId = 'prologue' | 'finale' | `${StoryChapterKey}-open` | `${StoryChapterKey}-close`

/** 寵物姿勢（Companion 的 Pose 的子集）；null = 這一頁不出場 */
export type StoryPose = 'idle' | 'happy' | 'cheer' | 'think' | 'dance' | 'laugh' | 'shy' | 'dizzy' | 'sing'
/** 環境動態（全部 CSS，見 story.css） */
export type StoryFx = 'stars' | 'motes' | 'petals' | 'drops' | 'sparkle' | 'fireflies' | 'confetti'
/** 小星的樣子：dim 暗、hint 微微透出這章的顏色、lit 亮、bright 更亮、five 五色 */
export type StarLook = 'dim' | 'hint' | 'lit' | 'bright' | 'five'
/** 小星這一頁的動作：fall 從天上掉下來、rise 飛回天上 */
export type StarMove = 'fall' | 'rise'

export interface StoryPage {
  /** 所屬故事 */
  story: StoryId
  /** 語音群組：pickLine(group, index) */
  group: string
  index: number
  /** public/art/<art>.jpg */
  art: string
  pose: StoryPose | null
  look: StarLook
  move?: StarMove
  fx: StoryFx
  /** 小星光暈與環境動態的顏色 */
  glow: string
  /** 圖還沒生成或載入失敗時的底色漸層 [上, 下] */
  tint: readonly [string, string]
  /** 直向裁切：畫面要看圖的哪一段（0–100，水平） */
  focus: number
}

/** 五章對照：章節 id → 故事短名、光的顏色、缺圖時的底色 */
export interface StoryChapter {
  chapterId: string
  key: StoryChapterKey
  name: string
  glow: string
  tint: readonly [string, string]
}
export const STORY_CHAPTERS: readonly StoryChapter[] = [
  { chapterId: 'huaguoshan', key: 'huaguoshan', name: '花果山', glow: '#ff86bd', tint: ['#ffc7dc', '#a8d98a'] },
  { chapterId: 'shuiliandong', key: 'shuiliandong', name: '水簾洞', glow: '#62bdff', tint: ['#3b6e96', '#22475f'] },
  { chapterId: 'english-island', key: 'english', name: '英文小島', glow: '#ffd94f', tint: ['#a6def2', '#f4dfa8'] },
  { chapterId: 'life-town', key: 'life', name: '生活小鎮', glow: '#ff9d42', tint: ['#ffdcae', '#d9c49d'] },
  { chapterId: 'nature-forest', key: 'nature', name: '自然森林', glow: '#73e07c', tint: ['#7fbf8a', '#3c7350'] },
]
export const storyChapterOf = (chapterId: string): StoryChapter | undefined => STORY_CHAPTERS.find((c) => c.chapterId === chapterId)

const NIGHT: readonly [string, string] = ['#232a5c', '#3d4a7a']
const DUSK_GLOW = '#aab4dc'

/** 小星五色（終章） */
export const STAR_COLORS: readonly string[] = STORY_CHAPTERS.map((c) => c.glow)

type PagePlan = Pick<StoryPage, 'pose' | 'look' | 'fx'> & Partial<Pick<StoryPage, 'move' | 'focus'>>

const pages = (id: StoryId, group: string, artBase: string, glow: string, tint: readonly [string, string], plan: readonly [PagePlan, PagePlan]): StoryPage[] =>
  plan.map((p, i) => ({ story: id, group, index: i, art: `${artBase}-${i + 1}`, glow, tint, focus: 50, ...p }))

/**
 * 每章的姿勢與環境動態。開場小星還暗（只透出一點這章的顏色），結尾亮起來。
 * focus：直向裁切時要留下的水平位置，依每張圖的主體定的。
 */
const CHAPTER_PLAN: Record<StoryChapterKey, { open: readonly [PagePlan, PagePlan]; close: readonly [PagePlan, PagePlan] }> = {
  huaguoshan: {
    open: [{ pose: 'think', look: 'hint', fx: 'motes' }, { pose: 'happy', look: 'hint', fx: 'motes', focus: 80 }],
    close: [{ pose: 'cheer', look: 'lit', fx: 'petals' }, { pose: 'laugh', look: 'bright', fx: 'petals', focus: 70 }],
  },
  shuiliandong: {
    open: [{ pose: 'shy', look: 'hint', fx: 'drops', focus: 58 }, { pose: 'happy', look: 'hint', fx: 'drops' }],
    close: [{ pose: 'cheer', look: 'lit', fx: 'sparkle' }, { pose: 'laugh', look: 'bright', fx: 'sparkle', focus: 65 }],
  },
  english: {
    open: [{ pose: 'think', look: 'hint', fx: 'motes', focus: 65 }, { pose: 'happy', look: 'hint', fx: 'motes', focus: 90 }],
    close: [{ pose: 'cheer', look: 'lit', fx: 'sparkle', focus: 92 }, { pose: 'dance', look: 'bright', fx: 'sparkle', focus: 80 }],
  },
  life: {
    open: [{ pose: 'dizzy', look: 'hint', fx: 'motes' }, { pose: 'happy', look: 'hint', fx: 'motes', focus: 70 }],
    close: [{ pose: 'happy', look: 'lit', fx: 'sparkle', focus: 72 }, { pose: 'cheer', look: 'bright', fx: 'sparkle' }],
  },
  nature: {
    open: [{ pose: 'shy', look: 'hint', fx: 'fireflies' }, { pose: 'happy', look: 'hint', fx: 'fireflies', focus: 80 }],
    close: [{ pose: 'dance', look: 'lit', fx: 'fireflies' }, { pose: 'cheer', look: 'bright', fx: 'fireflies' }],
  },
}

const buildStories = (): Record<StoryId, StoryPage[]> => {
  const out = {
    prologue: pages('prologue', 'story.prologue', 'story-prologue', DUSK_GLOW, NIGHT, [
      { pose: null, look: 'dim', move: 'fall', fx: 'stars', focus: 20 },
      { pose: 'happy', look: 'dim', fx: 'motes', focus: 70 },
    ]),
    finale: pages('finale', 'story.finale', 'story-finale', '#fff3b0', NIGHT, [
      { pose: 'cheer', look: 'five', fx: 'confetti' },
      { pose: 'happy', look: 'five', move: 'rise', fx: 'stars' },
    ]),
  } as Record<StoryId, StoryPage[]>
  for (const c of STORY_CHAPTERS) {
    const plan = CHAPTER_PLAN[c.key]
    out[`${c.key}-open`] = pages(`${c.key}-open`, `story.${c.key}.open`, `story-${c.key}-open`, c.glow, c.tint, plan.open)
    out[`${c.key}-close`] = pages(`${c.key}-close`, `story.${c.key}.close`, `story-${c.key}-close`, c.glow, c.tint, plan.close)
  }
  return out
}
export const STORIES: Readonly<Record<StoryId, readonly StoryPage[]>> = buildStories()

/** 書架的排列順序 */
export const STORY_ORDER: readonly StoryId[] = ['prologue', ...STORY_CHAPTERS.flatMap((c): StoryId[] => [`${c.key}-open`, `${c.key}-close`]), 'finale']
export const isStoryId = (v: string): v is StoryId => (STORY_ORDER as readonly string[]).includes(v)

/** 書架上的短標題（給家長看；孩子看封面） */
export function storyLabel(id: StoryId): string {
  if (id === 'prologue') return '序章'
  if (id === 'finale') return '終章'
  const [key, part] = id.split('-') as [StoryChapterKey, 'open' | 'close']
  return `${STORY_CHAPTERS.find((c) => c.key === key)?.name ?? ''}・${part === 'open' ? '開場' : '結尾'}`
}

/** 這一頁的旁白（猴子版）；要唸給孩子聽的版本再過 speciesLines.forSpecies */
export const pageLine = (p: StoryPage): Line => pickLine(p.group, p.index)

export const openId = (c: StoryChapter): StoryId => `${c.key}-open`
export const closeId = (c: StoryChapter): StoryId => `${c.key}-close`

type Prog = Pick<Progress, 'chapterId' | 'stations' | 'completedRuns' | 'chestClaimed'>

/** 第一次看任何故事之前先演序章 */
export function withPrologue(ids: readonly StoryId[], seen: readonly string[]): StoryId[] {
  if (ids.length === 0 || ids.includes('prologue') || seen.includes('prologue')) return [...ids]
  return ['prologue', ...ids]
}

/**
 * 要進某章第 station 站之前要演什麼。只有第一站、而且這章還沒開始玩過才演開場：
 * 舊存檔已經通關（或第一站已過）的章節不強迫補演，書架裡直接解鎖。
 * 重玩、每日、挑戰站的 chapterId 不是 CHAPTERS 的 id，不會命中。
 */
export function storiesBeforeStage(chapterId: string, station: number, seen: readonly string[], prog: Prog | undefined): StoryId[] {
  const c = storyChapterOf(chapterId)
  if (!c || station !== 1 || seen.includes(openId(c))) return []
  if (prog && (prog.completedRuns > 0 || prog.stations[0]?.done)) return []
  return withPrologue([openId(c)], seen)
}

/** 所有章都通關了嗎（看 CHAPTERS，之後加章節終章條件跟著變） */
export function allChaptersCleared(progs: readonly Prog[]): boolean {
  return CHAPTERS.every((c) => chapterCleared(progs.find((p) => p.chapterId === c.id)))
}

/** 寶箱開完要演什麼：這章的結尾（沒看過才演），五章全破再接終章 */
export function storiesAfterChest(chapterId: string, seen: readonly string[], progs: readonly Prog[]): StoryId[] {
  const c = storyChapterOf(chapterId)
  const ids: StoryId[] = []
  if (c && !seen.includes(closeId(c))) ids.push(closeId(c))
  if (!seen.includes('finale') && allChaptersCleared(progs)) ids.push('finale')
  return withPrologue(ids, seen)
}

/**
 * 書架上這本打得開嗎：看過的一定開；序章一開始就開；
 * 章節開場 = 這章玩過（舊存檔沒看過也算）；結尾 = 開過寶箱；終章 = 五章全破。
 */
export function storyUnlocked(id: StoryId, seen: readonly string[], progs: readonly Prog[]): boolean {
  if (id === 'prologue' || seen.includes(id)) return true
  if (id === 'finale') return allChaptersCleared(progs)
  const c = STORY_CHAPTERS.find((x) => id === openId(x) || id === closeId(x))
  const prog = c && progs.find((p) => p.chapterId === c.chapterId)
  if (!c || !prog) return false
  if (id === openId(c)) return prog.completedRuns > 0 || !!prog.stations[0]?.done
  return prog.completedRuns > 0 || prog.chestClaimed
}

/** 終章看過了（房間夜景窗外多一顆會眨眼的星星） */
export const finaleSeen = (seen: readonly string[] | undefined): boolean => !!seen?.includes('finale')

// ---------- 翻頁時間 ----------
/** 音檔長度上限（秒）：跟 design/tools/gen_voice.py 的 max_len 同一條公式 */
const voiceMaxSeconds = (text: string): number => Math.max(3, text.length * 0.45 + 1.5)

/** 語音回報開始了卻一直沒回報結束：最多等這麼久（毫秒）就翻頁 */
export const pageCapMs = (text: string): number => Math.round((voiceMaxSeconds(text) + 2.5) * 1000)
/** 沒有語音（家長關掉、瀏覽器不支援）：字幕停留多久（毫秒），大人唸得完 */
export const pageReadMs = (text: string): number => Math.max(4500, Math.round(text.length * 260))
/** 語音唸完之後留一口氣再翻頁（毫秒） */
export const PAGE_BREATH_MS = 800
