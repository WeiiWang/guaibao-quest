import { useState, type CSSProperties } from 'react'
import type { Pet } from '../../domain/types'
import { BABY_AT_FEED_COUNT } from '../../domain/constants'
import { petArtChain, petEggChain, speciesEmoji, speciesKind, speciesOf } from '../../domain/species'
import { Art } from './Art'
import { useArtStatuses, useFirstArt } from '../artProbe'
import { hasHatEntry, hatAnchorMeasured, hatAspect } from '../../art/hats'
import { PetHat } from './PetHat'
import '../l75.css'

/** 特殊姿勢：cheer/think 是 v2 的；其餘是 v3 的生活姿勢（缺圖時退回 happy/idle，不會壞版） */
export type PetPose = 'cheer' | 'think' | 'idle' | 'happy' | 'eating' | 'sing' | 'dance' | 'laugh' | 'dizzy' | 'sleep' | 'sleepy' | 'shy'

interface Props {
  /** v7.5：species 沒給 = 猴子（舊存檔） */
  pet: Pick<Pet, 'stage' | 'feedCount' | 'name' | 'species'>
  mood: 'happy' | 'normal' | 'low'
  eating?: boolean
  /** 慶祝 / 思考 / 唱歌 / 睡覺等特殊姿勢（優先於 mood） */
  pose?: PetPose
  className?: string
  /** v6：戴著的帽子（商品 id）；蛋與睡覺等不戴的姿勢會自動不畫 */
  hat?: string | null
}

const stageLabel = (pet: Pick<Pet, 'stage' | 'species'>): string => (pet.stage === 'egg' ? '蛋' : `${pet.stage === 'baby' ? '幼' : '成'}${speciesKind(pet.species)}`)

/** 每種姿勢的備援順序：第一張圖不存在就往後找 */
const POSE_FALLBACK: Record<PetPose, readonly string[]> = {
  cheer: ['cheer', 'happy', 'idle'],
  think: ['think', 'happy', 'idle'],
  idle: ['idle', 'happy'],
  happy: ['happy', 'idle'],
  eating: ['eating', 'happy', 'idle'],
  sing: ['sing', 'happy', 'idle'],
  dance: ['dance', 'cheer', 'happy', 'idle'],
  laugh: ['laugh', 'happy', 'cheer', 'idle'],
  dizzy: ['dizzy', 'think', 'idle', 'happy'],
  sleep: ['sleep', 'sleepy', 'idle'],
  sleepy: ['sleepy', 'idle'],
  shy: ['shy', 'happy', 'idle'],
}

/** 成體/幼體可能用到的所有姿勢圖名（預先探測，換姿勢時不會閃一下色塊）；v7.5 新物種連同猴子的備援一起探測 */
export const petPoseArt = (stage: 'baby' | 'adult', species?: Pet['species']): string[] =>
  petArtChain(species, stage, [...new Set(Object.values(POSE_FALLBACK).flat())])

/**
 * 依成長階段、心情決定要用哪張圖（候選清單：第一張不存在就往後找）。
 * v7.5：先找這個物種的各個備援姿勢，全都沒有才退回猴子的同一串（domain/species.ts 的 petArtChain）
 */
export function petArtCandidates(pet: Pick<Pet, 'stage' | 'feedCount' | 'species'>, mood: Props['mood'], eating?: boolean, pose?: PetPose): string[] {
  if (pet.stage === 'egg') {
    // v7：蛋依孵化進度換外觀（0–33% 原蛋、33–66% 小裂紋、66–90% 發光、90% 以上快破了）；新圖缺的時候退回前一階段
    return petEggChain(pet.species, pet.feedCount / BABY_AT_FEED_COUNT)
  }
  const moodPose = mood === 'happy' ? 'happy' : mood === 'low' ? 'sleepy' : 'idle'
  const order = eating ? POSE_FALLBACK.eating : pose ? POSE_FALLBACK[pose] : [moodPose, 'happy', 'idle']
  return petArtChain(pet.species, pet.stage, [...new Set(order)])
}

export function PetSprite({ pet, mood, eating, pose, className = '', hat }: Props) {
  const names = petArtCandidates(pet, mood, eating, pose)
  // 先把這個階段所有姿勢的圖探測一遍，之後換姿勢才知道哪張存在
  useArtStatuses(pet.stage === 'egg' ? names : petPoseArt(pet.stage, pet.species))
  const found = useFirstArt(names)
  // v7.5：新物種的錨點還沒量過時，疊圖容器的寬高比用圖片實際載入的大小（記著是哪張圖的）
  const [natural, setNatural] = useState<{ name: string; ar: number } | null>(null)
  const expr = eating ? 'eating' : pose ?? mood
  const alt = `${pet.name}（${stageLabel(pet)}）`
  if (found === null) {
    // 這個物種和猴子的圖都沒有：最後退回 emoji（不會出現破圖）
    return (
      <div className={`pet-sprite stage-${pet.stage} mood-${expr} ${className}`} data-species={speciesOf(pet)}>
        <span className="pet-img l75-pet-emoji" role="img" aria-label={alt}>
          {pet.stage === 'egg' ? '🥚' : speciesEmoji(pet.species)}
        </span>
      </div>
    )
  }
  const chosen = found
  const measured = hatAnchorMeasured(chosen)
  const onLoad = measured ? undefined : (el: HTMLImageElement) => el.naturalHeight > 0 && setNatural({ name: chosen, ar: Number((el.naturalWidth / el.naturalHeight).toFixed(4)) })
  const img = <Art key={chosen} name={chosen} className="pet-img" alt={alt} onLoad={onLoad} />
  // v6：戴帽子時，圖片和帽子放進同一個和圖片等大的容器（.wd-art），帽子跟著圖片一起動
  const withHat = !!hat && pet.stage !== 'egg' && hasHatEntry(chosen)
  if (withHat) {
    const anchorAr = !measured && natural?.name === chosen ? natural.ar : hatAspect(chosen)
    return (
      <div className={`pet-sprite stage-${pet.stage} mood-${expr} wd-has-hat ${className}`} data-species={speciesOf(pet)} data-art={chosen}>
        <div className="wd-art" style={{ '--ar': anchorAr } as CSSProperties}>
          {img}
          <PetHat hat={hat} artFile={chosen} />
        </div>
      </div>
    )
  }
  return (
    <div className={`pet-sprite stage-${pet.stage} mood-${expr} ${className}`} data-species={speciesOf(pet)} data-art={chosen}>
      {/* key 綁圖名：換姿勢時重建 img，載入失敗的 fallback 狀態不會殘留 */}
      {img}
    </div>
  )
}

/** 頭像用：只取第一張存在的圖，沒有就回 null（呼叫端自己放 emoji） */
export function usePetFace(pet: Pick<Pet, 'stage' | 'feedCount' | 'species'>, mood: Props['mood']): string | null {
  const names = petArtCandidates(pet, mood)
  return useFirstArt(names)
}
