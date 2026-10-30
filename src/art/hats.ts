// v6 線 C：帽子疊在阿悟頭上的「頭頂錨點表」。
// 每張阿悟的姿勢圖（public/art/pet-<stage>-<pose>.png）一筆：
//   x、y：帽子「底邊中心」落在圖片上的位置（佔圖片寬、高的百分比，0–100）
//   w：帽子寬度（佔圖片寬的百分比）
//   rotate：帽子傾斜角（度，順時針為正；頭歪向哪邊，帽子就跟著歪）
//   ar：圖片本身的寬 / 高（疊圖容器要跟圖片一樣大，百分比才會對得上）
//   hide：這個姿勢不戴帽子（躺著睡覺的姿勢，帽子會對不準；睡覺時阿悟把帽子放旁邊）
// 數值是用圖片的不透明像素量出頭頂（金箍帶上緣）之後，再逐張目視微調；改圖要重新量。
// 蛋（pet-egg*）不能戴帽子，不在表裡。
// v7.5：依物種查表（HAT_ANCHORS_BY_SPECIES）。兔兔、虎虎的圖（pet-rabbit-*、pet-tiger-*）已逐張量好；
// 新增姿勢或物種時要一起量（species.test.ts 檢查每個姿勢都在表裡），表裡沒有的圖不戴帽子。
import type { Stage } from '../domain/types'
import { parsePetArt, type Species } from '../domain/species'

export interface HatAnchor {
  x: number
  y: number
  w: number
  rotate: number
  ar: number
  hide?: boolean
}

type PoseKey = 'idle' | 'happy' | 'cheer' | 'think' | 'eating' | 'sing' | 'dance' | 'laugh' | 'dizzy' | 'sleep' | 'sleepy' | 'shy'
const a = (x: number, y: number, w: number, rotate: number, px: [number, number]): HatAnchor => ({ x, y, w, rotate, ar: Number((px[0] / px[1]).toFixed(4)) })
const hidden = (px: [number, number]): HatAnchor => ({ x: 50, y: 50, w: 40, rotate: 0, ar: Number((px[0] / px[1]).toFixed(4)), hide: true })

export const HAT_ANCHORS: Record<string, HatAnchor> = {
  // 幼猴（沒有金箍帶，頭大）
  'pet-baby-idle': a(50.5, 16.2, 48, 0, [439, 512]),
  'pet-baby-happy': a(50.9, 17.3, 48, 0, [425, 512]),
  'pet-baby-cheer': a(50.7, 16.2, 48, 0, [458, 512]),
  'pet-baby-think': a(51.1, 15.4, 48, -4, [450, 512]),
  'pet-baby-eating': a(49.8, 15.4, 48, 0, [408, 512]),
  'pet-baby-sing': a(47.7, 18.3, 48, -5, [455, 512]),
  'pet-baby-dance': a(49.9, 17.3, 48, 3, [437, 512]),
  'pet-baby-laugh': a(50.7, 16.2, 48, 0, [422, 512]),
  'pet-baby-dizzy': a(52.7, 16.8, 48, 8, [462, 512]),
  'pet-baby-sleep': hidden([512, 395]),
  'pet-baby-sleepy': a(50.8, 16.2, 48, 0, [418, 512]),
  'pet-baby-shy': a(51.5, 17.1, 48, 0, [431, 512]),
  // 成猴（頭上有金箍帶；帽子蓋在金箍帶上方的頭髮上）
  'pet-adult-idle': a(49.9, 15.5, 46, 0, [382, 512]),
  'pet-adult-happy': a(50.5, 15.5, 46, 0, [379, 512]),
  'pet-adult-cheer': a(49.4, 16.1, 46, 0, [395, 512]),
  'pet-adult-think': a(49.5, 15, 46, -6, [364, 512]),
  'pet-adult-eating': a(49.6, 14.9, 46, 0, [376, 512]),
  'pet-adult-sing': a(45, 16.8, 46, -8, [414, 512]),
  'pet-adult-dance': a(51.2, 16.5, 46, 3, [418, 512]),
  'pet-adult-laugh': a(43.5, 15.5, 46, -10, [417, 512]),
  'pet-adult-dizzy': a(61.4, 12.9, 46, 10, [434, 512]),
  'pet-adult-sleep': hidden([512, 367]),
  'pet-adult-sleepy': a(50.5, 15.9, 46, 0, [375, 512]),
  'pet-adult-shy': a(49.2, 15.3, 46, 0, [390, 512]),
}

/** v7.5 兔兔的錨點（key = 圖檔名）。頭頂 = 兩耳之間的凹谷，帽子蓋住耳根；成體戴在花圈上。逐張疊真帽子目視校正 */
export const HAT_ANCHORS_RABBIT: Record<string, HatAnchor> = {
  'pet-rabbit-baby-idle': a(49.8, 28.6, 55, 0, [293, 512]),
  'pet-rabbit-baby-happy': a(51.2, 28.4, 49, 0, [325, 512]),
  'pet-rabbit-baby-cheer': a(46, 30, 46, -4, [348, 512]),
  'pet-rabbit-baby-think': a(48.4, 30.9, 52, -6, [306, 512]),
  'pet-rabbit-baby-eating': a(50.4, 27, 59, 0, [272, 512]),
  'pet-rabbit-baby-sing': a(46, 29.4, 49, 4, [326, 512]),
  'pet-rabbit-baby-dance': a(57, 28.8, 44, 8, [365, 512]),
  'pet-rabbit-baby-laugh': a(49, 32.5, 38, 10, [424, 512]),
  'pet-rabbit-baby-dizzy': a(60, 33.3, 40, 10, [405, 512]),
  'pet-rabbit-baby-sleep': hidden([512, 455]),
  'pet-rabbit-baby-sleepy': a(49.5, 29.4, 56, 0, [287, 512]),
  'pet-rabbit-baby-shy': a(50, 28.8, 58, 0, [278, 512]),
  'pet-rabbit-adult-idle': a(49.6, 25.7, 54, 0, [252, 512]),
  'pet-rabbit-adult-happy': a(49.5, 25.7, 40, 0, [337, 512]),
  'pet-rabbit-adult-cheer': a(56, 26, 43, 8, [316, 512]),
  'pet-rabbit-adult-think': a(52, 28, 47, -12, [290, 512]),
  'pet-rabbit-adult-eating': a(52, 25.3, 49, -6, [273, 512]),
  'pet-rabbit-adult-sing': a(42, 29.2, 39, -10, [347, 512]),
  'pet-rabbit-adult-dance': a(57, 28.2, 38, 10, [354, 512]),
  'pet-rabbit-adult-laugh': a(45, 28.4, 35, -12, [390, 512]),
  'pet-rabbit-adult-dizzy': a(57, 31.3, 33, 10, [408, 512]),
  'pet-rabbit-adult-sleep': hidden([512, 430]),
  'pet-rabbit-adult-sleepy': a(48, 27.4, 49, -2, [278, 512]),
  'pet-rabbit-adult-shy': a(49.8, 25.9, 53, 0, [255, 512]),
}
/** v7.5 虎虎的錨點（key = 圖檔名）。圓耳朵在帽子兩側；逐張疊真帽子目視校正 */
export const HAT_ANCHORS_TIGER: Record<string, HatAnchor> = {
  'pet-tiger-baby-idle': a(52.7, 8.6, 41, 0, [441, 512]),
  'pet-tiger-baby-happy': a(53.6, 9.2, 40, 0, [449, 512]),
  'pet-tiger-baby-cheer': a(54.1, 10, 38, 3, [473, 512]),
  'pet-tiger-baby-think': a(50.7, 9.6, 45, -6, [400, 512]),
  'pet-tiger-baby-eating': a(52.2, 8.6, 46, -3, [388, 512]),
  'pet-tiger-baby-sing': a(52.1, 9.8, 40, 3, [454, 512]),
  'pet-tiger-baby-dance': a(51.8, 10, 40, 6, [452, 512]),
  'pet-tiger-baby-laugh': a(56.1, 10.8, 42, 8, [433, 512]),
  'pet-tiger-baby-dizzy': a(61.8, 11.2, 36, 10, [496, 512]),
  'pet-tiger-baby-sleep': hidden([512, 394]),
  'pet-tiger-baby-sleepy': a(53, 9.8, 43, 5, [418, 512]),
  'pet-tiger-baby-shy': a(50.1, 9.2, 45, 0, [398, 512]),
  'pet-tiger-adult-idle': a(53.3, 7.8, 41, 0, [353, 512]),
  'pet-tiger-adult-happy': a(51.8, 8.4, 38, 0, [381, 512]),
  'pet-tiger-adult-cheer': a(51.8, 9.6, 35, 3, [409, 512]),
  'pet-tiger-adult-think': a(53, 9.6, 44, -8, [332, 512]),
  'pet-tiger-adult-eating': a(55.4, 8.2, 43, 0, [340, 512]),
  'pet-tiger-adult-sing': a(45.5, 13.3, 35, -8, [413, 512]),
  'pet-tiger-adult-dance': a(51.7, 8.6, 36, 3, [408, 512]),
  'pet-tiger-adult-laugh': a(46.8, 15.3, 35, -10, [419, 512]),
  'pet-tiger-adult-dizzy': a(55.8, 11.2, 33, 10, [441, 512]),
  'pet-tiger-adult-sleep': hidden([512, 350]),
  'pet-tiger-adult-sleepy': a(51.2, 9.2, 39, 3, [370, 512]),
  'pet-tiger-adult-shy': a(56.2, 9.2, 40, 0, [362, 512]),
}

export const HAT_ANCHORS_BY_SPECIES: Record<Species, Record<string, HatAnchor>> = {
  monkey: HAT_ANCHORS,
  rabbit: HAT_ANCHORS_RABBIT,
  tiger: HAT_ANCHORS_TIGER,
}

/** 查錨點：依圖檔名的物種查表。表裡沒有的圖（蛋、別的圖）回 undefined */
function lookup(artFile: string): HatAnchor | undefined {
  const p = parsePetArt(artFile)
  return p ? HAT_ANCHORS_BY_SPECIES[p.species][artFile] : undefined
}

/** 阿悟有哪些姿勢（要跟 PetSprite 的 PetPose 一致，hats.test.ts 會檢查） */
export const HAT_POSES: PoseKey[] = ['idle', 'happy', 'cheer', 'think', 'eating', 'sing', 'dance', 'laugh', 'dizzy', 'sleep', 'sleepy', 'shy']
export const HAT_STAGES: Exclude<Stage, 'egg'>[] = ['baby', 'adult']

/** 某張阿悟圖（檔名不含副檔名）的帽子錨點；蛋或不認得的圖回 null（= 不畫帽子） */
export function hatAnchor(artFile: string): HatAnchor | null {
  const a = lookup(artFile)
  return a && !a.hide ? a : null
}

/** 這張圖有沒有登記過（不管戴不戴） */
export const hasHatEntry = (artFile: string): boolean => lookup(artFile) !== undefined

/** 這張圖的寬高比（疊圖容器要跟圖片一樣大） */
export const hatAspect = (artFile: string): number => lookup(artFile)?.ar ?? 0.75

/**
 * 每頂帽子自己的「怎麼戴」：
 *   aspect：帽子圖片的寬 / 高（public/art/hat-*.png 已裁到只剩帽子，改圖後要重新量）
 *   scale：帽子寬度 = 錨點的 w × scale（派對帽是窄錐形、草帽有寬帽簷，所以不一樣寬）
 *   sink：帽子底部有多少比例（佔帽子高度）要「陷進」頭裡，才像戴著而不是飄在頭上
 * 缺圖改用 emoji 時一律用 EMOJI_FIT。
 */
export interface HatFit {
  aspect: number
  scale: number
  sink: number
}
export const HAT_FIT: Record<string, HatFit> = {
  'hat-party': { aspect: 0.7227, scale: 0.7, sink: 0.12 },
  'hat-cap': { aspect: 1.0645, scale: 1.05, sink: 0.3 },
  'hat-flower': { aspect: 1.108, scale: 1.0, sink: 0.5 },
  'hat-straw': { aspect: 1.724, scale: 1.55, sink: 0.35 },
  'hat-chef': { aspect: 1.026, scale: 1.0, sink: 0.2 },
  'hat-crown': { aspect: 1.333, scale: 0.95, sink: 0.2 },
}
export const EMOJI_FIT: HatFit = { aspect: 1, scale: 1, sink: 0.08 }
export const hatFit = (hatId: string, hasArt: boolean): HatFit => (hasArt ? (HAT_FIT[hatId] ?? EMOJI_FIT) : EMOJI_FIT)
