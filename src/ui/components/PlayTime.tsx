import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repo } from '../../db/repo'
import { now as clockNow } from '../../domain/clock'
import { PIN_LOCK_MS, PIN_MAX_FAILS } from '../../domain/constants'
import { localDateStr } from '../../domain/date'
import { EXTEND_MINUTES } from '../../learning/playtime'
import { say, sayText } from '../../learning/speech'
import { playPetSound } from '../../pet/sounds'
import { TIME_WARN_LINE } from '../../domain/giftLines'
import { pickLine } from '../../learning/lines'
import { useNow } from '../hooks'
import { useLearningSettings } from '../learningHooks'
import { Companion } from '../screens/adventure/Companion'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { PinPad } from './PinPad'
import type { Screen } from '../App'
import './lock.css'
import '../meta.css'

const TICK_MS = 1000
const FLUSH_EVERY_S = 5

/**
 * 每日遊玩計時（不畫任何東西）。
 * - 只在畫面可見（前景）且 counting 為真時累計；家長區、鎖定中、分頁在背景都不算
 * - 每 5 秒寫入一次 playTime；離開/切到背景時補寫
 * - 到上限（含家長延長）時通知 onLocked(true)；家長延長或調高上限後自動解除
 */
/** 剩下這麼多秒時，阿悟打哈欠提醒「再玩一下下就要睡覺囉」（每天只提醒一次） */
export const TIME_WARN_SECONDS = 120
const warnKey = (date: string) => `gq-timewarn:${date}`

export function PlayTimeWatcher({ counting, onLocked }: { counting: boolean; onLocked: (locked: boolean) => void }) {
  const { dailyLimitMin, soundOn, voiceOn } = useLearningSettings()
  const [warn, setWarn] = useState<'in' | 'out' | null>(null)
  const warnedFor = useRef<string | null>(null)
  const prefs = useRef({ soundOn, voiceOn })
  useEffect(() => {
    prefs.current = { soundOn, voiceOn }
  }, [soundOn, voiceOn])
  const warnTimers = useRef<number[]>([])
  useEffect(() => {
    const timers = warnTimers.current
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [])
  const date = localDateStr(useNow())
  const row = useLiveQuery(() => db.playTime.get(date).then((r) => r ?? null), [date])
  const bonus = row?.bonusSeconds ?? 0

  const used = useRef(0) // 今天已累計秒數（含尚未寫入的）
  const pending = useRef(0)
  const dateRef = useRef(date)
  const loadedFor = useRef<string | null>(null)
  const countingRef = useRef(counting)
  const lockedRef = useRef(false)
  const limitRef = useRef({ limit: dailyLimitMin, bonus })

  useEffect(() => {
    countingRef.current = counting
  }, [counting])

  const evaluate = () => {
    const { limit, bonus: b } = limitRef.current
    const locked = limit > 0 && used.current >= limit * 60 + b
    if (locked !== lockedRef.current) {
      lockedRef.current = locked
      onLocked(locked)
    }
  }

  /** 剩 2 分鐘：阿悟打哈欠提醒一次（每天一次，存在 localStorage，重新整理也不會再提醒） */
  const maybeWarn = () => {
    const { limit, bonus: b } = limitRef.current
    if (limit <= 0 || lockedRef.current || warnedFor.current === dateRef.current) return
    const left = limit * 60 + b - used.current
    if (left > TIME_WARN_SECONDS || left <= 0) return
    warnedFor.current = dateRef.current
    try {
      if (localStorage.getItem(warnKey(dateRef.current))) return
      localStorage.setItem(warnKey(dateRef.current), '1')
    } catch {
      /* 沒有 localStorage：只靠這次執行期間的記號 */
    }
    setWarn('in')
    warnTimers.current.push(window.setTimeout(() => setWarn('out'), 5500), window.setTimeout(() => setWarn(null), 6100))
    playPetSound('yawn', prefs.current.soundOn)
    sayText(TIME_WARN_LINE, { enabled: prefs.current.voiceOn })
  }

  // 資料庫的值只用來初始化（換日或第一次載入）；之後以本地累計為準
  useEffect(() => {
    limitRef.current = { limit: dailyLimitMin, bonus }
    if (row !== undefined && loadedFor.current !== date) {
      loadedFor.current = date
      used.current = Math.max(used.current, row?.seconds ?? 0)
      pending.current = 0
    }
    evaluate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, dailyLimitMin, bonus, date])

  useEffect(() => {
    let last = performance.now()
    const flush = () => {
      const s = pending.current
      if (s >= 1) {
        pending.current = 0
        void repo.addPlayTime(dateRef.current, s)
      }
    }
    const id = window.setInterval(() => {
      const t = performance.now()
      const dt = Math.min(t - last, 5000) / 1000 // 睡眠/卡頓造成的大跳躍不算
      last = t
      const d = localDateStr(clockNow())
      if (d !== dateRef.current) {
        flush()
        dateRef.current = d
        used.current = 0
        loadedFor.current = null
      }
      if (document.visibilityState === 'visible' && countingRef.current && !lockedRef.current && loadedFor.current === dateRef.current) {
        used.current += dt
        pending.current += dt
        if (pending.current >= FLUSH_EVERY_S) flush()
        evaluate()
        maybeWarn()
      }
    }, TICK_MS)
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
      last = performance.now()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!warn) return null
  return (
    <div className={`time-warn ${warn === 'out' ? 'out' : ''}`} data-testid="time-warn" role="status">
      <Companion pose="sleepy" size={104} />
      <div className="time-warn-bubble">{TIME_WARN_LINE}</div>
    </div>
  )
}

// 鎖定畫面上輸入錯誤 PIN 的次數（模組層，離開再進來不歸零）
let fails = 0
let lockedUntil = 0

/** 時間到了的鎖定畫面：阿悟打哈欠；家長 PIN 可延長 10 分鐘 */
export function LockScreen({ go }: { go: (s: Screen['name'] | Screen) => void }) {
  const { voiceOn } = useLearningSettings()
  const [asking, setAsking] = useState(false)
  const said = useRef(false)

  useEffect(() => {
    if (said.current) return
    said.current = true
    say(pickLine('lock.sleepy').key, pickLine('lock.sleepy').text, { enabled: voiceOn })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tryPin = async (pin: string): Promise<string | void> => {
    const t = Date.now()
    if (t < lockedUntil) return `請 ${Math.ceil((lockedUntil - t) / 1000)} 秒後再試`
    const r = await repo.extendPlayTime(pin, localDateStr(clockNow()))
    if (r.ok) {
      fails = 0
      setAsking(false)
      return
    }
    fails += 1
    if (fails >= PIN_MAX_FAILS) {
      fails = 0
      lockedUntil = Date.now() + PIN_LOCK_MS
      return `輸入錯太多次，請 ${PIN_LOCK_MS / 1000} 秒後再試`
    }
    return r.error
  }

  return (
    <main className="lock-screen" data-testid="lock-screen">
      <div className="lock-card">
        <Companion pose="sleepy" size={170} />
        <p className="lock-zzz" aria-hidden>Zzz…</p>
        <h1>我想睡覺了</h1>
        <p className="lock-say">明天再一起冒險吧！</p>
        <p className="lock-sub">今天的遊玩時間用完了，可以先去寫任務、畫畫圖。</p>
        <div className="lock-actions">
          <button className="lock-go" onClick={() => go('tasks')} data-testid="lock-tasks">
            <Icon name="ui-tasks" emoji="📝" size={46} />
            <span>今日任務</span>
          </button>
          <button className="lock-go coloring" onClick={() => go('coloring')} data-testid="lock-coloring">
            <Icon name="ui-coloring" emoji="🎨" size={46} />
            <span>著色本</span>
          </button>
        </div>
        <div className="lock-parent">
          <button className="lock-link" onClick={() => setAsking(true)} data-testid="lock-extend">家長：延長 {EXTEND_MINUTES} 分鐘</button>
          <button className="lock-link" onClick={() => go('parent')}>家長專區</button>
        </div>
      </div>
      {asking && (
        <Modal title="家長 PIN" onClose={() => setAsking(false)}>
          <PinPad label={`輸入 PIN，延長 ${EXTEND_MINUTES} 分鐘`} onComplete={tryPin} />
          <button className="btn" onClick={() => setAsking(false)}>取消</button>
        </Modal>
      )}
    </main>
  )
}
