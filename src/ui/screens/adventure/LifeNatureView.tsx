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
  /** （保留給呼叫端；v7.3 起喇叭鈕是孩子自己按的，不看家長的語音開關） */
  voiceOn?: boolean
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

function Card({ c, state, onPick, onSpeak }: { c: Choice; state: CardState; onPick: () => void; onSpeak?: () => void }) {
  const disabled = state === 'wrong' || state === 'disabled' || state === 'right'
  const word = !c.art && c.text !== undefined
  const btn = (
    <button
      type="button"
      className={`choice choice-${state} lw-choice ${word ? 'lw-word' : 'lw-picture'}`}
      disabled={disabled}
      onClick={onPick}
      data-testid="choice"
      data-choice-id={c.id}
      data-state={state}
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
    </button>
  )
  if (!onSpeak) return btn
  return (
    <div className="q7-cardwrap g73-wordwrap">
      {btn}
      <button type="button" className="q7-speak g73-speak" onClick={onSpeak} aria-label={`聽：${c.text}`} data-testid="word-speak" data-choice-id={c.id}>
        <span aria-hidden>🔊</span>
      </button>
    </div>
  )
}

/**
 * 生活與自然的點選題：題幹（情境圖、紅綠燈色塊或 emoji）加上大張選項卡。
 * - 圖片選項：點一下就作答。
 * - 文字選項（謝謝、對不起、好、不好、雨傘…）附圖示：比照數字題，卡片右上角有小喇叭（≥ 56px）點了唸字，
 *   點卡片本身就直接作答（v7.3：取消「第一下只唸、第二下才作答」的兩段式，4 歲點一下以為答完了而卡住）。
 * 對錯由關卡畫面判斷（走 onPick），這裡只負責畫面。
 */
export function LifeNatureView({ q, hintStage, tapped, solved, onPick }: Props) {
  const stem = q.params?.stem
  const stateOf = (c: Choice): CardState => {
    if (solved) return c.id === q.answer ? 'right' : 'disabled'
    if (tapped.has(c.id)) return 'wrong'
    if (hintStage === 2) return c.id === q.answer ? 'answer' : 'disabled'
    return 'idle'
  }

  /** 點喇叭唸字（家長關語音時也唸：是孩子自己按的） */
  const speakWord = (c: Choice) => say(wordKey(c.text as string), c.text as string, { enabled: true })

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
          <Card key={c.id} c={c} state={stateOf(c)} onPick={() => onPick(c.id)} onSpeak={!c.art && c.text !== undefined ? () => speakWord(c) : undefined} />
        ))}
      </div>
    </div>
  )
}
