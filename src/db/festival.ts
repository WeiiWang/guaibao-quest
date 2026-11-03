// v8.1 線 Q：節慶的資料操作。狀態存在 settings.festival（optional，不升 Dexie 版本），每個孩子各自一份。
import { albumId } from '../domain/album'
import { FESTIVAL_BY_ID, festivalKey, type FestivalNow } from '../domain/season'
import { petArt } from '../domain/species'
import type { AlbumCard } from '../domain/types'
import * as album from './album'
import type { GuaibaoDB } from './db'

const SETTINGS_ID = 'main'
const PET_ID = 'pet'

export interface FestivalGreeting {
  /** 這是這個孩子今年第一次遇到這個節慶（寵物要說那一句） */
  first: boolean
  /** 這次送出的紀念家具（這個節慶已經送過就沒有） */
  keepsake?: string
}

/**
 * 孩子看到這一年的節慶了：記下來；這個節慶還沒送過紀念家具就送一件（進背包）並新增一張回憶卡。
 * 節慶關閉或寵物還在蛋裡不動作（蛋孵出來、節慶還在的話下次再來）。同一年重開不重送；已經有紀念家具的節慶隔年不再多送。
 */
export async function greetFestival(d: GuaibaoDB, f: FestivalNow, now: number): Promise<FestivalGreeting> {
  return d.transaction('rw', [d.settings, d.pets, d.inventory, d.shopItems], async () => {
    const [s, pet] = await Promise.all([d.settings.get(SETTINGS_ID), d.pets.get(PET_ID)])
    if (!s || !pet || pet.stage === 'egg' || s.festivalOn === false) return { first: false }
    const key = festivalKey(f)
    const seen = s.festival?.seen ?? []
    if (seen.includes(key)) return { first: false }
    const got = s.festival?.got ?? []
    const def = FESTIVAL_BY_ID[f.id]
    const give = !got.includes(f.id)
    if (give) {
      const item = def.keepsake
      await d.shopItems.put(item)
      const cur = await d.inventory.get(item.id)
      await d.inventory.put({ id: item.id, itemId: item.id, qty: (cur?.qty ?? 0) + 1 })
      const card: AlbumCard = { id: albumId.festival(f.id), at: now, kind: 'festival', art: petArt(pet.species, pet.stage === 'adult' ? 'adult' : 'baby', 'cheer'), caption: def.caption, reward: item.id, fresh: true }
      await album.addCards(d, [card])
    }
    await d.settings.update(SETTINGS_ID, { festival: { seen: [...seen, key], got: give ? [...got, f.id] : got } })
    return give ? { first: true, keepsake: def.keepsake.id } : { first: true }
  })
}
