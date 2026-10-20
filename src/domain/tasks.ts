import type { TaskInstance, TaskStatus, TaskTemplate } from './types'

export type TaskAction = 'submit' | 'approve' | 'reject'

const TRANSITIONS: Record<TaskAction, Partial<Record<TaskStatus, TaskStatus>>> = {
  submit: { todo: 'pending', rejected: 'pending' },
  approve: { pending: 'approved' },
  reject: { pending: 'rejected' },
}

/** 非法轉移回 null */
export function transition(status: TaskStatus, action: TaskAction): TaskStatus | null {
  return TRANSITIONS[action][status] ?? null
}

export const dailyInstanceId = (templateId: string, date: string) => `${templateId}:${date}`
export const onceInstanceId = (templateId: string) => `${templateId}:once`

/**
 * 依 active 模板產生今天需要新增的任務實例（idempotent：已存在的不重複產生）。
 * - repeatDaily：每個日期一筆
 * - 非每日：整個生命週期只產生一次（即使已完成也不再產生）
 */
export function instancesToCreate(
  templates: readonly TaskTemplate[],
  existing: readonly TaskInstance[],
  date: string,
  now: number,
): TaskInstance[] {
  const ids = new Set(existing.map((i) => i.id))
  const onceDone = new Set(existing.map((i) => i.templateId))
  const out: TaskInstance[] = []
  for (const t of templates) {
    if (!t.active) continue
    if (t.repeatDaily) {
      const id = dailyInstanceId(t.id, date)
      if (!ids.has(id)) out.push({ id, templateId: t.id, date, status: 'todo', updatedAt: now })
    } else if (!onceDone.has(t.id)) {
      const id = onceInstanceId(t.id)
      if (!ids.has(id)) out.push({ id, templateId: t.id, date, status: 'todo', updatedAt: now })
    }
  }
  return out
}

/** 小孩「今日任務」要顯示哪些實例 */
export function visibleToday(
  templates: readonly TaskTemplate[],
  instances: readonly TaskInstance[],
  date: string,
): TaskInstance[] {
  const byId = new Map(templates.map((t) => [t.id, t]))
  return instances
    .filter((i) => {
      const t = byId.get(i.templateId)
      if (!t) return false
      const carryOver = !t.repeatDaily && i.status !== 'approved'
      if (i.date !== date && !carryOver) return false
      // 已停用的模板：未送出的不再顯示
      if (!t.active && (i.status === 'todo' || i.status === 'rejected')) return false
      return true
    })
    .sort((a, b) => (byId.get(a.templateId)!.order - byId.get(b.templateId)!.order))
}

export function clampTaskPoints(p: number, min: number, max: number): number {
  const n = Math.round(Number.isFinite(p) ? p : min)
  return Math.min(max, Math.max(min, n))
}
