import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { artName, DECOR_EMOJI, FOOD_EMOJI, isArtworkId, MAT_EMOJI } from '../../art/items'
import { HATS } from '../../domain/hats'
import { BAG_EMPTY, BAG_TABS, type BagTab, type EmptyGoto } from '../../domain/home74'
import { MAX_DECOR_COPIES, placedOf } from '../../domain/home7'
import { MATERIAL_IDS, MATERIAL_NAMES } from '../../learning/types'
import { GalleryFrame } from '../components/GalleryFrame'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { ScreenHeader } from '../components/Header'
import { useMaterials } from '../learningHooks'
import { useUnlockedStickers } from './coloring/useUnlockedStickers'
import type { Screen } from '../App'
import '../j74.css'

/** 「去做」按鈕的去處 */
export const goOf = (to: EmptyGoto, go: (s: Screen) => void) => () => {
  if (to === 'map') go({ name: 'map' })
  else if (to === 'shop-hat') go({ name: 'shop', tab: 'hat' })
  else if (to === 'coloring') go({ name: 'coloring' })
  else go({ name: 'workshop' })
}

/**
 * v7.4 J2：「我的東西」（原本的背包）。食物、材料、帽子、貼紙四個分頁，加上「家具」（擺飾、壁紙、地板、畫框，原本背包就有）。
 * 每個分頁空的時候：阿悟的圖 + 一句話（也會唸）+ 「去做」按鈕。餵食與佈置都回首頁房間裡做。
 */
export function BagScreen({ onBack, go }: { onBack: () => void; go: (s: Screen) => void }) {
  const [tab, setTab] = useState<BagTab>('food')
  const inventory = useLiveQuery(() => db.inventory.toArray(), [], [])
  const shopItems = useLiveQuery(() => db.shopItems.toArray(), [], [])
  const placements = useLiveQuery(() => db.placements.toArray(), [], [])
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const mats = useMaterials()

  const owned = inventory
    .filter((v) => v.qty > 0)
    .map((v) => ({ inv: v, item: shopItems.find((i) => i.id === v.itemId) }))
    .filter((x) => x.item && x.item.kind !== 'coloring' && x.item.kind !== 'theme' && x.item.kind !== 'hat')
  const foods = owned.filter((x) => x.item!.kind === 'food')
  const furniture = owned.filter((x) => x.item!.kind !== 'food')
  const matList = MATERIAL_IDS.map((m) => ({ id: m, qty: mats[m] ?? 0 }))
  const hats = HATS.filter((h) => (inventory.find((v) => v.itemId === h.id)?.qty ?? 0) > 0)
  // 已解鎖的貼紙（線 I：預設 8 張 + settings.stickers + 舊作用過的），和貼紙盤同一份邏輯
  const { unlocked: stickers } = useUnlockedStickers()

  const count: Record<BagTab, number> = {
    food: foods.reduce((n, x) => n + x.inv.qty, 0),
    material: matList.reduce((n, m) => n + m.qty, 0),
    hat: hats.length,
    sticker: stickers.length,
    furniture: furniture.length,
  }
  const empty = count[tab] === 0

  return (
    <main className="screen theme-bubblegum j74-bag" data-testid="bag">
      <ScreenHeader title="我的東西" onBack={onBack} />
      <div className="tabs j74-bag-tabs" role="tablist" aria-label="我的東西">
        {BAG_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab j74-bag-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} data-testid={`bag-tab-${t.id}`}>
            <span aria-hidden>{t.emoji}</span> {t.label}
          </button>
        ))}
      </div>

      {empty ? (
        <EmptyState key={tab} pet={pet} line={BAG_EMPTY[tab].line} button={BAG_EMPTY[tab].button} onGo={goOf(BAG_EMPTY[tab].goto, go)} testId={`bag-empty-${tab}`} />
      ) : (
        <>
          {tab === 'food' && (
            <ul className="shop-grid" data-testid="bag-grid-food">
              {foods.map(({ inv, item }) => (
                <li key={item!.id} className="card shop-item art-card">
                  <div className="shop-art">
                    <Icon name={artName(item!)} emoji={FOOD_EMOJI[item!.asset]} alt={item!.name} className="shop-sprite" />
                  </div>
                  <div className="shop-name">{item!.name}</div>
                  <div className="shop-price">x{inv.qty}</div>
                  <button className="btn primary" onClick={() => go({ name: 'home' })}>去餵食</button>
                </li>
              ))}
            </ul>
          )}
          {tab === 'material' && (
            <ul className="shop-grid" data-testid="bag-grid-material">
              {matList.map((m) => (
                <li key={m.id} className={`card shop-item art-card ${m.qty === 0 ? 'j74-dim' : ''}`}>
                  <div className="shop-art">
                    <Icon name={`mat-${m.id}`} emoji={MAT_EMOJI[m.id]} alt={MATERIAL_NAMES[m.id]} className="shop-sprite" />
                  </div>
                  <div className="shop-name">{MATERIAL_NAMES[m.id]}</div>
                  <div className="shop-price">x{m.qty}</div>
                  <button className="btn primary" onClick={() => go({ name: 'workshop' })}>去工坊</button>
                </li>
              ))}
            </ul>
          )}
          {tab === 'hat' && (
            <ul className="shop-grid" data-testid="bag-grid-hat">
              {hats.map((h) => (
                <li key={h.id} className="card shop-item art-card">
                  <div className="shop-art">
                    <Icon name={h.id} emoji={h.emoji} alt={h.name} className="shop-sprite" />
                  </div>
                  <div className="shop-name">{h.name}</div>
                  <button className="btn primary" onClick={() => go({ name: 'home', wardrobe: true })}>去衣櫃</button>
                </li>
              ))}
            </ul>
          )}
          {tab === 'sticker' && (
            <>
              <ul className="j74-stickers" data-testid="bag-grid-sticker">
                {stickers.map((s) => (
                  <li key={s.art} className="card j74-sticker" data-sticker={s.art}>
                    <Icon name={s.art} emoji={s.emoji} alt={s.label} className="j74-sticker-img" />
                    <span>{s.label}</span>
                  </li>
                ))}
              </ul>
              <div className="j74-bag-cta">
                <button className="btn primary" onClick={() => go({ name: 'coloring' })}>去畫畫</button>
              </div>
            </>
          )}
          {tab === 'furniture' && (
            <ul className="shop-grid" data-testid="bag-grid-furniture">
              {furniture.map(({ inv, item }) => {
                const it = item!
                const have = Math.min(MAX_DECOR_COPIES, inv.qty)
                const placedN = placedOf(it.id, placements)
                const placed = placedN >= have
                return (
                  <li key={it.id} className="card shop-item art-card">
                    <div className="shop-art">
                      {isArtworkId(it.id) ? (
                        <div className="shop-sprite"><GalleryFrame artId={it.id} /></div>
                      ) : (
                        <Icon name={artName(it)} emoji={DECOR_EMOJI[it.asset]} alt={it.name} className="shop-sprite" />
                      )}
                    </div>
                    <div className="shop-name">{it.name}</div>
                    <div className="shop-price">{have > 1 ? `擺了 ${placedN} / ${have}` : placed ? '已擺放' : '還沒擺放'}</div>
                    <button className={`btn ${placed ? '' : 'primary'}`} onClick={() => go({ name: 'home', edit: true })}>
                      去擺放
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </main>
  )
}
