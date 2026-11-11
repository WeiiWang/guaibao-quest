import { describe, expect, it } from 'vitest'
import { STATIC_LINES } from '../learning/lines'
import { FOOD_IDS } from './constants'
import {
  AILMENTS,
  AILMENT_STEPS,
  DOCTOR_TOOLS,
  HOT_LINE,
  NEW_AILMENTS,
  NEW_TOOLS,
  TOOL_LINE,
  TOOL_SPOT,
  ailmentFor,
  ailmentsFor,
  applyDoctorTool,
  doctorTools,
  feverish,
  newVisit,
  pickAilment,
  toolLine,
  visitDone,
  type Ailment,
} from './doctor'
import { BED_CEILINGS, BED_DOLLS, BED_STEPS, BED_STEP_LINE, bedSteps, nextBedStep, nextCeiling } from './bedtime'
import {
  MARKET_CART_MAX,
  MARKET_GOODS,
  MARKET_GOOD_PRICE,
  MARKET_KINDS,
  MARKET_MAX_BILL,
  MARKET_MIN_BILL,
  bossChange,
  bossChangeOptions,
  bossNeed,
  bossOffer,
  bossOrder,
  coinSum,
  isMarketGood,
  marketBill,
  marketCanAdd,
  marketList,
  marketListTotal,
  marketListUnits,
  marketPrice,
  marketShelf,
  type MarketItem,
} from './market'
import { JUICE_COLORS, JUICE_DECOS, JUICE_FRUITS, JUICE_NEW_FRUITS, JUICE_PER_ROUND, isNewFruit, juiceCanDeco, juiceColor, juiceFruits, juiceKinds, juiceMatches, juiceOrder } from './juice'
import { dayNumber } from './parentTips'
import type { AgeBand } from './types'

// v8.5 線 AD 的新玩具：寵物醫院、晚安小屋、超市、果汁攤。
// 兩件事都要守住：toys === 0 跟 v8.4 一模一樣；有了新玩具之後原本的玩法不會變難。

const BANDS: AgeBand[] = ['3', '4-5', '6-7']
const DATES = Array.from({ length: 366 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
})

describe('寵物醫院：新毛病（toys >= 1）', () => {
  it('沒有新玩具：輪替和工具跟 v8.4 一樣', () => {
    expect(ailmentsFor(0)).toEqual(AILMENTS)
    expect(doctorTools(0)).toEqual(DOCTOR_TOOLS)
    for (const d of DATES.slice(0, 30)) for (let r = 0; r < 8; r++) expect(ailmentFor(d, r, 0)).toBe(ailmentFor(d, r))
    for (const d of DATES.slice(0, 30)) expect(AILMENTS).toContain(ailmentFor(d, 0))
  })
  it('有新玩具：六種毛病輪一圈，多兩個工具（排在原本的後面）', () => {
    for (const toys of [1, 2]) {
      expect(ailmentsFor(toys)).toEqual([...AILMENTS, 'fever', 'hiccup'])
      expect(doctorTools(toys)).toEqual([...DOCTOR_TOOLS, 'icepack', 'water'])
      const seen = [0, 1, 2, 3, 4, 5].map((r) => ailmentFor('2026-11-11', r, toys))
      expect(new Set(seen).size).toBe(6)
      expect(ailmentFor('2026-11-11', 6, toys)).toBe(seen[0])
    }
  })
  it('發燒：體溫計 → 冰枕（放額頭）；打嗝：聽診器 → 喝水（放嘴巴）', () => {
    expect(AILMENT_STEPS.fever).toEqual(['thermo', 'icepack'])
    expect(AILMENT_STEPS.hiccup).toEqual(['stetho', 'water'])
    expect(TOOL_SPOT.icepack).toBe('head')
    expect(TOOL_SPOT.water).toBe('mouth')
    expect(NEW_AILMENTS).toEqual(['fever', 'hiccup'])
    expect(NEW_TOOLS).toEqual(['icepack', 'water'])
  })
  it('新毛病的每一步都用得到工具盤上的工具，照順序看得完', () => {
    for (const a of NEW_AILMENTS) {
      let v = newVisit(a)
      for (const t of AILMENT_STEPS[a]) {
        expect(doctorTools(1)).toContain(t)
        v = applyDoctorTool(v, t, '6-7').visit
      }
      expect(visitDone(v)).toBe(true)
    }
  })
  it('原本的毛病不會用到新工具（有了新玩具，舊的玩法不變難）', () => {
    for (const a of AILMENTS) for (const t of AILMENT_STEPS[a]) expect(DOCTOR_TOOLS).toContain(t)
  })
  it('台詞都在 lines.ts', () => {
    for (const k of ['pet.play.doctor.fever', 'pet.play.doctor.hiccup', TOOL_LINE.icepack, TOOL_LINE.water, HOT_LINE, 'pet.play.doctor.xray']) expect(typeof STATIC_LINES[k]).toBe('string')
    expect(TOOL_LINE.icepack).toBe('pet.play.doctor.icepack')
    expect(TOOL_LINE.water).toBe('pet.play.doctor.water')
  })
  it('發燒時量體溫不說「沒有發燒」；退燒後再量才說', () => {
    const v = newVisit('fever')
    expect(feverish(v)).toBe(true)
    expect(toolLine(v, 'thermo', 'step')).toBe(HOT_LINE)
    const cooled = applyDoctorTool(applyDoctorTool(v, 'thermo', '3').visit, 'icepack', '3').visit
    expect(feverish(cooled)).toBe(false)
    expect(toolLine(cooled, 'thermo', 'play')).toBe(TOOL_LINE.thermo)
    // 別的毛病量體溫照舊
    expect(toolLine(newVisit('sneeze'), 'thermo', 'step')).toBe(TOOL_LINE.thermo)
  })
  it('沒打嗝時喝水、沒受傷時貼 OK 繃：有反應但不說「好了」那一句', () => {
    expect(toolLine(newVisit('sneeze'), 'water', 'play')).toBeNull()
    expect(toolLine(newVisit('sneeze'), 'bandage', 'play')).toBeNull()
    expect(toolLine({ ailment: 'hiccup', step: 1, bandaged: false }, 'water', 'done')).toBe(TOOL_LINE.water)
    expect(toolLine(newVisit('sneeze'), 'icepack', 'play')).toBe(TOOL_LINE.icepack)
  })
})

describe('寵物醫院：下一回看什麼', () => {
  it('剛進來（沒有上一回）就是單純的輪替', () => {
    for (const toys of [0, 1, 2]) for (let r = 0; r < 7; r++) expect(pickAilment('2026-11-11', r, toys)).toEqual({ ailment: ailmentFor('2026-11-11', r, toys), round: r })
  })
  it('剛拿到新毛病的那一回一定是發燒', () => {
    for (const d of DATES.slice(0, 40)) {
      const first = ailmentFor(d, 0, 0)
      expect(pickAilment(d, 1, 1, { ailment: first, toys: 0 })).toEqual({ ailment: 'fever', round: 1 })
    }
  })
  it('不會連續兩回同一個毛病', () => {
    for (const d of DATES.slice(0, 60)) {
      let prev: { ailment: Ailment; toys: number } = { ailment: ailmentFor(d, 0, 0), toys: 0 }
      let n = 1
      for (let i = 0; i < 12; i++) {
        const p = pickAilment(d, n, 1, prev)
        expect(p.ailment).not.toBe(prev.ailment)
        expect(p.round).toBeGreaterThanOrEqual(n)
        prev = { ailment: p.ailment, toys: 1 }
        n = p.round + 1
      }
    }
  })
  it('一直看下去六種都看得到', () => {
    const seen = new Set<Ailment>()
    let prev: { ailment: Ailment; toys: number } | undefined
    let n = 0
    for (let i = 0; i < 8; i++) {
      const p = pickAilment('2026-11-11', n, 1, prev)
      seen.add(p.ailment)
      prev = { ailment: p.ailment, toys: 1 }
      n = p.round + 1
    }
    expect(seen.size).toBe(6)
  })
})

describe('晚安小屋：抱抱玩偶與夜燈投影', () => {
  it('沒有新玩具：步驟跟 v8.4 一樣', () => {
    expect(bedSteps(0)).toEqual(BED_STEPS)
    expect(nextBedStep('pajamas')).toBe('story')
    expect(nextBedStep('pajamas', 0)).toBe('story')
  })
  it('有新玩具：換睡衣之後多一步抱抱玩偶，再來才是故事', () => {
    for (const toys of [1, 2]) {
      expect(bedSteps(toys)).toEqual(['brush', 'pajamas', 'doll', 'story', 'lamp', 'asleep'])
      expect(nextBedStep('pajamas', toys)).toBe('doll')
      expect(nextBedStep('doll', toys)).toBe('story')
      expect(nextBedStep('asleep', toys)).toBe('asleep')
    }
    // 沒有玩偶那一步時被問到，也是往故事走（不會卡住）
    expect(nextBedStep('doll', 0)).toBe('story')
  })
  it('三個玩偶、台詞在 lines.ts', () => {
    expect(BED_DOLLS).toEqual(['bear', 'bunny', 'dino'])
    expect(typeof STATIC_LINES[BED_STEP_LINE.doll]).toBe('string')
    expect(typeof STATIC_LINES['pet.play.bedtime.doll']).toBe('string')
  })
  it('夜燈投影：星星 → 海底 → 彩虹 → 星星', () => {
    expect(BED_CEILINGS).toEqual(['stars', 'sea', 'rainbow'])
    expect(nextCeiling('stars')).toBe('sea')
    expect(nextCeiling('sea')).toBe('rainbow')
    expect(nextCeiling('rainbow')).toBe('stars')
  })
})

describe('超市：新商品（toys >= 1）', () => {
  it('沒有新玩具：貨架和清單跟 v8.4 一樣（都是食物）', () => {
    for (const b of BANDS) {
      expect(marketShelf(b, 0)).toEqual(marketShelf(b))
      for (const f of marketShelf(b)) expect(FOOD_IDS).toContain(f)
      for (const d of DATES.slice(0, 60)) for (let r = 0; r < 4; r++) {
        expect(marketList(d, r, b, 0)).toEqual(marketList(d, r, b))
        for (const l of marketList(d, r, b)) expect(isMarketGood(l.id)).toBe(false)
      }
    }
  })
  it('有新玩具：貨架多四種（排在食物後面）', () => {
    expect(marketShelf('3', 1)).toHaveLength(12)
    expect(marketShelf('4-5', 1)).toHaveLength(14)
    expect(marketShelf('6-7', 2)).toHaveLength(14)
    for (const b of BANDS) {
      expect(marketShelf(b, 1).slice(0, marketShelf(b).length)).toEqual(marketShelf(b))
      expect(marketShelf(b, 1).slice(-4)).toEqual([...MARKET_GOODS])
    }
  })
  it('新商品都有價錢（1–5）', () => {
    for (const g of MARKET_GOODS) {
      expect(MARKET_GOOD_PRICE[g]).toBeGreaterThanOrEqual(1)
      expect(MARKET_GOOD_PRICE[g]).toBeLessThanOrEqual(5)
      expect(marketPrice(g)).toBe(MARKET_GOOD_PRICE[g])
    }
    expect(marketPrice('carrot')).toBe(1)
    expect(marketPrice('nothing')).toBe(0)
  })
  it('有新玩具：每張清單剛好一樣新商品，其他行跟沒有新玩具時一樣', () => {
    for (const b of BANDS)
      for (const d of DATES)
        for (let r = 0; r < 3; r++) {
          const l = marketList(d, r, b, 1)
          const old = marketList(d, r, b, 0)
          expect(l).toHaveLength(MARKET_KINDS[b])
          expect(new Set(l.map((x) => x.id)).size).toBe(l.length)
          expect(l.filter((x) => isMarketGood(x.id))).toHaveLength(1)
          expect(isMarketGood(l[l.length - 1].id)).toBe(true)
          expect(l.slice(0, -1).map((x) => x.id)).toEqual(old.slice(0, -1).map((x) => x.id))
          for (const x of l) expect(marketShelf(b, 1)).toContain(x.id)
        }
  })
  it('四種新商品輪流出現', () => {
    const seen = new Set([0, 1, 2, 3].map((r) => marketList('2026-11-11', r, '3', 1).at(-1)!.id))
    expect(seen.size).toBe(4)
  })
  it('有新玩具：數量和價錢的上限不變（不會變難）', () => {
    for (const d of DATES)
      for (let r = 0; r < 3; r++) {
        expect(marketListUnits(marketList(d, r, '3', 1))).toBe(2)
        expect(marketListUnits(marketList(d, r, '4-5', 1))).toBeLessThanOrEqual(4)
        const l = marketList(d, r, '6-7', 1)
        const total = marketListTotal(l)
        expect(total).toBeGreaterThanOrEqual(MARKET_MIN_BILL)
        expect(total).toBeLessThanOrEqual(MARKET_MAX_BILL)
        expect(marketListUnits(l)).toBeLessThanOrEqual(MARKET_CART_MAX['6-7'])
        const cart: MarketItem[] = []
        for (const x of l)
          for (let k = 0; k < x.qty; k++) {
            expect(marketCanAdd('6-7', cart, x.id)).toBe(true)
            cart.push(x.id)
          }
        expect(marketBill('6-7', cart)).toBe(total)
      }
  })
})

describe('超市：當老闆（toys >= 2）', () => {
  it('寵物要買的東西：跟清單同一套規則，數量和價錢在範圍內', () => {
    for (const b of BANDS)
      for (const d of DATES.slice(0, 120))
        for (let r = 0; r < 3; r++) {
          const items = bossOrder(d, r, b, 2)
          expect(items.length).toBeGreaterThanOrEqual(MARKET_KINDS[b])
          expect(items.length).toBeLessThanOrEqual(MARKET_CART_MAX[b])
          for (const id of items) expect(marketShelf(b, 2)).toContain(id)
          const bill = marketBill(b, items)
          if (b === '4-5') expect(bill).toBeLessThanOrEqual(5)
          if (b === '6-7') {
            expect(bill).toBeGreaterThanOrEqual(MARKET_MIN_BILL)
            expect(bill).toBeLessThanOrEqual(MARKET_MAX_BILL)
          }
        }
  })
  it('同一天同一回永遠一樣，下一回不一樣', () => {
    expect(bossOrder('2026-11-11', 0, '6-7', 2)).toEqual(bossOrder('2026-11-11', 0, '6-7', 2))
    expect(bossOrder('2026-11-11', 1, '6-7', 2)).not.toEqual(bossOrder('2026-11-11', 0, '6-7', 2))
  })
  it('3 歲：寵物給一枚，收下就好，不找錢', () => {
    expect(bossOffer('3', 1)).toEqual([1])
    expect(bossNeed('3', 1)).toBe(1)
    expect(bossChange('3', 1)).toBe(0)
  })
  it('4–5 歲：寵物多拿兩枚 1 元，收到跟點點一樣多就夠，不找錢', () => {
    for (let bill = 1; bill <= 5; bill++) {
      const offer = bossOffer('4-5', bill)
      expect(offer).toHaveLength(bill + 2)
      expect(offer.every((c) => c === 1)).toBe(true)
      expect(bossNeed('4-5', bill)).toBe(bill)
      expect(bossChange('4-5', bill)).toBe(0)
    }
  })
  it('6–7 歲：寵物一定多給（下一個 5 的倍數），要找 1–5 元，算得對', () => {
    for (let bill = MARKET_MIN_BILL; bill <= MARKET_MAX_BILL; bill++) {
      const offer = bossOffer('6-7', bill)
      const paid = coinSum(offer)
      expect(paid % 5).toBe(0)
      expect(paid).toBeGreaterThan(bill)
      expect(bossNeed('6-7', bill)).toBe(offer.length)
      const change = bossChange('6-7', bill)
      expect(change).toBe(paid - bill)
      expect(change).toBeGreaterThanOrEqual(1)
      expect(change).toBeLessThanOrEqual(5)
      expect(offer.length).toBeLessThanOrEqual(3)
    }
    expect(bossOffer('6-7', 12)).toEqual([10, 5])
    expect(bossChange('6-7', 12)).toBe(3)
    expect(bossOffer('6-7', 20)).toEqual([10, 10, 5])
  })
  it('找零的選項：三個都不一樣、都大於 0、一定有對的那個，位置會輪', () => {
    const spots = new Set<number>()
    for (let change = 1; change <= 5; change++)
      for (let r = 0; r < 6; r++) {
        const o = bossChangeOptions(change, r)
        expect(o).toHaveLength(3)
        expect(new Set(o).size).toBe(3)
        expect(o.every((a) => a > 0)).toBe(true)
        expect(o).toContain(change)
        expect(bossChangeOptions(change, r)).toEqual(o)
        spots.add(o.indexOf(change))
      }
    expect(spots.size).toBe(3)
  })
  it('台詞都在 lines.ts', () => {
    for (const k of ['want', 'pay', 'change', 'thanks']) expect(typeof STATIC_LINES[`pet.play.market.boss.${k}`]).toBe('string')
  })
})

describe('果汁攤：草莓和橘子（toys >= 1）', () => {
  it('沒有新玩具：水果盤和點單跟 v8.4 一樣', () => {
    expect(juiceFruits(0)).toEqual(JUICE_FRUITS)
    for (const b of BANDS)
      for (const d of DATES.slice(0, 60))
        for (let r = 0; r < 3; r++)
          for (let i = 0; i < JUICE_PER_ROUND; i++) {
            const o = juiceOrder(d, r, i, b, 0)
            expect(o).toEqual(juiceOrder(d, r, i, b))
            expect(o.some(isNewFruit)).toBe(false)
          }
  })
  it('有新玩具：水果盤 7 種（草莓、橘子排在後面），都有果汁顏色', () => {
    expect(juiceFruits(1)).toEqual([...JUICE_FRUITS, 'strawberry', 'orange'])
    expect(juiceFruits(2)).toHaveLength(7)
    for (const f of JUICE_NEW_FRUITS) {
      expect(JUICE_COLORS[f]).toHaveLength(3)
      expect(juiceColor([f])).toMatch(/^rgb\(/)
    }
    // 草莓、蘋果、西瓜都是紅的，但顏色不能一模一樣
    expect(new Set([juiceColor(['strawberry']), juiceColor(['apple']), juiceColor(['watermelon'])]).size).toBe(3)
  })
  it('有新玩具：點幾種跟原本一樣（不變難）、不重複、都在水果盤上', () => {
    for (const b of BANDS)
      for (const d of DATES)
        for (let r = 0; r < 3; r++)
          for (let i = 0; i < JUICE_PER_ROUND; i++) {
            const o = juiceOrder(d, r, i, b, 1)
            const seed = dayNumber(d) * 7 + r * JUICE_PER_ROUND + i
            expect(o).toHaveLength(juiceKinds(b, seed))
            expect(new Set(o).size).toBe(o.length)
            for (const f of o) expect(juiceFruits(1)).toContain(f)
            expect(juiceMatches(o, [...o].reverse())).toBe(true)
          }
  })
  it('有新玩具：每一回至少有一位客人點草莓或橘子', () => {
    for (const b of BANDS)
      for (const d of DATES)
        for (let r = 0; r < 4; r++) {
          const round = [0, 1, 2].map((i) => juiceOrder(d, r, i, b, 1))
          expect(round.some((o) => o.some(isNewFruit))).toBe(true)
        }
  })
  it('草莓和橘子都會出現', () => {
    const all = new Set(DATES.slice(0, 30).flatMap((d) => [0, 1, 2].flatMap((i) => juiceOrder(d, 0, i, '3', 1))))
    expect(all.has('strawberry')).toBe(true)
    expect(all.has('orange')).toBe(true)
  })
  it('同一天同一位永遠一樣（不靠亂數）', () => {
    expect(juiceOrder('2026-11-11', 1, 2, '6-7', 1)).toEqual(juiceOrder('2026-11-11', 1, 2, '6-7', 1))
  })
})

describe('果汁攤：裝飾（toys >= 2）', () => {
  it('吸管、小雨傘、冰塊；每種最多加一個', () => {
    expect(JUICE_DECOS).toEqual(['straw', 'umbrella', 'ice'])
    expect(juiceCanDeco([], 'straw')).toBe(true)
    expect(juiceCanDeco(['straw'], 'straw')).toBe(false)
    expect(juiceCanDeco(['straw'], 'ice')).toBe(true)
  })
  it('裝飾不影響做對了沒（只看水果）', () => {
    expect(juiceMatches(['apple'], ['apple'])).toBe(true)
    expect(typeof STATIC_LINES['pet.play.juice.deco']).toBe('string')
  })
})
