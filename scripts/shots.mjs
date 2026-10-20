// 視覺驗收截圖：三種尺寸 × 各主要畫面 → design/screens/
// 用法：先啟動 dev server（pnpm dev --port 5181 --strictPort），再 BASE_URL=http://localhost:5181 node scripts/shots.mjs
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

const SIZES = { land: { width: 1024, height: 768 }, port: { width: 768, height: 1024 }, phone: { width: 375, height: 812 } }
const DECOR = ['decor-clock', 'decor-ball', 'decor-plant', 'decor-crate', 'decor-poster', 'decor-curtain', 'decor-rug', 'decor-shelf', 'decor-frame', 'decor-bed']
const COLORING = ['coloring-monkey', 'coloring-fish', 'coloring-flower']

const idb = (page, fn, arg) =>
  page.evaluate(
    ([src, a]) =>
      new Promise((res) => {
        const rq = indexedDB.open('guaibao-quest')
        rq.onsuccess = () => Promise.resolve(new Function('db', 'arg', `return (${src})(db, arg)`)(rq.result, a)).then(res)
      }),
    [fn.toString(), arg],
  )

async function setup(browser, vp, { stage = 'adult', feed = 80, place = true } = {}) {
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
  await idb(
    page,
    (db, o) =>
      new Promise((res) => {
        const tx = db.transaction(['inventory', 'pets', 'ledger', 'placements'], 'readwrite')
        const inv = tx.objectStore('inventory')
        inv.put({ id: 'banana', itemId: 'banana', qty: 3 })
        inv.put({ id: 'peach', itemId: 'peach', qty: 1 })
        for (const id of o.decor) inv.put({ id, itemId: id, qty: 1 })
        for (const id of o.coloring) inv.put({ id, itemId: id, qty: 1 })
        const ps = tx.objectStore('pets')
        const g = ps.get('pet')
        g.onsuccess = () => {
          const p = g.result
          ps.put({ ...p, stage: o.stage, feedCount: o.feed, hunger: 90, hungerUpdatedAt: Date.now() })
        }
        tx.objectStore('ledger').put({ id: 'seed', at: Date.now(), delta: 120, reason: '測試', kind: 'bonus' })
        if (o.place) {
          const pl = tx.objectStore('placements')
          const put = (itemId, x, y) => pl.put({ itemId, x, y, z: 0, flipped: false, placedAt: Date.now() })
          put('decor-rug', 0.3, 0.88); put('decor-bed', 0.12, 0.8); put('decor-shelf', 0.52, 0.7); put('decor-plant', 0.42, 0.8)
          put('decor-clock', 0.24, 0.2); put('decor-frame', 0.4, 0.2); put('decor-curtain', 0.64, 0.3); put('decor-poster', 0.2, 0.34)
          put('decor-ball', 0.36, 0.92); put('decor-crate', 0.58, 0.88)
        }
        tx.oncomplete = () => res(1)
      }),
    { stage, feed, place, decor: DECOR, coloring: COLORING },
  )
  await page.evaluate(() => localStorage.setItem('gq-points-seen', '120')) // 不要在拍照時剛好播星星飛入動畫
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await page.waitForTimeout(600)
  return { ctx, page }
}

const shot = async (page, name, key) => {
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${OUT}/${name}-${key}.png` })
  console.log('shot', `${name}-${key}`)
}
const home = async (page) => {
  for (let i = 0; i < 3; i++) {
    if (await page.locator('[data-testid=room]').count()) return
    await page.locator('button.back').first().click()
    await page.waitForTimeout(250)
  }
  await page.waitForSelector('[data-testid=room]')
}

const browser = await chromium.launch({ executablePath: findChrome() })
try {
  for (const [key, vp] of Object.entries(SIZES)) {
    const { ctx, page } = await setup(browser, vp)
    await shot(page, 'home', key)
    if (key === 'land') {
      for (const [label, frac] of [['left', 0], ['right', 1]]) {
        await page.getByTestId('room-scroller').evaluate((el, f) => (el.scrollLeft = (el.scrollWidth - el.clientWidth) * f), frac)
        await shot(page, `home-room-${label}`, key, 300)
      }
      await page.getByTestId('room-scroller').evaluate((el) => (el.scrollLeft = el.scrollWidth * 0.3 - el.clientWidth / 2))
    }
    // 星星飛進點數膠囊（模擬家長剛審核通過：上次看到 20 點、現在 120 點）
    await page.evaluate(() => localStorage.setItem('gq-points-seen', '20'))
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await shot(page, 'home-stars-fly', key, 1050)
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: /佈置/ }).click()
    await shot(page, 'home-edit', key)
    await page.getByRole('button', { name: /完成/ }).click()
    for (const [label, name] of [['今日任務', 'tasks'], ['商店', 'shop'], ['背包', 'bag'], ['著色本', 'coloring'], ['冒險地圖', 'map']]) {
      await page.locator('.candy, .mini-candy').filter({ hasText: label }).first().click()
      await shot(page, name, key)
      if (name === 'shop') {
        await page.getByRole('tab', { name: '著色頁' }).click()
        await shot(page, 'shop-coloring', key)
      }
      if (name === 'coloring') {
        await page.locator('.thumb-btn').first().click()
        await page.waitForSelector('.paint-svg')
        await page.locator('.swatch').nth(3).click()
        await page.locator('.paint-svg path.region').nth(2).click()
        await shot(page, 'paint', key)
      }
      await home(page)
    }
    await page.locator('.candy, .mini-candy').filter({ hasText: '工坊' }).first().click()
    await shot(page, 'workshop-placeholder', key)
    await home(page)
    // 家長
    await page.getByRole('button', { name: /家長入口/ }).click()
    await page.waitForSelector('button.key')
    await shot(page, 'parent-pin', key)
    await page.evaluate(async () => {
      for (const d of '1234') [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
      await new Promise((r) => setTimeout(r, 300))
    })
    await page.waitForSelector('.tabs')
    await shot(page, 'parent-review', key)
    const tabs = await page.locator('.tab').allInnerTexts()
    for (const t of tabs.slice(1)) {
      await page.getByRole('tab', { name: t }).click()
      await shot(page, `parent-${tabs.indexOf(t)}`, key)
    }
    await ctx.close()
  }

  // egg 與孵化慶祝（只拍 1024 / 375）
  for (const key of ['land', 'phone']) {
    const { ctx, page } = await setup(browser, SIZES[key], { stage: 'egg', feed: 19, place: false })
    await shot(page, 'home-egg-crack', key)
    await page.mouse.move(0, 0)
    await page.locator('[data-dock-item=banana]').click()
    await page.waitForSelector('.celebrate')
    await page.waitForTimeout(1700)
    await shot(page, 'celebrate-burst', key)
    await page.waitForSelector('.celebrate-btn')
    await shot(page, 'celebrate-new', key)
    await ctx.close()
  }
  // baby（缺圖 fallback）
  {
    const { ctx, page } = await setup(browser, SIZES.land, { stage: 'baby', feed: 30 })
    await shot(page, 'home-baby-fallback', 'land')
    await ctx.close()
  }
} finally {
  await browser.close()
}
