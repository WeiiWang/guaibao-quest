// v7.4 線 K：朋友來作客、阿悟的小願望的資料操作。和 meta.ts、album.ts 一樣是「給 db 的函式」，由 repo.ts 的薄薄一層方法呼叫。
// 狀態全部存在 settings.play（optional），禮物直接寫進背包；不升 Dexie 版本。
import { albumId } from '../domain/album'
import { localDateStr } from '../domain/date'
import { friendOrder, GUEST_LOG_MAX, pickGuest, pickGuestGift, giftItemId, advanceWish, placedBaseIds, WISH_BY_ID } from '../domain/play74'
import type { AlbumCard, GuestGift, GuestVisit, PlayState, Settings } from '../domain/types'
import { getQuestion } from '../learning/bank'
import { learnerProfileOf } from '../learning/profile'
import type { Question } from '../learning/types'
import * as album from './album'
import type { GuaibaoDB } from './db'

const SETTINGS_ID = 'main'
const PET_ID = 'pet'

const playOf = (s: Settings | undefined): PlayState => s?.play ?? {}
const capLog = <T>(a: readonly T[], extra: T): T[] => [...a, extra].slice(-GUEST_LOG_MAX)

/** 今天來作客的朋友（不是今天的就是沒有人來） */
export const guestToday = (s: Settings | undefined, now: number): GuestVisit | undefined => {
  const g = s?.play?.guest
  return g && g.date === localDateStr(now) ? g : undefined
}

/**
 * 每天第一次進首頁：決定今天輪到哪位朋友作客（同一天只決定一次，之後怎麼進出都是同一位）。
 * - 順序依「孩子第一次遇到這位朋友的先後」；沒有來的日子不補（每天最多 1 位）
 * - 第一次來的朋友留下固定禮物（下一張還沒有的著色頁或連連看，全部有了改送食物），直接寫進背包
 * 回傳今天的訪客（沒有認識的朋友 = null）。
 */
export async function syncGuest(d: GuaibaoDB, now: number, lookup: (id: string) => Question | undefined = getQuestion): Promise<GuestVisit | null> {
  const date = localDateStr(now)
  const s0 = await d.settings.get(SETTINGS_ID)
  if (!s0 || !s0.onboarded) return null
  if (s0.play?.guest?.date === date) return s0.play.guest
  const order = friendOrder(await d.attempts.toArray(), lookup)
  return d.transaction('rw', [d.settings, d.inventory], async () => {
    const s = await d.settings.get(SETTINGS_ID)
    if (!s) return null
    const play = playOf(s)
    if (play.guest?.date === date) return play.guest
    const visited = play.guestVisited ?? []
    const visits = play.guestVisits ?? 0
    const pick = pickGuest(order, visited, visits)
    if (!pick) return null
    let gift: GuestGift | undefined
    if (pick.first) {
      const inv = await d.inventory.toArray()
      const owned = new Set(inv.filter((v) => v.qty > 0).map((v) => v.itemId))
      gift = pickGuestGift(owned, learnerProfileOf(s).ageBand, visited.length)
      const itemId = gift.kind === 'food' ? gift.id : giftItemId(gift)
      const cur = inv.find((v) => v.itemId === itemId)
      await d.inventory.put({ id: itemId, itemId, qty: (cur?.qty ?? 0) + 1 })
    }
    const visit: GuestVisit = { date, friendId: pick.friendId, first: pick.first, ...(gift ? { gift } : {}) }
    await d.settings.update(SETTINGS_ID, {
      play: {
        ...play,
        guest: visit,
        guestVisited: pick.first ? [...visited, pick.friendId] : visited,
        guestVisits: visits + 1,
        guestLog: capLog(play.guestLog ?? [], { date, friendId: pick.friendId, ...(gift ? { gift } : {}) }),
      },
    })
    return visit
  })
}

/** 孩子看過今天的禮物了 / 聽過「今天 XX 來玩囉」了 */
export async function markGuest(d: GuaibaoDB, flag: 'seen' | 'greeted'): Promise<void> {
  await d.transaction('rw', d.settings, async () => {
    const s = await d.settings.get(SETTINGS_ID)
    const g = s?.play?.guest
    if (!s || !g || g[flag]) return
    await d.settings.update(SETTINGS_ID, { play: { ...playOf(s), guest: { ...g, [flag]: true } } })
  })
}

/**
 * 小願望：決定「現在的願望」（依固定順序；出現之前就已經擺好的直接略過）。蛋還沒孵出來不出願望。
 * 回傳現在的願望 id（沒有 = undefined）。
 */
export async function syncWish(d: GuaibaoDB): Promise<string | undefined> {
  return d.transaction('rw', [d.settings, d.pets, d.placements], async () => {
    const [s, pet] = await Promise.all([d.settings.get(SETTINGS_ID), d.pets.get(PET_ID)])
    if (!s || !s.onboarded || !pet || pet.stage === 'egg') return s?.play?.wishActive
    const play = playOf(s)
    const placed = placedBaseIds((await d.placements.toArray()).map((p) => p.itemId))
    const next = advanceWish({ done: play.wishDone ?? [], active: play.wishActive }, placed, learnerProfileOf(s).ageBand)
    if (next.active !== play.wishActive || next.done.length !== (play.wishDone ?? []).length) {
      await d.settings.update(SETTINGS_ID, { play: { ...play, wishDone: next.done, wishActive: next.active } })
    }
    return next.active
  })
}

/** 自動說過這個願望了 */
export async function markWishSaid(d: GuaibaoDB, id: string): Promise<void> {
  await d.transaction('rw', d.settings, async () => {
    const s = await d.settings.get(SETTINGS_ID)
    if (!s || s.play?.wishSaid === id) return
    await d.settings.update(SETTINGS_ID, { play: { ...playOf(s), wishSaid: id } })
  })
}

/**
 * 小願望實現了：記下來、送一張回憶卡（標「新」）、接著輪到下一個願望。
 * 家具有沒有真的擺進房間由這裡再確認一次（沒擺好就什麼都不做）。回傳新增的回憶卡（沒有 = null）。
 */
export async function completeWish(d: GuaibaoDB, id: string, now: number): Promise<AlbumCard | null> {
  const w = WISH_BY_ID[id]
  if (!w) return null
  return d.transaction('rw', [d.settings, d.pets, d.placements], async () => {
    const [s, pet] = await Promise.all([d.settings.get(SETTINGS_ID), d.pets.get(PET_ID)])
    if (!s || !pet) return null
    const play = playOf(s)
    if (play.wishActive !== id) return null
    const placed = placedBaseIds((await d.placements.toArray()).map((p) => p.itemId))
    if (!w.items.every((i) => placed.has(i))) return null
    const card: AlbumCard = {
      id: albumId.wish(id),
      at: now,
      kind: 'wish',
      art: `pet-${pet.stage === 'adult' ? 'adult' : 'baby'}-${w.pose}`,
      caption: w.caption,
      reward: w.items[0],
      fresh: true,
    }
    const done = [...(play.wishDone ?? []), id]
    const next = advanceWish({ done, active: undefined }, placed, learnerProfileOf(s).ageBand)
    await d.settings.update(SETTINGS_ID, {
      play: { ...play, wishDone: next.done, wishActive: next.active, wishLog: capLog(play.wishLog ?? [], { id, at: now }) },
    })
    const added = await album.addCards(d, [card])
    return added[0] ?? null
  })
}
