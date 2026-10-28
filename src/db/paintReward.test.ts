import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from './db'
import { Repo } from './repo'
import { emptyDoc, type PaintDoc } from '../domain/coloring'
import { DAILY_POINT_CAP } from '../domain/constants'
import { balanceOf } from '../domain/points'
import { PAINT_REWARD_REASON, PAINT_STARS } from '../domain/paintReward'

const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime()
const DAY = 24 * 3600 * 1000
let n = 0
let repo: Repo
const png = 'data:image/png;base64,AAAA'
const doc = (color: string): PaintDoc => ({ ...emptyDoc(), fills: { body: color } })
const paintLedger = async () => (await repo.db.ledger.toArray()).filter((l) => l.reason === PAINT_REWARD_REASON)

beforeEach(async () => {
  repo = new Repo(new GuaibaoDB(`paint-reward-${n++}`), () => T0)
  await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
})

describe('v7.3 F3：第一次算數的完成給 5 顆星星（寫進點數流水帳）', () => {
  it('第一次算數的完成：+5，理由「完成作品」，kind bonus，餘額增加', async () => {
    const before = await repo.balance()
    const r = await repo.completeColoring('monkey', doc('#ff0000'), png, T0, { counts: true })
    expect(r.ok && r.stars).toBe(PAINT_STARS)
    expect(r.ok && r.starsCapped).toBe(false)
    expect(await repo.balance()).toBe(before + PAINT_STARS)
    const rows = await paintLedger()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ delta: 5, kind: 'bonus', refId: 'art:monkey' })
  })
  it('同一張不重複給：改了內容再完成一次也不再給', async () => {
    await repo.completeColoring('monkey', doc('#ff0000'), png, T0, { counts: true })
    const r2 = await repo.completeColoring('monkey', doc('#00ff00'), png, T0 + 1000, { counts: true })
    expect(r2.ok && r2.counted).toBe(true) // 還是累計一幅（畫框收藏）
    expect(r2.ok && r2.stars).toBe(0)
    expect(await paintLedger()).toHaveLength(1)
  })
  it('不算數的完成（畫得太少、counts 為 false）不給星星；之後算數時才給', async () => {
    const r1 = await repo.completeColoring('monkey', doc('#ff0000'), png, T0, { counts: false })
    expect(r1.ok && r1.stars).toBe(0)
    expect(await paintLedger()).toHaveLength(0)
    const r2 = await repo.completeColoring('monkey', doc('#00ff00'), png, T0 + 1000, { counts: true })
    expect(r2.ok && r2.stars).toBe(5)
  })
  it('完全一樣的作品重複按完成：不累計、不給', async () => {
    await repo.completeColoring('monkey', doc('#ff0000'), png, T0, { counts: true })
    const r = await repo.completeColoring('monkey', doc('#ff0000'), png, T0 + 1000, { counts: true })
    expect(r.ok && r.counted).toBe(false)
    expect(r.ok && r.stars).toBe(0)
    expect(await paintLedger()).toHaveLength(1)
  })
  it('每張頁各給一次（不同頁各 +5）', async () => {
    await repo.completeColoring('monkey', doc('#ff0000'), png, T0, { counts: true })
    await repo.completeColoring('house', doc('#ff0000'), png, T0 + 1000, { counts: true })
    expect((await paintLedger()).map((l) => l.refId).sort()).toEqual(['art:house', 'art:monkey'])
  })
  it('受每日上限約束：上限只剩 3 點就只給 3；滿了就不給（starsCapped）', async () => {
    await repo.grantBonus(DAILY_POINT_CAP - 3, '家長加點', T0)
    const r = await repo.completeColoring('monkey', doc('#ff0000'), png, T0 + 1000, { counts: true })
    expect(r.ok && r.stars).toBe(3)
    expect(r.ok && r.starsCapped).toBe(true)
    const r2 = await repo.completeColoring('house', doc('#ff0000'), png, T0 + 2000, { counts: true })
    expect(r2.ok && r2.stars).toBe(0)
    expect(r2.ok && r2.starsCapped).toBe(true)
    expect(await paintLedger()).toHaveLength(1)
    // 隔天上限重置，這張還沒領到，再完成（內容有變）就補上
    const r3 = await repo.completeColoring('house', doc('#0000ff'), png, T0 + DAY, { counts: true })
    expect(r3.ok && r3.stars).toBe(5)
  })
  it('空白畫紙：有內容就算；同一個欄位每天一次（再畫一張新的不能刷星星），隔天又可以', async () => {
    const strokeDoc: PaintDoc = { ...emptyDoc(), strokes: [{ id: 's1', color: '#ff0000', width: 10, points: [[10, 10], [50, 50]] }] }
    const a = await repo.completeColoring('free-1', strokeDoc, png, T0, { counts: true })
    expect(a.ok && a.stars).toBe(5)
    const strokeDoc2: PaintDoc = { ...emptyDoc(), strokes: [{ id: 's2', color: '#00ff00', width: 10, points: [[20, 20], [90, 90]] }] }
    const b = await repo.completeColoring('free-1', strokeDoc2, png, T0 + 1000, { counts: true })
    expect(b.ok && b.stars).toBe(0)
    const c = await repo.completeColoring('free-2', strokeDoc2, png, T0 + 2000, { counts: true })
    expect(c.ok && c.stars).toBe(5)
    const strokeDoc3: PaintDoc = { ...emptyDoc(), strokes: [{ id: 's3', color: '#0000ff', width: 10, points: [[30, 30], [120, 120]] }] }
    const d = await repo.completeColoring('free-1', strokeDoc3, png, T0 + DAY, { counts: true })
    expect(d.ok && d.stars).toBe(5)
  })
  it('連連看拿去塗色的頁、直接完成也算（一張一次）', async () => {
    const P = 'dots:obj-fish:h'
    const a = await repo.completeColoring(P, { ...emptyDoc(), fills: { shape: '#ff0000' } }, png, T0, { counts: true })
    expect(a.ok && a.stars).toBe(5)
    const b = await repo.completeColoring(P, { ...emptyDoc(), fills: { shape: '#00ff00' } }, png, T0 + 1000, { counts: true })
    expect(b.ok && b.stars).toBe(0)
    expect(balanceOf(await repo.db.ledger.toArray())).toBeGreaterThanOrEqual(5)
  })
})
