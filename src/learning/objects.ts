/** 學習物件的屬性（種類、顏色）。美術檔：public/art/<id>.png */

export type Category = 'fruit' | 'animal' | 'nature'

export interface LearnObject {
  id: string
  /** 顯示/語音用名稱 */
  name: string
  /** 量詞（「幾根香蕉」） */
  unit: string
  category: Category
  color: string
}

export const CATEGORY_NAMES: Record<Category, string> = {
  fruit: '水果',
  animal: '動物',
  nature: '大自然',
}

export const OBJECTS: LearnObject[] = [
  { id: 'obj-banana', name: '香蕉', unit: '根', category: 'fruit', color: '黃' },
  { id: 'obj-peach', name: '桃子', unit: '顆', category: 'fruit', color: '粉' },
  { id: 'obj-apple', name: '蘋果', unit: '顆', category: 'fruit', color: '紅' },
  { id: 'obj-grape', name: '葡萄', unit: '串', category: 'fruit', color: '紫' },
  { id: 'obj-fish', name: '小魚', unit: '條', category: 'animal', color: '藍' },
  { id: 'obj-chick', name: '小雞', unit: '隻', category: 'animal', color: '黃' },
  { id: 'obj-rabbit', name: '小兔', unit: '隻', category: 'animal', color: '白' },
  { id: 'obj-flower', name: '花', unit: '朵', category: 'nature', color: '粉' },
  { id: 'obj-shell', name: '貝殼', unit: '個', category: 'nature', color: '粉橘' },
  { id: 'obj-star', name: '星星', unit: '顆', category: 'nature', color: '黃' },
]

const BY_ID = new Map(OBJECTS.map((o) => [o.id, o]))

export function getObject(id: string): LearnObject | undefined {
  return BY_ID.get(id)
}

/** 取不到就丟錯：題庫引用了不存在的物件是資料錯誤 */
export function mustObject(id: string): LearnObject {
  const o = BY_ID.get(id)
  if (!o) throw new Error(`未知的學習物件：${id}`)
  return o
}
