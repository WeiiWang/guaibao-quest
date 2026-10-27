// PM 預覽 ↔ 房間 的簡單指令匯流排（SPEC-v3 A7）。
// PM 分頁在家長區，房間（RoomView）要回首頁才存在，所以指令存進 localStorage 排隊，
// 房間掛載時一次取出執行；房間已經在的話也可以靠事件立即執行。
import { isTodMode, type TodMode } from './daynight'

export type PetCommand =
  | 'sing'
  | 'dance'
  | 'walk'
  | 'sneeze'
  | 'yawn'
  | 'gaze'
  | 'wave'
  | 'rubTummy'
  | 'pinchNose'
  | 'poop'
  | 'sleep'
  | 'wake'
  // v5：新招（PM 預覽用；trickAll = 依序表演每一招）
  | 'trick:count'
  | 'trick:tidy'
  | 'trick:rhythm'
  | 'trick:hello'
  | 'trick:flip'
  | 'trick:all'

export const PET_COMMANDS: readonly PetCommand[] = ['sing', 'dance', 'walk', 'sneeze', 'yawn', 'gaze', 'wave', 'rubTummy', 'pinchNose', 'poop', 'sleep', 'wake', 'trick:count', 'trick:tidy', 'trick:rhythm', 'trick:hello', 'trick:flip', 'trick:all']

const CMD_KEY = 'gq-pet-cmds'
const TOD_KEY = 'gq-pet-tod'
const FAST_KEY = 'gq-pet-fast'
export const CMD_EVENT = 'gq-pet-cmd'
export const TOD_EVENT = 'gq-pet-tod'
/** 排隊超過這麼久的指令視為過期（避免很久以前的指令突然在孩子面前執行） */
export const CMD_MAX_AGE_MS = 5 * 60 * 1000

export interface StorageLike {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

interface Queued {
  cmd: PetCommand
  at: number
}

const isCommand = (v: unknown): v is PetCommand => typeof v === 'string' && (PET_COMMANDS as readonly string[]).includes(v)

function readQueue(s: StorageLike): Queued[] {
  try {
    const raw = s.getItem(CMD_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr.filter((q): q is Queued => !!q && isCommand((q as Queued).cmd) && Number.isFinite((q as Queued).at))
  } catch {
    return []
  }
}

/** PM 端：把指令排進佇列，並通知已掛載的房間 */
export function sendPetCommand(cmd: PetCommand, now = Date.now(), storage: StorageLike | null = defaultStorage()): void {
  if (storage) {
    try {
      storage.setItem(CMD_KEY, JSON.stringify([...readQueue(storage), { cmd, at: now }].slice(-20)))
    } catch {
      /* 沒有 localStorage 就只靠事件 */
    }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CMD_EVENT))
}

/** 房間端：取出（並清掉）未過期的指令，依先後順序 */
export function drainPetCommands(now = Date.now(), storage: StorageLike | null = defaultStorage()): PetCommand[] {
  if (!storage) return []
  const q = readQueue(storage)
  try {
    storage.removeItem(CMD_KEY)
  } catch {
    /* ignore */
  }
  return q.filter((x) => now - x.at <= CMD_MAX_AGE_MS && now >= x.at - 1000).map((x) => x.cmd)
}

export function getTodMode(storage: StorageLike | null = defaultStorage()): TodMode {
  try {
    const v = storage?.getItem(TOD_KEY)
    return isTodMode(v) ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function setTodMode(mode: TodMode, storage: StorageLike | null = defaultStorage()): void {
  try {
    if (mode === 'auto') storage?.removeItem(TOD_KEY)
    else storage?.setItem(TOD_KEY, mode)
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TOD_EVENT))
}

/** PM 測試用：自主行為排程加速（2–4 秒一次） */
export function getFastSchedule(storage: StorageLike | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(FAST_KEY) === '1'
  } catch {
    return false
  }
}

export function setFastSchedule(on: boolean, storage: StorageLike | null = defaultStorage()): void {
  try {
    if (on) storage?.setItem(FAST_KEY, '1')
    else storage?.removeItem(FAST_KEY)
  } catch {
    /* ignore */
  }
}
