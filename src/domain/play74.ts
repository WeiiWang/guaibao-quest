// v7.4 線 K：新玩法的純函式（沒有 React、沒有資料庫），方便單元測試。
//   K1 朋友來作客：已認識的朋友每天最多 1 位，依「認識的先後」固定順序，沒來的朋友隔天繼續排隊（漏掉不補也不罰）。
//      第一次來的朋友留下固定禮物：依固定順序解鎖下一張還沒擁有的著色頁或連連看；全部都有了就改送食物。
//   K2 阿悟的小願望：一次一個、固定順序；做好並擺進房間就實現。不限時、沒有倒數、沒有損失。
// 全部不用亂數。
import { AVAILABLE_RASTER } from '../art/coloring/rasterDefs'
import { DOTS_IDS, DOTS_NAMES, dotsItemId, dotsPageId, isDotsFree, type DotsLevel } from '../art/dots/dots'
import { COLORING_NAMES, COLORING_PAGE_IDS, SHOP_ITEMS, VECTOR_PAGE_IDS } from './constants'
import { FRIEND_BY_ID, objectsInQuestion } from './friends'
import { baseIdOf } from './home7'
import type { AgeBand, GuestGift } from './types'

// =====================================================================
// K1 朋友來作客
// =====================================================================

/** 最近幾次作客的紀錄留著給家長看（再多就捨棄） */
export const GUEST_LOG_MAX = 40

/**
 * 會來作客的朋友：要有 3D 圖（站在房間裡），而且是動物、食物、東西，或星星、花、貝殼這類物件。
 * 天氣、季節、生活情境（洗手、搶玩具…）和英文單字卡不適合站在房間裡，不來。
 */
export function canVisit(id: string): boolean {
  const f = FRIEND_BY_ID[id]
  if (!f || !f.art) return false
  return f.tab === 'animal' || f.tab === 'food' || f.tab === 'thing' || f.id.startsWith('obj-')
}

type OrderQ = Parameters<typeof objectsInQuestion>[0]

/**
 * 依「第一次遇到的先後」排出認識的朋友（只留會作客的）。
 * attempts 不用先排序；同一時間的作答依原本的順序。lookup 找不到的題目（題庫改版）略過。
 */
export function friendOrder(attempts: readonly { questionId: string; at: number }[], lookup: (id: string) => OrderQ | undefined): string[] {
  const sorted = attempts.map((a, i) => ({ a, i })).sort((x, y) => x.a.at - y.a.at || x.i - y.i)
  const seen = new Set<string>()
  const out: string[] = []
  for (const { a } of sorted) {
    const q = lookup(a.questionId)
    if (!q) continue
    for (const id of objectsInQuestion(q)) {
      if (seen.has(id)) continue
      seen.add(id)
      if (canVisit(id)) out.push(id)
    }
  }
  return out
}

/**
 * 今天輪到誰：order 裡第一個還沒來過的朋友（第一次來，留禮物）。
 * 全部都來過了，就依總來訪次數輪流回訪（不再留禮物）。沒有認識的朋友就沒有人來。
 */
export function pickGuest(order: readonly string[], visited: readonly string[], visitCount: number): { friendId: string; first: boolean } | null {
  if (order.length === 0) return null
  const v = new Set(visited)
  const next = order.find((id) => !v.has(id))
  if (next) return { friendId: next, first: true }
  return { friendId: order[Math.max(0, visitCount) % order.length], first: false }
}

// ---------- 固定禮物：下一張還沒擁有的著色頁或連連看 ----------

/** 連連看難度的解鎖順序：6–7 歲從中等開始，其餘從簡單開始 */
const DOTS_LEVEL_ORDER: Record<AgeBand, readonly DotsLevel[]> = {
  '3': ['e', 'm', 'h', 'a'],
  '4-5': ['e', 'm', 'h', 'a'],
  '6-7': ['m', 'h', 'a', 'e'],
}

/** 著色頁的解鎖順序：簡單的點陣線稿（最漂亮的先）→ 向量頁 → 挑戰的點陣線稿 */
export function coloringGiftOrder(): string[] {
  const easy = AVAILABLE_RASTER.filter((d) => d.tier === 'easy').map((d) => d.id)
  const hard = AVAILABLE_RASTER.filter((d) => d.tier === 'hard').map((d) => d.id)
  return [...easy, ...VECTOR_PAGE_IDS, ...hard].filter((id, i, a) => COLORING_PAGE_IDS.includes(id) && a.indexOf(id) === i)
}

/** 連連看的解鎖順序：同一個難度先把每張圖排完，再換下一個難度（免費的前 3 張不用送） */
export function dotsGiftOrder(age: AgeBand): string[] {
  return DOTS_LEVEL_ORDER[age].flatMap((lv) => DOTS_IDS.filter((n) => !isDotsFree(n)).map((n) => dotsPageId(n, lv)))
}

/** 背包裡的庫存 id（買了就放進 inventory） */
export const giftItemId = (g: Pick<GuestGift, 'kind' | 'id'>): string => (g.kind === 'dots' ? dotsItemId(g.id) : `coloring-${g.id}`)

/** 全部畫都有了以後改送的食物（固定輪流，不送蛋糕） */
export const GUEST_FOODS: readonly string[] = ['apple', 'carrot', 'cookie', 'banana', 'milk', 'grape', 'peach', 'riceball', 'watermelon']

/**
 * 第 n 次（0 起算）第一次來作客的禮物：著色頁、連連看輪流送（偶數次著色頁、奇數次連連看），
 * 各自送順序裡第一個還沒擁有的；那一種都有了就送另一種；全部都有了就送食物（依 n 輪流）。
 * owned = 背包裡有的庫存 id。同樣的庫存與 n 永遠同樣的結果。
 */
export function pickGuestGift(owned: ReadonlySet<string>, age: AgeBand, n: number): GuestGift {
  const col = coloringGiftOrder().filter((id) => !owned.has(`coloring-${id}`)).map((id): GuestGift => ({ kind: 'coloring', id }))
  const dots = dotsGiftOrder(age).filter((id) => !owned.has(dotsItemId(id))).map((id): GuestGift => ({ kind: 'dots', id }))
  const [first, second] = n % 2 === 0 ? [col, dots] : [dots, col]
  const next = first[0] ?? second[0]
  if (next) return next
  return { kind: 'food', id: GUEST_FOODS[Math.max(0, n) % GUEST_FOODS.length] }
}

/** 所有可能送出的畫（著色頁 + 連連看）的庫存 id；全部都有了就改送食物（測試與說明用） */
export const allGiftItemIds = (age: AgeBand): string[] => [...coloringGiftOrder().map((id) => `coloring-${id}`), ...dotsGiftOrder(age).map(dotsItemId)]

/** 禮物的名字（給孩子看、給家長看） */
export function giftName(g: GuestGift): string {
  if (g.kind === 'food') return FOOD_NAMES[g.id] ?? '好吃的'
  if (g.kind === 'dots') {
    const [, name, level] = g.id.split(':')
    return `連連看：${DOTS_NAMES[name] ?? name}${level === 'a' ? '（字母）' : ''}`
  }
  return COLORING_NAMES[g.id] ?? g.id
}
const FOOD_NAMES: Record<string, string> = {
  apple: '蘋果',
  carrot: '紅蘿蔔',
  cookie: '餅乾',
  banana: '香蕉',
  milk: '牛奶',
  grape: '葡萄',
  peach: '桃子',
  riceball: '飯糰',
  watermelon: '西瓜',
}

// ---------- 站的位置（房間座標，px） ----------

export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}
export interface SpotInput {
  roomW: number
  roomH: number
  /** 阿悟一開始站的位置（中心 x，px）與寬度 */
  petX: number
  petW: number
  guestW: number
  guestH: number
  /** 站在地板上的家具（px；地毯這種平貼的不算）。放不下時，朋友寧可小小的擠進去，也不能讓孩子看不到 */
  furniture: readonly Rect[]
  /** 不能壓的東西（px）：左右看房間的箭頭、右側的按鈕欄、禮物袋 */
  blocks: readonly Rect[]
  /** 剛進房間時看得到的範圍（px）；先在這裡找位置，找不到才找整個房間 */
  viewLeft: number
  viewW: number
}

/** 朋友的腳底在房間高度的位置：先站後排（比阿悟的腳底 0.9 靠後），後排放不下才站前排 */
export const GUEST_ROWS = [0.8, 0.93] as const
export const GUEST_HEIGHT_FRAC = 0.2
/** 預設的後排腳底位置 */
export const GUEST_BOTTOM_FRAC = GUEST_ROWS[0]
/** 空位不夠時朋友縮小的倍率（最小不低於 MIN_GUEST_PX，手指才點得到） */
export const GUEST_SCALES = [1, 0.8, 0.65] as const
export const MIN_GUEST_PX = 56

const hit = (a: Rect, b: Rect, pad: number): boolean => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad
const area = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

/**
 * 朋友站哪裡（回傳中心 x、腳底 y、縮放倍率；px）。固定的規則，不用亂數：
 * 1. 從阿悟旁邊往外一格一格找（先右後左、先後排再前排），挑第一個不壓到阿悟、家具、按鈕的位置，只找剛進房間看得到的範圍
 * 2. 沒有就把朋友縮小再找（最多縮到 65%，不小於 56px）
 * 3. 還是沒有（房間被家具塞滿）：在看得到的範圍裡，挑壓到家具最少的位置（還是不壓阿悟與按鈕）
 * 4. 連這樣都放不下才去整個房間找空位
 */
export function pickGuestSpot(i: SpotInput): { x: number; bottom: number; scale: number } {
  const pet: Rect = { left: i.petX - i.petW / 2, right: i.petX + i.petW / 2, top: 0, bottom: i.roomH }
  const scales = GUEST_SCALES.filter((k, idx) => idx === 0 || i.guestW * k >= MIN_GUEST_PX)
  const search = (win: boolean, k: number, tolerate: boolean): { x: number; bottom: number; scale: number } | null => {
    const w = i.guestW * k
    const h = i.guestH * k
    const half = w / 2
    const step = Math.max(8, w * 0.12)
    const d0 = i.petW / 2 + half + 10
    const lo = win ? i.viewLeft + 4 + half : half + 4
    const hi = win ? i.viewLeft + i.viewW - 4 - half : i.roomW - half - 4
    let best: { x: number; bottom: number; scale: number; over: number } | null = null
    for (let n = 0; d0 + n * step < i.roomW; n++) {
      for (const row of GUEST_ROWS) {
        const bottom = row * i.roomH
        for (const dir of [1, -1]) {
          const x = i.petX + dir * (d0 + n * step)
          if (x < lo || x > hi) continue
          const g: Rect = { left: x - half, right: x + half, top: bottom - h, bottom }
          if (hit(g, pet, 6) || i.blocks.some((b) => hit(g, b, 6))) continue
          const over = i.furniture.reduce((s, f) => s + (hit(g, f, 6) ? 1 + area(g, f) : 0), 0)
          if (over === 0) return { x, bottom, scale: k }
          if (tolerate && (!best || over < best.over)) best = { x, bottom, scale: k, over }
        }
      }
    }
    return best ? { x: best.x, bottom: best.bottom, scale: best.scale } : null
  }
  for (const k of scales) {
    const r = search(true, k, false)
    if (r) return r
  }
  const squeezed = search(true, scales[scales.length - 1], true)
  if (squeezed) return squeezed
  for (const k of scales) {
    const r = search(false, k, false)
    if (r) return r
  }
  return { x: Math.min(i.roomW - i.guestW / 2 - 4, i.petX + i.petW / 2 + i.guestW / 2 + 10), bottom: GUEST_ROWS[0] * i.roomH, scale: 1 }
}

// ---------- 句子（會唸出來；名字是動態的，所以每個朋友各一句，由 learning/playLines.ts 列成清單預錄）----------

export const guestArriveLine = (name: string): string => `今天${name}來玩囉！`
export const guestPageLine = (name: string): string => `${name}送你一張新的畫！`
export const guestFoodLine = (name: string): string => `${name}送你好吃的！`

/** 家長區「本週」的一行字：這週來作客的朋友與收到的禮物（log 是 settings.play.guestLog） */
export function guestWeekText(log: readonly { date: string; friendId: string; gift?: GuestGift }[], days: readonly string[]): string {
  const mine = log.filter((l) => days.includes(l.date))
  if (mine.length === 0) return '這週還沒有朋友來作客。孩子在冒險裡認識新朋友，隔天就會有朋友來阿悟的房間玩。'
  const names = [...new Set(mine.map((l) => FRIEND_BY_ID[l.friendId]?.name ?? l.friendId))]
  const gifts = mine.filter((l) => l.gift).map((l) => giftName(l.gift as GuestGift))
  const g = gifts.length ? `，留下的新玩意：${gifts.join('、')}` : ''
  return `這週有 ${names.length} 位朋友來作客：${names.join('、')}${g}。`
}

// =====================================================================
// K2 阿悟的小願望
// =====================================================================

/** 實現願望時阿悟演什麼（用既有的動作，見 pet/bus.ts 的 PetCommand） */
export type WishAct = 'dance' | 'sing' | 'wave' | 'rubTummy' | 'gaze' | 'sleep'

export interface WishDef {
  id: string
  /** 要做出來、擺進房間的家具（商品 id）。1 件是單一願望，2–3 件是套裝 */
  items: readonly string[]
  /** 阿悟說的願望（泡泡與工坊） */
  line: string
  /** 實現後阿悟說的話 */
  doneLine: string
  /** 回憶卡上的一句話 */
  caption: string
  /** 願望的名字（家長區用） */
  name: string
  act: WishAct
  /** 回憶卡上阿悟的姿勢 */
  pose: 'cheer' | 'happy' | 'dance' | 'sing' | 'sleep' | 'laugh'
  /** 套裝願望：只有 6–7 歲看得到，而且排在單一願望之後 */
  set?: boolean
}

/**
 * 固定的願望順序。單一願望的材料由少到多（前面幾個一兩站就做得出來）；套裝用的家具和單一願望不重複，
 * 所以排到套裝時一定是真的要再做。
 */
export const WISHES: readonly WishDef[] = [
  { id: 'w-ball', items: ['decor-ball'], line: '我想要一顆球，可以滾來滾去！', doneLine: '哇，是球！一起玩吧！', caption: '小願望實現了：皮球！', name: '皮球', act: 'dance', pose: 'dance' },
  { id: 'w-plant', items: ['decor-plant'], line: '我想要一盆小花草！', doneLine: '好香喔，謝謝你！', caption: '小願望實現了：小盆栽！', name: '小盆栽', act: 'gaze', pose: 'happy' },
  { id: 'w-clock', items: ['decor-clock'], line: '我想知道現在幾點了！', doneLine: '滴答滴答，現在是玩的時間！', caption: '小願望實現了：時鐘！', name: '時鐘', act: 'wave', pose: 'cheer' },
  { id: 'w-fishbowl', items: ['decor-fishbowl'], line: '我想要小魚做朋友！', doneLine: '小魚游來游去，好可愛！', caption: '小願望實現了：魚缸！', name: '魚缸', act: 'gaze', pose: 'laugh' },
  { id: 'w-beanbag', items: ['decor-beanbag'], line: '我想要一個軟軟的位子！', doneLine: '軟綿綿的，好舒服！', caption: '小願望實現了：懶骨頭！', name: '懶骨頭', act: 'rubTummy', pose: 'happy' },
  { id: 'w-table', items: ['decor-table'], line: '我想要一張桌子，可以畫畫！', doneLine: '太好了，我們一起畫畫！', caption: '小願望實現了：桌椅！', name: '桌椅', act: 'wave', pose: 'cheer' },
  { id: 'w-bed', items: ['decor-bed'], line: '我想要一個睡覺的地方！', doneLine: '好舒服，我要睡一下囉！', caption: '小願望實現了：小床！', name: '小床', act: 'sleep', pose: 'sleep' },
  { id: 'w-car', items: ['decor-car'], line: '我想要一台小汽車，嘟嘟！', doneLine: '嘟嘟，出發囉！', caption: '小願望實現了：小汽車！', name: '小汽車', act: 'dance', pose: 'cheer' },
  { id: 'w-shelf', items: ['decor-shelf'], line: '我想要一個書架，放好多好多書！', doneLine: '好多書，我們每天看一本！', caption: '小願望實現了：書架！', name: '書架', act: 'wave', pose: 'happy' },
  { id: 'w-piano', items: ['decor-piano'], line: '我想要彈鋼琴！', doneLine: '啦啦啦，我來唱歌！', caption: '小願望實現了：小鋼琴！', name: '小鋼琴', act: 'sing', pose: 'sing' },
  { id: 'w-dino', items: ['decor-dino'], line: '我想要一隻恐龍朋友！', doneLine: '吼吼，恐龍來了！', caption: '小願望實現了：恐龍！', name: '恐龍', act: 'dance', pose: 'laugh' },
  { id: 'w-rocket', items: ['decor-rocket'], line: '我想坐火箭去月亮！', doneLine: '三、二、一，出發！', caption: '小願望實現了：火箭！', name: '火箭', act: 'dance', pose: 'cheer' },
  // 套裝（6–7 歲，可選做）
  { id: 'w-camp', items: ['decor-tent', 'decor-lamp', 'decor-rug'], line: '我想去露營！要帳篷、燈和地毯！', doneLine: '露營囉，好好玩！', caption: '小願望實現了：露營組！', name: '露營組', act: 'dance', pose: 'cheer', set: true },
  { id: 'w-party', items: ['decor-bunting', 'decor-rainbow', 'decor-cloudlamp'], line: '我想開派對！要彩旗、彩虹和夜燈！', doneLine: '派對開始囉！', caption: '小願望實現了：派對組！', name: '派對組', act: 'dance', pose: 'dance', set: true },
  { id: 'w-wall', items: ['decor-poster', 'decor-frame', 'decor-wallshelf'], line: '我想把牆布置得漂漂亮亮！要海報、畫框和層板！', doneLine: '哇，像美術館一樣！', caption: '小願望實現了：漂亮的牆！', name: '漂亮的牆', act: 'wave', pose: 'happy', set: true },
]
export const WISH_BY_ID: Record<string, WishDef> = Object.fromEntries(WISHES.map((w) => [w.id, w]))

/** 這個孩子看得到哪些願望（套裝只有 6–7 歲） */
export const wishesFor = (age: AgeBand): WishDef[] => WISHES.filter((w) => !w.set || age === '6-7')

/** 擺在房間裡的家具（擺放 key → 商品 id，第 2、3 個是 `<id>~2`） */
export const placedBaseIds = (keys: readonly string[]): Set<string> => new Set(keys.map(baseIdOf))

/** 這個願望要的家具都擺進房間了 */
export const wishPlaced = (w: WishDef, placed: ReadonlySet<string>): boolean => w.items.every((id) => placed.has(id))

export interface WishState {
  /** 已經結束的願望 id（實現了，或是在出現之前就已經擺好所以直接略過） */
  done: string[]
  /** 現在出現中的願望 */
  active?: string
}

/**
 * 往下找「現在的願望」：依固定順序第一個還沒結束的。
 * - 它是這次才輪到、而且家具早就擺好了（舊存檔，或孩子提早做了）：直接略過，不演也不送卡，找下一個。
 * - 它已經出現過（active）：不管擺好了沒，都停在這裡；擺好了就是「可以實現了」，由畫面決定什麼時候演。
 * 回傳新的狀態（沒有可做的願望 active 為 undefined）。
 */
export function advanceWish(state: WishState, placed: ReadonlySet<string>, age: AgeBand): WishState {
  const done = [...state.done]
  for (const w of wishesFor(age)) {
    if (done.includes(w.id)) continue
    if (w.id !== state.active && wishPlaced(w, placed)) {
      done.push(w.id)
      continue
    }
    return { done, active: w.id }
  }
  return { done }
}

/** 還缺的家具（工坊與泡泡上用）：還沒擺進房間的那幾件 */
export const wishMissing = (w: WishDef, placed: ReadonlySet<string>): string[] => w.items.filter((id) => !placed.has(id))

/** 家長區「本週」的一行字：這週實現了哪些願望、現在在許什麼願 */
export function wishWeekText(log: readonly { id: string; at: number }[], startMs: number, activeId: string | undefined): string {
  const mine = log.filter((l) => l.at >= startMs && WISH_BY_ID[l.id])
  const done = mine.length ? `這週實現了 ${mine.length} 個小願望：${mine.map((l) => WISH_BY_ID[l.id].name).join('、')}。` : '這週還沒有實現小願望。'
  const w = activeId ? WISH_BY_ID[activeId] : undefined
  const cur = w ? `阿悟現在想要：${w.items.map(itemName).join('、')}（在工坊做出來、擺進房間就實現，不限時間）。` : ''
  return `${done}${cur}`
}

/** 家具的中文名（商店目錄的名稱） */
export const itemName = (id: string): string => SHOP_ITEMS.find((i) => i.id === id)?.name ?? id
