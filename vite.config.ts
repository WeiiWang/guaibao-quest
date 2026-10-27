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
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '乖寶任務',
        short_name: '乖寶任務',
        description: '完成任務、照顧小猴子',
        lang: 'zh-Hant',
        theme_color: '#f3e3c3',
        background_color: '#f3e3c3',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
            urlPattern: ({ url }) => /\/art\/[^/]+\.png$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'art',
              expiration: { maxEntries: 200 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
