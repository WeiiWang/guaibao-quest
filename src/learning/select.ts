import { QUESTIONS, questionsFor } from './bank'
import { dueReviews } from './skills'
import { STATION_SIZE } from './scoring'
import { pickOne, type Rng } from './rng'
import type { Attempt, Difficulty, Question, SkillId, SkillState } from './types'
import { SKILLS } from './types'

/** 每題被作答過幾次、最近一次的時間（用來讓重玩時優先抽沒看過的題面） */
export interface SeenInfo {
  count: Map<string, number>
  last: Map<string, number>
}

export function seenFromAttempts(attempts: Pick<Attempt, 'questionId' | 'at'>[]): SeenInfo {
  const count = new Map<string, number>()
  const last = new Map<string, number>()
  for (const a of attempts) {
    count.set(a.questionId, (count.get(a.questionId) ?? 0) + 1)
    last.set(a.questionId, Math.max(last.get(a.questionId) ?? 0, a.at))
  }
  return { count, last }
}

export interface PickOptions {
  skill: SkillId
  difficulty: Difficulty
  seen: SeenInfo
  rng: Rng
  /** 這一輪已經出過、不可再出的題 */
  exclude?: ReadonlySet<string>
  bank?: Question[]
}

/**
 * 抽一題：排除 exclude；在剩下的題裡，優先「作答次數最少」的，
 * 同分時再優先「最久沒出現」的最舊一批，最後隨機。題庫用完一輪才會重複。
 */
export function pickQuestion(opts: PickOptions): Question | null {
  const pool = questionsFor(opts.skill, opts.difficulty, opts.bank ?? QUESTIONS).filter((q) => !opts.exclude?.has(q.id))
  if (pool.length === 0) return null
  const cnt = (q: Question) => opts.seen.count.get(q.id) ?? 0
  const fewest = Math.min(...pool.map(cnt))
  const least = pool.filter((q) => cnt(q) === fewest)
  const oldest = Math.min(...least.map((q) => opts.seen.last.get(q.id) ?? 0))
  return pickOne(
    least.filter((q) => (opts.seen.last.get(q.id) ?? 0) === oldest),
    opts.rng,
  )
}

export interface PlannedQuestion {
  question: Question
  review: boolean
  followUp: boolean
}

export interface PlanOptions {
  /** 第幾站（0 起算），決定三種技能怎麼輪替 */
  stationIndex: number
  states: Record<SkillId, SkillState>
  attempts: Attempt[]
  now: number
  rng: Rng
  size?: number
  bank?: Question[]
}

/**
 * 規劃一站的題目：
 * - 混合三種技能（輪替起點隨站別移動，每站 2/2/1 題）
 * - 每個技能用自己目前的難度
 * - 若有到期的複習：換掉一題成為複習題（同一站最多 1 題，題面與先前不同）
 * - 同一站不重複題目
 */
export function planStation(opts: PlanOptions): PlannedQuestion[] {
  const size = opts.size ?? STATION_SIZE
  const seen = seenFromAttempts(opts.attempts)
  const used = new Set<string>()
  const plan: PlannedQuestion[] = []
  const order: SkillId[] = Array.from({ length: size }, (_, i) => SKILLS[(opts.stationIndex + i) % SKILLS.length])

  // 先決定複習：換掉該技能最後一個位置，若該技能這站沒出題就換最後一題
  const due = dueReviews(opts.states, opts.now)
  let reviewSlot = -1
  for (const d of due) {
    const q = pickQuestion({ skill: d.skill, difficulty: d.level, seen, rng: opts.rng, bank: opts.bank })
    if (!q) continue
    const slot = order.lastIndexOf(d.skill)
    reviewSlot = slot >= 0 ? slot : size - 1
    used.add(q.id)
    plan[reviewSlot] = { question: q, review: true, followUp: d.followUp }
    break
  }

  for (let i = 0; i < size; i++) {
    if (i === reviewSlot) continue
    const skill = order[i]
    const q = pickQuestion({
      skill,
      difficulty: opts.states[skill].difficulty,
      seen,
      rng: opts.rng,
      exclude: used,
      bank: opts.bank,
    })
    if (!q) throw new Error(`題庫不足：${skill} 難度 ${opts.states[skill].difficulty}`)
    used.add(q.id)
    plan[i] = { question: q, review: false, followUp: false }
  }
  return plan
}
