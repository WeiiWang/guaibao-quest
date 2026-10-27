import Dexie, { type Table } from 'dexie'
import { LEGACY_DECOR_POSITIONS } from '../domain/constants'
import type {
  Child,
  ColoringProgress,
  Inventory,
  Pet,
  Placement,
  PointLedger,
  Settings,
  ShopItem,
  TaskInstance,
  TaskTemplate,
} from '../domain/types'
import type { Attempt, MaterialLedgerEntry, PlayTime, Progress, SkillState } from '../learning/types'
import { SHOP_CATALOG } from '../learning/materials'
import { DEFAULT_DAILY_LIMIT_MIN } from '../learning/playtime'

/** 第一個孩子（含升級前的舊玩家）沿用的資料庫名稱；之後的孩子用 `guaibao-quest-<childId>` */
export const DEFAULT_DB_NAME = 'guaibao-quest'

export class GuaibaoDB extends Dexie {
  children!: Table<Child, string>
  templates!: Table<TaskTemplate, string>
  instances!: Table<TaskInstance, string>
  ledger!: Table<PointLedger, string>
  pets!: Table<Pet, string>
  shopItems!: Table<ShopItem, string>
  inventory!: Table<Inventory, string>
  coloring!: Table<ColoringProgress, string>
  settings!: Table<Settings, string>
  placements!: Table<Placement, string>
  attempts!: Table<Attempt, string>
  materialLedger!: Table<MaterialLedgerEntry, string>
  progress!: Table<Progress, string>
  skillState!: Table<SkillState, string>
  playTime!: Table<PlayTime, string>

  constructor(name = DEFAULT_DB_NAME) {
    super(name)
    this.version(1).stores({
      children: 'id',
      templates: 'id, order',
      instances: 'id, templateId, date, status',
      ledger: 'id, at, kind',
      pets: 'id',
      shopItems: 'id, kind',
      inventory: 'id, itemId',
      coloring: 'pageId',
      settings: 'id',
    })
    // v2：Pet.decor 陣列 → placements 表（位置、翻轉、圖層）
    this.version(2)
      .stores({ placements: 'itemId' })
      .upgrade(async (tx) => {
        const pets = tx.table('pets')
        const placements = tx.table<Placement, string>('placements')
        const all: (Record<string, unknown> & { decor?: string[] })[] = await pets.toArray()
        for (const p of all) {
          const ids = Array.isArray(p.decor) ? p.decor : []
          for (const itemId of ids) {
            const pos = LEGACY_DECOR_POSITIONS[itemId] ?? { x: 0.3, y: 0.8 }
            await placements.put({ itemId, x: pos.x, y: pos.y, z: 0, flipped: false, placedAt: Date.now() })
          }
          delete p.decor
          await pets.put(p)
        }
      })
    // v3：學習系統。新增作答紀錄、材料流水帳、章節進度、技能狀態、每日遊玩時間；
    // settings 補上時間限制/音效/語音預設值；shopItems 補上家具材料成本。舊資料一律保留。
    this.version(3)
      .stores({
        attempts: 'id, at, skill, sessionId, questionId',
        materialLedger: 'id, at, material, kind, refId',
        progress: 'chapterId',
        skillState: 'skill',
        playTime: 'date',
      })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.dailyLimitMin === undefined) s.dailyLimitMin = DEFAULT_DAILY_LIMIT_MIN
            if (s.soundOn === undefined) s.soundOn = true
            if (s.voiceOn === undefined) s.voiceOn = true
          })
        // 只補 cost 欄位，不動其他欄位
        const shop = tx.table<ShopItem, string>('shopItems')
        for (const item of SHOP_CATALOG) {
          if (item.cost && (await shop.get(item.id))) await shop.update(item.id, { cost: item.cost })
        }
      })
  }
}

// ---------- 多孩子：每個孩子各自一個資料庫 ----------
// `db` 是一個 Proxy，永遠指向「目前這個孩子」的資料庫；所有既有程式（repo、useLiveQuery、pm）照舊 import { db }。
// 切換孩子只透過 setActiveDb()，而且 App 會先把舊孩子的畫面整個卸載、再切換，所以不會有寫錯資料庫的問題。
const instances = new Map<string, GuaibaoDB>()
let activeName = DEFAULT_DB_NAME

/** 取得（必要時建立）指定名稱的資料庫實例；不帶名稱就是目前的孩子。同名永遠回同一個實例 */
export function getDb(name: string = activeName): GuaibaoDB {
  let inst = instances.get(name)
  if (!inst) {
    inst = new GuaibaoDB(name)
    instances.set(name, inst)
  }
  return inst
}

/** 把 `db` 指向另一個孩子的資料庫 */
export function setActiveDb(name: string): void {
  activeName = name
}

export function activeDbName(): string {
  return activeName
}

/** 關閉並刪除一個孩子的資料庫（家長刪除孩子時用） */
export async function deleteDb(name: string): Promise<void> {
  const inst = instances.get(name)
  if (inst) {
    inst.close()
    instances.delete(name)
  }
  await Dexie.delete(name)
}

export const db: GuaibaoDB = new Proxy({} as GuaibaoDB, {
  get(_t, prop) {
    const target = getDb()
    const v = Reflect.get(target, prop, target)
    // 方法綁回真正的實例；Dexie 的 on（事件物件）不能綁
    return typeof v === 'function' && prop !== 'on' ? v.bind(target) : v
  },
  set(_t, prop, value) {
    const target = getDb()
    return Reflect.set(target, prop, value, target)
  },
  has(_t, prop) {
    return Reflect.has(getDb(), prop)
  },
})
