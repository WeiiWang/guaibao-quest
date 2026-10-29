import { afterEach, describe, expect, it, vi } from 'vitest'
import { artFileName, dataUrlToBlob, saveArtwork } from './shareArt'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

afterEach(() => vi.unstubAllGlobals())

describe('v7.4 I2：存圖', () => {
  it('data URL → Blob（型別、大小）；壞的回 null', () => {
    const b = dataUrlToBlob(PNG)
    expect(b?.type).toBe('image/png')
    expect(b?.size).toBe(8)
    expect(dataUrlToBlob('not a data url')).toBeNull()
  })
  it('檔名：guaibao-art-年月日-id', () => {
    expect(artFileName(new Date(2026, 9, 5, 10).getTime(), 'ab-12_cdef')).toBe('guaibao-art-20261005-ab12.png')
  })
  it('支援分享檔案：叫出分享面板（帶 PNG 檔）', async () => {
    const share = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { share, canShare: () => true })
    expect(await saveArtwork(PNG, 'a.png', '我的畫')).toBe('shared')
    const arg = share.mock.calls[0] as unknown as [{ files: File[]; title: string }]
    expect(arg[0].files[0].name).toBe('a.png')
    expect(arg[0].files[0].type).toBe('image/png')
  })
  it('分享面板按取消：什麼都不做（不硬給下載）', async () => {
    const share = vi.fn(async () => {
      throw Object.assign(new Error('cancel'), { name: 'AbortError' })
    })
    vi.stubGlobal('navigator', { share, canShare: () => true })
    expect(await saveArtwork(PNG, 'a.png')).toBe('cancelled')
  })
  it('不支援分享檔案：退回下載', async () => {
    const click = vi.fn()
    const a = { click, remove: vi.fn(), href: '', download: '', rel: '' }
    vi.stubGlobal('navigator', { share: undefined })
    vi.stubGlobal('document', { createElement: () => a, body: { appendChild: vi.fn() } })
    vi.stubGlobal('window', { setTimeout: vi.fn() })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    expect(await saveArtwork(PNG, 'b.png')).toBe('downloaded')
    expect(click).toHaveBeenCalled()
    expect(a.download).toBe('b.png')
  })
})
