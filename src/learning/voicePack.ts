import { registerLineAudio, unlockLineAudio } from './speech'

interface ManifestEntry {
  file: string
  text: string
}

/**
 * 載入預錄語音包（public/voice/manifest.json）並註冊給 say()。
 * 沒有語音包（例如還沒生成）時什麼都不做，所有句子退回 Web Speech。
 */
export async function loadVoicePack(base = import.meta.env.BASE_URL): Promise<number> {
  // 自動化測試（Playwright）預設不載入語音包，讓 e2e 用假的 speechSynthesis 驗證唸了什麼；
  // 要測語音包本身時在 localStorage 設 gq-voice-pack-test=1
  try {
    if (navigator.webdriver && localStorage.getItem('gq-voice-pack-test') !== '1') return 0
  } catch {
    /* 讀不到 localStorage 就照常載入 */
  }
  try {
    const res = await fetch(`${base}voice/manifest.json`)
    if (!res.ok) return 0
    const manifest = (await res.json()) as Record<string, ManifestEntry>
    registerLineAudio(Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, { url: `${base}voice/${v.file}`, text: v.text }])))
    return Object.keys(manifest).length
  } catch {
    return 0
  }
}

/** 第一次觸碰畫面時解鎖播放器（iPad Safari 的自動播放限制） */
export function installAudioUnlock(): void {
  if (typeof window === 'undefined') return
  const once = () => {
    unlockLineAudio()
    window.removeEventListener('pointerdown', once, true)
    window.removeEventListener('keydown', once, true)
  }
  window.addEventListener('pointerdown', once, true)
  window.addEventListener('keydown', once, true)
}
