import { useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { Art } from '../../components/Art'
import { useFirstArt } from '../../artProbe'
import { BABY_AT_FEED_COUNT } from '../../../domain/constants'
import { petArtChain, petEggChain, speciesEmoji, type Species } from '../../../domain/species'
import './adventure.css'
import './adventure-v4.css'
import '../../l75.css'

export type Pose = 'idle' | 'happy' | 'cheer' | 'think' | 'sleepy' | 'eating' | 'sing' | 'dance' | 'laugh' | 'shy' | 'dizzy'

/**
 * 依寵物階段挑姿勢圖：蛋沒有姿勢，其餘為這個物種的 <stage>-<pose>；缺圖時退回 happy / idle，
 * v7.5：這個物種的圖都沒有才退回猴子的同一串（domain/species.ts 的 petArtChain）
 */
export function companionArt(stage: 'egg' | 'baby' | 'adult', pose: Pose, feedCount = 0, species?: Species): string[] {
  // 蛋的外觀跟首頁一樣依孵化進度換（v7：pet-egg → s1 → s2 → crack）
  if (stage === 'egg') return petEggChain(species, feedCount / BABY_AT_FEED_COUNT)
  return petArtChain(species, stage, [...new Set([pose, 'happy', 'idle'])])
}

interface Props {
  pose?: Pose
  /** 邊長：數字 = px，也可以給 CSS 長度（例如 clamp(...)） */
  size?: number | string
  className?: string
}

/** 阿悟（v7.5 起是孩子自己選的寵物）：學習時出現在畫面角落的夥伴。idle 呼吸、點擊彈跳、cheer 跳躍、think 歪頭（CSS 動態）。 */
export function Companion({ pose = 'idle', size = 120, className = '' }: Props) {
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const [bounce, setBounce] = useState(0)
  const names = companionArt(pet?.stage ?? 'adult', pose, pet?.feedCount ?? 0, pet?.species)
  const chosen = useFirstArt(names)
  const box: CSSProperties = { width: size, height: size }
  if (!pet) return <span className={`companion ${className}`} style={box} />
  return (
    <button
      type="button"
      key={bounce}
      className={`companion pose-${pose} ${bounce ? 'poked' : ''} ${className}`}
      style={box}
      onClick={() => setBounce((n) => n + 1)}
      aria-label={`${pet.name}（點一下會跳）`}
      data-testid="companion"
      data-pose={pose}
      data-species={pet.species ?? 'monkey'}
      data-art={chosen ?? ''}
    >
      {chosen ? (
        <Art key={chosen} name={chosen} alt={pet.name} className="companion-img" />
      ) : (
        <span className="companion-img l75-pet-emoji" role="img" aria-label={pet.name}>
          {pet.stage === 'egg' ? '🥚' : speciesEmoji(pet.species)}
        </span>
      )}
    </button>
  )
}
