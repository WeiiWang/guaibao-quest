import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import type { LedgerKind } from '../../../domain/types'

const KIND: Record<LedgerKind, string> = { task: '任務', bonus: '加點', penalty: '扣點', purchase: '購買' }

export function LedgerTab() {
  const rows = useLiveQuery(() => db.ledger.orderBy('at').reverse().toArray(), [], [])
  return (
    <section>
      {rows.length === 0 && <p className="empty">還沒有任何點數紀錄</p>}
      <ul className="ledger">
        {rows.map((r) => (
          <li key={r.id} className="card ledger-row">
            <span className={`kind k-${r.kind}`}>{KIND[r.kind]}</span>
            <div className="ledger-main">
              <div>{r.reason}</div>
              <time>{new Date(r.at).toLocaleString('zh-TW', { hour12: false })}</time>
            </div>
            <b className={r.delta >= 0 ? 'plus' : 'minus'}>{r.delta >= 0 ? '+' : ''}{r.delta}</b>
          </li>
        ))}
      </ul>
    </section>
  )
}
