import { QUESTIONS, questionsFor } from './bank'
import { dueReviews } from './skills'
import { STATION_SIZE } from './scoring'
import { makeRng, pickOne, shuffled, type Rng } from './rng'
import type { Attempt, Difficulty, Interaction, Question, SkillId, SkillState } from './types'
import { MATH_SKILLS } from './types'

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
  /** 幼幼模式 */
  gentle?: boolean
  /** 只抽這種互動的題（沒寫 = 不限）；沒有這種題就回傳 null */
  interaction?: Interaction
}

const interactionOf = (q: Question): Interaction => q.interaction ?? 'pick'

/**
 * 抽一題：排除 exclude；在剩下的題裡，優先「作答次數最少」的，
 * 同分時再優先「最久沒出現」的最舊一批，最後隨機。題庫用完一輪才會重複。
 * 舊紀錄裡已經不存在的題目 id 只會被當成「沒有人用到」，不影響抽題。
 */
export function pickQuestion(opts: PickOptions): Question | null {
  const pool = questionsFor(opts.skill, opts.difficulty, opts.bank ?? QUESTIONS, opts.gentle).filter(
    (q) => !opts.exclude?.has(q.id) && (!opts.interaction || interactionOf(q) === opts.interaction),
  )
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
  gentle?: boolean
  /** 站型的 5 個互動位置（見 chapter.ts）。沒給就照舊：三種技能輪替、互動隨機 */
  slots?: Interaction[]
  /** 這一站會出哪些技能（科目決定）。沒給 = 數學的三個技能；英文科目是 ['english'] */
  skills?: readonly SkillId[]
  /** 最後一題從這些技能輪流抽（新章節裡保留少量舊章節技能的複習）；沒給 = 全部照 skills 輪替 */
  tail?: readonly SkillId[]
  /** 盡量避開的題（例如每日冒險避開昨天的題面）。沒得換時才會重複 */
  exclude?: ReadonlySet<string>
  /** 最多幾題複習題（預設 1；每日冒險 2） */
  maxReviews?: number
}

/** 各互動出在哪個技能：拿給我 N 個是數感、拖曳歸類是分類、排序是比較與排序、放到位置是空間方位、翻牌是觀察與記憶 */
export const SKILL_OF_INTERACTION: Partial<Record<Interaction, SkillId>> = {
  tapN: 'number',
  dragSort: 'classify',
  dragOrder: 'measure',
  place: 'space',
  flip: 'observe',
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
  const skills = opts.skills ?? MATH_SKILLS
  const seen = seenFromAttempts(opts.attempts)
  const used = new Set<string>()
  const avoid = opts.exclude ?? new Set<string>()
  const plan: PlannedQuestion[] = []
  /** 先避開 avoid 抽；整個難度的題都被避開了才放寬 */
  const pickAvoiding = (o: Omit<PickOptions, 'exclude'>): Question | null =>
    (avoid.size ? pickQuestion({ ...o, exclude: new Set([...used, ...avoid]) }) : null) ?? pickQuestion({ ...o, exclude: used })
  const tail = opts.tail && opts.tail.length ? opts.tail : undefined
  const rotation: SkillId[] = Array.from({ length: size }, (_, i) =>
    tail && i === size - 1 ? tail[opts.stationIndex % tail.length] : skills[(opts.stationIndex + i) % skills.length],
  )
  const order = [...rotation]
  // 站型：主互動的位置指定技能（技能數量仍維持 2/2/1），該技能目前難度沒有這種題就退回點選
  const wantInteraction: (Interaction | undefined)[] = Array(size).fill(undefined)
  if (opts.slots) {
    const spare = [...rotation]
    const fixed = new Set<number>()
    opts.slots.slice(0, size).forEach((it, i) => {
      const skill = SKILL_OF_INTERACTION[it]
      if (!skill) return
      const diff = opts.states[skill].difficulty
      const has = pickQuestion({ skill, difficulty: diff, seen, rng: () => 0, bank: opts.bank, gentle: opts.gentle, interaction: it })
      const at = spare.indexOf(skill)
      if (!has || at < 0) return
      spare.splice(at, 1)
      order[i] = skill
      wantInteraction[i] = it
      fixed.add(i)
    })
    // 其餘位置用剩下的技能，維持原本的輪替順序
    let k = 0
    for (let i = 0; i < size; i++) if (!fixed.has(i)) order[i] = spare[k++]
  }

  // 先決定複習：換掉該技能最後一個位置，若該技能這站沒出題就換最後一個還沒被換的位置
  const due = dueReviews(opts.states, opts.now, tail ? [...skills, ...tail] : skills)
  const reviewSlots = new Set<number>()
  for (const d of due) {
    if (reviewSlots.size >= (opts.maxReviews ?? 1)) break
    const q = pickAvoiding({ skill: d.skill, difficulty: d.level, seen, rng: opts.rng, bank: opts.bank, gentle: opts.gentle })
    if (!q) continue
    let slot = -1
    for (let k = size - 1; k >= 0 && slot < 0; k--) if (order[k] === d.skill && !reviewSlots.has(k)) slot = k
    for (let k = size - 1; k >= 0 && slot < 0; k--) if (!reviewSlots.has(k)) slot = k
    if (slot < 0) break
    reviewSlots.add(slot)
    used.add(q.id)
    plan[slot] = { question: q, review: true, followUp: d.followUp }
  }

  for (let i = 0; i < size; i++) {
    if (reviewSlots.has(i)) continue
    const skill = order[i]
    const diff = opts.states[skill].difficulty
    // 有站型時，主互動位置抽指定互動；其他位置抽點選題（沒有就不限）
    const base = { skill, difficulty: diff, seen, rng: opts.rng, bank: opts.bank, gentle: opts.gentle }
    const q = pickAvoiding({ ...base, interaction: opts.slots ? (wantInteraction[i] ?? 'pick') : undefined }) ?? (opts.slots ? pickAvoiding(base) : null)
    if (!q) throw new Error(`題庫不足：${skill} 難度 ${diff}`)
    used.add(q.id)
    plan[i] = { question: q, review: false, followUp: false }
  }
  return plan
}

export interface AdaptOptions {
  plan: PlannedQuestion[]
  /** 從第幾題開始可以調整（前面的已經答過） */
  from: number
  states: Record<SkillId, SkillState>
  /** 全部歷史作答（含這一站已答的） */
  attempts: Attempt[]
  /** 這一站已答的非複習題，依時間先後 */
  stationAttempts: Pick<Attempt, 'skill' | 'firstTryCorrect'>[]
  rng: Rng
  bank?: Question[]
  gentle?: boolean
}

/**
 * 站中調整剩下的題（不改技能狀態）：
 * - 剛升級（或降級）後，剩下的同技能題改用新難度重抽
 * - 同技能連續 2 題第一次就答錯 → 該技能的下一題從低 1 級抽（救援）
 * 複習題不動。回傳新的 plan（沒有變化就是同一個陣列內容）。
 */
export function adaptPlan(opts: AdaptOptions): PlannedQuestion[] {
  const plan = [...opts.plan]
  const seen = seenFromAttempts(opts.attempts)
  const rescued = new Set<SkillId>()
  for (const skill of new Set(plan.map((p) => p.question.skill))) {
    const mine = opts.stationAttempts.filter((a) => a.skill === skill)
    const lastTwo = mine.slice(-2)
    if (lastTwo.length === 2 && lastTwo.every((a) => !a.firstTryCorrect)) rescued.add(skill)
  }
  const handled = new Set<SkillId>()
  for (let i = opts.from; i < plan.length; i++) {
    const p = plan[i]
    if (p.review) continue
    const skill = p.question.skill
    let target = opts.states[skill].difficulty
    // 救援只用在這個技能的「下一題」
    if (rescued.has(skill) && !handled.has(skill)) target = Math.max(1, target - 1) as Difficulty
    handled.add(skill)
    if (p.question.difficulty === target) continue
    const used = new Set(plan.map((x) => x.question.id))
    used.delete(p.question.id)
    // 換題時保持同一種互動（拿給我 N 個還是拿給我、點選還是點選）；沒有就不限
    const base = { skill, difficulty: target as Difficulty, seen, rng: opts.rng, exclude: used, bank: opts.bank, gentle: opts.gentle }
    const q = pickQuestion({ ...base, interaction: interactionOf(p.question) }) ?? pickQuestion(base)
    if (q) plan[i] = { question: q, review: false, followUp: false }
  }
  return plan
}

/** 字串 → 亂數種子（同一個字串永遠得到同一個種子） */
export function seedOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 選項一個都不能少的題型：找不一樣（只剩兩張就分不出誰不一樣）。其他選擇題可以縮成 2 選 1 */
const KEEP_CHOICES = new Set(['spot'])

const isNumericChoices = (q: Question) => q.choices.length > 0 && q.choices.every((c) => c.label !== undefined && /^\d+$/.test(c.label))

/**
 * 實際給孩子看的題目：
 * - 幼幼模式：選項縮成 2 個（答案 + 一個干擾；數字題取最接近的）
 * - 選項順序用 seed 洗牌（同一個 seed 永遠同一個順序，離開再回來不會變）；
 *   數字選項維持由小到大（答案位置由題庫端保證平均）
 */
export function displayQuestion(q: Question, seed: string, gentle = false): Question {
  if (q.interaction && q.interaction !== 'pick') return q
  const rng = makeRng(seedOf(`${seed}:${q.id}`))
  let choices = q.choices
  if (gentle && choices.length > 2 && !KEEP_CHOICES.has(q.type)) {
    const others = choices.filter((c) => c.id !== q.answer)
    let keep = others[Math.floor(rng() * others.length)]
    if (isNumericChoices(q)) {
      const a = Number(q.answer)
      keep = [...others].sort((x, y) => Math.abs(Number(x.label) - a) - Math.abs(Number(y.label) - a))[0]
    }
    choices = choices.filter((c) => c.id === q.answer || c.id === keep.id)
  }
  if (isNumericChoices(q)) {
    return choices === q.choices ? q : { ...q, choices }
  }
  return { ...q, choices: shuffled(choices, rng) }
}
