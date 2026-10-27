/** 學習物件的屬性（種類、顏色）。美術檔：public/art/<id>.png */

/** 分類題用的種類。四類彼此互斥；花、貝殼、星星不屬於任何一類，只用在數數與規律題 */
export type Category = 'fruit' | 'animal' | 'vehicle' | 'toy'

export interface LearnObject {
  id: string
  /** 顯示/語音用名稱 */
  name: string
  /** 量詞（「幾根香蕉」） */
  unit: string
  /** 沒有種類（undefined）的物件不會出現在分類題 */
  category?: Category
  /** 看起來最主要的顏色（顏色題的答案以這個為準） */
  color: string
  /** 圖上另外很明顯的顏色（粉紅耳朵、黃肚皮…）。顏色題的干擾項不能帶有目標顏色 */
  alsoColors?: string[]
  /** 孩子可能另外歸到哪一類（恐龍是玩具，但孩子可能說是動物）。分類題不讓這兩類同時出現 */
  confusableWith?: Category[]
}

export const CATEGORY_NAMES: Record<Category, string> = {
  fruit: '水果',
  animal: '動物',
  vehicle: '交通工具',
  toy: '玩具',
}
export const CATEGORIES = Object.keys(CATEGORY_NAMES) as Category[]

/** 顏色的口語說法（題目與語音用「粉紅色」，不用「粉色」） */
export const COLOR_WORDS: Record<string, string> = {
  黃: '黃色',
  粉: '粉紅色',
  紅: '紅色',
  紫: '紫色',
  藍: '藍色',
  白: '白色',
  綠: '綠色',
  彩虹: '彩虹色',
  粉橘: '粉橘色',
}
export const colorWord = (color: string): string => COLOR_WORDS[color] ?? `${color}色`

export const OBJECTS: LearnObject[] = [
  { id: 'obj-banana', name: '香蕉', unit: '根', category: 'fruit', color: '黃' },
  { id: 'obj-peach', name: '桃子', unit: '顆', category: 'fruit', color: '粉' },
  { id: 'obj-apple', name: '蘋果', unit: '顆', category: 'fruit', color: '紅' },
  { id: 'obj-grape', name: '葡萄', unit: '串', category: 'fruit', color: '紫' },
  { id: 'obj-fish', name: '小魚', unit: '條', category: 'animal', color: '藍' },
  { id: 'obj-chick', name: '小雞', unit: '隻', category: 'animal', color: '黃' },
  { id: 'obj-rabbit', name: '小兔子', unit: '隻', category: 'animal', color: '白', alsoColors: ['粉'] },
  { id: 'obj-flower', name: '花', unit: '朵', color: '粉' },
  { id: 'obj-shell', name: '貝殼', unit: '個', color: '粉橘', alsoColors: ['粉'] },
  { id: 'obj-star', name: '星星', unit: '顆', color: '黃' },
  // 用現有的家具素材當交通工具與玩具
  { id: 'decor-car', name: '汽車', unit: '輛', category: 'vehicle', color: '綠' },
  { id: 'decor-rocket', name: '火箭', unit: '枚', category: 'vehicle', color: '紅', alsoColors: ['黃'] },
  { id: 'decor-ball', name: '皮球', unit: '顆', category: 'toy', color: '彩虹', alsoColors: ['粉', '黃', '綠', '藍'] },
  { id: 'decor-dino', name: '恐龍', unit: '隻', category: 'toy', color: '綠', alsoColors: ['黃'], confusableWith: ['animal'] },
  { id: 'decor-piano', name: '鋼琴', unit: '台', category: 'toy', color: '綠', alsoColors: ['粉', '黃', '藍', '紫'] },
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
