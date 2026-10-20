import { band, circle, cloud, ellipse, leaf, poly, ray, rect, star } from './shapes'

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
]

export const getColoringPage = (id: string) => COLORING_PAGES.find((p) => p.id === id)
