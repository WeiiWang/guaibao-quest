import { describe, expect, it } from 'vitest'
import {
  CROSS_BLOCK,
  CROSS_MS,
  DRIVE_H,
  DRIVE_W,
  LIGHT_BLOCK,
  LOOP_LEN,
  MOVE_WINDOW,
  RED_MS,
  ROAD_W,
  SPURS,
  STOP_S,
  YELLOW_MS,
  advance,
  angleToView,
  carPose,
  crossProgress,
  crosserAt,
  driveLimit,
  lightColor,
  loopAt,
  moveToward,
  offsetPt,
  riderAt,
  startDrive,
  stepDrive,
  toView,
  type DriveCue,
  type DriveState,
} from './drive'
import type { AgeBand } from './types'

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps

/** 像孩子一樣開去某棟房子：在別的岔路先倒回環線，沿著環線往前，到了岔路口再往房子拖 */
const toHouse = (j: number) => (st: DriveState) => {
  const car = st.car
  if (car.spur >= 0 && car.spur !== j) return loopAt(SPURS[car.spur].at + 40)
  if (car.spur === j) return SPURS[j].houseAt
  const gap = (((SPURS[j].at - car.s) % LOOP_LEN) + LOOP_LEN) % LOOP_LEN
  return gap < 40 || gap > LOOP_LEN - 20 ? SPURS[j].houseAt : loopAt(car.s + 40)
}

/** 模擬一根手指一直放在車子前面 40 的路上，每 50ms 動一次；回傳經過的事 */
function drive(st0: DriveState, ms: number, t0 = 0, target?: (st: DriveState) => { x: number; y: number }) {
  let st = st0
  const cues: { t: number; cue: DriveCue }[] = []
  for (let t = t0; t <= t0 + ms; t += 50) {
    const goal = target ? target(st) : loopAt(st.car.s + 40)
    st = { ...st, car: moveToward(st.car, goal, driveLimit(st, t), st.band === '6-7') }
    const r = stepDrive(st, t)
    st = r.st
    for (const c of r.cues) cues.push({ t, cue: c })
  }
  return { st, cues }
}

describe('開車：路線', () => {
  it('環線首尾相接、方向連續（每一段接得起來）', () => {
    expect(near(loopAt(0).x, 500) && near(loopAt(0).y, 540)).toBe(true)
    expect(near(loopAt(0).a, 0)).toBe(true)
    const end = loopAt(LOOP_LEN - 0.001)
    expect(Math.hypot(end.x - 500, end.y - 540)).toBeLessThan(0.01)
    for (let s = 0; s < LOOP_LEN; s += 1) {
      const a = loopAt(s)
      const b = loopAt(s + 1)
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1.001)
      const da = Math.abs(Math.atan2(Math.sin(b.a - a.a), Math.cos(b.a - a.a)))
      expect(da).toBeLessThan(0.02)
    }
  })
  it('路和房子都在畫面裡（含路面寬度）', () => {
    for (let s = 0; s < LOOP_LEN; s += 5) {
      const p = loopAt(s)
      expect(p.x - ROAD_W / 2).toBeGreaterThan(0)
      expect(p.x + ROAD_W / 2).toBeLessThan(DRIVE_W)
      expect(p.y - ROAD_W / 2).toBeGreaterThan(0)
      expect(p.y + ROAD_W / 2).toBeLessThan(DRIVE_H)
    }
    for (const sp of SPURS) {
      expect(sp.houseAt.x - 48).toBeGreaterThanOrEqual(0)
      expect(sp.houseAt.x + 48).toBeLessThanOrEqual(DRIVE_W)
      expect(sp.houseAt.y - 48).toBeGreaterThanOrEqual(0)
      expect(sp.houseAt.y + 48).toBeLessThanOrEqual(DRIVE_H)
    }
  })
  it('路邊的「外側」真的在環線外面', () => {
    const c = { x: 500, y: 370 }
    for (let s = 0; s < LOOP_LEN; s += 50) {
      const p = loopAt(s)
      const o = offsetPt(p, 60)
      expect(Math.hypot(o.x - c.x, o.y - c.y)).toBeGreaterThan(Math.hypot(p.x - c.x, p.y - c.y))
    }
  })
  it('直向畫面把 x、y 對調，方向也跟著換', () => {
    expect(toView({ x: 10, y: 20 }, true)).toEqual({ x: 20, y: 10 })
    expect(toView({ x: 10, y: 20 }, false)).toEqual({ x: 10, y: 20 })
    // 往右（0）在直向變成往下（π/2）
    expect(near(angleToView(0, true), Math.PI / 2)).toBe(true)
  })
})

describe('開車：手指拖車', () => {
  it('手指離開路面，車子還是在路上（投影到最近的路）', () => {
    const st = startDrive('4-5')
    const car = moveToward(st.car, { x: 540, y: 300 }, Infinity, false)
    const p = carPose(car)
    // 車子在環線上：y 還是下面那條路
    expect(near(p.y, 540, 0.5)).toBe(true)
    expect(p.x).toBeGreaterThan(500)
  })
  it('一次最多走 MOVE_WINDOW（手指甩到另一邊也不會瞬移）', () => {
    const st = startDrive('4-5')
    const car = moveToward(st.car, loopAt(600), Infinity, false)
    expect(car.s).toBeLessThanOrEqual(MOVE_WINDOW + 0.01)
    expect(car.s).toBeGreaterThan(MOVE_WINDOW - 1)
  })
  it('往前開車頭朝前，倒車車頭朝後', () => {
    let car = moveToward({ spur: -1, s: 300, t: 0, rev: false }, loopAt(340), Infinity, false)
    expect(car.rev).toBe(false)
    car = moveToward(car, loopAt(280), Infinity, false)
    expect(car.rev).toBe(true)
    // 方向角反過來
    expect(near(Math.cos(carPose(car).a), -Math.cos(loopAt(car.s).a), 1e-6)).toBe(true)
  })
  it('limit 擋得住：手指再往前，車子也停在停止線前', () => {
    const car = moveToward({ spur: -1, s: LIGHT_BLOCK - 20, t: 0, rev: false }, loopAt(LIGHT_BLOCK + 60), LIGHT_BLOCK, false)
    expect(car.s).toBeLessThanOrEqual(LIGHT_BLOCK + 1e-9)
  })
  it('3 歲：按著就往前開，也會被擋住', () => {
    const car = advance({ spur: -1, s: 0, t: 0, rev: false }, 50, Infinity)
    expect(car.s).toBe(50)
    expect(advance(car, 500, 80).s).toBe(80)
  })
  it('沒有岔路的年齡，手指在房子那邊車子也不會離開環線', () => {
    const sp = SPURS[0]
    let car = { spur: -1, s: sp.at - 10, t: 0, rev: false }
    for (let i = 0; i < 10; i++) car = moveToward(car, sp.houseAt, Infinity, false)
    expect(car.spur).toBe(-1)
  })
  it('6–7 歲：在岔路口把車往房子拖就開進岔路，開到底停在房子前', () => {
    const sp = SPURS[0]
    let car = { spur: -1, s: sp.at - 30, t: 0, rev: false }
    for (let i = 0; i < 10; i++) car = moveToward(car, sp.houseAt, Infinity, true)
    expect(car.spur).toBe(0)
    expect(near(car.t, sp.len, 0.6)).toBe(true)
    // 再拖回環線
    for (let i = 0; i < 10; i++) car = moveToward(car, loopAt(sp.at + 60), Infinity, true)
    expect(car.spur).toBe(-1)
  })
})

describe('開車：路上的事件', () => {
  it('紅綠燈：靠近才變黃再變紅，紅燈時車子停在停止線前；過幾秒變綠燈才能走', () => {
    let st: DriveState = { ...startDrive('4-5'), rider: { phase: 'ride', n: 0, at: 0, stopAt: STOP_S } }
    st = { ...st, car: { ...st.car, s: LIGHT_BLOCK - 300 } }
    // 開到停止線附近
    const r1 = drive(st, 3000)
    const red = r1.cues.find((c) => c.cue === 'red')
    expect(red).toBeTruthy()
    // 紅燈期間車子沒有超過停止線
    const st1 = r1.st
    expect(st1.car.s).toBeLessThanOrEqual(LIGHT_BLOCK + 1e-9)
    expect(lightColor(st1, red!.t + YELLOW_MS + 10)).toBe('red')
    expect(lightColor(st1, red!.t + 10)).toBe('yellow')
    // 綠燈之後會說 green，並且開過去
    const r2 = drive(st1, 4000, 3050)
    expect(r2.cues.some((c) => c.cue === 'green')).toBe(true)
    const green = r2.cues.find((c) => c.cue === 'green')!
    expect(green.t - red!.t).toBeGreaterThanOrEqual(YELLOW_MS + RED_MS)
    expect(r2.st.car.s).toBeGreaterThan(LIGHT_BLOCK + 100)
    // 同一圈不會再亮紅燈
    expect(r2.cues.filter((c) => c.cue === 'red')).toHaveLength(0)
  })
  it('紅燈真的停得住：手指一直往前拖，整個紅燈期間車頭都沒過線', () => {
    let st: DriveState = { ...startDrive('6-7'), rider: { phase: 'ride', n: 0, at: 0, stopAt: STOP_S } }
    st = { ...st, car: { ...st.car, s: LIGHT_BLOCK - 120 } }
    let t = 0
    let maxRed = -Infinity
    for (; t < 3000; t += 20) {
      st = { ...st, car: moveToward(st.car, loopAt(st.car.s + 200), driveLimit(st, t), true) }
      st = stepDrive(st, t).st
      if (lightColor(st, t) !== 'green') maxRed = Math.max(maxRed, st.car.s)
    }
    expect(maxRed).toBeLessThanOrEqual(LIGHT_BLOCK + 1e-9)
  })
  it('斑馬線：小動物過完才能走，輪流換動物', () => {
    let st: DriveState = { ...startDrive('4-5'), rider: { phase: 'ride', n: 0, at: 0, stopAt: STOP_S } }
    st = { ...st, car: { ...st.car, s: CROSS_BLOCK - 260 } }
    const r = drive(st, 6000)
    const c = r.cues.find((x) => x.cue === 'cross')!
    expect(c).toBeTruthy()
    expect(crossProgress({ cross: { at: c.t, block: 0, n: 0 } }, c.t + CROSS_MS / 2)).toBeCloseTo(0.5)
    expect(crossProgress({ cross: { at: c.t, block: 0, n: 0 } }, c.t + CROSS_MS)).toBeNull()
    expect(r.st.car.s).toBeGreaterThan(CROSS_BLOCK)
    expect(crosserAt(0)).not.toBe(crosserAt(1))
  })
  it('過馬路期間車子停在斑馬線前', () => {
    let st: DriveState = { ...startDrive('4-5'), rider: { phase: 'ride', n: 0, at: 0, stopAt: STOP_S } }
    st = { ...st, car: { ...st.car, s: CROSS_BLOCK - 100 } }
    for (let t = 0; t < CROSS_MS - 100; t += 20) {
      st = { ...st, car: moveToward(st.car, loopAt(st.car.s + 200), driveLimit(st, t), false) }
      st = stepDrive(st, t).st
    }
    expect(st.cross).not.toBeNull()
    expect(st.car.s).toBeLessThanOrEqual(CROSS_BLOCK + 1e-9)
  })
})

describe('開車：載乘客', () => {
  const lap = (band: AgeBand) => {
    const r = drive(startDrive(band), 40000)
    return r
  }
  it.each(['3', '4-5'] as const)('%s 歲：站牌上車，繞一圈回到站牌下車，下一位接著上車', (band) => {
    const r = lap(band)
    const seq = r.cues.map((c) => c.cue)
    expect(seq[0]).toBe('rider')
    const arrive = seq.indexOf('arrive')
    expect(arrive).toBeGreaterThan(0)
    // 一圈裡有紅燈、綠燈、斑馬線
    expect(seq.slice(0, arrive)).toEqual(expect.arrayContaining(['red', 'green', 'cross']))
    expect(seq[arrive + 1]).toBe('rider')
    expect(r.st.served).toBeGreaterThanOrEqual(1)
    // 3–5 歲不會說「想去哪」
    expect(seq).not.toContain('where')
  })
  it('3 歲按著就自己開：一樣會停紅燈、等小動物、載完一位', () => {
    let st = startDrive('3')
    const cues: DriveCue[] = []
    for (let t = 0; t < 40000; t += 50) {
      st = { ...st, car: advance(st.car, 150 * 0.05, driveLimit(st, t)) }
      const r = stepDrive(st, t)
      st = r.st
      cues.push(...r.cues)
    }
    expect(cues).toEqual(expect.arrayContaining(['rider', 'red', 'green', 'cross', 'arrive']))
    expect(st.served).toBeGreaterThanOrEqual(1)
  })
  it('上車、下車時車子停在站牌不動', () => {
    let st = startDrive('4-5')
    st = { ...st, car: { ...st.car, s: STOP_S - 1 } }
    st = stepDrive(st, 0).st
    expect(st.rider.phase).toBe('board')
    expect(driveLimit(st, 100)).toBe(st.car.s)
  })
  it('6–7 歲：上車說「想去哪」，送錯房子提醒一次，送對才下車', () => {
    let st = startDrive('6-7')
    const all: DriveCue[] = []
    // 先到站牌載客
    let r = drive(st, 3000)
    st = r.st
    all.push(...r.cues.map((c) => c.cue))
    expect(all.slice(0, 2)).toEqual(['rider', 'where'])
    expect(st.rider.phase).toBe('ride')
    const want = riderAt(st.rider.n).house
    const wrong = SPURS.findIndex((s) => s.house !== want && s.house !== 'blue')
    const right = SPURS.findIndex((s) => s.house === want)
    // 先開到錯的房子（往房子拖）
    r = drive(st, 15000, 3050, toHouse(wrong))
    st = r.st
    expect(st.car.spur).toBe(wrong)
    expect(r.cues.filter((c) => c.cue === 'where')).toHaveLength(1)
    expect(st.rider.phase).toBe('ride')
    // 再開到對的房子
    r = drive(st, 30000, 18100, toHouse(right))
    st = r.st
    expect(r.cues.map((c) => c.cue)).toContain('arrive')
    expect(st.served).toBe(1)
    // 下一位乘客在站牌等
    r = drive(st, 2000, 48200, () => SPURS[right].houseAt)
    expect(r.st.rider.phase).toBe('wait')
    expect(r.st.rider.n).toBe(1)
  })
  it('乘客與想去的房子固定輪替（不用亂數）', () => {
    expect(riderAt(0)).toEqual(riderAt(0))
    expect(new Set([0, 1, 2, 3].map((i) => riderAt(i).animal)).size).toBe(4)
    expect(new Set([0, 1, 2, 3, 4, 5].map((i) => riderAt(i).house)).size).toBe(3)
  })
})
