import type { Interaction, MaterialCost, MaterialId, Progress, SkillId } from './types'
import { MATH2_SKILLS, MATH_SKILLS } from './types'

/**
 * 站型：決定這一站 5 題的節奏。
 * - tutorial：教學站，第一次遇到新互動時阿悟先示範
 * - normal：普通站，一題主互動
 * - minigame：小遊戲站，兩題主互動
 * - boss：每章最後一站，沒有失敗，只有進度條
 */
export type StationKind = 'tutorial' | 'normal' | 'minigame' | 'boss'

export interface StationDef {
  /** 1 起算 */
  index: number
  name: string
  /** 通關獲得的材料種類 */
  material: MaterialId
  kind: StationKind
  /** 5 題各自的互動：pick（點選）、tapN（拿給我 N 個）、dragSort（拖曳歸類）、stepOrder（步驟排序）。該技能目前難度沒有這種題就退回 pick */
  slots: Interaction[]
}

export interface ChapterDef {
  id: string
  name: string
  subtitle: string
  stations: StationDef[]
  /** 章末寶箱的額外材料 */
  chest: MaterialCost
  /** 這一章要先通關哪一章才開放（沒寫 = 一開始就開放）。這是章節選擇裡唯一的鎖 */
  unlockAfter?: string
  /** 這一章一站會混合哪些技能（沒寫 = 科目的預設技能，見 subject.ts） */
  skills?: SkillId[]
  /** 每站最後一題從這些技能抽（輪流）：新章節裡保留少量舊章節技能的複習 */
  tail?: SkillId[]
  /** 地圖背景圖（public/art/<scene>.png）；沒有就用花果山的地圖換色調 */
  scene?: string
  /** 站點與寶箱在背景圖上的位置（佔場景寬高的 %，5 站 + 寶箱）；只在用到自己的背景圖時才用，沒有就是花果山的位置 */
  points?: [number, number][]
}

export const HUAGUOSHAN: ChapterDef = {
  id: 'huaguoshan',
  name: '花果山',
  subtitle: '第一章',
  stations: [
    { index: 1, name: '山腳小路', material: 'wood', kind: 'tutorial', slots: ['pick', 'tapN', 'pick', 'pick', 'pick'] },
    { index: 2, name: '桃子林', material: 'flower', kind: 'normal', slots: ['pick', 'pick', 'dragSort', 'pick', 'pick'] },
    { index: 3, name: '小溪邊', material: 'stone', kind: 'minigame', slots: ['pick', 'tapN', 'pick', 'dragSort', 'pick'] },
    { index: 4, name: '瀑布前', material: 'wood', kind: 'normal', slots: ['pick', 'pick', 'pick', 'tapN', 'pick'] },
    { index: 5, name: '猴王石', material: 'stone', kind: 'boss', slots: ['pick', 'dragSort', 'pick', 'tapN', 'pick'] },
  ],
  chest: { wood: 2, stone: 2, flower: 2 },
}

/** 英文科目的第一章：5 站每站 5 題（都是英文單字），章末寶箱。難度跟著孩子的英文程度走 */
export const ENGLISH_ISLAND: ChapterDef = {
  id: 'english-island',
  name: '英文小島',
  subtitle: '第一章',
  stations: [
    { index: 1, name: '白沙灘', material: 'wood', kind: 'normal', slots: ['pick', 'pick', 'pick', 'pick', 'pick'] },
    { index: 2, name: '椰子樹下', material: 'flower', kind: 'normal', slots: ['pick', 'pick', 'pick', 'pick', 'pick'] },
    { index: 3, name: '珊瑚礁', material: 'stone', kind: 'normal', slots: ['pick', 'pick', 'pick', 'pick', 'pick'] },
    { index: 4, name: '海風燈塔', material: 'wood', kind: 'normal', slots: ['pick', 'pick', 'pick', 'pick', 'pick'] },
    { index: 5, name: '寶藏洞', material: 'stone', kind: 'boss', slots: ['pick', 'pick', 'pick', 'pick', 'pick'] },
  ],
  chest: { wood: 2, stone: 2, flower: 2 },
}

/** 生活與禮儀科目的第一章：5 站每站 5 題（都是生活與禮儀），章末寶箱 */
export const LIFE_TOWN: ChapterDef = {
  id: 'life-town',
  name: '生活小鎮',
  subtitle: '第一章',
  stations: [
    { index: 1, name: '小鎮廣場', material: 'flower', kind: 'normal', slots: ['pick', 'pick', 'pick', 'pick', 'pick'] },
    { index: 2, name: '洗手台', material: 'wood', kind: 'normal', slots: ['pick', 'pick', 'stepOrder', 'pick', 'pick'] },
    { index: 3, name: '遊樂場', material: 'stone', kind: 'normal', slots: ['pick', 'pick', 'pick', 'pick', 'pick'] },
    { index: 4, name: '十字路口', material: 'wood', kind: 'normal', slots: ['pick', 'stepOrder', 'pick', 'pick', 'pick'] },
    { index: 5, name: '阿悟的家', material: 'flower', kind: 'boss', slots: ['pick', 'pick', 'stepOrder', 'pick', 'pick'] },
  ],
  chest: { wood: 2, stone: 2, flower: 2 },
}

/** 自然常識科目的第一章：5 站每站 5 題（都是自然常識），章末寶箱 */
export const NATURE_FOREST: ChapterDef = {
  id: 'nature-forest',
  name: '自然森林',
  subtitle: '第一章',
  stations: [
    { index: 1, name: '森林入口', material: 'wood', kind: 'normal', slots: ['pick', 'pick', 'pick', 'pick', 'pick'] },
    { index: 2, name: '小花園', material: 'flower', kind: 'normal', slots: ['pick', 'pick', 'stepOrder', 'pick', 'pick'] },
    { index: 3, name: '大草原', material: 'stone', kind: 'normal', slots: ['pick', 'dragSort', 'pick', 'pick', 'pick'] },
    { index: 4, name: '小河邊', material: 'stone', kind: 'normal', slots: ['pick', 'pick', 'dragSort', 'stepOrder', 'pick'] },
    { index: 5, name: '森林深處', material: 'flower', kind: 'boss', slots: ['pick', 'dragSort', 'pick', 'stepOrder', 'pick'] },
  ],
  chest: { wood: 2, stone: 2, flower: 2 },
}

/**
 * 數學第二章：水簾洞。花果山通關後解鎖。
 * 一站 5 題：前 4 題輪流出三個新技能（比較與排序、空間方位、觀察與記憶），最後 1 題是第 1 章技能的複習。
 * 三種新互動（排序、放到位置、翻牌）分散在各站，第一次遇到時阿悟先示範。
 */
export const SHUILIANDONG: ChapterDef = {
  id: 'shuiliandong',
  name: '水簾洞',
  subtitle: '第二章',
  unlockAfter: 'huaguoshan',
  skills: MATH2_SKILLS,
  tail: MATH_SKILLS,
  scene: 'scene-map-shuiliandong',
  // 對應 scene-map-shuiliandong.png 裡的石板小路：由左下角出發，過小溪、瀑布旁的石階，爬到右上角的水簾洞口
  points: [[10, 84], [24, 76], [40, 72], [56, 56], [75, 40], [87, 19]],
  stations: [
    { index: 1, name: '水簾洞口', material: 'flower', kind: 'tutorial', slots: ['pick', 'dragOrder', 'pick', 'pick', 'pick'] },
    { index: 2, name: '石橋', material: 'wood', kind: 'normal', slots: ['pick', 'pick', 'place', 'pick', 'pick'] },
    { index: 3, name: '石桌石椅', material: 'stone', kind: 'minigame', slots: ['pick', 'flip', 'pick', 'dragOrder', 'pick'] },
    { index: 4, name: '猴子大廳', material: 'flower', kind: 'normal', slots: ['place', 'pick', 'pick', 'flip', 'pick'] },
    { index: 5, name: '美猴王寶座', material: 'stone', kind: 'boss', slots: ['dragOrder', 'place', 'pick', 'flip', 'pick'] },
  ],
  chest: { wood: 3, stone: 2, flower: 3 },
}

export const CHAPTERS: ChapterDef[] = [HUAGUOSHAN, SHUILIANDONG, ENGLISH_ISLAND, LIFE_TOWN, NATURE_FOREST]

/** 還沒開放的章節（數學科目的地圖上顯示「即將開放」；其他科目見 subject.ts） */
export const UPCOMING_CHAPTERS = [
  { id: 'putishan', name: '菩提山' },
  { id: 'longgong', name: '龍宮' },
]

/** 這一章通關了嗎：5 站都過，或是已經開過寶箱（再玩一輪時關卡重置，但 completedRuns 還在） */
export function chapterCleared(prog: Pick<Progress, 'stations' | 'completedRuns'> | undefined): boolean {
  if (!prog) return false
  return prog.completedRuns > 0 || (prog.stations.length > 0 && prog.stations.every((s) => s.done))
}

/**
 * 這一章開放了嗎。沒有前置章節就是開放；有的話要先通關前一章，或家長（PM 預覽）直接解鎖。
 * progs：各章節進度（章節 id → 進度）；pmUnlocked：直接解鎖的章節 id。
 */
export function chapterUnlocked(ch: ChapterDef, progs: Readonly<Record<string, Pick<Progress, 'stations' | 'completedRuns'> | undefined>>, pmUnlocked: readonly string[] = []): boolean {
  if (!ch.unlockAfter) return true
  return pmUnlocked.includes(ch.id) || chapterCleared(progs[ch.unlockAfter])
}

export function getChapter(id: string): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.id === id)
}
