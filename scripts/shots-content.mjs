// v3 內容擴充截圖 → design/screens/v3-content-*.png
// 用法：先啟動 dev server（pnpm dev --port 5181 --strictPort），再 BASE_URL=http://localhost:5181 node scripts/shots-content.mjs
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:5181'
const OUT = 'design/screens'
mkdirSync(OUT, { recursive: true })

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const p = join(root, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(p)) return p
  }
}

const LAND = { width: 1024, height: 768 }
const PHONE = { width: 375, height: 812 }

const put = (page, table, rows) =>
  page.evaluate(
    ([t, r]) =>
      new Promise((res) => {
        const rq = indexedDB.open('guaibao-quest')
        rq.onsuccess = () => {
          const tx = rq.result.transaction(t, 'readwrite')
          for (const row of r) tx.objectStore(t).put(row)
          tx.oncomplete = () => res(1)
        }
      }),
    [table, rows],
  )

async function fresh(browser, vp) {
  const ctx = await browser.newContext({ viewport: vp, ...(vp.width < 500 ? { hasTouch: true, isMobile: true } : {}) })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForSelector('button.key')
  const press = async (pin) => {
    await page.evaluate(async (p) => {
      for (const d of p) [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
      await new Promise((r) => setTimeout(r, 200))
    }, pin)
  }
  await press('1234')
  await press('1234')
  await page.getByPlaceholder('小朋友的名字').fill('小寶')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '開始冒險' }).click()
  await page.waitForSelector('[data-testid=room]')
  const now = Date.now()
  await put(page, 'materialLedger', [
    { id: 'm1', at: now, material: 'wood', delta: 7, kind: 'station', reason: 't' },
    { id: 'm2', at: now, material: 'stone', delta: 5, kind: 'station', reason: 't' },
    { id: 'm3', at: now, material: 'flower', delta: 6, kind: 'station', reason: 't' },
  ])
  await put(page, 'ledger', [{ id: 'seed', at: now, delta: 120, reason: '測試', kind: 'bonus' }])
  await put(page, 'inventory', [
    { id: 'coloring-monkey', itemId: 'coloring-monkey', qty: 1 },
    { id: 'coloring-staff', itemId: 'coloring-staff', qty: 1 },
    { id: 'coloring-wukong-cloud', itemId: 'coloring-wukong-cloud', qty: 1 },
    { id: 'coloring-peach-garden', itemId: 'coloring-peach-garden', qty: 1 },
    { id: 'decor-plant', itemId: 'decor-plant', qty: 1 },
    { id: 'wall-mint', itemId: 'wall-mint', qty: 1 },
    { id: 'floor-oak', itemId: 'floor-oak', qty: 1 },
  ])
  await put(page, 'coloring', [
    { pageId: 'monkey', fills: { head: '#f0c18b', ear: '#e8a6a0', 'ear-l': '#e8a6a0', 'ear-r': '#e8a6a0', body: '#f0c18b', face: '#f1dd94' }, updatedAt: now },
    { pageId: 'staff', fills: { sky: '#9cc9e0', body: '#f7cf3c', 'cap-top': '#e96a6a', 'cap-bottom': '#e96a6a', ring: '#e96a6a', sun: '#f1dd94' }, updatedAt: now },
  ])
  await page.reload()
  await page.waitForSelector('[data-testid=room]')
  return { ctx, page }
}
const clickRegion = async (page, id, fx = 0.5, fy = 0.5) => {
  const b = await page.locator(`[data-region=${id}]`).boundingBox()
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy)
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/v3-content-${name}.png` })
const toHash = (page, h) => page.evaluate((x) => (location.hash = x), h)

const browser = await chromium.launch({ executablePath: findChrome() })
try {
  // 房間背景：白天 / 傍晚 / 晚上（帶不同壁紙與地板）
  {
    const { ctx, page } = await fresh(browser, LAND)
    const cases = [
      ['room-day', 'day', 'wall-cream', 'floor-wood', 20],
      ['room-dusk', 'dusk', 'wall-mint', 'floor-oak', 20],
      ['room-night', 'night', 'wall-stars', 'floor-wood', 20],
      ['room-day-pink-checker', 'day', 'wall-pink', 'floor-checker', 20],
      ['room-day-clouds-grass', 'day', 'wall-clouds', 'floor-grass', 20],
      ['room-day-banana', 'day', 'wall-banana', 'floor-oak', 20],
    ]
    for (const [name, tod, wall, floor, scroll] of cases) {
      await toHash(page, `backdrop/${tod}/${wall}/${floor}/${scroll}`)
      await page.waitForSelector('[data-testid=backdrop-preview]')
      await page.waitForTimeout(600)
      await shot(page, name)
    }
    await ctx.close()
  }

  // 工坊 / 商店 / 著色 / 畫廊（橫向與手機）
  for (const [vp, suffix] of [[LAND, 'land'], [PHONE, 'phone']]) {
    const { ctx, page } = await fresh(browser, vp)
    await toHash(page, 'workshop')
    await page.waitForSelector('[data-testid=workshop]')
    await page.waitForTimeout(500)
    await shot(page, `workshop-${suffix}`)
    await page.getByTestId('ws-tab-wall').click()
    await page.waitForTimeout(300)
    await shot(page, `workshop-wall-${suffix}`)
    await page.getByTestId('ws-tab-floor').click()
    await page.waitForTimeout(300)
    await shot(page, `workshop-floor-${suffix}`)

    await page.evaluate(() => history.replaceState(null, '', location.pathname))
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await page.getByRole('button', { name: /商店/ }).first().click()
    await page.waitForSelector('[data-testid=shop-grid-food]')
    await page.waitForTimeout(500)
    await shot(page, `shop-${suffix}`)
    await page.getByRole('button', { name: /回首頁/ }).click()

    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=page-monkey]')
    await page.waitForTimeout(400)
    await shot(page, `coloring-list-${suffix}`)

    await page.getByTestId('page-monkey').getByRole('button').click()
    await page.waitForSelector('[data-testid=paint-board]')
    // 填色 + 特殊填色 + 筆刷 + 貼紙
    await page.locator('[data-testid=palette] .swatch').nth(14).click()
    await clickRegion(page, 'head', 0.2, 0.3)
    await page.getByTestId('special-rainbow').click()
    await clickRegion(page, 'body', 0.22, 0.45)
    await page.getByTestId('special-glitter').click()
    await page.locator('[data-testid=palette] .swatch').nth(21).click()
    await clickRegion(page, 'ear-l')
    await page.getByTestId('special-dots').click()
    await clickRegion(page, 'foot-l')
    await page.getByTestId('special-none').click()
    await page.getByTestId('tool-brush').click()
    await page.getByTestId('brush-l').click()
    await page.locator('[data-testid=palette] .swatch').nth(18).click()
    const cb = await page.getByTestId('brush-canvas').boundingBox()
    await page.mouse.move(cb.x + cb.width * 0.08, cb.y + cb.height * 0.85)
    await page.mouse.down()
    for (let i = 0; i <= 24; i++) await page.mouse.move(cb.x + cb.width * (0.08 + i * 0.015), cb.y + cb.height * (0.85 + Math.sin(i / 2.5) * 0.05))
    await page.mouse.up()
    await page.getByTestId('tool-sticker').click()
    await page.getByTestId('add-sticker-obj-star').click()
    await page.getByTestId('add-sticker-obj-peach').click()
    await page.waitForTimeout(500)
    await shot(page, `paint-${suffix}`)
    await page.getByTestId('tool-fill').click()
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    await page.waitForTimeout(900)
    await shot(page, `finish-${suffix}`)
    await page.getByTestId('hang-btn').click()
    await page.waitForSelector('[data-testid=hung-ok]')
    await page.getByTestId('to-gallery').click()
    await page.waitForSelector('[data-testid=gallery-item]')
    await page.waitForTimeout(400)
    await shot(page, `gallery-${suffix}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log('done')
