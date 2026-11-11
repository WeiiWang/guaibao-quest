// v8.4 線 AA：照相館的規則（純函式）。
//
// 照片是方的（跟畫廊的畫框、拼圖一樣是正方形，拍到的就是畫廊裡看到的），合成後存成 JPEG 進 coloring 表：
// pageId = 'g:photo-<時間戳>'（畫廊作品的 'g:' 開頭，畫廊、掛到房間、刪除、拼圖都不用改就讀得到），basePageId = 'photo'。
// 照片不算「畫完一幅」：畫框收藏與畫畫星星都只在 repo.completeColoring 累計，照片不經過那裡（photo.test.ts 驗證）。

/** 佈景：現有的場景圖（挑漂亮、中間乾淨的），檔名是 public/art/<id>.jpg */
export const PHOTO_BACKDROPS: readonly { id: string; tone: string }[] = [
  { id: 'scene-play-sky', tone: '#bfe3ff' },
  { id: 'scene-play-orchard', tone: '#cdeeb4' },
  { id: 'scene-play-music', tone: '#e6c8f0' },
  { id: 'scene-stage-huaguoshan', tone: '#cfe9d8' },
  { id: 'scene-stage-nature', tone: '#d8f0c4' },
  { id: 'scene-stage-shuiliandong', tone: '#cfe0f5' },
  { id: 'scene-place-playground', tone: '#d9f2d0' },
  { id: 'scene-stage-english', tone: '#ffe3c9' },
]

export type PhotoPose = 'happy' | 'cheer' | 'dance' | 'laugh' | 'shy'
/** 點寵物換下一個姿勢 */
export const PHOTO_POSES: readonly PhotoPose[] = ['happy', 'cheer', 'dance', 'laugh', 'shy']
export const nextPose = (p: PhotoPose): PhotoPose => PHOTO_POSES[(PHOTO_POSES.indexOf(p) + 1) % PHOTO_POSES.length]

/** 寵物三種大小（佔照片邊長的比例） */
export const PET_SIZES: readonly number[] = [0.4, 0.55, 0.72]
export const nextSize = (i: number): number => (i + 1) % PET_SIZES.length
/** 雙指縮放：從 i 那一檔開始，兩指距離變成 ratio 倍，取最接近的一檔 */
export function pinchSize(i: number, ratio: number): number {
  return nearestSize(PET_SIZES, i, ratio)
}

/** 寵物（腳底中心）能站的範圍（百分比）：不會整隻跑出照片 */
export function clampPet(x: number, y: number, size: number): { x: number; y: number } {
  const half = (size * 100) / 2
  return { x: Math.max(half * 0.6, Math.min(100 - half * 0.6, x)), y: Math.max(size * 100 * 0.7, Math.min(100, y)) }
}
export const PET_START = { x: 50, y: 92 }

/** 照片上最多幾張貼紙 */
export const PHOTO_MAX_STICKERS = 12
/** 點一下貼紙（不拖）時依序貼的位置（百分比），避開寵物站的正中間 */
const AUTO_SPOTS: readonly [number, number][] = [
  [18, 20], [82, 20], [16, 62], [84, 62], [36, 12], [64, 12], [12, 40], [88, 40], [30, 80], [70, 80], [50, 8], [22, 88],
]
export const stickerSpot = (n: number): { x: number; y: number } => {
  const [x, y] = AUTO_SPOTS[((n % AUTO_SPOTS.length) + AUTO_SPOTS.length) % AUTO_SPOTS.length]
  return { x, y }
}
/** 貼紙放在照片裡（含一點點邊緣）才算；拖出去就拿掉 */
export const insidePhoto = (x: number, y: number): boolean => x >= -4 && x <= 104 && y >= -4 && y <= 104
export const clampSticker = (v: number): number => Math.max(4, Math.min(96, v))
/** 貼紙大小（佔照片邊長） */
export const STICKER_SIZE = 0.16

// ---------- v8.5 新玩具「動物朋友」：盤子多一排動物，可以拖進來一起拍 ----------
export const PHOTO_FRIENDS: readonly { art: string; emoji: string }[] = [
  { art: 'obj-bear', emoji: '🐻' },
  { art: 'obj-rabbit', emoji: '🐰' },
  { art: 'obj-chick', emoji: '🐥' },
  { art: 'obj-cow', emoji: '🐮' },
  { art: 'obj-fish', emoji: '🐟' },
  { art: 'obj-octopus', emoji: '🐙' },
]
/** 動物朋友三種大小（佔照片邊長）：比貼紙大，站在寵物旁邊像一起合照 */
export const FRIEND_SIZES: readonly number[] = [0.2, 0.3, 0.42]
/** 一放進來是中間那一檔 */
export const FRIEND_START_SIZE = 1
/** 點一下動物朋友換下一檔大小 */
export const nextFriendSize = (i: number): number => (i + 1) % FRIEND_SIZES.length
/** 雙指縮放（寵物與動物朋友共用）：從 sizes[i] 開始，兩指距離變成 ratio 倍，取最接近的一檔 */
export function nearestSize(sizes: readonly number[], i: number, ratio: number): number {
  const want = sizes[i] * ratio
  let best = 0
  for (let k = 1; k < sizes.length; k++) if (Math.abs(sizes[k] - want) < Math.abs(sizes[best] - want)) best = k
  return best
}
/** 照片上最多幾位動物朋友（每種一位剛好） */
export const PHOTO_MAX_FRIENDS = 6
/** 點一下動物（不拖）時依序站的位置（百分比，身體中間）：寵物的左右兩邊，靠下面站著 */
const FRIEND_SPOTS: readonly [number, number][] = [
  [18, 78], [82, 78], [14, 52], [86, 52], [16, 26], [84, 26],
]
export const friendSpot = (n: number): { x: number; y: number } => {
  const [x, y] = FRIEND_SPOTS[((n % FRIEND_SPOTS.length) + FRIEND_SPOTS.length) % FRIEND_SPOTS.length]
  return { x, y }
}

// ---------- v8.5 新玩具「相框與色調」：拍之前選，會真的畫進照片 ----------
export type PhotoFrame = 'none' | 'stars' | 'hearts' | 'film'
export const PHOTO_FRAMES: readonly PhotoFrame[] = ['none', 'stars', 'hearts', 'film']
export const nextFrame = (f: PhotoFrame): PhotoFrame => PHOTO_FRAMES[(PHOTO_FRAMES.indexOf(f) + 1) % PHOTO_FRAMES.length]
export type PhotoTone = 'plain' | 'warm' | 'mono'
export const PHOTO_TONES: readonly PhotoTone[] = ['plain', 'warm', 'mono']
export const nextTone = (t: PhotoTone): PhotoTone => PHOTO_TONES[(PHOTO_TONES.indexOf(t) + 1) % PHOTO_TONES.length]

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))
/** 一個像素換色調：暖暖 = 偏黃偏亮一點點（像傍晚的光）；黑白 = 只留明暗 */
export function toneRGB(tone: PhotoTone, r: number, g: number, b: number): [number, number, number] {
  if (tone === 'warm') return [clamp255(r * 1.06 + 12), clamp255(g * 1.0 + 5), clamp255(b * 0.84)]
  if (tone === 'mono') {
    const y = clamp255(0.299 * r + 0.587 * g + 0.114 * b)
    return [y, y, y]
  }
  return [r, g, b]
}
/**
 * 整張圖換色調（RGBA 一個像素 4 格，直接改傳進來的陣列；透明度不動）。
 * 自己算像素，不用 ctx.filter：iPad 的 Safari 不一定支援。
 */
export function applyTone(data: Uint8ClampedArray | number[], tone: PhotoTone): void {
  if (tone === 'plain') return
  for (let i = 0; i + 3 < data.length; i += 4) {
    const [r, g, b] = toneRGB(tone, data[i], data[i + 1], data[i + 2])
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
}

/** 相框的一筆：SVG path（座標是 0–100，照片的百分比）與顏色。畫面預覽（SVG）和 canvas 合成（Path2D）用同一份，拍到的跟看到的一樣 */
export interface FrameOp {
  d: string
  fill: string
  evenodd?: boolean
}
const n2 = (v: number): string => String(Math.round(v * 100) / 100)
/** 五角星（中心、外圈半徑） */
export function starPath(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const k = i % 2 === 0 ? r : r * 0.45
    pts.push(`${n2(cx + Math.cos(a) * k)} ${n2(cy + Math.sin(a) * k)}`)
  }
  return `M${pts.join('L')}Z`
}
/** 愛心（中心、大小） */
export function heartPath(cx: number, cy: number, s: number): string {
  const p = (dx: number, dy: number) => `${n2(cx + dx * s)} ${n2(cy + dy * s)}`
  return `M${p(0, 0.9)}C${p(-1.6, -0.2)} ${p(-0.8, -1.3)} ${p(0, -0.45)}C${p(0.8, -1.3)} ${p(1.6, -0.2)} ${p(0, 0.9)}Z`
}
const rectPath = (x: number, y: number, w: number, h: number): string => `M${n2(x)} ${n2(y)}H${n2(x + w)}V${n2(y + h)}H${n2(x)}Z`
/** 四周一圈的邊（外面是整張照片，裡面挖掉一個圓角方形） */
const bandPath = (inset: number, r: number): string => {
  const a = inset
  const b = 100 - inset
  return `M0 0H100V100H0Z M${n2(a + r)} ${a}H${n2(b - r)}A${r} ${r} 0 0 1 ${b} ${n2(a + r)}V${n2(b - r)}A${r} ${r} 0 0 1 ${n2(b - r)} ${b}H${n2(a + r)}A${r} ${r} 0 0 1 ${a} ${n2(b - r)}V${n2(a + r)}A${r} ${r} 0 0 1 ${n2(a + r)} ${a}Z`
}
/** 邊上一圈的位置（四個角加上每邊中間 4 個，共 20 個），離邊 m */
const ringSpots = (m: number): [number, number][] => {
  const at = [m, 21.8, 40.6, 59.4, 78.2, 100 - m]
  const out: [number, number][] = []
  for (const x of at) out.push([x, m], [x, 100 - m])
  for (const y of at.slice(1, -1)) out.push([m, y], [100 - m, y])
  return out
}

/** 相框怎麼畫（由下往上）。none 沒有東西 */
export function frameOps(frame: PhotoFrame): FrameOp[] {
  if (frame === 'stars') {
    return [
      { d: bandPath(6.5, 4), fill: '#ffe9a8', evenodd: true },
      ...ringSpots(3.3).map(([x, y], i) => ({ d: starPath(x, y, 2.7), fill: i % 2 ? '#ff8a5c' : '#ffb300' })),
    ]
  }
  if (frame === 'hearts') {
    return [
      { d: bandPath(6.5, 4), fill: '#ffd3e2', evenodd: true },
      ...ringSpots(3.3).map(([x, y], i) => ({ d: heartPath(x, y + 0.2, 2), fill: i % 2 ? '#ffffff' : '#ff6f9c' })),
    ]
  }
  if (frame === 'film') {
    const holes: FrameOp[] = []
    for (let i = 0; i < 9; i++) {
      const x = 5 + i * 11.25 - 3
      holes.push({ d: rectPath(x, 2.8, 6, 4.4), fill: '#fdfbf5' }, { d: rectPath(x, 92.8, 6, 4.4), fill: '#fdfbf5' })
    }
    return [
      { d: rectPath(0, 0, 100, 10), fill: '#2b2b33' },
      { d: rectPath(0, 90, 100, 10), fill: '#2b2b33' },
      { d: rectPath(0, 0, 2.5, 100), fill: '#2b2b33' },
      { d: rectPath(97.5, 0, 2.5, 100), fill: '#2b2b33' },
      ...holes,
    ]
  }
  return []
}

// ---------- 存檔 ----------
/** 最多留幾張照片：滿了照樣可以拍、可以看，只是不存；舊的不自動刪（家長在畫廊刪） */
export const PHOTO_MAX = 30
/** 合成照片的邊長（px）與 JPEG 品質 */
export const PHOTO_PX = 1080
export const PHOTO_JPEG_Q = 0.85
export const PHOTO_BASE = 'photo'
export const photoGalleryId = (now: number): string => `photo-${now}`
/** coloring 表裡哪些列是照片 */
export const isPhotoWork = (pageId: string): boolean => pageId.startsWith('g:photo-')
export const canSavePhoto = (count: number): boolean => count < PHOTO_MAX

// ---------- 倒數：可愛的手指 3、2、1，孩子也可以直接按「現在拍」 ----------
export const COUNT_FROM = 3
export const COUNT_STEP_MS = 850

// ---------- canvas 合成用的幾何 ----------
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
/** 把 sw×sh 的圖「蓋滿」dw×dh：回傳要從原圖裁哪一塊（置中裁切） */
export function coverCrop(sw: number, sh: number, dw: number, dh: number): Rect {
  const k = Math.max(dw / sw, dh / sh)
  const w = dw / k
  const h = dh / k
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h }
}
/** object-fit: contain（貼底置中）：sw×sh 的圖放進 box 裡實際畫在哪 */
export function containIn(sw: number, sh: number, box: Rect, alignBottom = false): Rect {
  const k = Math.min(box.w / sw, box.h / sh)
  const w = sw * k
  const h = sh * k
  return { x: box.x + (box.w - w) / 2, y: alignBottom ? box.y + box.h - h : box.y + (box.h - h) / 2, w, h }
}

/**
 * 帽子在寵物圖上的位置（跟 PetHat 同一套算法）：錨點 (x%, y%) 是帽子「底邊往上 sink」那一點，帽子繞那一點轉。
 * img：寵物圖實際畫出來的矩形。回傳錨點、帽子寬高、旋轉（弧度）與錨點在帽子裡的高度比例。
 */
export function hatOnImage(anchor: { x: number; y: number; w: number; rotate: number }, fit: { aspect: number; scale: number; sink: number }, img: Rect) {
  const w = (anchor.w * fit.scale * img.w) / 100
  const h = w / fit.aspect
  return { cx: img.x + (anchor.x / 100) * img.w, cy: img.y + (anchor.y / 100) * img.h, w, h, rot: (anchor.rotate * Math.PI) / 180, pivot: 1 - fit.sink }
}

// ---------- 台詞 ----------
export type PhotoLine = 'intro' | 'pose' | 'ready' | 'saved' | 'full' | 'friend'
export const photoLine = (k: PhotoLine) => `pet.play.photo.${k}`
