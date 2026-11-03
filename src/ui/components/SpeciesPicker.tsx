import { SPECIES, petArt, speciesEmoji, speciesName, type Species } from '../../domain/species'
import { speciesNameKey } from '../../learning/speciesLines'
import { say } from '../../learning/speech'
import { prefersReducedMotion } from './ScreenTransition'
import { Icon } from './Icon'
import '../l75.css'

/** v8：點到的那隻跳一下（落地擠扁、彈起、再小彈一下）。用 Web Animations，連點會重新開始；減少動態時不跳 */
function hop(btn: HTMLElement): void {
  const art = btn.querySelector<HTMLElement>('.l75-pick-art')
  if (!art || typeof art.animate !== 'function' || prefersReducedMotion()) return
  art.animate(
    [
      { transform: 'translateY(0) scale(1, 1)' },
      { transform: 'translateY(5px) scale(1.12, 0.86)', offset: 0.14 },
      { transform: 'translateY(-24px) scale(0.94, 1.1)', offset: 0.44 },
      { transform: 'translateY(0) scale(1.1, 0.9)', offset: 0.72 },
      { transform: 'translateY(-6px) scale(0.98, 1.03)', offset: 0.86 },
      { transform: 'translateY(0) scale(1, 1)' },
    ],
    { duration: 560, easing: 'ease-out' },
  )
}

/**
 * v7.5 線 L：新建孩子時選寵物（猴子阿悟、兔子兔兔、老虎虎虎）。三顆大圖（各物種幼體開心的樣子，缺圖退回 emoji），
 * 點了那隻會跳一下、卡片彈性放大、另外兩隻稍微退後，並唸名字。只在新建孩子的流程出現（第一次開 App、名冊裡重設後重建、家長區新增孩子）；已經有的孩子不能改。
 */
export function SpeciesPicker({ value, onChange, compact = false }: { value: Species; onChange: (s: Species) => void; compact?: boolean }) {
  return (
    <div className={`l75-pick ${compact ? 'l75-pick-compact' : ''}`} role="radiogroup" aria-label="選一隻寵物" data-testid="species-picker">
      {SPECIES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          aria-label={speciesName(s)}
          className={`l75-pick-btn ${value === s ? 'on' : ''}`}
          data-testid={`species-${s}`}
          onClick={(e) => {
            hop(e.currentTarget)
            onChange(s)
            say(speciesNameKey(s), speciesName(s))
          }}
        >
          <Icon name={petArt(s, 'baby', 'happy')} emoji={speciesEmoji(s)} alt="" className="l75-pick-art" exact />
          <span className="l75-pick-name">{speciesName(s)}</span>
        </button>
      ))}
    </div>
  )
}
