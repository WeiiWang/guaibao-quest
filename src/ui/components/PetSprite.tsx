import type { Pet } from '../../domain/types'
import { BABY_AT_FEED_COUNT } from '../../domain/constants'
import { Art } from './Art'
import { useArtStatuses, useFirstArt } from '../artProbe'

/** 特殊姿勢：cheer/think 是 v2 的；其餘是 v3 的生活姿勢（缺圖時退回 happy/idle，不會壞版） */
export type PetPose = 'cheer' | 'think' | 'idle' | 'happy' | 'eating' | 'sing' | 'dance' | 'laugh' | 'dizzy' | 'sleep' | 'sleepy' | 'shy'

interface Props {
  pet: Pick<Pet, 'stage' | 'feedCount' | 'name'>
  mood: 'happy' | 'normal' | 'low'
  eating?: boolean
  /** 慶祝 / 思考 / 唱歌 / 睡覺等特殊姿勢（優先於 mood） */
  pose?: PetPose
  className?: string
}

const STAGE_LABEL = { egg: '蛋', baby: '幼猴', adult: '成猴' } as const

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

/** 成體/幼體可能用到的所有姿勢圖名（預先探測，換姿勢時不會閃一下色塊） */
export const petPoseArt = (stage: 'baby' | 'adult'): string[] =>
  [...new Set(Object.values(POSE_FALLBACK).flat())].map((p) => `pet-${stage}-${p}`)

/** 依成長階段、心情決定要用哪張圖（候選清單：第一張不存在就往後找） */
export function petArtCandidates(pet: Pick<Pet, 'stage' | 'feedCount'>, mood: Props['mood'], eating?: boolean, pose?: PetPose): string[] {
  if (pet.stage === 'egg') {
    const nearHatch = pet.feedCount / BABY_AT_FEED_COUNT >= 0.8
    return nearHatch ? ['pet-egg-crack', 'pet-egg'] : ['pet-egg', 'pet-egg-crack']
  }
  const s = pet.stage
  const moodPose = mood === 'happy' ? 'happy' : mood === 'low' ? 'sleepy' : 'idle'
  const order = eating ? POSE_FALLBACK.eating : pose ? POSE_FALLBACK[pose] : [moodPose, 'happy', 'idle']
  return [...new Set(order)].map((p) => `pet-${s}-${p}`)
}

export function PetSprite({ pet, mood, eating, pose, className = '' }: Props) {
  const names = petArtCandidates(pet, mood, eating, pose)
  // 先把這個階段所有姿勢的圖探測一遍，之後換姿勢才知道哪張存在
  useArtStatuses(pet.stage === 'egg' ? names : petPoseArt(pet.stage))
  const chosen = useFirstArt(names) ?? names[0]
  const expr = eating ? 'eating' : pose ?? mood
  return (
    <div className={`pet-sprite stage-${pet.stage} mood-${expr} ${className}`}>
      {/* key 綁圖名：換姿勢時重建 img，載入失敗的 fallback 狀態不會殘留 */}
      <Art key={chosen} name={chosen} className="pet-img" alt={`${pet.name}（${STAGE_LABEL[pet.stage]}）`} />
    </div>
  )
}

/** 頭像用：只取第一張存在的圖，沒有就回 null（呼叫端自己放 emoji） */
export function usePetFace(pet: Pick<Pet, 'stage' | 'feedCount'>, mood: Props['mood']): string | null {
  const names = petArtCandidates(pet, mood)
  return useFirstArt(names)
}
