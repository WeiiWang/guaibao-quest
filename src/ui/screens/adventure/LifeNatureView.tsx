import { useRef, useState } from 'react'
import { artAltOf, artEmojiOf } from '../../../learning/lifeNature'
import { wordKey } from '../../../learning/lines'
import { say } from '../../../learning/speech'
import type { Choice, Question } from '../../../learning/types'
import { Icon } from '../../components/Icon'
import type { HintStage } from './QuestionView'
import './adventure.css'
import './adventure-v4.css'
import './adventure-v6-life.css'

interface Props {
  q: Question
  hintStage: HintStage
  /** 已經點錯的選項 id */
  tapped: ReadonlySet<string>
  solved: boolean
  voiceOn: boolean
  onPick: (choiceId: string) => void
}

type CardState = 'idle' | 'wrong' | 'answer' | 'right' | 'disabled'

/** 題幹上的圖：情境圖、紅綠燈色塊、或一個大 emoji */
function Stem({ stem, label }: { stem: NonNullable<Question['params']>['stem']; label: string }) {
  if (!stem) return null
  if (stem.art) {
    return (
      <span className="lw-pic" data-testid="lw-stem" data-art={stem.art}>
        <Icon name={stem.art} emoji={artEmojiOf(stem.art)} alt={label} />
      </span>
    )
  }
  if (stem.swatch) return <span className="lw-pic lw-lamp" data-testid="lw-stem" style={{ background: stem.swatch }} role="img" aria-label={label} />
  return (
    <span className="lw-pic lw-emoji" data-testid="lw-stem" role="img" aria-label={label}>
      {stem.emoji}
    </span>
  )
}

function Card({ c, state, armed, onPick }: { c: Choice; state: CardState; armed: boolean; onPick: () => void }) {
  const disabled = state === 'wrong' || state === 'disabled' || state === 'right'
  const word = !c.art && c.text !== undefined
  return (
    <button
      type="button"
      className={`choice choice-${state} lw-choice ${word ? 'lw-word' : 'lw-picture'} ${armed ? 'armed' : ''}`}
      disabled={disabled}
      onClick={onPick}
      data-testid="choice"
      data-choice-id={c.id}
      data-state={state}
      data-armed={armed ? 'true' : undefined}
      aria-label={c.alt ?? (c.art ? artAltOf(c.art) : (c.text ?? c.id))}
    >
      {c.art ? (
        <>
          <span className="choice-art lw-art">
            <Icon name={c.art} emoji={artEmojiOf(c.art)} alt={c.alt ?? artAltOf(c.art)} />
          </span>
          {c.text && <span className="lw-caption">{c.text}</span>}
        </>
      ) : (
        <>
          {c.emoji && (
            <span className="lw-icon" aria-hidden>
              {c.emoji}
            </span>
          )}
          <span className="lw-text">{c.text}</span>
        </>
      )}
      {armed && (
        <span className="choice-armed" aria-hidden>
          ✓
        </span>
      )}
    </button>
  )
}

/**
 * 生活與自然的點選題：題幹（情境圖、紅綠燈色塊或 emoji）加上大張選項卡。
 * - 圖片選項：點一下就作答。
 * - 文字選項（謝謝、對不起、好、不好、雨傘…）附圖示：第一次點只唸出來並打勾，再點一次才作答，
 *   小小孩不識字也能先聽再選。
 * 對錯由關卡畫面判斷（走 onPick），這裡只負責畫面。
 */
export function LifeNatureView({ q, hintStage, tapped, solved, voiceOn, onPick }: Props) {
  const stem = q.params?.stem
  const [armed, setArmed] = useState<string | null>(null)
  const armedRef = useRef<string | null>(null)

  const stateOf = (c: Choice): CardState => {
    if (solved) return c.id === q.answer ? 'right' : 'disabled'
    if (tapped.has(c.id)) return 'wrong'
    if (hintStage === 2) return c.id === q.answer ? 'answer' : 'disabled'
    return 'idle'
  }

  const pick = (c: Choice) => {
    const word = !c.art && c.text !== undefined
    if (word && armedRef.current !== c.id) {
      armedRef.current = c.id
      setArmed(c.id)
      say(wordKey(c.text as string), c.text as string, { enabled: voiceOn })
      return
    }
    onPick(c.id)
  }

  const label = stem?.art ? artAltOf(stem.art) : q.prompt
  const allWords = q.choices.every((c) => !c.art)
  return (
    <div
      className={`qv qv-${q.type} qv-lw ${stem ? 'has-stem' : 'no-stem'}`}
      data-testid="question"
      data-question-id={q.id}
      data-hint-stage={hintStage}
      data-type={q.type}
    >
      {stem && (
        <div className="qv-stem lw-stem">
          <Stem stem={stem} label={label} />
        </div>
      )}
      <div className={`qv-choices n${q.choices.length} ${allWords ? 'lw-words' : 'lw-pics'}`}>
        {q.choices.map((c) => (
          <Card key={c.id} c={c} state={stateOf(c)} armed={armed === c.id && !solved && !tapped.has(c.id)} onPick={() => pick(c)} />
        ))}
      </div>
    </div>
  )
}
