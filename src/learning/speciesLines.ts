/**
 * v7.5 線 L：依寵物物種挑語音。
 *
 * 語音 key 加物種後綴：`<原 key>@rabbit`、`<原 key>@tiger`；猴子（阿悟）一律用原 key、原文字（舊存檔的語音完全不變）。
 * 兩種句子有物種版本：
 *   1. 寵物自己說的台詞（key 以 PET_VOICE_PREFIXES 開頭，阿悟聲）：文字不變，兔兔、虎虎各有一份音檔（同一位底音改音高）。
 *   2. 需要唸寵物名字的旁白（媽媽聲）：固定台詞裡提到「阿悟」的句子，文字換成兔兔、虎虎。
 *      生活題（q.*、word.*）與阿悟著色頁的商店句（fb.*）不算：圖裡畫的就是阿悟（故事書裡的猴子朋友）。
 * 播放時 say() 依目前孩子的物種先找 `<key>@<物種>`，找不到才退回原 key（見 speech.ts 的 voiceCandidates）。
 *
 * 匯出：scripts/export-speech-lines.mjs 把 speciesLines(全部句子) 一起匯出。
 */
import { nameText, SPECIES, speciesName, type Species } from '../domain/species'
import { staticLineList, type Line } from './lines'

/** 寵物自己說的話（阿悟聲）的 key 開頭。要跟 design/tools/gen_voice.py 的 PET_KEYS 一致（speciesLines.test.ts 會檢查） */
export const PET_VOICE_PREFIXES = ['companion.', 'lock.sleepy', 'pet.', 'ui.gift.', 'ui.timewarn'] as const
export const isPetVoiceKey = (key: string): boolean => PET_VOICE_PREFIXES.some((p) => key.startsWith(p))

/** 有物種版本的新物種（猴子用原 key） */
export const VOICE_SPECIES: readonly Exclude<Species, 'monkey'>[] = SPECIES.filter((s): s is Exclude<Species, 'monkey'> => s !== 'monkey')

/** 加上物種後綴；猴子回原 key */
export const speciesKey = (key: string, species: Species): string => (species === 'monkey' ? key : `${key}@${species}`)
/** 去掉物種後綴 */
export const baseKey = (key: string): string => {
  const i = key.indexOf('@')
  return i < 0 ? key : key.slice(0, i)
}
/** key 的物種後綴（沒有 = 猴子） */
export const keySpecies = (key: string): Species => {
  const s = key.slice(key.indexOf('@') + 1)
  return key.includes('@') && (VOICE_SPECIES as readonly string[]).includes(s) ? (s as Species) : 'monkey'
}

export { nameText }

/** 需要唸名字的固定台詞 key（提到阿悟、又不是寵物自己說的） */
export function namedLineKeys(): string[] {
  return staticLineList()
    .filter((l) => l.text.includes(speciesName('monkey')) && !isPetVoiceKey(l.key))
    .map((l) => l.key)
}
let namedCache: Set<string> | null = null
export const isNamedLineKey = (key: string): boolean => (namedCache ??= new Set(namedLineKeys())).has(baseKey(key))

/** 選寵物那一頁點了唸名字（旁白聲）：species.name.<物種> */
export const speciesNameKey = (species: Species): string => `species.name.${species}`

/**
 * 物種版本的句子（給 export-speech-lines 匯出）：base = 全部原本的句子（allLines + feedbackLines + playLines）。
 * 回傳只含新增的 key：寵物台詞 × 兔兔、虎虎（文字不變），名字句 × 兔兔、虎虎（換名字），以及三個名字本身。
 */
export function speciesLines(base: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const named = new Set(namedLineKeys())
  for (const [k, text] of Object.entries(base)) {
    for (const s of VOICE_SPECIES) {
      if (isPetVoiceKey(k)) out[speciesKey(k, s)] = text
      else if (named.has(k)) out[speciesKey(k, s)] = nameText(text, s)
    }
  }
  for (const s of SPECIES) out[speciesNameKey(s)] = speciesName(s)
  return out
}

/**
 * 畫面用：固定台詞挑好之後換成這個物種的版本（名字句：key 加後綴、文字換名字）。
 * 猴子、不提名字的句子原樣回傳；寵物台詞不用換（文字一樣，say() 自己依物種挑音檔）。
 */
export function forSpecies(line: Line, species: Species): Line {
  if (species === 'monkey' || !isNamedLineKey(line.key)) return line
  return { key: speciesKey(baseKey(line.key), species), text: nameText(line.text, species) }
}
