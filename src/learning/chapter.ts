import type { MaterialCost, MaterialId } from './types'

export interface StationDef {
  /** 1 起算 */
  index: number
  name: string
  /** 通關獲得的材料種類 */
  material: MaterialId
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
    { index: 1, name: '山腳小路', material: 'wood' },
    { index: 2, name: '桃子林', material: 'flower' },
    { index: 3, name: '小溪邊', material: 'stone' },
    { index: 4, name: '瀑布前', material: 'wood' },
    { index: 5, name: '猴王石', material: 'stone' },
  ],
  chest: { wood: 2, stone: 2, flower: 2 },
}

export const CHAPTERS: ChapterDef[] = [HUAGUOSHAN]

/** 還沒開放的章節（地圖上顯示「即將開放」） */
export const UPCOMING_CHAPTERS = [
  { id: 'shuilian', name: '水簾洞' },
  { id: 'longgong', name: '龍宮' },
]

export function getChapter(id: string): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.id === id)
}
