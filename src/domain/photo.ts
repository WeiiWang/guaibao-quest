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
  const want = PET_SIZES[i] * ratio
  let best = 0
  for (let k = 1; k < PET_SIZES.length; k++) if (Math.abs(PET_SIZES[k] - want) < Math.abs(PET_SIZES[best] - want)) best = k
  return best
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
export type PhotoLine = 'intro' | 'pose' | 'ready' | 'saved' | 'full'
export const photoLine = (k: PhotoLine) => `pet.play.photo.${k}`
