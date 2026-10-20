import type { CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { bubbleEmoji } from './foodFx'
import type { PetView } from './usePetLife'

const css = (v: Record<string, string | number>) => v as CSSProperties

const NOTE_GLYPHS = ['♪', '♫', '♬']
const NOTE_COLORS = ['#ff8fb1', '#7fd6b4', '#8ec9f5']
/** 跳舞時背景閃的小星星位置（相對於寵物格，會超出左右） */
const SPARKLES: { l: number; t: number; d: number; s: number }[] = [
  { l: -38, t: 8, d: 0, s: 1 },
  { l: -14, t: -6, d: 0.3, s: 0.7 },
  { l: 112, t: 12, d: 0.15, s: 1 },
  { l: 138, t: -2, d: 0.5, s: 0.7 },
  { l: -52, t: 52, d: 0.6, s: 0.8 },
  { l: 150, t: 46, d: 0.2, s: 0.9 },
  { l: 20, t: -18, d: 0.45, s: 0.6 },
  { l: 84, t: -16, d: 0.75, s: 0.8 },
]

interface Props {
  view: PetView
  asleep: boolean
  /** 睡覺姿勢（蜷縮躺著）比站著矮很多，Zzz 要降到頭的位置；蛋沒有躺姿 */
  lying: boolean
}

/** 疊在寵物身上的特效：泡泡、音符、星星、Zzz、食物與碎屑。全部 pointer-events: none，不擋點擊。 */
export function PetFx({ view, asleep, lying }: Props) {
  const { bubble, fx, food } = view
  return (
    <>
      {bubble && (
        <div key={bubble.id} className={`pf-bubble ${bubble.icon ? 'has-icon' : ''}`} role="status" data-testid="pet-bubble">
          {bubble.icon ? <Icon name={bubble.icon} emoji={bubbleEmoji(bubble.icon)} alt="" size="2.2rem" className="pf-bubble-icon" /> : bubble.text}
        </div>
      )}

      {asleep && !view.pose && (
        <div className={`pf-zzz ${lying ? 'lying' : ''}`} aria-hidden data-testid="pet-zzz">
          {['Z', 'z', 'Z'].map((z, i) => (
            <i key={i} style={css({ '--i': i })}>{z}</i>
          ))}
        </div>
      )}

      {fx.includes('notes') && (
        <div className="pf-notes" aria-hidden data-testid="fx-notes">
          {[0, 1, 2, 3].map((i) => (
            <i key={i} style={css({ '--i': i, '--nc': NOTE_COLORS[i % 3] })}>{NOTE_GLYPHS[i % 3]}</i>
          ))}
        </div>
      )}
      {fx.includes('sparkles') && (
        <div className="pf-sparkles" aria-hidden data-testid="fx-sparkles">
          {SPARKLES.map((s, i) => (
            <i key={i} style={css({ left: `${s.l}%`, top: `${s.t}%`, animationDelay: `${s.d}s`, '--s': s.s })}>✦</i>
          ))}
        </div>
      )}
      {fx.includes('cloud') && (
        <div className="pf-cloud" aria-hidden data-testid="fx-cloud">
          {[0, 1, 2].map((i) => (
            <i key={i} style={css({ '--i': i })} />
          ))}
        </div>
      )}
      {fx.includes('hearts') && (
        <div className="pf-hearts" aria-hidden data-testid="fx-hearts">
          {[0, 1, 2].map((i) => (
            <i key={i} style={css({ '--i': i })}>💗</i>
          ))}
        </div>
      )}
      {fx.includes('orbit') && (
        <div className="pf-orbit" aria-hidden data-testid="fx-orbit">
          {[0, 1, 2].map((i) => (
            <i key={i} style={css({ '--i': i })}>★</i>
          ))}
        </div>
      )}

      {food && (
        <>
          <div className={`pf-food ${food.phase} bite-${food.bites}`} style={css({ '--dx': `${food.dx}px`, '--dy': `${food.dy}px` })} aria-hidden data-testid="pet-food" data-phase={food.phase} data-bites={food.bites}>
            <Icon name={food.art} emoji={food.emoji} alt="" className="pf-food-img" />
          </div>
          {food.phase === 'chew' && food.bites > 0 && (
            <div key={food.bites} className="pf-crumbs" style={css({ '--c': food.color })} aria-hidden data-testid="pet-crumbs">
              {[0, 1, 2].map((i) => (
                <i key={i} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
