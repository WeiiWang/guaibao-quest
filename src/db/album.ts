// v6 線 C：成長相簿與帽子衣櫃的資料操作。和 meta.ts 一樣是「給 db 的函式」，由 repo.ts 的薄薄一層方法呼叫。
// 卡片存在 settings.album、戴著哪頂存在 pet.hat、擁有紀錄用 inventory，全部是 optional 欄位，不升 Dexie 版本。
import { albumId, expectedCards, missingCards } from '../domain/album'
import type { Species } from '../domain/species'
import { canWearHat, HAT_IDS, isHatId } from '../domain/hats'
import type { AlbumCard, Stage } from '../domain/types'
import { getChapter } from '../learning/chapter'
import type { GuaibaoDB } from './db'

const SETTINGS_ID = 'main'
const PET_ID = 'pet'

export type HatResult = { ok: true; hat: string | null } | { ok: false; error: string; reason?: 'egg' | 'notOwned' | 'unknown' }

/** 戴上（hatId）或拿下（null）一頂帽子。要擁有、而且不能是蛋 */
export async function setHat(d: GuaibaoDB, hatId: string | null): Promise<HatResult> {
  return d.transaction('rw', [d.pets, d.inventory], async () => {
    const pet = await d.pets.get(PET_ID)
    if (!pet) return { ok: false, error: '找不到寵物', reason: 'unknown' } as const
    if (hatId === null) {
      await d.pets.put({ ...pet, hat: undefined })
      return { ok: true, hat: null } as const
    }
    if (!isHatId(hatId)) return { ok: false, error: '這不是帽子', reason: 'unknown' } as const
    if (!canWearHat(pet.stage)) return { ok: false, error: `${pet.name}還在蛋裡，孵出來才能戴帽子`, reason: 'egg' } as const
    const inv = await d.inventory.get(hatId)
    if (!inv || inv.qty < 1) return { ok: false, error: '還沒有這頂帽子', reason: 'notOwned' } as const
    await d.pets.put({ ...pet, hat: hatId })
    return { ok: true, hat: hatId } as const
  })
}

/** 擁有的帽子 id（依帽子目錄順序） */
export async function ownedHats(d: GuaibaoDB): Promise<string[]> {
  const rows = await d.inventory.bulkGet(HAT_IDS)
  return HAT_IDS.filter((_, i) => (rows[i]?.qty ?? 0) > 0)
}

/** 退回剛買的帽子之後：正戴著就拿下；一頂都不剩就把「第一頂帽子」那張回憶卡也收回 */
export async function afterHatUndone(d: GuaibaoDB, hatId: string): Promise<void> {
  const pet = await d.pets.get(PET_ID)
  const inv = await d.inventory.get(hatId)
  if (pet?.hat === hatId && (inv?.qty ?? 0) < 1) await d.pets.put({ ...pet, hat: undefined })
  if ((await ownedHats(d)).length === 0) {
    const s = await d.settings.get(SETTINGS_ID)
    if (s?.album?.some((c) => c.id === albumId.hat)) await d.settings.update(SETTINGS_ID, { album: s.album.filter((c) => c.id !== albumId.hat) })
  }
}

// ---------- 成長相簿 ----------

export const getAlbum = async (d: GuaibaoDB): Promise<AlbumCard[]> => (await d.settings.get(SETTINGS_ID))?.album ?? []

/** 把卡片寫進相簿（同 id 已經有就略過）。呼叫端的交易要包含 settings。回傳真正新增的 */
export async function addCards(d: GuaibaoDB, cards: AlbumCard[]): Promise<AlbumCard[]> {
  const s = await d.settings.get(SETTINGS_ID)
  if (!s) return []
  const have = new Set((s.album ?? []).map((c) => c.id))
  const fresh = cards.filter((c, i) => !have.has(c.id) && cards.findIndex((x) => x.id === c.id) === i)
  if (fresh.length === 0) return []
  await d.settings.update(SETTINGS_ID, { album: [...(s.album ?? []), ...fresh] })
  return fresh
}

/** 孵化 / 長大的當下：寫進一張新卡（feedPet 的交易裡呼叫；交易要包含 settings） */
export async function addGrowthCard(d: GuaibaoDB, petName: string, evolvedTo: Stage, now: number, species?: Species): Promise<AlbumCard[]> {
  // 從蛋一路跳到成猴（極少見）時，孵化那張也一起補上；已經有的 id 會被 missingCards 略過
  const exp = expectedCards({ petName, species, stage: evolvedTo, tricks: [], chapters: [] }).filter((c) => c.id === albumId.hatch || c.id === albumId.grow)
  const s = await d.settings.get(SETTINGS_ID)
  return addCards(d, missingCards(s?.album ?? [], exp, now, 'event'))
}

/**
 * 依目前進度補齊相簿：阿悟孵化了沒、學會哪些招、通關哪些章節、有沒有帽子。
 * - 第一次執行（settings.albumInit 還沒有）是「補建」：舊玩家已經發生過的里程碑一次補齊，不標「新」、日期顯示「以前」（通關有紀錄的用真實日期）
 * - 之後新發生的里程碑（新招、通關、第一頂帽子）：記成現在、標成「新」，首頁依序跳給孩子看；
 *   孵化 / 長大不是在眼前發生的（例如家長用 PM 直接切階段）就安靜補上；餵食當下的孵化 / 長大由 addGrowthCard 即時新增（標「新」）
 * 重複執行不會重複新增。回傳這次新增的卡
 */
export async function syncAlbum(d: GuaibaoDB, now: number, forceBackfill = false): Promise<AlbumCard[]> {
  return d.transaction('rw', [d.pets, d.settings, d.progress, d.inventory, d.ledger], async () => {
    const [pet, s, progs] = await Promise.all([d.pets.get(PET_ID), d.settings.get(SETTINGS_ID), d.progress.toArray()])
    if (!pet || !s) return []
    const backfill = forceBackfill || !s.albumInit
    const chapters = progs.flatMap((p) => {
      const ch = getChapter(p.chapterId)
      if (!ch) return [] // 每日冒險等不是章節
      const done = p.completedRuns > 0 || (p.stations.length > 0 && p.stations.every((st) => st.done))
      if (!done) return []
      const times = p.stations.map((st) => st.completedAt ?? 0).filter((t) => t > 0)
      return [{ id: ch.id, name: ch.name, at: times.length ? Math.max(...times) : undefined }]
    })
    const owned = await ownedHats(d)
    let firstHat: { id: string; at?: number } | undefined
    if (owned.length > 0) {
      const buys = (await d.ledger.where('kind').equals('purchase').toArray()).filter((l) => l.refId && isHatId(l.refId)).sort((a, b) => a.at - b.at)
      firstHat = buys[0] ? { id: buys[0].refId as string, at: buys[0].at } : { id: owned[0] }
      // 買過又退回的帽子不算第一頂：以現在還擁有的為準
      if (!owned.includes(firstHat.id)) firstHat = { id: owned[0], at: buys.find((b) => b.refId === owned[0])?.at }
    }
    const exp = expectedCards({ petName: pet.name, species: pet.species, stage: pet.stage, tricks: pet.tricks ?? [], chapters, firstHat })
    const add = missingCards(s.album ?? [], exp, now, backfill ? 'backfill' : 'sync')
    if (add.length === 0 && s.albumInit) return []
    await d.settings.update(SETTINGS_ID, { album: [...(s.album ?? []), ...add], albumInit: true })
    return add
  })
}

/** 孩子看過這張新卡了（拿掉「新」旗標） */
export async function seeCard(d: GuaibaoDB, id: string): Promise<void> {
  await d.transaction('rw', d.settings, async () => {
    const s = await d.settings.get(SETTINGS_ID)
    if (!s?.album?.some((c) => c.id === id && c.fresh)) return
    await d.settings.update(SETTINGS_ID, { album: s.album.map((c) => (c.id === id ? { ...c, fresh: undefined } : c)) })
  })
}

/** PM / 家長用：清掉相簿，依現況整個重新補建（舊里程碑、不標「新」） */
export async function rebuildAlbum(d: GuaibaoDB, now: number): Promise<number> {
  await d.settings.update(SETTINGS_ID, { album: [], albumInit: false })
  return (await syncAlbum(d, now, true)).length
}
