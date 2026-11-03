import { describe, expect, it } from 'vitest'
import { musicSceneFor } from './musicScene'
import { HUAGUOSHAN } from './chapter'

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

  it('遊玩時間到、被鎖住的畫面：安靜（null）；不會被鎖的畫面不受影響', () => {
    expect(musicSceneFor({ name: 'home' }, { ...base, locked: true })).toBeNull()
    expect(musicSceneFor({ name: 'map' }, { ...base, locked: true })).toBeNull()
    expect(musicSceneFor({ name: 'paint' }, { ...base, locked: true })).toBe('paint')
    expect(musicSceneFor({ name: 'tasks' }, { ...base, locked: true })).toBeUndefined()
  })
})
