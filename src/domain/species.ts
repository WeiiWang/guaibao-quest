// v7.5 線 L：寵物的物種（猴子阿悟、兔子兔兔、老虎虎虎）。
// 只有新建的孩子能選；舊存檔沒有 species 欄位 = 猴子阿悟（不升 Dexie 版本）。
// 這裡是純函式：物種預設值、名字、圖檔名與缺圖時的備援順序。
import type { Stage } from './types'
import { eggLook } from './home7'

export type Species = 'monkey' | 'rabbit' | 'tiger'
export const SPECIES: readonly Species[] = ['monkey', 'rabbit', 'tiger']
export const DEFAULT_SPECIES: Species = 'monkey'

export const isSpecies = (v: unknown): v is Species => v === 'monkey' || v === 'rabbit' || v === 'tiger'
/** 沒有、或不認得的值一律當成猴子（舊存檔） */
export const normSpecies = (v: unknown): Species => (isSpecies(v) ? v : DEFAULT_SPECIES)
/** 這隻寵物的物種（舊存檔沒有這欄 = 猴子） */
export const speciesOf = (pet: { species?: unknown } | null | undefined): Species => normSpecies(pet?.species)

const NAMES: Record<Species, string> = { monkey: '阿悟', rabbit: '兔兔', tiger: '虎虎' }
/** 固定的名字：猴子＝阿悟、兔子＝兔兔、老虎＝虎虎 */
export const speciesName = (s?: Species | null): string => NAMES[normSpecies(s)]

/** 文字裡的「阿悟」換成這個物種的名字（猴子原樣回傳）。生活題的題目與圖片不用這個：那裡的阿悟是故事書裡的猴子朋友 */
export const nameText = (text: string, s?: Species | null): string => (normSpecies(s) === 'monkey' ? text : text.replaceAll(NAMES.monkey, speciesName(s)))

/** 缺圖時的最後備援 */
export const SPECIES_EMOJI: Record<Species, string> = { monkey: '🐵', rabbit: '🐰', tiger: '🐯' }
export const speciesEmoji = (s?: Species | null): string => SPECIES_EMOJI[normSpecies(s)]
/** 幼體的小名（貼紙「小猴」、家長區 PM 的階段名） */
const BABY: Record<Species, string> = { monkey: '小猴', rabbit: '小兔', tiger: '小虎' }
export const speciesBabyLabel = (s?: Species | null): string => BABY[normSpecies(s)]
/** 幼體 / 成體的稱呼（圖片替代文字用：幼猴、成猴） */
const KIND: Record<Species, string> = { monkey: '猴', rabbit: '兔', tiger: '虎' }
export const speciesKind = (s?: Species | null): string => KIND[normSpecies(s)]

/** 寵物的 12 種姿勢（三種物種都一樣） */
export const PET_POSES = ['idle', 'happy', 'cheer', 'think', 'eating', 'sing', 'dance', 'laugh', 'dizzy', 'sleep', 'sleepy', 'shy'] as const
export type PetPoseName = (typeof PET_POSES)[number]
/** 蛋的四種外觀：原蛋、小裂紋、發光、快破了 */
export type EggPhase = 'egg' | 's1' | 's2' | 'crack'
export const EGG_PHASES: readonly EggPhase[] = ['egg', 's1', 's2', 'crack']

const prefixOf = (s: Species) => (s === 'monkey' ? 'pet' : `pet-${s}`)

/**
 * 寵物圖檔名（public/art/<名>.png，不含副檔名）。
 * 猴子維持原本的檔名（pet-baby-idle、pet-egg、pet-egg-s1…）；兔子、老虎是 pet-rabbit-baby-idle、pet-tiger-egg-crack…
 * 蛋的 pose 是外觀（egg / s1 / s2 / crack，不給 = 原蛋）；幼體、成體的 pose 不給 = idle。
 */
export function petArt(species: Species | null | undefined, stage: Stage, pose?: string): string {
  const p = prefixOf(normSpecies(species))
  if (stage === 'egg') return !pose || pose === 'egg' || !(EGG_PHASES as readonly string[]).includes(pose) ? `${p}-egg` : `${p}-egg-${pose}`
  return `${p}-${stage}-${pose ?? 'idle'}`
}

/**
 * 缺圖時的備援順序：先找這個物種的各個姿勢（poses 依序），全都沒有才退回猴子的同一批姿勢。
 * 呼叫端最後再退回 emoji（speciesEmoji）。猴子只有自己那一組。
 * 先找同物種的其他姿勢，而不是猴子的同一個姿勢：選了兔兔的孩子，看到一張別的姿勢的兔兔比突然冒出猴子自然。
 */
export function petArtChain(species: Species | null | undefined, stage: Stage, poses: string | readonly string[]): string[] {
  const list = typeof poses === 'string' ? [poses] : poses
  const s = normSpecies(species)
  const own = list.map((p) => petArt(s, stage, p))
  const monkey = s === 'monkey' ? [] : list.map((p) => petArt('monkey', stage, p))
  return [...new Set([...own, ...monkey])]
}

/** 蛋依孵化進度的外觀與備援（新圖缺的時候往前一階段找，最後是這個物種的原蛋，再退回猴子的同一串） */
export function petEggChain(species: Species | null | undefined, progress: number): string[] {
  const order: EggPhase[] = ['crack', 's2', 's1', 'egg']
  const look = eggLook(progress)
  const cur: EggPhase = look === 'pet-egg' ? 'egg' : (look.replace('pet-egg-', '') as EggPhase)
  return petArtChain(species, 'egg', order.slice(order.indexOf(cur)))
}

const ART_RE = /^pet-(?:(rabbit|tiger)-)?(?:(egg)(?:-(s1|s2|crack))?|(baby|adult)-([a-z]+))$/
/** 從圖檔名取出物種、階段、姿勢（不是寵物圖回 null）：pet-rabbit-adult-cheer → rabbit / adult / cheer */
export function parsePetArt(name: string): { species: Species; stage: Stage; pose: string } | null {
  const m = ART_RE.exec(name)
  if (!m) return null
  const species = (m[1] as Species | undefined) ?? 'monkey'
  if (m[2]) return { species, stage: 'egg', pose: m[3] ?? 'egg' }
  return { species, stage: m[4] as Stage, pose: m[5] }
}

/** 任一張圖的備援順序：新物種的寵物圖 → 猴子同一張；其他圖只有自己 */
export function artFallbacks(name: string): string[] {
  const p = parsePetArt(name)
  if (!p || p.species === 'monkey') return [name]
  return [name, petArt('monkey', p.stage, p.pose)]
}

/** 新物種的圖換成猴子的同一張（不是新物種的寵物圖就原樣回傳）：貼紙解鎖狀態以猴子的圖名記錄 */
export const monkeyArtOf = (name: string): string => {
  const p = parsePetArt(name)
  return p && p.species !== 'monkey' ? petArt('monkey', p.stage, p.pose) : name
}

/** 猴子的寵物圖換成這個物種的同一張（不是寵物圖就原樣回傳） */
export const artForSpecies = (name: string, species: Species | null | undefined): string => {
  const p = parsePetArt(name)
  return p ? petArt(species, p.stage, p.pose) : name
}
