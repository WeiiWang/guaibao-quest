import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATES } from './constants'
import { instancesToCreate, transition, visibleToday } from './tasks'
import type { TaskInstance, TaskTemplate } from './types'

const NOW = 1_000_000

describe('任務狀態轉移', () => {
  it('合法轉移', () => {
    expect(transition('todo', 'submit')).toBe('pending')
    expect(transition('rejected', 'submit')).toBe('pending')
    expect(transition('pending', 'approve')).toBe('approved')
    expect(transition('pending', 'reject')).toBe('rejected')
  })
  it('非法轉移回 null', () => {
    expect(transition('todo', 'approve')).toBeNull()
    expect(transition('todo', 'reject')).toBeNull()
    expect(transition('approved', 'submit')).toBeNull()
    expect(transition('approved', 'reject')).toBeNull()
    expect(transition('pending', 'submit')).toBeNull()
    expect(transition('rejected', 'approve')).toBeNull()
  })
})

describe('每日任務產生', () => {
  it('依 active+repeatDaily 產生，重跑不重複 (idempotent)', () => {
    const first = instancesToCreate(DEFAULT_TEMPLATES, [], '2026-06-10', NOW)
    expect(first).toHaveLength(5)
    expect(instancesToCreate(DEFAULT_TEMPLATES, first, '2026-06-10', NOW)).toHaveLength(0)
  })
  it('跨日產生新的一批', () => {
    const d1 = instancesToCreate(DEFAULT_TEMPLATES, [], '2026-06-10', NOW)
    const d2 = instancesToCreate(DEFAULT_TEMPLATES, d1, '2026-06-11', NOW)
    expect(d2).toHaveLength(5)
    expect(new Set([...d1, ...d2].map((i) => i.id)).size).toBe(10)
  })
  it('停用的模板不產生', () => {
    const tpls = DEFAULT_TEMPLATES.map((t, i) => (i === 0 ? { ...t, active: false } : t))
    expect(instancesToCreate(tpls, [], '2026-06-10', NOW)).toHaveLength(4)
  })
  it('非每日模板只產生一次，完成後也不再出現', () => {
    const once: TaskTemplate = { id: 'o', title: '洗澡', emoji: '🛁', points: 10, repeatDaily: false, active: true, order: 9 }
    const a = instancesToCreate([once], [], '2026-06-10', NOW)
    expect(a).toHaveLength(1)
    const done: TaskInstance[] = [{ ...a[0], status: 'approved' }]
    expect(instancesToCreate([once], done, '2026-06-11', NOW)).toHaveLength(0)
    expect(instancesToCreate([once], a, '2026-06-11', NOW)).toHaveLength(0)
  })
})

describe('今日任務顯示', () => {
  const once: TaskTemplate = { id: 'o', title: 'x', emoji: 'x', points: 10, repeatDaily: false, active: true, order: 0 }
  const daily = DEFAULT_TEMPLATES[0]
  const inst = (id: string, templateId: string, date: string, status: TaskInstance['status']): TaskInstance => ({
    id, templateId, date, status, updatedAt: 0,
  })
  it('昨天的每日任務不顯示、未完成的一次性任務延續顯示', () => {
    const list = visibleToday(
      [once, daily],
      [inst('a', daily.id, '2026-06-09', 'todo'), inst('b', once.id, '2026-06-09', 'todo'), inst('c', daily.id, '2026-06-10', 'todo')],
      '2026-06-10',
    )
    expect(list.map((i) => i.id)).toEqual(['b', 'c'])
  })
  it('已完成的一次性任務隔天不顯示', () => {
    expect(visibleToday([once], [inst('b', once.id, '2026-06-09', 'approved')], '2026-06-10')).toHaveLength(0)
  })
})
