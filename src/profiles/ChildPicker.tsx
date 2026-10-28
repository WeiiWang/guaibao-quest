import { useEffect, useRef, useState } from 'react'
import { childColorOf } from '../domain/home7'
import { sayText } from '../learning/speech'
import type { Pet } from '../domain/types'
import { PetSprite } from '../ui/components/PetSprite'
import { moodAt } from '../domain/pet'
import { now as clockNow } from '../domain/clock'
import { profiles } from './manager'
import type { ChildProfile } from './registry'
import './profiles.css'

/** 選孩子畫面：每個孩子一張大卡片，頭像是他的阿悟現在的樣子，點一下進去 */
export function ChildPicker({ list, onPick }: { list: ChildProfile[]; onPick: (c: ChildProfile) => void }) {
  const [pets, setPets] = useState<Record<string, Pet | undefined>>({})
  const [picking, setPicking] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // v7：點下去先唸孩子的名字，再進入（不識字的孩子聽得出是自己）
  const pick = (c: ChildProfile) => {
    if (picking) return
    setPicking(c.id)
    sayText(c.name)
    timer.current = window.setTimeout(() => onPick(c), 800)
  }

  useEffect(() => {
    let off = false
    void Promise.all(
      list.map(async (c) => {
        try {
          return [c.id, await profiles.deps.openDb(c.dbName).pets.get('pet')] as const
        } catch {
          return [c.id, undefined] as const
        }
      }),
    ).then((rows) => !off && setPets(Object.fromEntries(rows)))
    return () => {
      off = true
    }
  }, [list])

  return (
    <main className="picker theme-cream" data-testid="child-picker">
      <h1 className="picker-title">誰要來玩？</h1>
      <div className="picker-grid">
        {list.map((c) => {
          const pet = pets[c.id]
          const col = childColorOf(c.order)
          return (
            <button
              key={c.id}
              className={`picker-card ${picking === c.id ? 'picked' : ''}`}
              data-testid="child-card"
              data-child-id={c.id}
              style={{ ['--pk-bg' as string]: col.bg, ['--pk-deep' as string]: col.deep, ['--pk-soft' as string]: col.soft }}
              onClick={() => pick(c)}
            >
              <span className="picker-avatar" aria-hidden data-testid="child-avatar">{c.avatar}</span>
              <span className="picker-face" aria-hidden>
                {pet ? (
                  <PetSprite pet={pet} mood={moodAt(pet, clockNow())} className="picker-pet" />
                ) : (
                  <span className="picker-emoji">{c.avatar}</span>
                )}
              </span>
              <span className="picker-name">{c.name}</span>
            </button>
          )
        })}
      </div>
    </main>
  )
}
