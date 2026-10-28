import type { CSSProperties, ReactNode } from 'react'
import { DECOR_EMOJI, OBJ_EMOJI } from '../../../art/items'
import { getObject } from '../../../learning/objects'
import { anchorBoxes, isPeek, mustProp, REL_WORD, SCENE_H, SCENE_W, sceneBoxes, subjectBox, zoneBox, type Box } from '../../../learning/space'
import type { PlaceZone, SceneSpec } from '../../../learning/types'
import { Icon } from '../../components/Icon'
import './adventure-v6.css'
import './adventure-v7.css'

const pctX = (b: Box) => `${(b.x / SCENE_W) * 100}%`
const pctY = (b: Box) => `${(b.y / SCENE_H) * 100}%`
const boxStyle = (b: Box, z?: number): CSSProperties => ({
  left: pctX(b),
  top: pctY(b),
  width: `${(b.w / SCENE_W) * 100}%`,
  height: `${(b.h / SCENE_H) * 100}%`,
  ...(z !== undefined ? { zIndex: z } : {}),
})

export const propEmoji = (id: string): string | undefined => DECOR_EMOJI[id.replace('decor-', '')]
const subjectName = (id: string) => getObject(id)?.name ?? id

/** 一張小圖：家具或東西，缺圖時用 emoji */
function Pic({ id, alt }: { id: string; alt: string }) {
  return <Icon name={id} emoji={OBJ_EMOJI[id] ?? propEmoji(id)} alt={alt} className="sc-img" />
}

interface SceneProps {
  /** 一個或兩個家具（decor-*） */
  anchors: string[]
  /** 東西的圖與位置；沒給就不畫 */
  subject?: { id: string; box: Box; peek: boolean } | null
  /** 放到位置時，可以放的位置 */
  zones?: { zone: PlaceZone; box: Box }[]
  /** 每個位置怎麼畫（按鈕、亮起…）；沒給就不畫位置 */
  renderZone?: (zone: PlaceZone, box: Box) => ReactNode
  className?: string
  /** 家具上的字幕（無障礙用） */
  label?: string
  testId?: string
}

/** 空間方位的小場景：4:3 的畫布，家具在中間，東西放在指定的位置。座標見 learning/space.ts */
export function SpaceScene({ anchors, subject, zones, renderZone, className = '', label, testId }: SceneProps) {
  const boxes = anchorBoxes(anchors)
  return (
    <div className={`sc ${className}`} role="img" aria-label={label} data-testid={testId}>
      <i className="sc-floor" aria-hidden />
      {anchors.map((a, i) => (
        <div key={a} className={`sc-prop ${a === 'decor-table' || a === 'decor-crate' ? 'q7-float' : ''}`} style={boxStyle(boxes[i], 2)}>
          <Pic id={a} alt={mustProp(a).name} />
        </div>
      ))}
      {subject && (
        <div className="sc-subject" style={boxStyle(subject.box, subject.peek ? 1 : 3)} data-testid="sc-subject">
          <Pic id={subject.id} alt={subjectName(subject.id)} />
        </div>
      )}
      {renderZone && zones?.map(({ zone, box }) => renderZone(zone, box))}
    </div>
  )
}

/** where 題的選項卡片：一個東西相對於家具的位置 */
export function SceneCard({ spec, className = '' }: { spec: SceneSpec; className?: string }) {
  const { subject, prop } = sceneBoxes(spec)
  return (
    <SpaceScene
      anchors={[spec.anchor]}
      subject={{ id: spec.subject, box: subject, peek: isPeek(spec.rel, prop) }}
      className={className}
      label={`${subjectName(spec.subject)}在${prop.name}的${REL_WORD[spec.rel]}`}
    />
  )
}

/** place 題：zone 的方塊（含家具座標） */
export function zonesOf(anchors: string[], zones: PlaceZone[]): { zone: PlaceZone; box: Box }[] {
  const boxes = anchorBoxes(anchors)
  const props = anchors.map(mustProp)
  return zones.map((zone) => ({ zone, box: zoneBox(zone, boxes, props) }))
}

/** 東西放到某個位置之後的樣子 */
export function placedSubject(anchors: string[], subjectId: string, zone: PlaceZone): { id: string; box: Box; peek: boolean } {
  const boxes = anchorBoxes(anchors)
  const prop = mustProp(anchors[zone.of ?? 0])
  return { id: subjectId, box: subjectBox(zone.rel, boxes, zone.of ?? 0, prop), peek: isPeek(zone.rel, prop) }
}
