import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { setActiveDb } from '../db/db'
import { Onboarding } from '../ui/screens/Onboarding'
import { ChildPicker } from './ChildPicker'
import { ProfileContext } from './context'
import { profiles } from './manager'
import { registry, type ChildProfile } from './registry'

/**
 * 啟動閘門：先升級名冊（舊玩家 → 第一個孩子），再決定要顯示什麼：
 * - 沒有孩子 → 全新安裝的 onboarding（設 PIN、名字、寵物）
 * - 1 個孩子 → 直接進去玩
 * - 2 個以上 → 選孩子畫面
 * 切換孩子一律「先卸載舊畫面 → 再切資料庫 → 再掛載新畫面」，舊畫面收尾寫入時資料庫還是它自己的。
 */
export function ProfileGate({ children: renderChild }: { children: (child: ChildProfile) => ReactNode }) {
  const [booted, setBooted] = useState(false)
  useEffect(() => {
    let off = false
    void profiles.bootstrap().then(() => !off && setBooted(true))
    return () => {
      off = true
    }
  }, [])
  if (!booted) return <div className="splash">載入中…</div>
  return <ProfileRouter renderChild={renderChild} />
}

function ProfileRouter({ renderChild }: { renderChild: (child: ChildProfile) => ReactNode }) {
  const list = useLiveQuery(() => registry.list(), [])
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [mountedId, setMountedId] = useState<string | null>(null)
  const waiters = useRef<(() => void)[]>([])
  const mountedRef = useRef<string | null>(null)

  // 只有 1 個孩子就直接進去；2 個以上要選
  const wantedId = !list ? null : list.length === 1 ? list[0].id : list.some((c) => c.id === pickedId) ? pickedId : null

  useEffect(() => {
    mountedRef.current = mountedId
    if (mountedId === null) waiters.current.splice(0).forEach((f) => f())
  }, [mountedId])

  useEffect(() => {
    if (!list || mountedId === wantedId) return
    if (mountedId !== null) {
      setMountedId(null) // 先卸載舊孩子
      return
    }
    const c = list.find((x) => x.id === wantedId)
    if (!c) return
    let cancelled = false
    void profiles
      .syncChild(c.id)
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return
        setActiveDb(c.dbName)
        setPickedId(c.id) // 之後孩子變多（家長新增）時，正在玩的孩子不會被踢回選擇畫面
        setMountedId(c.id)
      })
    return () => {
      cancelled = true
    }
  }, [list, wantedId, mountedId])

  const switchPerson = useCallback(() => setPickedId(null), [])
  const leave = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (mountedRef.current === null) return resolve()
        waiters.current.push(resolve)
        setPickedId(null)
      }),
    [],
  )

  if (!list) return <div className="splash">載入中…</div>
  if (list.length === 0) {
    return (
      <Onboarding
        withPin
        onFinish={(i) => profiles.setupFirstChild({ pin: i.pin ?? '', childName: i.childName, petName: i.petName })}
      />
    )
  }
  const mounted = list.find((c) => c.id === mountedId)
  if (mounted) {
    return (
      <ProfileContext.Provider value={{ children: list, activeId: mounted.id, switchPerson, leave }}>
        {renderChild(mounted)}
      </ProfileContext.Provider>
    )
  }
  if (wantedId === null) {
    return (
      <ChildPicker
        list={list}
        onPick={(c) => {
          void registry.setLastActiveId(c.id)
          setPickedId(c.id)
        }}
      />
    )
  }
  return <div className="splash">載入中…</div>
}
