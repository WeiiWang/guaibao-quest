import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { OBJ_EMOJI } from '../../../art/items'
import { numberKey } from '../../../learning/lines'
import { mustObject } from '../../../learning/objects'
import { anchorBoxes, isPeek, mustProp, REL_WORD, subjectBox } from '../../../learning/space'
import { chineseNumber, say } from '../../../learning/speech'
import type { Choice, Question, Rel, Variant } from '../../../learning/types'
import { Icon } from '../../components/Icon'
import { scaleStyle } from './OrderView'
import type { HintStage } from './QuestionView'
import { SceneCard, SpaceScene } from './SpaceScene'
import './adventure.css'
import './adventure-v4.css'
import './adventure-v6.css'

interface Props {
  q: Question
  hintStage: HintStage
  /** 已經點錯的選項 id（會變灰、不能再點） */
  tapped: ReadonlySet<string>
  solved: boolean
  onPick: (choiceId: string) => void
  voiceOn?: boolean
  startDelay?: number
}

type CardState = 'idle' | 'wrong' | 'answer' | 'right' | 'disabled'

const objName = (id: string) => mustObject(id).name
const ObjIcon = ({ id }: { id: string }) => <Icon name={id} emoji={OBJ_EMOJI[id]} alt={objName(id)} />

/** 選項箭頭（給還不識字的孩子看；文字同時唸出來） */
const REL_GLYPH: Record<Rel, string> = { above: '⬆', below: '⬇', inside: '⤵', outside: '↗', left: '⬅', right: '➡', between: '↔' }

/** 一個選項卡片（和 QuestionView 的卡片同樣的外觀與 data 屬性，測試與樣式共用） */
function Card({ c, state, onPick, label, className = '', children }: { c: Choice; state: CardState; onPick: () => void; label: string; className?: string; children: ReactNode }) {
  const disabled = state === 'wrong' || state === 'disabled' || state === 'right'
  return (
    <button type="button" className={`choice choice-${state} ${className}`} disabled={disabled} onClick={onPick} data-testid="choice" data-choice-id={c.id} data-state={state} aria-label={label}>
      {children}
    </button>
  )
}

/** 快閃：題幹的東西只亮一下就蓋起來。回傳還亮著嗎，與「再看一下」 */
function useFlash(ms: number | undefined): [boolean, () => void] {
  const [on, setOn] = useState(true)
  const [run, setRun] = useState(0)
  useEffect(() => {
    if (!ms) return
    setOn(true)
    const id = window.setTimeout(() => setOn(false), ms)
    return () => window.clearTimeout(id)
  }, [ms, run])
  return [on, () => setRun((n) => n + 1)]
}

/** 提示時一個一個亮起數字（排隊的位置）：唸「一、二、三」 */
function useNumbering(active: boolean, n: number, voiceOn: boolean, startDelay: number): number {
  const [k, setK] = useState(0)
  useEffect(() => {
    if (!active || n === 0) {
      setK(0)
      return
    }
    setK(0)
    const ids: number[] = []
    let i = 0
    const gap = voiceOn ? 800 : 450
    const tick = () => {
      i += 1
      setK(i)
      say(numberKey(i), chineseNumber(i), { enabled: voiceOn })
      if (i < n) ids.push(window.setTimeout(tick, gap))
    }
    ids.push(window.setTimeout(tick, startDelay))
    return () => ids.forEach((id) => window.clearTimeout(id))
  }, [active, n, voiceOn, startDelay])
  return active ? k : 0
}

/** 找不一樣：那張卡的 CSS 變化 */
export function variantStyle(v: Variant | undefined): CSSProperties {
  if (!v) return {}
  const filters = [v.hue !== undefined ? `hue-rotate(${v.hue}deg)` : '', v.gray ? 'grayscale(1)' : ''].filter(Boolean).join(' ')
  return { ...(filters ? { filter: filters } : {}), ...(v.rot !== undefined ? { transform: `rotate(${v.rot}deg)` } : {}) }
}

/**
 * 第 2 章（水簾洞）的選擇題：比大小、空間方位（看圖選位置、看場景選文字、排隊的位置）、
 * 快閃記憶（剛剛出現的、什麼不見了）、找不一樣。點選選項作答，提示階梯和其他選擇題一樣（見 StageScreen.pick）。
 */
export function ScenePick({ q, hintStage, tapped, solved, onPick, voiceOn = true, startDelay = 350 }: Props) {
  const hinting = hintStage > 0 && !solved
  const stateOf = (c: Choice): CardState => {
    if (solved) return c.id === q.answer ? 'right' : 'disabled'
    if (tapped.has(c.id)) return 'wrong'
    if (hintStage === 2) return c.id === q.answer ? 'answer' : 'disabled'
    return 'idle'
  }

  // 快閃記憶
  const flashMs = q.type === 'recall' ? q.params?.flash : undefined
  const [flashOn, replayFlash] = useFlash(flashMs)
  const covered = !!flashMs && !flashOn && !hinting && !solved

  // 什麼不見了：先看一排東西，蓋起來，再顯示少了一個的那一排
  const goneMs = q.type === 'gone' ? (q.params?.flash ?? 3000) : 0
  const [phase, setPhase] = useState<'show' | 'cover' | 'after'>('show')
  const [goneRun, setGoneRun] = useState(0)
  useEffect(() => {
    if (!goneMs) return
    setPhase('show')
    const a = window.setTimeout(() => setPhase('cover'), goneMs)
    const b = window.setTimeout(() => setPhase('after'), goneMs + 900)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [goneMs, goneRun, q.id])

  // 排隊的位置：提示時一個一個數
  const lit = useNumbering(hinting && q.type === 'row', q.items.length, voiceOn, startDelay)

  const ctx = { hinting, solved }
  const choices = q.choices.map((c) => {
    const st = stateOf(c)
    const pick = () => onPick(c.id)
    switch (q.type) {
      case 'bigger': {
        const dim = c.dim ?? q.params?.dim ?? 'size'
        const maxScale = Math.max(...q.choices.map((x) => x.scale ?? 1))
        return (
          <Card key={c.id} c={c} state={st} onPick={pick} label={`${objName(c.obj as string)}（${dim === 'length' ? '長短' : dim === 'height' ? '高矮' : '大小'}不同）`} className={`mz-card dim-${dim}`}>
            <span className="mz-box">
              {ctx.hinting && (
                <span className="mz-ghostwrap" aria-hidden>
                  <i className="mz-ghost" style={scaleStyle(maxScale, dim)} />
                </span>
              )}
              <span className="mz-obj" style={scaleStyle(c.scale ?? 1, dim)}>
                <ObjIcon id={c.obj as string} />
              </span>
            </span>
          </Card>
        )
      }
      case 'where': {
        const spec = c.scene!
        return (
          <Card key={c.id} c={c} state={st} onPick={pick} label={`${objName(spec.subject)}在${mustProp(spec.anchor).name}的${REL_WORD[spec.rel]}`} className="sc-card">
            <SceneCard spec={spec} />
            {ctx.hinting && <b className="sc-word">{REL_WORD[spec.rel]}</b>}
          </Card>
        )
      }
      case 'whereIs': {
        const rel = c.id as Rel
        return (
          <Card key={c.id} c={c} state={st} onPick={pick} label={c.text ?? REL_WORD[rel]} className="wi-card">
            <span className="wi-glyph" aria-hidden>
              {REL_GLYPH[rel]}
            </span>
            <b className="wi-word">{c.text}</b>
          </Card>
        )
      }
      case 'spot': {
        return (
          <Card key={c.id} c={c} state={st} onPick={pick} label={`${objName(c.obj as string)}，第 ${Number(c.id.slice(1))} 張`} className="sp-card">
            <span className="sp-obj" style={variantStyle(c.variant)}>
              <ObjIcon id={c.obj as string} />
            </span>
          </Card>
        )
      }
      default:
        // row / recall / gone：選項是物件卡片
        return (
          <Card key={c.id} c={c} state={st} onPick={pick} label={objName(c.obj as string)}>
            <span className="choice-art">
              <ObjIcon id={c.obj as string} />
            </span>
            <span className="choice-name">{objName(c.obj as string)}</span>
          </Card>
        )
    }
  })

  // ---- 題幹 ----
  let stem: ReactNode = null
  if (q.type === 'whereIs') {
    const spec = q.params?.scene
    if (spec) {
      const prop = mustProp(spec.anchor)
      const boxes = anchorBoxes([spec.anchor])
      const box = subjectBox(spec.rel, boxes, 0, prop)
      stem = (
        <div className="qv-stem wi-stem">
          <SpaceScene anchors={[spec.anchor]} subject={{ id: spec.subject, box, peek: isPeek(spec.rel, prop) }} className={hinting ? 'sc-hint' : ''} label={`${objName(spec.subject)}和${prop.name}`} testId="whereis-scene" />
        </div>
      )
    } else {
      // 兩個東西排成一排：誰在誰的左邊還是右邊
      stem = (
        <div className="qv-stem rw-row" role="img" aria-label="排成一排的兩個東西">
          {q.items.map((it, i) => (
            <span key={i} className="rw-cell">
              <ObjIcon id={it.obj as string} />
            </span>
          ))}
        </div>
      )
    }
  } else if (q.type === 'row') {
    stem = (
      <div className="qv-stem rw-row" role="img" aria-label={`排成一排的 ${q.items.length} 個東西`} data-testid="row-stem">
        {q.items.map((it, i) => (
          <span key={i} className={`rw-cell ${lit === i + 1 ? 'lit' : ''}`}>
            <ObjIcon id={it.obj as string} />
            {i < lit && <b className="pile-num">{i + 1}</b>}
          </span>
        ))}
      </div>
    )
  } else if (q.type === 'recall') {
    stem = (
      <div className={`qv-stem rw-row ${covered ? 'covered' : ''}`} data-testid="recall-stem" data-covered={covered ? 'true' : undefined}>
        {covered ? (
          <button type="button" className="flash-cover" onClick={replayFlash} data-testid="flash-again" aria-label="再看一下">
            <span aria-hidden>👀</span>
            <span>再看一下</span>
          </button>
        ) : (
          q.items.map((it, i) => (
            <span key={i} className="rw-cell big">
              <ObjIcon id={it.obj as string} />
            </span>
          ))
        )}
      </div>
    )
  } else if (q.type === 'gone') {
    const goneAt = q.params?.goneAt ?? 0
    const both = hinting || solved
    const row = (hole: boolean, key: string) => (
      <div key={key} className="rw-row gone-row" role="img" aria-label={hole ? '現在的樣子，少了一個' : '剛剛的樣子'}>
        {q.items.map((it, i) => (
          <span key={i} className={`rw-cell ${hole && i === goneAt ? 'hole' : ''}`}>
            {hole && i === goneAt ? <b aria-hidden>？</b> : <ObjIcon id={it.obj as string} />}
          </span>
        ))}
      </div>
    )
    stem = (
      <div className="qv-stem gone-stem" data-testid="gone-stem" data-phase={both ? 'both' : phase}>
        {both ? (
          <>
            <p className="gone-tag">剛剛</p>
            {row(false, 'before')}
            <p className="gone-tag">現在</p>
            {row(true, 'after')}
          </>
        ) : phase === 'show' ? (
          row(false, 'before')
        ) : phase === 'cover' ? (
          <div className="rw-row gone-cover" aria-hidden>
            {q.items.map((_, i) => (
              <span key={i} className="rw-cell cover" />
            ))}
          </div>
        ) : (
          <>
            {row(true, 'after')}
            <button type="button" className="adv-btn small" onClick={() => setGoneRun((n) => n + 1)} data-testid="flash-again">
              再看一次
            </button>
          </>
        )}
      </div>
    )
  }

  const dim = q.params?.dim ?? q.choices[0]?.dim
  const n = q.choices.length
  const cls = [`qv`, `qv-${q.type}`, 'sv', stem ? 'has-stem' : 'no-stem', q.type === 'bigger' && dim ? `dim-${dim}` : ''].join(' ')
  // 快閃記憶：東西亮著（或還沒看到少了什麼）的時候先把選項藏起來，孩子要靠記憶，不是對照
  const hideChoices = !hinting && !solved && ((q.type === 'recall' && !!flashMs && flashOn) || (q.type === 'gone' && phase !== 'after'))
  const gridCls = [`qv-choices`, `n${n}`, q.type === 'bigger' ? `mz-choices dim-${dim}` : '', q.type === 'where' ? 'sc-choices' : '', q.type === 'whereIs' ? 'wi-choices' : '', q.type === 'spot' ? `sp-choices k${n} ${hinting ? 'scan' : ''}` : '', hideChoices ? 'sv-hide' : ''].join(' ')
  return (
    <div className={cls} data-testid="question" data-question-id={q.id} data-hint-stage={hintStage} data-type={q.type} data-skill={q.skill}>
      {stem}
      <div className={gridCls} aria-hidden={hideChoices || undefined} data-hidden={hideChoices ? 'true' : undefined}>
        {choices}
      </div>
    </div>
  )
}

