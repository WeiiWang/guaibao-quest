import { useSyncExternalStore } from 'react'
import { stageSceneFile, type StageSceneKey } from '../learning/stageScene'

/**
 * 關卡場景背景圖（public/art/scene-stage-<key>.jpg）：圖是逐步生成的，所以先探測、載入完成才用；
 * 缺圖或載入失敗就是 'no'，畫面退回原本的漸層背景。首頁也用它（下一站的小圖），順便把圖放進快取，進關卡時不用再等。
 */
export type SceneStatus = 'ok' | 'no' | 'pending'

const cache = new Map<string, SceneStatus>()
const listeners = new Set<() => void>()
let version = 0

const emit = () => {
  version++
  listeners.forEach((l) => l())
}

export const sceneUrl = (key: StageSceneKey): string => `${import.meta.env.BASE_URL}${stageSceneFile(key)}`

function probe(key: StageSceneKey): void {
  if (cache.has(key)) return
  cache.set(key, 'pending')
  const img = new Image()
  img.onload = () => {
    cache.set(key, 'ok')
    emit()
  }
  img.onerror = () => {
    cache.set(key, 'no')
    emit()
  }
  img.src = sceneUrl(key)
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 這個場景的圖載入了嗎（key 是 null = 沒有場景 = 'no'） */
export function useSceneStatus(key: StageSceneKey | null): SceneStatus {
  useSyncExternalStore(subscribe, () => version)
  if (!key) return 'no'
  probe(key)
  return cache.get(key) ?? 'pending'
}
