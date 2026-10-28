/**
 * 英文單字科目的單字表（美術都用現有素材：public/art 的 obj-*、food-*、decor-*）。
 * 這個檔案不 import 任何專案模組，讓 scripts/gen-questions.mjs 與 export-speech-lines.mjs 可以直接載入。
 *
 * 單字分三類，出題時選項一律同一類（不會拿顏色字當物件圖的干擾項，也不會把數字字和物件混在一起）：
 * - thing：物件（圖）
 * - color：顏色（色塊）
 * - number：數字 one–ten（數字卡）
 */

export type WordKind = 'thing' | 'color' | 'number'

export interface EnWord {
  /** 英文單字，同時是選項 id */
  word: string
  /** 中文意思（zh2en 的題目與提示用，唸給孩子聽） */
  zh: string
  kind: WordKind
  /** thing：圖檔名（public/art/<art>.png） */
  art?: string
  /** color：色票（CSS 顏色） */
  swatch?: string
  /** number：數字 */
  digit?: string
}

const T = (word: string, zh: string, art: string): EnWord => ({ word, zh, kind: 'thing', art })
const C = (word: string, zh: string, swatch: string): EnWord => ({ word, zh, kind: 'color', swatch })
const N = (word: string, digit: number): EnWord => ({ word, zh: `數字${['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][digit]}`, kind: 'number', digit: String(digit) })

export const EN_WORDS: EnWord[] = [
  T('apple', '蘋果', 'obj-apple'),
  T('banana', '香蕉', 'obj-banana'),
  T('grape', '葡萄', 'obj-grape'),
  T('peach', '桃子', 'obj-peach'),
  T('carrot', '紅蘿蔔', 'food-carrot'),
  T('cake', '蛋糕', 'food-cake'),
  T('cookie', '餅乾', 'food-cookie'),
  T('milk', '牛奶', 'food-milk'),
  T('watermelon', '西瓜', 'food-watermelon'),
  T('fish', '小魚', 'obj-fish'),
  T('chick', '小雞', 'obj-chick'),
  T('rabbit', '小兔子', 'obj-rabbit'),
  T('star', '星星', 'obj-star'),
  T('flower', '花', 'obj-flower'),
  T('car', '汽車', 'decor-car'),
  T('rocket', '火箭', 'decor-rocket'),
  T('ball', '皮球', 'decor-ball'),
  T('piano', '鋼琴', 'decor-piano'),
  T('bed', '床', 'decor-bed'),
  T('clock', '時鐘', 'decor-clock'),
  T('lamp', '燈', 'decor-lamp'),
  T('tent', '帳篷', 'decor-tent'),
  C('red', '紅色', '#ef5350'),
  C('yellow', '黃色', '#ffd84d'),
  C('blue', '藍色', '#5aa9f0'),
  C('green', '綠色', '#5cc98a'),
  C('pink', '粉紅色', '#ffb3c7'),
  C('purple', '紫色', '#a874d8'),
  N('one', 1),
  N('two', 2),
  N('three', 3),
  N('four', 4),
  N('five', 5),
  N('six', 6),
  N('seven', 7),
  N('eight', 8),
  N('nine', 9),
  N('ten', 10),
]

export const EN_BY_WORD: Record<string, EnWord> = Object.fromEntries(EN_WORDS.map((w) => [w.word, w]))

export const enWord = (word: string): EnWord => {
  const w = EN_BY_WORD[word]
  if (!w) throw new Error(`未知的英文單字：${word}`)
  return w
}

/** 幼幼模式（3 歲）只出這幾個最常見的 */
export const EN_GENTLE_WORDS = ['apple', 'banana', 'fish', 'chick', 'star', 'car', 'ball', 'cake', 'milk', 'flower']

/** 英文語音的 key 與語言。預錄英文音檔以 en.<word> 命名；沒有音檔就用 Web Speech 的 en-US */
export const EN_LANG = 'en-US'
export const enKey = (word: string): string => `en.${word}`

/** v7.2 連連看字母版：A–Z（大寫，英文語音唸字母名；key = en.A…en.Z） */
export const EN_LETTERS: readonly string[] = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))

/** 所有要生成英文音檔的句子：key → 英文 */
export function englishLines(): Record<string, string> {
  return Object.fromEntries([...EN_WORDS.map((w) => [enKey(w.word), w.word]), ...EN_LETTERS.map((l) => [enKey(l), l])])
}
