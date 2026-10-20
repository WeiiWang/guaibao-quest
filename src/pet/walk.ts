// 散步路徑（SPEC-v3 A2）：在可視範圍內挑一個目標，遇到家具就停在前面。純函式。

/** 擋路的家具水平範圍（房間寬度比例） */
export interface Obstacle {
  left: number
  right: number
}

export interface WalkInput {
  /** 目前 x（中心，房間寬度比例） */
  fromX: number
  rng: () => number
  /** 可走的範圍（中心點可以到的最左/最右，已扣掉寵物半寬） */
  minX: number
  maxX: number
  /** 寵物半寬（房間寬度比例） */
  halfW: number
  obstacles: readonly Obstacle[]
  /** 至少要走多遠才算「散步」（比例） */
  minDist?: number
}

export interface WalkPlan {
  toX: number
  dir: 1 | -1
  /** 因為家具而提早停下 */
  blocked: boolean
}

/** 走路時，寵物身體離家具邊緣保留的空隙（半寬的比例） */
const STOP_GAP = 0.15

/**
 * 從 fromX 走向 toX 的過程中，如果會撞到家具，就停在家具前面。
 * 起點已經貼著家具（在家具範圍內）時，該家具不擋（可以離開）。
 */
export function clipWalk(fromX: number, toX: number, halfW: number, obstacles: readonly Obstacle[]): { x: number; blocked: boolean } {
  const dir = toX >= fromX ? 1 : -1
  let x = toX
  let blocked = false
  for (const o of obstacles) {
    if (dir === 1) {
      const stop = o.left - halfW * (1 + STOP_GAP)
      // 寵物右緣 = fromX + halfW；還沒碰到家具左緣才算「擋在前面」
      if (fromX + halfW <= o.left && x > stop) {
        x = Math.max(fromX, stop)
        blocked = true
      }
    } else {
      const stop = o.right + halfW * (1 + STOP_GAP)
      if (fromX - halfW >= o.right && x < stop) {
        x = Math.min(fromX, stop)
        blocked = true
      }
    }
  }
  return { x, blocked }
}

export function pickWalk(i: WalkInput): WalkPlan | null {
  const minDist = i.minDist ?? 0.06
  const lo = Math.min(i.minX, i.maxX)
  const hi = Math.max(i.minX, i.maxX)
  if (hi - lo < minDist) return null
  // 試幾次，挑一個夠遠的目標
  for (let k = 0; k < 6; k++) {
    const target = lo + i.rng() * (hi - lo)
    if (Math.abs(target - i.fromX) < minDist) continue
    const dir: 1 | -1 = target >= i.fromX ? 1 : -1
    const c = clipWalk(i.fromX, target, i.halfW, i.obstacles)
    if (Math.abs(c.x - i.fromX) < 0.02) continue
    return { toX: c.x, dir, blocked: c.blocked }
  }
  return null
}

/** 走到指定位置（例如畫面中央、球旁邊）：一樣會被家具擋住 */
export function walkTo(fromX: number, targetX: number, halfW: number, obstacles: readonly Obstacle[], minX: number, maxX: number): WalkPlan | null {
  const clamped = Math.min(Math.max(targetX, minX), maxX)
  if (Math.abs(clamped - fromX) < 0.01) return null
  const c = clipWalk(fromX, clamped, halfW, obstacles)
  if (Math.abs(c.x - fromX) < 0.005) return null
  return { toX: c.x, dir: clamped >= fromX ? 1 : -1, blocked: c.blocked }
}

/** 走路速度：每秒走幾個「寵物寬度」（隨螢幕大小縮放，小螢幕不會慢吞吞） */
export const WALK_WIDTHS_PER_SEC = 1.1
export const WALK_MIN_MS = 700

export function walkDurationMs(distFrac: number, petWFrac: number): number {
  if (petWFrac <= 0) return WALK_MIN_MS
  return Math.max(WALK_MIN_MS, Math.round((Math.abs(distFrac) / petWFrac / WALK_WIDTHS_PER_SEC) * 1000))
}
