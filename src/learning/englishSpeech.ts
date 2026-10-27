import { EN_LANG, enKey } from './english'
import { gentleHintKey, gentleHintText, pickLine, questionKey } from './lines'
import type { SayPart } from './speech'
import type { Question } from './types'

/**
 * 英文科目怎麼唸：中文旁白用中文語音（key 照 lines.ts），英文單字用英文語音（key = en.<word>）。
 * 這裡只決定「唸哪幾句、什麼順序」，實際播放由 speech.ts 的 sayChain 處理。
 */

const enPart = (word: string): SayPart => ({ key: enKey(word), text: word, lang: EN_LANG })

/** 這一題的英文單字（沒有就是 undefined） */
export const wordOf = (q: Pick<Question, 'params'>): string | undefined => q.params?.word

/**
 * 題目：先唸中文題目。聽英文選圖（hear）和拼字（spell）接著唸英文單字；
 * 看圖選單字、聽中文選單字不唸英文（唸了就等於告訴答案）。
 */
export function englishPromptParts(q: Pick<Question, 'id' | 'type' | 'prompt' | 'params'>): SayPart[] {
  const parts: SayPart[] = [{ key: questionKey(q.id, 'prompt'), text: q.prompt }]
  const w = wordOf(q)
  if (w && (q.type === 'hear' || q.type === 'spell')) parts.push(enPart(w))
  return parts
}

/** 提示：中文提示（幼幼模式加鼓勵的話）→ 英文單字 */
export function englishHintParts(q: Pick<Question, 'id' | 'hint' | 'params'>, gentle: boolean): SayPart[] {
  const parts: SayPart[] = [gentle ? { key: gentleHintKey(q.id), text: gentleHintText(q.hint) } : { key: questionKey(q.id, 'hint'), text: q.hint }]
  const w = wordOf(q)
  if (w) parts.push(enPart(w))
  return parts
}

/** 第二次答錯：標出答案時的那句話，再唸一次英文單字 */
export function englishAnswerParts(q: Pick<Question, 'params'>): SayPart[] {
  const l = pickLine('hint.answer')
  const w = wordOf(q)
  return [{ key: l.key, text: l.text }, ...(w ? [enPart(w)] : [])]
}
