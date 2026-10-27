import { useEffect, useRef, useState } from 'react'
import { OBJ_EMOJI } from '../../../art/items'
import { pickLine } from '../../../learning/lines'
import { mustObject } from '../../../learning/objects'
import { REL_WORD } from '../../../learning/space'
import { say } from '../../../learning/speech'
import type { Question } from '../../../learning/types'
import { Icon } from '../../components/Icon'
import { useDragKit } from './DragKit'
import type { HintStage } from './QuestionView'
import { placedSubject, SpaceScene, zonesOf } from './SpaceScene'
import './adventure-v6.css'

interface Props {
  q: Question
  hintStage: HintStage
  solved: boolean
  voiceOn: boolean
  /** 放錯一次 */
  onWrong: () => void
  /** 放對了 */
  onSolved: () => void
  /** 教學：阿悟示範把東西放到對的位置，示範完呼叫 onDemoEnd 並清空 */
  demo?: boolean
  onDemoEnd?: () => void
}

/**
 * 放到某個位置：把東西拖到發亮的圈圈（家具的上面、下面、裡面、左右、中間）。
 * 點選替代操作：點一下東西（亮起）→ 再點要放的位置。
 * 放對：東西留在那個位置；放錯：彈回去，由關卡畫面接手提示階梯；第二次錯起，正確的位置發光。
 * 判斷對錯在這裡（params.target 是正確位置的 id）。
 */
export function PlaceView({ q, hintStage, solved, voiceOn, onWrong, onSolved, demo = false, onDemoEnd }: Props) {
  const p = q.params
  const anchors = p?.anchors ?? []
  const subject = p?.subject ?? 'obj-chick'
  const zones = p?.zones ?? []
  const target = p?.target
  const o = mustObject(subject)
  const [placed, setPlaced] = useState<string | null>(null)
  const [selected, setSelected] = useState(false)
  const [bounce, setBounce] = useState(false)
  const bounceTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(bounceTimer.current), [])

  const place = (zoneId: string) => {
    if (solved || demo || placed !== null) return
    setSelected(false)
    if (zoneId === target) {
      setPlaced(zoneId)
      const l = pickLine('place.done')
      say(l.key, l.text, { enabled: voiceOn })
      onSolved()
      return
    }
    setBounce(true)
    window.clearTimeout(bounceTimer.current)
    bounceTimer.current = window.setTimeout(() => setBounce(false), 600)
    const l = pickLine('place.wrong')
    say(l.key, l.text, { enabled: voiceOn })
    onWrong()
  }

  const pic = <Icon name={subject} emoji={OBJ_EMOJI[subject]} alt={o.name} />
  const { bind, ghostNode, draggingId, overDrop } = useDragKit({
    disabled: solved || demo || placed !== null,
    onTap: () => setSelected((s) => !s),
    onDrop: (_id, dropId) => {
      if (dropId === null || !dropId.startsWith('zone')) return // 沒放在位置上：原地彈回（不算錯）
      place(dropId.slice(4))
    },
    renderGhost: () => <span className="plc-ghost">{pic}</span>,
  })

  // 教學：阿悟示範把東西放到對的位置，再清空換孩子試
  const [demoPlaced, setDemoPlaced] = useState(false)
  useEffect(() => {
    if (!demo) return
    const a = window.setTimeout(() => setDemoPlaced(true), 1100)
    const b = window.setTimeout(() => {
      setDemoPlaced(false)
      onDemoEnd?.()
    }, 3000)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
    // 只在進入教學時跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo])

  const targetZone = zones.find((z) => z.id === target)
  const showAt = placed !== null ? zones.find((z) => z.id === placed) : demoPlaced ? targetZone : undefined
  const glow = (demo || (hintStage >= 2 && !solved)) && placed === null ? target : undefined

  return (
    <div className="plc" data-testid="question" data-question-id={q.id} data-hint-stage={hintStage} data-type="place" data-rel={p?.rel}>
      <SpaceScene
        anchors={anchors}
        subject={showAt ? placedSubject(anchors, subject, showAt) : null}
        zones={zonesOf(anchors, zones)}
        className="plc-scene"
        label="場景：把東西放到指定的位置"
        renderZone={(z, box) => (
          <button
            key={z.id}
            type="button"
            className={`sc-zone rel-${z.rel} ${overDrop === `zone${z.id}` ? 'over' : ''} ${selected ? 'ready' : ''} ${glow === z.id ? 'demo' : ''}`}
            style={{ left: `${box.x}%`, top: `${(box.y / 75) * 100}%`, width: `${box.w}%`, height: `${(box.h / 75) * 100}%` }}
            data-testid="place-zone"
            data-drop={`zone${z.id}`}
            data-zone={z.id}
            data-rel={z.rel}
            data-target={z.id === target ? 'true' : undefined}
            aria-label={`${REL_WORD[z.rel]}`}
            disabled={solved || demo || placed !== null}
            onClick={() => selected && place(z.id)}
          />
        )}
      />
      <div className="plc-tray" aria-label="要放的東西">
        {placed === null && !demoPlaced ? (
          <button
            type="button"
            className={`plc-item ${selected ? 'selected' : ''} ${bounce ? 'bounce' : ''} ${draggingId !== null ? 'dragging' : ''} ${demo ? 'demo' : ''}`}
            data-testid="place-item"
            aria-label={`${o.name}（拖到位置，或點一下再點位置）`}
            aria-pressed={selected}
            disabled={solved || demo}
            {...bind('item')}
          >
            {pic}
          </button>
        ) : (
          <span className="plc-gap" aria-hidden />
        )}
      </div>
      {ghostNode}
    </div>
  )
}
