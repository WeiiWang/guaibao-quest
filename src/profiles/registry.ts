// 孩子名冊（registry）：獨立的小資料庫，存「有哪些孩子」與全家共用的家長 PIN。
// 每個孩子的實際進度各自在自己的 GuaibaoDB 裡；這裡只有清單、頭像、年齡與 PIN。
import Dexie, { type Table } from 'dexie'
import type { AgeBand } from '../domain/types'

export const REGISTRY_DB_NAME = 'guaibao-registry'

export interface ChildProfile {
  id: string
  name: string
  /** 沒有寵物圖時用的備用頭像（emoji） */
  avatar: string
  /** 未設定年齡時是 undefined（學習端視為 4–5 歲） */
  ageBand?: AgeBand
  /** 這個孩子的 IndexedDB 名稱：第一個孩子是 `guaibao-quest`，之後是 `guaibao-quest-<id>` */
  dbName: string
  createdAt: number
  /** 選孩子畫面的排序 */
  order: number
}

interface MetaRow {
  key: string
  value: string
}

export class RegistryDB extends Dexie {
  children!: Table<ChildProfile, string>
  meta!: Table<MetaRow, string>

  constructor(name = REGISTRY_DB_NAME) {
    super(name)
    this.version(1).stores({ children: 'id, order', meta: 'key' })
  }
}

/** 共用的家長 PIN 存放處（Repo 透過它驗證與更改 PIN） */
export interface PinStore {
  /** 共用 PIN 的雜湊；還沒有名冊（或沒設）時是 undefined，Repo 退回讀自己資料庫的 settings.pinHash */
  get(): Promise<string | undefined>
  /** 更改共用 PIN；名冊還沒有 PIN 時不寫入（避免測試用的獨立資料庫汙染全域名冊） */
  set(hash: string): Promise<void>
}

export class Registry {
  constructor(readonly db: RegistryDB = new RegistryDB()) {}

  async list(): Promise<ChildProfile[]> {
    return (await this.db.children.toArray()).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  }

  get(id: string): Promise<ChildProfile | undefined> {
    return this.db.children.get(id)
  }

  async pinHash(): Promise<string | undefined> {
    return (await this.db.meta.get('pinHash'))?.value
  }

  async setPinHash(hash: string): Promise<void> {
    await this.db.meta.put({ key: 'pinHash', value: hash })
  }

  /** 上次玩的孩子（選孩子畫面用來標示；不影響是否出現選擇畫面） */
  async lastActiveId(): Promise<string | undefined> {
    return (await this.db.meta.get('activeChildId'))?.value
  }

  async setLastActiveId(id: string): Promise<void> {
    await this.db.meta.put({ key: 'activeChildId', value: id })
  }

  pinStore(): PinStore {
    return {
      get: () => this.pinHash(),
      set: async (hash) => {
        if (await this.pinHash()) await this.setPinHash(hash)
      },
    }
  }
}

export const registry = new Registry()
