import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import './learning.css'

/** 建議每天 1–2 項生活任務。超過時溫和提醒（不禁止）。顯示在「任務管理」分頁上方。 */
export const SUGGESTED_DAILY_TASKS = 2

export function TaskLimitNote() {
  const daily = useLiveQuery(async () => (await db.templates.toArray()).filter((t) => t.active && t.repeatDaily).length, [])
  if (daily === undefined) return null
  const over = daily > SUGGESTED_DAILY_TASKS
  return (
    <div className={`lt-tip ${over ? 'warn' : ''}`} role="note" data-testid="task-limit-note">
      建議每天 1–2 項生活任務，孩子比較容易做到、也不會有壓力。
      {over && (
        <>
          {' '}
          目前每天有 <b>{daily}</b> 項，可以考慮把不急的先停用（這只是提醒，不會限制你）。
        </>
      )}
    </div>
  )
}
