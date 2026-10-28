import { describe, expect, it } from 'vitest'
import { BRUSH_KINDS, drawStroke, hash01, kindOf, previewStroke, rainbowColor, RAINBOW_PERIOD, sampleAlong, seedOf, STAMPS } from './brushes'
import { BRUSH_WIDTHS, ERASER_WIDTHS, freeStickerSpot, mirrorStroke, mirrorX, MIRROR_X } from '../../domain/coloring'
import type { BrushKind, ColoringStroke } from '../../domain/types'

/** 假的 2D context：把每一次呼叫與屬性設定記下來，用來比較「畫了什麼」 */
function recorder() {
  const log: string[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop in state) return state[prop]
        if (prop === 'createLinearGradient') return () => ({ addColorStop: () => undefined })
        return (...args: unknown[]) => {
          log.push(`${prop}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join(',')})`)
        }
      },
      set(_t, prop: string, v: unknown) {
        state[prop] = v
        log.push(`${prop}=${typeof v === 'number' ? v.toFixed(3) : String(v)}`)
        return true
      },
    },
  ) as unknown as CanvasRenderingContext2D
  return { ctx, log }
}

const stroke = (kind: BrushKind, id = 'abc123', extra: Partial<ColoringStroke> = {}): ColoringStroke => ({
  id,
  color: '#e96a6a',
  kind,
  width: 14,
  points: [
    [40, 40],
    [90, 70],
    [140, 60],
    [200, 120],
    [260, 100],
  ],
  ...extra,
})
const run = (s: ColoringStroke, px = 600) => {
  const r = recorder()
  drawStroke(r.ctx, s, px)
  return r.log
}

describe('筆刷：決定性', () => {
  it.each(BRUSH_KINDS.map((k) => k.kind))('%s：同一筆畫兩次，結果完全一樣', (kind) => {
    const a = run(stroke(kind, 'seed-1', kind === 'stamp' ? { stamp: 'heart' } : {}))
    const b = run(stroke(kind, 'seed-1', kind === 'stamp' ? { stamp: 'heart' } : {}))
    expect(a.length).toBeGreaterThan(3)
    expect(a).toEqual(b)
  })

  it.each(['crayon', 'glitter', 'stamp'] as BrushKind[])('%s：不同的 stroke.id 有不同的圖樣（隨機來自 id）', (kind) => {
    expect(run(stroke(kind, 'aaa'))).not.toEqual(run(stroke(kind, 'bbb')))
  })

  it('不靠 Math.random：把它換成會丟錯的函式，照樣畫得出來、結果相同', () => {
    const orig = Math.random
    const expected = BRUSH_KINDS.map((k) => run(stroke(k.kind)))
    Math.random = () => {
      throw new Error('不該用到 Math.random')
    }
    try {
      expect(BRUSH_KINDS.map((k) => run(stroke(k.kind)))).toEqual(expected)
    } finally {
      Math.random = orig
    }
  })

  it('沒有 kind 的舊筆畫視為鉛筆，畫出來與 kind: pen 一樣', () => {
    const legacy: ColoringStroke = stroke('pen')
    delete legacy.kind
    expect(kindOf(legacy)).toBe('pen')
    expect(run(legacy)).toEqual(run(stroke('pen')))
  })

  it('畫完會還原 ctx 的狀態（save / restore 成對）', () => {
    for (const k of BRUSH_KINDS) {
      const log = run(stroke(k.kind))
      expect(log.filter((l) => l.startsWith('save(')).length).toBe(log.filter((l) => l.startsWith('restore(')).length)
    }
  })

  it('沒有點的筆畫什麼都不畫；單點（點一下）也畫得出來', () => {
    expect(run(stroke('crayon', 'x', { points: [] }))).toEqual([])
    for (const k of BRUSH_KINDS) expect(run(stroke(k.kind, 'dot', { points: [[100, 100]] })).length).toBeGreaterThan(2)
  })

  it('每種筆刷畫出來的東西不同（不是全部都退回鉛筆）', () => {
    const logs = BRUSH_KINDS.map((k) => run(stroke(k.kind)).join('|'))
    expect(new Set(logs).size).toBe(BRUSH_KINDS.length)
  })

  it('解析度不同只是比例不同：操作的種類與數量相同', () => {
    const shape = (l: string[]) => l.map((x) => x.split('(')[0].split('=')[0])
    expect(shape(run(stroke('crayon'), 300))).toEqual(shape(run(stroke('crayon'), 1200)))
  })

  it('印章：5 種圖案都畫得出來，且彼此不同', () => {
    const logs = STAMPS.map((st) => run(stroke('stamp', 'st', { stamp: st.key })).join('|'))
    expect(new Set(logs).size).toBe(STAMPS.length)
    // 不認得的圖案退回星星
    expect(run(stroke('stamp', 'st', { stamp: 'nope' }))).toEqual(run(stroke('stamp', 'st', { stamp: 'star' })))
  })

  it('亮粉：底色之外還有閃點；蠟筆：有很多顆粒', () => {
    expect(run(stroke('glitter')).filter((l) => l.startsWith('fill(')).length).toBeGreaterThan(10)
    expect(run(stroke('crayon')).filter((l) => l.startsWith('arc(')).length).toBeGreaterThan(100)
  })

  it('麥克筆半透明、霓虹有白色芯', () => {
    expect(run(stroke('marker')).some((l) => l === 'globalAlpha=0.500')).toBe(true)
    expect(run(stroke('neon')).some((l) => l === 'strokeStyle=#ffffff')).toBe(true)
  })

  it('previewStroke：圖示用的示範筆觸每種都能畫', () => {
    for (const k of BRUSH_KINDS) expect(run(previewStroke(k.kind, '#4a9fe0', 'flower')).length).toBeGreaterThan(3)
  })
})

describe('筆刷：取樣與彩虹', () => {
  it('sampleAlong 與點是怎麼分段進來的無關（一段 vs 切成很多小段，取樣點相同）', () => {
    const coarse: [number, number][] = [
      [0, 0],
      [100, 0],
    ]
    const fine: [number, number][] = Array.from({ length: 101 }, (_, i) => [i, 0])
    const a = sampleAlong(coarse, 7)
    const b = sampleAlong(fine, 7)
    expect(b.length).toBe(a.length)
    a.forEach((p, i) => {
      expect(b[i].x).toBeCloseTo(p.x, 6)
      expect(b[i].t).toBeCloseTo(p.t, 6)
    })
  })

  it('sampleAlong：第一個點一定取、間距固定、單點只有一個樣本', () => {
    const s = sampleAlong([[0, 0], [30, 40]], 10)
    expect(s[0]).toMatchObject({ x: 0, y: 0, i: 0, t: 0 })
    expect(s).toHaveLength(6) // 長度 50 → 0,10,…,50
    expect(s[5].t).toBeCloseTo(50, 6)
    expect(sampleAlong([[5, 5]], 10)).toHaveLength(1)
    expect(sampleAlong([], 10)).toEqual([])
  })

  it('彩虹：顏色依路徑長度轉色相，走一圈回到原色', () => {
    expect(rainbowColor(0)).toBe(rainbowColor(RAINBOW_PERIOD))
    expect(rainbowColor(0)).not.toBe(rainbowColor(RAINBOW_PERIOD / 3))
    expect(rainbowColor(RAINBOW_PERIOD / 2)).toBe('hsl(180 92% 62%)')
  })

  it('彩虹筆畫出來的顏色不只一種', () => {
    const colors = new Set(run(stroke('rainbow')).filter((l) => l.startsWith('strokeStyle=')))
    expect(colors.size).toBeGreaterThan(2)
  })

  it('hash01 在 [0,1)，同輸入同輸出，不同輸入大致不同', () => {
    const seed = seedOf('x')
    const vals = Array.from({ length: 200 }, (_, i) => hash01(seed, i, 3))
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true)
    expect(hash01(seed, 5, 6)).toBe(hash01(seed, 5, 6))
    expect(new Set(vals).size).toBeGreaterThan(190)
    expect(seedOf('a')).not.toBe(seedOf('b'))
  })
})

describe('鏡像', () => {
  it('mirrorX：以座標空間正中間（200）為軸左右翻', () => {
    expect(MIRROR_X).toBe(200)
    expect(mirrorX(50)).toBe(350)
    expect(mirrorX(200)).toBe(200)
    expect(mirrorX(mirrorX(123))).toBe(123)
  })

  it('mirrorStroke：點的 x 翻轉、y 不變；顏色、粗細、筆刷種類、印章都保留；是獨立的新筆（新 id）', () => {
    const s = stroke('stamp', 'orig', { stamp: 'paw' })
    const m = mirrorStroke(s, 'twin')
    expect(m.id).toBe('twin')
    expect(m.points).toEqual(s.points.map(([x, y]) => [400 - x, y]))
    expect(m).toMatchObject({ color: s.color, width: s.width, kind: 'stamp', stamp: 'paw' })
    // 不會動到原本那一筆
    expect(s.id).toBe('orig')
    expect(s.points[0]).toEqual([40, 40])
  })

  it('對稱的兩筆畫在畫布上互為左右鏡像（鉛筆，畫布正中間為軸）', () => {
    const s = stroke('pen', 'p1')
    const m = mirrorStroke(s, 'p2')
    const xs = (st: ColoringStroke) => run(st, 416).filter((l) => l.startsWith('lineTo(') || l.startsWith('moveTo(')).map((l) => Number(l.slice(l.indexOf('(') + 1).split(',')[0]))
    const a = xs(s)
    const b = xs(m)
    expect(a).toHaveLength(b.length)
    // 畫布 = 416 px，viewBox 起點 -8：座標 x → x + 8；鏡像軸 x = 200 → 208 = 畫布正中間
    a.forEach((x, i) => expect(x + b[i]).toBeCloseTo(416, 2))
  })
})

describe('試玩審查：平滑、橡皮擦、粗筆上限、貼紙位置', () => {
  it('路徑用 quadratic 平滑（取相鄰點的中點當端點），鉛筆、麥克筆、霓虹都是', () => {
    for (const k of ['pen', 'marker', 'neon', 'glitter'] as BrushKind[]) {
      const log = run(stroke(k))
      expect(log.some((l) => l.startsWith('quadraticCurveTo('))).toBe(true)
    }
    // 只有兩個點就是一條直線，不需要曲線
    expect(run(stroke('pen', 'two', { points: [[0, 0], [50, 50]] })).some((l) => l.startsWith('quadraticCurveTo('))).toBe(false)
  })
  it('平滑的終點是最後一個點（不會縮短線）', () => {
    const log = run(stroke('pen', 'e', { points: [[0, 0], [100, 0], [200, 100]] }), 416)
    const last = log.filter((l) => l.startsWith('lineTo(')).pop()!
    expect(last).toBe('lineTo(208.000,108.000)')
  })
  it('橡皮擦（kind erase）用 destination-out，只擦圖層，畫完會還原合成模式', () => {
    const log = run(stroke('erase', 'er', { color: '#000000', width: 28 }))
    expect(log.some((l) => l === 'globalCompositeOperation=destination-out')).toBe(true)
    expect(log.filter((l) => l.startsWith('save(')).length).toBe(log.filter((l) => l.startsWith('restore(')).length)
    expect(run(stroke('erase', 'er'))).toEqual(run(stroke('erase', 'er')))
  })
  it('粗筆上限約 18；橡皮擦比畫筆大', () => {
    expect(BRUSH_WIDTHS.l).toBeLessThanOrEqual(18)
    expect(BRUSH_WIDTHS.s).toBeLessThan(BRUSH_WIDTHS.m)
    expect(BRUSH_WIDTHS.m).toBeLessThan(BRUSH_WIDTHS.l)
    expect(ERASER_WIDTHS.s).toBeGreaterThan(BRUSH_WIDTHS.s)
  })
  it('新貼紙：第一張在正中央，之後一張一張錯開，彼此至少相距 70', () => {
    const placed: { x: number; y: number }[] = []
    for (let i = 0; i < 12; i++) {
      const [x, y] = freeStickerSpot(placed)
      if (i === 0) expect([x, y]).toEqual([200, 200])
      for (const p of placed) expect(Math.hypot(p.x - x, p.y - y)).toBeGreaterThanOrEqual(70)
      placed.push({ x, y })
    }
    expect(freeStickerSpot([])).toEqual([200, 200])
    // 位置都在畫面內
    expect(placed.every((p) => p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 400)).toBe(true)
  })
  it('貼紙位置滿了也不會當掉（挑離最近貼紙最遠的位置）', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ x: (i * 37) % 400, y: (i * 91) % 400 }))
    const [x, y] = freeStickerSpot(many)
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
  })
})
