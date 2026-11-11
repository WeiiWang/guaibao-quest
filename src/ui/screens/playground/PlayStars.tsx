import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import type { PlayGameId } from '../../../domain/playground'
import { countsPlays, isCrowned, playStars } from '../../../domain/playToys'
import { Icon } from '../../components/Icon'

/** v8.5 每個遊戲玩完幾次（即時）；還沒讀到時當成都沒玩過 */
export function usePlayCounts(): Record<string, number> {
  return useLiveQuery(async () => (await db.settings.get('main'))?.playCount ?? {}, [], {})
}

/** 格子上的 3 顆星（兩個新玩具各一顆，戴皇冠第三顆）與皇冠。學我說話不算次數，不畫 */
export function PlayStars({ id, plays }: { id: PlayGameId; plays: number | undefined }) {
  if (!countsPlays(id)) return null
  const n = playStars(plays)
  return (
    <>
      <span className="pg-stars" data-stars={n} data-testid={`stars-${id}`} aria-label={`${n} 顆星`}>
        {[0, 1, 2].map((i) => (
          <i key={i} data-on={i < n ? 1 : 0} />
        ))}
      </span>
      {isCrowned(plays) && <Icon name="ui-crown" emoji="👑" className="pg-crown" size={44} alt="" />}
    </>
  )
}
