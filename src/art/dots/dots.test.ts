import { describe, expect, it } from 'vitest'
import {
  DOTS_FREE_COUNT,
  DOTS_IDS,
  DOTS_LEVELS,
  DOTS_LINES,
  DOTS_NAMES,
  DOTS_PRICE,
  defaultDotsLevel,
  dotLabel,
  dotsItem,
  dotsItemId,
  dotsPageId,
  dotsPoints,
  hitDot,
  isClockwise,
  isDotsFree,
  labelBox,
  parseDotsId,
  placeLabels,
  polyLength,
  silhouettePath,
  smoothClosedPath,
  tapDot,
  type LabelBox,
  type Pt,
} from './dots'
import { STATIC_LINES, allLines, chineseNumber } from '../../learning/lines'
import { englishLines } from '../../learning/english'
import { getColoringPage } from '../coloring/pages'

const distToPoly = (p: Pt, poly: Pt[]): number => {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const vx = b[0] - a[0]
    const vy = b[1] - a[1]
    const l2 = vx * vx + vy * vy || 1
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2))
    best = Math.min(best, Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t)))
  }
  return best
}

describe('連連看：點位資料（gen_dots.py 的輸出）', () => {
  it('至少 12 張，每張都有名字、輪廓與四種關卡', () => {
    expect(DOTS_IDS.length).toBeGreaterThanOrEqual(12)
    for (const id of DOTS_IDS) {
      expect(DOTS_NAMES[id], id).toBeTruthy()
      const it = dotsItem(id)!
      expect(it.outline.length, id).toBeGreaterThanOrEqual(120)
      expect(it.img[2], id).toBeGreaterThan(0)
    }
  })
  it('點數正確：簡單 10、中等 20、挑戰 30、字母 26', () => {
    for (const id of DOTS_IDS) for (const l of DOTS_LEVELS) expect(dotsPoints(id, l.id), `${id}:${l.id}`).toHaveLength(l.n)
    expect(DOTS_LEVELS.map((l) => l.n)).toEqual([10, 20, 30, 26])
  })
  it('座標都在 0–400 內；點落在輪廓上；輪廓與點都是順時針、從最上方開始', () => {
    for (const id of DOTS_IDS) {
      const it = dotsItem(id)!
      expect(isClockwise(it.outline), `${id} outline`).toBe(true)
      const top = Math.min(...it.outline.map((p) => p[1]))
      expect(it.outline[0][1] - top, `${id} 起點在最上方`).toBeLessThan(2)
      for (const l of DOTS_LEVELS) {
        const pts = dotsPoints(id, l.id)
        expect(isClockwise(pts), `${id}:${l.id}`).toBe(true)
        expect(pts[0][1] - top, `${id}:${l.id} 第一點在最上方`).toBeLessThan(2)
        for (const p of pts) {
          expect(p[0]).toBeGreaterThanOrEqual(0)
          expect(p[0]).toBeLessThanOrEqual(400)
          expect(p[1]).toBeGreaterThanOrEqual(0)
          expect(p[1]).toBeLessThanOrEqual(400)
          expect(distToPoly(p, it.outline), `${id}:${l.id} 點在輪廓上`).toBeLessThan(1.5)
        }
      }
    }
  })
  it('相鄰點的距離平均：沒有擠在一起、也沒有空一大段（轉角處可以稍微密一點）', () => {
    for (const id of DOTS_IDS) {
      for (const l of DOTS_LEVELS) {
        const pts = dotsPoints(id, l.id)
        const per = polyLength(pts)
        const avg = per / pts.length
        const gaps = pts.map((p, i) => Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]))
        expect(Math.min(...gaps), `${id}:${l.id} 最小間距`).toBeGreaterThan(avg * 0.25)
        expect(Math.max(...gaps), `${id}:${l.id} 最大間距`).toBeLessThan(avg * 2.6)
      }
    }
  })
  it('圖與輪廓對齊：圖放在 0–400 裡面，輪廓都在圖的範圍內', () => {
    for (const id of DOTS_IDS) {
      const it = dotsItem(id)!
      const [x, y, w, h] = it.img
      expect(x).toBeGreaterThanOrEqual(-5)
      expect(y).toBeGreaterThanOrEqual(-5)
      expect(x + w).toBeLessThanOrEqual(405)
      expect(y + h).toBeLessThanOrEqual(405)
      for (const p of it.outline) {
        expect(p[0]).toBeGreaterThanOrEqual(x - 1)
        expect(p[0]).toBeLessThanOrEqual(x + w + 1)
        expect(p[1]).toBeGreaterThanOrEqual(y - 1)
        expect(p[1]).toBeLessThanOrEqual(y + h + 1)
      }
    }
  })
})

describe('連連看：頁面 id 與難度', () => {
  it('id 來回轉換；壞的 id 回 null', () => {
    expect(dotsPageId('obj-star', 'e')).toBe('dots:obj-star:e')
    expect(parseDotsId('dots:obj-star:a')).toEqual({ name: 'obj-star', level: 'a' })
    expect(parseDotsId('dots:nope:e')).toBeNull()
    expect(parseDotsId('dots:obj-star:z')).toBeNull()
    expect(parseDotsId('monkey')).toBeNull()
    expect(parseDotsId(undefined)).toBeNull()
  })
  it('年齡預設難度：3 歲與 4–5 歲簡單，6–7 歲中等；沒設定視為簡單', () => {
    expect(defaultDotsLevel('3')).toBe('e')
    expect(defaultDotsLevel('4-5')).toBe('e')
    expect(defaultDotsLevel('6-7')).toBe('m')
    expect(defaultDotsLevel(undefined)).toBe('e')
  })
  it('標籤：數字 1 起算；字母 A–Z', () => {
    expect(dotLabel('e', 0)).toBe('1')
    expect(dotLabel('h', 29)).toBe('30')
    expect(dotLabel('a', 0)).toBe('A')
    expect(dotLabel('a', 25)).toBe('Z')
  })
  it('每種難度各免費 3 張，其他 20 星換', () => {
    expect(DOTS_IDS.filter(isDotsFree)).toEqual(DOTS_IDS.slice(0, DOTS_FREE_COUNT))
    expect(DOTS_PRICE).toBe(20)
    expect(dotsItemId('dots:obj-apple:e')).toBe('coloring-dots:obj-apple:e')
  })
  it('當成著色頁：剪影是單一可填色區塊，名字帶「連連看」', () => {
    const p = getColoringPage('dots:obj-star:e')!
    expect(p.regions).toHaveLength(1)
    expect(p.regions[0].id).toBe('shape')
    expect(p.regions[0].d.startsWith('M')).toBe(true)
    expect(p.regions[0].d.endsWith('Z')).toBe(true)
    expect(p.name).toContain('連連看')
    expect(getColoringPage('dots:obj-star:a')!.name).toContain('字母')
    expect(getColoringPage('dots:bad:e')).toBeUndefined()
  })
  it('剪影路徑：封閉、點太少不產生', () => {
    expect(silhouettePath('obj-star').endsWith('Z')).toBe(true)
    expect(smoothClosedPath([[0, 0], [1, 1]])).toBe('')
  })
})

describe('連連看：連線判定', () => {
  it('只有「下一個點」會前進；點錯不前進、不算錯', () => {
    expect(tapDot(0, 10, 0)).toEqual({ at: 1, connected: true, closed: false })
    expect(tapDot(3, 10, 5)).toEqual({ at: 3, connected: false, closed: false })
    expect(tapDot(3, 10, 2)).toEqual({ at: 3, connected: false, closed: false })
    expect(tapDot(3, 10, 4)).toEqual({ at: 3, connected: false, closed: false })
  })
  it('最後一點連上時自動封閉；連完之後再點不會再前進', () => {
    expect(tapDot(9, 10, 9)).toEqual({ at: 10, connected: true, closed: true })
    expect(tapDot(10, 10, 0)).toEqual({ at: 10, connected: false, closed: false })
    expect(tapDot(10, 10, 9)).toEqual({ at: 10, connected: false, closed: false })
  })
  it('一路點下去：連完 N 點剛好封閉一次', () => {
    let at = 0
    let closed = 0
    for (let i = 0; i < 30; i++) {
      const r = tapDot(at, 30, i)
      expect(r.connected).toBe(true)
      at = r.at
      if (r.closed) closed++
    }
    expect(at).toBe(30)
    expect(closed).toBe(1)
  })
  it('點擊範圍重疊時「下一個點」優先；其餘取最近的（只用來輕晃）；範圍外回 null', () => {
    const dots: Pt[] = [[100, 100], [110, 100], [300, 300]]
    // 手指在 0 與 1 的中間偏 0：下一個是 1 → 判 1（不被較近的 0 搶走）
    expect(hitDot(dots, [104, 100], 1, 20)).toEqual({ index: 1, next: true })
    // 下一個是 2，手指只在 0、1 範圍內 → 回最近的（0），不是下一個
    expect(hitDot(dots, [104, 100], 2, 20)).toEqual({ index: 0, next: false })
    expect(hitDot(dots, [250, 50], 2, 20)).toBeNull()
    // 全部連完了：沒有下一個
    expect(hitDot(dots, [300, 300], 3, 20)).toEqual({ index: 2, next: false })
  })
})

describe('連連看：標籤位置（數字不重疊、難讀）', () => {
  const boxesOverlap = (a: LabelBox, b: LabelBox) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
  // 板子寬 px → 各難度的點與字大小（和 Dots.tsx 相同的算法）
  const sizes = (px: number, easy: boolean) => {
    const scale = px / 416
    const dotR = (easy ? Math.min(20, Math.max(12, px * 0.03)) : Math.min(14, Math.max(8, px * 0.022))) / scale
    const font = (easy ? Math.min(32, Math.max(18, px * 0.05)) : Math.min(24, Math.max(14, px * 0.036))) / scale
    return { dotR, font }
  }
  for (const px of [358, 560, 700]) {
    it(`板寬 ${px}px：全部圖與難度，標籤不互相重疊、不蓋到別的點、不出畫面`, () => {
      for (const id of DOTS_IDS) {
        for (const l of DOTS_LEVELS) {
          const dots = dotsPoints(id, l.id)
          const { dotR, font } = sizes(px, l.id === 'e')
          const texts = dots.map((_, i) => dotLabel(l.id, i))
          const labels = placeLabels(dots, texts, Math.round(font * 2) / 2, Math.round(dotR * 2) / 2)
          const boxes = labels.map((c, i) => labelBox(c, texts[i], font))
          let overlaps = 0
          boxes.forEach((b, i) => {
            for (let j = i + 1; j < boxes.length; j++) if (boxesOverlap(b, boxes[j])) overlaps++
            // 蓋到任何一個點的圓（包含自己的）
            dots.forEach((d) => {
              const dx = Math.max(b.x0 - d[0], 0, d[0] - b.x1)
              const dy = Math.max(b.y0 - d[1], 0, d[1] - b.y1)
              if (dx * dx + dy * dy < dotR * 1.25 * dotR * 1.25) overlaps++ // 「下一個」的點會放大到 1.25 倍
            })
            expect(b.x0, `${id}:${l.id}#${i}`).toBeGreaterThanOrEqual(-8)
            expect(b.x1, `${id}:${l.id}#${i}`).toBeLessThanOrEqual(408)
            expect(b.y0, `${id}:${l.id}#${i}`).toBeGreaterThanOrEqual(-8)
            expect(b.y1, `${id}:${l.id}#${i}`).toBeLessThanOrEqual(408)
          })
          expect(overlaps, `${id}:${l.id} @${px}px`).toBe(0)
        }
      }
    })
  }
})

describe('連連看：標籤認得出是哪個點的', () => {
  it('幾乎每個標籤都比任何別的點更靠近自己的點（極少數擠的地方會有細線連回去）', () => {
    let total = 0
    let ambiguous = 0
    for (const id of DOTS_IDS) {
      for (const l of DOTS_LEVELS) {
        const dots = dotsPoints(id, l.id)
        const texts = dots.map((_, i) => dotLabel(l.id, i))
        const labels = placeLabels(dots, texts, 15, 9)
        labels.forEach((c, i) => {
          total++
          const own = Math.hypot(c[0] - dots[i][0], c[1] - dots[i][1])
          if (dots.some((d, j) => j !== i && Math.hypot(c[0] - d[0], c[1] - d[1]) < own)) ambiguous++
        })
      }
    }
    expect(ambiguous / total).toBeLessThan(0.01)
  })
})

describe('連連看：新句子', () => {
  it('DOTS_LINES 與 lines.ts 的固定台詞一字不差（預錄音檔靠它找）', () => {
    for (const [k, v] of Object.entries(DOTS_LINES)) expect(STATIC_LINES[k], k).toEqual(v)
  })
  it('阿悟連完的話：每張圖一句，句子裡有圖的名字', () => {
    const lines = DOTS_LINES['pet.dots.done'] as string[]
    expect(lines).toHaveLength(DOTS_IDS.length)
    DOTS_IDS.forEach((id, i) => expect(lines[i]).toContain(DOTS_NAMES[id]))
  })
  it('數字 1–30 都有中文唸法（1–20 已有預錄 num.n；21–30 也加進清單）；字母 A–Z 進英文清單', () => {
    const zh = allLines([])
    for (let n = 1; n <= 30; n++) expect(zh[`num.${n}`], `num.${n}`).toBe(chineseNumber(n))
    expect(chineseNumber(21)).toBe('二十一')
    expect(chineseNumber(30)).toBe('三十')
    const en = englishLines()
    for (let i = 0; i < 26; i++) expect(en[`en.${String.fromCharCode(65 + i)}`]).toBe(String.fromCharCode(65 + i))
  })
})
