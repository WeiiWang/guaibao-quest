import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { finaleSeen } from '../../learning/story'
import { Art } from './Art'
import './wishStar.css'

/** v8.1 線 P：看完終章之後，夜晚的窗外多一顆會眨眼的星星（小星）。沒看過就什麼都不畫 */
export function WishStar() {
  const on = useLiveQuery(async () => finaleSeen((await db.settings.get('main'))?.storySeen), [])
  if (!on) return null
  return (
    <i className="rb-wish" data-testid="window-star">
      <Art name="ui-xiaoxing" alt="" className="rb-wish-img" />
    </i>
  )
}
