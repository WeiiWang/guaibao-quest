import { describe, expect, it } from 'vitest'
import { pickFirstArt } from './artProbe'

describe('pickFirstArt（v7.5 備援挑圖）', () => {
  it('第一張存在就用它；全都不存在回 null', () => {
    expect(pickFirstArt(['a', 'b'], ['ok', 'ok'])).toBe('a')
    expect(pickFirstArt(['a', 'b'], ['no', 'no'])).toBeNull()
    expect(pickFirstArt(['a', 'b'], ['no', 'ok'])).toBe('b')
  })
  it('猴子：前面的姿勢還在探測、後面的已知存在 → 先用存在的（不會先畫一張可能不存在的圖）', () => {
    expect(pickFirstArt(['pet-baby-sing', 'pet-baby-happy', 'pet-baby-idle'], ['pending', 'ok', 'ok'])).toBe('pet-baby-happy')
  })
  it('兔兔：自己的圖還在探測、只有猴子備援存在 → 等兔兔（不先閃猴子）', () => {
    const names = ['pet-rabbit-baby-happy', 'pet-rabbit-baby-idle', 'pet-baby-happy', 'pet-baby-idle']
    expect(pickFirstArt(names, ['pending', 'pending', 'ok', 'ok'])).toBe('pet-rabbit-baby-happy')
    // 兔兔的另一個姿勢已知存在 → 用它
    expect(pickFirstArt(names, ['pending', 'ok', 'ok', 'ok'])).toBe('pet-rabbit-baby-idle')
    // 兔兔的圖都不存在 → 猴子
    expect(pickFirstArt(names, ['no', 'no', 'ok', 'ok'])).toBe('pet-baby-happy')
  })
  it('都還在探測就先用第一張', () => {
    expect(pickFirstArt(['pet-tiger-adult-sing', 'pet-adult-sing'], ['pending', 'pending'])).toBe('pet-tiger-adult-sing')
  })
})
