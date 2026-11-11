import { getTimeOfDay, type TodMode } from '../pet/daynight'
import { getChapter } from './chapter'
import { isPlayGameId, isTownGame } from '../domain/playground'
import type { MusicScene } from './audioEngine'

/** musicSceneFor 需要知道的畫面資訊（不依賴 App 的 Screen 型別，方便單元測試） */
export interface SceneScreen {
  name: string
  chapterId?: string
  station?: number
  ceremony?: boolean
  /** v8.3 遊樂場的玩法 id */
  id?: string
}

/** 這幾個玩法不放背景音樂：音樂會和學我說話要聽得清楚自己的聲音；晚安小屋要安靜（玩法自己唱搖籃曲） */
const QUIET_GAMES: readonly string[] = ['music', 'talk', 'bedtime']

/**
 * 畫面 → 背景音樂場景（純函式）。
 * - 回傳 undefined = 維持目前那首（任務、商店、背包、工坊、家長區等）
 * - 回傳 null = 安靜（遊玩時間到、被鎖住的畫面）
 * - 首頁依日夜：晚上（19:30–07:00）放搖籃曲，其餘放白天那首
 * - 遊樂場、快樂小街各有一首；小遊戲放它所屬地方的那一首（看 id，不看從哪裡進來，用網址直接進遊戲也對）
 */
export function musicSceneFor(screen: SceneScreen, opts: { locked: boolean; lockable: readonly string[]; now: number; todMode?: TodMode | null }): MusicScene | null | undefined {
  if (opts.locked && opts.lockable.includes(screen.name)) return null
  switch (screen.name) {
    case 'home':
      return getTimeOfDay(opts.now, opts.todMode) === 'night' ? 'home-night' : 'home-day'
    case 'map':
      return 'map'
    case 'stage': {
      if (screen.ceremony) return 'ceremony'
      const kind = screen.chapterId ? getChapter(screen.chapterId)?.stations[(screen.station ?? 1) - 1]?.kind : undefined
      return kind === 'boss' ? 'boss' : 'stage'
    }
    case 'coloring':
    case 'paint':
    case 'dots':
      return 'paint'
    case 'playground':
      return 'playground'
    case 'town':
      return 'town'
    case 'game': {
      const id = screen.id
      if (id === undefined || !isPlayGameId(id)) return undefined // 不認得的 id：畫面自己會擋，音樂不動
      if (QUIET_GAMES.includes(id)) return null
      return isTownGame(id) ? 'town' : 'playground'
    }
    default:
      return undefined
  }
}
