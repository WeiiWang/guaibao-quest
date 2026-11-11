import { describe, expect, it } from 'vitest'
import { BATH_BOMBS, BATH_COLS, BATH_MASK, BATH_MASK_COUNT, FOAM_HATS, FOAM_HAT_SPOT, bathProgress, bathStroke, bathTuning, bombInBath, brushHit, cellCenter, newBath, nextFoamHat, rinseHitsHat, type BathPoint, type BathState, type BathTuning, type FoamHat } from './bath'

/** 像孩子一樣在寵物身上來回抹，直到步驟改變；回傳抹了幾筆 */
function scrubUntilAdvance(start: BathState, t: BathTuning): { state: BathState; strokes: number } {
  let s = start
  let strokes = 0
  for (let y = 0.06; y <= 0.98; y += t.radius) {
    const from: BathPoint = { x: 0.02, y }
    const to: BathPoint = { x: 0.98, y }
    const r = bathStroke(s, from, to, t)
    s = r.state
    strokes++
    if (r.advanced) return { state: s, strokes }
  }
  throw new Error('抹完整隻還沒進下一步')
}

describe('洗澎澎的格子', () => {
  it('輪廓涵蓋寵物的頭和身體，四個角不算', () => {
    expect(BATH_MASK_COUNT).toBeGreaterThan(50)
    expect(BATH_MASK[0]).toBe(false)
    expect(BATH_MASK[BATH_COLS - 1]).toBe(false)
    expect(BATH_MASK[BATH_MASK.length - 1]).toBe(false)
    const face = BATH_MASK.findIndex((v, i) => v && cellCenter(i).y > 0.3)
    expect(face).toBeGreaterThan(0)
  })

  it('海綿是圓的，水往下流', () => {
    const at = { x: 0.5, y: 0.2 }
    expect(brushHit('soap', { x: 0.5, y: 0.9 }, at, 0.15)).toBe(false)
    expect(brushHit('rinse', { x: 0.5, y: 0.4 }, at, 0.15)).toBe(true)
    // 水柱有長度：噴頭在頭頂沖不到腳
    expect(brushHit('rinse', { x: 0.5, y: 0.9 }, at, 0.15)).toBe(false)
    expect(brushHit('rinse', { x: 0.9, y: 0.4 }, at, 0.15)).toBe(false)
    // 噴頭上面沖不到
    expect(brushHit('rinse', { x: 0.5, y: 0.02 }, at, 0.15)).toBe(false)
  })
})

describe('三個步驟', () => {
  const t = bathTuning('4-5')

  it('抹過寵物才長泡泡，框外什麼都不會發生', () => {
    const s = newBath()
    const out = bathStroke(s, { x: -0.5, y: 0.1 }, { x: -0.2, y: 0.1 }, t)
    expect(out.changed).toBe(0)
    expect(out.state).toBe(s)
    const on = bathStroke(s, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.4 }, t)
    expect(on.changed).toBeGreaterThan(0)
    expect(on.state.soap.filter(Boolean).length).toBe(on.changed)
  })

  it('移動很快也不會跳格（沿線補點）', () => {
    const r = bathStroke(newBath(), { x: 0, y: 0.4 }, { x: 1, y: 0.4 }, t)
    const row = Math.floor(0.4 * 12)
    for (let c = 0; c < BATH_COLS; c++) {
      const i = row * BATH_COLS + c
      if (BATH_MASK[i]) expect(r.state.soap[i]).toBe(true)
    }
  })

  it('抹到約 7 成才進沖水，同一個地方重抹不算', () => {
    let s = newBath()
    for (let n = 0; n < 50; n++) s = bathStroke(s, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.3 }, t).state
    expect(s.step).toBe('soap')
    const r = scrubUntilAdvance(s, t)
    expect(r.state.step).toBe('rinse')
    expect(r.state.soap.filter(Boolean).length / BATH_MASK_COUNT).toBeGreaterThanOrEqual(t.goal)
  })

  it('走完整個流程：泡泡被沖掉、濕了、擦乾、完成', () => {
    const soaped = scrubUntilAdvance(newBath(), t).state
    expect(soaped.step).toBe('rinse')
    const rinsed = scrubUntilAdvance(soaped, t).state
    expect(rinsed.step).toBe('dry')
    expect(rinsed.soap.some(Boolean)).toBe(false)
    expect(rinsed.wet.filter(Boolean).length).toBe(BATH_MASK_COUNT)
    const dried = scrubUntilAdvance(rinsed, t).state
    expect(dried.step).toBe('done')
    expect(dried.wet.some(Boolean)).toBe(false)
    expect(bathProgress(dried)).toBe(1)
    // 完成之後再抹沒有反應
    expect(bathStroke(dried, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, t).changed).toBe(0)
  })

  it('從托盤拖過來掃一趟不會就沖完', () => {
    const soaped = scrubUntilAdvance(newBath(), t).state
    const r = bathStroke(soaped, { x: 1.3, y: 0.1 }, { x: -0.3, y: 0.1 }, t)
    expect(r.state.step).toBe('rinse')
    expect(r.changed).toBeGreaterThan(0)
  })

  it('沖水的分母是抹過的格子：抹得少的孩子不會沖不完', () => {
    const soaped = scrubUntilAdvance(newBath(), t).state
    const r = scrubUntilAdvance(soaped, t)
    expect(r.strokes).toBeLessThan(12)
  })

  it('年齡分檔：3 歲最容易、6–7 歲要更仔細', () => {
    const a = bathTuning('3')
    const b = bathTuning('4-5')
    const c = bathTuning('6-7')
    expect(a.goal).toBeLessThan(b.goal)
    expect(b.goal).toBeLessThan(c.goal)
    expect(a.radius).toBeGreaterThan(b.radius)
    expect(b.radius).toBeGreaterThan(c.radius)
    expect(b.goal).toBe(0.7)
  })

  it('不改到傳進來的狀態', () => {
    const s = newBath()
    bathStroke(s, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.4 }, t)
    expect(s.soap.some(Boolean)).toBe(false)
  })
})

describe('v8.5 新玩具：沐浴球與泡泡造型', () => {
  it('沐浴球：3 種顏色，色相各不相同', () => {
    expect(BATH_BOMBS).toHaveLength(3)
    expect(new Set(BATH_BOMBS.map((b) => b.id)).size).toBe(3)
    expect(new Set(BATH_BOMBS.map((b) => b.hue)).size).toBe(3)
  })

  it('沐浴球：丟在寵物身上或旁邊一點都算丟進去，丟太遠不算', () => {
    for (const p of [{ x: 0.5, y: 0.5 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: -0.15, y: 0.5 }, { x: 1.15, y: 1.15 }]) expect(bombInBath(p)).toBe(true)
    for (const p of [{ x: -0.5, y: 0.5 }, { x: 1.6, y: 0.5 }, { x: 0.5, y: -0.4 }, { x: 0.5, y: 1.5 }]) expect(bombInBath(p)).toBe(false)
  })

  it('泡泡造型：圓圓的 → 尖尖頭 → 兔耳朵 → 皇冠 → 尖尖頭…（圓圓的只有一開始）', () => {
    expect(FOAM_HATS).toEqual(['spike', 'bunny', 'crown'])
    const seq: FoamHat[] = ['puff']
    for (let i = 0; i < 7; i++) seq.push(nextFoamHat(seq[seq.length - 1]))
    expect(seq).toEqual(['puff', 'spike', 'bunny', 'crown', 'spike', 'bunny', 'crown', 'spike'])
  })

  it('泡泡造型在頭頂，而且在寵物身上（那裡本來就抹得到泡泡）', () => {
    expect(FOAM_HAT_SPOT.x).toBe(0.5)
    expect(FOAM_HAT_SPOT.y).toBeLessThan(0.2)
  })

  it('沖水沖到頭頂造型就沒了；沖肚子、沖旁邊不會', () => {
    for (const age of ['3', '4-5', '6-7'] as const) {
      const tune = bathTuning(age)
      // 蓮蓬頭在頭頂上方一點：水往下流沖得到
      expect(rinseHitsHat({ x: 0.5, y: 0 }, { x: 0.5, y: 0 }, tune)).toBe(true)
      // 從左掃到右，中間經過頭頂（事件很稀也不會跳過去）
      expect(rinseHitsHat({ x: 0, y: 0.02 }, { x: 1, y: 0.02 }, tune)).toBe(true)
      // 沖肚子：水往下，不會往上沖到頭
      expect(rinseHitsHat({ x: 0.5, y: 0.7 }, { x: 0.5, y: 0.75 }, tune)).toBe(false)
      // 沖最旁邊
      expect(rinseHitsHat({ x: 0.02, y: 0 }, { x: 0.05, y: 0.05 }, tune)).toBe(false)
    }
  })
})
