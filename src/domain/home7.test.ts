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
