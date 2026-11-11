// v8.3 點心屋（純函式）。沒有對錯、沒有分數；這裡只管「放在哪裡算放在點心上」和幾個固定的排列。
// 座標都是百分比：(0,0) 是底座圖框的左上、(100,100) 是右下。

export type BakeryBaseId = 'cake' | 'icecream' | 'pancake' | 'donut' | 'cupcake'

/** 前三個是原本的；甜甜圈與杯子蛋糕是 v8.5 的新玩具 `bases` */
export const BAKERY_BASES: readonly { id: BakeryBaseId; icon: string; emoji: string; label: string }[] = [
  { id: 'cake', icon: 'ui-base-cake', emoji: '🍰', label: '蛋糕' },
  { id: 'icecream', icon: 'ui-base-icecream', emoji: '🍦', label: '冰淇淋' },
  { id: 'pancake', icon: 'ui-base-pancake', emoji: '🥞', label: '鬆餅' },
  { id: 'donut', icon: 'ui-base-donut', emoji: '🍩', label: '甜甜圈' },
  { id: 'cupcake', icon: 'ui-base-cupcake', emoji: '🧁', label: '杯子蛋糕' },
]
const ORIGINAL_BASES = 3

/** 有幾個新玩具時可以選哪些底座：沒有新玩具就是原本的三種 */
export const bakeryBasesFor = (toys: number): typeof BAKERY_BASES => (toys >= 1 ? BAKERY_BASES : BAKERY_BASES.slice(0, ORIGINAL_BASES))

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

/**
 * 每種底座大概的形狀（對齊 public/art/ui-base-*.png 裡點心的輪廓，不含盤子）。冰淇淋是上面一球 + 下面的甜筒。
 * 甜甜圈中間有洞（HOLES），杯子蛋糕是上面的奶油 + 下面的紙杯。
 */
const SHAPES: Record<BakeryBaseId, readonly Ellipse[]> = {
  cake: [{ cx: 50, cy: 42, rx: 40, ry: 33 }],
  icecream: [
    { cx: 50, cy: 28, rx: 33, ry: 27 },
    { cx: 50, cy: 72, rx: 13, ry: 25 },
  ],
  pancake: [{ cx: 50, cy: 40, rx: 34, ry: 33 }],
  donut: [{ cx: 50, cy: 50, rx: 44, ry: 38 }],
  cupcake: [
    { cx: 50, cy: 36, rx: 32, ry: 28 },
    { cx: 50, cy: 74, rx: 25, ry: 20 },
  ],
}

/** 底座上不能放東西的洞（只有甜甜圈有）。洞一定完全在第一個形狀裡面 */
const HOLES: Partial<Record<BakeryBaseId, Ellipse>> = {
  donut: { cx: 50, cy: 47, rx: 12, ry: 9 },
}
/** 東西要離洞口遠一點才算在外面（不然半個掉在洞裡） */
const HOLE_MARGIN = 1.12

/** 放得有點偏也算（手指比目標大）：在輪廓外這個倍數以內的，會吸回輪廓上 */
const SNAP_SLOP = 1.18

const dist = (e: Ellipse, x: number, y: number) => Math.hypot((x - e.cx) / e.rx, (y - e.cy) / e.ry)

export function onBase(base: BakeryBaseId, x: number, y: number): boolean {
  const hole = HOLES[base]
  if (hole && dist(hole, x, y) < 1) return false
  return SHAPES[base].some((e) => dist(e, x, y) <= 1)
}

/** 在洞裡的點推到洞口外面（往遠離洞中心的方向；剛好在正中間就往上） */
function outOfHole(base: BakeryBaseId, x: number, y: number): { x: number; y: number } {
  const hole = HOLES[base]
  if (!hole) return { x, y }
  const d = dist(hole, x, y)
  if (d >= HOLE_MARGIN) return { x, y }
  if (d < 1e-6) return { x: hole.cx, y: hole.cy - hole.ry * HOLE_MARGIN }
  return { x: hole.cx + ((x - hole.cx) / d) * HOLE_MARGIN, y: hole.cy + ((y - hole.cy) / d) * HOLE_MARGIN }
}

/** 放下去的位置：在點心上就照放；稍微超出吸回邊上；離太遠回傳 null（要彈回去） */
export function snapToBase(base: BakeryBaseId, x: number, y: number): { x: number; y: number } | null {
  let best = SHAPES[base][0]
  for (const e of SHAPES[base]) if (dist(e, x, y) < dist(best, x, y)) best = e
  const d = dist(best, x, y)
  // 放在甜甜圈的洞裡：吸到洞口旁邊，不會懸在洞上
  if (d <= 1) return outOfHole(base, x, y)
  if (d > SNAP_SLOP) return null
  return { x: best.cx + (x - best.cx) / d, y: best.cy + (y - best.cy) / d }
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/** 第 n 個點一下（沒有拖）就放上去的裝飾放哪裡：從中間往外繞，每次都一樣，不靠亂數 */
export function autoSpot(base: BakeryBaseId, n: number): { x: number; y: number } {
  const e = SHAPES[base][0]
  const i = n % MAX_TOPPINGS
  const r = ringRadius(base, 0.86, (i + 0.5) / MAX_TOPPINGS)
  return { x: e.cx + Math.cos(i * GOLDEN) * r * e.rx, y: e.cy + Math.sin(i * GOLDEN) * r * e.ry }
}

/**
 * 第一個形狀上，從裡到外第 t（0–1）圈的半徑（占輪廓的比例，最外到 max）。
 * 有洞的底座從洞口外面開始排，沒有洞的從正中間開始；面積平均分布，所以用開根號。
 */
function ringRadius(base: BakeryBaseId, max: number, t: number): number {
  const hole = HOLES[base]
  const e = SHAPES[base][0]
  // 洞不一定在正中間：從形狀中心看出去，洞最遠到哪裡
  const inner = hole ? Math.max((Math.abs(hole.cx - e.cx) + hole.rx * HOLE_MARGIN) / e.rx, (Math.abs(hole.cy - e.cy) + hole.ry * HOLE_MARGIN) / e.ry) + 0.04 : 0
  return Math.sqrt(inner * inner + (max * max - inner * inner) * t)
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
      // 比輪廓內縮一點：輪廓只是大概，糖珠撒到圖外面的空白會很明顯。有洞的底座（k === 0 那塊）不撒進洞裡
      const r = k === 0 ? ringRadius(base, 0.8, (i + 0.5) / n) : 0.8 * Math.sqrt((i + 0.5) / n)
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

// ---------- v8.5 新玩具 `piping`：擠花袋 ----------

export interface PipePoint {
  x: number
  y: number
}

/** 手指至少移動這麼遠（底座圖框的百分比）才多記一個點：線夠圓滑，點也不會多到拖慢畫面 */
export const PIPING_MIN_STEP = 2.2
/** 一個點心最多幾條奶油、全部加起來最多幾個點（滿了就不再擠，不出聲也不出錯） */
export const PIPING_MAX_STROKES = 24
export const PIPING_MAX_POINTS = 600

/** 擠花袋的嘴有沒有在點心上：只有在輪廓裡才擠得出來（不吸附，拖出去就斷） */
export const canPipeAt = (base: BakeryBaseId, x: number, y: number): boolean => onBase(base, x, y)

/** 這個新位置要不要記成一條奶油的下一個點：在點心上，而且離上一個點夠遠 */
export function pipeAccepts(base: BakeryBaseId, last: PipePoint | null, x: number, y: number): boolean {
  if (!canPipeAt(base, x, y)) return false
  return !last || Math.hypot(x - last.x, y - last.y) >= PIPING_MIN_STEP
}

/** 一條奶油的 SVG 路徑（viewBox 0 0 100 100）。只有一個點時畫成一小球 */
export function pipePath(points: readonly PipePoint[]): string {
  if (points.length === 0) return ''
  const f = (v: number) => Math.round(v * 10) / 10
  const [first, ...rest] = points
  if (rest.length === 0) return `M${f(first.x)} ${f(first.y)}l0.01 0`
  return `M${f(first.x)} ${f(first.y)}` + rest.map((p) => `L${f(p.x)} ${f(p.y)}`).join('')
}

/** 奶油最多分幾口吃完（再多條也不會讓寵物吃很久） */
export const PIPING_EAT_STEPS = 6

export interface EatStep {
  /** 這一口吃完後還剩幾個裝飾、幾條奶油 */
  decos: number
  strokes: number
}

/**
 * 送給寵物吃：每一口之後盤子上還剩什麼。先吃裝飾（一口一個，跟原本一樣），再吃奶油（最多分 6 口），
 * 最後一口一定全部吃完。沒有奶油時就是原本的一口一個裝飾。
 */
export function eatSteps(decos: number, strokes: number): EatStep[] {
  const out: EatStep[] = []
  for (let d = decos - 1; d >= 0; d--) out.push({ decos: d, strokes })
  const bites = Math.min(strokes, PIPING_EAT_STEPS)
  for (let b = 1; b <= bites; b++) out.push({ decos: 0, strokes: strokes - Math.ceil((strokes * b) / bites) })
  return out
}
