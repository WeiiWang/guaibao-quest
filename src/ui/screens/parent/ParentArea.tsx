import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activeDbName, setActiveDb } from '../../../db/db'
import { registry, type ChildProfile } from '../../../profiles/registry'
import { useProfiles } from '../../../profiles/context'
import { childColorOf } from '../../../domain/home7'
import { sayText } from '../../../learning/speech'
import { ViewedChildContext } from './ViewedChild'
import './parent7.css'
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
import { WeeklyTab } from './WeeklyTab'
import { DailyTip } from './DailyTip'
import { PM_TOOLS_ENABLED } from '../../../db/pm'

type Tab = 'review' | 'weekly' | 'points' | 'tasks' | 'ledger' | 'learning' | 'playtime' | 'audio' | 'plan' | 'settings' | 'pm'
const TABS: { id: Tab; label: string }[] = [
  { id: 'review', label: '審核' },
  { id: 'weekly', label: '本週' },
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

/** 家長區頂端的孩子切換：每個孩子一顆頭像 chip（≥56px），點一下就看他的資料 */
function ChildChips({ list, viewId, onPick }: { list: ChildProfile[]; viewId: string | null; onPick: (c: ChildProfile) => void }) {
  if (list.length < 2) return null
  return (
    <div className="h7-chips" role="radiogroup" aria-label="看哪個孩子" data-testid="child-chips">
      {list.map((c) => {
        const col = childColorOf(c.order)
        const on = c.id === viewId
        return (
          <button
            key={c.id}
            role="radio"
            aria-checked={on}
            className={`h7-chip ${on ? 'on' : ''}`}
            data-testid="child-chip"
            data-child-id={c.id}
            style={{ ['--chip-bg' as string]: col.bg, ['--chip-deep' as string]: col.deep }}
            onClick={() => onPick(c)}
          >
            <span className="h7-chip-avatar" aria-hidden>{c.avatar}</span>
            <span className="h7-chip-name">{c.name}</span>
          </button>
        )
      })}
    </div>
  )
}

export function ParentArea({ onExit: onExitRaw }: { onExit: () => void }) {
  const ctx = useProfiles()
  const list = useLiveQuery(() => registry.list(), [])
  // 進來時正在玩的孩子的資料庫：離開家長區（不管用哪種方式）一定要切回去，回到首頁才不會讀到別人的資料
  const home = useRef(activeDbName())
  const [viewId, setViewId] = useState<string | null>(ctx?.activeId ?? null)
  const restore = () => setActiveDb(home.current)
  useEffect(() => restore, [])
  const onExit = () => {
    restore()
    onExitRaw()
  }
  const pickChild = (c: ChildProfile) => {
    if (c.id === viewId) return
    setActiveDb(c.dbName)
    setViewId(c.id)
    sayText(c.name)
  }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked])

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
    <ViewedChildContext.Provider value={{ id: viewId }}>
    <main className="screen parent theme-butter">
      <header className="screen-header">
        <button className="btn primary back" onClick={onExit}>回到小孩模式</button>
        <h1>家長專區</h1>
        <div className="header-right" />
      </header>
      <DailyTip key={`tip-${viewId ?? 'me'}`} />
      <ChildChips list={list ?? []} viewId={viewId} onPick={pickChild} />
      <div className="tabs parent-tabs h7-ptabs" role="tablist" data-testid="parent-tabs">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {/* key = 孩子：切換孩子時整個分頁內容重新掛載，讀新孩子的資料庫 */}
      <div key={`body-${viewId ?? 'me'}`} className="h7-ptab-body" data-testid="parent-body" data-view-child={viewId ?? undefined}>
      {tab === 'review' && <ReviewTab />}
      {tab === 'weekly' && <WeeklyTab />}
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
      </div>
    </main>
    </ViewedChildContext.Provider>
  )
}
