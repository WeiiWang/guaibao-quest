import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { TASK_POINTS_MAX, TASK_POINTS_MIN } from '../../../domain/constants'
import type { TaskTemplate } from '../../../domain/types'
import { Modal } from '../../components/Modal'
import { useToast } from '../../hooks'

const BLANK: Pick<TaskTemplate, 'title' | 'emoji' | 'points' | 'repeatDaily' | 'active'> = {
  title: '',
  emoji: '⭐',
  points: 10,
  repeatDaily: true,
  active: true,
}

export function TemplatesTab() {
  const toast = useToast()
  const templates = useLiveQuery(() => db.templates.orderBy('order').toArray(), [], [])
  const [editing, setEditing] = useState<(Partial<TaskTemplate> & typeof BLANK) | null>(null)

  const save = async () => {
    if (!editing) return
    const r = await repo.saveTemplate(editing)
    if (!r.ok) return toast(r.error, 'warn')
    toast('已儲存', 'ok')
    setEditing(null)
  }

  const pointsOptions: number[] = []
  for (let p = TASK_POINTS_MIN; p <= TASK_POINTS_MAX; p += 5) pointsOptions.push(p)

  return (
    <section>
      <button className="btn primary wide" onClick={() => setEditing({ ...BLANK })}>＋ 新增任務</button>
      <ul className="task-list">
        {templates.map((t) => (
          <li key={t.id} className={`card task ${t.active ? '' : 'inactive'}`}>
            <span className="task-emoji" aria-hidden>{t.emoji}</span>
            <div className="task-main">
              <div className="task-title">{t.title}</div>
              <div className="task-points">+{t.points} 點 · {t.repeatDaily ? '每天' : '一次性'}{t.active ? '' : ' （已停用）'}</div>
            </div>
            <div className="row-actions">
              <button className="btn" onClick={() => setEditing({ ...t })}>編輯</button>
              <button className="btn" onClick={() => repo.saveTemplate({ id: t.id, title: t.title, active: !t.active })}>
                {t.active ? '停用' : '啟用'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <Modal title={editing.id ? '編輯任務' : '新增任務'} onClose={() => setEditing(null)}>
          <label className="field">
            名稱
            <input className="input" value={editing.title} maxLength={20} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </label>
          <label className="field">
            圖示（emoji）
            <input className="input" value={editing.emoji} maxLength={4} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} />
          </label>
          <label className="field">
            點數（{TASK_POINTS_MIN}–{TASK_POINTS_MAX}）
            <select className="input" value={editing.points} onChange={(e) => setEditing({ ...editing, points: Number(e.target.value) })}>
              {pointsOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={editing.repeatDaily} onChange={(e) => setEditing({ ...editing, repeatDaily: e.target.checked })} />
            每天重複
          </label>
          <label className="check">
            <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
            啟用
          </label>
          <div className="row-actions">
            <button className="btn" onClick={() => setEditing(null)}>取消</button>
            <button className="btn primary" onClick={save} disabled={!editing.title.trim()}>儲存</button>
          </div>
        </Modal>
      )}
    </section>
  )
}
