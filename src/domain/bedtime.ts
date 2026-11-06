// v8.4 晚安小屋（純函式）。只是扮演：不碰寵物真正的作息與睡覺狀態，不寫任何資料。
// 刷牙 → 換睡衣 → 聽故事或搖籃曲 → 關燈 → 睡著（點牠會翻身說夢話）。不分年齡檔。

export type BedStep = 'brush' | 'pajamas' | 'story' | 'lamp' | 'asleep'

export const BED_STEPS: readonly BedStep[] = ['brush', 'pajamas', 'story', 'lamp', 'asleep']

export const nextBedStep = (s: BedStep): BedStep => BED_STEPS[Math.min(BED_STEPS.length - 1, BED_STEPS.indexOf(s) + 1)]

/** 每一步開始時寵物說的話 */
export const BED_STEP_LINE: Record<BedStep, string> = {
  brush: 'pet.play.bedtime.brush',
  pajamas: 'pet.play.bedtime.pajamas',
  story: 'pet.play.bedtime.story',
  lamp: 'pet.play.bedtime.light',
  asleep: 'pet.play.bedtime.night',
}

// ---- 刷牙：牙刷在嘴巴附近來回移動，累積移動距離 ----
// 座標是寵物框（正方形）裡的比例

/** 嘴巴附近：寬一點，3 歲手不穩也刷得到 */
export const MOUTH_ZONE = { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.16 }

/** 要刷多少距離（寵物框邊長的倍數）：大約左右來回 4 趟 */
export const BRUSH_GOAL = 2

export interface BrushPoint {
  x: number
  y: number
}

export const inMouthZone = ({ x, y }: BrushPoint): boolean => ((x - MOUTH_ZONE.cx) / MOUTH_ZONE.rx) ** 2 + ((y - MOUTH_ZONE.cy) / MOUTH_ZONE.ry) ** 2 <= 1

/** 這一小段算進刷牙距離多少：起點或終點在嘴巴附近才算；一次最多算 0.4（瞬間跳過去不算刷） */
export function brushGain(from: BrushPoint, to: BrushPoint): number {
  if (!inMouthZone(from) && !inMouthZone(to)) return 0
  return Math.min(0.4, Math.hypot(to.x - from.x, to.y - from.y))
}

export const brushProgress = (dist: number): number => Math.max(0, Math.min(1, dist / BRUSH_GOAL))

// ---- 搖籃曲：布拉姆斯搖籃曲（公版）的開頭，C 大調 ----

export const LULLABY_FREQ: Record<string, number> = {
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
}

/** [音, 拍數]。3/4 拍 */
export const LULLABY: readonly (readonly [string, number])[] = [
  ['E4', 0.5], ['E4', 0.5], ['G4', 2],
  ['E4', 0.5], ['E4', 0.5], ['G4', 2],
  ['E4', 0.5], ['G4', 0.5], ['C5', 1], ['B4', 1.5], ['A4', 0.5], ['A4', 1], ['G4', 2],
  ['D4', 0.5], ['E4', 0.5], ['F4', 1], ['D4', 1], ['D4', 0.5], ['E4', 0.5], ['F4', 2],
  ['D4', 0.5], ['F4', 0.5], ['B4', 0.5], ['A4', 0.5], ['G4', 1], ['B4', 1], ['C5', 3],
]

/** 一拍幾秒（慢慢的） */
export const LULLABY_BEAT_S = 0.42

/** 每個音什麼時候開始、多長（秒） */
export function lullabySchedule(beat = LULLABY_BEAT_S): { freq: number; at: number; dur: number }[] {
  let t = 0
  return LULLABY.map(([note, beats]) => {
    const at = t
    t += beats * beat
    return { freq: LULLABY_FREQ[note], at, dur: beats * beat }
  })
}

export const lullabySeconds = (beat = LULLABY_BEAT_S): number => LULLABY.reduce((s, [, b]) => s + b, 0) * beat

/** 故事書有幾頁（沒有字，只有圖：月亮、雲、星星） */
export const STORY_PAGES = 3
/** 一頁停多久（毫秒）；孩子點書可以自己翻快一點 */
export const STORY_PAGE_MS = 2200
