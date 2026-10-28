import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { canCraft, craftableOf } from '../../learning/materials'
import { THEME_DEFS, themesOf, ownsTheme, sortThemesByCost } from '../../domain/theme'
import { MATERIAL_IDS, MATERIAL_NAMES } from '../../learning/types'
import { sayText } from '../../learning/speech'
import type { MaterialCost } from '../../learning/types'
import { DECOR_EMOJI, MAT_EMOJI } from '../../art/items'
import type { ShopItem, ThemeSlot } from '../../domain/types'
import { Icon } from '../components/Icon'
import { ScreenHeader } from '../components/Header'
import { MaterialsChip } from '../components/MaterialsChip'
import { useToast } from '../hooks'
import { useLearningSettings, useMaterials } from '../learningHooks'
import { useCelebrateSmall } from '../feedback'
import { canMakeMore, MAX_DECOR_COPIES, placedOf } from '../../domain/home7'
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
/** 唸給孩子聽：「還差 2 個石頭、3 個花朵」 */
const shortSpeech = (short: Partial<MaterialCost>) => `還差${MATERIAL_IDS.filter((m) => short[m]).map((m) => `${short[m]}個${MATERIAL_NAMES[m]}`).join('，')}`

/** 做不起時的按鈕內容：缺的材料圖示 + 數字缺口（不識字也看得懂還差多少）；文字只留給讀屏與測試 */
function GapButtonBody({ short }: { short: Partial<MaterialCost> }) {
  return (
    <>
      <span className="sr-only">還差 {shortText(short)}</span>
      <span className="ws-gap" aria-hidden>
        {MATERIAL_IDS.filter((m) => short[m]).map((m) => (
          <span key={m} className="ws-gap-item">
            <Icon name={`mat-${m}`} emoji={MAT_EMOJI[m]} size={30} />
            <b>−{short[m]}</b>
          </span>
        ))}
      </span>
    </>
  )
}

/** 做好了：跳出家具大圖慶祝，按「去擺放」（壁紙/地板是「套用」）直接帶去用 */
interface Done {
  id: string
  name: string
  theme: ThemeSlot | null
}

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
  const small = useCelebrateSmall()
  const { voiceOn } = useLearningSettings()
  const bal = useMaterials()
  const [tab, setTab] = useState<Tab>('decor')
  const [done, setDone] = useState<Done | null>(null)
  const [shaking, setShaking] = useState<string | null>(null)
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])
  const placements = useLiveQuery(() => db.placements.toArray(), [], [])
  const theme = useRoomTheme()

  const craft = async (id: string, name: string, themeSlot: ThemeSlot | null, card: Element | null) => {
    const r = await repo.craftFurniture(id)
    if (!r.ok) return toast(r.error, 'warn')
    small('craft', { at: card?.querySelector('.ws-art') ?? card, phrase: `${name}做好了！` })
    setDone({ id, name, theme: themeSlot })
  }
  const apply = async (id: string, name: string) => {
    const r = await repo.applyTheme(id)
    if (r.ok) toast(`房間換成「${name}」了！`, 'ok')
    else toast(r.error, 'warn')
  }
  /** 做不起：卡片晃一下，唸出還差什麼（按鈕上只有材料圖示與數字） */
  const explainShort = (id: string, short: Partial<MaterialCost>) => {
    setShaking(id)
    window.setTimeout(() => setShaking((v) => (v === id ? null : v)), 520)
    sayText(shortSpeech(short), { enabled: voiceOn })
  }

  const qtyOf = (id: string) => inventory.find((v) => v.itemId === id)?.qty ?? 0

  const decorCard = (item: ShopItem) => {
    const cost = item.cost!
    const qty = qtyOf(item.id)
    // v7：做過的家具可以再做（同一件最多 3 個），所以檢查材料時當作「還沒有」
    const check = canCraft(bal, 0, item)
    const placed = placedOf(item.id, placements)
    const more = qty > 0 && canMakeMore(qty)
    const craftBtn = (label: ReactNode, testId: string) => (
      <button
        className={`ws-btn ${check.ok ? 'primary go' : 'gap'} ${qty > 0 ? 'more' : ''}`}
        aria-disabled={!check.ok}
        onClick={(e) => {
          if (check.ok) void craft(item.id, item.name, null, e.currentTarget.closest('.ws-card'))
          else if (check.reason === 'insufficient') explainShort(item.id, check.short)
        }}
        data-testid={testId}
      >
        {check.ok ? label : check.reason === 'insufficient' ? <GapButtonBody short={check.short} /> : '不能製作'}
      </button>
    )
    return (
      <li key={item.id} className={`ws-card ${qty > 0 ? 'owned' : check.ok ? 'can' : 'cant'} ${shaking === item.id ? 'ux-shake' : ''}`} data-testid={`craft-${item.id}`} data-qty={qty}>
        <div className="ws-art">
          <Icon name={item.id} emoji={DECOR_EMOJI[item.asset]} alt={item.name} size="100%" />
          {qty > 1 && <b className="h7-ws-qty" data-testid="ws-qty">x{qty}</b>}
        </div>
        <div className="ws-name">{item.name}</div>
        <CostRow cost={cost} bal={bal} owned={qty > 0 && !more} />
        {qty > 0 ? (
          <div className="h7-ws-btns">
            <button className={`ws-btn ${placed >= qty ? '' : 'primary'}`} onClick={() => go({ name: 'home', edit: true })}>
              {placed >= qty ? '已擺放，去調整' : '去佈置'}
            </button>
            {more ? (
              craftBtn(
                <>
                  <Icon name="ui-workshop" emoji="🔨" size={32} /> 再做一個
                </>,
                'craft-more',
              )
            ) : (
              <span className="h7-ws-max" data-testid="craft-max">最多 {MAX_DECOR_COPIES} 個</span>
            )}
          </div>
        ) : (
          craftBtn(
            <>
              <Icon name="ui-workshop" emoji="🔨" size={32} /> 製作
            </>,
            'craft-btn',
          )
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
      <li key={id} className={`ws-card ${owned ? 'owned' : check?.ok ? 'can' : 'cant'} ${active ? 'active' : ''} ${shaking === id ? 'ux-shake' : ''}`} data-testid={`craft-${id}`}>
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
          <button
            className={`ws-btn ${check?.ok ? 'primary go' : 'gap'}`}
            aria-disabled={!check?.ok}
            onClick={(e) => {
              if (check?.ok) void craft(id, def.name, slot, e.currentTarget.closest('.ws-card'))
              else if (check && check.reason === 'insufficient') explainShort(id, check.short)
            }}
            data-testid="craft-btn"
          >
            {check?.ok ? (
              <>
                <Icon name="ui-workshop" emoji="🔨" size={32} /> 製作
              </>
            ) : check && check.reason === 'insufficient' ? (
              <GapButtonBody short={check.short} />
            ) : (
              '不能製作'
            )}
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
      {done && (
        <div className="modal-back craft-done" role="presentation" data-testid="craft-done">
          <div className="modal craft-done-card" role="dialog" aria-modal="true" aria-label={`${done.name}做好了`}>
            <div className="cd-rays" aria-hidden />
            <h2 className="cd-title">做好了！</h2>
            <div className="cd-art" data-testid="craft-done-art">
              {done.theme ? <Swatch id={done.id} slot={done.theme} /> : <Icon name={done.id} emoji={DECOR_EMOJI[done.id.replace('decor-', '')]} alt={done.name} size="100%" />}
            </div>
            <div className="cd-name">{done.name}</div>
            {done.theme ? (
              <button
                className="btn primary cd-go"
                onClick={async () => {
                  await apply(done.id, done.name)
                  setDone(null)
                }}
                data-testid="craft-done-go"
              >
                ✓ 套用
              </button>
            ) : (
              <button className="btn primary cd-go" onClick={() => go({ name: 'home', edit: true })} data-testid="craft-done-go">
                <Icon name="ui-bag" emoji="🪑" size={44} /> 去擺放
              </button>
            )}
            <button className="btn" onClick={() => setDone(null)} data-testid="craft-done-close">
              繼續做
            </button>
          </div>
        </div>
      )}
      <p className="ws-foot">
        還沒有材料？<button className="ws-link" onClick={() => go('map')}>去冒險地圖</button>
      </p>
    </main>
  )
}
