/**
 * v7.4 I2：作品出口。把完成圖（PNG data URL）交給系統：
 * - 支援 Web Share API 帶檔案（iOS / iPadOS Safari、Android Chrome）就叫出分享面板（可以存到相簿、傳給阿嬤）；
 * - 不支援就下載成 PNG 檔。使用者在分享面板按取消 = 什麼都不做（不再硬給下載）。
 */
export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'failed'

/** data:image/png;base64,… → Blob */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) return null
  try {
    if (m[2]) {
      const bin = atob(m[3])
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Blob([bytes], { type: m[1] })
    }
    return new Blob([decodeURIComponent(m[3])], { type: m[1] })
  } catch {
    return null
  }
}

/** 存檔用的檔名：guaibao-art-<年月日>-<id 前 4 碼>.png（ASCII，各種裝置都能存） */
export function artFileName(at: number | undefined, id: string): string {
  const d = new Date(at ?? Date.now())
  const p = (n: number) => String(n).padStart(2, '0')
  const safe = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)
  return `guaibao-art-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${safe ? `-${safe}` : ''}.png`
}

export async function saveArtwork(png: string, fileName: string, title = '我的畫'): Promise<SaveResult> {
  const blob = dataUrlToBlob(png)
  if (!blob) return 'failed'
  const nav: (Navigator & { canShare?: (d: ShareData) => boolean }) | undefined = typeof navigator === 'undefined' ? undefined : navigator
  if (nav && typeof nav.share === 'function' && typeof File !== 'undefined') {
    const file = new File([blob], fileName, { type: blob.type || 'image/png' })
    let can: boolean
    try {
      can = typeof nav.canShare === 'function' ? nav.canShare({ files: [file] }) : false
    } catch {
      can = false
    }
    if (can) {
      try {
        await nav.share({ files: [file], title })
        return 'shared'
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return 'cancelled'
        // 其他錯誤（沒有權限、不支援這種檔案）：退回下載
      }
    }
  }
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}
