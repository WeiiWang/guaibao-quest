import { describe, expect, it } from 'vitest'
import { HAT_ANCHORS, HAT_FIT } from '../art/hats'
import { STATIC_LINES } from '../learning/lines'
import {
  FRIEND_SIZES,
  FRIEND_START_SIZE,
  PET_SIZES,
  PHOTO_BACKDROPS,
  PHOTO_FRAMES,
  PHOTO_FRIENDS,
  PHOTO_MAX,
  PHOTO_MAX_FRIENDS,
  PHOTO_POSES,
  PHOTO_TONES,
  STICKER_SIZE,
  applyTone,
  canSavePhoto,
  clampPet,
  containIn,
  coverCrop,
  frameOps,
  friendSpot,
  hatOnImage,
  heartPath,
  insidePhoto,
  isPhotoWork,
  nearestSize,
  nextFrame,
  nextFriendSize,
  nextPose,
  nextSize,
  nextTone,
  photoGalleryId,
  photoLine,
  pinchSize,
  starPath,
  stickerSpot,
  toneRGB,
} from './photo'

describe('照相館：規則', () => {
  it('佈景 6–8 張、不重複', () => {
    expect(PHOTO_BACKDROPS.length).toBeGreaterThanOrEqual(6)
    expect(PHOTO_BACKDROPS.length).toBeLessThanOrEqual(8)
    expect(new Set(PHOTO_BACKDROPS.map((b) => b.id)).size).toBe(PHOTO_BACKDROPS.length)
  })
  it('點寵物輪流換五個姿勢', () => {
    let p = PHOTO_POSES[0]
    const seen = [p]
    for (let i = 0; i < 4; i++) seen.push((p = nextPose(p)))
    expect(seen).toEqual([...PHOTO_POSES])
    expect(nextPose(p)).toBe(PHOTO_POSES[0])
  })
  it('三檔大小：按鈕輪流換，雙指捏取最接近的一檔', () => {
    expect([nextSize(0), nextSize(1), nextSize(2)]).toEqual([1, 2, 0])
    expect(pinchSize(1, 1)).toBe(1)
    expect(pinchSize(1, 2)).toBe(2)
    expect(pinchSize(1, 0.5)).toBe(0)
    expect(pinchSize(0, 1.05)).toBe(0)
  })
  it('寵物拖到邊邊也不會整隻跑出照片', () => {
    for (const s of PET_SIZES) {
      const a = clampPet(-50, -50, s)
      const b = clampPet(150, 150, s)
      expect(a.x).toBeGreaterThan(0)
      expect(b.x).toBeLessThan(100)
      expect(a.y - s * 100).toBeGreaterThanOrEqual(-s * 100 * 0.3 - 1e-9)
      expect(b.y).toBeLessThanOrEqual(100)
    }
  })
  it('點一下貼紙會貼在固定的位置（依序換）、都在照片裡', () => {
    const spots = Array.from({ length: 12 }, (_, i) => stickerSpot(i))
    expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(12)
    for (const s of spots) expect(insidePhoto(s.x, s.y)).toBe(true)
    expect(insidePhoto(120, 50)).toBe(false)
  })
  it('照片的鍵與名額', () => {
    expect(photoGalleryId(123)).toBe('photo-123')
    expect(isPhotoWork('g:photo-123')).toBe(true)
    expect(isPhotoWork('g:abc')).toBe(false)
    expect(isPhotoWork('photo')).toBe(false)
    expect(canSavePhoto(PHOTO_MAX - 1)).toBe(true)
    expect(canSavePhoto(PHOTO_MAX)).toBe(false)
  })
  it('台詞都在 lines.ts', () => {
    for (const k of ['intro', 'pose', 'ready', 'saved', 'full'] as const) expect(typeof STATIC_LINES[photoLine(k)]).toBe('string')
  })
})

describe('照相館：合成的幾何', () => {
  it('寬圖蓋滿正方形：左右各裁一半', () => {
    expect(coverCrop(1600, 900, 1080, 1080)).toEqual({ x: 350, y: 0, w: 900, h: 900 })
    expect(coverCrop(900, 1600, 100, 100)).toEqual({ x: 0, y: 350, w: 900, h: 900 })
  })
  it('contain：貼底置中', () => {
    expect(containIn(50, 100, { x: 0, y: 0, w: 100, h: 100 }, true)).toEqual({ x: 25, y: 0, w: 50, h: 100 })
    expect(containIn(100, 50, { x: 0, y: 0, w: 100, h: 100 }, true)).toEqual({ x: 0, y: 50, w: 100, h: 50 })
    expect(containIn(100, 50, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 0, y: 25, w: 100, h: 50 })
  })
  it('帽子位置跟 PetHat 同一套：錨點在圖上的百分比、寬度 = w × scale', () => {
    const anchor = HAT_ANCHORS['pet-adult-happy']
    const fit = HAT_FIT['hat-crown']
    const img = { x: 100, y: 200, w: 300, h: 400 }
    const h = hatOnImage(anchor, fit, img)
    expect(h.cx).toBeCloseTo(100 + (anchor.x / 100) * 300)
    expect(h.cy).toBeCloseTo(200 + (anchor.y / 100) * 400)
    expect(h.w).toBeCloseTo((anchor.w * fit.scale * 300) / 100)
    expect(h.h).toBeCloseTo(h.w / fit.aspect)
    expect(h.pivot).toBeCloseTo(1 - fit.sink)
  })
})

describe('v8.5 動物朋友', () => {
  it('六種動物，規格表的順序', () => {
    expect(PHOTO_FRIENDS.map((f) => f.art)).toEqual(['obj-bear', 'obj-rabbit', 'obj-chick', 'obj-cow', 'obj-fish', 'obj-octopus'])
    expect(PHOTO_MAX_FRIENDS).toBe(6)
  })
  it('三檔大小都比貼紙大；點一下換下一檔', () => {
    expect(FRIEND_SIZES).toHaveLength(3)
    for (const s of FRIEND_SIZES) expect(s).toBeGreaterThan(STICKER_SIZE)
    expect(nextFriendSize(FRIEND_START_SIZE)).toBe(2)
    expect(nextFriendSize(2)).toBe(0)
    expect(nextFriendSize(0)).toBe(1)
  })
  it('雙指縮放取最接近的一檔（跟寵物同一套）', () => {
    expect(nearestSize(FRIEND_SIZES, 1, 1.5)).toBe(2)
    expect(nearestSize(FRIEND_SIZES, 1, 0.6)).toBe(0)
    expect(nearestSize(FRIEND_SIZES, 1, 1.05)).toBe(1)
    for (let i = 0; i < 3; i++) for (const r of [0.4, 0.8, 1, 1.3, 2]) expect(pinchSize(i, r)).toBe(nearestSize(PET_SIZES, i, r))
  })
  it('點一下依序站在寵物兩邊，都在照片裡、不站正中間', () => {
    const spots = Array.from({ length: PHOTO_MAX_FRIENDS }, (_, i) => friendSpot(i))
    expect(new Set(spots.map((p) => `${p.x},${p.y}`)).size).toBe(PHOTO_MAX_FRIENDS)
    for (const p of spots) {
      expect(insidePhoto(p.x, p.y)).toBe(true)
      expect(Math.abs(p.x - 50)).toBeGreaterThan(10)
    }
    expect(friendSpot(PHOTO_MAX_FRIENDS)).toEqual(friendSpot(0))
  })
  it('台詞在 lines.ts', () => {
    expect(STATIC_LINES[photoLine('friend')]).toBeTruthy()
  })
})

describe('v8.5 相框與色調', () => {
  it('按一下換下一個：相框 4 種、色調 3 種，繞一圈回到原本的', () => {
    expect(PHOTO_FRAMES).toEqual(['none', 'stars', 'hearts', 'film'])
    expect(PHOTO_TONES).toEqual(['plain', 'warm', 'mono'])
    expect(nextFrame('none')).toBe('stars')
    expect(nextFrame('film')).toBe('none')
    expect(nextTone('plain')).toBe('warm')
    expect(nextTone('mono')).toBe('plain')
  })
  it('原色不動；黑白只留明暗；暖暖偏黃（紅多、藍少）', () => {
    expect(toneRGB('plain', 12, 200, 99)).toEqual([12, 200, 99])
    const m = toneRGB('mono', 200, 100, 50)
    expect(m[0]).toBe(m[1])
    expect(m[1]).toBe(m[2])
    expect(m[0]).toBe(Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50))
    expect(toneRGB('mono', 255, 255, 255)).toEqual([255, 255, 255])
    expect(toneRGB('mono', 0, 0, 0)).toEqual([0, 0, 0])
    const w = toneRGB('warm', 120, 120, 120)
    expect(w[0]).toBeGreaterThan(120)
    expect(w[2]).toBeLessThan(120)
    // 不會超出 0–255
    for (const v of toneRGB('warm', 255, 255, 255)) expect(v).toBeLessThanOrEqual(255)
  })
  it('整張圖換色調：每個像素都換、透明度不動；原色完全不碰', () => {
    const px = [10, 200, 30, 255, 250, 20, 90, 128]
    const plain = [...px]
    applyTone(plain, 'plain')
    expect(plain).toEqual(px)
    const mono = [...px]
    applyTone(mono, 'mono')
    expect(mono[0]).toBe(mono[1])
    expect(mono[4]).toBe(mono[6])
    expect([mono[3], mono[7]]).toEqual([255, 128])
    const arr = new Uint8ClampedArray(px)
    applyTone(arr, 'warm')
    expect([...arr.slice(0, 3)]).toEqual(toneRGB('warm', 10, 200, 30))
    expect(arr[7]).toBe(128)
  })
  it('沒有相框就什麼都不畫；其他三種都有東西、座標都在照片裡', () => {
    expect(frameOps('none')).toEqual([])
    for (const f of ['stars', 'hearts', 'film'] as const) {
      const ops = frameOps(f)
      expect(ops.length).toBeGreaterThan(4)
      for (const op of ops) {
        expect(op.d.startsWith('M')).toBe(true)
        expect(op.fill).toMatch(/^#[0-9a-f]{6}$/)
        const nums = (op.d.replace(/A[^AVHLMCZ]*/g, ' ').match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
        expect(Math.min(...nums)).toBeGreaterThanOrEqual(-0.01)
        expect(Math.max(...nums)).toBeLessThanOrEqual(100.01)
      }
    }
  })
  it('相框只畫在邊上，中間留給寵物（中間 80% 沒有東西）', () => {
    // 星星、愛心都在離邊 6.5% 以內；底片的黑邊上下各 10%
    for (const [x, y] of [[50, 50], [15, 15], [85, 85], [50, 12], [12, 50]] as const) {
      for (const f of ['stars', 'hearts'] as const)
        for (const op of frameOps(f).slice(1)) {
          const nums = (op.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
          const xs = nums.filter((_, i) => i % 2 === 0)
          const ys = nums.filter((_, i) => i % 2 === 1)
          const hit = x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys)
          expect(hit).toBe(false)
        }
    }
  })
  it('星星有 10 個角、愛心是封閉的曲線', () => {
    expect(starPath(50, 50, 10).split('L')).toHaveLength(10)
    expect(starPath(50, 50, 10).startsWith('M50 40')).toBe(true)
    expect(heartPath(50, 50, 10)).toMatch(/^M50 59C.*Z$/)
  })
})
