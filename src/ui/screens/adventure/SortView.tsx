import { useEffect, useRef, useState } from 'react'
import { mustObject } from '../../../learning/objects'
import { pickLine } from '../../../learning/lines'
import { say } from '../../../learning/speech'
import type { Question } from '../../../learning/types'
import { OBJ_EMOJI } from '../../../art/items'
import { Icon } from '../../components/Icon'
import { useDragKit } from './DragKit'
import type { HintStage } from './QuestionView'
import './adventure-v4.css'

interface Props {
  q: Question
  hintStage: HintStage
  solved: boolean
  voiceOn: boolean
  /** 放錯一次 */
  onWrong: () => void
  /** 全部放對 */
  onSolved: () => void
  /** 教學：阿悟示範把第一個東西放進籃子，示範完呼叫 onDemoEnd 並清空 */
  demo?: boolean
  onDemoEnd?: () => void
}

const ObjIcon = ({ id }: { id: string }) => <Icon name={id} emoji={OBJ_EMOJI[id]} alt={mustObject(id).name} />

/**
 * 拖曳歸類：把東西拖進對的籃子（兩到三個籃子）。
 * 點選替代操作：點一個東西（亮起）→ 再點要放的籃子。
 * 放對：東西留在籃子裡；放錯：彈回去，由關卡畫面接手提示階梯；第二次錯起，下一個該放的東西與它的籃子會發光。
 * 全部放對就答對。判斷對錯在這裡（params.targets 是每個東西該放哪個籃子）。
 */
export function SortView({ q, hintStage, solved, voiceOn, onWrong, onSolved, demo = false, onDemoEnd }: Props) {
  const bins = q.params?.bins ?? []
  const targets = q.params?.targets ?? []
  // placed[i] = 第 i 個東西放進了哪個籃子（沒放 = undefined）
  const [placed, setPlaced] = useState<(string | undefined)[]>(() => q.items.map(() => undefined))
  const [selected, setSelected] = useState<number | null>(null)
  const [bounce, setBounce] = useState<number | null>(null)
  const bounceTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(bounceTimer.current), [])

  const place = (i: number, binId: string) => {
    if (solved || demo || placed[i] !== undefined) return
    setSelected(null)
    if (targets[i] === binId) {
      const next = placed.map((p, k) => (k === i ? binId : p))
      setPlaced(next)
      if (next.every((p) => p !== undefined)) {
        const l = pickLine('bins.done')
        say(l.key, l.text, { enabled: voiceOn })
        onSolved()
      }
      return
    }
    // 放錯：彈回去
    setBounce(i)
    window.clearTimeout(bounceTimer.current)
    bounceTimer.current = window.setTimeout(() => setBounce(null), 600)
    const l = pickLine('bins.wrong')
    say(l.key, l.text, { enabled: voiceOn })
    onWrong()
  }

  const { bind, ghostNode, draggingId, overDrop } = useDragKit({
    disabled: solved || demo,
    onTap: (id) => {
      const i = Number(id)
      if (placed[i] !== undefined || solved) return
      setSelected((s) => (s === i ? null : i))
    },
    onDrop: (id, dropId) => {
      if (dropId === null) return // 沒放在籃子上：原地彈回（不算錯）
      place(Number(id), dropId)
    },
    renderGhost: (id) => <ObjIcon id={q.items[Number(id)].obj as string} />,
  })

  // 教學：阿悟示範把第一個放進它的籃子，再清空換孩子試
  useEffect(() => {
    if (!demo) return
    const a = window.setTimeout(() => setPlaced((p) => p.map((x, k) => (k === 0 ? targets[0] : x))), 1100)
    const b = window.setTimeout(() => {
      setPlaced(q.items.map(() => undefined))
      onDemoEnd?.()
    }, 3000)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
    // 只在進入教學時跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo])

  // 第二次錯起：下一個該放的東西和它的籃子發光（教學時第一個東西和它的籃子也發光）
  const nextIdx = placed.findIndex((p) => p === undefined)
  const glow = demo ? 0 : hintStage >= 2 && !solved && nextIdx >= 0 ? nextIdx : -1

  return (
    <div className="sort" data-testid="question" data-question-id={q.id} data-hint-stage={hintStage} data-type="bins">
      <div className="sort-tray" aria-label="要分類的東西">
        {q.items.map((it, i) =>
          placed[i] !== undefined ? (
            <span key={i} className="sort-gap" aria-hidden />
          ) : (
            <button
              key={i}
              type="button"
              className={`sort-item ${selected === i ? 'selected' : ''} ${bounce === i ? 'bounce' : ''} ${glow === i ? 'demo' : ''} ${draggingId === String(i) ? 'dragging' : ''}`}
              data-testid="sort-item"
              data-item={i}
              aria-label={`${mustObject(it.obj as string).name}（拖到籃子，或點一下再點籃子）`}
              aria-pressed={selected === i}
              disabled={solved || demo}
              {...bind(String(i))}
            >
              <ObjIcon id={it.obj as string} />
            </button>
          ),
        )}
      </div>
      <div className={`sort-bins n${bins.length}`}>
        {bins.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`sort-bin ${overDrop === b.id ? 'over' : ''} ${selected !== null ? 'ready' : ''} ${glow >= 0 && targets[glow] === b.id ? 'demo' : ''}`}
            data-testid="sort-bin"
            data-drop={b.id}
            data-bin={b.id}
            aria-label={`${b.label}的籃子`}
            disabled={solved || demo}
            onClick={() => selected !== null && place(selected, b.id)}
          >
            <span className="sort-bin-head">
              {b.obj && (
                <span className="sort-bin-icon">
                  <ObjIcon id={b.obj} />
                </span>
              )}
              <b>{b.label}</b>
            </span>
            <span className="sort-bin-items" data-count={placed.filter((p) => p === b.id).length}>
              {q.items.map((it, i) =>
                placed[i] === b.id ? (
                  <span key={i} className="sort-placed" data-testid="sort-placed">
                    <ObjIcon id={it.obj as string} />
                  </span>
                ) : null,
              )}
            </span>
          </button>
        ))}
      </div>
      {ghostNode}
    </div>
  )
}
