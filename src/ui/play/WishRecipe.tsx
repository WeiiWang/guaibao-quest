import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { DECOR_EMOJI, MAT_EMOJI } from '../../art/items'
import { placedBaseIds, WISH_BY_ID } from '../../domain/play74'
import type { Inventory, Placement } from '../../domain/types'
import { CRAFT_SHORT_LINE } from '../../learning/feedbackLines'
import { canCraft, SHOP_CATALOG, type MaterialBalance } from '../../learning/materials'
import { wishKey } from '../../learning/playLines'
import { say, sayText } from '../../learning/speech'
import { MATERIAL_IDS, MATERIAL_NAMES, type MaterialCost } from '../../learning/types'
import { Art } from '../components/Art'
import { Icon } from '../components/Icon'
import './play74.css'

interface Props {
  wishId: string
  bal: MaterialBalance
  inventory: Inventory[]
  placements: Placement[]
  voiceOn: boolean
  /** 做這件家具（工坊的製作流程：扣材料、慶祝、「去擺放」） */
  onCraft: (id: string, name: string, card: Element | null) => void
  /** 去首頁佈置模式把家具擺進房間 */
  onPlace: () => void
}

const costRow = (cost: MaterialCost) =>
  MATERIAL_IDS.filter((m) => cost[m] > 0).map((m) => (
    <span key={m}>
      <Icon name={`mat-${m}`} emoji={MAT_EMOJI[m]} alt={MATERIAL_NAMES[m]} size={26} />
      <b>{cost[m]}</b>
    </span>
  ))

/**
 * 工坊最上面的小願望食譜（v7.4 K2）：阿悟想要什麼、需要哪些材料、你還差多少。
 * 缺的材料用圖示加數字（不識字也看得懂）；材料夠了就直接在這裡做；做好了帶去擺放。
 * 不限時，不做也沒有任何損失。
 */
export function WishRecipe({ wishId, bal, inventory, placements, voiceOn, onCraft, onPlace }: Props) {
  const wish = WISH_BY_ID[wishId]
  const [shaking, setShaking] = useState<string | null>(null)
  const stage = useLiveQuery(async () => (await db.pets.get('pet'))?.stage, [])
  useEffect(() => {
    if (wish) say(wishKey(wish.id), wish.line, { enabled: voiceOn })
    // 進工坊時說一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wishId])
  if (!wish) return null
  const placed = placedBaseIds(placements.map((p) => p.itemId))
  const qtyOf = (id: string) => inventory.find((v) => v.itemId === id)?.qty ?? 0
  const needPlace = wish.items.some((id) => qtyOf(id) > 0 && !placed.has(id))

  return (
    <section className="k74-recipe" data-testid="wish-recipe" data-wish={wish.id} aria-label={`阿悟的小願望：${wish.line}`}>
      <div className="k74-recipe-head">
        <Art name={`pet-${stage === 'baby' ? 'baby' : 'adult'}-think`} alt="" className="k74-awu" />
        <p>{wish.line}</p>
      </div>
      <ul className="k74-recipe-items">
        {wish.items.map((id) => {
          const item = SHOP_CATALOG.find((i) => i.id === id)
          if (!item?.cost) return null
          const have = qtyOf(id) > 0
          const isPlaced = placed.has(id)
          const check = canCraft(bal, 0, item)
          const state = isPlaced ? 'placed' : have ? 'owned' : check.ok ? 'can' : 'gap'
          return (
            <li key={id} className={`k74-recipe-item ${shaking === id ? 'ux-shake' : ''}`} data-testid={`wish-item-${id}`} data-state={state}>
              <Icon name={id} emoji={DECOR_EMOJI[item.asset]} alt={item.name} className="k74-ri-art" />
              <div className="k74-ri-body">
                <b>{item.name}</b>
                {state === 'placed' && <span className="k74-ri-state ok">✓ 已經擺好了</span>}
                {state === 'owned' && <span className="k74-ri-state go">做好了，擺進房間吧</span>}
                {(state === 'can' || state === 'gap') && (
                  <>
                    <span className="k74-ri-have" aria-label="需要的材料">{costRow(item.cost)}</span>
                    {state === 'gap' && !check.ok && check.reason === 'insufficient' && (
                      <span className="k74-ri-gap" data-testid="wish-gap" aria-label={`還差 ${MATERIAL_IDS.filter((m) => check.short[m]).map((m) => `${MATERIAL_NAMES[m]}${check.short[m]}`).join(' ')}`}>
                        還差
                        {MATERIAL_IDS.filter((m) => check.short[m]).map((m) => (
                          <span key={m}>
                            <Icon name={`mat-${m}`} emoji={MAT_EMOJI[m]} alt={MATERIAL_NAMES[m]} size={26} />
                            <b>{check.short[m]}</b>
                          </span>
                        ))}
                      </span>
                    )}
                  </>
                )}
                {state === 'can' && (
                  <button className="btn primary" data-testid="wish-craft" onClick={(e) => onCraft(id, item.name, e.currentTarget.closest('.k74-recipe-item'))}>
                    <Icon name="ui-workshop" emoji="🔨" size={32} /> 製作
                  </button>
                )}
                {state === 'gap' && (
                  <button
                    className="btn"
                    aria-disabled
                    data-testid="wish-short"
                    onClick={() => {
                      setShaking(id)
                      window.setTimeout(() => setShaking((v) => (v === id ? null : v)), 520)
                      sayText(CRAFT_SHORT_LINE, { enabled: voiceOn })
                    }}
                  >
                    材料還不夠
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {needPlace && (
        <div className="k74-recipe-btns">
          <button className="btn primary" onClick={onPlace} data-testid="wish-place">
            <Icon name="ui-bag" emoji="🪑" size={36} /> 去擺放
          </button>
        </div>
      )}
    </section>
  )
}
