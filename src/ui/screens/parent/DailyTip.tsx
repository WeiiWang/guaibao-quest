import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { localDateStr } from '../../../domain/date'
import { pickDailyTip } from '../../../domain/parentTips'
import { recentSkills } from '../../../domain/weekly'
import { useNow } from '../../hooks'
import './weekly.css'

/** 家長區最上方的「今日小提示」：依孩子最近練的技能挑一句，把當天練的概念帶回生活 */
export function DailyTip() {
  const now = useNow()
  const attempts = useLiveQuery(() => db.attempts.toArray(), [])
  if (!attempts) return null
  const tip = pickDailyTip(recentSkills(attempts, now), localDateStr(now))
  return (
    <p className="wk-daily" data-testid="daily-tip" data-tip-for={tip.skill ?? 'generic'}>
      <b>今日小提示</b>
      <span data-testid="daily-tip-text">{tip.text}</span>
    </p>
  )
}
