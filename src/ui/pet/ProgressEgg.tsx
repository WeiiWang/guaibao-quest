import { Icon } from '../components/Icon'
import { useFirstArt } from '../artProbe'
import { eggArtChain, growProgress } from '../../domain/home7'
import type { Pet } from '../../domain/types'
import { BABY_AT_FEED_COUNT } from '../../domain/constants'
import '../home7.css'

/**
 * 進度蛋：小小的環形進度（孵化 / 長大還差多少）。蛋階段中間放目前的蛋（外觀跟著進度換），
 * 幼體階段中間放小猴子臉。不放文字，不識字的孩子也看得懂「環越滿越近」。
 */
export function ProgressEgg({ pet }: { pet: Pick<Pet, 'stage' | 'feedCount' | 'name'> }) {
  const p = growProgress(pet)
  const chain = pet.stage === 'egg' ? eggArtChain(pet.feedCount / BABY_AT_FEED_COUNT) : ['pet-baby-happy', 'pet-baby-idle']
  const art = useFirstArt(chain) ?? chain[chain.length - 1]
  const R = 20
  const C = 2 * Math.PI * R
  return (
    <span className="h7-ring" role="img" aria-label={`${pet.stage === 'egg' ? '孵化' : '長大'}進度 ${Math.round(p * 100)}%`} data-testid="progress-egg" data-progress={Math.round(p * 100)}>
      <svg viewBox="0 0 48 48" aria-hidden>
        <circle className="h7-ring-bg" cx="24" cy="24" r={R} />
        <circle className="h7-ring-fg" cx="24" cy="24" r={R} strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 24 24)" />
      </svg>
      <Icon name={art} emoji={pet.stage === 'egg' ? '🥚' : '🐵'} className="h7-ring-art" />
    </span>
  )
}
