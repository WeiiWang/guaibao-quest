import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FOOD_EMOJI, MAT_EMOJI } from '../../art/items'
import { countUpValue, type RevealItem } from '../../domain/home74'
import { SHOP_ITEMS } from '../../domain/constants'
import { MATERIAL_NAMES } from '../../learning/types'
import type { MaterialId } from '../../learning/types'
import { Icon } from '../components/Icon'
import { stickerEmoji } from '../screens/coloring/stickers'
import { flyOne, iconNode } from '../fly'
import { playSfx } from '../../learning/sfx'
import '../j74.css'

/** 每一項攤開的間隔、數字跳動的長度、全部攤完後停多久才飛走、每一項飛的間隔與長度（ms） */
const STEP = 420
const COUNT_MS = 520
const HOLD = 600
const FLY_GAP = 120
const FLY_MS = 780

const artOf = (it: RevealItem): { name: string; emoji: string; label: string } => {
  switch (it.kind) {
    case 'star':
      return { name: 'ui-star', emoji: '⭐', label: '星星' }
    case 'food':
      return { name: `food-${it.ref}`, emoji: FOOD_EMOJI[it.ref ?? ''] ?? '🎁', label: SHOP_ITEMS.find((i) => i.id === it.ref)?.name ?? '食物' }
    case 'material':
      return { name: `mat-${it.ref}`, emoji: MAT_EMOJI[it.ref ?? ''] ?? '🎁', label: MATERIAL_NAMES[it.ref as MaterialId] ?? '材料' }
    default:
      return { name: it.ref ?? 'ui-star', emoji: stickerEmoji(it.ref ?? '') ?? '⭐', label: '貼紙' }
  }
}

/** 每一項東西飛去哪裡：星星 → 左上的點數、食物 → 食物列、材料 → 工坊鈕、貼紙 → 背包鈕（找不到就退到旁邊的目標） */
const targetOf = (it: RevealItem): Element | null => {
  if (it.kind === 'star') return document.querySelector('[data-points-chip]')
  if (it.kind === 'food') return document.querySelector(`[data-dock-item="${it.ref}"]`) ?? document.querySelector('[data-dock-item]') ?? document.querySelector('[data-testid=dock-shop]')
  return document.querySelector(it.kind === 'material' ? '[data-gift-target=material]' : '[data-gift-target=bag]')
}

function Chip({ item, index, from, reduced, soundOn }: { item: RevealItem; index: number; from: DOMRect | null; reduced: boolean; soundOn: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const art = artOf(item)
  const [val, setVal] = useState(reduced ? item.qty : item.qty > 1 ? 0 : item.qty)
  const [shown, setShown] = useState(reduced)
  const delay = reduced ? 0 : index * STEP

  // 從禮物袋的位置彈出來、落在自己的位置（Web Animations；一開始 fill both 讓還沒輪到的先藏著）
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || reduced || !from || typeof el.animate !== 'function') return
    const r = el.getBoundingClientRect()
    const dx = from.left + from.width / 2 - (r.left + r.width / 2)
    const dy = from.top + from.height / 2 - (r.top + r.height / 2)
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0, offset: 0 },
        { transform: `translate(${dx * 0.15}px, ${dy * 0.15 - 40}px) scale(1.25)`, opacity: 1, offset: 0.7 },
        { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 1 },
      ],
      { duration: 520, delay, easing: 'cubic-bezier(.2,.9,.3,1.1)', fill: 'both' },
    )
  }, [delay, from, reduced])

  // 輪到的時候：出聲、數字從 1 跳到 qty
  useEffect(() => {
    if (reduced) return
    let raf = 0
    const t = window.setTimeout(() => {
      setShown(true)
      playSfx('tap', soundOn)
      if (item.qty <= 1) return
      const t0 = performance.now()
      const tick = () => {
        const p = (performance.now() - t0) / COUNT_MS
        setVal(countUpValue(item.qty, p))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, delay + 200)
    return () => {
      window.clearTimeout(t)
      cancelAnimationFrame(raf)
    }
  }, [delay, item.qty, reduced, soundOn])

  return (
    <div ref={ref} className={`j74-chip ${shown ? 'shown' : ''}`} data-testid="gift-reveal-item" data-kind={item.kind} data-qty={item.qty} data-shown={shown ? 'true' : 'false'} data-ref={item.ref ?? ''}>
      <Icon name={art.name} emoji={art.emoji} alt={art.label} className="j74-chip-img" />
      <b className={`j74-chip-num ${val === item.qty ? 'done' : ''}`} data-testid="gift-reveal-num">+{val}</b>
    </div>
  )
}

interface Props {
  items: RevealItem[]
  /** 禮物袋的位置（從這裡飛出來） */
  from: DOMRect | null
  soundOn: boolean
  onDone: () => void
}

/**
 * v7.4 J4：禮物袋打開時，內容一項一項從袋子飛出來、排成一排，數字跳動（星星 +20、香蕉 +1）；
 * 攤完停一下，再各自飛向它該去的地方（星星 → 點數、食物 → 食物列、材料 → 工坊、貼紙 → 背包）。
 * 不擋操作（pointer-events: none）；減少動態效果時全部直接顯示再飛走。
 */
export function GiftReveal({ items, from, soundOn, onDone }: Props) {
  const reduced = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const rowRef = useRef<HTMLDivElement>(null)
  const [gone, setGone] = useState(false)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    const n = items.length
    const showMs = reduced ? 300 : (n - 1) * STEP + 200 + COUNT_MS + HOLD
    let alive = true
    const t = window.setTimeout(() => {
      const row = rowRef.current
      if (!row) return
      const chips = [...row.querySelectorAll<HTMLElement>('.j74-chip')]
      const flights = chips.map((el, i) => {
        const rect = el.getBoundingClientRect()
        const art = artOf(items[i])
        const px = Math.min(72, rect.width)
        el.style.visibility = 'hidden'
        return flyOne({ rect: { left: rect.left + rect.width / 2 - px / 2, top: rect.top + rect.height / 2 - px / 2, width: px, height: px }, node: iconNode(art.name, art.emoji, px) }, targetOf(items[i]), { delay: i * FLY_GAP, duration: FLY_MS })
      })
      setGone(true)
      void Promise.all(flights).then(() => alive && done.current())
      // 保險：任何原因動畫沒回報，也要收掉
      window.setTimeout(() => alive && done.current(), n * FLY_GAP + FLY_MS + 800)
    }, showMs)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [items, reduced])

  return (
    <div className={`j74-reveal ${gone ? 'gone' : ''}`} data-testid="gift-reveal" data-count={items.length} aria-hidden>
      <div className="j74-reveal-row" ref={rowRef}>
        {items.map((it, i) => (
          <Chip key={it.id} item={it} index={i} from={from} reduced={reduced} soundOn={soundOn} />
        ))}
      </div>
    </div>
  )
}
