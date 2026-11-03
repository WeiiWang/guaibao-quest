import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'

// GitHub Pages 部署在子路徑（/guaibao-quest/）；本機開發維持根路徑
const base = process.env.BASE_PATH ?? '/'

/** 家長區顯示的版本：短 commit + build 日期 */
function appVersion(): string {
  const date = new Date().toISOString().slice(0, 10)
  try {
    return `${execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()} (${date})`
  } catch {
    return (process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev') + ` (${date})`
  }
}

// 執行時快取的名稱與上限。離線內容包（src/ui/offlinePack.ts）要寫進同一批 Cache，所以清單也用這裡的名稱。
// 上限一定要比實際檔案數大：workbox 的 ExpirationPlugin 會把讀過的項目記下來，超過上限就刪最舊的，
// 語音上限如果小於檔案數，內容包下載完、邊玩邊被刪，離線就破功了（offlinePackPlugin 會在 build 時檢查）。
const CACHE = {
  voice: { name: 'voice', maxEntries: 8000 },
  voiceManifest: { name: 'voice-manifest' },
  audio: { name: 'audio', maxEntries: 100 },
  audioManifest: { name: 'audio-manifest' },
  art: { name: 'art', maxEntries: 1000 },
}

const md5 = (p: string) => createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 10)

function walk(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]))
}

/** build 時產生 offline-pack.json：全部語音、圖、音樂的清單（Cache 名稱、網址、大小；檔名不含雜湊的另外記內容雜湊） */
function offlinePackPlugin(): Plugin {
  return {
    name: 'gq-offline-pack',
    apply: 'build',
    generateBundle() {
      const pub = resolve(import.meta.dirname, 'public')
      const size = (p: string) => statSync(join(pub, p)).size
      const voice = walk(join(pub, 'voice')).filter((f) => f.endsWith('.m4a'))
      const art = walk(join(pub, 'art')).filter((f) => /\.(png|jpg)$/.test(f))
      // 音訊的網址要跟 audioEngine.ts 一模一樣（含 ?v=），Cache 才對得上
      const audioManifest = JSON.parse(readFileSync(join(pub, 'audio/manifest.json'), 'utf8')) as { music: Record<string, { file: string; v?: string }>; sfx: Record<string, { file: string; v?: string }> }
      const versions = new Map([...Object.values(audioManifest.music), ...Object.values(audioManifest.sfx)].map((e) => [e.file, e.v]))
      const audio = walk(join(pub, 'audio')).filter((f) => f.endsWith('.m4a'))
      for (const [label, n, max] of [
        ['voice', voice.length, CACHE.voice.maxEntries],
        ['art', art.length, CACHE.art.maxEntries],
        ['audio', audio.length, CACHE.audio.maxEntries],
      ] as const) {
        if (n > max) throw new Error(`離線內容包：${label} 有 ${n} 個檔案，超過 runtimeCaching 的 maxEntries ${max}，下載後會被清掉。請調高 vite.config.ts 的上限。`)
      }
      const hashed = (dir: string, f: string): [string, number, string] => [`${dir}/${f}`, size(`${dir}/${f}`), md5(join(pub, dir, f))]
      const groups = [
        { cache: CACHE.voiceManifest.name, files: [hashed('voice', 'manifest.json')] },
        { cache: CACHE.audioManifest.name, files: [hashed('audio', 'manifest.json')] },
        { cache: CACHE.audio.name, files: audio.map((f): [string, number] => [`audio/${f}${versions.get(f) ? `?v=${versions.get(f)}` : ''}`, size(`audio/${f}`)]) },
        // 圖的檔名不會隨內容改變：記雜湊，換了新圖才會重新下載
        { cache: CACHE.art.name, files: art.map((f) => hashed('art', f)) },
        { cache: CACHE.voice.name, files: voice.map((f): [string, number] => [`voice/${f}`, size(`voice/${f}`)]) },
      ]
      this.emitFile({ type: 'asset', fileName: 'offline-pack.json', source: JSON.stringify({ version: 1, groups }) })
    },
  }
}

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  // 全部 CSS 一包（順序見 src/ui/allStyles.ts）：分塊的畫面不會閃一下沒樣式，也不會改變誰蓋誰
  build: { cssCodeSplit: false },
  plugins: [
    react(),
    offlinePackPlugin(),
    VitePWA({
      // 更新不打斷：新版本裝好後等著，由 src/ui/updateController.ts 在安全時機才接手（不用 autoUpdate，那會在孩子答題時重新整理）
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: '乖寶任務',
        short_name: '乖寶任務',
        description: '完成任務、照顧小猴子',
        lang: 'zh-Hant',
        // 啟動底色 = 開場畫面的天空藍（跟 index.html 的 theme-color、src/ui/shell.css 的 --gq-sky 同一個色）
        theme_color: '#67b2fd',
        background_color: '#67b2fd',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          // 圖示由 design/tools/make_icons.py 從 design/raw/app-icon.png 切出；maskable 另外一張（內縮到安全區，不被圓形遮罩切到）
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 第一次安裝就接管頁面（第一次看過的圖也能進快取）；之後的新版本等 skipWaiting 才接手
        clientsClaim: true,
        // 預快取只留 app shell；3D 素材（public/art）改成執行時快取，第一次看過的圖之後可離線使用
        // 圖示只預快取最小的兩張（192 與 apple-touch）；512 與 maskable 是安裝時才抓，不必每個人都先下載
        // offline-pack.json：離線時家長區也要看得到內容包的狀態
        globPatterns: ['**/*.{js,css,html,svg,ico,webmanifest}', 'icon-192.png', 'apple-touch-icon.png', 'offline-pack.json'],
        globIgnores: ['art/**', 'voice/**', 'audio/**'],
        runtimeCaching: [
          {
            // 語音清單：有網路拿最新的，離線用快取
            // gqpack：離線內容包自己下載、自己寫 Cache，SW 不要攔（這幾條路由都一樣）
            urlPattern: ({ url }) => !url.searchParams.has('gqpack') && url.pathname.endsWith('/voice/manifest.json'),
            handler: 'NetworkFirst',
            options: { cacheName: CACHE.voiceManifest.name, networkTimeoutSeconds: 3 },
          },
          {
            // 預錄語音（媽媽聲）。注意：<audio> 一律發 Range，網路回的是 206，不會被快取（2026-11 實測 Chromium、WebKit 都是），
            // 所以「聽過一次」不會留下來；語音要離線靠家長區的離線內容包（寫入完整的 200，這裡再切 Range 回去）
            urlPattern: ({ url }) => !url.searchParams.has('gqpack') && /\/voice\/[^/]+\.m4a$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: CACHE.voice.name,
              expiration: { maxEntries: CACHE.voice.maxEntries },
              cacheableResponse: { statuses: [0, 200] },
              // 語音走 <audio>：Safari 一定發 Range 請求，而且只接受 206。沒這個的話快取裡的完整檔案離線時在 iPad 播不出來
              rangeRequests: true,
            },
          },
          {
            // 音樂與音效清單：有網路拿最新的（換了歌或循環點要馬上生效），離線用快取
            urlPattern: ({ url }) => !url.searchParams.has('gqpack') && url.pathname.endsWith('/audio/manifest.json'),
            handler: 'NetworkFirst',
            options: { cacheName: CACHE.audioManifest.name, networkTimeoutSeconds: 3 },
          },
          {
            // 背景音樂與音效（design/tools/gen_music.py 算繪的 m4a）：聽過一次就能離線播放
            urlPattern: ({ url }) => !url.searchParams.has('gqpack') && /\/audio\/[^/]+\.m4a$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: CACHE.audio.name,
              expiration: { maxEntries: CACHE.audio.maxEntries },
              // 檔案很大又要整個解碼，不能用 Range 回應；只快取完整的 200
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 含子資料夾（art/coloring/ 的點陣線稿）；v8 的開場主視覺是 jpg
            urlPattern: ({ url }) => !url.searchParams.has('gqpack') && /\/art\/.+\.(png|jpg)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: CACHE.art.name,
              expiration: { maxEntries: CACHE.art.maxEntries },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'], setupFiles: ['src/testSetup.ts'] },
})
