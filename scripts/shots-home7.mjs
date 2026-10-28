// v7 線 C 截圖與點擊範圍檢查：iPad 橫向 / 直向 / 手機，存到 design/reviews/v7-home-shots/。
// 用法：BASE_URL=http://localhost:5192 node scripts/shots-home7.mjs [--audit-only]
// 同時列出各畫面上小於 56px 的按鈕（C6）。
import { launch, freshApp, openParentTab, pressPin, idb, patchPet, BASE } from './e2e-lib.mjs'
import { mkdirSync } from 'node:fs'

const OUT = 'design/reviews/v7-home-shots'
mkdirSync(OUT, { recursive: true })
const VPS = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const auditOnly = process.argv.includes('--audit-only')
let small = 0

const putRows = (page, store, rows) =>
  idb(page, (db, a) => new Promise((r) => { const tx = db.transaction(a.store, 'readwrite'); for (const row of a.rows) tx.objectStore(a.store).put(row); tx.oncomplete = () => r(1) }), { store, rows })
const reload = async (page) => {
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
}
const shot = async (page, name, tag) => {
  if (!auditOnly) await page.screenshot({ path: `${OUT}/${name}-${tag}.png` })
}
/** 目前畫面上所有可點的東西，小於 56px（任一邊）的列出來 */
async function audit(page, label) {
  const bad = await page.evaluate(() => {
    const sel = 'button, a[href], [role=button], [role=tab], [role=radio], input[type=checkbox], summary, .dock-item'
    const out = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
      if (el.closest('.sr-only')) continue
      if (r.right < 0 || r.left > innerWidth) continue // 橫向捲動區外的
      if (r.width < 55.5 || r.height < 55.5) out.push(`${(el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 18)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    return out
  })
  small += bad.length
  console.log(`${bad.length ? 'SMALL' : 'ok   '} ${label}${bad.length ? '  ' + bad.join(' | ') : ''}`)
}

const browser = await launch()
try {
  for (const [tag, vp] of Object.entries(VPS)) {
    console.log(`\n=== ${tag} ${vp.width}x${vp.height}`)
    // ---- onboarding 年齡頁 ----
    {
      const ctx = await browser.newContext({ viewport: vp })
      const page = await ctx.newPage()
      await page.goto(BASE)
      await page.waitForSelector('button.key')
      await pressPin(page, '1234')
      await pressPin(page, '1234')
      await page.getByPlaceholder('小朋友的名字').fill('小明')
      await page.getByRole('button', { name: '下一步' }).click()
      await page.waitForSelector('[data-testid=onboard-age]')
      await page.waitForTimeout(300)
      await shot(page, 'onboarding-age', tag)
      await audit(page, 'onboarding 年齡頁')
      await ctx.close()
    }
    // ---- 首頁：蛋、禮物袋 ----
    const { ctx, page } = await freshApp(browser, vp, { stage: 'egg', welcome: true, bananas: 3 })
    await patchPet(page, { feedCount: 0, hunger: 90, hungerUpdatedAt: Date.now() })
    await reload(page)
    await page.waitForSelector('[data-testid=gift-bag]')
    await page.waitForTimeout(500)
    await shot(page, 'gift-bag-before', tag)
    await audit(page, '首頁（有禮物袋）')
    await page.getByTestId('gift-bag').click()
    await page.waitForTimeout(450)
    await shot(page, 'gift-bag-collecting', tag)
    await page.waitForSelector('[data-testid=gift-bag]', { state: 'detached' })
    await page.waitForTimeout(1500)
    await shot(page, 'gift-bag-after', tag)
    for (const feed of [0, 8, 15, 19]) {
      await patchPet(page, { feedCount: feed, hunger: 90, hungerUpdatedAt: Date.now() })
      await reload(page)
      await page.waitForTimeout(500)
      await shot(page, `egg-${feed}`, tag)
    }
    // 佈置：空狀態
    await page.getByRole('button', { name: /佈置/ }).click()
    await page.waitForSelector('[data-testid=dock-empty]')
    await page.waitForTimeout(300)
    await shot(page, 'edit-empty', tag)
    await audit(page, '佈置空狀態')
    await page.getByRole('button', { name: /完成/ }).click()
    // 多個家具 + 換色
    await putRows(page, 'inventory', [
      { id: 'decor-ball', itemId: 'decor-ball', qty: 3 },
      { id: 'decor-plant', itemId: 'decor-plant', qty: 2 },
      { id: 'decor-lamp', itemId: 'decor-lamp', qty: 1 },
      { id: 'decor-clock', itemId: 'decor-clock', qty: 1 },
    ])
    await reload(page)
    await page.getByRole('button', { name: /佈置/ }).click()
    await page.waitForSelector('[data-dock-item=decor-plant]')
    await shot(page, 'edit-dock-multi', tag)
    // 擺 3 個玩具球、2 個盆栽，各自換色，位置用拖曳錯開
    const room = await page.getByTestId('room-scroller').boundingBox()
    const place = async (id, fx, fy, tint) => {
      const el = page.locator(`[data-dock-item=${id}]`).first()
      const b = await el.boundingBox()
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(room.x + room.width * fx, room.y + room.height * fy, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(250)
      for (let i = 0; i < tint; i++) await page.getByTestId('tint-btn').click({ timeout: 3000 }).catch(() => {})
    }
    await place('decor-plant', 0.28, 0.78, 1)
    await place('decor-plant', 0.62, 0.78, 3)
    await place('decor-ball', 0.4, 0.88, 2)
    await place('decor-ball', 0.48, 0.88, 4)
    await place('decor-ball', 0.56, 0.9, 0)
    await place('decor-clock', 0.45, 0.3, 0)
    await page.locator('.room-scroll').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {})
    await page.waitForTimeout(300)
    await shot(page, 'decor-tint-multi', tag)
    await audit(page, '佈置模式（家具已擺）')
    await ctx.close()

    // ---- 掛畫位置 ----
    {
      const { ctx, page } = await freshApp(browser, vp, {})
      const png = await page.evaluate(() => {
        const c = document.createElement('canvas')
        c.width = c.height = 96
        const x = c.getContext('2d')
        const g = x.createLinearGradient(0, 0, 96, 96)
        g.addColorStop(0, '#ffb347')
        g.addColorStop(1, '#ff6fa5')
        x.fillStyle = g
        x.fillRect(0, 0, 96, 96)
        return c.toDataURL('image/png')
      })
      await putRows(page, 'coloring', [1, 2, 3].map((i) => ({ pageId: `g:w${i}`, basePageId: 'monkey', fills: { a: '#f00' }, png, createdAt: i, updatedAt: i })))
      await page.goto(`${BASE}#gallery`)
      await page.reload()
      await page.waitForSelector('[data-testid=gallery-item]')
      for (let i = 0; i < 3; i++) {
        await page.locator('.gallery-thumb').nth(i).click()
        await page.getByTestId('hang-btn').click()
        await page.locator('.modal-back').click({ position: { x: 5, y: 5 } })
        await page.waitForTimeout(200)
      }
      await page.goto(BASE)
      await page.waitForSelector('[data-testid=room]')
      await page.waitForTimeout(900)
      await shot(page, 'hung-art', tag)
      await ctx.close()
    }

    // ---- 家長區：切換孩子、分頁列；選孩子畫面 ----
    {
      const { ctx, page } = await freshApp(browser, vp, {})
      await openParentTab(page, '設定')
      await page.getByTestId('kid-add').click()
      await page.getByTestId('kid-name').fill('二寶')
      await page.getByTestId('child-age-3').click()
      await page.getByTestId('kid-add-submit').click()
      await page.waitForSelector('[data-testid=child-chips]')
      await page.waitForTimeout(3000)
      await page.getByRole('tab', { name: '本週', exact: true }).click()
      await page.waitForTimeout(500)
      await shot(page, 'parent-weekly-chips', tag)
      await page.getByTestId('child-chip').nth(1).click()
      await page.waitForTimeout(600)
      await shot(page, 'parent-switch-child', tag)
      await audit(page, '家長區（頂端 chips + 分頁）')
      await page.getByRole('tab', { name: '設定', exact: true }).click()
      await page.waitForTimeout(500)
      await shot(page, 'parent-settings-roster', tag)
      await page.getByRole('button', { name: '回到小孩模式' }).click()
      await page.waitForSelector('[data-testid=pet]')
      await page.getByTestId('switch-person').click()
      await page.getByTestId('switch-yes').click()
      await page.waitForSelector('[data-testid=child-picker]')
      await page.waitForTimeout(500)
      await shot(page, 'picker', tag)
      await audit(page, '選孩子畫面')
      await ctx.close()
    }

    // ---- 其他畫面的點擊範圍：商店各分頁、工坊、背包 ----
    {
      const { ctx, page } = await freshApp(browser, vp, { decor: ['decor-ball'] })
      await putRows(page, 'materialLedger', ['wood', 'stone', 'flower'].map((m, i) => ({ id: `m${i}`, at: Date.now(), material: m, delta: 12, kind: 'station', reason: 't' })))
      await putRows(page, 'ledger', [{ id: 'l1', at: Date.now(), delta: 300, reason: 'x', kind: 'bonus' }])
      await page.goto(`${BASE}#workshop`)
      await page.reload()
      await page.waitForSelector('[data-testid=workshop]')
      await page.waitForTimeout(400)
      await shot(page, 'workshop', tag)
      await audit(page, '工坊（家具）')
      await page.getByTestId('ws-tab-wall').click()
      await audit(page, '工坊（壁紙）')
      await page.goto(BASE)
      await page.waitForSelector('[data-testid=room]')
      await page.locator('.candy.peach').click()
      await page.waitForSelector('[data-testid=shop-grid-food]')
      await audit(page, '商店（飼料）')
      await page.getByRole('tab', { name: '衣櫃' }).click()
      await audit(page, '商店（衣櫃）')
      await page.getByRole('button', { name: /返回|←|回/ }).first().click().catch(() => {})
      await page.goto(BASE)
      await page.waitForSelector('[data-testid=room]')
      await page.locator('.mini-candy.bubblegum').click()
      await page.waitForTimeout(400)
      await audit(page, '背包')
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
console.log(small ? `\n${small} 個小於 56px 的點擊目標` : '\n所有檢查的畫面都沒有小於 56px 的點擊目標')
