import { useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { Art } from '../../components/Art'
import { useFirstArt } from '../../artProbe'
import './adventure.css'

export type Pose = 'idle' | 'happy' | 'cheer' | 'think' | 'sleepy' | 'eating'

/** 依寵物階段挑姿勢圖：蛋沒有姿勢，其餘為 pet-<stage>-<pose>；缺圖時退回 happy / idle */
export function companionArt(stage: 'egg' | 'baby' | 'adult', pose: Pose, feedCount = 0): string[] {
  if (stage === 'egg') return feedCount >= 15 ? ['pet-egg-crack', 'pet-egg'] : ['pet-egg', 'pet-egg-crack']
  return [...new Set([pose, 'happy', 'idle'])].map((p) => `pet-${stage}-${p}`)
}

interface Props {
  pose?: Pose
  /** 邊長：數字 = px，也可以給 CSS 長度（例如 clamp(...)） */
  size?: number | string
  className?: string
}

/** 阿悟：學習時出現在畫面角落的夥伴。idle 呼吸、點擊彈跳、cheer 跳躍、think 歪頭（CSS 動態）。 */
export function Companion({ pose = 'idle', size = 120, className = '' }: Props) {
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const [bounce, setBounce] = useState(0)
  const names = companionArt(pet?.stage ?? 'adult', pose, pet?.feedCount ?? 0)
  const chosen = useFirstArt(names) ?? names[0]
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
    >
      <Art key={chosen} name={chosen} alt={pet.name} className="companion-img" />
    </button>
  )
}
