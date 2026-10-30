import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  artFallbacks,
  artForSpecies,
  monkeyArtOf,
  nameText,
  normSpecies,
  parsePetArt,
  PET_POSES,
  petArt,
  petArtChain,
  petEggChain,
  SPECIES,
  speciesEmoji,
  speciesName,
  speciesOf,
  speciesStageLabel,
} from './species'
import { HAT_ANCHORS, HAT_ANCHORS_BY_SPECIES, hasHatEntry, hatAnchor, hatAspect } from '../art/hats'
import { petArtCandidates } from '../ui/components/PetSprite'
import { companionArt } from '../ui/screens/adventure/Companion'
import { expectedCards } from './album'
import { newStickerIds, STICKER_CATALOG, stickerEmoji, stickerForSpecies, unlockedStickers } from './stickers'

const ART = join(__dirname, '../../public/art')

describe('v7.5 物種：預設值與名字', () => {
  it('沒有 species（舊存檔）、不認得的值一律是猴子阿悟', () => {
    expect(speciesOf(undefined)).toBe('monkey')
    expect(speciesOf(null)).toBe('monkey')
    expect(speciesOf({})).toBe('monkey')
    expect(speciesOf({ species: undefined })).toBe('monkey')
    expect(speciesOf({ species: 'dragon' })).toBe('monkey')
    expect(normSpecies('')).toBe('monkey')
    expect(speciesOf({ species: 'rabbit' })).toBe('rabbit')
    expect(speciesOf({ species: 'tiger' })).toBe('tiger')
  })
  it('名字固定：阿悟、兔兔、虎虎；沒給 = 阿悟', () => {
    expect(SPECIES.map(speciesName)).toEqual(['阿悟', '兔兔', '虎虎'])
    expect(speciesName()).toBe('阿悟')
    expect(speciesName(null)).toBe('阿悟')
    expect(SPECIES.map(speciesEmoji)).toEqual(['🐵', '🐰', '🐯'])
  })
  it('nameText：「阿悟」換成這個物種的名字；猴子原樣', () => {
    expect(nameText('阿悟正在探路', 'rabbit')).toBe('兔兔正在探路')
    expect(nameText('阿悟的家', 'tiger')).toBe('虎虎的家')
    expect(nameText('阿悟正在探路', 'monkey')).toBe('阿悟正在探路')
    expect(nameText('阿悟正在探路')).toBe('阿悟正在探路')
  })
})

describe('v7.5 petArt：檔名與備援順序', () => {
  it('猴子維持原本的檔名（不能改）', () => {
    expect(petArt('monkey', 'baby', 'idle')).toBe('pet-baby-idle')
    expect(petArt(undefined, 'adult', 'cheer')).toBe('pet-adult-cheer')
    expect(petArt('monkey', 'egg')).toBe('pet-egg')
    expect(petArt('monkey', 'egg', 's1')).toBe('pet-egg-s1')
    expect(petArt('monkey', 'egg', 's2')).toBe('pet-egg-s2')
    expect(petArt('monkey', 'egg', 'crack')).toBe('pet-egg-crack')
    // 現有的 28 張猴子圖全都對得上
    const files = new Set(readdirSync(ART).filter((f) => /^pet-(egg|baby|adult)/.test(f)).map((f) => f.replace(/\.png$/, '')))
    const expected = [petArt('monkey', 'egg'), ...(['s1', 's2', 'crack'] as const).map((p) => petArt('monkey', 'egg', p)), ...(['baby', 'adult'] as const).flatMap((st) => PET_POSES.map((p) => petArt('monkey', st, p)))]
    expect(expected).toHaveLength(28)
    for (const f of expected) expect(files.has(f), f).toBe(true)
  })
  it('新物種的檔名：pet-rabbit-baby-<pose>、pet-tiger-egg-crack…', () => {
    expect(petArt('rabbit', 'baby', 'happy')).toBe('pet-rabbit-baby-happy')
    expect(petArt('rabbit', 'adult', 'sleep')).toBe('pet-rabbit-adult-sleep')
    expect(petArt('rabbit', 'egg')).toBe('pet-rabbit-egg')
    expect(petArt('rabbit', 'egg', 's1')).toBe('pet-rabbit-egg-s1')
    expect(petArt('tiger', 'egg', 's2')).toBe('pet-tiger-egg-s2')
    expect(petArt('tiger', 'egg', 'crack')).toBe('pet-tiger-egg-crack')
    expect(petArt('tiger', 'adult', 'shy')).toBe('pet-tiger-adult-shy')
  })
  it('退回順序：先找這個物種的各姿勢，再退回猴子的同一批姿勢（猴子只有自己）', () => {
    expect(petArtChain('rabbit', 'baby', 'cheer')).toEqual(['pet-rabbit-baby-cheer', 'pet-baby-cheer'])
    expect(petArtChain('tiger', 'adult', ['cheer', 'happy', 'idle'])).toEqual([
      'pet-tiger-adult-cheer',
      'pet-tiger-adult-happy',
      'pet-tiger-adult-idle',
      'pet-adult-cheer',
      'pet-adult-happy',
      'pet-adult-idle',
    ])
    expect(petArtChain('monkey', 'baby', ['cheer', 'happy'])).toEqual(['pet-baby-cheer', 'pet-baby-happy'])
    // PetSprite / 冒險陪伴用的就是這個順序
    expect(petArtCandidates({ stage: 'baby', feedCount: 20, species: 'rabbit' }, 'happy', false, 'cheer')).toEqual(petArtChain('rabbit', 'baby', ['cheer', 'happy', 'idle']))
    expect(petArtCandidates({ stage: 'adult', feedCount: 80 }, 'happy', false, 'cheer')).toEqual(['pet-adult-cheer', 'pet-adult-happy', 'pet-adult-idle'])
    expect(companionArt('adult', 'think', 80, 'tiger')).toEqual(petArtChain('tiger', 'adult', ['think', 'happy', 'idle']))
    expect(companionArt('adult', 'think', 80)).toEqual(['pet-adult-think', 'pet-adult-happy', 'pet-adult-idle'])
  })
  it('蛋依孵化進度換外觀：兔兔的蛋先退回兔兔前一階段，最後才退回猴子的蛋', () => {
    expect(petEggChain('monkey', 0)).toEqual(['pet-egg'])
    expect(petEggChain('monkey', 0.95)).toEqual(['pet-egg-crack', 'pet-egg-s2', 'pet-egg-s1', 'pet-egg'])
    expect(petEggChain('rabbit', 0.5)).toEqual(['pet-rabbit-egg-s1', 'pet-rabbit-egg', 'pet-egg-s1', 'pet-egg'])
    expect(petArtCandidates({ stage: 'egg', feedCount: 0, species: 'tiger' }, 'happy')).toEqual(['pet-tiger-egg', 'pet-egg'])
  })
  it('parsePetArt / artFallbacks / monkeyArtOf / artForSpecies', () => {
    expect(parsePetArt('pet-rabbit-adult-cheer')).toEqual({ species: 'rabbit', stage: 'adult', pose: 'cheer' })
    expect(parsePetArt('pet-egg-s2')).toEqual({ species: 'monkey', stage: 'egg', pose: 's2' })
    expect(parsePetArt('pet-tiger-egg')).toEqual({ species: 'tiger', stage: 'egg', pose: 'egg' })
    expect(parsePetArt('obj-banana')).toBeNull()
    expect(parsePetArt('pet-dragon-baby-idle')).toBeNull()
    // Art / Icon / 匯出畫作：新物種的圖缺的時候用猴子的同一張；其他圖只有自己
    expect(artFallbacks('pet-rabbit-baby-happy')).toEqual(['pet-rabbit-baby-happy', 'pet-baby-happy'])
    expect(artFallbacks('pet-tiger-egg-crack')).toEqual(['pet-tiger-egg-crack', 'pet-egg-crack'])
    expect(artFallbacks('pet-adult-happy')).toEqual(['pet-adult-happy'])
    expect(artFallbacks('obj-star')).toEqual(['obj-star'])
    expect(monkeyArtOf('pet-rabbit-adult-happy')).toBe('pet-adult-happy')
    expect(monkeyArtOf('obj-star')).toBe('obj-star')
    expect(artForSpecies('pet-baby-happy', 'tiger')).toBe('pet-tiger-baby-happy')
    expect(artForSpecies('obj-star', 'tiger')).toBe('obj-star')
  })
})

describe('v7.5 帽子錨點依物種', () => {
  it('猴子的表不變；兔兔、虎虎每個姿勢都量過（帽子在畫面內），睡覺照樣不戴', () => {
    expect(hatAnchor('pet-adult-idle')).toEqual(HAT_ANCHORS['pet-adult-idle'])
    for (const sp of ['rabbit', 'tiger'] as const) {
      for (const stage of ['baby', 'adult'] as const) {
        for (const pose of PET_POSES) {
          const art = petArt(sp, stage, pose)
          expect(hasHatEntry(art), art).toBe(true)
          expect(art in HAT_ANCHORS_BY_SPECIES[sp], art).toBe(true)
          const a = hatAnchor(art)
          if (pose === 'sleep') {
            expect(a, art).toBeNull()
            continue
          }
          expect(a, art).not.toBeNull()
          if (!a) continue
          // 帽子不能飛出畫面：中心在圖片內、帽子寬度不超過圖片、不歪太多
          expect(a.x, art).toBeGreaterThan(30)
          expect(a.x, art).toBeLessThan(70)
          expect(a.y, art).toBeGreaterThan(4)
          expect(a.y, art).toBeLessThan(40)
          expect(a.w, art).toBeGreaterThanOrEqual(30)
          expect(a.w, art).toBeLessThanOrEqual(60)
          expect(Math.abs(a.rotate), art).toBeLessThanOrEqual(12)
          expect(hatAspect(art), art).toBe(a.ar)
        }
      }
    }
    // 表裡沒有的圖不戴帽子：蛋、還沒量的姿勢
    expect(hatAnchor('pet-rabbit-egg')).toBeNull()
    expect(hasHatEntry('pet-rabbit-baby-swim')).toBe(false)
  })
  it('public/art 裡已經有的兔兔、虎虎幼體 / 成體圖都量過錨點', () => {
    const files = readdirSync(ART).filter((f) => /^pet-(rabbit|tiger)-(baby|adult)-.+\.png$/.test(f)).map((f) => f.replace(/\.png$/, ''))
    for (const f of files) expect(hasHatEntry(f), f).toBe(true)
  })
})

describe('v7.5 相簿卡、貼紙用目前孩子的物種', () => {
  it('回憶卡的圖：兔兔是 pet-rabbit-*，舊存檔（沒有 species）仍是猴子的舊檔名', () => {
    const facts = { petName: '兔兔', stage: 'adult' as const, tricks: ['flip'], chapters: [{ id: 'huaguoshan', name: '花果山' }], firstHat: { id: 'hat-crown' } }
    const rabbit = expectedCards({ ...facts, species: 'rabbit' })
    expect(rabbit.map((c) => c.art)).toEqual(['pet-rabbit-baby-cheer', 'pet-rabbit-adult-cheer', 'pet-rabbit-adult-cheer', 'pet-rabbit-adult-cheer', 'pet-rabbit-adult-happy'])
    expect(rabbit[0].caption).toBe('兔兔孵出來了！')
    const old = expectedCards({ ...facts, petName: '阿悟' })
    expect(old.map((c) => c.art)).toEqual(['pet-baby-cheer', 'pet-adult-cheer', 'pet-adult-cheer', 'pet-adult-cheer', 'pet-adult-happy'])
  })
  it('貼紙盤的寵物貼紙換成這個物種；別的貼紙不變；猴子不變', () => {
    const [awu] = STICKER_CATALOG
    expect(stickerForSpecies(awu, 'rabbit')).toEqual({ art: 'pet-rabbit-adult-happy', emoji: '🐰', label: '兔兔' })
    expect(stickerForSpecies(STICKER_CATALOG.find((s) => s.art === 'pet-adult-cheer')!, 'tiger')).toEqual({ art: 'pet-tiger-adult-cheer', emoji: '🙌', label: '歡呼虎虎' })
    expect(stickerForSpecies(STICKER_CATALOG.find((s) => s.art === 'pet-baby-happy')!, 'tiger')).toEqual({ art: 'pet-tiger-baby-happy', emoji: '🐯', label: '小虎' })
    expect(stickerForSpecies(awu, 'monkey')).toBe(awu)
    const banana = STICKER_CATALOG.find((s) => s.art === 'obj-banana')!
    expect(stickerForSpecies(banana, 'rabbit')).toBe(banana)
    // 已經貼在作品上的兔兔貼紙：emoji 備援對得上、算成目錄裡的同一張（解鎖、「新」都以猴子的圖名記）
    expect(stickerEmoji('pet-rabbit-adult-happy')).toBe('🐰')
    expect(stickerEmoji('pet-adult-happy')).toBe('🐵')
    expect(unlockedStickers([], ['pet-rabbit-baby-happy']).some((s) => s.art === 'pet-baby-happy')).toBe(true)
    expect(newStickerIds(['pet-baby-happy'], ['pet-rabbit-baby-happy'])).not.toContain('pet-baby-happy')
  })
})

describe('v7.5 階段稱呼', () => {
  it('蛋、幼猴、成兔、幼虎；沒有物種 = 猴子', () => {
    expect(speciesStageLabel('egg', 'rabbit')).toBe('蛋')
    expect(speciesStageLabel('baby')).toBe('幼猴')
    expect(speciesStageLabel('adult', 'rabbit')).toBe('成兔')
    expect(speciesStageLabel('baby', 'tiger')).toBe('幼虎')
  })
})
