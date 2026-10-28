import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { COLORING_PAGE_IDS, foodHearts, FOOD_EFFECTS } from '../../domain/constants'
import { isFavoriteFood } from '../../domain/favorite'
import { localDateStr } from '../../domain/date'
import { canBuy } from '../../domain/shop'
import { PURCHASE_UNDO_MS } from '../../domain/constants'
import { artName, FOOD_EMOJI } from '../../art/items'
import { hatBuyLine, hatEggLine, hatOffLine, hatOf, hatWearLine } from '../../domain/hats'
import { sayText } from '../../learning/speech'
import { useLearningSettings } from '../learningHooks'
import type { ShopItem, ShopKind } from '../../domain/types'
import { PageThumb } from '../components/ColoringThumb'
import { Icon } from '../components/Icon'
import { PointsChip, ScreenHeader } from '../components/Header'
import { UndoPill } from '../components/UndoPill'
import { useCelebrateSmall } from '../feedback'
import { flyOne, iconNode } from '../fly'
import { useBalance, useNow, useToast } from '../hooks'
import type { Screen } from '../App'
import './shop.css'

/** 同一顆按鈕在這段時間內只算一次（4–7 歲的孩子會連點） */
export const BUY_LOCK_MS = 600

/** 家具改由工坊用材料製作，商店只賣飼料與著色頁 */
const TABS: { kind: ShopKind; label: string }[] = [
  { kind: 'food', label: '飼料' },
  { kind: 'coloring', label: '著色頁' },
  { kind: 'hat', label: '衣櫃' },
]

/** 飽足值：用 1–5 顆小愛心表示 */
function Hearts({ n, hunger }: { n: number; hunger?: number }) {
  return (
    <div className="hearts" role="img" aria-label={`飽足值 ${hunger ?? n * 20}`} data-hearts={n}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </div>
  )
}

/** 買到的東西用什麼小圖飛、退回鈕上放什麼：食物用食物圖，著色頁用調色盤 */
const emojiOf = (item: ShopItem): string => (item.kind === 'hat' ? hatOf(item.id)?.emoji ?? '🎩' : FOOD_EMOJI[item.asset] ?? '🎁')
const iconOf = (item: ShopItem) => (item.kind === 'coloring' ? { name: 'ui-coloring', emoji: '🎨' } : { name: artName(item), emoji: emojiOf(item) })

interface Undo {
  ledgerId: string
  item: ShopItem
  key: number
}

export function ShopScreen({ onBack, initialTab = 'food' }: { onBack: () => void; initialTab?: Extract<Screen, { name: 'shop' }>['tab'] }) {
  const toast = useToast()
  const small = useCelebrateSmall()
  const { voiceOn } = useLearningSettings()
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const [tab, setTab] = useState<ShopKind>(initialTab ?? 'food')
  const [undo, setUndo] = useState<Undo | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  const locks = useRef(new Map<string, number>())
  const busy = useRef(false)
  useEffect(() => () => window.clearTimeout(undoTimer.current), [])
  const balance = useBalance()
  const today = localDateStr(useNow())
  const items = useLiveQuery(async () => {
    const list = await db.shopItems.where('kind').equals(tab).toArray()
    const rank = (id: string) => COLORING_PAGE_IDS.findIndex((p) => `coloring-${p}` === id)
    return list.sort((a, b) => a.price - b.price || rank(a.id) - rank(b.id))
  }, [tab], [])
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])

  const buy = async (item: ShopItem, btn: HTMLElement) => {
    // 防雙擊：同一顆按鈕 600ms 內只算一次；上一筆還在處理中也不再送
    const t = Date.now()
    if (busy.current || t - (locks.current.get(item.id) ?? 0) < BUY_LOCK_MS) return
    locks.current.set(item.id, t)
    busy.current = true
    try {
      const r = await repo.buyItem(item.id)
      if (!r.ok) return toast(r.error, 'warn')
      const card = btn.closest('.shop-item')
      const art = card?.querySelector('.shop-art') ?? btn
      small('buy', { at: art, phrase: item.kind === 'hat' ? hatBuyLine(item.name) : `買到${item.name.replace('著色頁：', '')}囉！` })
      // 買到的東西飛進右上角的背包
      const rect = art.getBoundingClientRect()
      const px = Math.min(72, rect.height)
      void flyOne(
        { rect: { left: rect.left + rect.width / 2 - px / 2, top: rect.top + rect.height / 2 - px / 2, width: px, height: px }, node: iconNode(iconOf(item).name, iconOf(item).emoji, px) },
        document.querySelector('[data-bag-target]'),
        { duration: 800 },
      )
      // 5 秒內可以退回剛買的
      window.clearTimeout(undoTimer.current)
      setUndo({ ledgerId: r.ledgerId, item, key: t })
      undoTimer.current = window.setTimeout(() => setUndo(null), PURCHASE_UNDO_MS)
    } finally {
      busy.current = false
    }
  }
  /** 衣櫃：已經擁有的帽子，在這裡直接戴上或拿下 */
  const wear = async (item: ShopItem) => {
    const off = pet?.hat === item.id
    const r = await repo.setHat(off ? null : item.id)
    if (!r.ok) {
      toast(r.error, 'warn')
      sayText(r.reason === 'egg' ? hatEggLine(pet?.name ?? '阿悟') : r.error, { enabled: voiceOn })
      return
    }
    small('place', { phrase: off ? hatOffLine() : hatWearLine(pet?.name ?? '阿悟', item.name) })
  }
  const doUndo = async () => {
    if (!undo) return
    const u = undo
    window.clearTimeout(undoTimer.current)
    setUndo(null)
    const r = await repo.undoPurchase(u.ledgerId)
    if (r.ok) {
      small('undo', { phrase: `${u.item.name.replace('著色頁：', '')}退回囉` })
      toast(`退回了，還你 ${r.refunded} 顆星星`, 'info')
    } else toast(r.error, 'warn')
  }

  return (
    <main className="screen theme-peach">
      <ScreenHeader
        title="商店"
        onBack={onBack}
        right={
          <div className="shop-head-right">
            <PointsChip />
            <span className="bag-target" data-bag-target data-testid="bag-target" aria-hidden>
              <Icon name="ui-bag" emoji="🎒" size={36} />
            </span>
          </div>
        }
      />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.kind} role="tab" aria-selected={tab === t.kind} className={`tab ${tab === t.kind ? 'on' : ''}`} onClick={() => setTab(t.kind)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'hat' && (
        <p className="wd-shop-note" data-testid="hat-note">
          用星星買帽子給{pet?.name ?? '阿悟'}戴！買好之後在這裡按「戴上」，或回首頁點「更多」裡的衣櫃。
        </p>
      )}
      <ul className={`shop-grid ${tab === 'food' ? 'food-grid' : ''}`} data-testid={`shop-grid-${tab}`}>
        {items.map((item) => {
          const owned = inventory.find((v) => v.itemId === item.id)?.qty ?? 0
          const check = canBuy(balance, owned, item)
          const fav = item.kind === 'food' && isFavoriteFood(item.id, today)
          return (
            <li key={item.id} className={`card shop-item art-card ${fav ? 'favorite' : ''}`} data-testid={`shop-${item.id}`}>
              {fav && <span className="fav-badge" data-testid="fav-badge">今天最喜歡</span>}
              <div className="shop-art">
                {item.kind === 'coloring' ? (
                  <PageThumb pageId={item.asset} className="shop-thumb" />
                ) : (
                  <Icon name={artName(item)} emoji={emojiOf(item)} alt={item.name} className="shop-sprite" />
                )}
              </div>
              <div className="shop-name">{item.name}</div>
              {item.kind === 'food' && <Hearts n={foodHearts(item.id)} hunger={FOOD_EFFECTS[item.id]?.hunger} />}
              <div className="shop-price">
                <Icon name="ui-star" emoji="⭐" size={20} /> {item.price}
                {item.kind === 'food' && owned > 0 ? <small>背包 {owned}</small> : null}
              </div>
              {item.kind === 'hat' && owned > 0 ? (
                <button className={`btn buy-btn ${pet?.hat === item.id ? '' : 'primary'}`} onClick={() => void wear(item)} data-testid="wear-btn" aria-pressed={pet?.hat === item.id}>
                  {pet?.hat === item.id ? '拿下' : '戴上'}
                </button>
              ) : (
              <button className="btn primary buy-btn" disabled={!check.ok} onClick={(e) => buy(item, e.currentTarget)} data-testid="buy-btn">
                {check.ok ? (
                  <>
                    <Icon name="ui-shop" emoji="🛒" size={26} /> 買
                  </>
                ) : check.reason === 'owned' ? (
                  '已擁有'
                ) : (
                  `還差 ${check.shortBy} 點`
                )}
              </button>
              )}
            </li>
          )
        })}
      </ul>
      {undo && (
        <UndoPill key={undo.key} ms={PURCHASE_UNDO_MS} label={`退回${undo.item.name.replace('著色頁：', '')}`} onUndo={doUndo} testId="undo-buy">
          <Icon name={iconOf(undo.item).name} emoji={iconOf(undo.item).emoji} size={34} />
        </UndoPill>
      )}
    </main>
  )
}
