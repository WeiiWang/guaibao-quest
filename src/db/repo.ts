import { db as defaultDb, type GuaibaoDB } from './db'
import {
  DAILY_POINT_CAP,
  DEFAULT_PET_NAME,
  DEFAULT_TEMPLATES,
  FOOD_EFFECTS,
  SHOP_ITEMS,
  START_HUNGER,
  TASK_POINTS_MAX,
  TASK_POINTS_MIN,
} from '../domain/constants'
import { dayRange, localDateStr } from '../domain/date'
import { feed } from '../domain/pet'
import { checkPin, hashPin, isValidPin } from '../domain/pin'
import { balanceOf, checkPenalty, grantPoints } from '../domain/points'
import { canBuy } from '../domain/shop'
import { clampTaskPoints, instancesToCreate, transition } from '../domain/tasks'
import type {
  Pet,
  PointLedger,
  Settings,
  Stage,
  TaskTemplate,
} from '../domain/types'
import { now as clockNow } from '../domain/clock'
import { spriteSize } from '../art/items'
import { clampPlacement, nextFrontZ, ROOM_CELLS_H } from '../domain/room'
import { getQuestion } from '../learning/bank'
import { getChapter } from '../learning/chapter'
import { addMaterial, emptyCost, stationRewardQty, STATION_SIZE } from '../learning/scoring'
import { SHOP_CATALOG, balanceOfMaterials, canCraft, type MaterialBalance } from '../learning/materials'
import { DAILY_LIMIT_OPTIONS, EXTEND_MINUTES, learningSettingsOf, type LearningSettings } from '../learning/playtime'
import { makeRng, type Rng } from '../learning/rng'
import { planStation, type PlannedQuestion } from '../learning/select'
import { applyAttempt, applyStationResult, initialSkillState } from '../learning/skills'
import { MATERIAL_IDS, MATERIAL_NAMES, SKILLS } from '../learning/types'
import type {
  Attempt,
  MaterialCost,
  MaterialId,
  PlayTime,
  Progress,
  SkillId,
  SkillState,
  StationState,
} from '../learning/types'

let idSeq = 0
/** 不依賴 crypto.randomUUID（非 https 區網下不可用） */
export function newId(): string {
  idSeq = (idSeq + 1) % 1_000_000
  return `${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const SETTINGS_ID = 'main'
const CHILD_ID = 'child'
const PET_ID = 'pet'

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/** 所有寫入都走 Repo；db 與時間來源可注入（測試用） */
export class Repo {
  constructor(
    readonly db: GuaibaoDB = defaultDb,
    private readonly clock: () => number = clockNow,
  ) {}

  // ---------- 啟動 / 設定 ----------
  async seedShop(): Promise<void> {
    await this.db.shopItems.bulkPut(SHOP_CATALOG)
  }

  async getSettings(): Promise<Settings | undefined> {
    return this.db.settings.get(SETTINGS_ID)
  }

  async onboard(input: { pin: string; childName: string; petName: string }, now = this.clock()): Promise<Result> {
    if (!isValidPin(input.pin)) return { ok: false, error: 'PIN 需為 4 位數字' }
    const childName = input.childName.trim()
    if (!childName) return { ok: false, error: '請輸入小孩的名字' }
    const petName = input.petName.trim() || DEFAULT_PET_NAME
    const d = this.db
    await d.transaction('rw', [d.settings, d.children, d.pets, d.templates, d.shopItems], async () => {
      await d.settings.put({
        id: SETTINGS_ID,
        pinHash: hashPin(input.pin),
        childName,
        onboarded: true,
        ...learningSettingsOf(undefined),
      })
      await d.children.put({ id: CHILD_ID, name: childName, avatar: '🐵' })
      await d.pets.put({
        id: PET_ID,
        name: petName,
        stage: 'egg',
        feedCount: 0,
        hunger: START_HUNGER,
        hungerUpdatedAt: now,
        mood: 'happy',
      })
      await d.templates.bulkPut(DEFAULT_TEMPLATES)
      await d.shopItems.bulkPut(SHOP_CATALOG)
    })
    await this.ensureDailyTasks(now)
    return { ok: true }
  }

  async verifyPin(pin: string): Promise<boolean> {
    const s = await this.getSettings()
    return !!s && checkPin(pin, s.pinHash)
  }

  async changePin(oldPin: string, newPin: string): Promise<Result> {
    if (!isValidPin(newPin)) return { ok: false, error: '新 PIN 需為 4 位數字' }
    if (!(await this.verifyPin(oldPin))) return { ok: false, error: '目前的 PIN 不正確' }
    await this.db.settings.update(SETTINGS_ID, { pinHash: hashPin(newPin) })
    return { ok: true }
  }

  async setChildName(name: string): Promise<void> {
    const n = name.trim()
    if (!n) return
    await this.db.transaction('rw', [this.db.settings, this.db.children], async () => {
      await this.db.settings.update(SETTINGS_ID, { childName: n })
      await this.db.children.update(CHILD_ID, { name: n })
    })
  }

  async setPetName(name: string): Promise<void> {
    const n = name.trim()
    if (n) await this.db.pets.update(PET_ID, { name: n })
  }

  async resetAll(pin: string): Promise<Result> {
    if (!(await this.verifyPin(pin))) return { ok: false, error: 'PIN 不正確' }
    await Promise.all(this.db.tables.map((t) => t.clear()))
    return { ok: true }
  }

  // ---------- 任務 ----------
  /** 當天第一次開啟時產生每日任務；可重複呼叫 (idempotent) */
  async ensureDailyTasks(now = this.clock()): Promise<number> {
    const d = this.db
    return d.transaction('rw', [d.templates, d.instances], async () => {
      const [templates, existing] = await Promise.all([d.templates.toArray(), d.instances.toArray()])
      const fresh = instancesToCreate(templates, existing, localDateStr(now), now)
      if (fresh.length) await d.instances.bulkPut(fresh)
      return fresh.length
    })
  }

  async submitTask(instanceId: string, now = this.clock()): Promise<Result> {
    return this.db.transaction('rw', this.db.instances, async () => {
      const inst = await this.db.instances.get(instanceId)
      if (!inst) return { ok: false, error: '找不到任務' } as const
      const next = transition(inst.status, 'submit')
      if (!next) return { ok: false, error: '這個任務現在不能申請' } as const
      await this.db.instances.update(instanceId, { status: next, updatedAt: now })
      return { ok: true } as const
    })
  }

  private async rangeLedger(now: number): Promise<PointLedger[]> {
    const [s, e] = dayRange(now)
    return this.db.ledger.where('at').between(s, e, true, false).toArray()
  }

  /** 通過：加點（受每日上限限制）；退回：不加點，小孩可再申請 */
  async reviewTask(
    instanceId: string,
    action: 'approve' | 'reject',
    now = this.clock(),
  ): Promise<Result<{ awarded: number; capped: boolean }>> {
    const d = this.db
    return d.transaction('rw', [d.instances, d.templates, d.ledger], async () => {
      const inst = await d.instances.get(instanceId)
      if (!inst) return { ok: false, error: '找不到任務' } as const
      const next = transition(inst.status, action)
      if (!next) return { ok: false, error: '這個任務不在待審核狀態' } as const
      await d.instances.update(instanceId, { status: next, updatedAt: now })
      if (action === 'reject') return { ok: true, awarded: 0, capped: false } as const
      const tpl = await d.templates.get(inst.templateId)
      const points = tpl?.points ?? 0
      const { granted, capped } = grantPoints(await this.rangeLedger(now), points, now)
      if (granted > 0) {
        await d.ledger.add({
          id: newId(),
          at: now,
          delta: granted,
          reason: `完成任務：${tpl?.title ?? ''}${capped ? `（已達每日上限，原 ${points} 點）` : ''}`,
          kind: 'task',
          refId: instanceId,
        })
      }
      return { ok: true, awarded: granted, capped } as const
    })
  }

  async approveAll(now = this.clock()): Promise<{ count: number; awarded: number; capped: boolean }> {
    const pending = await this.db.instances.where('status').equals('pending').sortBy('updatedAt')
    let awarded = 0
    let capped = false
    for (const inst of pending) {
      const r = await this.reviewTask(inst.id, 'approve', now)
      if (r.ok) {
        awarded += r.awarded
        capped ||= r.capped
      }
    }
    return { count: pending.length, awarded, capped }
  }

  async saveTemplate(
    input: Partial<TaskTemplate> & Pick<TaskTemplate, 'title'>,
    now = this.clock(),
  ): Promise<Result> {
    const title = input.title.trim()
    if (!title) return { ok: false, error: '請輸入任務名稱' }
    const d = this.db
    await d.transaction('rw', d.templates, async () => {
      const prev = input.id ? await d.templates.get(input.id) : undefined
      const all = await d.templates.toArray()
      const tpl: TaskTemplate = {
        id: prev?.id ?? input.id ?? newId(),
        title,
        emoji: input.emoji?.trim() || prev?.emoji || '⭐',
        points: clampTaskPoints(input.points ?? prev?.points ?? TASK_POINTS_MIN, TASK_POINTS_MIN, TASK_POINTS_MAX),
        repeatDaily: input.repeatDaily ?? prev?.repeatDaily ?? true,
        active: input.active ?? prev?.active ?? true,
        order: prev?.order ?? Math.max(0, ...all.map((t) => t.order)) + 1,
      }
      await d.templates.put(tpl)
    })
    await this.ensureDailyTasks(now)
    return { ok: true }
  }

  // ---------- 點數 ----------
  async balance(): Promise<number> {
    return balanceOf(await this.db.ledger.toArray())
  }

  async grantBonus(
    amount: number,
    reason: string,
    now = this.clock(),
  ): Promise<Result<{ granted: number; capped: boolean }>> {
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: '請輸入大於 0 的整數' }
    if (amount > DAILY_POINT_CAP) return { ok: false, error: `單次最多 ${DAILY_POINT_CAP} 點` }
    return this.db.transaction('rw', this.db.ledger, async () => {
      const { granted, capped } = grantPoints(await this.rangeLedger(now), amount, now)
      if (granted > 0) {
        await this.db.ledger.add({
          id: newId(),
          at: now,
          delta: granted,
          reason: reason.trim() || '家長加點',
          kind: 'bonus',
        })
      }
      return { ok: true, granted, capped } as const
    })
  }

  async applyPenalty(amount: number, reason: string, now = this.clock()): Promise<Result> {
    return this.db.transaction('rw', this.db.ledger, async () => {
      const check = checkPenalty(await this.db.ledger.toArray(), amount)
      if (!check.ok) {
        return {
          ok: false,
          error: check.reason === 'insufficient' ? '扣點後餘額會小於 0，無法扣除' : '請輸入大於 0 的整數',
        } as const
      }
      await this.db.ledger.add({
        id: newId(),
        at: now,
        delta: -amount,
        reason: reason.trim() || '家長扣點',
        kind: 'penalty',
      })
      return { ok: true } as const
    })
  }

  // ---------- 商店 / 背包 / 寵物 ----------
  async buyItem(itemId: string, now = this.clock()): Promise<Result> {
    const d = this.db
    return d.transaction('rw', [d.ledger, d.inventory, d.shopItems], async () => {
      const item = await d.shopItems.get(itemId)
      if (!item) return { ok: false, error: '找不到商品' } as const
      const inv = await d.inventory.get(itemId)
      const check = canBuy(balanceOf(await d.ledger.toArray()), inv?.qty ?? 0, item)
      if (!check.ok) {
        return {
          ok: false,
          error: check.reason === 'owned' ? '已經擁有了' : `還差 ${check.shortBy} 點`,
        } as const
      }
      await d.ledger.add({ id: newId(), at: now, delta: -item.price, reason: `購買：${item.name}`, kind: 'purchase', refId: itemId })
      await d.inventory.put({ id: itemId, itemId, qty: (inv?.qty ?? 0) + 1 })
      return { ok: true } as const
    })
  }

  async feedPet(foodId: string, now = this.clock()): Promise<Result<{ pet: Pet; evolvedTo: Stage | null }>> {
    const d = this.db
    const effect = FOOD_EFFECTS[foodId]
    if (!effect) return { ok: false, error: '這不是飼料' }
    return d.transaction('rw', [d.pets, d.inventory], async () => {
      const inv = await d.inventory.get(foodId)
      if (!inv || inv.qty < 1) return { ok: false, error: '背包裡沒有這個了' } as const
      const pet = await d.pets.get(PET_ID)
      if (!pet) return { ok: false, error: '找不到寵物' } as const
      const r = feed(pet, effect, now)
      await d.pets.put(r.pet)
      await d.inventory.put({ ...inv, qty: inv.qty - 1 })
      return { ok: true, pet: r.pet, evolvedTo: r.evolvedTo } as const
    })
  }

  // ---------- 房間裝飾 ----------
  /** 驗證擁有該裝飾，回傳規格；否則回 null */
  private async ownedDecor(itemId: string) {
    const item = SHOP_ITEMS.find((i) => i.id === itemId)
    if (!item || item.kind !== 'decor' || !item.slot) return null
    const inv = await this.db.inventory.get(itemId)
    if (!inv || inv.qty < 1) return null
    const size = spriteSize(item.asset)
    return { item, slot: item.slot, hf: (size?.rows ?? 0) / ROOM_CELLS_H }
  }

  /** 擺放（或移動）裝飾。y 會依 牆面/地面 限制；x 限制在 0–1（精確的寬度 clamp 在 UI 端做） */
  async placeDecor(itemId: string, x: number, y: number, now = this.clock()): Promise<Result> {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: '位置不正確' }
    return this.db.transaction('rw', [this.db.placements, this.db.inventory], async () => {
      const d = await this.ownedDecor(itemId)
      if (!d) return { ok: false, error: '你還沒有這個裝飾' } as const
      const pos = clampPlacement(d.slot, x, y, 0, d.hf)
      const prev = await this.db.placements.get(itemId)
      await this.db.placements.put({
        itemId,
        x: pos.x,
        y: pos.y,
        z: prev?.z ?? 0,
        flipped: prev?.flipped ?? false,
        placedAt: prev?.placedAt ?? now,
      })
      return { ok: true } as const
    })
  }

  async moveDecor(itemId: string, x: number, y: number, now = this.clock()): Promise<Result> {
    if (!(await this.db.placements.get(itemId))) return { ok: false, error: '這個裝飾還沒擺放' }
    return this.placeDecor(itemId, x, y, now)
  }

  async flipDecor(itemId: string): Promise<Result> {
    return this.db.transaction('rw', [this.db.placements, this.db.inventory], async () => {
      if (!(await this.ownedDecor(itemId))) return { ok: false, error: '你還沒有這個裝飾' } as const
      const p = await this.db.placements.get(itemId)
      if (!p) return { ok: false, error: '這個裝飾還沒擺放' } as const
      await this.db.placements.update(itemId, { flipped: !p.flipped })
      return { ok: true } as const
    })
  }

  async bringToFront(itemId: string): Promise<Result> {
    return this.db.transaction('rw', [this.db.placements, this.db.inventory], async () => {
      if (!(await this.ownedDecor(itemId))) return { ok: false, error: '你還沒有這個裝飾' } as const
      const p = await this.db.placements.get(itemId)
      if (!p) return { ok: false, error: '這個裝飾還沒擺放' } as const
      await this.db.placements.update(itemId, { z: nextFrontZ(await this.db.placements.toArray()) })
      return { ok: true } as const
    })
  }

  /** 收回（回到未擺放，仍在背包） */
  async removeDecor(itemId: string): Promise<Result> {
    return this.db.transaction('rw', [this.db.placements, this.db.inventory], async () => {
      if (!(await this.ownedDecor(itemId))) return { ok: false, error: '你還沒有這個裝飾' } as const
      await this.db.placements.delete(itemId)
      return { ok: true } as const
    })
  }

  async markFeedHintShown(): Promise<void> {
    await this.db.settings.update(SETTINGS_ID, { feedHintShown: true })
  }

  // ---------- 學習：設定 / 遊玩時間 ----------
  async getLearningSettings(): Promise<LearningSettings> {
    return learningSettingsOf(await this.getSettings())
  }

  async setLearningSettings(patch: Partial<LearningSettings>): Promise<Result> {
    if (patch.dailyLimitMin !== undefined && !(DAILY_LIMIT_OPTIONS as readonly number[]).includes(patch.dailyLimitMin)) {
      return { ok: false, error: '不支援的時間限制' }
    }
    await this.db.settings.update(SETTINGS_ID, patch)
    return { ok: true }
  }

  async getPlayTime(date: string): Promise<PlayTime> {
    return (await this.db.playTime.get(date)) ?? { date, seconds: 0, bonusSeconds: 0 }
  }

  /** 累加當天的前景遊玩秒數（交易內讀寫，並行安全） */
  async addPlayTime(date: string, seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds <= 0) return
    const add = Math.min(Math.round(seconds), 3600)
    await this.db.transaction('rw', this.db.playTime, async () => {
      const cur = (await this.db.playTime.get(date)) ?? { date, seconds: 0, bonusSeconds: 0 }
      await this.db.playTime.put({ ...cur, seconds: cur.seconds + add })
    })
  }

  /** 延長當天遊玩時間（已在家長區內，不再驗證 PIN） */
  async addBonusTime(date: string, minutes = EXTEND_MINUTES): Promise<void> {
    if (!Number.isFinite(minutes) || minutes <= 0) return
    await this.db.transaction('rw', this.db.playTime, async () => {
      const cur = (await this.db.playTime.get(date)) ?? { date, seconds: 0, bonusSeconds: 0 }
      await this.db.playTime.put({ ...cur, bonusSeconds: cur.bonusSeconds + Math.round(minutes * 60) })
    })
  }

  /** 鎖定畫面上家長用 PIN 延長當天時間（預設 10 分鐘） */
  async extendPlayTime(pin: string, date: string, minutes = EXTEND_MINUTES): Promise<Result> {
    if (!(await this.verifyPin(pin))) return { ok: false, error: 'PIN 不正確' }
    await this.addBonusTime(date, minutes)
    return { ok: true }
  }

  // ---------- 學習：作答 / 關卡 ----------
  async getSkillStates(): Promise<Record<SkillId, SkillState>> {
    const rows = await this.db.skillState.toArray()
    return Object.fromEntries(
      SKILLS.map((k) => [k, rows.find((r) => r.skill === k) ?? initialSkillState(k)]),
    ) as Record<SkillId, SkillState>
  }

  async getProgress(chapterId: string, now = this.clock()): Promise<Progress> {
    return (await this.db.progress.get(chapterId)) ?? this.freshProgress(chapterId, 1, 0, now)
  }

  private freshProgress(chapterId: string, run: number, completedRuns: number, now: number): Progress {
    const n = getChapter(chapterId)?.stations.length ?? 0
    const stations: StationState[] = Array.from({ length: n }, () => ({ done: false, independent: 0, total: 0 }))
    return { chapterId, run, stations, chestClaimed: false, completedRuns, updatedAt: now }
  }

  /** 規劃一站的題目（讀取技能狀態與歷史作答；rng 可注入） */
  async planStation(
    stationIndex: number,
    now = this.clock(),
    rng: Rng = makeRng(Math.floor(Math.random() * 2 ** 31)),
  ): Promise<PlannedQuestion[]> {
    const [states, attempts] = await Promise.all([this.getSkillStates(), this.db.attempts.toArray()])
    return planStation({ stationIndex, states, attempts, now, rng })
  }

  /**
   * 記錄一次作答並更新技能難度。技能與難度以題庫為準。
   * 以 sessionId + questionId 當 id：重複送出同一題不會重複計算。
   */
  async recordAttempt(
    input: {
      sessionId: string
      questionId: string
      firstTryCorrect: boolean
      hintsUsed: number
      durationMs: number
      review?: boolean
      followUp?: boolean
    },
    now = this.clock(),
  ): Promise<Result<{ duplicate: boolean }>> {
    const q = getQuestion(input.questionId)
    if (!q) return { ok: false, error: '找不到這一題' }
    if (!input.sessionId) return { ok: false, error: '缺少 sessionId' }
    const hintsUsed = input.firstTryCorrect ? 0 : Math.max(1, Math.min(2, Math.round(input.hintsUsed || 0)))
    const d = this.db
    return d.transaction('rw', [d.attempts, d.skillState], async () => {
      const id = `${input.sessionId}:${input.questionId}`
      if (await d.attempts.get(id)) return { ok: true, duplicate: true } as const
      const attempt: Attempt = {
        id,
        at: now,
        questionId: q.id,
        skill: q.skill,
        difficulty: q.difficulty,
        firstTryCorrect: input.firstTryCorrect,
        hintsUsed,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        sessionId: input.sessionId,
        ...(input.review ? { review: true } : {}),
        ...(input.followUp ? { followUp: true } : {}),
      }
      await d.attempts.add(attempt)
      const state = (await d.skillState.get(q.skill)) ?? initialSkillState(q.skill, now)
      await d.skillState.put(applyAttempt(state, attempt))
      return { ok: true, duplicate: false } as const
    })
  }

  /**
   * 完成一站：由該 session 在資料庫裡的作答算出無提示答對數，發放材料、
   * 更新章節進度與技能掌握狀態。一個 session 只能領一次。
   */
  async completeStation(
    input: { chapterId: string; station: number; sessionId: string },
    now = this.clock(),
  ): Promise<
    Result<{
      independent: number
      total: number
      material: MaterialId
      qty: number
      chapterDone: boolean
      newlyMastered: SkillId[]
    }>
  > {
    const chapter = getChapter(input.chapterId)
    const def = chapter?.stations[input.station - 1]
    if (!chapter || !def) return { ok: false, error: '找不到這一站' }
    const d = this.db
    return d.transaction('rw', [d.attempts, d.skillState, d.progress, d.materialLedger], async () => {
      const attempts = await d.attempts.where('sessionId').equals(input.sessionId).toArray()
      if (attempts.length < STATION_SIZE) return { ok: false, error: '這一站的題目還沒答完' } as const
      if (await d.materialLedger.get(`station:${input.sessionId}`)) return { ok: false, error: '這一站的獎勵已經領過了' } as const
      const prog = (await d.progress.get(chapter.id)) ?? this.freshProgress(chapter.id, 1, 0, now)
      if (prog.stations[input.station - 1]?.done) return { ok: false, error: '這一站已經通關了' } as const
      if (input.station > 1 && !prog.stations[input.station - 2]?.done) return { ok: false, error: '要先通關前一站' } as const

      const independent = attempts.filter((a) => a.firstTryCorrect && a.hintsUsed === 0).length
      const qty = stationRewardQty(independent)
      await d.materialLedger.add({
        id: `station:${input.sessionId}`,
        at: now,
        material: def.material,
        delta: qty,
        kind: 'station',
        reason: `${chapter.name}・${def.name}`,
        refId: input.sessionId,
      })

      const stations = prog.stations.map((s, i) =>
        i === input.station - 1 ? { done: true, independent, total: attempts.length, completedAt: now } : s,
      )
      await d.progress.put({ ...prog, stations, updatedAt: now })

      const newlyMastered: SkillId[] = []
      for (const skill of SKILLS) {
        const cur = (await d.skillState.get(skill)) ?? initialSkillState(skill, now)
        const next = applyStationResult(cur, attempts, now)
        if (Object.keys(next.mastered).length > Object.keys(cur.mastered).length) newlyMastered.push(skill)
        if (next !== cur) await d.skillState.put(next)
      }
      return {
        ok: true,
        independent,
        total: attempts.length,
        material: def.material,
        qty,
        chapterDone: stations.every((s) => s.done),
        newlyMastered,
      } as const
    })
  }

  /** 章末寶箱：5 站都通關後才能開，每輪一次 */
  async claimChest(chapterId: string, now = this.clock()): Promise<Result<{ rewards: MaterialCost }>> {
    const chapter = getChapter(chapterId)
    if (!chapter) return { ok: false, error: '找不到這一章' }
    const d = this.db
    return d.transaction('rw', [d.progress, d.materialLedger], async () => {
      const prog = await d.progress.get(chapterId)
      if (!prog || !prog.stations.every((s) => s.done)) return { ok: false, error: '還有關卡沒通關' } as const
      if (prog.chestClaimed) return { ok: false, error: '寶箱已經打開過了' } as const
      let rewards = emptyCost()
      for (const m of MATERIAL_IDS) {
        const qty = chapter.chest[m]
        if (qty <= 0) continue
        await d.materialLedger.add({
          id: `chest:${chapterId}:${prog.run}:${m}`,
          at: now,
          material: m,
          delta: qty,
          kind: 'chest',
          reason: `${chapter.name}寶箱`,
          refId: chapterId,
        })
        rewards = addMaterial(rewards, m, qty)
      }
      await d.progress.put({ ...prog, chestClaimed: true, completedRuns: prog.completedRuns + 1, updatedAt: now })
      return { ok: true, rewards } as const
    })
  }

  /** 寶箱開完後再玩一次：進入下一輪（關卡重置，題目從題庫抽不同題面） */
  async startNextRun(chapterId: string, now = this.clock()): Promise<Result> {
    return this.db.transaction('rw', this.db.progress, async () => {
      const prog = await this.db.progress.get(chapterId)
      if (!prog?.chestClaimed) return { ok: false, error: '這一輪還沒結束' } as const
      await this.db.progress.put(this.freshProgress(chapterId, prog.run + 1, prog.completedRuns, now))
      return { ok: true } as const
    })
  }

  // ---------- 學習：材料 / 工坊 ----------
  async materialBalance(): Promise<MaterialBalance> {
    return balanceOfMaterials(await this.db.materialLedger.toArray())
  }

  /** 用材料做家具：扣材料、放進背包（可到首頁佈置）。一種家具只能有一件。 */
  async craftFurniture(itemId: string, now = this.clock()): Promise<Result> {
    const item = SHOP_CATALOG.find((i) => i.id === itemId)
    if (!item || item.kind !== 'decor' || !item.cost) return { ok: false, error: '這個不能製作' }
    const cost = item.cost
    const d = this.db
    return d.transaction('rw', [d.materialLedger, d.inventory], async () => {
      const inv = await d.inventory.get(itemId)
      const check = canCraft(balanceOfMaterials(await d.materialLedger.toArray()), inv?.qty ?? 0, item)
      if (!check.ok) {
        if (check.reason === 'owned') return { ok: false, error: '已經做過了' } as const
        const need = MATERIAL_IDS.filter((m) => check.short[m]).map((m) => `${MATERIAL_NAMES[m]} ${check.short[m]}`)
        return { ok: false, error: `材料不夠，還差 ${need.join('、')}` } as const
      }
      for (const m of MATERIAL_IDS) {
        if (cost[m] <= 0) continue
        await d.materialLedger.add({
          id: `craft:${newId()}:${m}`,
          at: now,
          material: m,
          delta: -cost[m],
          kind: 'craft',
          reason: `製作：${item.name}`,
          refId: itemId,
        })
      }
      await d.inventory.put({ id: itemId, itemId, qty: 1 })
      return { ok: true } as const
    })
  }

  // ---------- 著色 ----------
  async saveColoring(pageId: string, fills: Record<string, string>, now = this.clock()): Promise<void> {
    await this.db.coloring.put({ pageId, fills, updatedAt: now })
  }
}

export const repo = new Repo()
