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

  constructor(name = 'guaibao-quest') {
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

export const db = new GuaibaoDB()
