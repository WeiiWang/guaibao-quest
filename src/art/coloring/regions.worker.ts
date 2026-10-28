/// <reference lib="webworker" />
// 區塊表在 Web Worker 裡算：低階 iPad 上算一張豐富版線稿可能超過 80ms，不能卡住主執行緒（畫面與手勢）。
import { buildRegionMap } from './regions'

self.onmessage = (e: MessageEvent<{ id: number; mask: Uint8Array; size: number; minFrac?: number }>) => {
  const { id, mask, size, minFrac } = e.data
  try {
    const map = buildRegionMap(mask, size, minFrac)
    ;(self as unknown as Worker).postMessage({ id, map }, [map.labels.buffer, map.paint.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
