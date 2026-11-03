import { describe, expect, it } from 'vitest'
import { FESTIVAL_BY_ID, FESTIVAL_DECOR, FESTIVALS, festivalAt, festivalClock, festivalDecorOf, festivalKey, LUNAR_TABLE } from './season'
import { SHOP_ITEMS } from './constants'

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime()
const iso = (y: number, md: readonly [number, number]) => `${y}-${String(md[0]).padStart(2, '0')}-${String(md[1]).padStart(2, '0')}`

/**
 * ICU 的中國曆在朔（新月）很靠近午夜時會差一天。天文計算（ephem）：
 *   2027-02-06 23:56（UTC+8）朔 → 正月初一是 2/6，ICU 說 2/7
 *   2030-02-03 00:07（UTC+8）朔 → 正月初一是 2/3，ICU 說 2/2
 * 香港天文台資料（Python lunardate）也是 2/6、2/3。表以正確的為準，這裡列明例外；ICU 修好了這個測試會提醒拿掉。
 */
const ICU_KNOWN_WRONG: Record<string, string> = { '2027-02-06': '2027-02-07', '2030-02-03': '2030-02-02' }

const chinese = new Intl.DateTimeFormat('zh-TW-u-ca-chinese', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric' })
/** 這一天（國曆）在 Intl 中國曆是幾月幾日；用台北中午，日期不受執行環境時區影響 */
function lunarOf(ymd: string): { month: string; day: string } {
  const parts = chinese.formatToParts(new Date(`${ymd}T12:00:00+08:00`))
  return { month: parts.find((p) => p.type === 'month')!.value, day: parts.find((p) => p.type === 'day')!.value }
}

describe('農曆查表', () => {
  const rows = Object.entries(LUNAR_TABLE).map(([y, r]) => ({ year: Number(y), ...r }))

  it('涵蓋 2026–2035', () => {
    expect(rows.map((r) => r.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035])
  })

  it.each(rows)('$year 和 Intl 中國曆一致（已知的 ICU 錯誤除外）', ({ year, cny, dragon, moon }) => {
    const c = iso(year, cny)
    expect(lunarOf(ICU_KNOWN_WRONG[c] ?? c)).toEqual({ month: '正月', day: '1' })
    expect(lunarOf(iso(year, dragon))).toEqual({ month: '五月', day: '5' })
    expect(lunarOf(iso(year, moon))).toEqual({ month: '八月', day: '15' })
  })

  it('ICU 那兩天確實是差一天（不是表寫錯）', () => {
    expect(lunarOf('2027-02-06')).toEqual({ month: '臘月', day: '30' })
    expect(lunarOf('2030-02-03')).toEqual({ month: '正月', day: '2' })
  })
})

describe('festivalAt', () => {
  it('節日當天', () => {
    expect(festivalAt(at(2027, 2, 6))).toEqual({ id: 'cny', year: 2027 })
    expect(festivalAt(at(2027, 4, 4))).toEqual({ id: 'children', year: 2027 })
    expect(festivalAt(at(2027, 6, 9))).toEqual({ id: 'dragon', year: 2027 })
    expect(festivalAt(at(2027, 9, 15))).toEqual({ id: 'moon', year: 2027 })
    expect(festivalAt(at(2027, 12, 25))).toEqual({ id: 'xmas', year: 2027 })
  })

  it('區間的頭尾：前後一天就沒有', () => {
    expect(festivalAt(at(2027, 2, 2))).toBeNull()
    expect(festivalAt(at(2027, 2, 3))?.id).toBe('cny')
    expect(festivalAt(at(2027, 2, 13))?.id).toBe('cny')
    expect(festivalAt(at(2027, 2, 14))).toBeNull()
    expect(festivalAt(at(2027, 3, 31))).toBeNull()
    expect(festivalAt(at(2027, 4, 1))?.id).toBe('children')
    expect(festivalAt(at(2027, 4, 7))?.id).toBe('children')
    expect(festivalAt(at(2027, 4, 8))).toBeNull()
    expect(festivalAt(at(2027, 12, 17))).toBeNull()
    expect(festivalAt(at(2027, 12, 18))?.id).toBe('xmas')
    expect(festivalAt(at(2027, 12, 28))?.id).toBe('xmas')
    expect(festivalAt(at(2027, 12, 29))).toBeNull()
  })

  it('跨月的區間：2028 春節 1/26，1/23 開始', () => {
    expect(festivalAt(at(2028, 1, 23))).toEqual({ id: 'cny', year: 2028 })
    expect(festivalAt(at(2028, 2, 2))).toEqual({ id: 'cny', year: 2028 })
  })

  it('查表外的年份：農曆節日不出現，國曆節日照常', () => {
    expect(festivalAt(at(2040, 2, 12))).toBeNull()
    expect(festivalAt(at(2040, 12, 25))).toEqual({ id: 'xmas', year: 2040 })
  })

  it('2026–2035 每一天最多落在一個節慶，五個節慶每年都出現', () => {
    for (let y = 2026; y <= 2035; y++) {
      const seen = new Set<string>()
      for (let t = at(y, 1, 1); t < at(y + 1, 1, 1); t += 86_400_000) {
        // 逐一比對：festivalAt 回傳的那一個，別的節慶的區間不能也包含這天
        const hits = FESTIVALS.filter((f) => {
          const md = f.dateIn(y)
          if (!md) return false
          const d = (t - at(y, md[0], md[1])) / 86_400_000
          return Math.round(d) >= -f.before && Math.round(d) <= f.after
        })
        expect(hits.length).toBeLessThanOrEqual(1)
        const f = festivalAt(t)
        if (f) seen.add(f.id)
      }
      expect([...seen].sort()).toEqual(['children', 'cny', 'dragon', 'moon', 'xmas'])
    }
  })
})

describe('紀念家具與文案', () => {
  it('五件紀念家具都不在商店目錄', () => {
    expect(FESTIVAL_DECOR.map((i) => i.id).sort()).toEqual(['decor-fest-balloon', 'decor-fest-dragonboat', 'decor-fest-lion', 'decor-fest-rabbitlamp', 'decor-fest-tree'])
    for (const i of FESTIVAL_DECOR) {
      expect(SHOP_ITEMS.some((s) => s.id === i.id)).toBe(false)
      expect(i.cost).toBeUndefined()
      expect(festivalDecorOf(i.id)).toBe(i)
    }
  })

  it('文案沒有倒數、限定、快結束', () => {
    for (const f of FESTIVALS) {
      expect(`${f.line}${f.caption}`).not.toMatch(/限定|快結束|倒數|只剩|還剩|錯過/)
    }
  })

  it('festivalKey 依節慶與年份', () => {
    expect(festivalKey({ id: 'moon', year: 2028 })).toBe('moon:2028')
    expect(FESTIVAL_BY_ID.moon.art).toBe('ui-fest-moon')
  })
})

describe('festivalClock：測試日期只在自動化或開發有效', () => {
  const NOW = at(2026, 11, 3)
  it('正式使用者：override 無效，永遠用真實日期', () => {
    expect(festivalClock(NOW, { automated: false, dev: false, override: '2027-02-06' })).toBe(NOW)
    expect(festivalClock(NOW, { automated: false, dev: false, override: null })).toBe(NOW)
  })
  it('自動化：沒有 override 不演節慶；有才演那一天', () => {
    expect(festivalClock(NOW, { automated: true, dev: false, override: null })).toBeNull()
    expect(festivalClock(NOW, { automated: true, dev: false, override: 'xx' })).toBeNull()
    expect(festivalAt(festivalClock(NOW, { automated: true, dev: false, override: '2027-02-06' })!)).toEqual({ id: 'cny', year: 2027 })
  })
  it('開發模式：預設真實日期，override 優先', () => {
    expect(festivalClock(NOW, { automated: false, dev: true, override: null })).toBe(NOW)
    expect(festivalAt(festivalClock(NOW, { automated: false, dev: true, override: '2027-12-25' })!)?.id).toBe('xmas')
  })
})
