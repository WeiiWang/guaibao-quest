import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { localDateStr } from '../../domain/date'
import { visibleToday } from '../../domain/tasks'
import { ScreenHeader } from '../components/Header'
import { Icon } from '../components/Icon'
import { useToast } from '../hooks'

export function TasksScreen({ onBack, now }: { onBack: () => void; now: number }) {
  const toast = useToast()
  const data = useLiveQuery(async () => {
    const [templates, instances] = await Promise.all([db.templates.toArray(), db.instances.toArray()])
    const byId = new Map(templates.map((t) => [t.id, t]))
    return visibleToday(templates, instances, localDateStr(now)).map((i) => ({ inst: i, tpl: byId.get(i.templateId)! }))
  }, [now])

  const submit = async (id: string) => {
    const r = await repo.submitTask(id)
    if (r.ok) toast('好棒！等爸媽確認囉', 'ok')
    else toast(r.error, 'warn')
  }

  return (
    <main className="screen theme-sky">
      <ScreenHeader title="今日任務" onBack={onBack} />
      <ul className="task-list">
        {data?.map(({ inst, tpl }) => (
          <li key={inst.id} className={`card task ${inst.status}`}>
            <span className="task-emoji" aria-hidden>{tpl.emoji}</span>
            <div className="task-main">
              <div className="task-title">{tpl.title}</div>
              <div className="task-points"><Icon name="ui-star" emoji="⭐" size={18} /> +{tpl.points} 點</div>
              {inst.status === 'rejected' && <div className="task-note">爸媽請你再做一次喔</div>}
            </div>
            {(inst.status === 'todo' || inst.status === 'rejected') && (
              <button className="btn primary" onClick={() => submit(inst.id)}>
                {inst.status === 'rejected' ? '再試一次' : '我做完了'}
              </button>
            )}
            {inst.status === 'pending' && <span className="status-pill wait">等爸媽確認</span>}
            {inst.status === 'approved' && <span className="status-pill done">完成 ✓</span>}
          </li>
        ))}
        {data && data.length === 0 && <li className="empty">今天沒有任務，好好玩吧！</li>}
      </ul>
    </main>
  )
}
