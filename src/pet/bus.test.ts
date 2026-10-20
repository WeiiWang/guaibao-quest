import { describe, expect, it } from 'vitest'
import { CMD_MAX_AGE_MS, drainPetCommands, getFastSchedule, getTodMode, sendPetCommand, setFastSchedule, setTodMode, type StorageLike } from './bus'

function mem(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

describe('PM 指令佇列', () => {
  it('依先後順序取出，取完就清空', () => {
    const s = mem()
    sendPetCommand('sing', 1000, s)
    sendPetCommand('poop', 1001, s)
    expect(drainPetCommands(1500, s)).toEqual(['sing', 'poop'])
    expect(drainPetCommands(1600, s)).toEqual([])
  })
  it('過期的指令不執行', () => {
    const s = mem()
    sendPetCommand('dance', 1000, s)
    expect(drainPetCommands(1000 + CMD_MAX_AGE_MS + 1, s)).toEqual([])
  })
  it('壞掉的資料不會丟錯', () => {
    const s = mem()
    s.setItem('gq-pet-cmds', '{oops')
    expect(drainPetCommands(0, s)).toEqual([])
    s.setItem('gq-pet-cmds', JSON.stringify([{ cmd: 'hack', at: 1 }, { cmd: 'sing', at: 1 }]))
    expect(drainPetCommands(5, s)).toEqual(['sing'])
  })
  it('沒有 storage 也不會丟錯', () => {
    sendPetCommand('sing', 1, null)
    expect(drainPetCommands(1, null)).toEqual([])
  })
})

describe('日夜覆寫', () => {
  it('預設 auto；設定後記住；改回 auto 就清掉', () => {
    const s = mem()
    expect(getTodMode(s)).toBe('auto')
    setTodMode('night', s)
    expect(getTodMode(s)).toBe('night')
    setTodMode('auto', s)
    expect(getTodMode(s)).toBe('auto')
    s.setItem('gq-pet-tod', 'midnight')
    expect(getTodMode(s)).toBe('auto')
  })
  it('加速排程開關', () => {
    const s = mem()
    expect(getFastSchedule(s)).toBe(false)
    setFastSchedule(true, s)
    expect(getFastSchedule(s)).toBe(true)
    setFastSchedule(false, s)
    expect(getFastSchedule(s)).toBe(false)
  })
})
