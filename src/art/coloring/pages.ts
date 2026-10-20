import { band, bar, barAt, circle, cloud, drop, ellipse, flame, leaf, poly, ray, rect, star } from './shapes'

export interface Region {
  id: string
  d: string
}
export interface ColoringPageDef {
  id: string
  name: string
  regions: Region[]
  /** 裝飾線條（不可填色） */
  lines: string[]
  /** 實心小圓點（眼睛等） [cx, cy, r] */
  dots: [number, number, number][]
}

const R = (id: string, d: string): Region => ({ id, d })

const monkey: ColoringPageDef = {
  id: 'monkey',
  name: '小猴子',
  regions: [
    R('tail', ellipse(318, 292, 15, 52, -28)),
    R('body', ellipse(200, 300, 72, 72)),
    R('belly', ellipse(200, 318, 42, 44)),
    R('arm-l', ellipse(126, 292, 18, 46, 18)),
    R('arm-r', ellipse(274, 292, 18, 46, -18)),
    R('foot-l', ellipse(158, 374, 34, 16)),
    R('foot-r', ellipse(242, 374, 34, 16)),
    R('ear-l', circle(104, 168, 32)),
    R('ear-r', circle(296, 168, 32)),
    R('inner-l', circle(104, 168, 16)),
    R('inner-r', circle(296, 168, 16)),
    R('head', circle(200, 170, 96)),
    R('face', ellipse(200, 198, 66, 58)),
    R('muzzle', ellipse(200, 228, 30, 20)),
  ],
  lines: ['M184 240Q200 252 216 240'],
  dots: [[170, 188, 7], [230, 188, 7], [192, 222, 3.5], [208, 222, 3.5]],
}

const bananaTree: ColoringPageDef = {
  id: 'banana-tree',
  name: '香蕉樹',
  regions: [
    R('sun', circle(64, 64, 30)),
    R('ground', rect(0, 336, 400, 64)),
    R('trunk', 'M172 340Q192 250 188 178L220 178Q214 250 236 340Z'),
    R('leaf-1', leaf(204, 180, 66, 128, 30)),
    R('leaf-2', leaf(204, 180, 118, 56, 30)),
    R('leaf-3', leaf(204, 180, 206, 34, 28)),
    R('leaf-4', leaf(204, 180, 296, 56, 30)),
    R('leaf-5', leaf(204, 180, 340, 128, 30)),
    R('banana-1', 'M222 196Q292 206 258 292Q218 262 222 196Z'),
    R('banana-2', 'M250 196Q320 206 286 292Q246 262 250 196Z'),
    R('banana-3', 'M278 196Q348 206 314 292Q274 262 278 196Z'),
  ],
  lines: ['M204 180L204 330', 'M60 355H340'],
  dots: [],
}

const clouds: ColoringPageDef = {
  id: 'clouds',
  name: '雲朵彩虹',
  regions: [
    R('sky', rect(0, 0, 400, 400)),
    R('sun', circle(335, 70, 32)),
    R('cloud-top', cloud(70, 50, 130, 60)),
    R('rainbow-1', band(200, 340, 170, 32)),
    R('rainbow-2', band(200, 340, 138, 32)),
    R('rainbow-3', band(200, 340, 106, 32)),
    R('hill-l', ellipse(60, 405, 150, 90)),
    R('hill-r', ellipse(350, 410, 150, 80)),
    R('cloud-l', cloud(10, 240, 110, 60)),
    R('cloud-r', cloud(280, 250, 110, 60)),
  ],
  lines: [],
  dots: [],
}

const nimbus: ColoringPageDef = {
  id: 'nimbus',
  name: '筋斗雲',
  regions: [
    R('sky', rect(0, 0, 400, 400)),
    R('sun', circle(66, 68, 30)),
    R('puff-l', cloud(10, 320, 90, 50)),
    R('puff-r', cloud(300, 330, 90, 46)),
    R('cloud', cloud(60, 250, 290, 110)),
    R('staff', rect(276, 92, 12, 200, 6)),
    R('body', ellipse(200, 238, 42, 46)),
    R('ear-l', circle(158, 162, 15)),
    R('ear-r', circle(242, 162, 15)),
    R('head', circle(200, 164, 46)),
    R('face', ellipse(200, 174, 30, 25)),
    R('band', rect(156, 132, 88, 12, 5)),
  ],
  lines: ['M190 188Q200 196 210 188'],
  dots: [[187, 170, 4], [213, 170, 4]],
}

const house: ColoringPageDef = {
  id: 'house',
  name: '小房子',
  regions: [
    R('sun', circle(62, 62, 30)),
    R('ground', rect(0, 306, 400, 94)),
    R('path', poly([[178, 312], [232, 312], [268, 372], [146, 372]])),
    R('trunk', rect(338, 252, 16, 62)),
    R('crown', circle(346, 222, 40)),
    R('chimney', rect(252, 100, 30, 70)),
    R('wall', rect(96, 190, 208, 122)),
    R('roof', poly([[76, 196], [200, 92], [324, 196]])),
    R('door', rect(178, 238, 54, 74, 4)),
    R('window-l', rect(116, 216, 44, 44, 3)),
    R('window-r', rect(250, 216, 44, 44, 3)),
  ],
  lines: ['M138 216V260', 'M116 238H160', 'M272 216V260', 'M250 238H294'],
  dots: [[220, 276, 4]],
}

const fish: ColoringPageDef = {
  id: 'fish',
  name: '小魚',
  regions: [
    R('water', rect(0, 0, 400, 400)),
    R('sand', rect(0, 366, 400, 34)),
    R('weed-l', 'M50 372Q30 330 52 296Q34 258 58 224Q64 262 78 298Q60 332 76 372Z'),
    R('weed-r', 'M336 372Q316 340 338 312Q326 288 346 264Q350 290 362 314Q348 342 358 372Z'),
    R('tail', 'M262 200L352 138Q336 200 352 262Z'),
    R('fin-top', 'M140 148Q176 88 226 146Z'),
    R('fin-bottom', 'M166 256Q196 304 228 252Z'),
    R('body', ellipse(180, 202, 100, 66)),
    R('belly', ellipse(176, 232, 66, 26)),
    R('bubble-1', circle(70, 120, 14)),
    R('bubble-2', circle(104, 80, 9)),
    R('small-tail', 'M338 322L376 298Q368 322 376 346Z'),
    R('small-body', ellipse(300, 322, 42, 26)),
  ],
  lines: ['M118 168Q104 202 118 236', 'M170 160Q190 202 170 244'],
  dots: [[126, 188, 7], [284, 316, 4]],
}

const petalAngles = [0, 60, 120, 180, 240, 300]
const flower: ColoringPageDef = {
  id: 'flower',
  name: '花朵',
  regions: [
    R('stem', rect(193, 170, 14, 140)),
    R('leaf-l', leaf(196, 270, 112, 226, 26)),
    R('leaf-r', leaf(204, 250, 292, 212, 26)),
    R('pot', poly([[150, 318], [250, 318], [238, 390], [162, 390]])),
    R('rim', rect(140, 298, 120, 26, 7)),
    ...petalAngles.map((a, i) =>
      R(
        `petal-${i + 1}`,
        ellipse(
          200 + 56 * Math.cos((a * Math.PI) / 180),
          128 + 56 * Math.sin((a * Math.PI) / 180),
          36,
          23,
          a,
        ),
      ),
    ),
    R('center', circle(200, 128, 30)),
  ],
  lines: ['M150 345H250'],
  dots: [[190, 124, 4], [210, 124, 4]],
}

const car: ColoringPageDef = {
  id: 'car',
  name: '小汽車',
  regions: [
    R('sky', rect(0, 0, 400, 300)),
    R('sun', circle(336, 66, 34)),
    R('cloud', cloud(40, 50, 110, 56)),
    R('road', rect(0, 300, 400, 100)),
    R('cabin', poly([[108, 214], [146, 138], [272, 138], [308, 214]])),
    R('window-1', poly([[128, 208], [156, 150], [202, 150], [202, 208]])),
    R('window-2', poly([[214, 208], [214, 150], [262, 150], [290, 208]])),
    R('body', rect(40, 208, 322, 92, 20)),
    R('wheel-l', circle(112, 300, 42)),
    R('wheel-r', circle(290, 300, 42)),
    R('hub-l', circle(112, 300, 18)),
    R('hub-r', circle(290, 300, 18)),
    R('headlight', ellipse(346, 240, 12, 17)),
    R('taillight', rect(44, 232, 16, 24, 4)),
  ],
  lines: ['M70 360H130', 'M240 360H330'],
  dots: [],
}

const sunMoon: ColoringPageDef = {
  id: 'sun-moon',
  name: '太陽月亮',
  regions: [
    R('sun', circle(120, 150, 56)),
    ...[0, 60, 120, 180, 240, 300].map((a, i) => R(`ray-${i + 1}`, ray(120, 150, 68, 108, a + 30, 12))),
    R('moon', 'M272 186A62 62 0 1 0 344 272A95 95 0 0 1 272 186Z'),
    R('star-1', star(330, 96, 34, 15)),
    R('star-2', star(210, 330, 26, 12)),
  ],
  lines: ['M100 160Q120 176 140 160'],
  dots: [[102, 136, 5], [138, 136, 5]],
}

const chick: ColoringPageDef = {
  id: 'chick',
  name: '小雞',
  regions: [
    R('grass', rect(0, 334, 400, 66)),
    R('egg', ellipse(62, 336, 24, 32)),
    R('shell', 'M318 372L318 350L330 334L340 352L352 332L364 352L376 336L376 372Q347 392 318 372Z'),
    R('foot-l', poly([[170, 306], [184, 306], [186, 334], [204, 346], [188, 352], [174, 346], [156, 352], [166, 334]])),
    R('foot-r', poly([[216, 306], [230, 306], [232, 334], [250, 346], [234, 352], [220, 346], [202, 352], [212, 334]])),
    R('body', ellipse(196, 238, 92, 78)),
    R('wing', ellipse(168, 250, 44, 28, -18)),
    R('comb', 'M206 100Q208 66 224 92Q232 60 246 92Q260 70 262 112Z'),
    R('head', circle(236, 150, 56)),
    R('cheek', circle(214, 172, 11)),
    R('beak', poly([[288, 144], [326, 158], [288, 174]])),
    R('wattle', circle(278, 186, 10)),
  ],
  lines: [],
  dots: [[254, 138, 6]],
}

// ---------- v3：西遊記主題 ----------
const staff: ColoringPageDef = {
  id: 'staff',
  name: '金箍棒',
  regions: [
    R('sky', rect(0, 0, 400, 400)),
    R('sun', circle(64, 62, 32)),
    R('star-1', star(318, 70, 32, 14)),
    R('star-2', star(52, 214, 22, 10)),
    R('star-3', star(352, 214, 20, 9)),
    R('cloud-l', cloud(10, 320, 150, 66)),
    R('cloud-r', cloud(250, 330, 140, 60)),
    R('body', bar(96, 84, 304, 322, 26)),
    R('cap-top', barAt(96, 84, 304, 322, 0, 0.1, 40)),
    R('cap-bottom', barAt(96, 84, 304, 322, 0.9, 1, 40)),
    R('band-1', barAt(96, 84, 304, 322, 0.2, 0.26, 36)),
    R('ring', barAt(96, 84, 304, 322, 0.47, 0.53, 36)),
    R('band-2', barAt(96, 84, 304, 322, 0.74, 0.8, 36)),
  ],
  lines: ['M152 162L172 146', 'M208 226L228 210', 'M244 270L264 254'],
  dots: [],
}

const wukongCloud: ColoringPageDef = {
  id: 'wukong-cloud',
  name: '筋斗雲上的阿悟',
  regions: [
    R('sky', rect(0, 0, 400, 400)),
    R('sun', circle(334, 62, 32)),
    R('puff', cloud(14, 76, 100, 50)),
    R('cloud', cloud(40, 276, 320, 110)),
    R('tail', ellipse(268, 262, 14, 46, 52)),
    R('staff', rect(292, 88, 14, 214, 7)),
    R('body', ellipse(196, 226, 44, 54)),
    R('legs', ellipse(196, 290, 74, 20)),
    R('arm-l', ellipse(148, 226, 13, 38, 24)),
    R('arm-r', ellipse(250, 218, 13, 38, -26)),
    R('ear-l', circle(146, 142, 17)),
    R('ear-r', circle(246, 142, 17)),
    R('head', circle(196, 144, 48)),
    R('face', ellipse(196, 156, 32, 26)),
    R('band', rect(150, 112, 92, 12, 5)),
  ],
  lines: ['M184 180Q196 190 208 180'],
  dots: [[182, 150, 4.5], [210, 150, 4.5]],
}

const peachGarden: ColoringPageDef = {
  id: 'peach-garden',
  name: '蟠桃園',
  regions: [
    R('sky', rect(0, 0, 400, 400)),
    R('sun', circle(336, 60, 30)),
    R('ground', ellipse(200, 420, 320, 110)),
    R('trunk', 'M176 346Q192 276 184 222L222 222Q212 276 236 346Z'),
    R('crown-l', circle(128, 178, 58)),
    R('crown-r', circle(272, 178, 58)),
    R('crown', circle(200, 130, 84)),
    R('peach-1', drop(160, 130, 22)),
    R('peach-2', drop(238, 112, 22)),
    R('peach-3', drop(206, 184, 22)),
    R('peach-4', drop(110, 198, 18)),
    R('basket', poly([[290, 318], [370, 318], [358, 380], [302, 380]])),
    R('basket-peach', drop(330, 306, 18)),
  ],
  lines: ['M290 336H370', 'M296 352H364'],
  dots: [],
}

const waterCurtain: ColoringPageDef = {
  id: 'water-curtain',
  name: '水簾洞',
  regions: [
    R('sky', rect(0, 0, 400, 400)),
    R('cloud', cloud(250, 36, 120, 54)),
    R('mtn-back', poly([[0, 330], [70, 190], [130, 250], [180, 150], [240, 330]])),
    R('mtn', poly([[50, 340], [118, 190], [168, 112], [232, 112], [286, 190], [350, 340]])),
    R('cave', 'M128 340V238A72 72 0 0 1 272 238V340Z'),
    R('fall-1', rect(150, 128, 26, 212, 12)),
    R('fall-2', rect(187, 118, 26, 222, 12)),
    R('fall-3', rect(224, 128, 26, 212, 12)),
    R('pool', ellipse(200, 366, 130, 28)),
    R('rock-l', ellipse(96, 350, 36, 24)),
    R('rock-r', ellipse(306, 352, 40, 26)),
    R('tree-l', circle(52, 286, 34)),
    R('tree-r', circle(352, 282, 34)),
  ],
  lines: ['M163 150V320', 'M200 142V324', 'M237 150V320'],
  dots: [],
}

const dragonFish: ColoringPageDef = {
  id: 'dragon-fish',
  name: '龍宮小魚',
  regions: [
    R('water', rect(0, 0, 400, 400)),
    R('sand', rect(0, 356, 400, 44)),
    R('roof', poly([[84, 214], [200, 112], [316, 214]])),
    R('wall', rect(106, 214, 188, 130, 6)),
    R('door', 'M172 344V288A28 28 0 0 1 228 288V344Z'),
    R('win-l', circle(138, 262, 15)),
    R('win-r', circle(262, 262, 15)),
    R('fish-body', ellipse(316, 112, 44, 28)),
    R('fish-tail', 'M270 112L232 84Q244 112 232 140Z'),
    R('fish-fin', 'M308 86Q326 62 344 90Z'),
    R('coral', leaf(52, 356, 56, 266, 26)),
    R('weed', leaf(350, 356, 360, 270, 22)),
    R('bubble-1', circle(70, 112, 16)),
    R('bubble-2', circle(104, 64, 10)),
  ],
  lines: ['M146 214V344', 'M254 214V344'],
  dots: [[332, 106, 5]],
}

const tangHorse: ColoringPageDef = {
  id: 'tang-horse',
  name: '唐僧的馬',
  regions: [
    R('sky', rect(0, 0, 400, 400)),
    R('sun', circle(60, 62, 30)),
    R('grass', rect(0, 336, 400, 64)),
    R('tail', leaf(112, 196, 56, 308, 26)),
    R('leg-back-l', poly([[130, 236], [158, 236], [158, 336], [132, 336]])),
    R('leg-front-l', poly([[236, 236], [262, 236], [262, 336], [240, 336]])),
    R('body', ellipse(190, 214, 104, 54)),
    R('leg-back-r', poly([[164, 242], [192, 242], [192, 342], [166, 342]])),
    R('leg-front-r', poly([[262, 242], [290, 242], [290, 342], [266, 342]])),
    R('neck', poly([[256, 188], [284, 96], [330, 96], [310, 196], [270, 250]])),
    R('mane', leaf(288, 92, 264, 206, 18)),
    R('head', ellipse(338, 104, 40, 24, 28)),
    R('ear', leaf(310, 82, 304, 52, 9)),
    R('saddle', rect(148, 166, 72, 36, 12)),
  ],
  lines: ['M128 336H162', 'M238 336H266'],
  dots: [[346, 98, 5]],
}

const flowerFruitMountain: ColoringPageDef = {
  id: 'flower-fruit-mountain',
  name: '花果山',
  regions: [
    R('sky', rect(0, 0, 400, 400)),
    R('sun', circle(336, 58, 30)),
    R('cloud', cloud(24, 40, 110, 50)),
    R('mtn-back', poly([[0, 340], [60, 210], [118, 270], [170, 200], [240, 340]])),
    R('mtn', poly([[70, 346], [150, 200], [190, 112], [234, 112], [276, 196], [350, 346]])),
    R('big-peach', drop(212, 88, 24)),
    R('ground', rect(0, 340, 400, 60)),
    R('trunk', rect(322, 252, 16, 92)),
    R('tree', circle(330, 226, 40)),
    R('flower-1', circle(70, 372, 16)),
    R('flower-2', circle(150, 378, 14)),
    R('flower-3', circle(250, 374, 16)),
    R('flower-4', circle(310, 380, 12)),
    R('rock', ellipse(200, 300, 44, 30)),
  ],
  lines: ['M180 332L200 250', 'M250 332L232 252'],
  dots: [],
}

const flameMountain: ColoringPageDef = {
  id: 'flame-mountain',
  name: '火焰山',
  regions: [
    R('sky', rect(0, 0, 400, 400)),
    R('sun', circle(330, 66, 36)),
    R('smoke', cloud(30, 40, 150, 62)),
    R('mtn-back', poly([[0, 330], [80, 200], [140, 260], [196, 170], [260, 330]])),
    R('mtn', poly([[100, 350], [190, 150], [214, 150], [320, 350]])),
    R('ground', rect(0, 340, 400, 60)),
    R('flame-1', flame(128, 346, 30, 90)),
    R('flame-2', flame(196, 346, 34, 130)),
    R('flame-3', flame(268, 346, 30, 104)),
    R('flame-4', flame(330, 346, 26, 76)),
    R('flame-5', flame(64, 346, 24, 64)),
    R('fan', ellipse(300, 190, 54, 76, 24)),
    R('fan-handle', bar(262, 258, 232, 316, 12)),
  ],
  lines: ['M300 120L300 260', 'M268 150L330 232'],
  dots: [],
}

export const COLORING_PAGES: ColoringPageDef[] = [
  monkey,
  bananaTree,
  clouds,
  nimbus,
  house,
  fish,
  flower,
  car,
  sunMoon,
  chick,
  staff,
  wukongCloud,
  peachGarden,
  waterCurtain,
  dragonFish,
  tangHorse,
  flowerFruitMountain,
  flameMountain,
]

export const getColoringPage = (id: string) => COLORING_PAGES.find((p) => p.id === id)
