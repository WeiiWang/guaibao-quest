import { useEffect, useRef, useState } from 'react'
import { OBJ_EMOJI } from '../../../art/items'
import { pickLine } from '../../../learning/lines'
import { mustObject } from '../../../learning/objects'
import { say } from '../../../learning/speech'
import type { MeasureDim, Question } from '../../../learning/types'
import { Icon } from '../../components/Icon'
import { useDragKit } from './DragKit'
import type { HintStage } from './QuestionView'
import './adventure-v6.css'

interface Props {
  q: Question
  hintStage: HintStage
  solved: boolean
  voiceOn: boolean
  /** 放錯一次 */
  onWrong: () => void
  /** 全部排好 */
  onSolved: () => void
  /** 教學：阿悟示範把最先該放的放進第一格，示範完呼叫 onDemoEnd 並清空 */
  demo?: boolean
  onDemoEnd?: () => void
}

/** 圖的縮放：長短是橫向拉長，大小與高矮是整個放大縮小（高矮靠底部對齊顯示） */
export function scaleStyle(scale: number, dim: MeasureDim) {
  return { transform: dim === 'length' ? `scaleX(${scale})` : `scale(${scale})`, transformOrigin: dim === 'length' ? '0 50%' : '50% 100%' }
}

const WORDS: Record<MeasureDim, [string, string]> = { size: ['小', '大'], height: ['矮', '高'], length: ['短', '長'] }

/**
 * 排序：把大小（長短、高矮）不同的同一種東西排進格子。
 * 拖進格子，或點一下東西（亮起）再點格子。第 k 格該放哪個東西由 params.itemOrder 決定（items 是洗過牌的）。
 * 放對：東西進格子；放錯：彈回去，由關卡畫面接手提示階梯；第二次錯起，下一個該放的東西與格子會發光。
 * 全部放對就答對。判斷對錯在這裡。
 */
export function OrderView({ q, hintStage, solved, voiceOn, onWrong, onSolved, demo = false, onDemoEnd }: Props) {
  const order = q.params?.itemOrder ?? []
  const dim = q.params?.dim ?? 'size'
  const dir = q.params?.dir ?? 'asc'
  // slotItem[k] = 第 k 格放了 items 的第幾個（沒放 = undefined）
  const [slotItem, setSlotItem] = useState<(number | undefined)[]>(() => order.map(() => undefined))
  const [selected, setSelected] = useState<number | null>(null)
  const [bounce, setBounce] = useState<number | null>(null)
  const bounceTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(bounceTimer.current), [])

  const placedItems = new Set(slotItem.filter((v): v is number => v !== undefined))
  const nextSlot = slotItem.findIndex((v) => v === undefined)

  const place = (item: number, slot: number) => {
    if (solved || demo || slotItem[slot] !== undefined || placedItems.has(item)) return
    setSelected(null)
    if (order[slot] === item) {
      const next = slotItem.map((v, k) => (k === slot ? item : v))
      setSlotItem(next)
      if (next.every((v) => v !== undefined)) {
        const l = pickLine('sizeorder.done')
        say(l.key, l.text, { enabled: voiceOn })
        onSolved()
      }
      return
    }
    setBounce(item)
    window.clearTimeout(bounceTimer.current)
    bounceTimer.current = window.setTimeout(() => setBounce(null), 600)
    const l = pickLine('sizeorder.wrong')
    say(l.key, l.text, { enabled: voiceOn })
    onWrong()
  }

  const obj = q.items[0]?.obj as string
  const o = mustObject(obj)
  const pic = (scale: number) => (
    <span className="ord-obj" style={scaleStyle(scale, dim)}>
      <Icon name={obj} emoji={OBJ_EMOJI[obj]} alt={o.name} />
    </span>
  )

  const { bind, ghostNode, draggingId, overDrop } = useDragKit({
    disabled: solved || demo,
    onTap: (id) => {
      const i = Number(id)
      if (placedItems.has(i) || solved) return
      setSelected((s) => (s === i ? null : i))
    },
    onDrop: (id, dropId) => {
      if (dropId === null || !dropId.startsWith('slot')) return // 沒放在格子上：原地彈回（不算錯）
      place(Number(id), Number(dropId.slice(4)))
    },
    renderGhost: (id) => (
      <span className={`ord-ghost dim-${dim}`}>{pic(q.items[Number(id)].scale ?? 1)}</span>
    ),
  })

  // 教學：阿悟示範把最先該放的放進第一格，再清空換孩子試
  useEffect(() => {
    if (!demo) return
    const a = window.setTimeout(() => setSlotItem((p) => p.map((x, k) => (k === 0 ? order[0] : x))), 1100)
    const b = window.setTimeout(() => {
      setSlotItem(order.map(() => undefined))
      onDemoEnd?.()
    }, 3000)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
    // 只在進入教學時跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo])

  // 第二次錯起（教學時第一個）：下一個該放的東西與格子發光
  const glowItem = demo ? order[0] : hintStage >= 2 && !solved && nextSlot >= 0 ? order[nextSlot] : -1
  const glowSlot = demo ? 0 : hintStage >= 2 && !solved ? nextSlot : -1
  const [lo, hi] = WORDS[dim]
  const left = dir === 'asc' ? lo : hi
  const right = dir === 'asc' ? hi : lo

  return (
    <div className={`ord dim-${dim}`} data-testid="question" data-question-id={q.id} data-hint-stage={hintStage} data-type="order" data-dim={dim} data-dir={dir}>
      <div className="ord-arrow" aria-label={`由${left}排到${right}`}>
        <b>{left}</b>
        <i aria-hidden />
        <b>{right}</b>
      </div>
      <div className="ord-slots" aria-label="排隊的格子">
        {order.map((_, k) => (
          <button
            key={k}
            type="button"
            className={`ord-slot ${slotItem[k] !== undefined ? 'full' : ''} ${overDrop === `slot${k}` ? 'over' : ''} ${selected !== null && slotItem[k] === undefined ? 'ready' : ''} ${glowSlot === k ? 'demo' : ''}`}
            data-testid="order-slot"
            data-drop={`slot${k}`}
            data-slot={k}
            data-filled={slotItem[k] !== undefined ? 'true' : undefined}
            aria-label={`第 ${k + 1} 格`}
            disabled={solved || demo}
            onClick={() => selected !== null && place(selected, k)}
          >
            {slotItem[k] !== undefined ? pic(q.items[slotItem[k] as number].scale ?? 1) : <b className="ord-slot-n">{k + 1}</b>}
          </button>
        ))}
      </div>
      <div className="ord-tray" aria-label="要排的東西">
        {q.items.map((it, i) =>
          placedItems.has(i) ? (
            <span key={i} className="ord-gap" aria-hidden />
          ) : (
            <button
              key={i}
              type="button"
              className={`ord-item ${selected === i ? 'selected' : ''} ${bounce === i ? 'bounce' : ''} ${glowItem === i ? 'demo' : ''} ${draggingId === String(i) ? 'dragging' : ''}`}
              data-testid="order-item"
              data-item={i}
              aria-label={`${o.name}（拖到格子，或點一下再點格子）`}
              aria-pressed={selected === i}
              disabled={solved || demo}
              {...bind(String(i))}
            >
              {pic(it.scale ?? 1)}
            </button>
          ),
        )}
      </div>
      {ghostNode}
    </div>
  )
}
