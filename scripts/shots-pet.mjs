// 阿悟動畫關鍵影格截圖（Playwright）。
// 用 Playwright 的假時鐘（page.clock）把場景計時器停住，再一格一格往前推，所以每個影格都抓得準。
// 用法：先啟動 dev server（pnpm dev --port 5182 --strictPort），再
//   SHOT_DIR=design/screens BASE_URL=http://localhost:5182 node scripts/shots-pet.mjs
// 輸出 v3-pet-<名稱>.png（寵物周圍的特寫，2 倍解析度）與 v3-pet-full-<名稱>.png（整個首頁）。
import { writeFileSync } from 'node:fs'
import { launch, freshApp, pmTrigger, pmSetTod, center, drag } from './e2e-lib.mjs'

const DIR = process.env.SHOT_DIR ?? 'design/screens'
const browser = await launch()
const VP = { width: 1024, height: 768 }

const sessions = new WeakMap()
/** 用 CDP 直接截圖；clip.scale=2 取得 2 倍解析度 */
async function cropAround(page, name, { full = false } = {}) {
  let cdp = sessions.get(page)
  if (!cdp) {
    cdp = await page.context().newCDPSession(page)
    sessions.set(page, cdp)
  }
  const r = await page.evaluate(() => {
    const b = document.querySelector('[data-testid=pet-slot]').getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height }
  })
  const pad = { l: 200, r: 320, t: 130, b: 50 }
  const clip = { x: Math.max(0, r.x - pad.l), y: Math.max(0, r.y - pad.t), width: r.w + pad.l + pad.r, height: r.h + pad.t + pad.b, scale: 2 }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip })
  writeFileSync(`${DIR}/v3-pet-${name}.png`, Buffer.from(data, 'base64'))
  if (full) {
    const f = await cdp.send("Page.captureScreenshot", { format: "png" })
    writeFileSync(`${DIR}/v3-pet-full-${name}.png`, Buffer.from(f.data, "base64"))
  }
  console.log('shot', name)
}

/** 假時鐘往前推 ms，再讓 CSS 動畫用真實時間走一小段 */
const adv = async (page, ms, real = 90) => {
  await page.clock.runFor(ms)
  await page.waitForTimeout(real)
}
/** 重新載入並把時鐘停住（之後所有計時器都要靠 adv 推進） */
async function freeze(page) {
  await page.clock.install()
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await page.waitForTimeout(300)
  await page.clock.pauseAt(new Date(Date.now() + 2000))
}
/** 從頁面（可能在家長區）回到首頁，並讓 PM 指令跑起來 */
const pm = async (page, cmd) => {
  // 家長區的操作（PIN、切分頁）需要頁面計時器，先讓時鐘恢復流動，回到首頁後再停住
  await page.clock.resume()
  await pmTrigger(page, cmd)
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(new Date(now + 20))
  await adv(page, 400)
}

try {
  // ---- 吃東西（成體）----
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.1, bananas: 9 })
    await freeze(page)
    const a = await center(page, '[data-dock-item=banana]')
    const p = await center(page, '[data-testid=pet]')
    await drag(page, a, p, { hold: true })
    await page.waitForTimeout(250)
    await cropAround(page, 'eat-1-open-mouth', { full: true })
    await page.mouse.up()
    await page.waitForTimeout(400) // 真實時間：DB 寫入 + 渲染
    await adv(page, 140, 60)
    await cropAround(page, 'eat-2-fly')
    await adv(page, 400, 150) // bite 1（EAT_FLY 320 + 130）
    await cropAround(page, 'eat-3-chew1')
    await adv(page, 330, 120)
    await cropAround(page, 'eat-4-chew2', { full: true })
    await adv(page, 660, 120) // 吞下去
    await cropAround(page, 'eat-5-gulp')
    await adv(page, 400, 120)
    await cropAround(page, 'eat-6-burp', { full: true })
    await ctx.close()
  }
  // ---- 幼體 / 蛋 ----
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9, stage: 'baby' })
    await freeze(page)
    const a = await center(page, '[data-dock-item=banana]')
    const p = await center(page, '[data-testid=pet]')
    await drag(page, a, p)
    await page.waitForTimeout(400)
    await adv(page, 850, 120)
    await cropAround(page, 'baby-eat-chew')
    await ctx.close()
  }
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9, stage: 'egg' })
    await freeze(page)
    const a = await center(page, '[data-dock-item=banana]')
    const p = await center(page, '[data-testid=pet]')
    await drag(page, a, p)
    await page.waitForTimeout(400)
    await adv(page, 400, 150)
    await cropAround(page, 'egg-absorb')
    await adv(page, 400, 100)
    await cropAround(page, 'egg-glow')
    await ctx.close()
  }
  // ---- 自主行為 ----
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9 })
    await freeze(page)
    for (const [cmd, wait, name] of [
      ['sing', 700, 'sing'],
      ['dance', 600, 'dance'],
      ['sneeze', 1100, 'sneeze'],
      ['wave', 300, 'wave'],
      ['yawn', 500, 'yawn'],
      ['gaze', 900, 'gaze'],
      ['pinchNose', 400, 'pinch-nose'],
    ]) {
      await pm(page, cmd)
      await adv(page, wait)
      await cropAround(page, name)
      await adv(page, 4000, 50)
    }
    await pm(page, 'poop')
    await adv(page, 500, 100)
    await cropAround(page, 'poop-squat')
    await adv(page, 800, 200)
    await cropAround(page, 'poop-pop', { full: true })
    await adv(page, 2500, 100)
    await cropAround(page, 'poop-idle', { full: true })
    const poop = await center(page, '[data-testid=poop]')
    await page.mouse.click(poop.x, poop.y)
    await adv(page, 400, 100)
    await cropAround(page, 'poop-bubble')
    await adv(page, 350, 100)
    await cropAround(page, 'poop-burst')
    await adv(page, 350, 100)
    await cropAround(page, 'poop-thanks', { full: true })
    await ctx.close()
  }
  // ---- 互動 ----
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9 })
    await freeze(page)
    const p = await center(page, '[data-testid=pet]')
    await page.mouse.click(p.x, p.y)
    await adv(page, 100)
    await cropAround(page, 'tap-giggle')
    await adv(page, 2500, 50)
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(p.x, p.y)
      await adv(page, 120, 40)
    }
    await adv(page, 400)
    await cropAround(page, 'tickle')
    await adv(page, 3000, 50)
    for (let i = 0; i < 6; i++) {
      await page.mouse.click(p.x, p.y)
      await adv(page, 110, 40)
    }
    await adv(page, 400)
    await cropAround(page, 'dizzy-spin')
    await adv(page, 1000)
    await cropAround(page, 'dizzy', { full: true })
    await adv(page, 4000, 50)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await adv(page, 1300)
    await cropAround(page, 'pat')
    await page.mouse.up()
    await ctx.close()
  }
  // ---- 睡覺 ----
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9, decor: ['decor-bed'] })
    await pmSetTod(page, 'night')
    await page.waitForTimeout(500)
    await cropAround(page, 'sleep-floor', { full: true })
    await page.getByRole('button', { name: /佈置/ }).click()
    const bed = await center(page, '[data-dock-item=decor-bed]')
    await drag(page, bed, { x: 330, y: 480 }, { settle: 500 })
    await page.getByRole('button', { name: /完成/ }).click()
    await page.waitForTimeout(1800)
    await cropAround(page, 'sleep-bed', { full: true })
    const p = await center(page, '[data-testid=pet]')
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(400)
    await cropAround(page, 'wake')
    await ctx.close()
  }
  // ---- 小螢幕 ----
  {
    const { ctx, page } = await freshApp(browser, { width: 375, height: 812 }, { rand: 0.9, ctxOpts: { hasTouch: true, isMobile: true } })
    await pmTrigger(page, 'sing')
    await page.waitForSelector('[data-testid=fx-notes]', { state: 'attached' })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${DIR}/v3-pet-full-mobile-sing.png` })
    await page.waitForTimeout(3300)
    await pmTrigger(page, 'poop')
    await page.waitForSelector('[data-testid=poop]', { state: 'attached' })
    await page.waitForTimeout(2300)
    await page.screenshot({ path: `${DIR}/v3-pet-full-mobile-poop.png` })
    await ctx.close()
  }
} finally {
  await browser.close()
}
