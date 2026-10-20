import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { canCraft, craftableOf } from '../../learning/materials'
import { THEME_DEFS, themesOf, ownsTheme, sortThemesByCost } from '../../domain/theme'
import { MATERIAL_IDS, MATERIAL_NAMES } from '../../learning/types'
import type { MaterialCost } from '../../learning/types'
import { DECOR_EMOJI, MAT_EMOJI } from '../../art/items'
import type { ShopItem, ThemeSlot } from '../../domain/types'
import { Icon } from '../components/Icon'
import { ScreenHeader } from '../components/Header'
import { MaterialsChip } from '../components/MaterialsChip'
import { useToast } from '../hooks'
import { useMaterials } from '../learningHooks'
import { useRoomTheme } from '../roomTheme'
import type { Screen } from '../App'
import './workshop.css'

type Tab = 'decor' | ThemeSlot
const TABS: { id: Tab; label: string }[] = [
  { id: 'decor', label: '家具' },
  { id: 'wall', label: '壁紙' },
  { id: 'floor', label: '地板' },
]

const shortText = (short: Partial<MaterialCost>) =>
  MATERIAL_IDS.filter((m) => short[m]).map((m) => `${MATERIAL_NAMES[m]}${short[m]}`).join(' ')

function CostRow({ cost, bal, owned }: { cost: MaterialCost; bal: Record<string, number>; owned: boolean }) {
  return (
    <div className="ws-cost" aria-label="需要的材料">
      {MATERIAL_IDS.filter((m) => cost[m] > 0).map((m) => (
        <span key={m} className={`ws-cost-item ${!owned && bal[m] < cost[m] ? 'short' : ''}`}>
          <Icon name={`mat-${m}`} emoji={MAT_EMOJI[m]} alt={MATERIAL_NAMES[m]} size={30} />
          <b>{cost[m]}</b>
        </span>
      ))}
    </div>
  )
}

/** 壁紙 / 地板的小色卡（直接重用房間背景的 CSS，不用圖） */
function Swatch({ id, slot }: { id: string; slot: ThemeSlot }) {
  return (
    <div className={`room-backdrop rb-swatch tod-day ${id}`} data-swatch={id}>
      <div className={slot === 'wall' ? 'rb-wall' : 'rb-floor'} />
    </div>
  )
}

/** 工坊：用冒險拿到的材料做家具、壁紙、地板。家具到首頁佈置；壁紙地板在這裡直接套用。 */
export function WorkshopScreen({ onBack, go }: { onBack: () => void; go: (s: Screen["name"] | Screen) => void }) {
  const toast = useToast()
  const bal = useMaterials()
  const [tab, setTab] = useState<Tab>('decor')
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])
  const placements = useLiveQuery(() => db.placements.toArray(), [], [])
  const theme = useRoomTheme()

  const craft = async (id: string, name: string, isTheme: boolean) => {
    const r = await repo.craftFurniture(id)
    if (r.ok) toast(isTheme ? `做好了「${name}」！按「套用」就能換上` : `做好了「${name}」！到首頁佈置吧`, 'ok')
    else toast(r.error, 'warn')
  }
  const apply = async (id: string, name: string) => {
    const r = await repo.applyTheme(id)
    if (r.ok) toast(`房間換成「${name}」了！`, 'ok')
    else toast(r.error, 'warn')
  }

  const qtyOf = (id: string) => inventory.find((v) => v.itemId === id)?.qty ?? 0

  const decorCard = (item: ShopItem) => {
    const cost = item.cost!
    const qty = qtyOf(item.id)
    const check = canCraft(bal, qty, item)
    const placed = placements.some((p) => p.itemId === item.id)
    return (
      <li key={item.id} className={`ws-card ${qty > 0 ? 'owned' : ''}`} data-testid={`craft-${item.id}`}>
        <div className="ws-art">
          <Icon name={item.id} emoji={DECOR_EMOJI[item.asset]} alt={item.name} size="100%" />
        </div>
        <div className="ws-name">{item.name}</div>
        <CostRow cost={cost} bal={bal} owned={qty > 0} />
        {qty > 0 ? (
          <button className={`ws-btn ${placed ? '' : 'primary'}`} onClick={() => go({ name: 'home', edit: true })}>
            {placed ? '已擺放，去調整' : '去佈置'}
          </button>
        ) : (
          <button className="ws-btn primary" disabled={!check.ok} onClick={() => craft(item.id, item.name, false)} data-testid="craft-btn">
            {check.ok ? '製作' : check.reason === 'insufficient' ? `還差 ${shortText(check.short)}` : '不能製作'}
          </button>
        )}
      </li>
    )
  }

  const themeCard = (slot: ThemeSlot, id: string) => {
    const def = THEME_DEFS.find((t) => t.id === id)!
    const item = def.isDefault ? undefined : craftableOf(slot).find((i) => i.id === id)
    const owned = ownsTheme(id, inventory)
    const active = theme[slot] === id
    const check = item ? canCraft(bal, qtyOf(id), item) : null
    return (
      <li key={id} className={`ws-card ${owned ? 'owned' : ''} ${active ? 'active' : ''}`} data-testid={`craft-${id}`}>
        <div className="ws-art ws-art-theme">
          <Swatch id={id} slot={slot} />
        </div>
        <div className="ws-name">{def.name}</div>
        {def.cost ? <CostRow cost={def.cost} bal={bal} owned={owned} /> : <div className="ws-cost"><span className="ws-free">一開始就有</span></div>}
        {owned ? (
          <button className={`ws-btn ${active ? '' : 'primary'}`} disabled={active} onClick={() => apply(id, def.name)} data-testid="apply-btn">
            {active ? '使用中' : '套用'}
          </button>
        ) : (
          <button className="ws-btn primary" disabled={!check?.ok} onClick={() => craft(id, def.name, true)} data-testid="craft-btn">
            {check?.ok ? '製作' : check && check.reason === 'insufficient' ? `還差 ${shortText(check.short)}` : '不能製作'}
          </button>
        )}
      </li>
    )
  }

  return (
    <main className="screen workshop theme-butter" data-testid="workshop">
      <ScreenHeader title="工坊" onBack={onBack} right={<MaterialsChip />} />
      <p className="ws-lead">用冒險拿到的木材、石頭和花朵，做出可愛的家具、壁紙和地板。</p>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} data-testid={`ws-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      <ul className="ws-grid">
        {tab === 'decor'
          ? craftableOf('decor').map(decorCard)
          : sortThemesByCost(themesOf(tab)).map((t) => themeCard(tab, t.id))}
      </ul>
      <p className="ws-foot">
        還沒有材料？<button className="ws-link" onClick={() => go('map')}>去冒險地圖</button>
      </p>
    </main>
  )
}
