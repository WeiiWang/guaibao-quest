/**
 * 點陣線稿 → 區塊表（region map）。純函式，不碰 DOM，單元測試與 Worker 都能用。
 *
 * 輸入：工作解析度（預設 768×768）的線條遮罩（1 = 線）。
 * 作法：非線條像素做 4-連通的 connected-component labeling（兩趟 + union-find，只用 typed array）。
 * - 標籤依「掃描順序（由上到下、由左到右）第一次碰到該區塊的像素」編號，所以同一張圖永遠得到同樣的編號。
 * - 小於全圖 0.04% 的碎塊併入線條（不可點），再重新編成連續的 1..N。regionId = `r<label>`。
 * - 外圍背景也是一個區塊（可以塗天空）。
 */
export const REGION_SIZE = 768
export const MIN_REGION_FRAC = 0.0004
/**
 * 挑戰（豐富）版線稿的碎塊門檻：細節多，0.04% 會留下 150 個上下的區塊（很多是 15×15 像素的小格子，
 * 7 歲的手指點不到）。0.12%（約 26×26 工作像素）會留下 70–100 個，放大 2–3 倍後每塊都點得到。
 */
export const MIN_REGION_FRAC_HARD = 0.0012
/** 填色往線條底下多鋪幾像素（避免線條邊緣的白縫） */
export const PAINT_DILATE = 2
/** 點在線上時，往外找最近區塊的半徑（工作解析度的像素） */
export const HIT_RADIUS = 8
/**
 * 畫板實際用的點線找區塊半徑：1× 時 14 像素（iPad 上約半個指尖），放大後手指更準，半徑跟著縮小
 *（螢幕上的距離大致不變），不低於 5。
 */
export const hitRadiusAt = (zoom: number): number => Math.max(5, Math.min(14, Math.round(14 / Math.max(1, zoom))))

export interface RegionInfo {
  /** `r<label>` */
  id: string
  label: number
  /** 面積（像素） */
  area: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface RegionMap {
  size: number
  /** 每個像素的區塊標籤，0 = 線條或碎塊（點下去不會填色，要用 regionAt 往外找） */
  labels: Uint16Array
  /** 填色用：標籤往線條底下外擴 PAINT_DILATE 像素後的結果 */
  paint: Uint16Array
  /** regions[label - 1] */
  regions: RegionInfo[]
}

export const regionIdOf = (label: number) => `r${label}`
export const labelOfId = (id: string): number => {
  const m = /^r(\d+)$/.exec(id)
  return m ? Number(m[1]) : 0
}

export function buildRegionMap(line: Uint8Array, size = REGION_SIZE, minFrac = MIN_REGION_FRAC): RegionMap {
  const n = size * size
  if (line.length !== n) throw new Error(`線條遮罩大小不對：${line.length} ≠ ${size}×${size}`)
  // ---- 第一趟：暫時標籤 + 合併表 ----
  const tmp = new Int32Array(n)
  const parent = new Int32Array((n >> 1) + 2)
  let next = 1
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  for (let y = 0; y < size; y++) {
    const row = y * size
    for (let x = 0; x < size; x++) {
      const i = row + x
      if (line[i]) continue
      const up = y > 0 ? tmp[i - size] : 0
      const left = x > 0 ? tmp[i - 1] : 0
      if (!up && !left) {
        parent[next] = next
        tmp[i] = next++
      } else if (up && left) {
        const ru = find(up)
        const rl = find(left)
        if (ru !== rl) {
          // 小的當根：不影響結果（最後依掃描順序重新編號），只是讓合併表穩定
          if (ru < rl) parent[rl] = ru
          else parent[ru] = rl
        }
        tmp[i] = ru < rl ? ru : rl
      } else tmp[i] = up || left
    }
  }
  // ---- 第二趟：依掃描順序給最終編號，並統計面積與外框 ----
  const order = new Int32Array(next) // 根 → 掃描順序編號（1 起）
  const areaRaw: number[] = [0]
  const minX: number[] = [0]
  const minY: number[] = [0]
  const maxX: number[] = [0]
  const maxY: number[] = [0]
  let raw = 0
  const rawOf = new Int32Array(n)
  for (let y = 0; y < size; y++) {
    const row = y * size
    for (let x = 0; x < size; x++) {
      const i = row + x
      const t = tmp[i]
      if (!t) continue
      const root = find(t)
      let id = order[root]
      if (!id) {
        id = ++raw
        order[root] = id
        areaRaw.push(0)
        minX.push(x)
        minY.push(y)
        maxX.push(x)
        maxY.push(y)
      }
      rawOf[i] = id
      areaRaw[id]++
      if (x < minX[id]) minX[id] = x
      if (x > maxX[id]) maxX[id] = x
      if (y > maxY[id]) maxY[id] = y // y 是遞增掃描，minY 在第一次出現時就定了
    }
  }
  // ---- 小碎塊併入線條，其餘重新編成連續的 1..N ----
  const minArea = Math.max(1, Math.round(n * minFrac))
  const finalOf = new Uint16Array(raw + 1)
  const regions: RegionInfo[] = []
  for (let r = 1; r <= raw; r++) {
    if (areaRaw[r] < minArea) continue
    const label = regions.length + 1
    finalOf[r] = label
    regions.push({ id: regionIdOf(label), label, area: areaRaw[r], minX: minX[r], minY: minY[r], maxX: maxX[r], maxY: maxY[r] })
  }
  const labels = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    const r = rawOf[i]
    if (r) labels[i] = finalOf[r]
  }
  return { size, labels, paint: dilateLabels(labels, size, PAINT_DILATE), regions }
}

/** 標籤往空白（0）的像素外擴 steps 次（4 鄰域，每次只讀上一輪的結果，所以不偏向某個方向） */
export function dilateLabels(labels: Uint16Array, size: number, steps: number): Uint16Array {
  let cur = labels
  for (let s = 0; s < steps; s++) {
    const out = new Uint16Array(cur)
    for (let y = 0; y < size; y++) {
      const row = y * size
      for (let x = 0; x < size; x++) {
        const i = row + x
        if (cur[i]) continue
        // 固定的檢查順序：上、左、右、下
        const v = (y > 0 ? cur[i - size] : 0) || (x > 0 ? cur[i - 1] : 0) || (x < size - 1 ? cur[i + 1] : 0) || (y < size - 1 ? cur[i + size] : 0)
        if (v) out[i] = v
      }
    }
    cur = out
  }
  return cur === labels ? new Uint16Array(labels) : cur
}

/**
 * (x, y)（工作解析度的像素）落在哪個區塊：點在區塊裡就是它；點在線上或碎塊上，
 * 往外找半徑 radius 內「最近」的區塊（距離相同時，掃描順序在前的贏，所以結果固定）。找不到回 0。
 */
export function regionAt(map: RegionMap, x: number, y: number, radius = HIT_RADIUS): number {
  const { size, labels } = map
  const cx = Math.round(x)
  const cy = Math.round(y)
  if (cx < 0 || cy < 0 || cx >= size || cy >= size) return 0
  const here = labels[cy * size + cx]
  if (here) return here
  let best = 0
  let bestD = radius * radius + 1
  const y0 = Math.max(0, cy - radius)
  const y1 = Math.min(size - 1, cy + radius)
  const x0 = Math.max(0, cx - radius)
  const x1 = Math.min(size - 1, cx + radius)
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const l = labels[yy * size + xx]
      if (!l) continue
      const d = (xx - cx) ** 2 + (yy - cy) ** 2
      if (d < bestD) {
        bestD = d
        best = l
      }
    }
  }
  return best
}

/** 區塊內部的一個代表點（e2e 與「提示該塗哪裡」用）：質心那一列上最長的一段的中間 */
export function regionAnchor(map: RegionMap, label: number): [number, number] {
  const info = map.regions[label - 1]
  const { size, labels } = map
  if (!info) return [size / 2, size / 2]
  let sx = 0
  let sy = 0
  let cnt = 0
  for (let y = info.minY; y <= info.maxY; y++) {
    for (let x = info.minX; x <= info.maxX; x++) {
      if (labels[y * size + x] === label) {
        sx += x
        sy += y
        cnt++
      }
    }
  }
  const cy = Math.round(sy / Math.max(1, cnt))
  // 質心那一列若沒有這個區塊（例如甜甜圈形），往上下找最近的一列
  let row = cy
  const has = (yy: number) => {
    if (yy < info.minY || yy > info.maxY) return false
    for (let x = info.minX; x <= info.maxX; x++) if (labels[yy * size + x] === label) return true
    return false
  }
  for (let d = 0; !has(row) && d < size; d++) row = has(cy + d) ? cy + d : has(cy - d) ? cy - d : row
  let bestLen = 0
  let bestMid = Math.round(sx / Math.max(1, cnt))
  let run = 0
  for (let x = info.minX; x <= info.maxX + 1; x++) {
    if (x <= info.maxX && labels[row * size + x] === label) run++
    else {
      if (run > bestLen) {
        bestLen = run
        bestMid = x - 1 - Math.floor((run - 1) / 2)
      }
      run = 0
    }
  }
  return [bestMid, row]
}
