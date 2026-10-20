import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { DAILY_POINT_CAP } from '../../../domain/constants'
import { localDateStr } from '../../../domain/date'
import { earnedOn } from '../../../domain/points'
import { now } from '../../../domain/clock'
import { useToast } from '../../hooks'

export function QuotaLine() {
  const earned = useLiveQuery(async () => earnedOn(await db.ledger.toArray(), localDateStr(now())), [], 0)
  const full = earned >= DAILY_POINT_CAP
  return (
    <p className={`quota ${full ? 'full' : ''}`}>
      今日已發放 {Math.min(earned, DAILY_POINT_CAP)} / {DAILY_POINT_CAP} 點{full ? '（今日已達上限）' : ''}
    </p>
  )
}

export function ReviewTab() {
  const toast = useToast()
  const pending = useLiveQuery(async () => {
    const [insts, tpls] = await Promise.all([
      db.instances.where('status').equals('pending').sortBy('updatedAt'),
      db.templates.toArray(),
    ])
    return insts.map((inst) => ({ inst, tpl: tpls.find((t) => t.id === inst.templateId) }))
  }, [], [])

  const act = async (id: string, action: 'approve' | 'reject') => {
    const r = await repo.reviewTask(id, action)
    if (!r.ok) return toast(r.error, 'warn')
    if (action === 'reject') toast('已退回，小孩可以再申請', 'info')
    else if (r.capped && r.awarded === 0) toast('今日已達上限，這次沒有發放點數', 'warn')
    else if (r.capped) toast(`已通過，受每日上限影響只發放 ${r.awarded} 點`, 'warn')
    else toast(`已通過，+${r.awarded} 點`, 'ok')
  }

  const all = async () => {
    const r = await repo.approveAll()
    toast(r.capped ? `全部通過，共發放 ${r.awarded} 點（今日已達上限）` : `全部通過，共發放 ${r.awarded} 點`, r.capped ? 'warn' : 'ok')
  }

  return (
    <section>
      <QuotaLine />
      {pending.length === 0 && <p className="empty">目前沒有待審核的任務</p>}
      <ul className="task-list">
        {pending.map(({ inst, tpl }) => (
          <li key={inst.id} className="card task">
            <span className="task-emoji" aria-hidden>{tpl?.emoji}</span>
            <div className="task-main">
              <div className="task-title">{tpl?.title}</div>
              <div className="task-points">+{tpl?.points} 點 · {inst.date}</div>
            </div>
            <div className="row-actions">
              <button className="btn" onClick={() => act(inst.id, 'reject')}>退回</button>
              <button className="btn primary" onClick={() => act(inst.id, 'approve')}>通過</button>
            </div>
          </li>
        ))}
      </ul>
      {pending.length > 1 && <button className="btn primary wide" onClick={all}>全部通過（{pending.length}）</button>}
    </section>
  )
}
