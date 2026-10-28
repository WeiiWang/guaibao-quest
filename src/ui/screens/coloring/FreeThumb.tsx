import { useEffect, useState } from 'react'
import { renderArtworkPng } from '../../../art/coloring/export'
import type { ColoringProgress } from '../../../domain/types'
import { stickerEmoji } from './stickers'

const cache = new Map<string, string>()

/** 空白畫紙存檔欄位的縮圖：沒畫過就是一張空白紙，畫過的用完成圖同一套繪製（小尺寸）轉成圖片 */
export function FreeThumb({ pr }: { pr?: ColoringProgress }) {
  const used = !!pr && (Object.keys(pr.fills).length > 0 || (pr.strokes?.length ?? 0) > 0 || (pr.stickers?.length ?? 0) > 0 || !!pr.bg)
  const key = pr ? `${pr.pageId}|${pr.updatedAt}` : ''
  const [url, setUrl] = useState<string | undefined>(() => cache.get(key))
  useEffect(() => {
    if (!used || !pr) return
    const hit = cache.get(key)
    if (hit) {
      setUrl(hit)
      return
    }
    let alive = true
    void renderArtworkPng({ pageId: pr.pageId, bg: pr.bg, fills: pr.fills, strokes: pr.strokes ?? [], stickers: pr.stickers ?? [] }, stickerEmoji, 160)
      .then((u) => {
        if (cache.size > 12) cache.delete(cache.keys().next().value as string)
        cache.set(key, u)
        if (alive) setUrl(u)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [used, pr, key])
  if (!used) return <span className="pb-free-blank" data-testid="free-blank" aria-hidden />
  return url ? <img className="pb-free-img" src={url} alt="" draggable={false} /> : <span className="pb-free-blank" aria-hidden />
}
