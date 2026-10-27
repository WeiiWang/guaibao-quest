import { db as defaultDb, type GuaibaoDB } from './db'
import {
  DAILY_POINT_CAP,
  DEFAULT_PET_NAME,
  DEFAULT_TEMPLATES,
  FOOD_EFFECTS,
  FREE_COLORING_PAGES,
  FULL_HUNGER,
  PURCHASE_UNDO_MS,
  SHOP_ITEMS,
  START_HUNGER,
  TASK_POINTS_MAX,
  TASK_POINTS_MIN,
} from '../domain/constants'
import { dayRange, localDateStr } from '../domain/date'
import { currentHunger, feed } from '../domain/pet'
import { planFeedPoop, POOP_CAP, resolveDuePoops, type PoopSpread } from '../pet/poop'
import { checkPin, hashPin, isValidPin } from '../domain/pin'
import { registry, type PinStore } from '../profiles/registry'
import { balanceOf, checkPenalty, grantPoints } from '../domain/points'
import { canBuy } from '../domain/shop'
import { clampTaskPoints, instancesToCreate, transition } from '../domain/tasks'
import type {
  AgeBand,
  ColoringProgress,
  Pet,
  Poop,
  PointLedger,
  RoomThemeChoice,
  Settings,
  Stage,
  StageDraft,
  TaskTemplate,
} from '../domain/types'
import { now as clockNow } from '../domain/clock'
import { isArtworkId, spriteSize } from '../art/items'
import { getColoringPage } from '../art/coloring/pages'
import { checkApplyTheme, resolveTheme } from '../domain/theme'
import { docOf, type PaintDoc } from '../domain/coloring'
import { artworkSpot, clampPlacement, nextFrontZ, ROOM_CELLS_H } from '../domain/room'
import { getQuestion } from '../learning/bank'
import * as meta from './meta'
import { getChapter } from '../learning/chapter'
import { addMaterial, emptyCost, stationRewardQty, STATION_SIZE } from '../learning/scoring'
import { SHOP_CATALOG, balanceOfMaterials, canCraft, type MaterialBalance } from '../learning/materials'
import { DAILY_LIMIT_OPTIONS, EXTEND_MINUTES, learningSettingsOf, type LearningSettings } from '../learning/playtime'
import { makeRng, type Rng } from '../learning/rng'
import { adaptPlan, planStation, type PlannedQuestion } from '../learning/select'
import { avoidIdsFor, dailyInfo, emptyDaily, finishPlay, planDaily, startPlay, type DailyInfo } from '../learning/daily'
import { dailyChapterId, dailyMaterial, mustSubject, parseDailyId, subjectOfChapter } from '../learning/subject'
import { AGE_BANDS, learnerProfileOf, type LearnerProfile } from '../learning/profile'
import { applyAttempt, applyStationResult, initialSkillState } from '../learning/skills'
import { MATERIAL_IDS, MATERIAL_NAMES, SKILLS } from '../learning/types'
import type {
  Attempt,
  Interaction,
  MaterialCost,
  MaterialId,
  PlayTime,
  DailyBadge,
  DailyState,
  Progress,
  SkillId,
  SkillState,
  StationState,
  SubjectId,
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

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; reason?: 'full' | 'expired' | 'used' }

/** 所有寫入都走 Repo；db 與時間來源可注入（測試用） */
export class Repo {
  constructor(
    readonly db: GuaibaoDB = defaultDb,
    private readonly clock: () => number = clockNow,
    /** 亂數來源（大便機率用；測試可注入固定值） */
    private readonly rng: () => number = Math.random,
    /** 家長 PIN 存放處：預設是全家共用的名冊；名冊沒有 PIN 時退回這個資料庫 settings 裡的 pinHash */
    private readonly pins: PinStore = registry.pinStore(),
  ) {}

  // ---------- 啟動 / 設定 ----------
  async seedShop(): Promise<void> {
    await this.db.shopItems.bulkPut(SHOP_CATALOG)
  }

  /**
   * 送新使用者免費著色頁（小猴子、香蕉樹）：著色本一打開就有東西可畫。
   * 只送一次（settings.freeColoringGranted）；已經有的不重複加，之後怎麼退回、重設都不再補。
   */
  async grantFreeColoring(): Promise<boolean> {
    const d = this.db
    return d.transaction('rw', [d.settings, d.inventory], async () => {
      const s = await d.settings.get(SETTINGS_ID)
      if (!s || s.freeColoringGranted) return false
      for (const p of FREE_COLORING_PAGES) {
        const id = `coloring-${p}`
        const inv = await d.inventory.get(id)
        if (!inv || inv.qty < 1) await d.inventory.put({ id, itemId: id, qty: 1 })
      }
      await d.settings.update(SETTINGS_ID, { freeColoringGranted: true })
      return true
    })
  }

  /** 首次進首頁的引導只出現一次 */
  async markHomeGuideShown(): Promise<void> {
    await this.db.settings.update(SETTINGS_ID, { homeGuideShown: true })
  }

  async getSettings(): Promise<Settings | undefined> {
    return this.db.settings.get(SETTINGS_ID)
  }

  /**
   * 建立這個孩子的初始資料。第一個孩子帶 pin（同時成為全家共用的 PIN）；
   * 之後新增的孩子帶 pinHash（沿用共用 PIN 的雜湊，不再要求設定 PIN）。
   */
  async onboard(input: { pin?: string; pinHash?: string; childName: string; petName: string }, now = this.clock()): Promise<Result> {
    if (input.pinHash === undefined && !isValidPin(input.pin ?? '')) return { ok: false, error: 'PIN 需為 4 位數字' }
    const childName = input.childName.trim()
    if (!childName) return { ok: false, error: '請輸入小孩的名字' }
    const petName = input.petName.trim() || DEFAULT_PET_NAME
    const d = this.db
    await d.transaction('rw', [d.settings, d.children, d.pets, d.templates, d.shopItems], async () => {
      await d.settings.put({
        id: SETTINGS_ID,
        pinHash: input.pinHash ?? hashPin(input.pin ?? ''),
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
    const shared = await this.pins.get()
    if (shared) return checkPin(pin, shared)
    const s = await this.getSettings()
    return !!s && checkPin(pin, s.pinHash)
  }

  async changePin(oldPin: string, newPin: string): Promise<Result> {
    if (!isValidPin(newPin)) return { ok: false, error: '新 PIN 需為 4 位數字' }
    if (!(await this.verifyPin(oldPin))) return { ok: false, error: '目前的 PIN 不正確' }
    const hash = hashPin(newPin)
    await this.pins.set(hash)
    // 這個孩子資料庫裡的 pinHash 保留並同步（相容舊版；實際驗證以共用 PIN 為準）
    await this.db.settings.update(SETTINGS_ID, { pinHash: hash })
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

  /** 收回還在等審核的「我做完了」（小孩按錯了）：回到待辦，家長不會看到 */
  async withdrawTask(instanceId: string, now = this.clock()): Promise<Result> {
    return this.db.transaction('rw', this.db.instances, async () => {
      const inst = await this.db.instances.get(instanceId)
      if (!inst) return { ok: false, error: '找不到任務' } as const
      const next = transition(inst.status, 'withdraw')
      if (!next) return { ok: false, error: '這個任務現在不能收回' } as const
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
  async buyItem(itemId: string, now = this.clock()): Promise<Result<{ ledgerId: string }>> {
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
      const ledgerId = newId()
      await d.ledger.add({ id: ledgerId, at: now, delta: -item.price, reason: `購買：${item.name}`, kind: 'purchase', refId: itemId })
      await d.inventory.put({ id: itemId, itemId, qty: (inv?.qty ?? 0) + 1 })
      return { ok: true, ledgerId } as const
    })
  }

  /**
   * 退回剛買的東西（PURCHASE_UNDO_MS 內，含一點網路/卡頓的寬限）：
   * 把那筆購買紀錄整筆拿掉（星星還回去）並從庫存扣 1，彷彿沒買過；整個動作在同一個交易裡，星星與庫存不會不一致。
   * 食物如果已經餵掉了（庫存不夠扣）就不能退。
   */
  async undoPurchase(ledgerId: string, now = this.clock()): Promise<Result<{ itemId: string; refunded: number }>> {
    const d = this.db
    return d.transaction('rw', [d.ledger, d.inventory], async () => {
      const entry = await d.ledger.get(ledgerId)
      if (!entry || entry.kind !== 'purchase' || !entry.refId) return { ok: false, error: '找不到這筆購買' } as const
      if (now - entry.at > PURCHASE_UNDO_MS + 1500) return { ok: false, error: '太久了，不能退回了', reason: 'expired' } as const
      const inv = await d.inventory.get(entry.refId)
      if (!inv || inv.qty < 1) return { ok: false, error: '已經用掉了，不能退回', reason: 'used' } as const
      await d.ledger.delete(ledgerId)
      await d.inventory.put({ ...inv, qty: inv.qty - 1 })
      return { ok: true, itemId: entry.refId, refunded: -entry.delta } as const
    })
  }

  async feedPet(foodId: string, now = this.clock()): Promise<Result<{ pet: Pet; evolvedTo: Stage | null }>> {
    const d = this.db
    const effect = FOOD_EFFECTS[foodId]
    if (!effect) return { ok: false, error: '這不是飼料' }
    return d.transaction('rw', [d.pets, d.inventory, d.settings], async () => {
      const inv = await d.inventory.get(foodId)
      if (!inv || inv.qty < 1) return { ok: false, error: '背包裡沒有這個了' } as const
      const pet = await d.pets.get(PET_ID)
      if (!pet) return { ok: false, error: '找不到寵物' } as const
      // 吃飽了：不扣食物、不增加餵食次數（小孩狂點也不會白白燒掉星星換來的食物）
      if (currentHunger(pet, now) >= FULL_HUNGER) return { ok: false, error: '我吃飽了～', reason: 'full' } as const
      const r = feed(pet, effect, now)
      // v3：吃完東西可能在一段時間後大便（蛋不會；家長可關閉）
      const settings = await d.settings.get(SETTINGS_ID)
      const pp = planFeedPoop({
        stage: pet.stage,
        streak: pet.feedStreak,
        now,
        poopOn: settings?.petPoopOn ?? true,
        poopCount: pet.poops?.length ?? 0,
        dueCount: pet.poopDue?.length ?? 0,
        rng: this.rng,
      })
      r.pet.feedStreak = pp.streak
      if (pp.due !== null) r.pet.poopDue = [...(pet.poopDue ?? []), pp.due]
      await d.pets.put(r.pet)
      await d.inventory.put({ ...inv, qty: inv.qty - 1 })
      return { ok: true, pet: r.pet, evolvedTo: r.evolvedTo } as const
    })
  }

  // ---------- 便便（SPEC-v3 A3） ----------
  async getPoops(): Promise<Poop[]> {
    return (await this.db.pets.get(PET_ID))?.poops ?? []
  }

  /** 立刻長一坨便便（PM 預覽、到期補發用）；已達上限回 null */
  async addPoop(x: number, now = this.clock()): Promise<Poop | null> {
    return this.db.transaction('rw', this.db.pets, async () => {
      const pet = await this.db.pets.get(PET_ID)
      if (!pet) return null
      const poops = pet.poops ?? []
      if (poops.length >= POOP_CAP) return null
      const p: Poop = { id: newId(), x: Math.min(0.94, Math.max(0.06, x)), at: now }
      await this.db.pets.update(PET_ID, { poops: [...poops, p] })
      return p
    })
  }

  /** 把已到期的排定便便變成真的（離線期間到期的也會補上）。回傳這次新長的。 */
  async takeDuePoops(centerX: number, now = this.clock(), spread?: PoopSpread): Promise<Poop[]> {
    return this.db.transaction('rw', this.db.pets, async () => {
      const pet = await this.db.pets.get(PET_ID)
      if (!pet || !pet.poopDue?.length) return []
      const r = resolveDuePoops(pet.poops ?? [], pet.poopDue, now, centerX, this.rng, newId, POOP_CAP, spread)
      await this.db.pets.update(PET_ID, { poops: r.poops, poopDue: r.due })
      return r.added
    })
  }

  async clearPoop(id: string): Promise<boolean> {
    return this.db.transaction('rw', this.db.pets, async () => {
      const pet = await this.db.pets.get(PET_ID)
      const poops = pet?.poops ?? []
      if (!poops.some((p) => p.id === id)) return false
      await this.db.pets.update(PET_ID, { poops: poops.filter((p) => p.id !== id) })
      return true
    })
  }

  /** 清空所有便便與排定的大便（PM 預覽用） */
  async clearAllPoops(): Promise<void> {
    await this.db.pets.update(PET_ID, { poops: [], poopDue: [] })
  }

  async setPetPoopOn(on: boolean): Promise<void> {
    await this.db.settings.update(SETTINGS_ID, { petPoopOn: on })
  }

  // ---------- 房間裝飾 ----------
  /** 驗證擁有該裝飾，回傳規格；否則回 null */
  private async ownedDecor(itemId: string) {
    // 掛到房間的畫廊作品（art-<galleryId>）：牆面裝飾，擁有 = 背包有紀錄
    if (isArtworkId(itemId)) {
      const inv = await this.db.inventory.get(itemId)
      if (!inv || inv.qty < 1) return null
      return { item: undefined, slot: 'wall' as const, hf: spriteSize(itemId).rows / ROOM_CELLS_H }
    }
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
  /**
   * 這個孩子的學習檔案：年齡檔、起始難度、是否幼幼模式。
   * 學習相關程式一律從這裡讀（目前存在 settings；之後改成每個孩子各自一份時只需要改這個函式）。
   */
  async getLearnerProfile(): Promise<LearnerProfile> {
    return learnerProfileOf(await this.getSettings())
  }

  async setAgeBand(band: AgeBand): Promise<Result> {
    if (!AGE_BANDS.includes(band)) return { ok: false, error: '不支援的年齡' }
    await this.db.settings.update(SETTINGS_ID, { ageBand: band })
    return { ok: true }
  }

  /** 還沒有紀錄的技能，從年齡對應的起始難度開始；已經有紀錄的不受年齡影響 */
  async getSkillStates(): Promise<Record<SkillId, SkillState>> {
    const [rows, profile] = await Promise.all([this.db.skillState.toArray(), this.getLearnerProfile()])
    return Object.fromEntries(
      SKILLS.map((k) => [k, rows.find((r) => r.skill === k) ?? initialSkillState(k, 0, profile.startDifficulty)]),
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
    chapterId?: string,
  ): Promise<PlannedQuestion[]> {
    const [states, attempts, profile] = await Promise.all([this.getSkillStates(), this.db.attempts.toArray(), this.getLearnerProfile()])
    const slots = chapterId ? getChapter(chapterId)?.stations[stationIndex]?.slots : undefined
    // 英文章節只出英文技能；沒給章節（或數學）就是數學的三個技能
    const skills = chapterId ? subjectOfChapter(chapterId)?.skills : undefined
    return planStation({ stationIndex, states, attempts, now, rng, gentle: profile.gentle, slots, skills })
  }

  /**
   * 進入一站：有上次中途離開留下的進度（同一章、同一站、同一輪）就接著玩，
   * 否則規劃新的一站並存下進度。idx = 第一個還沒答的題號。
   */
  async openStation(
    chapterId: string,
    station: number,
    now = this.clock(),
    rng: Rng = makeRng(Math.floor(Math.random() * 2 ** 31)),
  ): Promise<{ sessionId: string; plan: PlannedQuestion[]; idx: number; resumed: boolean }> {
    const dailySubject = parseDailyId(chapterId)
    if (dailySubject) return this.openDaily(dailySubject, now, rng)
    const [settings, prog] = await Promise.all([this.getSettings(), this.getProgress(chapterId, now)])
    const draft = settings?.stageDraft
    if (draft && draft.chapterId === chapterId && draft.station === station && draft.run === prog.run && !prog.stations[station - 1]?.done) {
      const plan: PlannedQuestion[] = []
      for (const p of draft.plan) {
        const q = getQuestion(p.id)
        if (!q) break
        plan.push({ question: q, review: p.review, followUp: p.followUp })
      }
      if (plan.length === draft.plan.length && plan.length > 0) {
        const answered = new Set((await this.db.attempts.where('sessionId').equals(draft.sessionId).toArray()).map((a) => a.questionId))
        const first = plan.findIndex((p) => !answered.has(p.question.id))
        return { sessionId: draft.sessionId, plan, idx: first < 0 ? plan.length - 1 : first, resumed: answered.size > 0 }
      }
    }
    const plan = await this.planStation(station - 1, now, rng, chapterId)
    const sessionId = newId()
    await this.saveStageDraft({ chapterId, station, run: prog.run, sessionId, plan, now })
    return { sessionId, plan, idx: 0, resumed: false }
  }

  async saveStageDraft(input: { chapterId: string; station: number; run: number; sessionId: string; plan: PlannedQuestion[]; now?: number }): Promise<void> {
    const draft: StageDraft = {
      chapterId: input.chapterId,
      station: input.station,
      run: input.run,
      sessionId: input.sessionId,
      plan: input.plan.map((p) => ({ id: p.question.id, review: p.review, followUp: p.followUp })),
      savedAt: input.now ?? this.clock(),
    }
    await this.db.settings.update(SETTINGS_ID, { stageDraft: draft })
  }

  /** 已經看過教學示範的互動 */
  async getSeenIntros(): Promise<string[]> {
    return (await this.getSettings())?.seenIntros ?? []
  }

  async markIntroSeen(interaction: string): Promise<void> {
    await this.db.transaction('rw', this.db.settings, async () => {
      const cur = (await this.db.settings.get(SETTINGS_ID))?.seenIntros ?? []
      if (!cur.includes(interaction)) await this.db.settings.update(SETTINGS_ID, { seenIntros: [...cur, interaction] })
    })
  }

  async clearStageDraft(): Promise<void> {
    await this.db.settings.update(SETTINGS_ID, { stageDraft: undefined })
  }

  /**
   * 站中調整剩下的題（不改技能狀態）：剛升級後改用新難度重抽；同技能連續 2 題第一次就答錯，下一題降 1 級。
   * 會把調整後的題目存回進度。
   */
  async adaptStation(
    input: { chapterId: string; station: number; sessionId: string; plan: PlannedQuestion[]; from: number },
    rng: Rng = makeRng(Math.floor(Math.random() * 2 ** 31)),
  ): Promise<PlannedQuestion[]> {
    const [states, attempts, profile, prog] = await Promise.all([
      this.getSkillStates(),
      this.db.attempts.toArray(),
      this.getLearnerProfile(),
      this.getProgress(input.chapterId),
    ])
    const mine = attempts.filter((a) => a.sessionId === input.sessionId && !a.review).sort((a, b) => a.at - b.at)
    const plan = adaptPlan({ plan: input.plan, from: input.from, states, attempts, stationAttempts: mine, rng, gentle: profile.gentle })
    // 每日冒險的 run 是「今天第幾次」
    const run = parseDailyId(input.chapterId) ? (await this.getDailyState(input.chapterId)).days[localDateStr(this.clock())]?.plays ?? prog.run : prog.run
    await this.saveStageDraft({ chapterId: input.chapterId, station: input.station, run, sessionId: input.sessionId, plan })
    return plan
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
      interaction?: Interaction
    },
    now = this.clock(),
  ): Promise<Result<{ duplicate: boolean }>> {
    const q = getQuestion(input.questionId)
    if (!q) return { ok: false, error: '找不到這一題' }
    if (!input.sessionId) return { ok: false, error: '缺少 sessionId' }
    const hintsUsed = input.firstTryCorrect ? 0 : Math.max(1, Math.min(2, Math.round(input.hintsUsed || 0)))
    const d = this.db
    return d.transaction('rw', [d.attempts, d.skillState, d.settings], async () => {
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
        interaction: input.interaction ?? q.interaction ?? 'pick',
      }
      await d.attempts.add(attempt)
      const profile = learnerProfileOf(await d.settings.get(SETTINGS_ID))
      const state = (await d.skillState.get(q.skill)) ?? initialSkillState(q.skill, now, profile.startDifficulty)
      await d.skillState.put(applyAttempt(state, attempt, { gentle: profile.gentle }))
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
    return d.transaction('rw', [d.attempts, d.skillState, d.progress, d.materialLedger, d.settings, d.inventory], async () => {
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
      await d.settings.update(SETTINGS_ID, { stageDraft: undefined })
      await meta.grantStationDrop(d, this.rng, now) // v5：每站過關掉落 1 個食物，待首頁展示

      const newlyMastered: SkillId[] = []
      const startDifficulty = learnerProfileOf(await d.settings.get(SETTINGS_ID)).startDifficulty
      for (const skill of SKILLS) {
        const cur = (await d.skillState.get(skill)) ?? initialSkillState(skill, now, startDifficulty)
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

  // ---------- v5：禮物 / 圖鑑 / 新招（實作在 db/meta.ts） ----------
  grantDailyGift(now = this.clock()) {
    return meta.grantDailyGift(this.db, this.rng, now)
  }
  getPendingGifts() {
    return meta.getPendingGifts(this.db)
  }
  collectGift() {
    return meta.collectGift(this.db)
  }
  knownFriends() {
    return meta.knownFriends(this.db)
  }
  syncCollection(now = this.clock()) {
    return meta.syncCollection(this.db, this.rng, now)
  }
  syncTricks() {
    return meta.syncTricks(this.db)
  }
  popPendingTrick() {
    return meta.popPendingTrick(this.db)
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

  // ---------- 學習：每日冒險 ----------
  // 每天每個科目一份 5 題的新冒險（見 learning/daily.ts）。進度存在 progress 表（chapterId = daily:<科目>），不升 Dexie 版本。
  /** 每日冒險的進度（chapterId = daily:<科目>） */
  async getDailyState(chapterId: string): Promise<DailyState> {
    return (await this.db.progress.get(chapterId))?.daily ?? emptyDaily()
  }

  async getDailyInfo(subject: SubjectId, now = this.clock()): Promise<DailyInfo> {
    return dailyInfo(await this.getDailyState(dailyChapterId(subject)), localDateStr(now))
  }

  /** 所有拿過的今日徽章（新的在後；之後圖鑑會用） */
  async listDailyBadges(): Promise<DailyBadge[]> {
    const rows = await this.db.progress.where('chapterId').startsWith('daily:').toArray()
    return rows.flatMap((r) => r.daily?.badges ?? []).sort((a, b) => a.at - b.at)
  }

  private async putDailyState(chapterId: string, daily: DailyState, now: number): Promise<void> {
    const cur = await this.db.progress.get(chapterId)
    await this.db.progress.put({ chapterId, run: 1, stations: [], chestClaimed: false, completedRuns: 0, ...cur, daily, updatedAt: now })
  }

  /**
   * 開始（或接著玩）今天的每日冒險。中途離開再回來會接著玩同一份；玩完再開就是新的一次（題面換新）。
   * 整段在一個交易裡做，避免同時開兩次（React StrictMode）把次數算兩遍。
   */
  async openDaily(
    subject: SubjectId,
    now = this.clock(),
    rng?: Rng,
  ): Promise<{ sessionId: string; plan: PlannedQuestion[]; idx: number; resumed: boolean }> {
    const d = this.db
    const cid = dailyChapterId(subject)
    const date = localDateStr(now)
    return d.transaction('rw', [d.progress, d.settings, d.attempts, d.skillState], async () => {
      const daily = await this.getDailyState(cid)
      const day = daily.days[date]
      const draft = (await d.settings.get(SETTINGS_ID))?.stageDraft
      if (draft && draft.chapterId === cid && day && draft.run === day.plays && day.done < day.plays) {
        const plan: PlannedQuestion[] = []
        for (const p of draft.plan) {
          const q = getQuestion(p.id)
          if (!q) break
          plan.push({ question: q, review: p.review, followUp: p.followUp })
        }
        if (plan.length === draft.plan.length && plan.length > 0) {
          const answered = new Set((await d.attempts.where('sessionId').equals(draft.sessionId).toArray()).map((a) => a.questionId))
          const first = plan.findIndex((p) => !answered.has(p.question.id))
          return { sessionId: draft.sessionId, plan, idx: first < 0 ? plan.length - 1 : first, resumed: answered.size > 0 }
        }
      }
      const [states, attempts, profile] = await Promise.all([this.getSkillStates(), d.attempts.toArray(), this.getLearnerProfile()])
      const play = (day?.plays ?? 0) + 1
      const plan = planDaily({ subject, date, play, states, attempts, now, avoid: avoidIdsFor(daily, date), gentle: profile.gentle, rng })
      const started = startPlay(daily, date, plan.map((p) => p.question.id))
      await this.putDailyState(cid, started.state, now)
      const sessionId = newId()
      await this.saveStageDraft({ chapterId: cid, station: 1, run: started.play, sessionId, plan, now })
      return { sessionId, plan, idx: 0, resumed: false }
    })
  }

  /**
   * 完成一次每日冒險：發材料（和一般站一樣，材料種類每天輪流）、更新技能掌握；
   * 這個科目今天第一次完成才有「今日徽章」。同一個 session 只能領一次；同一天可以重玩，只是不再有徽章。
   */
  async completeDaily(
    input: { chapterId: string; sessionId: string },
    now = this.clock(),
  ): Promise<
    Result<{
      independent: number
      total: number
      material: MaterialId
      qty: number
      chapterDone: boolean
      newlyMastered: SkillId[]
      badge: boolean
    }>
  > {
    const subject = parseDailyId(input.chapterId)
    if (!subject) return { ok: false, error: '找不到今日冒險' }
    const date = localDateStr(now)
    const d = this.db
    return d.transaction('rw', [d.attempts, d.skillState, d.progress, d.materialLedger, d.settings, d.inventory], async () => {
      const attempts = await d.attempts.where('sessionId').equals(input.sessionId).toArray()
      if (attempts.length < STATION_SIZE) return { ok: false, error: '今天的題目還沒答完' } as const
      if (await d.materialLedger.get(`daily:${input.sessionId}`)) return { ok: false, error: '這次的獎勵已經領過了' } as const

      const independent = attempts.filter((a) => a.firstTryCorrect && a.hintsUsed === 0).length
      const qty = stationRewardQty(independent)
      const material = dailyMaterial(date)
      await d.materialLedger.add({
        id: `daily:${input.sessionId}`,
        at: now,
        material,
        delta: qty,
        kind: 'station',
        reason: `今日冒險・${mustSubject(subject).name}`,
        refId: input.sessionId,
      })
      await meta.grantStationDrop(d, this.rng, now) // 每日冒險過關也掉落 1 個食物（答題 → 餵食）
      const fin = finishPlay(await this.getDailyState(input.chapterId), date, subject, attempts.map((a) => a.questionId), now)
      await this.putDailyState(input.chapterId, fin.state, now)
      await d.settings.update(SETTINGS_ID, { stageDraft: undefined })

      const newlyMastered: SkillId[] = []
      const startDifficulty = learnerProfileOf(await d.settings.get(SETTINGS_ID)).startDifficulty
      for (const skill of SKILLS) {
        const cur = (await d.skillState.get(skill)) ?? initialSkillState(skill, now, startDifficulty)
        const next = applyStationResult(cur, attempts, now)
        if (Object.keys(next.mastered).length > Object.keys(cur.mastered).length) newlyMastered.push(skill)
        if (next !== cur) await d.skillState.put(next)
      }
      return { ok: true, independent, total: attempts.length, material, qty, chapterDone: false, newlyMastered, badge: !!fin.badge } as const
    })
  }

  // ---------- 學習：材料 / 工坊 ----------
  async materialBalance(): Promise<MaterialBalance> {
    return balanceOfMaterials(await this.db.materialLedger.toArray())
  }

  /** 用材料做家具 / 壁紙 / 地板：扣材料、放進背包（家具到首頁佈置；壁紙地板在工坊套用）。一種只能有一件。 */
  async craftFurniture(itemId: string, now = this.clock()): Promise<Result> {
    const item = SHOP_CATALOG.find((i) => i.id === itemId)
    if (!item || (item.kind !== 'decor' && item.kind !== 'theme') || !item.cost) return { ok: false, error: '這個不能製作' }
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

  // ---------- 房間主題（壁紙 / 地板） ----------
  /** 套用中的主題（已確認擁有，否則退回預設） */
  async getRoomTheme(): Promise<Required<RoomThemeChoice>> {
    const [settings, inv] = await Promise.all([this.getSettings(), this.db.inventory.toArray()])
    return resolveTheme(settings?.roomTheme, inv)
  }

  /** 套用已擁有的壁紙 / 地板；預設主題永遠可套用 */
  async applyTheme(themeId: string): Promise<Result> {
    const d = this.db
    return d.transaction('rw', [d.settings, d.inventory], async () => {
      const check = checkApplyTheme(themeId, await d.inventory.toArray())
      if (!check.ok) return { ok: false, error: check.error } as const
      const s = await d.settings.get(SETTINGS_ID)
      if (!s) return { ok: false, error: '還沒完成初始設定' } as const
      await d.settings.update(SETTINGS_ID, { roomTheme: { ...(s.roomTheme ?? {}), [check.slot]: themeId } })
      return { ok: true } as const
    })
  }

  // ---------- 著色 / 畫廊 ----------
  /** 儲存進行中的作品（填色 + 筆刷 + 貼紙） */
  async saveColoringDoc(pageId: string, doc: PaintDoc, now = this.clock()): Promise<void> {
    await this.db.coloring.put({ pageId, fills: doc.fills, strokes: doc.strokes, stickers: doc.stickers, updatedAt: now })
  }

  /** 只更新填色（保留筆刷與貼紙） */
  async saveColoring(pageId: string, fills: Record<string, string>, now = this.clock()): Promise<void> {
    const prev = await this.db.coloring.get(pageId)
    await this.db.coloring.put({ ...prev, pageId, fills, updatedAt: now })
  }

  async getColoringDoc(pageId: string): Promise<PaintDoc> {
    return docOf(await this.db.coloring.get(pageId))
  }

  /** 完成：把目前的作品存成畫廊作品（png 是完成圖的 data URL）。回傳畫廊 id */
  async completeColoring(pageId: string, doc: PaintDoc, png: string, now = this.clock()): Promise<Result<{ galleryId: string }>> {
    if (!getColoringPage(pageId)) return { ok: false, error: '找不到這張著色頁' }
    if (!png.startsWith('data:image/')) return { ok: false, error: '完成圖不正確' }
    const galleryId = newId()
    const d = this.db
    await d.transaction('rw', d.coloring, async () => {
      await d.coloring.put({ pageId, fills: doc.fills, strokes: doc.strokes, stickers: doc.stickers, updatedAt: now })
      await d.coloring.put({
        pageId: `g:${galleryId}`,
        basePageId: pageId,
        fills: doc.fills,
        strokes: doc.strokes,
        stickers: doc.stickers,
        png,
        createdAt: now,
        updatedAt: now,
      })
    })
    return { ok: true, galleryId }
  }

  /** 畫廊作品，新的在前 */
  async listGallery(): Promise<ColoringProgress[]> {
    const all = await this.db.coloring.toArray()
    return all.filter((w) => w.pageId.startsWith('g:')).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }

  /** 把畫廊作品掛到房間（牆面裝飾 art-<galleryId>）。已掛過就維持原位。 */
  async hangArtwork(galleryId: string, now = this.clock()): Promise<Result<{ itemId: string; already: boolean }>> {
    const d = this.db
    return d.transaction('rw', [d.coloring, d.shopItems, d.inventory, d.placements], async () => {
      const work = await d.coloring.get(`g:${galleryId}`)
      if (!work) return { ok: false, error: '找不到這幅畫' } as const
      const itemId = `art-${galleryId}`
      const already = !!(await d.placements.get(itemId))
      if (already) return { ok: true, itemId, already: true } as const
      const base = work.basePageId ? getColoringPage(work.basePageId)?.name : undefined
      await d.shopItems.put({ id: itemId, kind: 'decor', name: `我的畫：${base ?? '作品'}`, price: 0, asset: itemId, slot: 'wall' })
      await d.inventory.put({ id: itemId, itemId, qty: 1 })
      const hung = (await d.placements.toArray()).filter((p) => isArtworkId(p.itemId)).length
      const size = spriteSize(itemId)
      const hf = size.rows / ROOM_CELLS_H
      // 預設放在剛進房間時畫面的右側牆面，避開左上角的狀態卡與右上角的工坊/背包按鈕
      const spot = artworkSpot(hung)
      const pos = clampPlacement('wall', spot.x, spot.y, 0, hf)
      await d.placements.put({ itemId, x: pos.x, y: pos.y, z: 0, flipped: false, placedAt: now })
      return { ok: true, itemId, already: false } as const
    })
  }

  /** 從房間取下（回到背包，可再到佈置模式擺放） */
  async unhangArtwork(galleryId: string): Promise<void> {
    await this.db.placements.delete(`art-${galleryId}`)
  }

  /** 刪除畫廊作品（連同掛在房間裡的畫框） */
  async deleteGalleryWork(galleryId: string): Promise<void> {
    const d = this.db
    const itemId = `art-${galleryId}`
    await d.transaction('rw', [d.coloring, d.shopItems, d.inventory, d.placements], async () => {
      await d.coloring.delete(`g:${galleryId}`)
      await d.placements.delete(itemId)
      await d.inventory.delete(itemId)
      await d.shopItems.delete(itemId)
    })
  }
}

export const repo = new Repo()
