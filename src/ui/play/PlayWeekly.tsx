import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { guestWeekText, wishWeekText } from '../../domain/play74'
import { weekDays } from '../../domain/weekly'
import { useNow } from '../hooks'
import './play74.css'

/** 家長區「本週」的一小塊（v7.4 K）：這週哪些朋友來作客、留下什麼新玩意、阿悟實現了哪些小願望。用白話寫，只有兩行字 */
export function PlayWeekly() {
  const now = useNow()
  const s = useLiveQuery(() => db.settings.get('main'), [])
  if (!s) return null
  const days = weekDays(now)
  const startMs = Date.parse(`${days[0]}T00:00:00`)
  const play = s.play
  return (
    <div className="card k74-weekly" data-testid="weekly-play">
      <h2>朋友來作客與阿悟的小願望</h2>
      <p className="lt-text" data-testid="weekly-guests">{guestWeekText(play?.guestLog ?? [], days)}</p>
      <p className="lt-text" data-testid="weekly-wishes">{wishWeekText(play?.wishLog ?? [], startMs, play?.wishActive)}</p>
    </div>
  )
}
