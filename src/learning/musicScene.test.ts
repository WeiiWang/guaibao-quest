import { describe, expect, it } from 'vitest'
import { musicSceneFor } from './musicScene'
import { HUAGUOSHAN } from './chapter'
import { PLAY_GAME_IDS, TOWN_GAME_IDS } from '../domain/playground'

const LOCKABLE = ['home', 'map', 'stage', 'workshop']
const noon = new Date(2026, 10, 3, 12, 0).getTime()
const late = new Date(2026, 10, 3, 21, 0).getTime()
const base = { locked: false, lockable: LOCKABLE, now: noon }

describe('musicSceneFor：畫面 → 背景音樂場景', () => {
  it('首頁依日夜：白天 home-day、晚上 home-night，PM 預覽強制時段優先', () => {
    expect(musicSceneFor({ name: 'home' }, base)).toBe('home-day')
    expect(musicSceneFor({ name: 'home' }, { ...base, now: late })).toBe('home-night')
    expect(musicSceneFor({ name: 'home' }, { ...base, now: late, todMode: 'day' })).toBe('home-day')
    expect(musicSceneFor({ name: 'home' }, { ...base, todMode: 'night' })).toBe('home-night')
    expect(musicSceneFor({ name: 'home' }, { ...base, todMode: 'dusk' })).toBe('home-day')
  })

  it('地圖、著色與連連看', () => {
    expect(musicSceneFor({ name: 'map' }, base)).toBe('map')
    for (const n of ['coloring', 'paint', 'dots']) expect(musicSceneFor({ name: n }, base)).toBe('paint')
  })

  it('關卡：一般站 stage、每章最後一站（boss）用 boss、章末儀式用 ceremony', () => {
    const boss = HUAGUOSHAN.stations.find((s) => s.kind === 'boss')!
    const normal = HUAGUOSHAN.stations.find((s) => s.kind === 'normal')!
    expect(musicSceneFor({ name: 'stage', chapterId: HUAGUOSHAN.id, station: normal.index }, base)).toBe('stage')
    expect(musicSceneFor({ name: 'stage', chapterId: HUAGUOSHAN.id, station: boss.index }, base)).toBe('boss')
    expect(musicSceneFor({ name: 'stage', chapterId: HUAGUOSHAN.id, station: boss.index, ceremony: true }, base)).toBe('ceremony')
    expect(musicSceneFor({ name: 'stage', chapterId: 'no-such-chapter', station: 1 }, base)).toBe('stage')
  })

  it('其他畫面維持目前那首（undefined）', () => {
    for (const n of ['tasks', 'shop', 'bag', 'parent', 'workshop', 'gallery', 'friends', 'album']) expect(musicSceneFor({ name: n }, base)).toBeUndefined()
  })

  it('v8.5：遊樂場放 playground、快樂小街放 town', () => {
    expect(musicSceneFor({ name: 'playground' }, base)).toBe('playground')
    expect(musicSceneFor({ name: 'town' }, base)).toBe('town')
    // 不看日夜：晚上進去也是同一首
    expect(musicSceneFor({ name: 'playground' }, { ...base, now: late })).toBe('playground')
    expect(musicSceneFor({ name: 'town' }, { ...base, todMode: 'night' })).toBe('town')
  })

  it('v8.5：小遊戲放它所屬地方的那一首；音樂會、學我說話、晚安小屋維持安靜', () => {
    const QUIET = ['music', 'talk', 'bedtime']
    for (const id of PLAY_GAME_IDS) expect(musicSceneFor({ name: 'game', id }, base), id).toBe(QUIET.includes(id) ? null : 'playground')
    for (const id of TOWN_GAME_IDS) expect(musicSceneFor({ name: 'game', id }, base), id).toBe(QUIET.includes(id) ? null : 'town')
    // 17 個遊戲：14 個有音樂（遊樂場 7、小街 7）、3 個安靜
    const all = [...PLAY_GAME_IDS, ...TOWN_GAME_IDS].map((id) => musicSceneFor({ name: 'game', id }, base))
    expect(all).toHaveLength(17)
    expect(all.filter((s) => s === 'playground')).toHaveLength(7)
    expect(all.filter((s) => s === 'town')).toHaveLength(7)
    expect(all.filter((s) => s === null)).toHaveLength(3)
  })

  it('v8.5：只看遊戲的 id（用網址直接進遊戲也對）；不認得的 id 或沒有 id 維持目前那首', () => {
    expect(musicSceneFor({ name: 'game', id: 'bubbles' }, base)).toBe('playground')
    expect(musicSceneFor({ name: 'game', id: 'juice' }, base)).toBe('town')
    expect(musicSceneFor({ name: 'game', id: 'no-such-game' }, base)).toBeUndefined()
    expect(musicSceneFor({ name: 'game' }, base)).toBeUndefined()
  })

  it('v8.5：遊玩時間到，遊樂場、小街和小遊戲都安靜', () => {
    const lockable = [...LOCKABLE, 'playground', 'town', 'game']
    for (const s of [{ name: 'playground' }, { name: 'town' }, { name: 'game', id: 'bubbles' }, { name: 'game', id: 'juice' }]) {
      expect(musicSceneFor(s, { ...base, lockable, locked: true }), JSON.stringify(s)).toBeNull()
    }
  })

  it('遊玩時間到、被鎖住的畫面：安靜（null）；不會被鎖的畫面不受影響', () => {
    expect(musicSceneFor({ name: 'home' }, { ...base, locked: true })).toBeNull()
    expect(musicSceneFor({ name: 'map' }, { ...base, locked: true })).toBeNull()
    expect(musicSceneFor({ name: 'paint' }, { ...base, locked: true })).toBe('paint')
    expect(musicSceneFor({ name: 'tasks' }, { ...base, locked: true })).toBeUndefined()
  })
})
