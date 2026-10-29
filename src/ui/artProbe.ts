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

/**
 * 從候選清單挑第一張存在的圖；全都不存在回 null。
 * 前面的候選還在探測中（pending）就先用它（等它載入），不先跳到後面已知存在的圖：
 * v7.5 兔兔的圖還在探測時，不會先閃一下猴子再換成兔子。已知不存在的（no）直接跳過，不會出現破圖。
 */
export function useFirstArt(names: readonly string[]): string | null {
  const st = useArtStatuses(names)
  const i = st.findIndex((s) => s !== 'no')
  return i >= 0 ? names[i] : null
}

/** 同步查目前已知的狀態（給非 React 的程式用，例如飛入動畫）；沒探測過會順便開始探測 */
export function peekArt(name: string): ArtStatus {
  probe(name)
  return cache.get(name) ?? 'pending'
}
