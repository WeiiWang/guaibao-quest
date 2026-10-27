import { useEffect } from 'react'
import { learnLine, trickOf } from '../../domain/tricks'
import { sayText } from '../../learning/speech'
import { playSfx } from '../../learning/sfx'
import '../meta.css'

interface Props {
  trickId: string
  petName: string
  voiceOn: boolean
  soundOn: boolean
  /** 再看一次：請阿悟再表演一次這一招 */
  onReplay: () => void
  onClose: () => void
}

/**
 * 阿悟學會新招：全螢幕慶祝（彩紙 + 大字），阿悟本人在房間裡示範一次（由首頁發出表演請求）。
 * 背景幾乎透明，才看得到阿悟在示範；只有按鈕可以點。
 */
export function TrickCelebrate({ trickId, petName, voiceOn, soundOn, onReplay, onClose }: Props) {
  const def = trickOf(trickId)
  const text = learnLine(petName, def?.name ?? '新招')
  useEffect(() => {
    playSfx('reward', soundOn)
    sayText(text, { enabled: voiceOn })
    // 每一招只在出現時唸一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trickId])
  if (!def) return null
  return (
    <div className="trick-celebrate" role="dialog" aria-modal="false" aria-label={text} data-testid="trick-celebrate" data-trick={def.id}>
      <div className="trick-confetti" aria-hidden>
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.15}s`, background: ['#FF8FB1', '#FFD66B', '#7FD6B4', '#8EC9F5', '#B9A6F5'][i % 5] }} />
        ))}
      </div>
      <div className="trick-card">
        <div className="trick-badge" aria-hidden>{def.emoji}</div>
        <p className="trick-title" data-testid="trick-celebrate-text">{text}</p>
        <p className="trick-sub">看！{petName}表演給你看</p>
        <div className="trick-actions">
          <button className="btn" onClick={onReplay} data-testid="trick-replay">再看一次</button>
          <button className="btn primary" onClick={onClose} data-testid="trick-close" autoFocus>太棒了</button>
        </div>
      </div>
    </div>
  )
}
