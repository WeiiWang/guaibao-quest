import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HAT_ANCHORS, HAT_FIT, HAT_POSES, HAT_STAGES, hatAnchor, hatAspect, hatFit, hasHatEntry } from './hats'
import { HAT_IDS } from '../domain/hats'
import { petArtCandidates, type PetPose } from '../ui/components/PetSprite'

const ART = join(__dirname, '../../public/art')
/** PNG 檔頭的寬、高（第 16–23 個位元組） */
const sizeOf = (file: string) => {
  const b = readFileSync(join(ART, `${file}.png`))
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('帽子頭頂錨點表', () => {
  it('幼猴、成猴的每個姿勢都有一筆（睡覺姿勢可以標成不戴）', () => {
    for (const stage of HAT_STAGES) for (const pose of HAT_POSES) expect(hasHatEntry(`pet-${stage}-${pose}`), `${stage}-${pose}`).toBe(true)
    expect(Object.keys(HAT_ANCHORS)).toHaveLength(HAT_STAGES.length * HAT_POSES.length)
  })

  it('public/art 裡每一張幼猴 / 成猴的圖都在表裡（新增姿勢圖要補錨點）', () => {
    const files = readdirSync(ART).filter((f) => /^pet-(baby|adult)-.+\.png$/.test(f)).map((f) => f.replace(/\.png$/, ''))
    expect(files.length).toBeGreaterThanOrEqual(22)
    for (const f of files) expect(hasHatEntry(f), f).toBe(true)
  })

  it('PetSprite 實際會挑到的每一張圖（含缺圖時的備援）都查得到錨點或被標成不戴', () => {
    const poses = Object.keys({ cheer: 1, think: 1, idle: 1, happy: 1, eating: 1, sing: 1, dance: 1, laugh: 1, dizzy: 1, sleep: 1, sleepy: 1, shy: 1 } satisfies Record<PetPose, 1>) as PetPose[]
    for (const stage of HAT_STAGES) {
      for (const pose of poses) {
        for (const art of petArtCandidates({ stage, feedCount: 30 }, 'normal', false, pose)) expect(hasHatEntry(art), `${stage} ${pose} → ${art}`).toBe(true)
      }
      for (const mood of ['happy', 'normal', 'low'] as const) {
        for (const art of petArtCandidates({ stage, feedCount: 30 }, mood, false)) expect(hasHatEntry(art), `${stage} ${mood} → ${art}`).toBe(true)
        for (const art of petArtCandidates({ stage, feedCount: 30 }, mood, true)) expect(hasHatEntry(art), `${stage} eating → ${art}`).toBe(true)
      }
    }
  })

  it('錨點數值合理：x、y、w 是百分比，帽子在頭頂（y 小）、寬度約等於頭寬', () => {
    for (const [name, a] of Object.entries(HAT_ANCHORS).filter(([, v]) => !v.hide)) {
      expect(a.x, `${name}.x`).toBeGreaterThan(30)
      expect(a.x, `${name}.x`).toBeLessThan(70)
      expect(a.y, `${name}.y`).toBeGreaterThan(8)
      expect(a.y, `${name}.y`).toBeLessThan(25)
      expect(a.w, `${name}.w`).toBeGreaterThanOrEqual(40)
      expect(a.w, `${name}.w`).toBeLessThanOrEqual(55)
      expect(Math.abs(a.rotate), `${name}.rotate`).toBeLessThanOrEqual(15)
    }
  })

  it('只有躺著睡覺的姿勢不戴帽子', () => {
    const hidden = Object.entries(HAT_ANCHORS).filter(([, a]) => a.hide).map(([k]) => k).sort()
    expect(hidden).toEqual(['pet-adult-sleep', 'pet-baby-sleep'])
    expect(hatAnchor('pet-adult-sleep')).toBeNull()
    expect(hatAnchor('pet-adult-idle')).toMatchObject({ x: expect.any(Number) })
    // 蛋不能戴
    expect(hatAnchor('pet-egg')).toBeNull()
    expect(hatAnchor('pet-egg-crack')).toBeNull()
  })

  it('ar 和圖片實際寬高比一致（改圖後要重新量；差太多百分比就對不準）', () => {
    for (const name of Object.keys(HAT_ANCHORS)) {
      if (!existsSync(join(ART, `${name}.png`))) continue
      const { w, h } = sizeOf(name)
      expect(Math.abs(hatAspect(name) - w / h), name).toBeLessThan(0.02)
    }
  })

  it('每頂帽子都有「怎麼戴」，圖片比例和 public/art/hat-*.png 一致；缺圖用 emoji 的預設', () => {
    expect(Object.keys(HAT_FIT).sort()).toEqual([...HAT_IDS].sort())
    for (const id of HAT_IDS) {
      const fit = HAT_FIT[id]
      expect(fit.scale, id).toBeGreaterThan(0.5)
      expect(fit.scale, id).toBeLessThan(2)
      expect(fit.sink, id).toBeGreaterThanOrEqual(0)
      expect(fit.sink, id).toBeLessThan(0.6)
      if (existsSync(join(ART, `${id}.png`))) {
        const { w, h } = sizeOf(id)
        expect(Math.abs(fit.aspect - w / h), id).toBeLessThan(0.02)
      }
      expect(hatFit(id, false)).toMatchObject({ aspect: 1, scale: 1 })
      expect(hatFit(id, true)).toEqual(fit)
    }
  })
})
