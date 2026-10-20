// 日夜作息（SPEC-v3 A5）：用裝置本地時間判斷時段與睡覺。純函式，時間由呼叫端注入。

export type TimeOfDay = 'day' | 'dusk' | 'night'
/** PM 預覽可強制指定時段；'auto' = 跟隨真實時間 */
export type TodMode = TimeOfDay | 'auto'

export const TOD_MODES: readonly TodMode[] = ['auto', 'day', 'dusk', 'night']
export const isTodMode = (v: unknown): v is TodMode => typeof v === 'string' && (TOD_MODES as readonly string[]).includes(v)

/** 一天中的分鐘數（本地時間） */
export const DAY_START_MIN = 7 * 60
export const DUSK_START_MIN = 18 * 60
export const NIGHT_START_MIN = 19 * 60 + 30
/** 20:30 以後阿悟睡覺，到早上 07:00 起床 */
export const SLEEP_START_MIN = 20 * 60 + 30

const minuteOfDay = (now: number) => {
  const d = new Date(now)
  return d.getHours() * 60 + d.getMinutes()
}

/** 白天 07:00–18:00、傍晚 18:00–19:30、晚上 19:30–07:00；override 給時段就直接用那個（'auto' 或空值 = 看時間） */
export function getTimeOfDay(now: number, override?: TodMode | null): TimeOfDay {
  if (override && override !== 'auto') return override
  const m = minuteOfDay(now)
  if (m >= DAY_START_MIN && m < DUSK_START_MIN) return 'day'
  if (m >= DUSK_START_MIN && m < NIGHT_START_MIN) return 'dusk'
  return 'night'
}

/** 該不該睡：強制「晚上」就睡（方便 PM 看）；強制白天/傍晚不睡；跟隨時間則 20:30–07:00 睡 */
export function isSleepTime(now: number, override?: TodMode | null): boolean {
  if (override && override !== 'auto') return override === 'night'
  const m = minuteOfDay(now)
  return m >= SLEEP_START_MIN || m < DAY_START_MIN
}
