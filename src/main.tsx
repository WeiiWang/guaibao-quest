import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './ui/App'
import './ui/styles.css'
import { installAudioUnlock, loadVoicePack } from './learning/voicePack'

if (import.meta.env.DEV) {
  void import('./debug').then((m) => m.installDebug())
} else {
  registerSW({ immediate: true })
}

installAudioUnlock()
void loadVoicePack()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
