import type { CSSProperties } from 'react'
import { DECOR_EMOJI, FOOD_EMOJI, OBJ_EMOJI } from '../../../art/items'
import { EN_BY_WORD } from '../../../learning/english'
import { sayEnglish } from '../../../learning/speech'
import type { Choice, Question } from '../../../learning/types'
import { Icon } from '../../components/Icon'
import type { HintStage } from './QuestionView'
import './adventure.css'
import './adventure-v4.css'
import './adventure-v5.css'
import './adventure-v7.css'

interface Props {
  q: Question
  hintStage: HintStage
  /** 已經點錯的選項 id */
  tapped: ReadonlySet<string>
  solved: boolean
  onPick: (choiceId: string) => void
}

/** 缺圖時的備援 emoji（obj-*、food-*、decor-*） */
export function artEmoji(name: string): string | undefined {
  if (name.startsWith('food-')) return FOOD_EMOJI[name.slice(5)]
  return OBJ_EMOJI[name] ?? (name.startsWith('decor-') ? DECOR_EMOJI[name.slice(6)] : undefined)
}

type CardState = 'idle' | 'wrong' | 'answer' | 'right' | 'disabled'

/** 題幹上的圖：物件圖、色塊或數字 */
function StemPic({ stem, label }: { stem: NonNullable<Question['params']>['stem']; label: string }) {
  if (!stem) return null
  if (stem.art) return <span className="en-pic" data-testid="en-pic"><Icon name={stem.art} emoji={artEmoji(stem.art)} alt={label} /></span>
  if (stem.swatch) return <span className="en-pic swatch" data-testid="en-pic" style={{ background: stem.swatch }} role="img" aria-label={label} />
  return <span className="en-pic digit" data-testid="en-pic" role="img" aria-label={label}><b>{stem.digit}</b></span>
}

function EnChoice({ c, state, onPick, onSpeak }: { c: Choice; state: CardState; onPick: () => void; onSpeak?: () => void }) {
  const disabled = state === 'wrong' || state === 'disabled' || state === 'right'
  const zh = EN_BY_WORD[c.id]?.zh ?? c.id
  const btn = (
    <button
      type="button"
      className={`choice choice-${state} en-choice ${c.text ? 'en-text' : ''} ${onSpeak ? 'q7-lite' : ''}`}
      disabled={disabled}
      onClick={onPick}
      data-testid="choice"
      data-choice-id={c.id}
      data-state={state}
      aria-label={c.text ?? zh}
    >
      {c.art ? (
        <span className="choice-art">
          <Icon name={c.art} emoji={artEmoji(c.art)} alt={zh} />
        </span>
      ) : c.swatch ? (
        <span className="en-swatch" style={{ background: c.swatch } as CSSProperties} aria-hidden />
      ) : c.label !== undefined ? (
        <span className="choice-num">{c.label}</span>
      ) : (
        <span className="choice-word q7-enword">{c.text}</span>
      )}
    </button>
  )
  if (!onSpeak) return btn
  return (
    <div className="q7-cardwrap">
      {btn}
      <button type="button" className="q7-speak" onClick={onSpeak} aria-label={`聽英文：${c.text ?? c.id}`} data-testid="en-card-speak" data-choice-id={c.id}>
        <span aria-hidden>🔊</span>
      </button>
    </div>
  )
}

/**
 * 英文單字題：聽英文選圖（hear）、看圖選單字（pic2en）、聽中文選單字（zh2en）、拼字（spell）。
 * 對錯由關卡畫面判斷（和一般點選題一樣走 onPick），這裡只負責畫面。
 * 英文單字的語音：喇叭鈕隨時可以再聽一次（家長關語音時也一樣，因為是孩子自己按的）。
 */
export function EnglishView({ q, hintStage, tapped, solved, onPick }: Props) {
  const word = q.params?.word ?? ''
  const zh = q.params?.zh ?? ''
  const stem = q.params?.stem
  const hinting = hintStage > 0 && !solved
  const speak = () => word && sayEnglish(word, { enabled: true })

  const stateOf = (c: Choice): CardState => {
    if (solved) return c.id === q.answer ? 'right' : 'disabled'
    if (tapped.has(c.id)) return 'wrong'
    if (hintStage === 2) return c.id === q.answer ? 'answer' : 'disabled'
    return 'idle'
  }

  const speaker = (big = false) => (
    <button type="button" className={`en-speak ${big ? 'big' : ''}`} onClick={speak} data-testid="en-speak" aria-label="再聽一次英文">
      <span aria-hidden>🔊</span>
      {big && <b className="en-word" data-testid="en-word">{word}</b>}
    </button>
  )

  const textChoices = q.choices.every((c) => c.text !== undefined)
  // v7：難度 1 的看圖選字、中翻英：字卡是大字加喇叭，點喇叭先聽、點卡片作答；中翻英的題幹一開始就看得到圖
  const lite = q.difficulty === 1 && (q.type === 'pic2en' || q.type === 'zh2en')
  const letters = q.type === 'spell' && q.params?.pattern ? [...q.params.pattern] : []

  return (
    <div className={`qv qv-${q.type} qv-en has-stem`} data-testid="question" data-question-id={q.id} data-hint-stage={hintStage} data-type={q.type} data-word={word}>
      <div className={`qv-stem en-stem en-stem-${q.type}`}>
        {q.type === 'hear' && speaker(true)}
        {q.type === 'pic2en' && (
          <>
            <StemPic stem={stem} label={zh} />
            {hinting && speaker()}
          </>
        )}
        {q.type === 'zh2en' && (
          <>
            <b className="en-zh" data-testid="en-zh">{zh}</b>
            {(hinting || lite) && <StemPic stem={stem} label={zh} />}
            {hinting && speaker()}
          </>
        )}
        {q.type === 'spell' && (
          <>
            <StemPic stem={stem} label={zh} />
            <span className="en-spell" data-testid="spell-word" data-pattern={q.params?.pattern} role="img" aria-label={`缺一個字母的單字，共 ${letters.length} 個字母`}>
              {letters.map((ch, i) => (
                <span key={i} className={`en-letter ${ch === '_' ? 'blank' : ''} ${ch === '_' && solved ? 'filled' : ''}`}>
                  {ch === '_' ? (solved ? q.answer : '') : ch}
                </span>
              ))}
            </span>
            {speaker()}
          </>
        )}
      </div>
      <div className={`qv-choices n${q.choices.length} ${textChoices ? 'en-text-choices' : ''}`}>
        {q.choices.map((c) => (
          <EnChoice key={c.id} c={c} state={stateOf(c)} onPick={() => onPick(c.id)} onSpeak={lite ? () => sayEnglish(c.id, { enabled: true }) : undefined} />
        ))}
      </div>
    </div>
  )
}
