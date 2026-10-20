import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { canCraft } from '../../learning/materials'
import { SHOP_CATALOG } from '../../learning/materials'
import { MATERIAL_IDS, MATERIAL_NAMES } from '../../learning/types'
import { MAT_EMOJI } from '../../art/items'
import { Art } from '../components/Art'
import { Icon } from '../components/Icon'
import { ScreenHeader } from '../components/Header'
import { MaterialsChip } from '../components/MaterialsChip'
import { useToast } from '../hooks'
import { useMaterials } from '../learningHooks'
import type { Screen } from '../App'
import './workshop.css'

const DECOR = SHOP_CATALOG.filter((i) => i.kind === 'decor' && i.cost)

/** 工坊：用冒險拿到的材料做家具，做好後到首頁房間佈置 */
export function WorkshopScreen({ onBack, go }: { onBack: () => void; go: (s: Screen["name"] | Screen) => void }) {
  const toast = useToast()
  const bal = useMaterials()
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])
  const placements = useLiveQuery(() => db.placements.toArray(), [], [])

  const craft = async (id: string, name: string) => {
    const r = await repo.craftFurniture(id)
    if (r.ok) toast(`做好了「${name}」！到首頁佈置吧`, 'ok')
    else toast(r.error, 'warn')
  }

  return (
    <main className="screen workshop theme-butter" data-testid="workshop">
      <ScreenHeader title="工坊" onBack={onBack} right={<MaterialsChip />} />
      <p className="ws-lead">用冒險拿到的木材、石頭和花朵，做出可愛的家具。</p>
      <ul className="ws-grid">
        {DECOR.map((item) => {
          const cost = item.cost!
          const qty = inventory.find((v) => v.itemId === item.id)?.qty ?? 0
          const check = canCraft(bal, qty, item)
          const placed = placements.some((p) => p.itemId === item.id)
          return (
            <li key={item.id} className={`ws-card ${qty > 0 ? 'owned' : ''}`} data-testid={`craft-${item.id}`}>
              <div className="ws-art">
                <Art name={item.id} alt={item.name} size="100%" />
              </div>
              <div className="ws-name">{item.name}</div>
              <div className="ws-cost" aria-label="需要的材料">
                {MATERIAL_IDS.filter((m) => cost[m] > 0).map((m) => (
                  <span key={m} className={`ws-cost-item ${qty === 0 && bal[m] < cost[m] ? 'short' : ''}`}>
                    <Icon name={`mat-${m}`} emoji={MAT_EMOJI[m]} alt={MATERIAL_NAMES[m]} size={30} />
                    <b>{cost[m]}</b>
                  </span>
                ))}
              </div>
              {qty > 0 ? (
                <button className={`ws-btn ${placed ? '' : 'primary'}`} onClick={() => go({ name: 'home', edit: true })}>
                  {placed ? '已擺放，去調整' : '去佈置'}
                </button>
              ) : (
                <button className="ws-btn primary" disabled={!check.ok} onClick={() => craft(item.id, item.name)} data-testid="craft-btn">
                  {check.ok
                    ? '製作'
                    : check.reason === 'insufficient'
                      ? `還差 ${MATERIAL_IDS.filter((m) => check.short[m]).map((m) => `${MATERIAL_NAMES[m]}${check.short[m]}`).join(' ')}`
                      : '不能製作'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="ws-foot">
        還沒有材料？<button className="ws-link" onClick={() => go('map')}>去冒險地圖</button>
      </p>
    </main>
  )
}
