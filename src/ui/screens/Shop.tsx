import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { COLORING_PAGE_IDS } from '../../domain/constants'
import { canBuy } from '../../domain/shop'
import { artName, FOOD_EMOJI } from '../../art/items'
import type { ShopKind } from '../../domain/types'
import { ColoringSvg } from '../components/ColoringThumb'
import { Icon } from '../components/Icon'
import { ScreenHeader } from '../components/Header'
import { useBalance, useToast } from '../hooks'

/** 家具改由工坊用材料製作，商店只賣飼料與著色頁 */
const TABS: { kind: ShopKind; label: string }[] = [
  { kind: 'food', label: '飼料' },
  { kind: 'coloring', label: '著色頁' },
]

export function ShopScreen({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const [tab, setTab] = useState<ShopKind>('food')
  const balance = useBalance()
  const items = useLiveQuery(async () => {
    const list = await db.shopItems.where('kind').equals(tab).toArray()
    const rank = (id: string) => COLORING_PAGE_IDS.findIndex((p) => `coloring-${p}` === id)
    return list.sort((a, b) => a.price - b.price || rank(a.id) - rank(b.id))
  }, [tab], [])
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])

  const buy = async (id: string, name: string) => {
    const r = await repo.buyItem(id)
    if (r.ok) toast(`買到${name}了！`, 'ok')
    else toast(r.error, 'warn')
  }

  return (
    <main className="screen theme-peach">
      <ScreenHeader title="商店" onBack={onBack} />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.kind} role="tab" aria-selected={tab === t.kind} className={`tab ${tab === t.kind ? 'on' : ''}`} onClick={() => setTab(t.kind)}>
            {t.label}
          </button>
        ))}
      </div>
      <ul className="shop-grid">
        {items.map((item) => {
          const owned = inventory.find((v) => v.itemId === item.id)?.qty ?? 0
          const check = canBuy(balance, owned, item)
          return (
            <li key={item.id} className="card shop-item art-card">
              <div className="shop-art">
                {item.kind === 'coloring' ? (
                  <ColoringSvg pageId={item.asset} className="shop-thumb" />
                ) : (
                  <Icon name={artName(item)} emoji={FOOD_EMOJI[item.asset]} alt={item.name} className="shop-sprite" />
                )}
              </div>
              <div className="shop-name">{item.name}</div>
              <div className="shop-price">
                <Icon name="ui-star" emoji="⭐" size={20} /> {item.price}
                {item.kind === 'food' && owned > 0 ? <small>背包 {owned}</small> : null}
              </div>
              <button className="btn primary" disabled={!check.ok} onClick={() => buy(item.id, item.name)}>
                {check.ok ? '買' : check.reason === 'owned' ? '已擁有' : `還差 ${check.shortBy} 點`}
              </button>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
