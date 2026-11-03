import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 部署在子路徑（/guaibao-quest/）；本機開發維持根路徑
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        // 預快取只留 app shell；3D 素材（public/art）改成執行時快取，第一次看過的圖之後可離線使用
        globPatterns: ['**/*.{js,css,html,svg,ico,webmanifest}', 'icon-*.png', 'apple-touch-icon.png'],
        globIgnores: ['art/**', 'voice/**'],
        runtimeCaching: [
          {
            // 語音清單：有網路拿最新的，離線用快取
            urlPattern: ({ url }) => url.pathname.endsWith('/voice/manifest.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'voice-manifest', networkTimeoutSeconds: 3 },
          },
          {
            // 預錄語音（媽媽聲）：聽過一次就能離線播放
            urlPattern: ({ url }) => /\/voice\/[^/]+\.m4a$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'voice',
              expiration: { maxEntries: 2000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 含 art/coloring/（v7 點陣線稿，約 16 張）：路徑多一層資料夾
            urlPattern: ({ url }) => /\/art\/(coloring\/)?[^/]+\.png$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'art',
              expiration: { maxEntries: 260 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
