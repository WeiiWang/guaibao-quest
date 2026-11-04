// v8.3 點心屋（純函式）。沒有對錯、沒有分數；這裡只管「放在哪裡算放在點心上」和幾個固定的排列。
// 座標都是百分比：(0,0) 是底座圖框的左上、(100,100) 是右下。

export type BakeryBaseId = 'cake' | 'icecream' | 'pancake'

export const BAKERY_BASES: readonly { id: BakeryBaseId; icon: string; emoji: string; label: string }[] = [
  { id: 'cake', icon: 'ui-base-cake', emoji: '🍰', label: '蛋糕' },
  { id: 'icecream', icon: 'ui-base-icecream', emoji: '🍦', label: '冰淇淋' },
  { id: 'pancake', icon: 'ui-base-pancake', emoji: '🥞', label: '鬆餅' },
]

export const BAKERY_TOPPINGS: readonly { id: string; icon: string; emoji: string; label: string }[] = [
  { id: 'cream', icon: 'ui-top-cream', emoji: '🧁', label: '奶油' },
  { id: 'cherry', icon: 'ui-top-cherry', emoji: '🍒', label: '櫻桃' },
  { id: 'candle', icon: 'ui-top-candle', emoji: '🕯️', label: '蠟燭' },
  { id: 'choco', icon: 'ui-top-choco', emoji: '🍫', label: '巧克力' },
  { id: 'star', icon: 'ui-top-star', emoji: '⭐', label: '星星糖' },
  { id: 'apple', icon: 'food-apple', emoji: '🍎', label: '蘋果' },
  { id: 'banana', icon: 'food-banana', emoji: '🍌', label: '香蕉' },
  { id: 'grape', icon: 'food-grape', emoji: '🍇', label: '葡萄' },
  { id: 'peach', icon: 'food-peach', emoji: '🍑', label: '桃子' },
  { id: 'watermelon', icon: 'food-watermelon', emoji: '🍉', label: '西瓜' },
]

/** 一個點心最多放幾個裝飾 */
export const MAX_TOPPINGS = 30
/** 糖珠最多撒幾層 */
export const SPRINKLE_LAYERS = 3

interface Ellipse {
  cx: number
  cy: number
  rx: number
  ry: number
}

/** 每種底座大概的形狀（對齊 public/art/ui-base-*.png 裡點心的輪廓，不含盤子）。冰淇淋是上面一球 + 下面的甜筒 */
const SHAPES: Record<BakeryBaseId, readonly Ellipse[]> = {
  cake: [{ cx: 50, cy: 42, rx: 40, ry: 33 }],
  icecream: [
    { cx: 50, cy: 28, rx: 33, ry: 27 },
    { cx: 50, cy: 72, rx: 13, ry: 25 },
  ],
  pancake: [{ cx: 50, cy: 40, rx: 34, ry: 33 }],
}

/** 放得有點偏也算（手指比目標大）：在輪廓外這個倍數以內的，會吸回輪廓上 */
const SNAP_SLOP = 1.18

const dist = (e: Ellipse, x: number, y: number) => Math.hypot((x - e.cx) / e.rx, (y - e.cy) / e.ry)

export function onBase(base: BakeryBaseId, x: number, y: number): boolean {
  return SHAPES[base].some((e) => dist(e, x, y) <= 1)
}

/** 放下去的位置：在點心上就照放；稍微超出吸回邊上；離太遠回傳 null（要彈回去） */
export function snapToBase(base: BakeryBaseId, x: number, y: number): { x: number; y: number } | null {
  let best = SHAPES[base][0]
  for (const e of SHAPES[base]) if (dist(e, x, y) < dist(best, x, y)) best = e
  const d = dist(best, x, y)
  if (d <= 1) return { x, y }
  if (d > SNAP_SLOP) return null
  return { x: best.cx + (x - best.cx) / d, y: best.cy + (y - best.cy) / d }
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/** 第 n 個點一下（沒有拖）就放上去的裝飾放哪裡：從中間往外繞，每次都一樣，不靠亂數 */
export function autoSpot(base: BakeryBaseId, n: number): { x: number; y: number } {
  const e = SHAPES[base][0]
  const i = n % MAX_TOPPINGS
  const r = 0.86 * Math.sqrt((i + 0.5) / MAX_TOPPINGS)
  return { x: e.cx + Math.cos(i * GOLDEN) * r * e.rx, y: e.cy + Math.sin(i * GOLDEN) * r * e.ry }
}

export const SPRINKLE_COLORS = ['#ff6f91', '#ffc75f', '#5ec9ff', '#7ddc8a', '#b98cff', '#ffffff'] as const

export interface SprinkleDot {
  x: number
  y: number
  color: string
}

/** 第 layer 層糖珠（0 起算）。固定樣式：每層轉一個角度，看起來像多撒了一把 */
export function sprinkleDots(base: BakeryBaseId, layer: number): SprinkleDot[] {
  const count = 26
  const out: SprinkleDot[] = []
  for (const [k, e] of SHAPES[base].entries()) {
    const n = k === 0 ? count : Math.round(count / 2)
    for (let i = 0; i < n; i++) {
      const a = i * GOLDEN + layer * 1.1 + k
      // 比輪廓內縮一點：輪廓只是大概，糖珠撒到圖外面的空白會很明顯
      const r = 0.8 * Math.sqrt((i + 0.5) / n)
      out.push({ x: e.cx + Math.cos(a) * r * e.rx, y: e.cy + Math.sin(a) * r * e.ry, color: SPRINKLE_COLORS[(i + layer) % SPRINKLE_COLORS.length] })
    }
  }
  return out
}

/** 吃掉一個裝飾的間隔：裝飾少時慢慢吃，30 個也不會等太久（全部約 3 秒內） */
export function eatIntervalMs(n: number): number {
  if (n <= 0) return 0
  return Math.max(100, Math.min(420, Math.round(3000 / n)))
}
