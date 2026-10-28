// v7 線 C：禮物袋、歡迎禮物、成長里程碑、家具多個與換色的資料操作。
// 和 meta.ts、album.ts 一樣是「給 db 的函式」，由 repo.ts 的薄薄一層方法呼叫。全部用 optional 欄位，不升 Dexie 版本。
import { SHOP_ITEMS } from '../domain/constants'
import { albumId } from '../domain/album'
import { baseIdOf, MAX_DECOR_COPIES, milestonesCrossed, nextFreeKey, pickMilestoneReward, WELCOME_FOOD, WELCOME_REASON, WELCOME_STARS } from '../domain/home7'
import { WELCOME_REF } from '../domain/points'
import type { AlbumCard, Gift } from '../domain/types'
import * as album from './album'
import type { GuaibaoDB } from './db'
import { queueGifts } from './meta'

const SETTINGS_ID = 'main'

let seq = 0
const ledgerId = () => `welcome:${Date.now().toString(36)}:${(seq = (seq + 1) % 1_000_000).toString(36)}`

/**
 * 新孩子的歡迎禮物：20 顆星星（流水帳，理由「歡迎禮物」）+ 1 個食物（進背包，並排進禮物袋）。
 * 只送一次（settings.welcomeGranted）；呼叫端是「建立新孩子」的流程，舊孩子不會經過這裡，所以不補送。
 * 回傳有沒有送出。
 */
export async function grantWelcomeGift(d: GuaibaoDB, now: number): Promise<boolean> {
  return d.transaction('rw', [d.settings, d.ledger, d.inventory, d.materialLedger], async () => {
    const s = await d.settings.get(SETTINGS_ID)
    if (!s || s.welcomeGranted) return false
    await d.ledger.add({ id: ledgerId(), at: now, delta: WELCOME_STARS, reason: WELCOME_REASON, kind: 'bonus', refId: WELCOME_REF })
    await queueGifts(d, [{ foodId: WELCOME_FOOD, at: now, from: 'welcome' }])
    await d.settings.update(SETTINGS_ID, { welcomeGranted: true })
    return true
  })
}

/** 禮物袋：一次收下全部待展示的禮物（東西早就在背包裡，這裡只是清空佇列）。回傳收下的所有禮物 */
export async function collectAllGifts(d: GuaibaoDB): Promise<Gift[]> {
  return d.transaction('rw', d.settings, async () => {
    const list = (await d.settings.get(SETTINGS_ID))?.pendingGifts ?? []
    if (list.length === 0) return []
    await d.settings.update(SETTINGS_ID, { pendingGifts: [] })
    return list
  })
}

const itemName = (id: string): string => SHOP_ITEMS.find((i) => i.id === id)?.name ?? '小禮物'

/**
 * 成長里程碑：幼體到成體的路上，餵食次數每跨過 40、60 送一份小禮物（沒有的小擺飾 / 壁紙 / 地板，都有了就送蛋糕），
 * 並新增一張回憶卡。在 feedPet 的交易裡呼叫（交易要包含 inventory、settings）。回傳這次新增的回憶卡
 */
export async function awardMilestones(d: GuaibaoDB, petName: string, before: number, after: number, now: number): Promise<AlbumCard[]> {
  const crossed = milestonesCrossed(before, after)
  if (crossed.length === 0) return []
  const s = await d.settings.get(SETTINGS_ID)
  if (!s) return []
  const given = new Set(s.milestonesGiven ?? [])
  const cards: AlbumCard[] = []
  for (const t of crossed) {
    if (given.has(t)) continue
    const inv = await d.inventory.toArray()
    const owned = new Set(inv.filter((v) => v.qty > 0).map((v) => v.itemId))
    const r = pickMilestoneReward(t, owned)
    const cur = inv.find((v) => v.itemId === r.itemId)
    await d.inventory.put({ id: r.itemId, itemId: r.itemId, qty: (cur?.qty ?? 0) + 1 })
    given.add(t)
    cards.push({
      id: albumId.milestone(t),
      at: now,
      kind: 'milestone',
      art: 'pet-baby-cheer',
      caption: `${petName}又長大一點了！送你${itemName(r.itemId)}`,
      reward: r.itemId,
      fresh: true,
    })
  }
  await d.settings.update(SETTINGS_ID, { milestonesGiven: [...given].sort((a, b) => a - b) })
  await album.addCards(d, cards)
  return cards
}

/** 這件家具可擺的總數（擁有數，最多 MAX_DECOR_COPIES） */
export const decorCopies = (qty: number | undefined): number => Math.min(MAX_DECOR_COPIES, Math.max(0, qty ?? 0))

/** 下一個空的擺放 key（第 1 個沿用商品 id，第 2、3 個是 `<id>~2`、`~3`）；擺滿了回 null */
export async function nextPlacementKey(d: GuaibaoDB, baseId: string): Promise<string | null> {
  const inv = await d.inventory.get(baseId)
  const keys = (await d.placements.toArray()).map((p) => p.itemId).filter((k) => baseIdOf(k) === baseId)
  return nextFreeKey(baseId, inv?.qty ?? 0, keys)
}
