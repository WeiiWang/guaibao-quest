import { useEffect, useRef, useState } from 'react'
import { repo } from '../../db/repo'
import { now as clockNow } from '../../domain/clock'
import { FESTIVAL_BY_ID, festivalAt, festivalClock, festivalKey, type FestivalNow } from '../../domain/season'
import type { Pet, Settings } from '../../domain/types'
import { learningSettingsOf } from '../../learning/playtime'
import { playSfx } from '../../learning/sfx'
import { sayRecorded } from '../../learning/speech'
import { useRoomEditing } from './usePlay74'

/** 進房間後等一下再演（畫面先站穩） */
export const FESTIVAL_START_MS = 700
/** 寵物說完那一句，再放回憶卡與朋友、願望出來（ms） */
export const FESTIVAL_SHOW_MS = 4000

const DATE_KEY = 'gq-fest-date'

function clockEnv(): { automated: boolean; dev: boolean; override: string | null } {
  let override: string | null = null
  try {
    override = localStorage.getItem(DATE_KEY)
  } catch {
    /* 沒有 localStorage 就沒有覆寫 */
  }
  return { automated: typeof navigator !== 'undefined' && navigator.webdriver === true, dev: import.meta.env.DEV, override }
}

interface Params {
  pet: Pet | undefined
  settings: Settings | undefined
  now: number
  /** 別的演出（慶祝、衣櫃、佈置）進行中：先等一等 */
  blocked: boolean
}

export interface FestivalState {
  /** 給 RoomView：現在要掛什麼；沒有節慶 = null */
  view: { art: string; enter?: boolean; show?: { seq: number; line: string } } | null
  /** 小演出進行中（或馬上要演）：回憶卡、朋友與願望先等 */
  holding: boolean
}

/**
 * 節慶，首頁這一側的全部邏輯：依日期掛上掛飾；這個孩子今年第一次看到時寵物開心地說一句（有錄音才唸）、
 * 第一次遇到這個節慶還會送紀念家具（回憶卡等寵物說完才跳）。沒有倒數、沒有「限定」。
 */
export function useFestival({ pet, settings, now, blocked }: Params): FestivalState {
  const date = festivalClock(now, clockEnv())
  const off = !pet || !settings || settings.festivalOn === false || date === null
  const fest: FestivalNow | null = off ? null : festivalAt(date)
  const key = fest ? festivalKey(fest) : null
  const editing = useRoomEditing(!!fest)
  const hatched = !!pet && pet.stage !== 'egg'
  const due = !!key && hatched && !settings?.festival?.seen?.includes(key)
  const { voiceOn, soundOn } = learningSettingsOf(settings)
  const [show, setShow] = useState<{ seq: number; line: string } | null>(null)
  const seq = useRef(0)
  const wait = blocked || editing

  useEffect(() => {
    if (!due || !fest || wait) return
    const t = window.setTimeout(() => {
      void repo.greetFestival(fest, clockNow()).then((r) => {
        if (!r.first) return
        const line = FESTIVAL_BY_ID[fest.id].line
        seq.current += 1
        setShow({ seq: seq.current, line })
        playSfx('reward', soundOn)
        sayRecorded('pet.fest.', line, { enabled: voiceOn })
      })
    }, FESTIVAL_START_MS)
    return () => window.clearTimeout(t)
    // fest 依 key 決定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, key, wait, soundOn, voiceOn])

  const showSeq = show?.seq
  useEffect(() => {
    if (showSeq === undefined) return
    const t = window.setTimeout(() => setShow(null), FESTIVAL_SHOW_MS)
    return () => window.clearTimeout(t)
  }, [showSeq])

  if (!fest) return { view: null, holding: false }
  const def = FESTIVAL_BY_ID[fest.id]
  // 還沒演的那一下先不掛：演出開始時才從天花板掉下來（等別的演出時照常掛著）
  if (due && !wait) return { view: null, holding: true }
  return { view: { art: def.art, ...(show ? { enter: true, show } : {}) }, holding: !!show || due }
}
