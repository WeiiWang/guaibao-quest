// PM 預覽工具：讓產品端不用實際遊玩就能切換寵物階段、補資源，檢視各種狀態。
// 只從家長區（PIN 後）的「PM 預覽」分頁呼叫；會繞過每日星星上限，正式給測試家庭前要關掉（PM_TOOLS_ENABLED）。
import { ADULT_AT_FEED_COUNT, BABY_AT_FEED_COUNT } from '../domain/constants'
import { localDateStr } from '../domain/date'
import { rollDailyGift } from '../domain/gifts'
import { HAT_IDS } from '../domain/hats'
import { TRICK_IDS } from '../domain/tricks'
import type { Stage } from '../domain/types'
import { MATERIAL_IDS } from '../learning/types'
import { db } from './db'
import { queueGifts } from './meta'
import { rebuildAlbum } from './album'
import { newId } from './repo'

export const PM_TOOLS_ENABLED = true

const PET_ID = 'pet'
const FEED_FOR_STAGE: Record<Stage, number> = { egg: 0, baby: BABY_AT_FEED_COUNT, adult: ADULT_AT_FEED_COUNT }

export async function pmSetStage(stage: Stage, nearNext = false): Promise<void> {
  const base = FEED_FOR_STAGE[stage]
  const next = stage === 'egg' ? BABY_AT_FEED_COUNT : stage === 'baby' ? ADULT_AT_FEED_COUNT : base
  await db.pets.update(PET_ID, { stage, feedCount: nearNext && stage !== 'adult' ? next - 1 : base })
}

export async function pmSetHunger(hunger: number): Promise<void> {
  await db.pets.update(PET_ID, { hunger, hungerUpdatedAt: Date.now() })
}

export async function pmAddStars(amount: number): Promise<void> {
  await db.ledger.add({ id: newId(), at: Date.now(), delta: amount, reason: 'PM 預覽補星星', kind: 'bonus' })
}

export async function pmAddMaterials(amount: number): Promise<void> {
  const at = Date.now()
  await db.materialLedger.bulkAdd(
    MATERIAL_IDS.map((material) => ({ id: newId(), at, material, delta: amount, kind: 'station' as const, reason: 'PM 預覽補材料' })),
  )
}

/** 每種飼料各加 qty 個（含之後新增的食物） */
export async function pmAddFood(qty: number): Promise<number> {
  const foods = await db.shopItems.where('kind').equals('food').toArray()
  await db.transaction('rw', db.inventory, async () => {
    for (const f of foods) {
      const cur = await db.inventory.get(f.id)
      await db.inventory.put({ id: f.id, itemId: f.id, qty: (cur?.qty ?? 0) + qty })
    }
  })
  return foods.length
}

/** 擁有全部家具（不擺放），方便看佈置效果 */
export async function pmOwnAllDecor(): Promise<number> {
  const decor = await db.shopItems.where('kind').equals('decor').toArray()
  await db.transaction('rw', db.inventory, async () => {
    for (const d of decor) await db.inventory.put({ id: d.id, itemId: d.id, qty: 1 })
  })
  return decor.length
}

/** 清空房間裡所有便便與排定的大便 */
export async function pmClearPoops(): Promise<void> {
  await db.pets.update(PET_ID, { poops: [], poopDue: [] })
}

/** 解鎖全部新招（不經過慶祝；要看慶祝請用「重播新招慶祝」） */
export async function pmUnlockAllTricks(): Promise<number> {
  await db.pets.update(PET_ID, { tricks: [...TRICK_IDS] })
  return TRICK_IDS.length
}

/** 把全部新招排進慶祝佇列（回首頁會依序跳全螢幕慶祝並示範） */
export async function pmQueueTrickCelebrations(): Promise<void> {
  await db.pets.update(PET_ID, { tricks: [...TRICK_IDS] })
  await db.settings.update('main', { pendingTricks: [...TRICK_IDS] })
}

/** 送一份今日小禮物（不看今天領過沒有），回首頁會展示 */
export async function pmGrantGift(): Promise<void> {
  const at = Date.now()
  await db.transaction('rw', [db.settings, db.inventory, db.materialLedger], async () => {
    await queueGifts(db, [rollDailyGift(Math.random, localDateStr(at), at)])
  })
}

/** 擁有全部帽子（不戴上；回首頁點「更多」→「衣櫃」，或到商店「衣櫃」分頁戴） */
export async function pmOwnAllHats(): Promise<number> {
  await db.transaction('rw', db.inventory, async () => {
    for (const id of HAT_IDS) await db.inventory.put({ id, itemId: id, qty: 1 })
  })
  return HAT_IDS.length
}

/** 清掉成長相簿，依現況整個重新補建（舊里程碑；不標「新」）。回傳補了幾張 */
export async function pmRebuildAlbum(): Promise<number> {
  return rebuildAlbum(db, Date.now())
}
