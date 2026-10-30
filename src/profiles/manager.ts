// 孩子管理：啟動時把舊玩家升級成「第一個孩子」、新增 / 改名 / 改年齡 / 刪除孩子。
// 純邏輯（不碰 React）；資料庫與名冊都可以注入，方便測試。
import { DEFAULT_PET_NAME } from '../domain/constants'
import { checkPin, hashPin, isValidPin } from '../domain/pin'
import { normSpecies, SPECIES, speciesEmoji, type Species } from '../domain/species'
import type { AgeBand } from '../domain/types'
import { AGE_BANDS } from '../learning/profile'
import { DEFAULT_DB_NAME, deleteDb, getDb, type GuaibaoDB } from '../db/db'
import { newId, Repo, type Result } from '../db/repo'
import { registry as defaultRegistry, type ChildProfile, type Registry } from './registry'

/** 備用頭像（沒有寵物圖時用），依加入順序輪流 */
// v7.5：輪流的頭像不放兔子、老虎：那兩個代表「養兔兔 / 虎虎的孩子」，養阿悟的孩子不能拿到
const AVATARS = ['🐵', '🐼', '🐨', '🦊', '🐶', '🐱']
/** v7.5：名冊頭像。兔兔、虎虎用自己的動物；猴子依加入順序輪流（current 是重設前的頭像，不是別的物種的就沿用） */
export function avatarFor(species: Species | undefined, index: number, current?: string): string {
  const s = normSpecies(species)
  if (s !== 'monkey') return speciesEmoji(s)
  if (current === undefined) return AVATARS[index % AVATARS.length]
  const otherPet = SPECIES.some((x) => x !== 'monkey' && speciesEmoji(x) === current)
  return otherPet ? speciesEmoji('monkey') : current
}
const SETTINGS_ID = 'main'

export const dbNameForChild = (id: string) => `${DEFAULT_DB_NAME}-${id}`

export interface ManagerDeps {
  registry: Registry
  /** 取得指定名稱的孩子資料庫 */
  openDb: (name: string) => GuaibaoDB
  /** 刪除指定名稱的孩子資料庫 */
  removeDb: (name: string) => Promise<void>
  /** 第一個孩子（舊玩家）的資料庫名稱 */
  legacyDbName: string
}

export class ProfileManager {
  readonly deps: ManagerDeps

  constructor(deps: Partial<ManagerDeps> = {}) {
    this.deps = {
      registry: defaultRegistry,
      openDb: (name) => getDb(name),
      removeDb: deleteDb,
      legacyDbName: DEFAULT_DB_NAME,
      ...deps,
    }
  }

  private get reg() {
    return this.deps.registry
  }

  /** 操作某個孩子資料庫用的 Repo（PIN 走共用名冊） */
  repoFor(dbName: string): Repo {
    return new Repo(this.deps.openDb(dbName), undefined, undefined, this.reg.pinStore())
  }

  /**
   * 啟動：名冊已有孩子就直接回傳；沒有的話，看舊資料庫是不是已經玩過的玩家，是就升級成第一個孩子
   * （名字、年齡、PIN 都從舊資料庫的 settings 帶過來，舊資料庫一個字都不動）；都不是就是全新安裝，回傳空陣列。
   * 可重複呼叫、並行呼叫也只會建立一個孩子。
   */
  async bootstrap(): Promise<ChildProfile[]> {
    const existing = await this.reg.list()
    if (existing.length) return existing
    const legacy = this.deps.openDb(this.deps.legacyDbName)
    const s = await legacy.settings.get(SETTINGS_ID)
    if (!s?.onboarded) return []
    const face = await legacy.children.get('child')
    const rdb = this.reg.db
    await rdb.transaction('rw', [rdb.children, rdb.meta], async () => {
      if ((await rdb.children.count()) > 0) return // 另一個並行的 bootstrap 已經建好了
      const child: ChildProfile = {
        id: newId(),
        name: s.childName,
        avatar: face?.avatar || AVATARS[0],
        ageBand: s.ageBand && AGE_BANDS.includes(s.ageBand) ? s.ageBand : undefined,
        dbName: this.deps.legacyDbName,
        createdAt: Date.now(),
        order: 0,
      }
      await rdb.children.put(child)
      await rdb.meta.put({ key: 'pinHash', value: s.pinHash })
      await rdb.meta.put({ key: 'activeChildId', value: child.id })
    })
    return this.reg.list()
  }

  /** 全新安裝：設定共用 PIN，並建立第一個孩子（使用舊資料庫名稱 `guaibao-quest`） */
  async setupFirstChild(input: { pin: string; childName: string; petName?: string; species?: Species; ageBand?: AgeBand }): Promise<Result<{ child: ChildProfile }>> {
    if ((await this.reg.list()).length) return { ok: false, error: '已經有孩子了' }
    const r = await this.repoFor(this.deps.legacyDbName).onboard({ pin: input.pin, childName: input.childName, petName: input.petName, species: input.species })
    if (!r.ok) return r
    const child = await this.register(this.deps.legacyDbName, input.childName.trim(), input.ageBand, hashPin(input.pin), undefined, input.species)
    if (input.ageBand) await this.repoFor(child.dbName).setAgeBand(input.ageBand)
    await this.welcome(child)
    return { ok: true, child }
  }

  /** 新增另一個孩子：用共用 PIN，不再設定 PIN；各自一個新資料庫 */
  async addChild(input: { name: string; ageBand?: AgeBand; petName?: string; species?: Species }): Promise<Result<{ child: ChildProfile }>> {
    const name = input.name.trim()
    if (!name) return { ok: false, error: '請輸入孩子的名字' }
    if (input.ageBand && !AGE_BANDS.includes(input.ageBand)) return { ok: false, error: '不支援的年齡' }
    const pinHash = await this.reg.pinHash()
    if (!pinHash) return { ok: false, error: '還沒有設定家長 PIN' }
    const id = newId()
    const dbName = dbNameForChild(id)
    const repo = this.repoFor(dbName)
    const r = await repo.onboard({ pinHash, childName: name, petName: input.petName?.trim() || DEFAULT_PET_NAME, species: input.species })
    if (!r.ok) return r
    if (input.ageBand) await repo.setAgeBand(input.ageBand)
    const child = await this.register(dbName, name, input.ageBand, undefined, id, input.species)
    await this.welcome(child)
    return { ok: true, child }
  }

  /** 名冊有這個孩子、但他的資料庫是空的（重設之後）：用簡化 onboarding（不設 PIN）重新建立 */
  async onboardExisting(id: string, input: { childName: string; petName?: string; species?: Species; ageBand?: AgeBand }): Promise<Result> {
    const c = await this.reg.get(id)
    if (!c) return { ok: false, error: '找不到這個孩子' }
    const pinHash = await this.reg.pinHash()
    if (!pinHash) return { ok: false, error: '還沒有設定家長 PIN' }
    const repo = this.repoFor(c.dbName)
    const r = await repo.onboard({ pinHash, childName: input.childName, petName: input.petName, species: input.species })
    if (!r.ok) return r
    const age = c.ageBand ?? input.ageBand
    // v7.5：重設後重選的寵物可能換了物種，名冊頭像跟著換
    await this.reg.db.children.update(id, { name: input.childName.trim(), avatar: avatarFor(input.species, 0, c.avatar), ...(age ? { ageBand: age } : {}) })
    if (age) await repo.setAgeBand(age)
    await this.welcome(c) // 只有「新孩子還沒收到歡迎禮物」才會送（v7 以前就有的孩子 welcomed 是 undefined，不補送）
    return { ok: true }
  }

  async renameChild(id: string, name: string): Promise<Result> {
    const n = name.trim()
    if (!n) return { ok: false, error: '請輸入孩子的名字' }
    const c = await this.reg.get(id)
    if (!c) return { ok: false, error: '找不到這個孩子' }
    await this.reg.db.children.update(id, { name: n })
    await this.repoFor(c.dbName).setChildName(n)
    return { ok: true }
  }

  /** v7：新孩子的歡迎禮物（20 顆星星 + 1 個食物）。只送一次：名冊記著 welcomed，舊孩子不補送 */
  private async welcome(c: ChildProfile): Promise<void> {
    const cur = await this.reg.get(c.id)
    if (!cur || cur.welcomed !== false) return
    await this.repoFor(cur.dbName).grantWelcomeGift()
    await this.reg.db.children.update(c.id, { welcomed: true })
  }

  /** 年齡以名冊為準，同步寫進該孩子資料庫的 settings.ageBand（getLearnerProfile 讀的地方） */
  async setChildAge(id: string, band: AgeBand): Promise<Result> {
    if (!AGE_BANDS.includes(band)) return { ok: false, error: '不支援的年齡' }
    const c = await this.reg.get(id)
    if (!c) return { ok: false, error: '找不到這個孩子' }
    await this.reg.db.children.update(id, { ageBand: band })
    await this.repoFor(c.dbName).setAgeBand(band)
    return { ok: true }
  }

  /** 進入某個孩子前：把名冊的名字與年齡補寫進他的資料庫（兩邊不一致時以名冊為準） */
  async syncChild(id: string): Promise<void> {
    const c = await this.reg.get(id)
    if (!c) return
    const repo = this.repoFor(c.dbName)
    const s = await repo.getSettings()
    if (!s?.onboarded) return
    if (c.ageBand && s.ageBand !== c.ageBand) await repo.setAgeBand(c.ageBand)
    if (c.name && s.childName !== c.name) await repo.setChildName(c.name)
  }

  /**
   * 刪除孩子：要共用 PIN；不能刪掉最後一個。
   * beforeDelete 在驗證通過後、真正刪除前呼叫（刪除「目前正在玩的孩子」時，先讓畫面離開他的資料庫）。
   */
  async removeChild(id: string, pin: string, opts: { beforeDelete?: () => Promise<void> } = {}): Promise<Result> {
    const hash = await this.reg.pinHash()
    if (!hash || !checkPin(pin, hash)) return { ok: false, error: 'PIN 不正確' }
    const all = await this.reg.list()
    const c = all.find((x) => x.id === id)
    if (!c) return { ok: false, error: '找不到這個孩子' }
    if (all.length <= 1) return { ok: false, error: '至少要留一個孩子，不能刪掉最後一個' }
    await opts.beforeDelete?.()
    await this.reg.db.children.delete(id)
    if ((await this.reg.lastActiveId()) === id) await this.reg.setLastActiveId(all.find((x) => x.id !== id)!.id)
    await this.deps.removeDb(c.dbName)
    return { ok: true }
  }

  /** 驗證共用 PIN（不經任何孩子的資料庫） */
  async verifyPin(pin: string): Promise<boolean> {
    const hash = await this.reg.pinHash()
    return !!hash && isValidPin(pin) && checkPin(pin, hash)
  }

  private async register(dbName: string, name: string, ageBand: AgeBand | undefined, pinHash?: string, id = newId(), species?: Species): Promise<ChildProfile> {
    const rdb = this.reg.db
    return rdb.transaction('rw', [rdb.children, rdb.meta], async () => {
      const all = await rdb.children.toArray()
      const order = all.reduce((m, c) => Math.max(m, c.order), -1) + 1
      const avatar = avatarFor(species, all.length)
      const child: ChildProfile = { id, name, avatar, ageBand, dbName, createdAt: Date.now(), order, welcomed: false }
      await rdb.children.put(child)
      if (pinHash) await rdb.meta.put({ key: 'pinHash', value: pinHash })
      if (all.length === 0) await rdb.meta.put({ key: 'activeChildId', value: id })
      return child
    })
  }
}

export const profiles = new ProfileManager()
