// v7.5 線 L：目前這個孩子的寵物物種（ChildApp 讀他的 Pet 之後提供）。沒有 Provider = 猴子（舊行為）
import { createContext, useContext } from 'react'
import { DEFAULT_SPECIES, nameText, speciesName, type Species } from '../domain/species'

export const SpeciesContext = createContext<Species>(DEFAULT_SPECIES)
export const useSpecies = (): Species => useContext(SpeciesContext)
/** 目前這個孩子的寵物名字（阿悟、兔兔、虎虎） */
export const useSpeciesName = (): string => speciesName(useSpecies())
/** 畫面文字裡的「阿悟」換成目前這個孩子的寵物名字 */
export function usePetText(): (text: string) => string {
  const s = useSpecies()
  return (text) => nameText(text, s)
}
