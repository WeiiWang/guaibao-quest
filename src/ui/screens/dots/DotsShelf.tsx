import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import {
  DOTS_IDS,
  DOTS_LEVELS,
  DOTS_NAMES,
  DOTS_PRICE,
  DOTS_LINES,
  defaultDotsLevel,
  dotsItemId,
  dotsLevel,
  dotsPageId,
  dotsPoints,
  isDotsFree,
  type DotsLevel,
} from '../../../art/dots/dots'
import { sayText } from '../../../learning/speech'
import { useBalance, useToast } from '../../hooks'
import { useLearnerProfile, useLearningSettings } from '../../learningHooks'
import { Icon } from '../../components/Icon'
import { DotsThumb } from './DotsThumb'
import '../dots.css'

const PRICE_LINE = DOTS_LINES['ui.dots.price'] as string
const OPENED_LINE = DOTS_LINES['ui.dots.opened'] as string

/** 著色本列表上的「連連看」一排：難度晶片 + 一排卡片（依孩子年齡預設難度） */
export function DotsShelf({ onOpen }: { onOpen: (pageId: string) => void }) {
  const profile = useLearnerProfile()
  const { voiceOn } = useLearningSettings()
  const toast = useToast()
  const balance = useBalance()
  const rowsQ = useLiveQuery(() => db.coloring.where('pageId').startsWith('dots:').toArray(), [])
  const inventoryQ = useLiveQuery(() => db.inventory.toArray(), [])
  const ready = rowsQ !== undefined && inventoryQ !== undefined // 還沒讀到存檔就先不顯示鎖頭與進度（不會先閃一下鎖著）
  const rows = rowsQ ?? []
  const inventory = inventoryQ ?? []
  const [picked, setPicked] = useState<DotsLevel | null>(null)
  const [guide, setGuide] = useState<string | null>(null) // 要換的 pageId
  const [shaking, setShaking] = useState<string | null>(null)
  const level: DotsLevel = picked ?? defaultDotsLevel(profile.ageBand)
  const def = dotsLevel(level)!
  const owned = new Set(inventory.filter((v) => v.qty > 0).map((v) => v.itemId))

  const tapLocked = (pageId: string) => {
    setShaking(pageId)
    window.setTimeout(() => setShaking((v) => (v === pageId ? null : v)), 520)
    setGuide(pageId)
    sayText(PRICE_LINE, { enabled: voiceOn })
  }
  const unlock = async (pageId: string) => {
    const r = await repo.unlockDots(pageId)
    if (!r.ok) {
      toast(`星星還不夠喔，${r.error}`, 'warn')
      return
    }
    setGuide(null)
    sayText(OPENED_LINE, { enabled: voiceOn })
    onOpen(pageId)
  }

  const g = guide ? { id: guide, name: guide.split(':')[1] } : null

  return (
    <section className="dt-shelf" data-testid="dots-shelf" data-level={level} aria-label="連連看">
      <div className="dt-head">
        <h2 className="pb-tier-title dt-title">連連看</h2>
        <div className="dt-levels" role="group" aria-label="難度">
          {DOTS_LEVELS.map((l) => (
            <button key={l.id} className={`dt-lv ${level === l.id ? 'on' : ''}`} aria-pressed={level === l.id} onClick={() => setPicked(l.id)} data-testid={`dots-level-${l.id}`}>
              <b>{l.label}</b>
              <span>{l.range}</span>
            </button>
          ))}
        </div>
      </div>
      <ul className="dt-strip" data-testid="dots-strip">
        {DOTS_IDS.map((name) => {
          const pid = dotsPageId(name, level)
          const row = rows.find((r) => r.pageId === pid)
          const n = dotsPoints(name, level).length
          const at = Math.min(n, row?.dotsAt ?? 0)
          const done = !!row?.dotsDone
          const locked = ready && !isDotsFree(name) && !owned.has(dotsItemId(pid))
          if (!ready) {
            return (
              <li key={pid} className="dt-card card dt-skel" aria-hidden>
                <DotsThumb name={name} level={level} at={0} done={false} />
                <div className="dt-name">{DOTS_NAMES[name]}</div>
                <div className="dt-sub" />
              </li>
            )
          }
          return (
            <li key={pid} className={`dt-card card ${locked ? 'locked' : ''} ${shaking === pid ? 'ux-shake' : ''}`} data-testid={locked ? `dots-locked-${name}` : `dots-${name}`} data-state={done ? 'done' : at > 0 ? 'going' : 'new'}>
              <button className="dt-card-btn" onClick={() => (locked ? tapLocked(pid) : onOpen(pid))} aria-label={locked ? `${DOTS_NAMES[name]}還沒有，要用${DOTS_PRICE}顆星星換` : `連${DOTS_NAMES[name]}，${def.label}`}>
                <DotsThumb name={name} level={level} at={at} done={done} className={locked ? 'dt-dim' : ''} />
                {locked && (
                  <span className="dt-lock" aria-hidden>
                    <Icon name="ui-lock" emoji="🔒" size={30} />
                  </span>
                )}
              </button>
              <div className="dt-name">{DOTS_NAMES[name]}</div>
              {locked ? (
                <div className="dt-sub dt-price">
                  <Icon name="ui-star" emoji="⭐" size={20} /> {DOTS_PRICE}
                </div>
              ) : (
                <div className="dt-sub" data-testid="dots-sub">
                  {done ? '連好了 ✓' : at > 0 ? `連到 ${at}/${n}` : `${def.range}`}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {g && (
        <div className="modal-back" role="presentation" onClick={() => setGuide(null)}>
          <div className="modal guide-card dt-guide" role="dialog" aria-modal="true" aria-label="用星星換連連看" data-testid="dots-guide" onClick={(e) => e.stopPropagation()}>
            <div className="dt-guide-thumb" aria-hidden>
              <DotsThumb name={g.name} level={level} at={0} done={false} />
            </div>
            <h2>{DOTS_NAMES[g.name]}</h2>
            <p className="guide-price">
              <Icon name="ui-star" emoji="⭐" size={40} /> <b>{DOTS_PRICE}</b>
            </p>
            <p className="lead">{balance >= DOTS_PRICE ? '用星星換，就能連囉！' : `你有 ${balance} 顆星星，再多存一些就能換囉！`}</p>
            <button className="btn primary dt-big" onClick={() => void unlock(g.id)} data-testid="dots-unlock">
              <Icon name="ui-star" emoji="⭐" size={32} /> 用 {DOTS_PRICE} 顆星星換
            </button>
            <button className="btn dt-big" onClick={() => setGuide(null)} data-testid="dots-guide-close">
              再看看
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
