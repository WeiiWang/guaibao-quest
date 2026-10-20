import type { Pet } from '../../domain/types'
import { BABY_AT_FEED_COUNT } from '../../domain/constants'
import { Art } from './Art'
import { useFirstArt } from '../artProbe'

export type PetPose = 'cheer' | 'think'

interface Props {
  pet: Pick<Pet, 'stage' | 'feedCount' | 'name'>
  mood: 'happy' | 'normal' | 'low'
  eating?: boolean
  /** 慶祝 / 思考等特殊姿勢（優先於 mood） */
  pose?: PetPose
  className?: string
}

const STAGE_LABEL = { egg: '蛋', baby: '幼猴', adult: '成猴' } as const

/** 依成長階段、心情決定要用哪張圖（候選清單：第一張不存在就往後找） */
export function petArtCandidates(pet: Pick<Pet, 'stage' | 'feedCount'>, mood: Props['mood'], eating?: boolean, pose?: PetPose): string[] {
  if (pet.stage === 'egg') {
    const nearHatch = pet.feedCount / BABY_AT_FEED_COUNT >= 0.8
    return nearHatch ? ['pet-egg-crack', 'pet-egg'] : ['pet-egg', 'pet-egg-crack']
  }
  const s = pet.stage
  const first = eating ? 'eating' : pose ? pose : mood === 'happy' ? 'happy' : mood === 'low' ? 'sleepy' : 'idle'
  const order = [first, 'happy', 'idle']
  return [...new Set(order)].map((p) => `pet-${s}-${p}`)
}

export function PetSprite({ pet, mood, eating, pose, className = '' }: Props) {
  const names = petArtCandidates(pet, mood, eating, pose)
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
