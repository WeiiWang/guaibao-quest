import { useEffect, useRef, useState } from 'react'
import { artAltOf, artEmojiOf } from '../../../learning/lifeNature'
import { pickLine, wordKey } from '../../../learning/lines'
import { say } from '../../../learning/speech'
import type { Choice, Question } from '../../../learning/types'
import { Icon } from '../../components/Icon'
import { useDragKit } from './DragKit'
import type { HintStage } from './QuestionView'
import './adventure-v4.css'
import './adventure-v6-life.css'

interface Props {
  q: Question
  hintStage: HintStage
  solved: boolean
  voiceOn: boolean
  /** 放錯一次 */
  onWrong: () => void
  /** 全部排對 */
  onSolved: () => void
}

/** 卡片上的圖：情境圖（缺圖用 emoji）或 emoji */
function CardFace({ c, big = false }: { c: Choice; big?: boolean }) {
  return (
    <>
      {c.art ? (
        <span className={`sto-art ${big ? 'big' : ''}`}>
          <Icon name={c.art} emoji={artEmojiOf(c.art)} alt={c.alt ?? c.text ?? artAltOf(c.art)} />
        </span>
      ) : (
        c.emoji && (
          <span className={`sto-emoji ${big ? 'big' : ''}`} aria-hidden>
            {c.emoji}
          </span>
        )
      )}
      {c.text && <b className="sto-text">{c.text}</b>}
    </>
  )
}

/**
 * 步驟排序：把幾張卡片依順序放進一排格子（洗手步驟、四季、植物生長）。
 * - 點一張卡片：放進下一個空格（放對就留在格子裡，放錯彈回去）。
 * - 拖曳：拖到指定的格子（Pointer Events，滑鼠、觸控共用）。
 * 全部排對就答對。對錯在這裡判斷（params.order 是正確順序）；第二次錯起，下一張該放的卡與它的格子會發光。
 */
export function StepOrderView({ q, hintStage, solved, voiceOn, onWrong, onSolved }: Props) {
  const order = q.params?.order ?? []
  const cards = q.choices
  const byId = new Map(cards.map((c) => [c.id, c]))
  // placed[i] = 第 i 格放了哪張卡片（沒放 = undefined）
  const [placed, setPlaced] = useState<(string | undefined)[]>(() => order.map(() => undefined))
  const [bounce, setBounce] = useState<string | null>(null)
  const bounceTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(bounceTimer.current), [])

  const nextSlot = placed.findIndex((p) => p === undefined)

  const place = (cardId: string, slot: number) => {
    if (solved || placed[slot] !== undefined || placed.includes(cardId)) return
    if (order[slot] === cardId) {
      const next = placed.map((p, i) => (i === slot ? cardId : p))
      setPlaced(next)
      if (next.every((p) => p !== undefined)) {
        const l = pickLine('order.done')
        say(l.key, l.text, { enabled: voiceOn })
        onSolved()
      } else {
        const text = byId.get(cardId)?.text
        if (text) say(wordKey(text), text, { enabled: voiceOn })
      }
      return
    }
    setBounce(cardId)
    window.clearTimeout(bounceTimer.current)
    bounceTimer.current = window.setTimeout(() => setBounce(null), 600)
    const l = pickLine('order.wrong')
    say(l.key, l.text, { enabled: voiceOn })
    onWrong()
  }

  const { bind, ghostNode, draggingId, overDrop } = useDragKit({
    disabled: solved,
    onTap: (id) => {
      if (nextSlot >= 0) place(id, nextSlot)
    },
    onDrop: (id, dropId) => {
      if (dropId === null) return // 沒放在格子上：原地彈回（不算錯）
      place(id, Number(dropId))
    },
    renderGhost: (id) => <CardFace c={byId.get(id) as Choice} />,
  })

  // 第二次錯起：下一張該放的卡片和它的格子發光
  const glowCard = hintStage >= 2 && !solved && nextSlot >= 0 ? order[nextSlot] : null

  return (
    <div className="sto" data-testid="question" data-question-id={q.id} data-hint-stage={hintStage} data-type={q.type} data-order={order.join(',')}>
      <ol className="sto-slots" aria-label="排好的順序">
        {order.map((_, i) => {
          const id = placed[i]
          const c = id ? byId.get(id) : undefined
          return (
            <li
              key={i}
              className={`sto-slot ${c ? 'filled' : ''} ${overDrop === String(i) ? 'over' : ''} ${glowCard && i === nextSlot ? 'demo' : ''}`}
              data-testid="order-slot"
              data-slot={i}
              data-drop={String(i)}
              data-filled={id ?? ''}
            >
              <span className="sto-no" aria-hidden>
                {i + 1}
              </span>
              {c && (
                <span className="sto-placed" data-testid="order-placed">
                  <CardFace c={c} />
                </span>
              )}
            </li>
          )
        })}
      </ol>
      <div className="sto-tray" aria-label="要排順序的卡片">
        {cards.map((c) =>
          placed.includes(c.id) ? (
            <span key={c.id} className="sto-gap" aria-hidden />
          ) : (
            <button
              key={c.id}
              type="button"
              className={`sto-card ${bounce === c.id ? 'bounce' : ''} ${glowCard === c.id ? 'demo' : ''} ${draggingId === c.id ? 'dragging' : ''}`}
              data-testid="order-card"
              data-card={c.id}
              aria-label={`${c.alt ?? c.text ?? c.id}（點一下放進下一格，或拖到格子裡）`}
              disabled={solved}
              {...bind(c.id)}
            >
              <CardFace c={c} big />
            </button>
          ),
        )}
      </div>
      {ghostNode}
    </div>
  )
}
