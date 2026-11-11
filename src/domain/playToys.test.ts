import { describe, expect, it } from 'vitest'
import { PLAY_GAME_IDS, TOWN_GAME_IDS } from './playground'
import { CROWN_AT, PLAY_TOYS, TOY_AT, countsPlays, isCrowned, playStars, settlePlayCount, toysUnlocked } from './playToys'
import { STATIC_LINES } from '../learning/lines'

describe('v8.5 新玩具：只看玩完幾次', () => {
  it('除了學我說話，每個遊戲都有兩個新玩具', () => {
    for (const id of [...PLAY_GAME_IDS, ...TOWN_GAME_IDS]) {
      if (id === 'talk') expect(PLAY_TOYS[id]).toBeUndefined()
      else expect(PLAY_TOYS[id]).toHaveLength(2)
    }
    expect(countsPlays('talk')).toBe(false)
    expect(countsPlays('garden')).toBe(true)
  })

  it('每個新玩具都有寵物的介紹台詞', () => {
    for (const [game, toys] of Object.entries(PLAY_TOYS)) {
      for (const t of toys) {
        expect(t.line).toBe(`pet.toy.${game}.${t.id}`)
        expect(typeof STATIC_LINES[t.line], t.line).toBe('string')
      }
    }
  })

  it('同一個遊戲的兩個玩具 id 不一樣', () => {
    for (const toys of Object.values(PLAY_TOYS)) expect(toys[0].id).not.toBe(toys[1].id)
  })

  it('玩完 1 次有第一個、3 次有第二個、6 次戴皇冠', () => {
    expect([0, 1, 2, 3, 5, 6, 99].map(toysUnlocked)).toEqual([0, 1, 1, 2, 2, 2, 2])
    expect([0, 1, 2, 3, 5, 6, 99].map(playStars)).toEqual([0, 1, 1, 2, 2, 3, 3])
    expect(isCrowned(CROWN_AT - 1)).toBe(false)
    expect(isCrowned(CROWN_AT)).toBe(true)
  })

  it('舊存檔沒有次數、或次數是壞值：當成 0', () => {
    expect(toysUnlocked(undefined)).toBe(0)
    expect(playStars(Number.NaN)).toBe(0)
    expect(playStars(-3)).toBe(0)
    expect(toysUnlocked(2.9)).toBe(1)
  })

  it('玩完一次：次數加一，剛好到門檻那一次才回傳新玩具', () => {
    let counts: Record<string, number> | undefined
    const got: (string | null)[] = []
    const crowns: boolean[] = []
    for (let i = 0; i < 7; i++) {
      const r = settlePlayCount(counts, 'bubbles')
      counts = r.counts
      got.push(r.toy?.id ?? null)
      crowns.push(r.crowned)
      expect(r.plays).toBe(i + 1)
    }
    expect(got).toEqual(['animals', null, 'wand', null, null, null, null])
    expect(crowns).toEqual([false, false, false, false, false, true, false])
    expect(TOY_AT).toEqual([1, 3])
  })

  it('每個遊戲各算各的', () => {
    const a = settlePlayCount({ bubbles: 2 }, 'catch')
    expect(a.counts).toEqual({ bubbles: 2, catch: 1 })
    expect(a.toy?.id).toBe('gold')
    expect(settlePlayCount(a.counts, 'bubbles').toy?.id).toBe('wand')
  })

  it('學我說話不算次數', () => {
    const r = settlePlayCount({ bubbles: 1 }, 'talk')
    expect(r).toEqual({ counts: { bubbles: 1 }, plays: 0, toy: null, crowned: false })
  })
})
