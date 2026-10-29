import { useEffect, useRef, useState, type ReactNode } from 'react'
import { repo } from '../../db/repo'
import { now as clockNow } from '../../domain/clock'
import { localDateStr } from '../../domain/date'
import { FRIEND_BY_ID } from '../../domain/friends'
import { guestArriveLine, placedBaseIds, WISH_BY_ID, wishPlaced } from '../../domain/play74'
import type { Pet, Placement, Settings } from '../../domain/types'
import { learningSettingsOf } from '../../learning/playtime'
import { wishDoneKey, wishKey } from '../../learning/playLines'
import { playSfx } from '../../learning/sfx'
import { say, sayEnglish, sayText } from '../../learning/speech'
import { sendPetCommand } from '../../pet/bus'
import type { Screen } from '../App'
import { GuestGiftCard } from './GuestGiftCard'
import type { GuestView } from './GuestFriend'
import type { WishView } from './WishBubble'

/** 實現願望後，阿悟演完一段、回憶卡跳出來之前等多久（ms） */
export const WISH_SCENE_MS = 4200
/** 回憶卡之後，下一個願望的泡泡再出現前等多久（ms；只是讓畫面喘口氣，不是倒數） */
export const WISH_NEXT_GAP_MS = 6000

/** 房間現在是不是在佈置模式（RoomView 的 edit 是它自己的狀態，這裡從外框的 class 讀；佈置中不演、不唸） */
function useRoomEditing(on: boolean): boolean {
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!on) return
    const read = () => setEditing(!!document.querySelector('.room-frame.editing'))
    read()
    const id = window.setInterval(read, 300)
    return () => window.clearInterval(id)
  }, [on])
  return editing
}

interface Params {
  pet: Pet | undefined
  settings: Settings | undefined
  placements: Placement[] | undefined
  now: number
  go: (s: Screen['name'] | Screen) => void
}

/**
 * v7.4 線 K：朋友來作客與阿悟的小願望，首頁這一側的全部邏輯。
 * 回傳 roomProps（直接展開給 RoomView）、overlay（禮物卡，放在首頁最上層）與 editing（房間現在是不是在佈置模式）。
 * - 每天第一次進首頁（跨日也算）：決定今天的訪客、決定現在的願望
 * - 願望的家具擺進房間、離開佈置模式後：阿悟演一段、說一句、送回憶卡、輪到下一個
 */
export function usePlay74({ pet, settings, placements, now, go }: Params): { roomProps: { guest: GuestView | null; wish: WishView | null }; overlay: ReactNode; editing: boolean } {
  const today = localDateStr(now)
  const ready = !!pet && !!settings
  const { voiceOn, soundOn } = learningSettingsOf(settings)
  const stage = pet?.stage
  const editing = useRoomEditing(ready)

  // 每天第一次進首頁：訪客與願望（蛋孵出來後願望才開始）
  useEffect(() => {
    if (!ready) return
    void (async () => {
      await repo.syncGuest(now)
      await repo.syncWish()
    })()
    // now 每 15 秒變一次；只在日期或階段變動時重新檢查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, today, stage])

  // ---------- K1 朋友來作客 ----------
  const visit = settings?.play?.guest?.date === today ? settings.play.guest : undefined
  const friend = visit ? FRIEND_BY_ID[visit.friendId] : undefined
  const [giftOpen, setGiftOpen] = useState(false)

  // 「今天 XX 來玩囉！」：朋友出現後說一次（佈置中不說；語音關閉也算說過；同一天再進首頁不重複）
  const greetName = visit && !visit.greeted ? friend?.name : undefined
  useEffect(() => {
    if (!greetName || editing || !ready) return
    const t = window.setTimeout(() => {
      sayText(guestArriveLine(greetName), { enabled: voiceOn })
      void repo.markGuest('greeted')
    }, 1300)
    return () => window.clearTimeout(t)
  }, [greetName, editing, ready, voiceOn])

  const guest: GuestView | null =
    visit && friend?.art
      ? {
          id: friend.id,
          name: friend.name,
          art: friend.art,
          hasGift: !!visit.gift && !visit.seen,
          onTap: () => {
            sayText(friend.name, { enabled: voiceOn, onEnd: friend.en ? () => sayEnglish(friend.en as string, { enabled: voiceOn }) : undefined })
            if (visit.gift && !visit.seen) setGiftOpen(true)
          },
        }
      : null

  // ---------- K2 阿悟的小願望 ----------
  const wishId = settings?.play?.wishActive
  const wishDef = wishId ? WISH_BY_ID[wishId] : undefined
  const placed = placedBaseIds((placements ?? []).map((p) => p.itemId))
  const fulfilled = !!wishDef && wishPlaced(wishDef, placed)
  const [hold, setHold] = useState(false)
  const holdTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(holdTimer.current), [])

  // 願望第一次出現時，阿悟自己說一次（之後只有點泡泡才說）
  const said = settings?.play?.wishSaid
  useEffect(() => {
    if (!wishDef || fulfilled || editing || stage === 'egg' || hold || said === wishDef.id || !ready) return
    const t = window.setTimeout(() => {
      say(wishKey(wishDef.id), wishDef.line, { enabled: voiceOn })
      void repo.markWishSaid(wishDef.id)
    }, 2200)
    return () => window.clearTimeout(t)
  }, [wishDef, fulfilled, editing, stage, hold, said, ready, voiceOn])

  // 願望實現：家具擺好、離開佈置模式後，阿悟演一段、說話；過一會兒回憶卡跳出來、輪到下一個願望
  const running = useRef<string | null>(null)
  useEffect(() => {
    if (!wishDef || !fulfilled || editing || !ready) return
    const id = wishDef.id
    if (running.current === id) return
    running.current = id
    let completed = false
    const t0 = window.setTimeout(() => {
      sendPetCommand(wishDef.act)
      playSfx('reward', soundOn)
      say(wishDoneKey(id), wishDef.doneLine, { enabled: voiceOn })
    }, 500)
    const t1 = window.setTimeout(async () => {
      if (wishDef.act === 'sleep') sendPetCommand('wake')
      completed = true
      await repo.completeWish(id, clockNow())
      setHold(true)
      window.clearTimeout(holdTimer.current)
      holdTimer.current = window.setTimeout(() => setHold(false), WISH_NEXT_GAP_MS)
    }, WISH_SCENE_MS)
    return () => {
      window.clearTimeout(t0)
      window.clearTimeout(t1)
      if (!completed && running.current === id) running.current = null
    }
  }, [wishDef, fulfilled, editing, ready, soundOn, voiceOn])

  const wish: WishView | null =
    wishDef && !fulfilled && !hold && stage !== 'egg'
      ? {
          id: wishDef.id,
          items: wishDef.items,
          line: wishDef.line,
          onTap: () => {
            say(wishKey(wishDef.id), wishDef.line, { enabled: voiceOn })
            go({ name: 'workshop', wish: wishDef.id })
          },
        }
      : null

  const overlay =
    giftOpen && visit?.gift ? (
      <GuestGiftCard
        friendId={visit.friendId}
        gift={visit.gift}
        voiceOn={voiceOn}
        onClose={() => {
          setGiftOpen(false)
          void repo.markGuest('seen')
        }}
        onGo={() => {
          setGiftOpen(false)
          void repo.markGuest('seen')
          const g = visit.gift
          if (g && g.kind !== 'food') go(g.kind === 'dots' ? { name: 'dots', pageId: g.id } : { name: 'paint', pageId: g.id })
        }}
      />
    ) : null

  return { roomProps: { guest, wish }, overlay, editing }
}
