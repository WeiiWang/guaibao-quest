import { describe, expect, it } from 'vitest'
import { flattenManifest, missingFiles, packFetchUrl, packUrl, runPool, type PackFile } from './offlinePack'

describe('離線內容包：清單', () => {
  it('把分組的清單攤平，保留 Cache 名稱、大小、雜湊', () => {
    const files = flattenManifest({
      version: 1,
      groups: [
        { cache: 'voice', files: [['voice/a.m4a', 10]] },
        { cache: 'art', files: [['art/b.png', 20, 'abcd']] },
      ],
    })
    expect(files).toEqual([
      { cache: 'voice', path: 'voice/a.m4a', size: 10, hash: undefined },
      { cache: 'art', path: 'art/b.png', size: 20, hash: 'abcd' },
    ])
  })

  it('網址：一般用途不帶參數；下載用帶 gqpack（已經有 ?v= 的用 &）', () => {
    expect(packUrl('audio/a.m4a?v=1', '/guaibao-quest/')).toBe('/guaibao-quest/audio/a.m4a?v=1')
    expect(packFetchUrl('voice/a.m4a', '/')).toBe('/voice/a.m4a?gqpack=1')
    expect(packFetchUrl('audio/a.m4a?v=1', '/')).toBe('/audio/a.m4a?v=1&gqpack=1')
  })

  const voice: PackFile = { cache: 'voice', path: 'voice/a.m4a', size: 1 }
  const art: PackFile = { cache: 'art', path: 'art/a.png', size: 1, hash: 'new' }

  it('Cache 裡有的就不再下載（續傳）', () => {
    expect(missingFiles([voice], () => true, {})).toEqual([])
    expect(missingFiles([voice], () => false, {})).toEqual([voice])
  })

  it('有雜湊的檔案：內容換了（或沒紀錄）要重新下載，一樣才跳過', () => {
    expect(missingFiles([art], () => true, { 'art/a.png': 'new' })).toEqual([])
    expect(missingFiles([art], () => true, { 'art/a.png': 'old' })).toEqual([art])
    expect(missingFiles([art], () => true, {})).toEqual([art])
  })

  it('紀錄說有、Cache 卻被清掉了：還是要下載', () => {
    expect(missingFiles([art], () => false, { 'art/a.png': 'new' })).toEqual([art])
  })
})

describe('離線內容包：工作池', () => {
  const tick = () => new Promise((r) => setTimeout(r, 1))

  it('同時進行的數量不超過上限，全部做完', async () => {
    let live = 0
    let peak = 0
    const done: number[] = []
    await runPool(
      Array.from({ length: 30 }, (_, i) => i),
      4,
      async (i) => {
        live += 1
        peak = Math.max(peak, live)
        await tick()
        live -= 1
        done.push(i)
      },
    )
    expect(peak).toBe(4)
    expect(done).toHaveLength(30)
  })

  it('暫停：尚未開始的不做，進行中的做完，不算錯誤', async () => {
    let stop = false
    const done: number[] = []
    await runPool(
      Array.from({ length: 20 }, (_, i) => i),
      2,
      async (i) => {
        await tick()
        done.push(i)
        if (done.length >= 4) stop = true
      },
      () => stop,
    )
    expect(done.length).toBeGreaterThanOrEqual(4)
    expect(done.length).toBeLessThan(8)
  })

  it('worker 丟錯：停止派工，把錯誤丟出來', async () => {
    const done: number[] = []
    await expect(
      runPool(
        Array.from({ length: 20 }, (_, i) => i),
        2,
        async (i) => {
          await tick()
          if (i === 3) throw new Error('quota')
          done.push(i)
        },
      ),
    ).rejects.toThrow('quota')
    expect(done.length).toBeLessThan(8)
  })

  it('清單是空的也不會卡住', async () => {
    await expect(runPool([], 4, async () => undefined)).resolves.toBeUndefined()
  })
})
