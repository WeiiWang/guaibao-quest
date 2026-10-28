// 觸控目標稽核：逐畫面列出小於 56px 的可點元素（按鈕、role=button、tab、radio…）。
// 用法：先啟動 dev server，再 BASE_URL=http://localhost:5181 node scripts/audit-targets.mjs
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:5181'
function findChrome() {
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const p = join(root, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(p)) return p
  }
}
const browser = await chromium.launch({ executablePath: findChrome() })
let bad = 0
const MIN = 56
for (const vp of [{ width: 1024, height: 768 }, { width: 375, height: 812 }]) {
  const ctx = await browser.newContext({ viewport: vp, ...(vp.width < 500 ? { hasTouch: true, isMobile: true } : {}) })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForSelector('button.key')
  const press = async (pin) => page.evaluate(async (p) => { for (const d of p) [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click(); await new Promise((r) => setTimeout(r, 200)) }, pin)
  await press('1234'); await press('1234')
  await page.getByPlaceholder('小朋友的名字').fill('小明')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByTestId('onboard-age-skip').click() // v7：onboarding 多一頁「幾歲」；舊測試選「之後再設定」，維持年齡未設定的前提
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '開始冒險' }).click()
  await page.waitForSelector('[data-testid=room]')
  await page.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open('guaibao-quest')
    rq.onsuccess = () => {
      const tx = rq.result.transaction(['inventory'], 'readwrite')
      const inv = tx.objectStore('inventory')
      inv.put({ id: 'banana', itemId: 'banana', qty: 3 })
      for (const id of ['decor-plant', 'decor-ball', 'coloring-monkey']) inv.put({ id, itemId: id, qty: 1 })
      tx.oncomplete = () => res(1)
    }
  }))
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  const scan = async (label) => {
    await page.waitForTimeout(350)
    const small = await page.evaluate((MIN) => {
      const out = []
      for (const el of document.querySelectorAll('button, [role=button], [role=tab], [role=radio], [role=switch], a[href], select, input:not([type=hidden])')) {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
        if (r.width < MIN - 0.5 || r.height < MIN - 0.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
      return out
    }, MIN)
    bad += small.length
    console.log(`${small.length ? 'WARN' : 'ok  '} ${vp.width}  ${label}${small.length ? '\n   ' + small.join('\n   ') : ''}`)
  }
  const goHome = async () => { for (let i = 0; i < 3 && !(await page.locator('[data-testid=room]').count()); i++) { await page.locator('button.back, button[aria-label=離開關卡]').first().click(); await page.waitForTimeout(200) } }
  await scan('首頁')
  await page.getByRole('button', { name: /佈置/ }).click(); await scan('首頁佈置模式')
  await page.getByRole('button', { name: /完成/ }).click()
  for (const [btn, label] of [['今日任務', '任務'], ['商店', '商店'], ['背包', '背包'], ['著色本', '著色本'], ['冒險地圖', '冒險地圖'], ['工坊', '工坊']]) {
    await page.locator('.candy, .mini-candy').filter({ hasText: btn }).first().click()
    await scan(label)
    if (label === '商店') { await page.getByRole('tab', { name: '著色頁' }).click(); await scan('商店-著色頁') }
    if (label === '著色本') { await page.locator('.thumb-btn').first().click(); await page.waitForSelector('.paint-svg'); await scan('著色畫面') }
    if (label === '冒險地圖') { await page.getByTestId('station-1').click(); await page.waitForSelector('[data-testid=question]'); await scan('答題') }
    await goHome()
  }
  await page.getByRole('button', { name: /家長入口/ }).click()
  await page.waitForSelector('button.key'); await scan('PIN')
  await press('1234'); await page.waitForSelector('.tabs')
  for (const t of await page.locator('.tab').allInnerTexts()) { await page.getByRole('tab', { name: t }).click(); await scan(`家長-${t}`) }
  await ctx.close()
}
await browser.close()
console.log(bad ? `\n${bad} 個元素小於 ${MIN}px` : '\n全部 ≥ 56px')
