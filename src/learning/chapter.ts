import type { Interaction, MaterialCost, MaterialId } from './types'

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

export const CHAPTERS: ChapterDef[] = [HUAGUOSHAN, ENGLISH_ISLAND, LIFE_TOWN, NATURE_FOREST]

/** 還沒開放的章節（數學科目的地圖上顯示「即將開放」；其他科目見 subject.ts） */
export const UPCOMING_CHAPTERS = [
  { id: 'shuilian', name: '水簾洞' },
  { id: 'longgong', name: '龍宮' },
]

export function getChapter(id: string): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.id === id)
}
