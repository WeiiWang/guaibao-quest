import { describe, expect, it } from 'vitest'
import { FOOD_IDS } from './constants'
import { PLAY_DAILY_CAP, PLAY_GAME_IDS, PLAY_GAMES, TOWN_GAME_IDS, TOWN_GAMES, isPlayGameId, isTownGame, playRewardFood, settlePlayGame } from './playground'

describe('遊樂場獎勵', () => {
  const D = '2026-11-04'
  it('每個玩法都有清單資料', () => {
    expect(PLAY_GAMES.map((g) => g.id).sort()).toEqual([...PLAY_GAME_IDS].sort())
    expect(isPlayGameId('bubbles')).toBe(true)
    expect(isPlayGameId('nope')).toBe(false)
  })
  it('小鎮 8 個地方也是玩法，和遊樂場共用每日上限', () => {
    expect(TOWN_GAMES.map((g) => g.id).sort()).toEqual([...TOWN_GAME_IDS].sort())
    expect(isPlayGameId('doctor')).toBe(true)
    expect(isTownGame('doctor')).toBe(true)
    expect(isTownGame('bubbles')).toBe(false)
    let daily
    const got = []
    for (const id of ['bubbles', 'doctor', 'market', 'photo'] as const) {
      const r = settlePlayGame(daily, D, id)
      daily = r.daily
      got.push(r.foodId)
    }
    expect(got.filter(Boolean)).toHaveLength(PLAY_DAILY_CAP)
  })
  it('食物依日期固定、會輪替', () => {
    expect(playRewardFood(D, 0)).toBe(playRewardFood(D, 0))
    expect(playRewardFood(D, 0)).not.toBe(playRewardFood(D, 1))
    expect(FOOD_IDS).toContain(playRewardFood('2031-02-28', 2))
  })
  it('同一個玩法一天只送一次', () => {
    const a = settlePlayGame(undefined, D, 'bubbles')
    expect(a.foodId).toBe(playRewardFood(D, 0))
    expect(settlePlayGame(a.daily, D, 'bubbles').foodId).toBeNull()
  })
  it('一天最多送 PLAY_DAILY_CAP 份', () => {
    let daily
    const got = []
    for (const id of ['bubbles', 'hide', 'catch', 'memory', 'music'] as const) {
      const r = settlePlayGame(daily, D, id)
      daily = r.daily
      got.push(r.foodId)
    }
    expect(got.filter(Boolean)).toHaveLength(PLAY_DAILY_CAP)
  })
  it('換日重算', () => {
    const a = settlePlayGame(undefined, D, 'bubbles')
    expect(settlePlayGame(a.daily, '2026-11-05', 'bubbles').foodId).not.toBeNull()
  })
  it('學我說話和小菜園不走這個獎勵', () => {
    expect(settlePlayGame(undefined, D, 'talk').foodId).toBeNull()
    expect(settlePlayGame(undefined, D, 'garden').foodId).toBeNull()
  })
})
