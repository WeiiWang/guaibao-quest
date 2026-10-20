import { HOUR_MS } from './domain/constants'
import { shiftClock } from './domain/clock'

declare global {
  interface Window {
    __debug?: { advanceHours(n: number): void; advanceDays(n: number): void }
  }
}

/** 僅 dev 模式：讓 now() 往後偏移（持久化於 localStorage），驗收跨日與飢餓衰減用 */
export function installDebug(): void {
  window.__debug = {
    advanceHours: (n) => shiftClock(n * HOUR_MS),
    advanceDays: (n) => shiftClock(n * 24 * HOUR_MS),
  }
}
