// v8.1 線 Q：房間開局就有的內建陳設（矮櫃、牆上相框組、地墊）。畫在背景層，不佔擺放格、不算家具、不影響願望。
// 玩家擺了同類家具、或大件家具幾乎蓋住它時，陳設讓位（不顯示），房間才不會亂。全部純函式。
import type { DecorSlot } from './types'

export type FixtureId = 'cabinet' | 'photos' | 'mat'

export interface RoomFixture {
  id: FixtureId
  /** public/art/<art>.png */
  art: string
  slot: DecorSlot
  /** 中心 x，佔房間寬的比例 */
  x: number
  /** 下緣 y，佔房間高的比例 */
  bottom: number
  /** 高，佔房間高的比例（和家具、寵物同一把尺） */
  h: number
  /** 寬 / 高（依實際圖片） */
  aspect: number
  /** 看到這些家具疊上來就讓位（同類） */
  kin: readonly string[]
}

const MAT: RoomFixture = { id: 'mat', art: 'ui-room-mat', slot: 'floor', x: 0.3, bottom: 0.985, h: 0.26, aspect: 512 / 296, kin: ['decor-rug'] }
const CABINET_KIN = ['decor-shelf', 'decor-wallshelf', 'decor-crate', 'decor-table', 'decor-piano']
const PHOTOS_KIN = ['decor-frame', 'decor-poster', 'decor-rainbow', 'decor-wallshelf']
const cabinet = (x: number): RoomFixture => ({ id: 'cabinet', art: 'ui-room-cabinet', slot: 'floor', x, bottom: 0.72, h: 0.29, aspect: 453 / 512, kin: CABINET_KIN })
const photos = (x: number, bottom: number, h: number): RoomFixture => ({ id: 'photos', art: 'ui-room-photos', slot: 'wall', x, bottom, h, aspect: 491 / 512, kin: PHOTOS_KIN })

/** 節慶掛飾的位置：x = 中心（房間寬的比例）；top 用房間高的比例；寬取兩者較小：佔房間高幾倍、佔房間寬多少 */
export interface FestivalSpot {
  x: number
  top: number
  /** 寬度上限（房間高的比例） */
  wOfH: number
  /** 寬度上限（房間寬的比例；可視寬 = 房間寬 / 2.5） */
  wOfW: number
}

export interface FixtureLayout {
  fixtures: readonly RoomFixture[]
  festival: FestivalSpot
}

/**
 * 依房間長寬比（房間寬 / 高）排版。大小跟著房間高度（和家具、寵物同一把尺），但可視寬度差很多，一套位置放不下三種畫面：
 * 房間一打開時畫面中心是寵物（PET_X = 0.3），可視寬 = 房間寬 / 2.5；窗戶從 22% 開始，寬約 0.36 個房間高。
 * - 寬（iPad 橫向，約 5.4）：地墊在寵物腳下；窗戶右邊的牆放矮櫃，上面掛相框，一面家的牆
 * - 中（iPad 直向，約 2.3）：矮櫃在窗下、寵物右後方；窗戶太大，相框小一點掛到窗戶左邊（狀態卡下面）
 * - 窄（手機，約 1.8）：寵物就佔了半個畫面、右邊還有工具列，放了只會被擋住：矮櫃和相框放到往右滑才看到的那面牆
 */
export function fixtureLayout(aspect: number): FixtureLayout {
  if (aspect >= 3.2) return { fixtures: [MAT, cabinet(0.385), photos(0.385, 0.41, 0.24)], festival: { x: 0.295, top: 0.005, wOfH: 0.72, wOfW: 0.14 } }
  if (aspect >= 2) return { fixtures: [MAT, cabinet(0.4), photos(0.149, 0.37, 0.18)], festival: { x: 0.32, top: 0.005, wOfH: 0.72, wOfW: 0.22 } }
  return { fixtures: [MAT, cabinet(0.58), photos(0.58, 0.41, 0.24)], festival: { x: 0.32, top: 0.165, wOfH: 0.72, wOfW: 0.22 } }
}

/** 三種版面都有的三件（給測試與清單用；iPad 橫向的位置） */
export const ROOM_FIXTURES = fixtureLayout(5.4).fixtures

/** 一件擺好的家具：baseId = 商品 id；x / y 中心、w / h 都是 px */
export interface PlacedBox {
  baseId: string
  slot?: DecorSlot
  x: number
  y: number
  w: number
  h: number
}

/** 別的家具蓋住陳設超過這個比例就讓位（小東西擺在前面很自然，不用讓） */
export const FIXTURE_COVER_LIMIT = 0.35

/** 陳設的矩形（px） */
export function fixtureRect(f: RoomFixture, roomW: number, roomH: number): { left: number; top: number; right: number; bottom: number } {
  const h = f.h * roomH
  const w = h * f.aspect
  const cx = f.x * roomW
  const bottom = f.bottom * roomH
  return { left: cx - w / 2, right: cx + w / 2, top: bottom - h, bottom }
}

/** 哪些陳設要讓位：同類家具只要碰到就讓；地墊之外，同一面（牆 / 地）的家具蓋住超過 FIXTURE_COVER_LIMIT 也讓（東西站在地墊上很自然） */
export function fixturesGivingWay(placed: readonly PlacedBox[], roomW: number, roomH: number): FixtureId[] {
  if (roomW <= 0 || roomH <= 0) return []
  return fixtureLayout(roomW / roomH).fixtures.filter((f) => {
    const r = fixtureRect(f, roomW, roomH)
    const area = (r.right - r.left) * (r.bottom - r.top)
    return placed.some((p) => {
      const ox = Math.min(r.right, p.x + p.w / 2) - Math.max(r.left, p.x - p.w / 2)
      const oy = Math.min(r.bottom, p.y + p.h / 2) - Math.max(r.top, p.y - p.h / 2)
      if (ox <= 0 || oy <= 0) return false
      if (f.kin.includes(p.baseId)) return true
      return f.id !== 'mat' && p.slot === f.slot && (ox * oy) / area >= FIXTURE_COVER_LIMIT
    })
  }).map((f) => f.id)
}
