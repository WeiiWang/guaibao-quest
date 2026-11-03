import numberJson from './content/number.json'
import classifyJson from './content/classify.json'
import patternJson from './content/pattern.json'
import measureJson from './content/measure.json'
import spaceJson from './content/space.json'
import observeJson from './content/observe.json'
import englishJson from './content/english.json'
import lifeJson from './content/life.json'
import natureJson from './content/nature.json'
import type { Question } from './types'

/** 題庫資料本體：只被 bank.ts 的 loadBank() 動態載入，獨立成一塊 chunk */
export const ALL_QUESTIONS: Question[] = [
  ...(numberJson as unknown as Question[]),
  ...(classifyJson as unknown as Question[]),
  ...(patternJson as unknown as Question[]),
  ...(measureJson as unknown as Question[]),
  ...(spaceJson as unknown as Question[]),
  ...(observeJson as unknown as Question[]),
  ...(englishJson as unknown as Question[]),
  ...(lifeJson as unknown as Question[]),
  ...(natureJson as unknown as Question[]),
]
