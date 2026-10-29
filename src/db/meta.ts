// v5 線 C：經濟與長期目標的資料操作（學習掉落、今日小禮物、圖鑑、新招）。
// 全部是「給 db 的函式」，由 repo.ts 的薄薄一層方法呼叫；這樣 repo.ts 只多幾行，其他線合併時好處理。
import { localDateStr } from '../domain/date'
import { collectionRewardsDue, rollDailyGift, rollStationDrop } from '../domain/gifts'
import { collectionStep, friendStats, type FriendStat } from '../domain/friends'
import { collectionGiftSticker } from '../domain/stickers'
import { newTricks, type TrickId } from '../domain/tricks'
import type { Gift } from '../domain/types'
import { getQuestion } from '../learning/bank'
import { learnerProfileOf } from '../learning/profile'
import { stationFoodQty } from '../learning/scoring'
import type { Question, SkillState } from '../learning/types'
import type { GuaibaoDB } from './db'

const SETTINGS_ID = 'main'
const PET_ID = 'pet'

let seq = 0
const giftId = (g: Gift) => `gift:${g.at}:${g.materialId ?? ''}:${(seq = (seq + 1) % 1_000_000).toString(36)}:${Math.random().toString(36).slice(2, 6)}`

/**
 * 發放禮物：東西當下就寫進背包（食物 / 材料 / 貼紙），並加進 pendingGifts 等著展示。
 * 呼叫端的交易要包含 inventory、materialLedger、settings。
 */
export async function queueGifts(d: GuaibaoDB, gifts: Gift[]): Promise<void> {
  if (gifts.length === 0) return
  const s = await d.settings.get(SETTINGS_ID)
  if (!s) return
  const stickers = [...(s.stickers ?? [])]
  for (const g of gifts) {
    if (g.foodId) {
      const inv = await d.inventory.get(g.foodId)
      await d.inventory.put({ id: g.foodId, itemId: g.foodId, qty: (inv?.qty ?? 0) + (g.qty ?? 1) })
    } else if (g.materialId) {
      await d.materialLedger.add({ id: giftId(g), at: g.at, material: g.materialId, delta: g.qty ?? 1, kind: 'station', reason: '今日小禮物' })
    } else if (g.stickerId && !stickers.includes(g.stickerId)) stickers.push(g.stickerId)
  }
  await d.settings.update(SETTINGS_ID, { pendingGifts: [...(s.pendingGifts ?? []), ...gifts], stickers })
}

/**
 * 一站過關掉落的食物（在 completeStation 的交易裡呼叫）。v7：直接進背包，不再排進 pendingGifts，
 * 結算畫面當場顯示得到什麼。個數固定（見 stationFoodQty），種類隨機（今天最愛的食物機率較高，不掉蛋糕）。
 * 回傳掉落的食物 id（依序）。呼叫端的交易要包含 inventory。
 */
export async function grantStationFoods(d: GuaibaoDB, rng: () => number, now: number, independent: number): Promise<string[]> {
  const foods = Array.from({ length: stationFoodQty(independent) }, () => rollStationDrop(rng, localDateStr(now)))
  for (const foodId of foods) {
    const inv = await d.inventory.get(foodId)
    await d.inventory.put({ id: foodId, itemId: foodId, qty: (inv?.qty ?? 0) + 1 })
  }
  return foods
}

/**
 * 今日小禮物：每天第一次進首頁送一份（沒有連續天數獎勵，漏掉不補）。
 * 全新使用者的第一天有首次引導（阿悟指著冒險地圖），那天不送，從隔天開始。
 */
export async function grantDailyGift(d: GuaibaoDB, rng: () => number, now: number): Promise<Gift | null> {
  const date = localDateStr(now)
  return d.transaction('rw', [d.settings, d.inventory, d.materialLedger], async () => {
    const s = await d.settings.get(SETTINGS_ID)
    if (!s || !s.onboarded || s.lastGiftDate === date) return null
    if (!s.lastGiftDate && !s.homeGuideShown) {
      await d.settings.update(SETTINGS_ID, { lastGiftDate: date })
      return null
    }
    const g = rollDailyGift(rng, date, now)
    await d.settings.update(SETTINGS_ID, { lastGiftDate: date })
    await queueGifts(d, [g])
    return g
  })
}

export const getPendingGifts = async (d: GuaibaoDB): Promise<Gift[]> => (await d.settings.get(SETTINGS_ID))?.pendingGifts ?? []

/** 收下第一份待展示的禮物（東西早就在背包裡，這裡只是從佇列拿掉）。回傳收下的禮物 */
export async function collectGift(d: GuaibaoDB): Promise<Gift | null> {
  return d.transaction('rw', d.settings, async () => {
    const list = (await d.settings.get(SETTINGS_ID))?.pendingGifts ?? []
    if (list.length === 0) return null
    await d.settings.update(SETTINGS_ID, { pendingGifts: list.slice(1) })
    return list[0]
  })
}

// ---------- 圖鑑 ----------

/** 每個朋友遇過、答對幾次（從作答紀錄的題目回推，舊存檔也有；題庫改版後找不到的題目略過） */
export async function friendStatsOf(d: GuaibaoDB, lookup: (id: string) => Question | undefined = getQuestion): Promise<Record<string, FriendStat>> {
  return friendStats(await d.attempts.toArray(), lookup)
}

/** 孩子答題時遇過的朋友 id（物件、動物、英文單字、生活與自然的圖） */
export async function knownFriends(d: GuaibaoDB, lookup: (id: string) => Question | undefined = getQuestion): Promise<Set<string>> {
  return new Set(Object.keys(await friendStatsOf(d, lookup)))
}

/** 圖鑑每收集滿 N 個送 1 份禮物（N 依總數調整，見 collectionStep；補發還沒送的）。回傳這次新送出幾份 */
export async function syncCollection(d: GuaibaoDB, rng: () => number, now: number): Promise<number> {
  const known = (await knownFriends(d)).size
  const due = collectionRewardsDue(known, collectionStep())
  return d.transaction('rw', [d.settings, d.inventory, d.materialLedger], async () => {
    const s = await d.settings.get(SETTINGS_ID)
    if (!s) return 0
    const owed = due - (s.collectionRewarded ?? 0)
    if (owed <= 0) return 0
    // v7.4 I4：第 1、3、5… 份收集禮物送下一張還沒擁有的貼紙（固定順序），其餘送食物（見 domain/stickers.ts 的 collectionGiftSticker）
    const have = [...(s.stickers ?? [])]
    const gifts: Gift[] = []
    for (let k = 1; k <= owed; k++) {
      const stickerId = collectionGiftSticker(have, (s.collectionRewarded ?? 0) + k)
      if (stickerId) {
        have.push(stickerId)
        gifts.push({ stickerId, at: now, from: 'collection' as const })
      } else gifts.push({ foodId: rollStationDrop(rng, localDateStr(now)), at: now, from: 'collection' as const })
    }
    await queueGifts(d, gifts)
    await d.settings.update(SETTINGS_ID, { collectionRewarded: due })
    return owed
  })
}

// ---------- 新招 ----------

/**
 * 依學習里程碑讓阿悟學會新招：技能難度升級 / 首次 mastered，或通關第一章。
 * 只讀 skillState 與章節進度；新學會的招寫進 pet.tricks，並排進 pendingTricks 等著慶祝。回傳這次新學會的招
 */
export async function syncTricks(d: GuaibaoDB): Promise<TrickId[]> {
  const [rows, progs, settings, pet] = await Promise.all([d.skillState.toArray(), d.progress.toArray(), d.settings.get(SETTINGS_ID), d.pets.get(PET_ID)])
  if (!pet) return []
  const states: Partial<Record<string, Pick<SkillState, 'difficulty' | 'mastered'>>> = Object.fromEntries(rows.map((r) => [r.skill, r]))
  const clearedChapters = progs.filter((p) => p.completedRuns > 0 || (p.stations.length > 0 && p.stations.every((s) => s.done))).map((p) => p.chapterId)
  const startDifficulty = learnerProfileOf(settings).startDifficulty
  return d.transaction('rw', [d.pets, d.settings], async () => {
    const cur = (await d.pets.get(PET_ID))?.tricks ?? []
    const fresh = newTricks({ states, startDifficulty, clearedChapters }, cur)
    if (fresh.length === 0) return []
    await d.pets.update(PET_ID, { tricks: [...cur, ...fresh] })
    const pending = (await d.settings.get(SETTINGS_ID))?.pendingTricks ?? []
    await d.settings.update(SETTINGS_ID, { pendingTricks: [...pending, ...fresh] })
    return fresh
  })
}

/** 關掉一個新招慶祝（從佇列拿掉第一個） */
export async function popPendingTrick(d: GuaibaoDB): Promise<string | null> {
  return d.transaction('rw', d.settings, async () => {
    const list = (await d.settings.get(SETTINGS_ID))?.pendingTricks ?? []
    if (list.length === 0) return null
    await d.settings.update(SETTINGS_ID, { pendingTricks: list.slice(1) })
    return list[0]
  })
}
