/**
 * 所有會唸出來的句子，集中在這裡管理：每句一個穩定的 key。
 * 介面呼叫 say(key, text)；之後有預先錄好的音檔（Voicebox 本機生成）就依 key 找檔，沒有才退回 Web Speech。
 * 這個檔案不 import 任何專案模組（只用 import type），讓 scripts/export-speech-lines.mjs 可以直接載入。
 *
 * key 規則：
 *   q.<題目id>.prompt / q.<題目id>.hint   題目與提示
 *   word.<文字>                          題目裡逐個唸的詞（物件名、顏色、數量）
 *   num.<n>                              數數用的數字
 *   其餘是固定台詞，見 STATIC_LINES
 */
import type { Question } from './types'

export interface Line {
  key: string
  text: string
}

const NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export const questionKey = (id: string, part: 'prompt' | 'hint'): string => `q.${id}.${part}`
export const wordKey = (text: string): string => `word.${text}`
export const numberKey = (n: number): string => `num.${n}`
/** 數完之後強調總數：「一共有五個」 */
export const totalKey = (n: number): string => `count.total.${n}`
export const totalText = (n: number): string => `一共有${NUM[n] ?? n}個`

/** 1–20 轉中文數字（唸給孩子聽：一、二、三…） */
export function chineseNumber(n: number): string {
  if (n <= 10) return NUM[n] ?? String(n)
  if (n < 20) return `十${NUM[n - 10]}`
  if (n === 20) return '二十'
  return String(n)
}

/** 固定台詞。陣列的句子用 `<key>.<序號>` 當 key（從 1 起算），輪流取用 */
export const STATIC_LINES: Record<string, string | string[]> = {
  // 答對
  praise: ['答對了！', '好棒喔！', '太厲害了！', '你真聰明！'],
  'praise.gentle': ['哇，你好棒！', '答對了，好厲害喔！', '太棒了，阿悟好開心！'],
  // 答錯與提示
  'hint.answer': '答案在這裡，點點看。',
  'gentle.wrong': ['沒關係喔，我們一起看看。', '不要緊，阿悟陪你一起想。', '沒關係，我們再看一次。'],
  'gentle.answer': '你看，答案在這裡，點點看。',
  // 關卡
  'station.done': '這一站過關了！',
  'chapter.done': '太棒了，這一章全部通關了！',
  'station.loading': '阿悟正在準備題目。',
  // 離開關卡
  'leave.ask': '要先休息一下嗎？阿悟會記得你玩到哪裡喔。',
  'leave.stay': '好，我們繼續玩！',
  // 拿給我 N 個
  'give.more': '再拿一個喔。',
  'give.less': '多拿了一個，放回去一個喔。',
  'give.count': '我們一起數數看。',
  'give.tap.hint': '點一下東西，就會放進籃子裡。',
  // 拖曳歸類
  'bins.hint': '把東西放進對的籃子裡。',
  'bins.wrong': '這個不是這一籃喔，再試試看。',
  'bins.done': '都放好了！',
  // 阿悟的台詞：開場
  'companion.open': ['今天要去哪裡呢？', '出發囉！', '我準備好了！'],
  'companion.open.tutorial': ['看我做一次喔。', '換你試試看。'],
  'companion.correct': ['你好會想！', '哇，答對了！', '我也想到了！'],
  'companion.hint': ['我們一起想想。', '再看仔細一點點。'],
  'companion.wrong2': ['沒關係，我們看這裡。', '這個有點難，對吧？'],
  'companion.combo2': ['連續答對了！', '你好穩喔！'],
  'companion.combo3': ['三連擊！', '哇，連續三題！'],
  'companion.combo5': ['全部都對！好厲害！', '五題都自己想出來了！'],
  'companion.wrapup': ['這一站我們好棒！', '肚子餓了，想吃桃子。'],
  'companion.boss.open': ['最後一關！大家都在等我們。', '這一站要全部一起加油！'],
  'companion.boss.done': ['我們一起完成了！', '好多好多星星！'],
  'companion.tutorial.give': ['看我拿一個，再拿一個。', '拿到剛好，就按好了。'],
  'companion.tutorial.bins': ['看我把它放進籃子裡。', '你也來試試看。'],
}

/** 取出固定台詞的所有句子：key → 文字 */
export function staticLineList(): Line[] {
  const out: Line[] = []
  for (const [k, v] of Object.entries(STATIC_LINES)) {
    if (Array.isArray(v)) v.forEach((text, i) => out.push({ key: `${k}.${i + 1}`, text }))
    else out.push({ key: k, text: v })
  }
  return out
}

/** 從固定台詞輪流取一句（i 由呼叫端決定，例如題號）。回傳 key 與文字 */
export function pickLine(group: string, i = 0): Line {
  const v = STATIC_LINES[group]
  if (Array.isArray(v)) {
    const n = ((i % v.length) + v.length) % v.length
    return { key: `${group}.${n + 1}`, text: v[n] }
  }
  return { key: group, text: v ?? '' }
}

/** 幼幼模式答錯時，提示前面加的一句鼓勵（固定文字，讓每題的提示音檔 key 穩定） */
export const GENTLE_PREFIX = '沒關係喔，有阿悟陪你。'
export const gentleHintKey = (id: string): string => `q.${id}.hint.gentle`
export const gentleHintText = (hint: string): string => `${GENTLE_PREFIX}${hint}答案在這裡，點點看。`

/** 一題會唸到的所有句子 */
export function questionLines(q: Pick<Question, 'id' | 'prompt' | 'hint' | 'params'>): Line[] {
  const out: Line[] = [
    { key: questionKey(q.id, 'prompt'), text: q.prompt },
    { key: questionKey(q.id, 'hint'), text: q.hint },
    { key: gentleHintKey(q.id), text: gentleHintText(q.hint) },
  ]
  for (const w of q.params?.words ?? []) if (w) out.push({ key: wordKey(w), text: w })
  return out
}

/** 全部句子（題庫 + 固定台詞 + 數字），key 唯一 */
export function allLines(bank: Pick<Question, 'id' | 'prompt' | 'hint' | 'params'>[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of staticLineList()) out[l.key] = l.text
  for (let n = 0; n <= 20; n++) out[numberKey(n)] = chineseNumber(n)
  for (let n = 1; n <= 20; n++) out[totalKey(n)] = totalText(n)
  out[wordKey('空格')] = '空格'
  out['gentle.prefix'] = GENTLE_PREFIX
  for (const q of bank) for (const l of questionLines(q)) out[l.key] = l.text
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}
