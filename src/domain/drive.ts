// v8.4 線 AA：開車兜風的規則（純函式，畫面只負責畫與收手指）。
//
// 世界座標一律用「橫向」的 1000 × 700（俯視草地），直向畫面把 x、y 對調（transpose）就好，路線本身不用另外設計。
// 路是一條圓角矩形的環線（逆時針：下面往右 → 右邊往上 → 上面往左 → 左邊往下），6–7 歲多三條岔路通往三棟房子。
// 車子的位置用「沿著環線走了多遠」（s，不取餘數，繞一圈 +L）記，所以「繞一圈回到站牌」「這個紅燈這一圈亮過了沒」都只是比大小。
// 路上的事件（紅綠燈、斑馬線、站牌）位置固定、時機只看車子到哪裡與經過多久，沒有亂數，單元測試可以一步一步開。
import type { AgeBand } from './types'

export interface Pt {
  x: number
  y: number
}
/** 路上的一點與行進方向（弧度，0 = 往右，畫面座標 y 朝下） */
export interface RoadPose extends Pt {
  a: number
}

export const DRIVE_W = 1000
export const DRIVE_H = 700
/** 路面寬 */
export const ROAD_W = 76
/** 車長的一半（車子的位置 = 車身中心；停車要讓車頭停在線前） */
export const CAR_HALF = 40

// ---------- 環線 ----------
const X0 = 200
const Y0 = 200
const X1 = 800
const Y1 = 540
const R = 120

type Piece = { kind: 'line'; from: Pt; to: Pt; len: number } | { kind: 'arc'; c: Pt; th0: number; len: number }

const line = (from: Pt, to: Pt): Piece => ({ kind: 'line', from, to, len: Math.hypot(to.x - from.x, to.y - from.y) })
/** 四分之一圓，θ 從 th0 遞減 90°（畫面上是逆時針轉彎） */
const arc = (c: Pt, th0: number): Piece => ({ kind: 'arc', c, th0, len: (Math.PI / 2) * R })

const PIECES: Piece[] = [
  line({ x: 500, y: Y1 }, { x: X1 - R, y: Y1 }),
  arc({ x: X1 - R, y: Y1 - R }, Math.PI / 2),
  line({ x: X1, y: Y1 - R }, { x: X1, y: Y0 + R }),
  arc({ x: X1 - R, y: Y0 + R }, 0),
  line({ x: X1 - R, y: Y0 }, { x: X0 + R, y: Y0 }),
  arc({ x: X0 + R, y: Y0 + R }, -Math.PI / 2),
  line({ x: X0, y: Y0 + R }, { x: X0, y: Y1 - R }),
  arc({ x: X0 + R, y: Y1 - R }, Math.PI),
  line({ x: X0 + R, y: Y1 }, { x: 500, y: Y1 }),
]
const STARTS: number[] = []
let acc = 0
for (const p of PIECES) {
  STARTS.push(acc)
  acc += p.len
}
/** 環線一圈的長度 */
export const LOOP_LEN = acc

const mod = (s: number, n: number) => ((s % n) + n) % n

/** 環線上第 s 的位置與方向（s 可以是任何實數，會自動繞圈） */
export function loopAt(s: number): RoadPose {
  const u0 = mod(s, LOOP_LEN)
  let i = PIECES.length - 1
  while (i > 0 && STARTS[i] > u0) i--
  const p = PIECES[i]
  const u = u0 - STARTS[i]
  if (p.kind === 'line') {
    const k = p.len ? u / p.len : 0
    return { x: p.from.x + (p.to.x - p.from.x) * k, y: p.from.y + (p.to.y - p.from.y) * k, a: Math.atan2(p.to.y - p.from.y, p.to.x - p.from.x) }
  }
  const th = p.th0 - u / R
  return { x: p.c.x + R * Math.cos(th), y: p.c.y + R * Math.sin(th), a: Math.atan2(-Math.cos(th), Math.sin(th)) }
}

/** 環線的 SVG 路徑（畫路面、虛線用） */
export function loopPath(): string {
  const f = (n: number) => Math.round(n * 10) / 10
  const parts = [`M${f(500)} ${f(Y1)}`]
  for (const p of PIECES) {
    if (p.kind === 'line') parts.push(`L${f(p.to.x)} ${f(p.to.y)}`)
    else {
      const end = { x: p.c.x + R * Math.cos(p.th0 - Math.PI / 2), y: p.c.y + R * Math.sin(p.th0 - Math.PI / 2) }
      parts.push(`A${R} ${R} 0 0 0 ${f(end.x)} ${f(end.y)}`)
    }
  }
  return parts.join(' ') + ' Z'
}

/** 路邊往外的方向（環線外側）：沿著行進方向的右手邊 */
export const outward = (p: RoadPose): Pt => ({ x: -Math.sin(p.a), y: Math.cos(p.a) })
/** 從路中心往外側偏 d 的點 */
export const offsetPt = (p: RoadPose, d: number): Pt => {
  const n = outward(p)
  return { x: p.x + n.x * d, y: p.y + n.y * d }
}

// ---------- 路上的東西（位置固定） ----------
/** 站牌：車子停在這裡讓乘客上下車 */
export const STOP_S = 110
/** 紅綠燈的停止線；車身中心最多開到 LIGHT_BLOCK（車頭停在線前） */
export const LIGHT_S = 700
export const LIGHT_BLOCK = LIGHT_S - CAR_HALF - 6
/** 斑馬線（中心）與它的停車位置 */
export const CROSS_S = 1590
export const CROSS_HALF = 22
export const CROSS_BLOCK = CROSS_S - CROSS_HALF - CAR_HALF - 6
/** 車子離停車位置多近，紅燈 / 小動物就出現（車子已經看得到，又來得及停） */
export const TRIGGER_DIST = 130
/** 車子一開始停在哪 */
export const START_S = 0

export const YELLOW_MS = 700
export const RED_MS = 2600
export const CROSS_MS = 3200
/** 乘客上車 / 下車的時間（車子在站牌停著） */
export const BOARD_MS = 1300
export const OFF_MS = 1300

// ---------- 6–7 歲的岔路與房子 ----------
export type HouseColor = 'red' | 'blue' | 'yellow'
export interface Spur {
  house: HouseColor
  /** 岔路口在環線上的位置 */
  at: number
  /** 岔路的終點（車子停在房子前面） */
  end: Pt
  /** 房子中心 */
  houseAt: Pt
  len: number
}
const spur = (house: HouseColor, at: number, end: Pt, houseAt: Pt): Spur => {
  const j = loopAt(at)
  return { house, at, end, houseAt, len: Math.hypot(end.x - j.x, end.y - j.y) }
}
/** 右邊中間（紅）、上面中間（藍）、左邊中間（黃） */
export const SPURS: readonly Spur[] = [
  spur('red', STARTS[2] + 50, { x: 888, y: 370 }, { x: 950, y: 370 }),
  spur('blue', STARTS[4] + 180, { x: 500, y: 118 }, { x: 500, y: 56 }),
  spur('yellow', STARTS[6] + 50, { x: 112, y: 370 }, { x: 50, y: 370 }),
]
export const HOUSE_COLORS: readonly HouseColor[] = ['red', 'blue', 'yellow']

/** 這個年齡有沒有岔路（6–7 歲要自己選路送乘客回家） */
export const hasSpurs = (band: AgeBand): boolean => band === '6-7'
/** 3 歲：手指按著（或往哪裡拖都行）車子就自己沿路往前開 */
export const autoDrive = (band: AgeBand): boolean => band === '3'
/** 3 歲按著時的車速（世界單位 / 秒） */
export const AUTO_SPEED = 150
/** 手指拖車的最高車速（世界單位 / 秒）：手指停在前面，車子會自己慢慢開過去，不會瞬間跳過去 */
export const FOLLOW_SPEED = 520

export function spurAt(j: number, t: number): RoadPose {
  const sp = SPURS[j]
  const a = loopAt(sp.at)
  const k = sp.len ? Math.max(0, Math.min(1, t / sp.len)) : 0
  return { x: a.x + (sp.end.x - a.x) * k, y: a.y + (sp.end.y - a.y) * k, a: Math.atan2(sp.end.y - a.y, sp.end.x - a.x) }
}

// ---------- 乘客與過馬路的小動物（固定輪替） ----------
export const RIDER_ANIMALS = ['obj-bear', 'obj-rabbit', 'obj-chick', 'obj-cow'] as const
export const CROSS_ANIMALS = ['obj-chick', 'obj-rabbit', 'obj-cow', 'obj-bear'] as const
export const ANIMAL_EMOJI: Record<string, string> = { 'obj-bear': '🐻', 'obj-rabbit': '🐰', 'obj-chick': '🐥', 'obj-cow': '🐮' }
/** 第 n 位乘客是誰、想去哪棟房子（只有 6–7 歲用得到房子） */
export const riderAt = (n: number): { animal: string; house: HouseColor } => ({
  animal: RIDER_ANIMALS[mod(n, RIDER_ANIMALS.length)],
  house: (['red', 'yellow', 'blue', 'blue', 'red', 'yellow'] as const)[mod(n, 6)],
})
export const crosserAt = (n: number): string => CROSS_ANIMALS[mod(n, CROSS_ANIMALS.length)]

// ---------- 車子 ----------
export interface Car {
  /** -1 = 在環線上；0..2 = 在第幾條岔路上 */
  spur: number
  /** 環線上的位置（不取餘數）；在岔路上時是岔路口的位置 */
  s: number
  /** 岔路上離路口多遠 */
  t: number
  /** 倒著開（車頭朝路的反方向） */
  rev: boolean
}
export const startCar = (): Car => ({ spur: -1, s: START_S, t: 0, rev: false })

export function carPose(car: Car): RoadPose {
  const p = car.spur < 0 ? loopAt(car.s) : spurAt(car.spur, car.t)
  return car.rev ? { ...p, a: p.a + Math.PI } : p
}

/** 一次手指移動，車子最多沿路走多遠（手指甩很快也不會瞬間跳到環線另一邊） */
export const MOVE_WINDOW = 70

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** 在 [lo, hi] 裡找離 target 最近的點（先粗掃再細掃，路線短、算得起） */
function nearest(lo: number, hi: number, at: (u: number) => Pt, target: Pt): { u: number; d: number } {
  if (hi < lo) return { u: lo, d: Infinity }
  let best = { u: lo, d: dist(at(lo), target) }
  const step = 3
  for (let u = lo; u <= hi + 1e-9; u += step) {
    const d = dist(at(Math.min(u, hi)), target)
    if (d < best.d) best = { u: Math.min(u, hi), d }
  }
  const d2 = dist(at(hi), target)
  if (d2 < best.d) best = { u: hi, d: d2 }
  const a = Math.max(lo, best.u - step)
  const b = Math.min(hi, best.u + step)
  for (let u = a; u <= b + 1e-9; u += 0.5) {
    const d = dist(at(Math.min(u, b)), target)
    if (d < best.d) best = { u: Math.min(u, b), d }
  }
  return best
}

/** 這個位置最近的一次「at 這一點」（不取餘數的值） */
const nearestOcc = (s: number, at: number) => at + Math.round((s - at) / LOOP_LEN) * LOOP_LEN

/**
 * 手指在 target，車子沿路往那裡開：在車子附近（MOVE_WINDOW 內）的路上找離手指最近的點，所以手指離開路面車子也只會停在路上。
 * limit：往前最多開到哪（紅燈、斑馬線、站牌）。spurs：6–7 歲才有岔路。win：這一次最多走多遠（畫面用時間換算成車速上限）。
 */
export function moveToward(car: Car, target: Pt, limit: number, spurs: boolean, win = MOVE_WINDOW): Car {
  const W = Math.max(1, Math.min(MOVE_WINDOW, win))
  const cands: { car: Car; d: number }[] = []
  const lim = Math.max(limit, car.s)
  if (car.spur < 0) {
    const r = nearest(car.s - W, Math.min(car.s + W, lim), loopAt, target)
    cands.push({ car: { spur: -1, s: r.u, t: 0, rev: car.rev }, d: r.d - 4 })
    if (spurs)
      SPURS.forEach((sp, j) => {
        const occ = nearestOcc(car.s, sp.at)
        const gap = Math.abs(occ - car.s)
        if (gap > W || occ > lim) return
        const q = nearest(0, Math.min(sp.len, W - gap), (t) => spurAt(j, t), target)
        cands.push({ car: { spur: j, s: occ, t: q.u, rev: car.rev }, d: q.d })
      })
  } else {
    const sp = SPURS[car.spur]
    const q = nearest(Math.max(0, car.t - W), Math.min(sp.len, car.t + W), (t) => spurAt(car.spur, t), target)
    cands.push({ car: { ...car, t: q.u }, d: q.d - 4 })
    if (car.t < W) {
      const left = W - car.t
      const r = nearest(car.s - left, Math.min(car.s + left, Math.max(limit, car.s)), loopAt, target)
      cands.push({ car: { spur: -1, s: r.u, t: 0, rev: car.rev }, d: r.d })
    }
  }
  cands.sort((a, b) => a.d - b.d)
  const next = cands[0].car
  // 車頭方向：明顯往前開就朝前，明顯倒退就朝後（小小的抖動不翻車頭）
  const delta = next.spur < 0 && car.spur < 0 ? next.s - car.s : next.spur === car.spur ? next.t - car.t : next.spur >= 0 ? next.t : -(car.t)
  const toLoopBack = car.spur >= 0 && next.spur < 0
  if (toLoopBack) {
    // 從岔路回到環線：看接上環線之後往哪邊走
    const d2 = next.s - car.s
    if (Math.abs(d2) > 3) next.rev = d2 < 0
    else next.rev = false
  } else if (Math.abs(delta) > 6) next.rev = delta < 0
  return next
}

/** 3 歲：沿著環線往前開 d（不超過 limit） */
export function advance(car: Car, d: number, limit: number): Car {
  if (car.spur >= 0) return car
  const s = Math.min(car.s + d, Math.max(limit, car.s))
  return { ...car, s, rev: false }
}

// ---------- 事件 ----------
export type LightColor = 'green' | 'yellow' | 'red'
export type DriveCue = 'red' | 'green' | 'cross' | 'rider' | 'where' | 'arrive'
export type RiderPhase = 'wait' | 'board' | 'ride' | 'off'

export interface DriveState {
  band: AgeBand
  car: Car
  /** 這一輪紅燈（開始變黃的時間、擋在哪） */
  light: { at: number; block: number } | null
  /** 最後一次亮紅燈是哪一圈的（擋車位置），同一圈不重複 */
  lightDone: number
  cross: { at: number; block: number; n: number } | null
  crossDone: number
  crossN: number
  rider: { phase: RiderPhase; n: number; at: number; stopAt: number }
  /** 6–7 歲：停在哪棟（送錯的）房子前面，同一次不重複說 */
  wrongAt: number
  served: number
}

export function startDrive(band: AgeBand): DriveState {
  return {
    band,
    car: startCar(),
    light: null,
    lightDone: -Infinity,
    cross: null,
    crossDone: -Infinity,
    crossN: 0,
    rider: { phase: 'wait', n: 0, at: 0, stopAt: STOP_S },
    wrongAt: -1,
    served: 0,
  }
}

export function lightColor(st: Pick<DriveState, 'light'>, now: number): LightColor {
  if (!st.light) return 'green'
  const e = now - st.light.at
  if (e < YELLOW_MS) return 'yellow'
  if (e < YELLOW_MS + RED_MS) return 'red'
  return 'green'
}

/** 過馬路的小動物走到哪（0 = 外側路邊，1 = 內側路邊）；沒有在過回 null */
export function crossProgress(st: Pick<DriveState, 'cross'>, now: number): number | null {
  if (!st.cross) return null
  const k = (now - st.cross.at) / CROSS_MS
  return k >= 1 ? null : Math.max(0, k)
}

/** 下一個（還沒經過的）「at」：車子在 s，往前看 */
const nextOcc = (s: number, at: number) => at + Math.ceil((s - at - 1) / LOOP_LEN) * LOOP_LEN

/** 3–5 歲：乘客坐滿一圈回到站牌才下車；6–7 歲：送到想去的房子 */
const lapRider = (band: AgeBand) => !hasSpurs(band)

/** 車子現在往前最多能開到哪（紅燈、斑馬線、站牌上下車） */
export function driveLimit(st: DriveState, now: number): number {
  const s = st.car.s
  let lim = Infinity
  if (st.light && lightColor(st, now) !== 'green') lim = Math.min(lim, st.light.block)
  if (st.cross && crossProgress(st, now) !== null) lim = Math.min(lim, st.cross.block)
  const r = st.rider
  if (r.phase === 'wait' && st.car.spur < 0) lim = Math.min(lim, nextOcc(s, STOP_S))
  if (r.phase === 'board' || r.phase === 'off') lim = Math.min(lim, s)
  if (r.phase === 'ride' && lapRider(st.band)) lim = Math.min(lim, r.stopAt + LOOP_LEN)
  return Math.max(lim, s)
}

/**
 * 車子動過、或時間過了之後，看看路上發生什麼事。回傳新的狀態與寵物要說的話（依發生順序）。
 * 不改傳進來的 st。
 */
export function stepDrive(prev: DriveState, now: number): { st: DriveState; cues: DriveCue[] } {
  const st: DriveState = { ...prev, rider: { ...prev.rider } }
  const cues: DriveCue[] = []
  const car = st.car
  const onLoop = car.spur < 0

  // 紅綠燈：時間到變綠燈
  if (st.light && now - st.light.at >= YELLOW_MS + RED_MS) {
    st.light = null
    cues.push('green')
  }
  // 小動物過完馬路
  if (st.cross && now - st.cross.at >= CROSS_MS) st.cross = null

  // 車子靠近停止線：變黃燈再變紅燈（每一圈一次）
  if (!st.light && onLoop) {
    const occ = nextOcc(car.s, LIGHT_BLOCK)
    if (occ - car.s <= TRIGGER_DIST && occ > st.lightDone) {
      st.light = { at: now, block: occ }
      st.lightDone = occ
      cues.push('red')
    }
  }
  // 靠近斑馬線：小動物出來過馬路（每一圈一次，輪流換動物）
  if (!st.cross && onLoop) {
    const occ = nextOcc(car.s, CROSS_BLOCK)
    if (occ - car.s <= TRIGGER_DIST && occ > st.crossDone) {
      st.cross = { at: now, block: occ, n: st.crossN }
      st.crossDone = occ
      st.crossN += 1
      cues.push('cross')
    }
  }

  // 乘客
  const r = st.rider
  if (r.phase === 'wait' && onLoop) {
    const occ = nextOcc(car.s, STOP_S)
    if (occ - car.s <= 2) {
      st.rider = { phase: 'board', n: r.n, at: now, stopAt: occ }
      cues.push('rider')
    }
  } else if (r.phase === 'board' && now - r.at >= BOARD_MS) {
    st.rider = { ...r, phase: 'ride', at: now }
    if (hasSpurs(st.band)) cues.push('where')
  } else if (r.phase === 'ride') {
    if (lapRider(st.band)) {
      if (onLoop && car.s >= r.stopAt + LOOP_LEN - 2) {
        st.rider = { ...r, phase: 'off', at: now, stopAt: r.stopAt + LOOP_LEN }
        st.served += 1
        cues.push('arrive')
      }
    } else if (!onLoop && car.t >= SPURS[car.spur].len - 3) {
      if (SPURS[car.spur].house === riderAt(r.n).house) {
        st.rider = { ...r, phase: 'off', at: now }
        st.served += 1
        st.wrongAt = -1
        cues.push('arrive')
      } else if (st.wrongAt !== car.spur) {
        st.wrongAt = car.spur
        cues.push('where')
      }
    }
  } else if (r.phase === 'off' && now - r.at >= OFF_MS) {
    // 3–5 歲：下一位乘客就在站牌，馬上上車（像公車一樣）；6–7 歲：下一位在站牌等
    if (lapRider(st.band)) {
      st.rider = { phase: 'board', n: r.n + 1, at: now, stopAt: r.stopAt }
      cues.push('rider')
    } else st.rider = { phase: 'wait', n: r.n + 1, at: now, stopAt: STOP_S }
  }
  // 離開送錯的房子前面，下次再停過來會再提醒
  if (st.wrongAt >= 0 && (onLoop || car.spur !== st.wrongAt || car.t < SPURS[car.spur].len - 30)) st.wrongAt = -1
  return { st, cues }
}

// ---------- 直向畫面：x、y 對調 ----------
export const viewSize = (portrait: boolean) => (portrait ? { w: DRIVE_H, h: DRIVE_W } : { w: DRIVE_W, h: DRIVE_H })
export const toView = (p: Pt, portrait: boolean): Pt => (portrait ? { x: p.y, y: p.x } : p)
/** 方向角也要跟著對調：(cos a, sin a) → (sin a, cos a) */
export const angleToView = (a: number, portrait: boolean): number => (portrait ? Math.PI / 2 - a : a)
