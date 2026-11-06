import { describe, expect, it } from 'vitest'
import { HAT_ANCHORS, HAT_FIT } from '../art/hats'
import { STATIC_LINES } from '../learning/lines'
import {
  PET_SIZES,
  PHOTO_BACKDROPS,
  PHOTO_MAX,
  PHOTO_POSES,
  canSavePhoto,
  clampPet,
  containIn,
  coverCrop,
  hatOnImage,
  insidePhoto,
  isPhotoWork,
  nextPose,
  nextSize,
  photoGalleryId,
  photoLine,
  pinchSize,
  stickerSpot,
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
