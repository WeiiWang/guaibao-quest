import { useEffect, useState, type CSSProperties } from 'react'
import { mustObject } from '../../../learning/objects'
import type { Choice, Question, Visual } from '../../../learning/types'
import { OBJ_EMOJI } from '../../../art/items'
import { Icon } from '../../components/Icon'
import './adventure.css'

export type HintStage = 0 | 1 | 2

interface Props {
  q: Question
  hintStage: HintStage
  /** 已經點錯的選項 id（會變灰、不能再點） */
  tapped: ReadonlySet<string>
  solved: boolean
  onPick: (choiceId: string) => void
}

/** 提示動畫：一個一個亮起（數數）。回傳每堆目前亮到第幾個。 */
function useCountingLit(active: boolean, totals: number[]): number[] {
  const [step, setStep] = useState(0)
  const sum = totals.reduce((a, b) => a + b, 0)
  useEffect(() => {
    if (!active) return
    setStep(0)
    const id = window.setInterval(() => setStep((s) => (s >= sum ? s : s + 1)), 450)
    return () => window.clearInterval(id)
  }, [active, sum])
  let left = active ? step : 0
  return totals.map((t) => {
    const lit = Math.min(t, left)
    left -= lit
    return lit
  })
}

/** 提示動畫：序列由左到右輪流亮起 */
function useSequenceLit(active: boolean, length: number): number {
  const [i, setI] = useState(-1)
  useEffect(() => {
    if (!active) return
    setI(0)
    const id = window.setInterval(() => setI((x) => (x + 1) % (length + 1)), 600)
    return () => window.clearInterval(id)
  }, [active, length])
  return active ? i : -1
}

const objName = (id: string) => mustObject(id).name
const ObjIcon = ({ id, className }: { id: string; className?: string }) => (
  <Icon name={id} emoji={OBJ_EMOJI[id]} alt={objName(id)} className={className} />
)

function Pile({ obj, count, lit, size, label }: { obj: string; count: number; lit?: number; size: number; label?: string }) {
  const cols = Math.min(count > 10 ? 7 : 5, count)
  const hinting = lit !== undefined
  // 物件邊長：不超過 size，也不超過容器寬度能放下的大小（cqw = 外層容器寬）
  const style = { ['--cols' as string]: cols, ['--base' as string]: `${size}px` } as CSSProperties
  return (
    <div className="pile" style={style} data-count={count} aria-label={label ?? `${count} 個${objName(obj)}`} role="img">
      {Array.from({ length: count }, (_, i) => {
        const on = hinting && i < (lit as number)
        return (
          <span key={i} className={`pile-item ${hinting ? (on ? 'lit' : 'dim') : ''}`}>
            <ObjIcon id={obj} />
            {on && <b className="pile-num">{i + 1}</b>}
          </span>
        )
      })}
    </div>
  )
}

const pileSize = (count: number, wide = true) => (count <= 3 ? (wide ? 120 : 72) : count <= 5 ? (wide ? 96 : 64) : count <= 10 ? (wide ? 76 : 48) : wide ? 58 : 38)

function ChoiceCard({
  c,
  q,
  state,
  onPick,
  lit,
}: {
  c: Choice
  q: Question
  state: 'idle' | 'wrong' | 'answer' | 'right' | 'disabled'
  onPick: () => void
  lit?: number
}) {
  const disabled = state === 'wrong' || state === 'disabled' || state === 'right'
  return (
    <button
      type="button"
      className={`choice choice-${state} ${c.count ? 'choice-pile' : ''}`}
      disabled={disabled}
      onClick={onPick}
      data-testid="choice"
      data-choice-id={c.id}
      data-state={state}
      aria-label={c.label ?? (c.count ? `${c.count} 個${objName(c.obj as string)}` : objName(c.obj as string))}
    >
      {c.label !== undefined ? (
        <span className="choice-num">{c.label}</span>
      ) : c.count ? (
        <Pile obj={c.obj as string} count={c.count} size={pileSize(c.count, false)} lit={lit} />
      ) : (
        <>
          <span className="choice-art">
            <ObjIcon id={c.obj as string} />
          </span>
          {q.type !== 'color' && <span className="choice-name">{objName(c.obj as string)}</span>}
        </>
      )}
    </button>
  )
}

/** 一題：題幹（物件排列）＋大張選項卡片＋提示動畫 */
export function QuestionView({ q, hintStage, tapped, solved, onPick }: Props) {
  const hinting = hintStage > 0 && !solved
  // 數量類的提示：一個一個亮起
  const stemPiles: Visual[] = q.type === 'count' || q.type === 'diff' ? q.items : []
  const piles = q.type === 'compare' ? q.choices.map((c) => c.count as number) : stemPiles.map((v) => v.count as number)
  const lit = useCountingLit(hinting && piles.length > 0, piles)
  const seqLit = useSequenceLit(hinting && (q.type === 'next' || q.type === 'missing'), q.items.length)

  const stateOf = (c: Choice): 'idle' | 'wrong' | 'answer' | 'right' | 'disabled' => {
    if (solved) return c.id === q.answer ? 'right' : 'disabled'
    if (tapped.has(c.id)) return 'wrong'
    if (hintStage === 2) return c.id === q.answer ? 'answer' : 'disabled'
    return 'idle'
  }

  return (
    <div className={`qv qv-${q.type} ${q.type === 'count' || q.type === 'diff' || q.type === 'next' || q.type === 'missing' ? 'has-stem' : 'no-stem'}`} data-testid="question" data-question-id={q.id} data-hint-stage={hintStage}>
      {(q.type === 'count' || q.type === 'diff') && (
        <div className={`qv-stem ${q.type === 'diff' ? 'two' : ''}`}>
          {stemPiles.map((v, i) => (
            <div key={i} className="stem-pile">
              {q.type === 'diff' && <span className="stem-label">{i === 0 ? '左邊' : '右邊'}</span>}
              <Pile obj={v.obj as string} count={v.count as number} size={pileSize(v.count as number)} lit={hinting ? lit[i] : undefined} />
            </div>
          ))}
        </div>
      )}
      {(q.type === 'next' || q.type === 'missing') && (
        <div className="qv-stem seq" style={{ ['--n' as string]: q.items.length, ['--n2' as string]: q.items.length <= 3 ? q.items.length : Math.ceil(q.items.length / 2) } as CSSProperties} role="img" aria-label="一排物件，其中有一格是問號">
          {q.items.map((v, i) => (
            <span key={i} className={`seq-cell ${v.obj === null ? 'blank' : ''} ${seqLit === i ? 'lit' : ''}`}>
              {v.obj === null ? <b>？</b> : <ObjIcon id={v.obj} />}
            </span>
          ))}
        </div>
      )}
      <div className={`qv-choices n${q.choices.length} ${q.type === 'compare' ? 'piles' : ''}`}>
        {q.choices.map((c, i) => (
          <ChoiceCard
            key={c.id}
            c={c}
            q={q}
            state={stateOf(c)}
            onPick={() => onPick(c.id)}
            lit={q.type === 'compare' && hinting ? lit[i] : undefined}
          />
        ))}
      </div>
    </div>
  )
}
