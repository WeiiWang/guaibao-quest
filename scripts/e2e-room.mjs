// 房間互動 E2E 回歸測試（Playwright）。
// 用法：先啟動 dev server（例如 pnpm dev --port 5181 --strictPort），再
//   BASE_URL=http://localhost:5181 node scripts/e2e-room.mjs
// 需要 Chromium：預設找 ~/Library/Caches/ms-playwright 內已安裝的，或用 CHROME_PATH 指定。
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:5181'

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(root)) return undefined
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const p = join(root, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(p)) return p
  }
  return undefined
}

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`)
  if (!ok) failed++
}

const DECOR = ['decor-clock', 'decor-ball', 'decor-plant', 'decor-crate', 'decor-poster', 'decor-curtain', 'decor-rug', 'decor-shelf', 'decor-frame', 'decor-bed']

async function freshApp(browser, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts })
  // v3：阿悟晚上會睡覺。固定成白天，測試才不會受真實時間影響（日夜行為在 e2e-pet.mjs 測）
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gq-pet-tod', 'day')
    } catch {
      /* ignore */
    }
  })
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
  await page.getByPlaceholder('小朋友的名字').fill('小明')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '開始冒險' }).click()
  await page.waitForSelector('[data-testid=room]')
  await page.evaluate(
    ([decor]) =>
      new Promise((res) => {
        const rq = indexedDB.open('guaibao-quest')
        rq.onsuccess = () => {
          const tx = rq.result.transaction(['inventory'], 'readwrite')
          const inv = tx.objectStore('inventory')
          inv.put({ id: 'banana', itemId: 'banana', qty: 3 })
          for (const id of decor) inv.put({ id, itemId: id, qty: 1 })
          tx.oncomplete = () => res(1)
        }
      }),
    [DECOR],
  )
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  return { ctx, page }
}

const center = async (page, sel) => {
  await page.locator(sel).first().scrollIntoViewIfNeeded()
  const b = await page.locator(sel).first().boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}
const drag = async (page, from, to, { hold = false } = {}) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 10, from.y - 40, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 10 })
  if (hold) return
  await page.mouse.up()
  await page.waitForTimeout(250)
}
const editClass = (page) => page.locator('.room-frame').getAttribute('class')

const browser = await chromium.launch({ executablePath: findChrome() })
try {
  // 1) 首次餵食（有提示）後，「佈置」按鈕必須可用，並可反覆切換
  {
    const { ctx, page } = await freshApp(browser, { width: 1024, height: 768 })
    check('首次進首頁顯示一次性餵食提示', (await page.getByTestId('feed-hint').count()) === 1)
    const a = await center(page, '[data-dock-item=banana]')
    const p = await center(page, '[data-testid=pet]')
    await drag(page, a, p)
    check('拖香蕉到寵物：數量 3 → 2', (await page.locator('[data-dock-item=banana] .dock-sub').innerText()) === 'x2')
    check('餵食後提示消失', (await page.getByTestId('feed-hint').count()) === 0)
    await page.waitForTimeout(1500)
    const states = []
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: /佈置|完成/ }).click()
      await page.waitForTimeout(250)
      states.push((await editClass(page)).includes('editing') ? 'E' : '-')
    }
    check('餵食後「佈置」可反覆切換', states.join('') === 'E-E-', states.join(''))
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    check('重新整理後提示不再出現（已記在 settings）', (await page.getByTestId('feed-hint').count()) === 0)
    await ctx.close()
  }

  // 2) 拖到空白處不消耗；放不下的位置會標紅，放開後吸回合法位置
  {
    const { ctx, page } = await freshApp(browser, { width: 1024, height: 768 })
    const a = await center(page, '[data-dock-item=banana]')
    await drag(page, a, { x: 700, y: 150 })
    check('拖香蕉到空白處：數量不變', (await page.locator('[data-dock-item=banana] .dock-sub').innerText()) === 'x3')
    await page.getByRole('button', { name: /佈置/ }).click()
    const frame = await center(page, '[data-dock-item=decor-frame]')
    await drag(page, frame, { x: 500, y: 420 }, { hold: true })
    check('牆面類拖到地板：預覽變紅並顯示「這裡放不下」', (await page.locator('.drop-preview[data-invalid]').count()) === 1 && (await page.getByText('這裡放不下').count()) === 1)
    await page.mouse.up()
    await page.waitForTimeout(300)
    const y = await page.evaluate(() => new Promise((res) => { const rq = indexedDB.open('guaibao-quest'); rq.onsuccess = () => { const g = rq.result.transaction('placements').objectStore('placements').get('decor-frame'); g.onsuccess = () => res(g.result.y) } }))
    check('放開後吸回牆面範圍 (y < 0.62)', y < 0.62, String(y))
    const clock = await center(page, '[data-dock-item=decor-clock]')
    await drag(page, clock, { x: 420, y: 160 }, { hold: true })
    check('合法位置不標紅', (await page.locator('.drop-preview[data-invalid]').count()) === 0)
    await page.mouse.up()
    await ctx.close()
  }

  // 3) 375 寬：道具列左右漸層、工具列不蓋住物件、拖飼料時寵物捲進視野
  {
    const { ctx, page } = await freshApp(browser, { width: 375, height: 812 }, { hasTouch: true, isMobile: true })
    const sc = page.getByTestId('room-scroller')
    // 把房間捲到最右（寵物不在可視範圍），再開始拖飼料
    await sc.evaluate((el) => (el.scrollLeft = el.scrollWidth))
    await page.waitForTimeout(200)
    const before = await sc.evaluate((el) => Math.round(el.scrollLeft))
    const a = await center(page, '[data-dock-item=banana]')
    await drag(page, a, { x: 200, y: 250 }, { hold: true })
    await page.waitForTimeout(900)
    const after = await sc.evaluate((el) => Math.round(el.scrollLeft))
    const petVisible = await page.evaluate(() => {
      const r = document.querySelector('[data-testid=pet]').getBoundingClientRect()
      const s = document.querySelector('[data-testid=room-scroller]').getBoundingClientRect()
      return r.left >= s.left - 1 && r.right <= s.right + 1
    })
    check('開始拖飼料時寵物不在視野 → 自動捲到寵物', after < before && petVisible, `${before} → ${after}`)
    await page.mouse.up()
    await page.waitForTimeout(400)

    await page.getByRole('button', { name: /佈置/ }).click()
    await page.waitForTimeout(300)
    check('道具列可橫向捲動時出現右側漸層', (await page.getByTestId('dock-fade-right').count()) === 1)
    await page.getByTestId('dock').evaluate((el) => (el.scrollLeft = el.scrollWidth))
    await page.waitForTimeout(200)
    check('捲到底後出現左側漸層、右側消失', (await page.getByTestId('dock-fade-left').count()) === 1 && (await page.getByTestId('dock-fade-right').count()) === 0)

    // 放一個東西並選取，檢查工具列與物件不重疊
    await page.getByTestId('dock').evaluate((el) => (el.scrollLeft = 0))
    const ball = await center(page, '[data-dock-item=decor-ball]')
    const rm = await sc.boundingBox()
    await drag(page, ball, { x: 190, y: rm.y + rm.height - 70 })
    await page.waitForSelector('.decor-toolbar')
    const overlap = await page.evaluate(() => {
      const t = document.querySelector('.decor-toolbar').getBoundingClientRect()
      const o = document.querySelector('[data-placed=decor-ball]').getBoundingClientRect()
      return !(t.right <= o.left || t.left >= o.right || t.bottom <= o.top || t.top >= o.bottom)
    })
    check('選取物件後，工具列不蓋住物件本體', !overlap)
    await ctx.close()
  }

  // 4) 3D 軟膠版面：三種尺寸首頁不橫向溢出、四顆糖果鈕都在畫面內；大型家具丟到角落仍會被 clamp 在房間內
  for (const vp of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
    const { ctx, page } = await freshApp(browser, vp, vp.width < 500 ? { hasTouch: true, isMobile: true } : {})
    const label = `${vp.width}x${vp.height}`
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(`${label} 首頁沒有橫向溢出`, overflow <= 0, String(overflow))
    const navOk = await page.evaluate(() => [...document.querySelectorAll('.candy')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight + 1 }))
    check(`${label} 四顆糖果按鈕都在畫面內`, navOk)
    await page.getByRole('button', { name: /佈置/ }).click()
    const sc = page.getByTestId('room-scroller')
    const rm = await sc.boundingBox()
    const bed = await center(page, '[data-dock-item=decor-bed]')
    await drag(page, bed, { x: rm.x + rm.width - 2, y: rm.y + rm.height - 2 })
    await page.waitForSelector('[data-placed=decor-bed]')
    const inside = await page.evaluate(() => {
      const o = document.querySelector('[data-placed=decor-bed]').getBoundingClientRect()
      const r = document.querySelector('[data-testid=room]').getBoundingClientRect()
      return o.left >= r.left - 1 && o.right <= r.right + 1 && o.top >= r.top - 1 && o.bottom <= r.bottom + 1
    })
    check(`${label} 大型家具（床）丟到角落仍在房間範圍內`, inside)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(failed ? `\n${failed} 項失敗` : '\n全部通過')
process.exit(failed ? 1 : 0)
