import { useEffect, useState, type CSSProperties } from 'react'
import { hintDriven, highlightsSame } from '../../../learning/hint'
import { numberKey, totalKey, totalText, wordKey } from '../../../learning/lines'
import { mustObject } from '../../../learning/objects'
import { chineseNumber, say } from '../../../learning/speech'
import type { Choice, Question, Visual } from '../../../learning/types'
import { OBJ_EMOJI } from '../../../art/items'
import { Icon } from '../../components/Icon'
import './adventure.css'
import './adventure-v4.css'

export type HintStage = 0 | 1 | 2

interface Props {
  q: Question
  hintStage: HintStage
  /** 已經點錯的選項 id（會變灰、不能再點） */
  tapped: ReadonlySet<string>
  solved: boolean
  onPick: (choiceId: string) => void
  /** 語音開關（提示動畫逐個唸時用） */
  voiceOn?: boolean
  /** 提示動畫延後幾毫秒開始（幼幼模式先唸一句鼓勵的話） */
  startDelay?: number
}

/** 逐一亮起並同步唸數字（數數提示）。回傳每堆目前亮到第幾個、全部數完了沒 */
function useCountingLit(active: boolean, totals: number[], voiceOn: boolean, startDelay: number): { lit: number[]; done: boolean } {
  const [step, setStep] = useState(0)
  const sum = totals.reduce((a, b) => a + b, 0)
  useEffect(() => {
    if (!active || sum === 0) {
      setStep(0)
      return
    }
    setStep(0)
    const ids: number[] = []
    let k = 0
    const gap = voiceOn ? 760 : 450
    const tick = () => {
      k += 1
      setStep(k)
      say(numberKey(k), chineseNumber(k), { enabled: voiceOn })
      if (k < sum) ids.push(window.setTimeout(tick, gap))
      else ids.push(window.setTimeout(() => say(totalKey(sum), totalText(sum), { enabled: voiceOn }), 700))
    }
    ids.push(window.setTimeout(tick, startDelay))
    return () => ids.forEach((id) => window.clearTimeout(id))
  }, [active, sum, voiceOn, startDelay])
  let left = active ? step : 0
  const lit = totals.map((t) => {
    const n = Math.min(t, left)
    left -= n
    return n
  })
  return { lit, done: active && sum > 0 && step >= sum }
}

/** 逐個唸出序列裡的字（物件名、顏色、數量…）並亮起那一格；空格唸「空格」。唸完一輪就停 */
function useSequenceRead(active: boolean, words: string[], voiceOn: boolean, startDelay: number): number {
  const [i, setI] = useState(-1)
  useEffect(() => {
    if (!active || words.length === 0) {
      setI(-1)
      return
    }
    const ids: number[] = []
    let k = 0
    const gap = voiceOn ? 900 : 550
    const tick = () => {
      setI(k)
      const w = words[k] || '空格'
      say(wordKey(w), w, { enabled: voiceOn })
      k += 1
      if (k < words.length) ids.push(window.setTimeout(tick, gap))
      else ids.push(window.setTimeout(() => setI(-1), gap))
    }
    setI(-1)
    ids.push(window.setTimeout(tick, startDelay))
    return () => ids.forEach((id) => window.clearTimeout(id))
    // words 內容隨題目固定；用 join 當依賴避免每次 render 重新開始
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, words.join('|'), voiceOn, startDelay])
  return active ? i : -1
}

const objName = (id: string) => mustObject(id).name
const ObjIcon = ({ id, className }: { id: string; className?: string }) => (
  <Icon name={id} emoji={OBJ_EMOJI[id]} alt={objName(id)} className={className} />
)

function Pile({
  obj,
  count,
  lit,
  size,
  label,
  numOffset = 0,
  total,
}: {
  obj: string
  count: number
  lit?: number
  size: number
  label?: string
  /** 數字徽章從第幾個開始接著數（加法題第二堆） */
  numOffset?: number
  /** 這是最後一個被數到的物件時，徽章放大強調 */
  total?: number
}) {
  // 5 一列、兩列一組（看得出 5 和 10 的結構）
  const cols = Math.min(5, count)
  const hinting = lit !== undefined
  const style = { ['--cols' as string]: cols, ['--base' as string]: `${size}px` } as CSSProperties
  return (
    <div className="pile" style={style} data-count={count} aria-label={label ?? `${count} 個${objName(obj)}`} role="img">
      {Array.from({ length: count }, (_, i) => {
        const on = hinting && i < (lit as number)
        const last = total !== undefined && numOffset + i + 1 === total && on
        return (
          <span key={i} className={`pile-item ${Math.floor(i / 5) % 2 === 1 ? 'row-b' : ''} ${hinting ? (on ? 'lit' : 'dim') : ''}`}>
            <ObjIcon id={obj} />
            {on && <b className={`pile-num ${last ? 'last' : ''}`}>{numOffset + i + 1}</b>}
          </span>
        )
      })}
    </div>
  )
}

const pileSize = (count: number, wide = true) => (count <= 3 ? (wide ? 120 : 72) : count <= 5 ? (wide ? 96 : 64) : count <= 10 ? (wide ? 76 : 48) : wide ? 58 : 38)

/** 配對提示：兩堆一個對一個連起來，多出來的亮起（比多少、多幾個） */
function MatchBoard({ obj, a, b }: { obj: string; a: number; b: number }) {
  const [paired, setPaired] = useState(0)
  const cols = Math.max(a, b)
  useEffect(() => {
    setPaired(0)
    const id = window.setInterval(() => setPaired((p) => (p >= cols ? p : p + 1)), 420)
    return () => window.clearInterval(id)
  }, [cols])
  const groups: number[][] = []
  for (let i = 0; i < cols; i += 10) groups.push(Array.from({ length: Math.min(10, cols - i) }, (_, k) => i + k))
  const done = paired >= cols
  return (
    <div className={`match ${done ? 'done' : ''}`} data-testid="match-board" role="img" aria-label="一個配一個，多出來的亮起來">
      {groups.map((g, gi) => (
        <div key={gi} className="match-row" style={{ ['--mc' as string]: g.length } as CSSProperties}>
          {g.map((i) => {
            const both = i < a && i < b
            const on = i < paired
            return (
              <span key={i} className={`match-col ${on && both ? 'linked' : ''} ${done && !both ? 'extra' : ''}`}>
                <span className={`match-cell blue ${i < a ? '' : 'none'}`}>{i < a && <ObjIcon id={obj} />}</span>
                <i className="match-link" />
                <span className={`match-cell orange ${i < b ? '' : 'none'}`}>{i < b && <ObjIcon id={obj} />}</span>
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

type CardState = 'idle' | 'wrong' | 'answer' | 'right' | 'disabled'

function ChoiceCard({
  c,
  q,
  state,
  onPick,
  hintSame,
  onSpeak,
}: {
  c: Choice
  q: Question
  state: CardState
  onPick: () => void
  hintSame?: 'same' | 'other'
  /** v7：難度 1 的數字卡右上角的小喇叭（點喇叭唸數字，點卡片直接作答） */
  onSpeak?: () => void
}) {
  const disabled = state === 'wrong' || state === 'disabled' || state === 'right'
  const btn = (
    <button
      type="button"
      className={`choice choice-${state} ${c.count ? 'choice-pile' : ''} ${c.tone ? `tone-${c.tone}` : ''} ${hintSame ? `hint-${hintSame}` : ''}`}
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
        <Pile obj={c.obj as string} count={c.count} size={pileSize(c.count, false)} />
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
  if (!onSpeak) return btn
  return (
    <div className="q7-cardwrap">
      {btn}
      <button type="button" className="q7-speak" onClick={onSpeak} aria-label={`聽數字 ${c.label}`} data-testid="num-speak" data-choice-id={c.id}>
        <span aria-hidden>🔊</span>
      </button>
    </div>
  )
}

const SEQ_TYPES = ['next', 'missing', 'attr', 'grow', 'seqnum']

/** 一題：題幹（物件排列）＋大張選項卡片＋提示動畫 */
export function QuestionView({ q, hintStage, tapped, solved, onPick, voiceOn = true, startDelay = 350 }: Props) {
  const hinting = hintStage > 0 && !solved
  const isSeq = SEQ_TYPES.includes(q.type)
  const flash = q.params?.flash
  const [flashOn, setFlashOn] = useState(true)
  const [flashRun, setFlashRun] = useState(0)
  useEffect(() => {
    if (!flash) return
    setFlashOn(true)
    const id = window.setTimeout(() => setFlashOn(false), flash)
    return () => window.clearTimeout(id)
  }, [flash, flashRun])
  const covered = !!flash && !flashOn && !hinting && !solved

  // 數數類（數一數、加法）的提示：一個一個亮起、同步唸數字
  const stemPiles: Visual[] = q.type === 'count' || q.type === 'diff' || q.type === 'add' ? q.items : []
  const counting = hinting && (q.type === 'count' || q.type === 'add')
  const { lit, done: counted } = useCountingLit(
    counting,
    stemPiles.map((v) => v.count as number),
    voiceOn,
    startDelay,
  )
  const sumCount = stemPiles.reduce((n, v) => n + (v.count as number), 0)
  // 序列類的提示：逐個唸出來、亮起
  const seqLit = useSequenceRead(hinting && isSeq, q.params?.words ?? [], voiceOn, startDelay)

  // 數字選項在難度 1：卡片右上角有小喇叭，點喇叭唸數字，點卡片就直接作答（不再是兩段式，試玩審查 G6）
  const numberCards = q.difficulty === 1 && q.choices.every((c) => c.label !== undefined)
  const speakNum = (c: Choice) => {
    const n = Number(c.label)
    say(numberKey(n), chineseNumber(n), { enabled: true })
  }

  const stateOf = (c: Choice): CardState => {
    if (solved) return c.id === q.answer ? 'right' : 'disabled'
    if (tapped.has(c.id)) return 'wrong'
    if (hintStage === 2) return c.id === q.answer ? 'answer' : 'disabled'
    return 'idle'
  }

  const same = new Set(q.params?.same ?? [])
  const sameHint = (c: Choice): 'same' | 'other' | undefined => (hinting && highlightsSame(q) ? (same.has(c.id) ? 'same' : 'other') : undefined)
  const matchCounts: [number, number] | null =
    hinting && q.type === 'compare'
      ? [q.choices.find((c) => c.tone === 'blue')?.count ?? 0, q.choices.find((c) => c.tone === 'orange')?.count ?? 0]
      : hinting && q.type === 'diff'
        ? [q.items[0].count as number, q.items[1].count as number]
        : null
  const matchObj = (q.type === 'compare' ? q.choices[0].obj : q.items[0]?.obj) as string
  const showSwatch = hinting && q.params?.swatch && (q.type === 'color' || q.type === 'same' || q.type === 'dual')
  const core = q.params?.core ?? 0
  const hasStem = ['count', 'diff', 'add', 'same'].includes(q.type) || isSeq

  return (
    <div
      className={`qv qv-${q.type} ${hasStem ? 'has-stem' : 'no-stem'} ${matchCounts || (showSwatch && q.type !== 'same') ? 'has-board' : ''}`}
      data-testid="question"
      data-question-id={q.id}
      data-hint-stage={hintStage}
      data-type={q.type}
    >
      {(q.type === 'count' || q.type === 'diff' || q.type === 'add') && (
        <div className={`qv-stem ${q.type !== 'count' ? 'two' : ''} ${covered ? 'covered' : ''}`}>
          {covered ? (
            <button type="button" className="flash-cover" onClick={() => setFlashRun((n) => n + 1)} data-testid="flash-again" aria-label="再看一下">
              <span aria-hidden>👀</span>
              <span>再看一下</span>
            </button>
          ) : (
            stemPiles.map((v, i) => (
              <div key={i} className={`stem-pile ${v.tone ? `tone-${v.tone}` : ''}`}>
                {q.type !== 'count' && <span className={`stem-dot ${v.tone ?? ''}`} aria-hidden />}
                <Pile
                  obj={v.obj as string}
                  count={v.count as number}
                  size={pileSize(v.count as number)}
                  lit={hinting && counting ? lit[i] : undefined}
                  numOffset={q.type === 'add' ? stemPiles.slice(0, i).reduce((n, x) => n + (x.count as number), 0) : 0}
                  total={q.type === 'add' ? sumCount : undefined}
                />
              </div>
            ))
          )}
          {counted && (
            <span className="count-total" data-testid="count-total" aria-live="polite">
              一共 {sumCount} 個
            </span>
          )}
        </div>
      )}
      {q.type === 'same' && (
        <div className="qv-stem exemplar">
          <span className="exemplar-art">
            <ObjIcon id={q.items[0].obj as string} />
          </span>
          <span className="exemplar-name">{objName(q.items[0].obj as string)}</span>
          {showSwatch && <span className="qv-swatch" style={{ background: q.params?.swatch }} aria-label={q.params?.colorWord} />}
        </div>
      )}
      {isSeq && (
        <div
          className={`qv-stem seq ${q.type === 'seqnum' ? 'nums' : ''}`}
          style={{ ['--n' as string]: q.items.length, ['--n2' as string]: q.items.length <= 4 ? q.items.length : Math.ceil(q.items.length / 2) } as CSSProperties}
          role="img"
          aria-label="一排東西，其中有一格是空格"
        >
          {q.items.map((v, i) => {
            const blank = q.type === 'seqnum' ? v.label == null : v.obj === null
            const unit = hinting && core > 0 ? (i < core ? 'core-a' : i < core * 2 ? 'core-b' : '') : ''
            return (
              <span key={i} className={`seq-cell ${blank ? 'blank' : ''} ${seqLit === i ? 'lit' : ''} ${unit}`}>
                {blank ? (
                  <b>？</b>
                ) : q.type === 'seqnum' ? (
                  <b className="seq-num">{v.label}</b>
                ) : q.type === 'grow' ? (
                  <MiniPile obj={v.obj as string} count={v.count as number} />
                ) : (
                  <ObjIcon id={v.obj as string} />
                )}
              </span>
            )
          })}
        </div>
      )}
      {showSwatch && q.type !== 'same' && (
        <div className="hint-swatch" data-testid="hint-swatch">
          <span className="qv-swatch big" style={{ background: q.params?.swatch }} />
          <b>{q.params?.colorWord}</b>
        </div>
      )}
      {matchCounts && (
        <MatchBoard obj={matchObj} a={matchCounts[0]} b={matchCounts[1]} />
      )}
      <div className={`qv-choices n${q.choices.length} ${q.type === 'compare' ? 'piles' : ''}`}>
        {q.choices.map((c) => (
          <ChoiceCard
            key={c.id}
            c={c}
            q={q}
            state={stateOf(c)}
            onPick={() => onPick(c.id)}
            hintSame={sameHint(c)}
            onSpeak={numberCards ? () => speakNum(c) : undefined}
          />
        ))}
      </div>
      {/* 提示逐個唸的詞，供螢幕閱讀器與測試讀取 */}
      {hinting && hintDriven(q) && <span className="sr-only" data-testid="hint-driven" />}
    </div>
  )
}

/** 成長規律題幹格裡的小堆（1、2、3 個） */
function MiniPile({ obj, count }: { obj: string; count: number }) {
  return (
    <span className="mini-pile" aria-label={`${count} 個${objName(obj)}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="mini-item">
          <ObjIcon id={obj} />
        </span>
      ))}
    </span>
  )
}
