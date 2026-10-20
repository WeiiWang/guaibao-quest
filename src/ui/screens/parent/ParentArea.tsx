import { useEffect, useRef, useState } from 'react'
import { repo } from '../../../db/repo'
import { PARENT_IDLE_MS, PIN_LOCK_MS, PIN_MAX_FAILS } from '../../../domain/constants'
import { PinPad } from '../../components/PinPad'
import { ReviewTab } from './ReviewTab'
import { PointsTab } from './PointsTab'
import { TemplatesTab } from './TemplatesTab'
import { LedgerTab } from './LedgerTab'
import { SettingsTab } from './SettingsTab'
import { LearningTab } from './LearningTab'
import { PlayTimeTab } from './PlayTimeTab'
import { AudioTab } from './AudioTab'
import { SubscriptionTab } from './SubscriptionTab'
import { TaskLimitNote } from './TaskLimitNote'
import { PmTab } from './PmTab'
import { PM_TOOLS_ENABLED } from '../../../db/pm'

type Tab = 'review' | 'points' | 'tasks' | 'ledger' | 'learning' | 'playtime' | 'audio' | 'plan' | 'settings' | 'pm'
const TABS: { id: Tab; label: string }[] = [
  { id: 'review', label: '審核' },
  { id: 'points', label: '加/扣點' },
  { id: 'tasks', label: '任務管理' },
  { id: 'ledger', label: '點數紀錄' },
  { id: 'learning', label: '學習報告' },
  { id: 'playtime', label: '遊玩時間' },
  { id: 'audio', label: '音效/語音' },
  { id: 'plan', label: '訂閱方案' },
  { id: 'settings', label: '設定' },
  ...(PM_TOOLS_ENABLED ? [{ id: 'pm' as const, label: 'PM 預覽' }] : []),
]

// 輸入錯誤次數放在模組層，離開再進入也不會歸零
let fails = 0
let lockedUntil = 0

export function ParentArea({ onExit }: { onExit: () => void }) {
  const [unlocked, setUnlocked] = useState(false)
  const [tab, setTab] = useState<Tab>('review')
  const [lockMsg, setLockMsg] = useState('')
  const idleTimer = useRef<number | undefined>(undefined)

  // 家長模式 5 分鐘無操作自動回小孩端
  useEffect(() => {
    if (!unlocked) return
    const reset = () => {
      window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(onExit, PARENT_IDLE_MS)
    }
    reset()
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const
    evs.forEach((e) => window.addEventListener(e, reset))
    return () => {
      window.clearTimeout(idleTimer.current)
      evs.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [unlocked, onExit])

  if (!unlocked) {
    const tryPin = async (pin: string): Promise<string | void> => {
      const t = Date.now()
      if (t < lockedUntil) {
        const s = Math.ceil((lockedUntil - t) / 1000)
        setLockMsg(`輸入錯太多次，請 ${s} 秒後再試`)
        return `請 ${s} 秒後再試`
      }
      if (await repo.verifyPin(pin)) {
        fails = 0
        setUnlocked(true)
        return
      }
      fails += 1
      if (fails >= PIN_MAX_FAILS) {
        fails = 0
        lockedUntil = Date.now() + PIN_LOCK_MS
        setLockMsg(`輸入錯太多次，請 ${PIN_LOCK_MS / 1000} 秒後再試`)
        return 'PIN 不正確'
      }
      setLockMsg('')
      return 'PIN 不正確'
    }
    return (
      <main className="onboarding theme-cream">
        <div className="card onboard-card">
          <h1>家長專區</h1>
          <PinPad label="請輸入家長 PIN" onComplete={tryPin} />
          {lockMsg && <p className="form-error">{lockMsg}</p>}
          <button className="btn" onClick={onExit}>回到小孩模式</button>
        </div>
      </main>
    )
  }

  return (
    <main className="screen parent theme-butter">
      <header className="screen-header">
        <button className="btn primary back" onClick={onExit}>回到小孩模式</button>
        <h1>家長專區</h1>
        <div className="header-right" />
      </header>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'review' && <ReviewTab />}
      {tab === 'points' && <PointsTab />}
      {tab === 'tasks' && (
        <>
          <TaskLimitNote />
          <TemplatesTab />
        </>
      )}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'learning' && <LearningTab />}
      {tab === 'playtime' && <PlayTimeTab />}
      {tab === 'audio' && <AudioTab />}
      {tab === 'plan' && <SubscriptionTab />}
      {tab === 'settings' && <SettingsTab onReset={onExit} />}
      {tab === 'pm' && <PmTab onExit={onExit} />}
    </main>
  )
}
