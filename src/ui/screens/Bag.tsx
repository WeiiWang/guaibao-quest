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
import { PlaceBackdrop } from '../components/Place'
import { PlaceGreeting, PlaceStand } from '../components/PlaceStand'
import { useMaterials } from '../learningHooks'
import { useUnlockedStickers } from './coloring/useUnlockedStickers'
import type { Screen } from '../App'
import '../j74.css'
import './bag.css'

/** 「去做」按鈕的去處 */
export const goOf = (to: EmptyGoto, go: (s: Screen) => void) => () => {
  if (to === 'map') go({ name: 'map' })
  else if (to === 'shop-hat') go({ name: 'shop', tab: 'hat' })
  else if (to === 'coloring') go({ name: 'coloring' })
  else go({ name: 'workshop' })
}

/** v8.2 線 S：木箱至少有幾格（東西少的時候其餘是空格子，整個箱子才像箱子） */
const CRATE_MIN = 8
const CRATE_ROW = 4
/** 要補幾個空格子：不到 8 格補到 8 格；超過就補滿最後一排 */
const emptySlots = (n: number) => (n < CRATE_MIN ? CRATE_MIN - n : (CRATE_ROW - (n % CRATE_ROW)) % CRATE_ROW)
function Slots({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: emptySlots(n) }, (_, i) => (
        <li key={i} className="pl-bag-slot" aria-hidden />
      ))}
    </>
  )
}

/**
 * v7.4 J2：「我的東西」（原本的背包）。食物、材料、帽子、貼紙四個分頁，加上「家具」（擺飾、壁紙、地板、畫框，原本背包就有）。
 * 每個分頁空的時候：阿悟的圖 + 一句話（也會唸）+ 「去做」按鈕。餵食與佈置都回首頁房間裡做。
 */
export function BagScreen({ onBack, go }: { onBack: () => void; go: (s: Screen) => void }) {
  const [tab, setTab] = useState<BagTab>('food')
  // v8.2：還沒讀到資料不算「空」（以前一進來會閃一下空狀態，還會唸出「還沒有食物」）
  const inventoryQ = useLiveQuery(() => db.inventory.toArray(), [])
  const shopItemsQ = useLiveQuery(() => db.shopItems.toArray(), [])
  const inventory = inventoryQ ?? []
  const shopItems = shopItemsQ ?? []
  const ready = inventoryQ !== undefined && shopItemsQ !== undefined
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
    <main className="screen place pl-spot pl-bag theme-bubblegum j74-bag" data-testid="bag">
      <PlaceBackdrop place="bag" />
      {/* 空狀態自己會唸一句，招呼語不要在 0.5 秒後蓋掉它；換到有東西的分頁再打招呼 */}
      {ready && !empty && <PlaceGreeting place="bag" />}
      <ScreenHeader title="我的東西" onBack={onBack} />
      <div className="pl-spot-body">
        <div className="tabs j74-bag-tabs" role="tablist" aria-label="我的東西">
          {BAG_TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab j74-bag-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} data-testid={`bag-tab-${t.id}`}>
              <span aria-hidden>{t.emoji}</span> {t.label}
            </button>
          ))}
        </div>

        {!ready ? null : empty ? (
          <div className="pl-bag-emptyroom">
            <ul className="pl-bag-crate" aria-hidden>
              <Slots n={0} />
            </ul>
            <EmptyState key={tab} pet={pet} line={BAG_EMPTY[tab].line} button={BAG_EMPTY[tab].button} onGo={goOf(BAG_EMPTY[tab].goto, go)} testId={`bag-empty-${tab}`} />
          </div>
        ) : (
          <>
            {tab === 'food' && (
              <ul className="shop-grid pl-bag-crate" data-testid="bag-grid-food">
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
                <Slots n={foods.length} />
              </ul>
            )}
            {tab === 'material' && (
              <ul className="shop-grid pl-bag-crate" data-testid="bag-grid-material">
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
                <Slots n={matList.length} />
              </ul>
            )}
            {tab === 'hat' && (
              <ul className="shop-grid pl-bag-crate" data-testid="bag-grid-hat">
                {hats.map((h) => (
                  <li key={h.id} className="card shop-item art-card">
                    <div className="shop-art">
                      <Icon name={h.id} emoji={h.emoji} alt={h.name} className="shop-sprite" />
                    </div>
                    <div className="shop-name">{h.name}</div>
                    <button className="btn primary" onClick={() => go({ name: 'home', wardrobe: true })}>去衣櫃</button>
                  </li>
                ))}
                <Slots n={hats.length} />
              </ul>
            )}
            {tab === 'sticker' && (
              <>
                <ul className="j74-stickers pl-bag-crate pl-bag-stickers" data-testid="bag-grid-sticker">
                  {stickers.map((s) => (
                    <li key={s.art} className="j74-sticker" data-sticker={s.art}>
                      <Icon name={s.art} emoji={s.emoji} alt={s.label} className="j74-sticker-img" />
                      <span>{s.label}</span>
                    </li>
                  ))}
                  <Slots n={stickers.length} />
                </ul>
                <div className="j74-bag-cta">
                  <button className="btn primary" onClick={() => go({ name: 'coloring' })}>去畫畫</button>
                </div>
              </>
            )}
            {tab === 'furniture' && (
              <ul className="shop-grid pl-bag-crate" data-testid="bag-grid-furniture">
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
                <Slots n={furniture.length} />
              </ul>
            )}
          </>
        )}
      </div>
      {/* 空狀態的「阿悟的圖」就是這隻寵物（橫向站同一個位置），不要同時出現兩隻 */}
      {ready && !empty && <PlaceStand floor />}
    </main>
  )
}
