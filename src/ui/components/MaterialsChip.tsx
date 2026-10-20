import { MATERIAL_IDS, MATERIAL_NAMES } from '../../learning/types'
import { useMaterials } from '../learningHooks'
import { MAT_EMOJI } from '../../art/items'
import { Icon } from './Icon'
import '../screens/adventure/adventure.css'

/** 材料餘額列：木材 / 石頭 / 花朵。獲得材料的飛入動畫以 data-materials-chip 為目標 */
export function MaterialsChip({ className = '' }: { className?: string }) {
  const b = useMaterials()
  return (
    <span
      className={`mat-chip ${className}`}
      data-materials-chip
      aria-label={MATERIAL_IDS.map((m) => `${MATERIAL_NAMES[m]} ${b[m]}`).join('，')}
    >
      {MATERIAL_IDS.map((m) => (
        <span key={m} className="mat-chip-item" data-material={m}>
          <Icon name={`mat-${m}`} emoji={MAT_EMOJI[m]} alt={MATERIAL_NAMES[m]} size={30} />
          <b>{b[m]}</b>
        </span>
      ))}
    </span>
  )
}
