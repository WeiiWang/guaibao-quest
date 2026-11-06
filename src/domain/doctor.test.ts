import { describe, expect, it } from 'vitest'
import { AILMENTS, AILMENT_STEPS, DOCTOR_TOOLS, SPOT_POS, TOOL_LINE, TOOL_SPOT, ailmentFor, applyDoctorTool, dayNumber, expectedTool, glowDelay, isExamTool, newVisit, onPetBox, visitDone, type Ailment } from './doctor'
import { STATIC_LINES } from '../learning/lines'

describe('小毛病依日期輪替', () => {
  it('同一天再看一次換下一個，四次輪完一圈', () => {
    const seen = [0, 1, 2, 3].map((r) => ailmentFor('2026-11-06', r))
    expect(new Set(seen).size).toBe(4)
    expect(ailmentFor('2026-11-06', 4)).toBe(seen[0])
  })
  it('隔天起點往後一個', () => {
    expect(ailmentFor('2026-11-07', 0)).toBe(ailmentFor('2026-11-06', 1))
  })
  it('跨月、跨年也是連續的', () => {
    expect(ailmentFor('2026-12-01', 0)).toBe(ailmentFor('2026-11-30', 1))
    expect(ailmentFor('2027-01-01', 0)).toBe(ailmentFor('2026-12-31', 1))
    expect(dayNumber('2027-03-01') - dayNumber('2027-02-28')).toBe(1)
  })
  it('同一天同一輪永遠一樣（不靠亂數）', () => {
    expect(ailmentFor('2026-11-06', 2)).toBe(ailmentFor('2026-11-06', 2))
  })
})

describe('每種毛病的工具', () => {
  it('每種 2 步、都是托盤上有的工具、不重複', () => {
    for (const a of AILMENTS) {
      const steps = AILMENT_STEPS[a]
      expect(steps).toHaveLength(2)
      expect(new Set(steps).size).toBe(steps.length)
      for (const t of steps) expect(DOCTOR_TOOLS).toContain(t)
    }
  })
  it('擦傷要貼 OK 繃，其他不用', () => {
    for (const a of AILMENTS) expect(AILMENT_STEPS[a].includes('bandage')).toBe(a === 'knee')
  })
  it('五樣工具都至少有一種毛病用得到', () => {
    const used = new Set(AILMENTS.flatMap((a) => AILMENT_STEPS[a]))
    expect(used.size).toBe(DOCTOR_TOOLS.length)
  })
  it('先檢查再處理', () => {
    for (const a of AILMENTS) {
      expect(isExamTool(AILMENT_STEPS[a][0])).toBe(true)
      expect(isExamTool(AILMENT_STEPS[a][1])).toBe(false)
    }
  })
  it('每個工具都有位置與台詞，台詞在 lines.ts 裡', () => {
    for (const t of DOCTOR_TOOLS) {
      const p = SPOT_POS[TOOL_SPOT[t]]
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(1)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(1)
      expect(typeof STATIC_LINES[TOOL_LINE[t]]).toBe('string')
    }
    for (const a of AILMENTS) expect(typeof STATIC_LINES[`pet.play.doctor.${a}`]).toBe('string')
    for (const k of ['intro', 'wrong', 'done']) expect(typeof STATIC_LINES[`pet.play.doctor.${k}`]).toBe('string')
  })
})

describe('看病', () => {
  const run = (a: Ailment, band: '3' | '4-5' | '6-7') => {
    let v = newVisit(a)
    const outs: string[] = []
    for (const t of AILMENT_STEPS[a]) {
      const r = applyDoctorTool(v, t, band)
      v = r.visit
      outs.push(r.outcome)
    }
    return { v, outs }
  }
  it('照順序用對：一步一步，最後看完', () => {
    for (const a of AILMENTS)
      for (const band of ['3', '4-5', '6-7'] as const) {
        const { v, outs } = run(a, band)
        expect(outs).toEqual(['step', 'done'])
        expect(visitDone(v)).toBe(true)
        expect(expectedTool(v)).toBeNull()
      }
  })
  it('OK 繃貼上後留在身上', () => {
    expect(run('knee', '4-5').v.bandaged).toBe(true)
    expect(run('sneeze', '4-5').v.bandaged).toBe(false)
  })
  it('3–5 歲用了別的工具：有反應、不往前、不算錯', () => {
    for (const band of ['3', '4-5'] as const) {
      const v = newVisit('throat')
      const r = applyDoctorTool(v, 'stetho', band)
      expect(r.outcome).toBe('play')
      expect(r.visit).toEqual(v)
    }
  })
  it('6–7 歲選錯：寵物說不是這裡，沒有扣分、進度不變', () => {
    const v = applyDoctorTool(newVisit('tummy'), 'stetho', '6-7').visit
    const r = applyDoctorTool(v, 'bandage', '6-7')
    expect(r.outcome).toBe('wrong')
    expect(r.visit).toEqual(v)
    expect(applyDoctorTool(r.visit, 'spoon', '6-7').outcome).toBe('done')
  })
  it('順序不能顛倒：還沒檢查就餵藥不算', () => {
    expect(applyDoctorTool(newVisit('sneeze'), 'spoon', '4-5').outcome).toBe('play')
    expect(applyDoctorTool(newVisit('sneeze'), 'spoon', '6-7').outcome).toBe('wrong')
  })
  it('看完之後還可以玩工具', () => {
    const { v } = run('throat', '6-7')
    expect(applyDoctorTool(v, 'thermo', '6-7')).toEqual({ visit: v, outcome: 'play' })
  })
})

describe('發亮', () => {
  it('3 歲馬上亮、4–5 歲 4 秒後亮、6–7 歲不亮', () => {
    expect(glowDelay('3')).toBe(0)
    expect(glowDelay('4-5')).toBe(4000)
    expect(glowDelay('6-7')).toBeNull()
  })
})

describe('放在寵物身上', () => {
  it('框裡與框邊都算，遠一點不算', () => {
    expect(onPetBox({ x: 0.5, y: 0.5 })).toBe(true)
    expect(onPetBox({ x: -0.05, y: 1.05 })).toBe(true)
    expect(onPetBox({ x: 1.3, y: 0.5 })).toBe(false)
  })
})
