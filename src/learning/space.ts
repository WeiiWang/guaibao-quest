/**
 * 空間方位的場景幾何：家具與東西怎麼擺、「放到某個位置」的位置在哪裡。
 * 題庫只存「關係」（上面、裡面…），這裡把關係換成座標；畫面、產生器、單元測試都用同一份。
 * 這個檔案只用 import type，讓 scripts/gen-questions.mjs 可以直接載入。
 *
 * 場景是 4:3 的畫布：寬 100、高 75 個單位。座標都是方塊的中心點。
 */
import type { PlaceZone, Rel, SceneSpec } from './types'

export const SCENE_W = 100
export const SCENE_H = 75
/** 東西（小雞、魚…）的方塊邊長 */
export const SUBJECT = 18

export interface Prop {
  id: string
  name: string
  /** 圖的高 / 寬 */
  aspect: number
  /** 在場景裡的寬度（單位） */
  w: number
  /** 可以「在裡面」的畫法：peek = 躲在後面探出頭，door = 站在入口 */
  inside?: 'peek' | 'door'
}

/** 用來擺場景的家具（public/art/decor-*.png，已經有的素材） */
export const PROPS: Prop[] = [
  { id: 'decor-crate', name: '箱子', aspect: 378 / 512, w: 44, inside: 'peek' },
  { id: 'decor-table', name: '桌子', aspect: 286 / 512, w: 56 },
  { id: 'decor-tent', name: '帳篷', aspect: 512 / 472, w: 34, inside: 'door' },
  { id: 'decor-bed', name: '小床', aspect: 448 / 512, w: 44 },
  { id: 'decor-beanbag', name: '沙發', aspect: 406 / 512, w: 44 },
]
const BY_ID = new Map(PROPS.map((p) => [p.id, p]))
export const getProp = (id: string): Prop | undefined => BY_ID.get(id)
export function mustProp(id: string): Prop {
  const p = BY_ID.get(id)
  if (!p) throw new Error(`未知的場景家具：${id}`)
  return p
}
/** 可以放「裡面」的家具 */
export const INSIDE_PROPS = PROPS.filter((p) => p.inside).map((p) => p.id)

/** 關係的口語（題目、選項、語音都用這個） */
export const REL_WORD: Record<Rel, string> = {
  above: '上面',
  below: '下面',
  inside: '裡面',
  outside: '外面',
  left: '左邊',
  right: '右邊',
  between: '中間',
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

const BASE_Y = 37.5
/** 一個家具的方塊。layout：single = 一個家具在正中間；double = 兩個家具左右各一 */
export function anchorBoxes(props: readonly string[]): Box[] {
  const xs = props.length === 1 ? [50] : [22, 78]
  return props.map((id, i) => {
    const p = mustProp(id)
    const w = props.length === 1 ? p.w : Math.min(p.w, 30)
    return { x: xs[i], y: BASE_Y, w, h: w * p.aspect }
  })
}

/** 東西站的位置（中心點）。subject 的方塊是 SUBJECT 邊長；家具方塊由 anchorBoxes 給 */
export function subjectBox(rel: Rel, anchors: readonly Box[], of = 0, prop?: Prop): Box {
  const s = SUBJECT
  const a = anchors[of] ?? anchors[0]
  const groundY = a.y + a.h / 2 - s / 2
  switch (rel) {
    case 'above':
      return { x: a.x, y: a.y - a.h / 2 - s / 2 + 1, w: s, h: s }
    case 'below':
      return { x: a.x, y: a.y + a.h / 2 + s / 2 - 1, w: s, h: s }
    case 'left':
      return { x: a.x - a.w / 2 - s / 2 - 2, y: groundY, w: s, h: s }
    case 'right':
    case 'outside':
      return { x: a.x + a.w / 2 + s / 2 + 2, y: groundY, w: s, h: s }
    case 'inside':
      // 箱子：躲在後面，探出一半的頭；帳篷：站在入口
      return prop?.inside === 'door'
        ? { x: a.x, y: groundY - 2, w: s * 0.8, h: s * 0.8 }
        : { x: a.x, y: a.y - a.h / 2 + 1, w: s, h: s }
    case 'between': {
      const b = anchors[1]
      return { x: (a.x + b.x) / 2, y: groundY, w: s, h: s }
    }
  }
}

/** 「放到某個位置」時，一個位置（zone）的方塊：裡面 = 整個家具，其他 = 東西會站的那一格 */
export function zoneBox(zone: PlaceZone, anchors: readonly Box[], props: readonly Prop[]): Box {
  if (zone.rel === 'inside') return anchors[zone.of ?? 0]
  return subjectBox(zone.rel, anchors, zone.of ?? 0, props[zone.of ?? 0])
}

/**
 * 獨立的位置判斷（測試用）：一個中心點相對於家具，有哪些關係成立。
 * 只看座標，不看 zone 當初是照哪個關係擺的，所以能驗證「問的位置只有一個答案」。
 */
export function relationsAt(p: { x: number; y: number }, anchors: readonly Box[]): { rel: Rel; of?: number }[] {
  const out: { rel: Rel; of?: number }[] = []
  anchors.forEach((a, i) => {
    const inX = Math.abs(p.x - a.x) <= a.w / 2
    const inY = Math.abs(p.y - a.y) <= a.h / 2
    if (inX && inY) out.push({ rel: 'inside', of: i })
    else if (inX && p.y < a.y - a.h / 2 + 2) out.push({ rel: 'above', of: i })
    else if (inX && p.y > a.y + a.h / 2 - 2) out.push({ rel: 'below', of: i })
    else if (p.x < a.x - a.w / 2 && inY) out.push({ rel: 'left', of: i })
    else if (p.x > a.x + a.w / 2 && inY) out.push({ rel: 'right', of: i })
  })
  if (anchors.length === 2) {
    const [a, b] = anchors
    const between = p.x > a.x + a.w / 2 && p.x < b.x - b.w / 2 && Math.abs(p.y - a.y) <= a.h / 2
    if (between) out.push({ rel: 'between' })
  }
  return out
}

/** 場景卡片（where 題的選項）：東西放在哪裡 */
export function sceneBoxes(spec: SceneSpec): { anchors: Box[]; subject: Box; prop: Prop } {
  const prop = mustProp(spec.anchor)
  const anchors = anchorBoxes([spec.anchor])
  return { anchors, subject: subjectBox(spec.rel, anchors, 0, prop), prop }
}

/** 「裡面」的畫法：躲在家具後面探頭（家具要蓋住東西），其他都是東西在家具前面 */
export const isPeek = (rel: Rel, prop?: Prop): boolean => rel === 'inside' && prop?.inside === 'peek'

/** 單一家具、放到某個位置的位置清單（依難度） */
export const SINGLE_REL_SETS: Record<string, Rel[]> = {
  d1g: ['above', 'below'],
  d1: ['above', 'below', 'inside'],
  d3: ['above', 'below', 'left', 'right'],
}
