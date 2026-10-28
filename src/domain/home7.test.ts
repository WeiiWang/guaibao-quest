import { describe, expect, it } from 'vitest'
import {
  AGE_CHOICES,
  baseIdOf,
  canMakeMore,
  childColorOf,
  CHILD_COLORS,
  copyOf,
  DECOR_TINTS,
  eggArtChain,
  eggLook,
  estimateViewAspect,
  growProgress,
  homeLineMap,
  MAX_DECOR_COPIES,
  milestonesCrossed,
  nextFreeKey,
  nextTint,
  pickMilestoneReward,
  pickWallSpot,
  pickWallSpotFit,
  isNarrowView,
  phoneRoomH,
  hudBoxesPhone,
  estimatePhoneAspect,
  clampArtScale,
  MIN_ART_SCALE,
  NARROW_MAX_W,
  placementKey,
  tintFilter,
  unplacedCount,
  wallKeepOut,
  type Box,
} from './home7'
import { spriteSize } from '../art/items'
import { ROOM_CELLS_H } from './room'

describe('蛋的外觀分段（0–33 / 33–66 / 66–90 / 90+）', () => {
  it('依孵化進度換外觀', () => {
    expect(eggLook(0)).toBe('pet-egg')
    expect(eggLook(0.32)).toBe('pet-egg')
    expect(eggLook(0.34)).toBe('pet-egg-s1')
    expect(eggLook(0.65)).toBe('pet-egg-s1')
    expect(eggLook(0.67)).toBe('pet-egg-s2')
    expect(eggLook(0.89)).toBe('pet-egg-s2')
    expect(eggLook(0.9)).toBe('pet-egg-crack')
    expect(eggLook(1)).toBe('pet-egg-crack')
  })
  it('新圖缺的時候一路退回 pet-egg', () => {
    expect(eggArtChain(0.5)).toEqual(['pet-egg-s1', 'pet-egg'])
    expect(eggArtChain(0.95)).toEqual(['pet-egg-crack', 'pet-egg-s2', 'pet-egg-s1', 'pet-egg'])
    expect(eggArtChain(0)).toEqual(['pet-egg'])
  })
  it('進度環：蛋看孵化、幼體看長大、成體滿', () => {
    expect(growProgress({ stage: 'egg', feedCount: 10 })).toBe(0.5)
    expect(growProgress({ stage: 'baby', feedCount: 50 })).toBe(0.5)
    expect(growProgress({ stage: 'adult', feedCount: 80 })).toBe(1)
  })
})

describe('成長里程碑（幼體到成體每餵 20 次）', () => {
  it('跨過 40、60 才算；蛋與 80 不算', () => {
    expect(milestonesCrossed(39, 40)).toEqual([40])
    expect(milestonesCrossed(38, 41)).toEqual([40])
    expect(milestonesCrossed(40, 41)).toEqual([])
    expect(milestonesCrossed(59, 62)).toEqual([60])
    expect(milestonesCrossed(0, 20)).toEqual([])
    expect(milestonesCrossed(78, 80)).toEqual([])
    expect(milestonesCrossed(30, 70)).toEqual([40, 60])
  })
  it('挑第一個還沒有的小禮物；都有了改送蛋糕', () => {
    expect(pickMilestoneReward(40, new Set()).itemId).toBe('decor-ball')
    expect(pickMilestoneReward(40, new Set(['decor-ball'])).itemId).toBe('decor-plant')
    expect(pickMilestoneReward(60, new Set()).itemId).toBe('wall-mint')
    const all = new Set(['decor-ball', 'decor-plant', 'decor-clock', 'decor-bunting', 'decor-crate'])
    expect(pickMilestoneReward(40, all)).toEqual({ itemId: 'cake', kind: 'food' })
  })
})

describe('家具數量上限與換色', () => {
  it('擺放 key：第 1 個沿用商品 id，第 2、3 個加 ~n', () => {
    expect(placementKey('decor-lamp', 1)).toBe('decor-lamp')
    expect(placementKey('decor-lamp', 2)).toBe('decor-lamp~2')
    expect(baseIdOf('decor-lamp~3')).toBe('decor-lamp')
    expect(baseIdOf('decor-lamp')).toBe('decor-lamp')
    expect(copyOf('decor-lamp~3')).toBe(3)
    expect(copyOf('decor-lamp')).toBe(1)
  })
  it('同一件最多 3 個：擁有幾個就能擺幾個，擺滿回 null', () => {
    expect(MAX_DECOR_COPIES).toBe(3)
    expect(nextFreeKey('a', 0, [])).toBeNull()
    expect(nextFreeKey('a', 1, [])).toBe('a')
    expect(nextFreeKey('a', 1, ['a'])).toBeNull()
    expect(nextFreeKey('a', 3, ['a'])).toBe('a~2')
    expect(nextFreeKey('a', 3, ['a', 'a~2'])).toBe('a~3')
    expect(nextFreeKey('a', 3, ['a', 'a~2', 'a~3'])).toBeNull()
    expect(nextFreeKey('a', 9, ['a', 'a~2', 'a~3'])).toBeNull() // 擁有數超過 3 也只算 3
    expect(nextFreeKey('a', 3, ['a~2'])).toBe('a') // 收回第 1 個後，空出來的是第 1 個
  })
  it('還沒擺出來的個數、工坊能不能再做', () => {
    expect(unplacedCount('a', 3, ['a', 'b'])).toBe(2)
    expect(unplacedCount('a', 2, ['a', 'a~2'])).toBe(0)
    expect(canMakeMore(0)).toBe(true)
    expect(canMakeMore(2)).toBe(true)
    expect(canMakeMore(3)).toBe(false)
  })
  it('四種色調（外加原色）；沒有或 0 = 原色，循環切換', () => {
    expect(DECOR_TINTS).toHaveLength(5)
    expect(tintFilter(undefined)).toBeUndefined()
    expect(tintFilter(0)).toBeUndefined()
    expect(tintFilter(2)).toContain('hue-rotate')
    expect(tintFilter(99)).toBeUndefined()
    expect([0, 1, 2, 3, 4].map(nextTint)).toEqual([1, 2, 3, 4, 0])
    expect(nextTint(undefined)).toBe(1)
  })
})

/** 把畫的大小換成佔房間寬高的比例（畫是 0.2 個房間高的方形） */
const art = (aspect: number) => {
  const s = spriteSize('art-x')
  return { w: (s.cols / ROOM_CELLS_H) / (2.5 * aspect), h: s.rows / ROOM_CELLS_H }
}
const hits = (a: Box, b: Box) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2

describe('掛畫自動挑空牆面（不蓋到窗戶；橫向、直向、手機都一樣）', () => {
  const sizes: [string, number, number, number][] = [
    ['iPad 橫向', 1180, 820, 6],
    ['iPad 直向', 820, 1180, 3],
    ['手機', 390, 844, 3],
  ]
  for (const [name, w, h, count] of sizes) {
    it(`${name}：連掛 ${count} 幅，沒有一幅蓋到窗戶，也沒有互相重疊`, () => {
      const aspect = estimateViewAspect(w, h)
      const sz = art(aspect)
      const walls: Box[] = []
      const windows = wallKeepOut(aspect).slice(0, 2)
      for (let i = 0; i < count; i++) {
        const p = pickWallSpot(sz, walls, aspect)
        const box = { ...p, ...sz }
        for (const win of windows) expect(hits(box, win), `${name} 第 ${i + 1} 幅蓋到窗戶`).toBe(false)
        for (const o of walls) expect(hits(box, o), `${name} 第 ${i + 1} 幅互相重疊`).toBe(false)
        expect(p.y + sz.h / 2).toBeLessThan(0.62) // 在牆面上
        walls.push(box)
      }
    })
  }
  it('第一幅畫在剛進房間的畫面裡（寵物 0.3 ± 0.2）', () => {
    const aspect = estimateViewAspect(820, 1180)
    const p = pickWallSpot(art(aspect), [], aspect)
    expect(p.x).toBeGreaterThan(0.1)
    expect(p.x).toBeLessThan(0.5)
  })
})

describe('年齡與顏色與句子', () => {
  it('三顆年齡按鈕涵蓋三個年齡檔', () => {
    expect(AGE_CHOICES.map((a) => a.band)).toEqual(['3', '4-5', '6-7'])
    expect(AGE_CHOICES.every((a) => a.say.length > 0)).toBe(true)
  })
  it('孩子的專屬顏色依順序輪流', () => {
    expect(childColorOf(0)).toBe(CHILD_COLORS[0])
    expect(childColorOf(CHILD_COLORS.length)).toBe(CHILD_COLORS[0])
    expect(childColorOf(-1)).toBe(CHILD_COLORS[CHILD_COLORS.length - 1])
  })
  it('新句子：阿悟說的話 key 以 pet. 開頭，其餘 ui.', () => {
    const m = homeLineMap()
    expect(Object.keys(m).length).toBeGreaterThan(10)
    for (const k of Object.keys(m)) expect(/^(pet|ui)\./.test(k)).toBe(true)
    expect(m['pet.gift.thanks.1']).toBeTruthy()
    expect(m['pet.welcome']).toBeTruthy()
    expect(m['pet.milestone']).toBeTruthy()
  })
})

describe('手機掛畫（v7.1 D3）：一定在第一屏看得到的牆面，不蓋窗戶，擠不下就縮小', () => {
  it('寬度 ≤ 560px 才算手機', () => {
    expect(NARROW_MAX_W).toBe(560)
    expect(isNarrowView(390)).toBe(true)
    expect(isNarrowView(560)).toBe(true)
    expect(isNarrowView(561)).toBe(false)
    expect(isNarrowView(820)).toBe(false)
  })
  it('縮放倍率夾在 0.45–1；沒有 = 原大小', () => {
    expect(clampArtScale(undefined)).toBe(1)
    expect(clampArtScale(0.1)).toBe(MIN_ART_SCALE)
    expect(clampArtScale(5)).toBe(1)
    expect(clampArtScale(0.6)).toBe(0.6)
  })
  const phones: [number, number][] = [[360, 640], [375, 667], [390, 844], [393, 852], [414, 896], [430, 932]]
  for (const [w, h] of phones) {
    for (const adult of [false, true]) {
      it(`${w}×${h}（${adult ? '成體' : '蛋 / 幼體'}）：連掛 3 幅都在第一屏內、沒蓋窗戶與按鈕；${h >= 740 ? '前兩幅互不重疊' : '第 1 幅獨佔'}（擠的時候後面的才錯開）`, () => {
        const aspect = estimatePhoneAspect(w, h)
        const sz = art(aspect)
        const walls: Box[] = []
        // 真實的畫面寬高比：實測房間高 = 視窗高 − 234（小手機）～ 269（大手機）；窗戶要用真實的比例檢查
        const reals = [w / (h - 275), w / (h - 230)]
        for (let i = 0; i < 3; i++) {
          const p = pickWallSpotFit(sz, walls, aspect, { viewW: w, roomH: phoneRoomH(h), adult })
          const box: Box = { x: p.x, y: p.y, w: sz.w * p.scale, h: sz.h * p.scale }
          expect(p.scale).toBeGreaterThanOrEqual(MIN_ART_SCALE)
          expect(box.x - box.w / 2).toBeGreaterThan(0.1) // 第一屏左緣（房間寬 0.1–0.5）
          expect(box.x + box.w / 2).toBeLessThan(0.5)
          expect(box.y + box.h / 2).toBeLessThan(0.62)
          // 用估計的與真實的畫面寬高比各檢查一次（畫的寬度、窗戶的寬度都跟著寬高比變）
          for (const a of [aspect, ...reals]) {
            const ba: Box = { x: p.x, y: p.y, w: art(a).w * p.scale, h: sz.h * p.scale }
            for (const win of wallKeepOut(a).slice(0, 2)) expect(hits(ba, win), `第 ${i + 1} 幅蓋到窗戶（寬高比 ${a.toFixed(2)}）`).toBe(false)
          }
          for (const k of hudBoxesPhone(w, phoneRoomH(h), adult)) expect(hits(box, k), `第 ${i + 1} 幅被狀態卡 / 按鈕蓋住`).toBe(false)
          // 高度 ≥ 740 的手機（390×844 起）左邊那一欄放得下兩幅；更矮的小手機（SE、360×640）只保證第 1 幅有乾淨的位置，其餘錯開疊放
          if (i < (h >= 740 ? 2 : 1)) for (const o of walls) expect(hits(box, o), `第 ${i + 1} 幅互相重疊`).toBe(false)
          walls.push(box)
        }
      })
    }
  }
  it('牆擠滿了（連掛 8 幅）仍然在第一屏內、不蓋窗戶，只與別的畫錯開疊放', () => {
    const aspect = estimatePhoneAspect(390, 844)
    const sz = art(aspect)
    const walls: Box[] = []
    for (let i = 0; i < 8; i++) {
      const p = pickWallSpotFit(sz, walls, aspect, { viewW: 390, roomH: phoneRoomH(844) })
      const box: Box = { x: p.x, y: p.y, w: sz.w * p.scale, h: sz.h * p.scale }
      expect(box.x - box.w / 2).toBeGreaterThan(0.1)
      expect(box.x + box.w / 2).toBeLessThan(0.5)
      for (const win of wallKeepOut(aspect).slice(0, 2)) expect(hits(box, win)).toBe(false)
      walls.push(box)
    }
  })
  it('第一幅在手機上會縮小（原大小放不下），在 iPad 不縮', () => {
    const phone = estimatePhoneAspect(390, 844)
    expect(pickWallSpotFit(art(phone), [], phone, { viewW: 390, roomH: phoneRoomH(844) }).scale).toBeLessThan(1)
    const pad = estimateViewAspect(1180, 820)
    expect(pickWallSpotFit(art(pad), [], pad).scale).toBe(1)
  })
})
