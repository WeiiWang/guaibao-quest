// 量測首次可點擊時間（6 倍 CPU 降速，Chromium CDP）。要跑在 production build + preview 上（不是 dev）。
// 用法：BASE_URL=http://localhost:5191/guaibao-quest/ node scripts/measure-tti.mjs [次數]
//   NET=1：再加網路節流（10 Mbps、40ms，接近家用 Wi-Fi）；預設不節流（localhost 幾乎沒有網路成本）
// 時間都由頁面自己記（MutationObserver、longtask），不含 Playwright 來回與注入腳本的時間。
//   鈕出現   = 開場畫面的開始鈕進到 DOM（從導覽開始算）
//   主執行緒閒 = 最後一個 long task（>50ms）結束的時間，之後按下去都能立刻反應（TTI 的簡化版）
//   阻塞合計 = 所有 long task 超過 50ms 的部分加總（TBT）
//   下一畫面 = 按下開始到下一個畫面（全新安裝 = 設定 PIN）出現
//   熱       = 同一個 context 第二次載入（SW 與快取都有了）
import { chromium } from 'playwright-core'
import { findChrome, BASE } from './e2e-lib.mjs'

const RUNS = Number(process.argv[2] ?? 5)
const NET = process.env.NET === '1'
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const SETTLE_MS = 2500

async function once(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gq-title-test', '1') // 自動化瀏覽器預設跳過開場畫面，這裡要它出現
    } catch {
      /* ignore */
    }
    const m = (window.__m = { long: [] })
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) m.long.push([e.startTime, e.duration])
    }).observe({ type: 'longtask', buffered: true })
    addEventListener('pointerdown', () => (m.clicked ??= performance.now()), true)
    new MutationObserver(() => {
      if (m.btn === undefined && document.querySelector('[data-testid=title-start]')) m.btn = performance.now()
      if (m.clicked !== undefined && m.next === undefined && document.querySelector('.onboarding')) m.next = performance.now()
    }).observe(document, { childList: true, subtree: true })
  })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  if (NET) {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 })
  }
  const url = BASE.endsWith('/') ? BASE : `${BASE}/`
  const load = async () => {
    await page.goto(url, { waitUntil: 'commit' })
    await page.waitForSelector('[data-testid=title-start]', { timeout: 60000 })
    await page.waitForTimeout(SETTLE_MS)
    return page.evaluate(() => {
      const m = window.__m
      const idle = Math.max(m.btn, ...m.long.map(([s, d]) => s + d))
      const tbt = m.long.reduce((n, [, d]) => n + Math.max(0, d - 50), 0)
      return { btn: m.btn, idle, tbt }
    })
  }
  const cold = await load()
  await page.click('[data-testid=title-start]')
  await page.waitForSelector('.onboarding', { timeout: 60000 })
  const next = await page.evaluate(() => window.__m.next - window.__m.clicked)
  await page.evaluate(() => navigator.serviceWorker?.ready)
  await page.waitForTimeout(800)
  const warm = await load()
  await cdp.detach().catch(() => {})
  await ctx.close()
  return { btn: cold.btn, idle: cold.idle, tbt: cold.tbt, next, warmBtn: warm.btn, warmIdle: warm.idle, warmTbt: warm.tbt }
}

const browser = await chromium.launch({ executablePath: findChrome() })
const rows = []
for (let i = 0; i < RUNS; i++) rows.push(await once(browser))
await browser.close()
const f = (k) => median(rows.map((r) => r[k])).toFixed(0)
console.log(`中位數（${RUNS} 次，6x CPU${NET ? '，10 Mbps 40ms' : ''}）`)
console.log(`  冷：鈕出現 ${f('btn')}ms  主執行緒閒 ${f('idle')}ms  阻塞合計 ${f('tbt')}ms  按開始到下一畫面 ${f('next')}ms`)
console.log(`  熱：鈕出現 ${f('warmBtn')}ms  主執行緒閒 ${f('warmIdle')}ms  阻塞合計 ${f('warmTbt')}ms`)
