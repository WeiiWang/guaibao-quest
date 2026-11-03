import './ui/allStyles'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './ui/App'
import { installAudioUnlock, loadVoicePack } from './learning/voicePack'
import { installGlobalErrorHandlers } from './ui/errorLog'
import { installPressFeel } from './ui/pressFeel'
import { requestPersistentStorage } from './ui/persist'
import { appUpdate } from './ui/updateController'

if (import.meta.env.DEV) {
  void import('./debug').then((m) => m.installDebug())
} else {
  // 更新不打斷：新版本裝好後等著，安全時機（appUpdate.tryApply）才 skipWaiting；SW 接手後 registerSW 會重新整理頁面
  let lastCheck = Date.now()
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => appUpdate.markReady(),
    onRegisteredSW: (_url, reg) => {
      // iPad 主畫面版常常只是從背景回來、不會重新導覽，瀏覽器不會自己檢查更新；回到前景時檢查（最多半小時一次）
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !reg || navigator.onLine === false) return
        if (Date.now() - lastCheck < 30 * 60_000) return
        lastCheck = Date.now()
        void reg.update().catch(() => undefined)
      })
    },
  })
  appUpdate.setApply(() => {
    void updateSW(true)
    // 保險：SW 一直沒接手（例如被別的分頁卡住）也重新整理，下一輪再試（updateController 有冷卻時間，不會一直重整）
    window.setTimeout(() => location.reload(), 4000)
  })
}

installGlobalErrorHandlers()
installPressFeel()
requestPersistentStorage()
installAudioUnlock()
void loadVoicePack()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
