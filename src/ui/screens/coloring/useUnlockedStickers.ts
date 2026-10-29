import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { newStickerIds, stickerForSpecies, unlockedStickers, type StickerDef } from '../../../domain/stickers'
import { artForSpecies } from '../../../domain/species'
import { useSpecies } from '../../species'

/**
 * v7.4 I4：已解鎖的貼紙（預設 8 張 + settings.stickers + 舊作品用過的）與標「新」的貼紙。
 * 舊作品用過的貼紙只在畫面打開時掃一次（作品裡的貼紙資料不大，但不要每存一筆就重掃整張表）。
 * extraUsed：目前這張作品上已經有的貼紙（也算已解鎖）。
 * 給背包的「貼紙」分頁用也可以：const { unlocked } = useUnlockedStickers()。
 */
export function useUnlockedStickers(extraUsed: readonly string[] = []): { unlocked: StickerDef[]; fresh: string[] } {
  const settings = useLiveQuery(async () => (await db.settings.get('main')) ?? null, [], null)
  const [usedOld, setUsedOld] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    void (async () => {
      const arts = new Set<string>()
      await db.coloring.each((r) => {
        for (const st of r.stickers ?? []) arts.add(st.art)
      })
      if (alive) setUsedOld([...arts])
    })()
    return () => {
      alive = false
    }
  }, [])
  const key = extraUsed.join('|')
  const used = useMemo(() => [...usedOld, ...extraUsed], // eslint-disable-next-line react-hooks/exhaustive-deps
    [usedOld, key])
  // v7.5：寵物貼紙換成目前孩子的物種（兔兔的孩子看到、貼上的都是兔兔；解鎖狀態仍用目錄的猴子圖名記）
  const species = useSpecies()
  const unlocked = useMemo(() => unlockedStickers(settings?.stickers, used).map((s) => stickerForSpecies(s, species)), [settings?.stickers, used, species])
  const fresh = useMemo(() => newStickerIds(settings?.stickers, settings?.stickersSeen, used).map((a) => artForSpecies(a, species)), [settings?.stickers, settings?.stickersSeen, used, species])
  return { unlocked, fresh }
}
