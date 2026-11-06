import { describe, expect, it } from 'vitest'
import {
  BLOCK_SHAPES,
  BLOCK_SIZE,
  BLUEPRINTS,
  MIN_VIEW_SCALE,
  PET_ROWS,
  autoColumn,
  blueprintFor,
  canPlace,
  dropY,
  groups,
  matchesBlueprint,
  maxRows,
  scatter,
  settle,
  snapColumn,
  topBlock,
  towerTop,
  viewScale,
  type Block,
} from './blocks'

let nid = 1
const blk = (shape: Block['shape'], x: number, y = 0): Block => ({ id: nid++, shape, color: 'coral', x, y })
/** 照順序一塊一塊放下去（跟遊戲裡一樣） */
const build = (steps: [Block['shape'], number][]): Block[] => {
  const out: Block[] = []
  for (const [shape, x] of steps) out.push(blk(shape, x, dropY(out, shape, x)))
  return out
}

describe('積木：對齊格線', () => {
  it('手指在積木中間，換算成左邊的格子並四捨五入', () => {
    expect(snapColumn(5, 'cube', 16)).toBe(4)
    expect(snapColumn(5.4, 'cube', 16)).toBe(4)
    expect(snapColumn(5.6, 'cube', 16)).toBe(5)
    expect(snapColumn(6, 'long', 16)).toBe(4)
  })
  it('不會超出地面', () => {
    expect(snapColumn(-3, 'long', 10)).toBe(0)
    expect(snapColumn(99, 'long', 10)).toBe(6)
    expect(snapColumn(99, 'cube', 8)).toBe(6)
  })
})

describe('積木：落在正下方最高那塊上面', () => {
  it('空地落在地面', () => {
    expect(dropY([], 'cube', 3)).toBe(0)
  })
  it('疊在下面那塊上面，只看水平有重疊的', () => {
    const a = blk('cube', 2)
    expect(dropY([a], 'cube', 2)).toBe(2)
    expect(dropY([a], 'cube', 3)).toBe(2)
    expect(dropY([a], 'cube', 4)).toBe(0) // 剛好貼著旁邊，不算在上面
    expect(dropY([a], 'cube', 0)).toBe(0)
  })
  it('橫跨兩座塔時落在比較高的那座上面', () => {
    const t = build([
      ['cube', 0],
      ['cyl', 4],
    ])
    expect(dropY(t, 'long', 1)).toBe(3)
  })
  it('一直放在同一格就疊高，塔頂與最高那塊', () => {
    const t = build([
      ['cube', 4],
      ['cube', 4],
      ['long', 3],
    ])
    expect(t.map((b) => b.y)).toEqual([0, 2, 4])
    expect(towerTop(t)).toBe(5)
    expect(topBlock(t)?.shape).toBe('long')
    expect(towerTop([])).toBe(0)
    expect(topBlock([])).toBeNull()
  })
})

describe('積木：拿走中間那塊，上面的往下掉', () => {
  it('重新落下只看位置', () => {
    const t = build([
      ['cube', 4],
      ['cube', 4],
      ['cube', 4],
    ])
    const after = settle(t.filter((_, i) => i !== 1))
    expect(after.map((b) => b.y)).toEqual([0, 2])
  })
  it('還有其他支撐的就不掉', () => {
    const t = build([
      ['cube', 0],
      ['cube', 2],
      ['long', 0],
    ])
    const after = settle(t.filter((_, i) => i !== 0))
    expect(after.find((b) => b.shape === 'long')!.y).toBe(2)
  })
  it('已經穩的不會變', () => {
    const t = build([
      ['arch', 0],
      ['long', 0],
      ['roof', 0],
    ])
    expect(settle(t)).toEqual(t)
  })
})

describe('積木：塔太高就縮小，再高就不給放', () => {
  it('裝得下時不縮', () => {
    expect(viewScale(0, 10)).toBe(1)
    expect(viewScale(10 - PET_ROWS, 10)).toBe(1)
  })
  it('高了就縮，但不小於下限', () => {
    expect(viewScale(17, 10)).toBe(0.5)
    expect(viewScale(12, 10)).toBeCloseTo(10 / 15)
    expect(viewScale(100, 10)).toBe(MIN_VIEW_SCALE)
  })
  it('最高層數：縮到最小時塔頂加寵物剛好裝得下', () => {
    const rows = maxRows(10)
    expect(rows).toBe(17)
    expect((rows + PET_ROWS) * MIN_VIEW_SCALE).toBeLessThanOrEqual(10)
    const t = build([
      ['cyl', 0],
      ['cyl', 0],
      ['cyl', 0],
      ['cyl', 0],
      ['cyl', 0],
    ])
    expect(canPlace(t, 'cube', 0, rows)).toBe(true) // 15 + 2 = 17
    expect(canPlace(t, 'cyl', 0, rows)).toBe(false) // 15 + 3 = 18
    expect(canPlace(t, 'cyl', 6, rows)).toBe(true) // 旁邊空地可以
  })
})

describe('積木：點一下放在中間', () => {
  it('每種形狀都在地面中間、不超出', () => {
    for (const s of BLOCK_SHAPES) {
      const x = autoColumn(s, 9)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x + BLOCK_SIZE[s].w).toBeLessThanOrEqual(9)
    }
    expect(autoColumn('cube', 16)).toBe(7)
  })
})

describe('積木：推倒', () => {
  const t = build([
    ['cube', 6],
    ['cube', 6],
    ['long', 5],
    ['roof', 5],
    ['cube', 2],
  ])
  const s = scatter(t, 16)
  it('每塊都有結果，固定不靠亂數', () => {
    expect(s.map((x) => x.id)).toEqual(t.map((b) => b.id))
    expect(scatter(t, 16)).toEqual(s)
  })
  it('倒下後（含轉過去伸出來的角）都留在地面範圍內', () => {
    const tall = build(Array.from({ length: 6 }, () => ['cyl', 3] as [Block['shape'], number]))
    for (const [blocks, cols] of [
      [t, 16],
      [tall, 8],
    ] as const)
      for (const x of scatter(blocks, cols)) {
        const b = blocks.find((b) => b.id === x.id)!
        const { w, h } = BLOCK_SIZE[b.shape]
        const reach = h * Math.sin((Math.abs(x.rot) * Math.PI) / 180)
        expect(x.x - (x.rot < 0 ? reach : 0)).toBeGreaterThanOrEqual(-1e-9)
        expect(x.x + w + (x.rot > 0 ? reach : 0)).toBeLessThanOrEqual(cols + 1e-9)
      }
  })
  it('往外彈開：中線左邊的往左、右邊的往右，有歪', () => {
    const left = s.find((x) => x.id === t[4].id)!
    expect(left.x).toBeLessThan(t[4].x)
    expect(left.rot).toBeLessThan(0)
    for (const x of s) {
      const b = t.find((b) => b.id === x.id)!
      expect(Math.abs(x.rot)).toBeGreaterThanOrEqual(5)
      expect(Math.abs(x.rot)).toBeLessThanOrEqual(BLOCK_SIZE[b.shape].w >= 4 ? 20 : 35)
    }
  })
  it('越高飛越高', () => {
    expect(s[3].lift).toBeGreaterThan(s[0].lift)
  })
  it('沒有積木就沒有東西', () => {
    expect(scatter([], 16)).toEqual([])
  })
})

describe('照著蓋：藍圖', () => {
  it('每張 3–5 塊、最寬 8 格（手機也蓋得下）', () => {
    for (const p of BLUEPRINTS) {
      expect(p.blocks.length).toBeGreaterThanOrEqual(3)
      expect(p.blocks.length).toBeLessThanOrEqual(5)
      const right = Math.max(...p.blocks.map((b) => b.x + BLOCK_SIZE[b.shape].w))
      expect(Math.min(...p.blocks.map((b) => b.x))).toBe(0)
      expect(right).toBeLessThanOrEqual(8)
    }
  })
  it('照順序放就會自然疊成藍圖的樣子（藍圖蓋得出來）', () => {
    for (const p of BLUEPRINTS) {
      const built = build(p.blocks.map((b) => [b.shape, b.x]))
      expect(built.map((b) => b.y)).toEqual(p.blocks.map((b) => b.y))
      expect(matchesBlueprint(built, p)).toBe(true)
    }
  })
  it('每張藍圖是一整群', () => {
    for (const p of BLUEPRINTS) expect(groups(p.blocks)).toHaveLength(1)
  })
  it('依日期輪替，同一天蓋好換下一張', () => {
    const ids = new Set<string>()
    for (let d = 1; d <= BLUEPRINTS.length; d++) ids.add(blueprintFor(`2026-11-${String(d).padStart(2, '0')}`).id)
    expect(ids.size).toBe(BLUEPRINTS.length)
    expect(blueprintFor('2026-11-06')).toEqual(blueprintFor('2026-11-06'))
    expect(blueprintFor('2026-11-06', 1)).toEqual(blueprintFor('2026-11-07'))
    expect(blueprintFor('2026-12-31', 0).id).not.toBe(blueprintFor('2027-01-01', 0).id)
  })
})

describe('照著蓋：比對', () => {
  const house = BLUEPRINTS.find((b) => b.id === 'house')!
  it('整群左右平移、換顏色都算', () => {
    const t = build([
      ['cube', 7],
      ['cube', 9],
      ['roof', 7],
    ]).map((b, i) => ({ ...b, color: (['sun', 'leaf', 'sky'] as const)[i] }))
    expect(matchesBlueprint(t, house)).toBe(true)
  })
  it('旁邊另外蓋的東西不影響', () => {
    const t = build([
      ['cube', 0],
      ['cube', 2],
      ['roof', 0],
      ['cyl', 10],
      ['cyl', 10],
    ])
    expect(matchesBlueprint(t, house)).toBe(true)
  })
  it('位置錯一格、形狀不同、多一塊或少一塊都不算', () => {
    expect(
      matchesBlueprint(
        build([
          ['cube', 0],
          ['cube', 2],
          ['roof', 1],
        ]),
        house,
      ),
    ).toBe(false)
    expect(
      matchesBlueprint(
        build([
          ['cube', 0],
          ['cube', 2],
          ['half', 0],
        ]),
        house,
      ),
    ).toBe(false)
    expect(
      matchesBlueprint(
        build([
          ['cube', 0],
          ['cube', 2],
          ['roof', 0],
          ['cube', 4],
        ]),
        house,
      ),
    ).toBe(false)
    expect(
      matchesBlueprint(
        build([
          ['cube', 0],
          ['cube', 2],
        ]),
        house,
      ),
    ).toBe(false)
  })
  it('兩塊分開沒碰到不是同一群', () => {
    expect(groups([blk('cube', 0), blk('cube', 3)])).toHaveLength(2)
    expect(groups([blk('cube', 0), blk('cube', 2)])).toHaveLength(1)
  })
})
