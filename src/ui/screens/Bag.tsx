import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { artName, FOOD_EMOJI } from '../../art/items'
import { Icon } from '../components/Icon'
import { ScreenHeader } from '../components/Header'
import type { Screen } from '../App'

/** 背包：唯讀清單。餵食與佈置都回首頁房間裡做。 */
export function BagScreen({ onBack, go }: { onBack: () => void; go: (s: Screen) => void }) {
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])
  const shopItems = useLiveQuery(() => db.shopItems.toArray(), [], [])
  const placements = useLiveQuery(() => db.placements.toArray(), [], [])

  const owned = inventory
    .filter((v) => v.qty > 0)
    .map((v) => ({ inv: v, item: shopItems.find((i) => i.id === v.itemId) }))
    .filter((x) => x.item && x.item.kind !== 'coloring')

  return (
    <main className="screen theme-bubblegum">
      <ScreenHeader title="背包" onBack={onBack} />
      {owned.length === 0 && <p className="empty">背包空空的，去商店逛逛吧！</p>}
      <ul className="shop-grid">
        {owned.map(({ inv, item }) => {
          const it = item!
          const placed = placements.some((p) => p.itemId === it.id)
          return (
            <li key={it.id} className="card shop-item art-card">
              <div className="shop-art">
                <Icon name={artName(it)} emoji={FOOD_EMOJI[it.asset]} alt={it.name} className="shop-sprite" />
              </div>
              <div className="shop-name">{it.name}</div>
              {it.kind === 'food' ? (
                <>
                  <div className="shop-price">x{inv.qty}</div>
                  <button className="btn primary" onClick={() => go({ name: 'home' })}>去餵食</button>
                </>
              ) : (
                <>
                  <div className="shop-price">{placed ? '已擺放' : '還沒擺放'}</div>
                  <button className={`btn ${placed ? '' : 'primary'}`} onClick={() => go({ name: 'home', edit: true })}>
                    去擺放
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </main>
  )
}
