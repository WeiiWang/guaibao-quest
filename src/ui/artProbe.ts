import { useSyncExternalStore } from 'react'

/** 探測 public/art/<name>.png 是否存在（素材是逐步生成的，缺圖時要能降級） */
export type ArtStatus = 'ok' | 'no' | 'pending'

const cache = new Map<string, ArtStatus>()
const listeners = new Set<() => void>()
let version = 0

const emit = () => {
  version++
  listeners.forEach((l) => l())
}

function probe(name: string) {
  if (cache.has(name)) return
  cache.set(name, 'pending')
  const img = new Image()
  img.onload = () => {
    cache.set(name, 'ok')
    emit()
  }
  img.onerror = () => {
    cache.set(name, 'no')
    emit()
  }
  img.src = `${import.meta.env.BASE_URL}art/${name}.png`
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 一次查多個名稱，回傳各自狀態；任一結果變動就重新渲染 */
export function useArtStatuses(names: readonly string[]): ArtStatus[] {
  useSyncExternalStore(subscribe, () => version)
  names.forEach(probe)
  return names.map((n) => cache.get(n) ?? 'pending')
}

export const useArtStatus = (name: string): ArtStatus => useArtStatuses([name])[0]

/** 從候選清單挑第一張存在的圖；都還沒結果就用第一個，全都不存在回 null */
export function useFirstArt(names: readonly string[]): string | null {
  const st = useArtStatuses(names)
  const ok = st.findIndex((s) => s === 'ok')
  if (ok >= 0) return names[ok]
  if (st.some((s) => s === 'pending')) return names[0]
  return null
}

/** 同步查目前已知的狀態（給非 React 的程式用，例如飛入動畫）；沒探測過會順便開始探測 */
export function peekArt(name: string): ArtStatus {
  probe(name)
  return cache.get(name) ?? 'pending'
}
