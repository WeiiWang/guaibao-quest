import { ENGLISH_ISLAND, HUAGUOSHAN, LIFE_TOWN, NATURE_FOREST, UPCOMING_CHAPTERS, type ChapterDef, type StationDef } from './chapter'
import type { Interaction, MaterialId, SkillId, SubjectId } from './types'
import { MATH_SKILLS } from './types'

/**
 * 科目清單：地圖上方的分頁、每個科目的章節與技能都從這裡來。
 * 之後加科目（生活、注音、自然…）就在 SUBJECTS 加一筆，並把它的章節放進 chapter.ts 的 CHAPTERS。
 */
export interface SubjectDef {
  id: SubjectId
  /** 分頁上的字 */
  name: string
  /** 分頁上的大圖示（用字形組成，不需要美術素材） */
  glyph: string
  /** 這個科目目前的章節 */
  chapter: ChapterDef
  /** 一站會出哪些技能 */
  skills: SkillId[]
  /** 地圖底下的「即將開放」 */
  upcoming: { id: string; name: string }[]
  /** 每日冒險 5 個位置的互動（沒有該互動的題就退回點選） */
  dailySlots: Interaction[]
  /** 地圖頁的色系（styles.css 的 .theme-<名稱>） */
  theme: 'mint' | 'sky' | 'peach' | 'butter'
}

export const SUBJECTS: SubjectDef[] = [
  {
    id: 'math',
    name: '數學',
    glyph: '123',
    chapter: HUAGUOSHAN,
    skills: MATH_SKILLS,
    upcoming: UPCOMING_CHAPTERS,
    dailySlots: ['pick', 'tapN', 'pick', 'dragSort', 'pick'],
    theme: 'mint',
  },
  {
    id: 'english',
    name: '英文',
    glyph: 'ABC',
    chapter: ENGLISH_ISLAND,
    skills: ['english'],
    upcoming: [{ id: 'english-city', name: '單字城市' }],
    dailySlots: ['pick', 'pick', 'pick', 'pick', 'pick'],
    theme: 'sky',
  },
  {
    id: 'life',
    name: '生活',
    glyph: '禮貌',
    chapter: LIFE_TOWN,
    skills: ['life'],
    upcoming: [{ id: 'life-school', name: '學校生活' }],
    dailySlots: ['pick', 'pick', 'stepOrder', 'pick', 'pick'],
    theme: 'peach',
  },
  {
    id: 'nature',
    name: '自然',
    glyph: '花草',
    chapter: NATURE_FOREST,
    skills: ['nature'],
    upcoming: [{ id: 'nature-ocean', name: '海洋世界' }],
    dailySlots: ['pick', 'dragSort', 'pick', 'stepOrder', 'pick'],
    theme: 'butter',
  },
]

export const DEFAULT_SUBJECT: SubjectId = 'math'

export function getSubject(id: string): SubjectDef | undefined {
  return SUBJECTS.find((s) => s.id === id)
}

export function mustSubject(id: SubjectId): SubjectDef {
  const s = getSubject(id)
  if (!s) throw new Error(`未知的科目：${id}`)
  return s
}

/** 章節屬於哪個科目 */
export function subjectOfChapter(chapterId: string): SubjectDef | undefined {
  return SUBJECTS.find((s) => s.chapter.id === chapterId)
}

// ---------- 每日冒險 ----------
// 每日冒險借用「關卡」的畫面與流程：chapterId = daily:<科目>、station = 1。

export const DAILY_PREFIX = 'daily:'
export const dailyChapterId = (subject: SubjectId): string => `${DAILY_PREFIX}${subject}`

/** daily:<科目> → 科目；不是每日冒險就回傳 null */
export function parseDailyId(chapterId: string): SubjectId | null {
  if (!chapterId.startsWith(DAILY_PREFIX)) return null
  const s = getSubject(chapterId.slice(DAILY_PREFIX.length))
  return s ? s.id : null
}

export const DAILY_NAME = '今日冒險'

/** 一天一種材料輪流（木材、石頭、花朵），不需要記錄 */
const DAILY_MATERIALS: MaterialId[] = ['wood', 'stone', 'flower']
export function dailyMaterial(date: string): MaterialId {
  const [y, m, d] = date.split('-').map(Number)
  return DAILY_MATERIALS[Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) % DAILY_MATERIALS.length]
}

/** 每日冒險當成「一站」：名字、材料、站型 */
export function dailyStationDef(subject: SubjectId, date: string): StationDef {
  return { index: 1, name: DAILY_NAME, material: dailyMaterial(date), kind: 'normal', slots: mustSubject(subject).dailySlots }
}

export interface StageInfo {
  /** 章節名（結算畫面的「英文小島・白沙灘」） */
  chapterName: string
  def: StationDef
  /** 科目 */
  subject: SubjectId
  daily: boolean
}

/** 關卡畫面要的站資料：一般章節的站，或每日冒險。找不到就是 undefined */
export function resolveStage(chapterId: string, station: number, date: string): StageInfo | undefined {
  const daily = parseDailyId(chapterId)
  if (daily) {
    if (station !== 1) return undefined
    return { chapterName: mustSubject(daily).name, def: dailyStationDef(daily, date), subject: daily, daily: true }
  }
  const subject = subjectOfChapter(chapterId)
  const def = subject?.chapter.stations[station - 1]
  return subject && def ? { chapterName: subject.chapter.name, def, subject: subject.id, daily: false } : undefined
}
