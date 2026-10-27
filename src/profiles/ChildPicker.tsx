import { useEffect, useState } from 'react'
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
          return (
            <button key={c.id} className="picker-card" data-testid="child-card" data-child-id={c.id} onClick={() => onPick(c)}>
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
