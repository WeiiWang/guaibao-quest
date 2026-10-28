/**
 * 點陣線稿頁的執行時支援（瀏覽器端）：載入線稿圖、算區塊表（依 pageId 快取在記憶體）、合成完成圖、縮圖快取。
 */
import { useEffect, useState } from 'react'
import { getColoringPage } from './pages'
import { paintAll, type RgbaBuf } from './fillPaint'
import { buildRegionMap, MIN_REGION_FRAC, MIN_REGION_FRAC_HARD, REGION_SIZE, type RegionMap } from './regions'

/** 超過這個毫秒數就算「太慢」：改放 Web Worker（見 regions.worker.ts）。Worker 不能用時退回主執行緒 */
export const REGION_BUDGET_MS = 80

export interface RasterArt {
  pageId: string
  img: HTMLImageElement
  map: RegionMap
  /** 算區塊表花的毫秒（除錯與效能紀錄用） */
  buildMs: number
}

const loadImg = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`線稿載入失敗：${src}`))
    img.src = src
  })

const cache = new Map<string, Promise<RasterArt | null>>()

/** 線稿的網址（含 BASE_URL） */
export const rasterUrl = (pageId: string): string | null => {
  const p = getColoringPage(pageId)
  return p?.kind === 'raster' && p.src ? `${import.meta.env.BASE_URL}${p.src}` : null
}

/** 線條遮罩：把線稿縮成工作解析度，alpha ≥ 128 視為線 */
function lineMaskOf(img: HTMLImageElement, size: number): Uint8Array {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('不能建立畫布')
  ctx.drawImage(img, 0, 0, size, size)
  const d = ctx.getImageData(0, 0, size, size).data
  const mask = new Uint8Array(size * size)
  for (let i = 0, j = 3; i < mask.length; i++, j += 4) mask[i] = d[j] >= 128 ? 1 : 0
  return mask
}

// ---------- 區塊表放進 Worker 算 ----------
let worker: Worker | null | undefined
let seq = 0
const pending = new Map<number, { ok: (m: RegionMap) => void; fail: (e: Error) => void }>()
function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    const w = new Worker(new URL('./regions.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; map?: RegionMap; error?: string }>) => {
      const job = pending.get(e.data.id)
      if (!job) return
      pending.delete(e.data.id)
      if (e.data.map) job.ok(e.data.map)
      else job.fail(new Error(e.data.error ?? '區塊表計算失敗'))
    }
    w.onerror = () => {
      // Worker 出錯：之後都退回主執行緒，正在等的工作也改在主執行緒重算
      worker = null
      for (const [, job] of pending) job.fail(new Error('worker'))
      pending.clear()
    }
    worker = w
  } catch {
    worker = null
  }
  return worker
}

/** 算區塊表：優先在 Worker（不卡畫面），Worker 不能用就在主執行緒算 */
async function buildMapAsync(mask: Uint8Array, size: number, minFrac: number): Promise<RegionMap> {
  const w = getWorker()
  if (w) {
    try {
      const copy = mask.slice() // 轉移的是副本，原本的遮罩留給退回主執行緒用
      return await new Promise<RegionMap>((ok, fail) => {
        const id = ++seq
        pending.set(id, { ok, fail })
        w.postMessage({ id, mask: copy, size, minFrac }, [copy.buffer])
      })
    } catch {
      /* 退回主執行緒 */
    }
  }
  return buildRegionMap(mask, size, minFrac)
}

/** 載入線稿並算出區塊表；同一頁只算一次。失敗（沒有素材、載入錯誤）回 null */
export function getRasterArt(pageId: string): Promise<RasterArt | null> {
  const hit = cache.get(pageId)
  if (hit) return hit
  const url = rasterUrl(pageId)
  if (!url) return Promise.resolve(null)
  const p = loadImg(url)
    .then(async (img): Promise<RasterArt> => {
      const t0 = performance.now()
      const frac = getColoringPage(pageId)?.tier === 'hard' ? MIN_REGION_FRAC_HARD : MIN_REGION_FRAC
      const map = await buildMapAsync(lineMaskOf(img, REGION_SIZE), REGION_SIZE, frac)
      return { pageId, img, map, buildMs: performance.now() - t0 }
    })
    .catch(() => {
      cache.delete(pageId)
      return null
    })
  cache.set(pageId, p)
  return p
}

/** React：取得某頁的線稿與區塊表（載入中是 undefined，失敗是 null；向量頁一律 null） */
export function useRasterArt(pageId: string | undefined): RasterArt | null | undefined {
  const [state, setState] = useState<{ id: string | undefined; art: RasterArt | null | undefined }>({ id: pageId, art: undefined })
  useEffect(() => {
    let alive = true
    if (!pageId || !rasterUrl(pageId)) return
    void getRasterArt(pageId).then((a) => alive && setState({ id: pageId, art: a }))
    return () => {
      alive = false
    }
  }, [pageId])
  if (!pageId || !rasterUrl(pageId)) return null
  return state.id === pageId ? state.art : undefined
}

/** 這頁有幾個區塊（算完成度用）；還沒算好是 undefined */
export const useRegionIds = (pageId: string | undefined): string[] | undefined => {
  const art = useRasterArt(pageId)
  return art === undefined ? undefined : (art?.map.regions.map((r) => r.id) ?? [])
}

// ---------- 合成 ----------
/** 把填色層（RGBA）放進一張工作解析度的畫布 */
export function fillCanvasOf(buf: RgbaBuf): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = buf.width
  c.height = buf.height
  c.getContext('2d')!.putImageData(new ImageData(buf.data as Uint8ClampedArray<ArrayBuffer>, buf.width, buf.height), 0, 0)
  return c
}

/** 白底 → 填色 → 線稿，畫進 ctx 的 (0,0,size,size) */
export function drawRasterComposite(ctx: CanvasRenderingContext2D, art: RasterArt, fills: Record<string, string>, size: number, withWhite = true): void {
  if (withWhite) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(fillCanvasOf(paintAll(art.map, fills)), 0, 0, size, size)
  ctx.drawImage(art.img, 0, 0, size, size)
}

// ---------- 縮圖（依 fills 快取 dataURL）----------
const thumbCache = new Map<string, string>()
const THUMB_MAX = 80

/** fills 的穩定指紋（key 排序後串起來） */
export const fillsKey = (fills: Record<string, string> | undefined): string =>
  Object.keys(fills ?? {})
    .sort()
    .map((k) => `${k}=${fills![k]}`)
    .join(',')

export function rasterThumb(art: RasterArt, fills: Record<string, string> | undefined, size = 256): string {
  const key = `${art.pageId}|${size}|${fillsKey(fills)}`
  const hit = thumbCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  drawRasterComposite(c.getContext('2d')!, art, fills ?? {}, size)
  const url = c.toDataURL('image/png')
  if (thumbCache.size >= THUMB_MAX) thumbCache.delete(thumbCache.keys().next().value as string)
  thumbCache.set(key, url)
  return url
}
