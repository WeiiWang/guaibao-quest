// v6 線 C：成長相簿。孵化、長大、學會新招、通關章節、得到第一頂帽子時，自動新增一張「回憶卡」。
// 這裡只有純函式：依目前的狀態算出「應該有哪些卡」，資料庫端（db/album.ts）再扣掉已經有的。
// 卡片不是截圖：畫面上用元件即時繪製（阿悟當時的姿勢圖、日期、一句話）。
import { trickOf, type TrickId } from './tricks'
import { hatOf } from './hats'
import type { AlbumCard, AlbumKind, Stage } from './types'
import { parsePetArt, petArt, type Species } from './species'

/** 卡片的 id 規則：同一件事永遠同一個 id，所以補建與事件寫入都不會重複 */
export const albumId = {
  hatch: 'hatch',
  grow: 'grow',
  trick: (id: string) => `trick:${id}`,
  chapter: (id: string) => `chapter:${id}`,
  hat: 'hat:first',
  /** v7：幼體到成體路上的成長里程碑（門檻 40、60） */
  milestone: (n: number) => `milestone:${n}`,
  /** v7.4：阿悟的小願望實現（id 見 domain/play74.ts 的 WISHES） */
  wish: (id: string) => `wish:${id}`,
} as const

/** 畫面上每一類的小標籤與顏色 */
export const ALBUM_KIND_LABEL: Record<AlbumKind, { label: string; emoji: string }> = {
  hatch: { label: '孵化', emoji: '🥚' },
  grow: { label: '長大', emoji: '🌟' },
  trick: { label: '新本領', emoji: '🎪' },
  chapter: { label: '通關', emoji: '🗺️' },
  hat: { label: '第一頂帽子', emoji: '👑' },
  milestone: { label: '長大一點', emoji: '🎁' },
  wish: { label: '小願望', emoji: '✨' },
}

/** 回憶卡一律先選「開心」的姿勢；每一招各配一個姿勢（用現有的阿悟姿勢圖，不需要新素材） */
const TRICK_POSE: Record<string, string> = { count: 'think', tidy: 'happy', rhythm: 'dance', hello: 'cheer', flip: 'cheer' }

const stageOf = (s: Stage): 'baby' | 'adult' => (s === 'adult' ? 'adult' : 'baby')
/** v7.5：卡片的圖用這隻寵物的物種（猴子維持 pet-baby-cheer 這種舊檔名） */
const artOf = (stage: Stage, pose: string, species?: Species): string => petArt(species, stageOf(stage), pose)

export const hatchLine = (petName: string): string => `${petName}孵出來了！`
export const growLine = (petName: string): string => `${petName}長大了！`
export const trickCardLine = (petName: string, trickName: string): string => `${petName}學會了新本領：${trickName}！`
export const chapterLine = (chapterName: string): string => `我們一起通關了${chapterName}！`
export const firstHatLine = (petName: string, hatName: string): string => `${petName}有第一頂帽子了：${hatName}！`

export interface AlbumFacts {
  petName: string
  /** v7.5：寵物的物種（沒有 = 猴子） */
  species?: Species
  stage: Stage
  tricks: readonly string[]
  /** 已通關的章節（id、名稱、通關時間；時間不明就不填） */
  chapters: { id: string; name: string; at?: number }[]
  /** 第一頂帽子（沒買過就不填）；at 不明就不填 */
  firstHat?: { id: string; at?: number }
}

/** 依現況算出「應該有」的回憶卡（不看已經有哪些）。時間不明的卡標成 approx（畫面顯示「以前」） */
export function expectedCards(f: AlbumFacts): AlbumCard[] {
  const out: AlbumCard[] = []
  if (f.stage !== 'egg') out.push({ id: albumId.hatch, at: 0, kind: 'hatch', art: artOf('baby', 'cheer', f.species), caption: hatchLine(f.petName), approx: true })
  if (f.stage === 'adult') out.push({ id: albumId.grow, at: 0, kind: 'grow', art: artOf('adult', 'cheer', f.species), caption: growLine(f.petName), approx: true })
  for (const id of f.tricks) {
    const def = trickOf(id)
    if (!def) continue
    out.push({ id: albumId.trick(id), at: 0, kind: 'trick', art: artOf(f.stage, TRICK_POSE[id] ?? 'happy', f.species), caption: trickCardLine(f.petName, def.name), approx: true })
  }
  for (const c of f.chapters) {
    out.push({ id: albumId.chapter(c.id), at: c.at ?? 0, kind: 'chapter', art: artOf(f.stage, 'cheer', f.species), caption: chapterLine(c.name), ...(c.at === undefined ? { approx: true } : {}) })
  }
  if (f.firstHat) {
    const hat = hatOf(f.firstHat.id)
    if (hat) {
      out.push({
        id: albumId.hat,
        at: f.firstHat.at ?? 0,
        kind: 'hat',
        art: artOf(f.stage, 'happy', f.species),
        caption: firstHatLine(f.petName, hat.name),
        hat: hat.id,
        ...(f.firstHat.at === undefined ? { approx: true } : {}),
      })
    }
  }
  return out
}

/**
 * 這次該新增的卡：expected 扣掉已經有的。三種模式：
 * - backfill：第一次載入、補建舊里程碑。卡不標「新」、時間不明的顯示「以前」，不會一次跳出一堆
 * - event：事情剛在眼前發生（例如餵食孵化）。時間記成現在、標成「新」
 * - sync：進首頁時發現新的里程碑（新招、通關、第一頂帽子標「新」）。孵化 / 長大不是在眼前發生的（例如家長用 PM 直接切階段），
 *   就安靜地補上，不跳提示
 */
export type MissingMode = 'backfill' | 'event' | 'sync'
export function missingCards(existing: readonly AlbumCard[], expected: readonly AlbumCard[], now: number, mode: MissingMode): AlbumCard[] {
  const have = new Set(existing.map((c) => c.id))
  return expected
    .filter((c) => !have.has(c.id))
    .map((c): AlbumCard => {
      if (mode === 'backfill') return { ...c }
      // 剛發生的事：時間不明（0）的記成現在；已知時間（例如通關時間）照用
      const { approx, ...rest } = c
      const known = !approx || c.at > 0
      const quiet = mode === 'sync' && (c.kind === 'hatch' || c.kind === 'grow')
      return { ...rest, at: known ? c.at : now, ...(quiet ? {} : { fresh: true }) }
    })
}

/** 相簿排序：新的在前；估計日期（approx）的排在最後，同類依「孵化 → 長大 → 新招 → 通關 → 帽子」 */
const KIND_ORDER: AlbumKind[] = ['hatch', 'milestone', 'grow', 'trick', 'chapter', 'hat', 'wish']
export function sortAlbum(cards: readonly AlbumCard[]): AlbumCard[] {
  return [...cards].sort((a, b) => {
    const ax = a.approx ? 1 : 0
    const bx = b.approx ? 1 : 0
    if (ax !== bx) return ax - bx
    if (!ax && a.at !== b.at) return b.at - a.at
    return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id)
  })
}

/** 卡片上的日期：「10月27日」；估計日期顯示「以前」 */
export function albumDateText(card: Pick<AlbumCard, 'at' | 'approx'>): string {
  if (card.approx || !card.at) return '以前'
  const d = new Date(card.at)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 從卡片的圖名取出物種、階段與姿勢（pet-adult-cheer → monkey / adult / cheer；pet-rabbit-baby-happy → rabbit / baby / happy） */
export function parseCardArt(art: string): { species: Species; stage: 'baby' | 'adult'; pose: string } {
  const p = parsePetArt(art)
  if (!p || p.stage === 'egg') return { species: p?.species ?? 'monkey', stage: 'adult', pose: 'happy' }
  return { species: p.species, stage: p.stage, pose: p.pose }
}

/** 還沒給孩子看的卡（首頁依序跳出來） */
export const freshCards = (cards: readonly AlbumCard[] | undefined): AlbumCard[] => (cards ?? []).filter((c) => c.fresh).sort((a, b) => a.at - b.at)

export type { TrickId }
