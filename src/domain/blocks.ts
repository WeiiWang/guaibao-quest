// v8.4 積木工地的規則（純函式）：2D 堆疊、推倒散開、照著蓋的比對。
// 座標單位是「格」：x 是左邊在第幾格，y 是底邊離地幾格（地面 y = 0）。不做真的物理、不會自己倒。

export const BLOCK_SHAPES = ['cube', 'long', 'arch', 'roof', 'cyl', 'half'] as const
/** v8.5 新玩具「新積木」：輪子、窗戶、旗子（圖是單色的，不跟著顏色盤換色） */
export const PART_SHAPES = ['wheel', 'window', 'flag'] as const
export type PartShape = (typeof PART_SHAPES)[number]
export type BlockShape = (typeof BLOCK_SHAPES)[number] | PartShape
export const isPart = (shape: BlockShape): shape is PartShape => (PART_SHAPES as readonly string[]).includes(shape)
/** 盤子上有哪些積木：沒有新玩具時就是原本的 6 種 */
export const trayShapes = (toys: number): readonly BlockShape[] => (toys >= 1 ? [...BLOCK_SHAPES, ...PART_SHAPES] : BLOCK_SHAPES)

/** 每種積木的寬高（格）。拱門、三角屋頂、半圓的上緣不是平的，但堆疊照外框算（簡單、可預期） */
export const BLOCK_SIZE: Record<BlockShape, { w: number; h: number }> = {
  cube: { w: 2, h: 2 },
  long: { w: 4, h: 1 },
  arch: { w: 4, h: 2 },
  roof: { w: 4, h: 2 },
  cyl: { w: 2, h: 3 },
  half: { w: 4, h: 2 },
  // 新積木照同一套格子：輪子與窗戶跟方塊一樣大，旗子是細細高高的一支（上面照樣可以再疊，跟屋頂一樣照外框算）
  wheel: { w: 2, h: 2 },
  window: { w: 2, h: 2 },
  flag: { w: 2, h: 3 },
}

export const BLOCK_COLORS = ['coral', 'sun', 'leaf', 'sky', 'grape'] as const
export type BlockColor = (typeof BLOCK_COLORS)[number]

export interface Block {
  id: number
  shape: BlockShape
  color: BlockColor
  x: number
  y: number
}

/** 寵物站在塔頂要留的高度（格）：縮放時把寵物一起算進去，牠永遠看得到 */
export const PET_ROWS = 3
/** 塔太高時畫面最多縮到這個比例；再高就不給放（積木溫和地回到盤子） */
export const MIN_VIEW_SCALE = 0.5

const overlapX = (ax: number, aw: number, bx: number, bw: number) => ax < bx + bw && bx < ax + aw
const overlapY = (ay: number, ah: number, by: number, bh: number) => ay < by + bh && by < ay + ah

/** 放開時水平對齊格線：手指在積木中間，換算成左邊的格子，並夾在地面範圍內 */
export function snapColumn(centerUnits: number, shape: BlockShape, cols: number): number {
  const { w } = BLOCK_SIZE[shape]
  return Math.max(0, Math.min(Math.max(0, cols - w), Math.round(centerUnits - w / 2)))
}

/** 落點高度：正下方（水平有重疊的）最高那塊的上緣；沒有就是地面 */
export function dropY(blocks: readonly Pick<Block, 'shape' | 'x' | 'y'>[], shape: BlockShape, x: number): number {
  const { w } = BLOCK_SIZE[shape]
  let y = 0
  for (const b of blocks) {
    const s = BLOCK_SIZE[b.shape]
    if (overlapX(x, w, b.x, s.w)) y = Math.max(y, b.y + s.h)
  }
  return y
}

/** 塔頂高度（格）：最高那塊的上緣；沒有積木是 0 */
export function towerTop(blocks: readonly Pick<Block, 'shape' | 'y'>[]): number {
  return blocks.reduce((m, b) => Math.max(m, b.y + BLOCK_SIZE[b.shape].h), 0)
}

/** 最高那塊（寵物要爬上去站的）；一樣高取最後放的 */
export function topBlock<T extends Pick<Block, 'shape' | 'y'>>(blocks: readonly T[]): T | null {
  let best: T | null = null
  for (const b of blocks) if (!best || b.y + BLOCK_SIZE[b.shape].h >= best.y + BLOCK_SIZE[best.shape].h) best = b
  return best
}

/**
 * 重新落下：拿走中間一塊時，上面的往下掉到新的支撐上。
 * 由低到高（一樣高照 id）一塊一塊重新放，結果跟放的順序無關、純粹由位置決定。
 */
export function settle<T extends Block>(blocks: readonly T[]): T[] {
  const order = [...blocks].sort((a, b) => a.y - b.y || a.id - b.id)
  const out: T[] = []
  for (const b of order) out.push({ ...b, y: dropY(out, b.shape, b.x) })
  return blocks.map((b) => out.find((o) => o.id === b.id)!)
}

/** 畫面裝得下幾格高時，塔（加上站在頂上的寵物）要縮成多少；不會小於 MIN_VIEW_SCALE */
export function viewScale(top: number, visibleRows: number): number {
  if (visibleRows <= 0) return 1
  return Math.max(MIN_VIEW_SCALE, Math.min(1, visibleRows / (top + PET_ROWS)))
}

/** 最多可以蓋到幾格高：縮到最小時，塔頂加寵物剛好裝得下 */
export const maxRows = (visibleRows: number): number => Math.max(4, Math.floor(visibleRows / MIN_VIEW_SCALE) - PET_ROWS)

/** 放得下嗎（放上去後不超過最高層） */
export function canPlace(blocks: readonly Pick<Block, 'shape' | 'x' | 'y'>[], shape: BlockShape, x: number, limitRows: number): boolean {
  return dropY(blocks, shape, x) + BLOCK_SIZE[shape].h <= limitRows
}

/** 點一下（不拖）放在哪一格：地面正中間，一直點就疊成一座塔（3 歲最愛） */
export function autoColumn(shape: BlockShape, cols: number): number {
  return Math.max(0, Math.floor((cols - BLOCK_SIZE[shape].w) / 2))
}

export interface Scattered {
  id: number
  /** 落地後的左邊格子 */
  x: number
  /** 落地後的旋轉角度（度） */
  rot: number
  /** 飛起來的最高點（格，畫動畫用） */
  lift: number
}

/**
 * 推倒：積木從塔的中線往兩邊彈開、躺在地上。越高的飛越遠，角度固定（不靠亂數），會夾在地面範圍內。
 */
export function scatter(blocks: readonly Block[], cols: number): Scattered[] {
  if (!blocks.length) return []
  const center = blocks.reduce((s, b) => s + b.x + BLOCK_SIZE[b.shape].w / 2, 0) / blocks.length
  return blocks.map((b, i) => {
    const { w } = BLOCK_SIZE[b.shape]
    const cx = b.x + w / 2
    const dir = cx < center - 0.01 ? -1 : cx > center + 0.01 ? 1 : i % 2 ? 1 : -1
    const dist = 1.5 + b.y * 0.7 + (i % 3) * 0.6
    // 長的積木歪一點點就很明顯，轉太多會甩出地面
    const rot = Math.round(dir * (10 + ((i * 37) % 26)) * (w >= 4 ? 0.55 : 1))
    // 往左倒以左下角為軸、往右倒以右下角為軸：上緣會往外多伸出 h·sin(角度)，要留在地面範圍內
    const reach = Math.ceil(BLOCK_SIZE[b.shape].h * Math.sin((Math.abs(rot) * Math.PI) / 180) * 2) / 2
    const lo = rot < 0 ? reach : 0
    const hi = Math.max(lo, cols - w - (rot > 0 ? reach : 0))
    const x = Math.max(lo, Math.min(hi, Math.round((b.x + dir * dist) * 2) / 2))
    return { id: b.id, x, rot, lift: 1 + b.y * 0.35 }
  })
}

// ---------- 6–7 歲：照著蓋 ----------

export interface PlanBlock {
  shape: BlockShape
  x: number
  y: number
}
export interface Blueprint {
  id: string
  blocks: PlanBlock[]
}

/** 固定幾張藍圖（3–5 塊），最寬 8 格：手機也蓋得下。每張都是「照順序放就會自然疊成這樣」的形狀 */
export const BLUEPRINTS: readonly Blueprint[] = [
  {
    id: 'house',
    blocks: [
      { shape: 'cube', x: 0, y: 0 },
      { shape: 'cube', x: 2, y: 0 },
      { shape: 'roof', x: 0, y: 2 },
    ],
  },
  {
    id: 'gate',
    blocks: [
      { shape: 'arch', x: 0, y: 0 },
      { shape: 'long', x: 0, y: 2 },
      { shape: 'half', x: 0, y: 3 },
    ],
  },
  {
    id: 'tower',
    blocks: [
      { shape: 'cube', x: 1, y: 0 },
      { shape: 'cyl', x: 1, y: 2 },
      { shape: 'long', x: 0, y: 5 },
      { shape: 'roof', x: 0, y: 6 },
    ],
  },
  {
    id: 'bridge',
    blocks: [
      { shape: 'cube', x: 0, y: 0 },
      { shape: 'cube', x: 4, y: 0 },
      { shape: 'long', x: 1, y: 2 },
      { shape: 'half', x: 1, y: 3 },
    ],
  },
  {
    id: 'castle',
    blocks: [
      { shape: 'cyl', x: 0, y: 0 },
      { shape: 'arch', x: 2, y: 0 },
      { shape: 'cyl', x: 6, y: 0 },
      { shape: 'long', x: 2, y: 2 },
      { shape: 'roof', x: 2, y: 3 },
    ],
  },
]

/** 本地日期（YYYY-MM-DD）換成第幾天，給固定輪替用 */
const dayNumber = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86400000)
}

/** 今天的藍圖：依日期輪替；同一天蓋好一張（round + 1）換下一張 */
export function blueprintFor(date: string, round = 0): Blueprint {
  const n = BLUEPRINTS.length
  return BLUEPRINTS[(((dayNumber(date) + round) % n) + n) % n]
}

/** 兩塊有沒有碰在一起（上下疊著，或左右貼著） */
function touching(a: PlanBlock, b: PlanBlock): boolean {
  const A = BLOCK_SIZE[a.shape]
  const B = BLOCK_SIZE[b.shape]
  const stacked = (a.y + A.h === b.y || b.y + B.h === a.y) && overlapX(a.x, A.w, b.x, B.w)
  const side = (a.x + A.w === b.x || b.x + B.w === a.x) && overlapY(a.y, A.h, b.y, B.h)
  return stacked || side
}

/** 把積木分成一群一群（碰在一起的算同一群） */
export function groups<T extends PlanBlock>(blocks: readonly T[]): T[][] {
  const seen = new Set<number>()
  const out: T[][] = []
  for (let i = 0; i < blocks.length; i++) {
    if (seen.has(i)) continue
    const g: T[] = []
    const stack = [i]
    seen.add(i)
    while (stack.length) {
      const k = stack.pop()!
      g.push(blocks[k])
      for (let j = 0; j < blocks.length; j++) {
        if (!seen.has(j) && touching(blocks[k], blocks[j])) {
          seen.add(j)
          stack.push(j)
        }
      }
    }
    out.push(g)
  }
  return out
}

const signature = (blocks: readonly PlanBlock[]): string => {
  const minX = Math.min(...blocks.map((b) => b.x))
  const minY = Math.min(...blocks.map((b) => b.y))
  return blocks
    .map((b) => `${b.shape}@${b.x - minX},${b.y - minY}`)
    .sort()
    .join('|')
}

/**
 * 照著蓋：地上有一群積木跟藍圖一樣（形狀相同、相對位置相同，顏色不管、整群左右平移不管）就算。
 * 旁邊另外蓋的東西不影響；但同一群多了或少了一塊就不算。
 */
export function matchesBlueprint(blocks: readonly PlanBlock[], plan: Blueprint): boolean {
  if (blocks.length < plan.blocks.length) return false
  const want = signature(plan.blocks)
  return groups(blocks).some((g) => g.length === plan.blocks.length && signature(g) === want)
}

// ---------- v8.5 一回合只算一次 ----------

/** 一直蓋不推倒也算玩完：這一回合一共放了幾塊（推倒或照著蓋好會更早） */
export const FINISH_PLACED = 8

/**
 * 一回合：從地上空空的開始蓋，到推倒（或把積木全部收回盤子）為止。
 * 一回合裡「推倒、照著蓋好、放滿 8 塊」不管發生幾樣，只算玩完一次。
 */
export interface BuildRound {
  /** 這一回合放了幾塊 */
  placed: number
  /** 這一回合已經算過玩完了 */
  done: boolean
}
export const newRound = (): BuildRound => ({ placed: 0, done: false })

/**
 * place：放了一塊新的；crash：推倒；match：照著蓋好；empty：地上沒有積木了（推倒之後，或全部拖回盤子）。
 * 回傳新的回合狀態，以及這一下要不要呼叫 finish()。
 */
export function roundEvent(r: BuildRound, ev: 'place' | 'crash' | 'match' | 'empty'): { round: BuildRound; finish: boolean } {
  if (ev === 'empty') return { round: r.done ? newRound() : r, finish: false }
  const placed = ev === 'place' ? r.placed + 1 : r.placed
  const hit = ev === 'place' ? placed === FINISH_PLACED : true
  const finish = hit && !r.done
  return { round: { placed, done: r.done || finish }, finish }
}

// ---------- v8.5 新玩具「住戶」 ----------

/** 塔蓋到幾格高，第一隻小動物搬進來 */
export const TENANT_ROWS = 4
/** 之後每多幾格再來一隻 */
export const TENANT_STEP = 3
/** 依序搬進來的小動物 */
export const TENANTS = ['obj-chick', 'obj-rabbit', 'obj-bear'] as const
export const TENANT_EMOJI: Record<string, string> = { 'obj-chick': '🐥', 'obj-rabbit': '🐰', 'obj-bear': '🐻' }

/** 塔這麼高的時候該有幾位住戶（0–3） */
export function tenantCount(top: number): number {
  if (top < TENANT_ROWS) return 0
  return Math.min(TENANTS.length, 1 + Math.floor((top - TENANT_ROWS) / TENANT_STEP))
}

/** 這塊積木住得下小動物嗎：至少 2 格高（長條太扁）、不是旗子（只有一根桿子） */
const roomy = (shape: BlockShape): boolean => BLOCK_SIZE[shape].h >= 2 && shape !== 'flag'

/**
 * 每位住戶住在哪一塊積木裡（回傳積木 id；-1 = 現在沒有房間，先不出來）。
 * 寵物站的最高那塊不住（牠的腳踩在那裡）。已經住下的不搬家，除非那塊被拿走或變成最高的；
 * 新來的住最低的空房間（一樣高照 id），所以結果只看積木怎麼擺，不靠亂數。
 */
export function assignTenants(prev: readonly number[], blocks: readonly Block[], count: number): number[] {
  const topId = topBlock(blocks)?.id ?? -1
  const rooms = blocks.filter((b) => b.id !== topId && roomy(b.shape)).sort((a, b) => a.y - b.y || a.id - b.id)
  const out: number[] = []
  const taken = new Set<number>()
  for (let i = 0; i < count; i++) {
    const keep = prev[i] !== undefined && prev[i] >= 0 && !taken.has(prev[i]) && rooms.some((b) => b.id === prev[i])
    out.push(keep ? prev[i] : -1)
    if (keep) taken.add(prev[i])
  }
  for (let i = 0; i < count; i++) {
    if (out[i] >= 0) continue
    const free = rooms.find((b) => !taken.has(b.id))
    if (!free) continue
    out[i] = free.id
    taken.add(free.id)
  }
  return out
}
