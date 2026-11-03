// v8 線 N E2E：開場畫面、雲朵轉場、錯誤邊界、持久儲存、落蛋與選寵物、按鈕手感、啟動畫面、無橫向溢出。
// 用法：BASE_URL=http://localhost:5192 node scripts/e2e-shell.mjs        （E2E_BROWSER=webkit 用 WebKit）
// 開場畫面在自動化瀏覽器預設跳過，這裡用 localStorage gq-title-test=1 打開（比照語音包的 gq-voice-pack-test）。
import { launch, makeChecker, freshApp, pressPin, openParentTab, BASE, IPAD_CTX } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const LAND = { width: 1180, height: 820 }
const PORT = { width: 820, height: 1180 }
const PHONE = { width: 390, height: 844 }
const SMALL = { width: 360, height: 640 }
const VIEWPORTS = { 'iPad 橫向': LAND, 'iPad 直向': PORT, '手機 390x844': PHONE, '手機 360x640': SMALL }

const errors = []
const unexpected = (t) => !/crash-probe|The above error occurred|old-1234\.js/.test(t)
/** 預期內的錯誤（#crash 故意丟的）不算 */
const watch = (page) => {
  page.on('pageerror', (e) => unexpected(String(e)) && errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/Failed to load resource/.test(t) || !unexpected(t)) return
    errors.push(t)
  })
}

/** 開了 gq-title-test 的全新 context（會先看到開場畫面）。persistProbe：數 navigator.storage.persist 被呼叫幾次 */
async function titleCtx(browser, vp, { reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: vp, ...IPAD_CTX, ...(reduced ? { reducedMotion: 'reduce' } : {}) })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gq-title-test', '1')
    } catch {
      /* ignore */
    }
    window.__persistCalls = 0
    try {
      // 改在 prototype 上數（WebKit 每次讀 navigator.storage 可能拿到新的包裝物件，改實例會漏數）
      const proto = Object.getPrototypeOf(navigator.storage)
      const orig = proto.persist
      proto.persist = function () {
        window.__persistCalls++
        return orig.call(this)
      }
    } catch {
      /* ignore */
    }
  })
  const page = await ctx.newPage()
  watch(page)
  return { ctx, page }
}

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1)
const box = (page, sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect()
    return r ? { w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom } : null
  }, sel)
const inViewport = (b, vp) => !!b && b.l >= -1 && b.r <= vp.width + 1 && b.t >= -1 && b.b <= vp.height + 1

/** 從開場一路走到「確認頁」（有蛋、有開始冒險鈕） */
async function toEggStep(page, species = 'rabbit') {
  await page.getByTestId('title-start').click()
  await page.waitForSelector('button.key')
  await pressPin(page, '1234')
  await pressPin(page, '1234')
  await page.getByPlaceholder('小朋友的名字').fill('小明')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByTestId('onboard-age-skip').click()
  await page.waitForSelector('[data-testid=onboard-species]')
  await page.getByTestId(`species-${species}`).click()
  await page.getByTestId('onboard-species-next').click()
  await page.waitForSelector('.egg-step')
}

const browser = await launch()
try {
  // ================= 1) 開場畫面：四種尺寸 =================
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const { ctx, page } = await titleCtx(browser, vp)
    await page.goto(BASE)
    await page.waitForSelector('[data-testid=title]')
    await page.waitForTimeout(1600)
    const btn = await box(page, '[data-testid=title-start]')
    check(`[${name}] 開場：有開始鈕，≥ 96px 高、在畫面內`, !!btn && btn.h >= 96 && btn.w >= 96 && inViewport(btn, vp), JSON.stringify(btn))
    check(`[${name}] 開場：沒有橫向溢出`, await noOverflow(page))
    const logo = await page.evaluate(() => {
      const t = document.querySelector('[data-testid=title]')
      const img = t.querySelector('.title-logo-img')
      const shown = img && !img.hidden && img.naturalWidth > 0
      const word = t.querySelector('.title-wordmark')
      const r = (shown ? img : word)?.getBoundingClientRect()
      return { kind: shown ? 'img' : word ? 'text' : 'none', w: r?.width ?? 0, h: r?.height ?? 0, r: r?.right ?? 0, l: r?.left ?? 0 }
    })
    check(`[${name}] 開場：Logo 顯示（圖或文字退路）且不超出畫面`, logo.kind !== 'none' && logo.w > 120 && logo.l >= 0 && logo.r <= vp.width + 1, JSON.stringify(logo))
    check(`[${name}] 開場：名冊與 PIN 還沒出現（先看到品牌）`, (await page.locator('button.key').count()) === 0)
    await page.screenshot({ path: `/private/tmp/claude-501/line-n/e2e-title-${vp.width}x${vp.height}.png` }).catch(() => undefined)
    await ctx.close()
  }

  // ================= 2) 開始 → PIN；點畫面任何位置也算開始；storage.persist =================
  {
    const { ctx, page } = await titleCtx(browser, LAND)
    await page.goto(BASE)
    await page.waitForSelector('[data-testid=title]')
    check('開場：冷啟動時有 persist 要求（啟動時呼叫一次）', (await page.evaluate(() => window.__persistCalls)) >= 1)
    // 點背景（不是按鈕）
    await page.mouse.click(40, 400)
    await page.waitForSelector('button.key')
    check('點畫面任何位置 → 開場消失、進到 PIN 設定', (await page.locator('[data-testid=title]').count()) === 0 && (await page.locator('button.key').count()) > 0)
    check('按下開始：再要求一次 persist（有使用者操作；已經是持久的就不再要）', (await page.evaluate(async () => window.__persistCalls >= 2 || (await navigator.storage.persisted()))))
    const banner = await page.getByTestId('onboard-parent-only').textContent()
    check('PIN 設定頁清楚寫「這一步請爸媽來」', /這一步請爸媽來/.test(banner ?? ''), banner ?? '')
    check('theme-color 離開開場後換回米色（不是天空藍）', (await page.evaluate(() => document.querySelector('meta[name=theme-color]')?.content)) === '#f3e3c3')
    // 重新整理 → 又會看到開場（每次冷啟動一次）
    await page.reload()
    await page.waitForSelector('[data-testid=title]')
    check('重新整理（冷啟動）→ 開場再出現一次', true)
    await ctx.close()
  }
  {
    const { ctx, page } = await titleCtx(browser, LAND)
    await page.goto(BASE + '#map')
    await page.waitForSelector('[data-testid=room], button.key, .adv-map, main', { timeout: 8000 })
    check('hash 直達（#map）不被開場擋住', (await page.locator('[data-testid=title]').count()) === 0)
    await ctx.close()
  }
  {
    // 沒有 gq-title-test 的自動化瀏覽器：預設跳過，直接是 PIN（既有 e2e 的前提）
    const ctx = await browser.newContext({ viewport: LAND, ...IPAD_CTX })
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.waitForSelector('button.key')
    check('自動化瀏覽器（沒開 gq-title-test）預設跳過開場', (await page.locator('[data-testid=title]').count()) === 0)
    await ctx.close()
  }

  // ================= 3) 轉場：開場 → PIN（第一幀就蓋住、邏輯不延遲、不擋點擊、結束後消失） =================
  {
    const { ctx, page } = await titleCtx(browser, LAND)
    await page.goto(BASE)
    await page.waitForSelector('[data-testid=title]')
    await page.waitForTimeout(500)
    const first = await page.evaluate(async () => {
      document.querySelector('[data-testid=title-start]').click()
      await new Promise((r) => queueMicrotask(r)) // React 在 microtask 裡 flush；還沒有任何 rAF（= 第一幀之前）
      const st = document.querySelector('[data-testid=screen-transition]')
      return {
        overlay: !!st,
        clouds: st ? st.querySelectorAll('.gq-st-cloud').length : 0,
        titleGone: !document.querySelector('[data-testid=title]'),
        pe: st ? getComputedStyle(st).pointerEvents : '',
        z: st ? getComputedStyle(st).zIndex : '',
      }
    })
    check('轉場：點下去的同一幀，遮罩已經在、舊畫面已經換掉（不先閃到新畫面）', first.overlay && first.titleGone, JSON.stringify(first))
    check('轉場：雲朵朵數足夠、pointer-events: none', first.clouds >= 12 && first.pe === 'none', JSON.stringify(first))
    // 遮罩還在時，畫面上任何一點的點擊都穿透到底下的元素
    const hit = await page.evaluate(() => {
      const pts = [[10, 10], [590, 410], [1100, 700]]
      return pts.map(([x, y]) => !document.elementFromPoint(x, y)?.closest('.gq-st'))
    })
    check('轉場：遮罩不擋點擊（elementFromPoint 都不是遮罩）', hit.every(Boolean), JSON.stringify(hit))
    await page.waitForSelector('button.key')
    await page.getByRole('button', { name: '1', exact: true }).click({ timeout: 3000 }) // 遮罩還在播時就能按
    check('轉場：播放中就能按 PIN 鍵', true)
    await page.waitForFunction(() => !document.querySelector('[data-testid=screen-transition]'), null, { timeout: 2500 })
    check('轉場：結束後遮罩從 DOM 消失', true)
    await ctx.close()
  }

  // ================= 4) 轉場：進 App 之後（首頁 ↔ 地圖 ↔ 家長區） =================
  {
    const { ctx, page, errors: appErrors } = await freshApp(browser, LAND)
    watch(page)
    const syncSwitch = (sel) =>
      page.evaluate(async (sel) => {
        document.querySelector(sel).click()
        await new Promise((r) => queueMicrotask(r))
        return {
          overlay: !!document.querySelector('[data-testid=screen-transition]'),
          home: !!document.querySelector('[data-testid=room]'),
          map: !!document.querySelector('.adv-map, [data-testid=map], .map-screen') || !!document.querySelector('h1')?.textContent?.includes('冒險'),
        }
      }, sel)
    // 分塊載入之後：畫面的 chunk 載好才是同一幀切換（正式環境由 preloadCommonScreens 在首頁閒下來時先載好）。這裡等它載好，測的是載好之後的行為
    await page.waitForTimeout(2600)
    const r1 = await syncSwitch('[data-testid=candy-map]')
    check('首頁 → 冒險地圖：遮罩與新畫面同一幀出現，舊畫面已拿掉（邏輯不延遲）', r1.overlay && !r1.home, JSON.stringify(r1))
    await page.waitForTimeout(80)
    // 遮罩還在時，點「回首頁」就要有反應
    await page.getByRole('button', { name: /回首頁/ }).first().click({ timeout: 3000 })
    await page.waitForSelector('[data-testid=room]', { timeout: 3000 })
    check('地圖 → 首頁：遮罩播放中點返回也立刻有反應', true)
    await page.waitForFunction(() => !document.querySelector('[data-testid=screen-transition]'), null, { timeout: 2500 })
    check('轉場結束後遮罩消失', true)
    // 家長區：進去不播、出來也不播
    const r2 = await page.evaluate(async () => {
      document.querySelector('.parent-lock').click()
      await new Promise((r) => queueMicrotask(r))
      return { overlay: !!document.querySelector('[data-testid=screen-transition]'), pin: !!document.querySelector('button.key') }
    })
    check('進家長區：不播轉場', !r2.overlay && r2.pin, JSON.stringify(r2))
    await page.waitForSelector('button.key')
    await pressPin(page, '1234')
    await page.getByRole('button', { name: '回到小孩模式' }).first().click()
    await page.waitForSelector('[data-testid=room]')
    check('離開家長區回首頁：不播轉場', (await page.locator('[data-testid=screen-transition]').count()) === 0)
    check('首頁沒有 JS 錯誤', appErrors.filter(unexpected).length === 0, appErrors.join(' | '))
    await ctx.close()
  }
  {
    // prefers-reduced-motion：不播
    const { ctx, page } = await freshApp(browser, LAND, { ctxOpts: { reducedMotion: 'reduce' } })
    const r = await page.evaluate(async () => {
      document.querySelector('[data-testid=candy-map]').click()
      await new Promise((r) => queueMicrotask(r))
      return !!document.querySelector('[data-testid=screen-transition]')
    })
    await page.waitForTimeout(150)
    check('prefers-reduced-motion：不播轉場', r === false && (await page.locator('[data-testid=screen-transition]').count()) === 0)
    await ctx.close()
  }

  // ================= 5) 錯誤邊界 =================
  for (const [name, vp] of [['iPad 橫向', LAND], ['手機 390x844', PHONE], ['手機 360x640', SMALL]]) {
    const { ctx, page, errors: appErrors } = await freshApp(browser, vp)
    watch(page)
    await page.evaluate(() => localStorage.removeItem('gq-error-log'))
    await page.goto(BASE + '#crash')
    await page.waitForSelector('[data-testid=error-screen]', { timeout: 5000 })
    const eb = await page.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect()
      const h = r('[data-testid=error-home]')
      const rl = r('[data-testid=error-reload]')
      return {
        pet: !!document.querySelector('.eb-pet'),
        line: document.querySelector('.eb-line')?.textContent ?? '',
        home: h && { w: h.width, h: h.height, r: h.right, b: h.bottom },
        reload: rl && { w: rl.width, h: rl.height, r: rl.right, b: rl.bottom },
      }
    })
    check(`[${name}] 錯誤畫面：寵物圖 + 溫柔的一句話`, eb.pet && /暈暈|休息/.test(eb.line), eb.line)
    check(`[${name}] 錯誤畫面：「回首頁」「重新整理」大按鈕（≥ 72px 高）且在畫面內`, eb.home?.h >= 72 && eb.reload?.h >= 72 && eb.home.r <= vp.width && eb.reload.r <= vp.width && eb.reload.b <= vp.height, JSON.stringify(eb))
    check(`[${name}] 錯誤畫面：沒有橫向溢出`, await noOverflow(page))
    await page.screenshot({ path: `/private/tmp/claude-501/line-n/e2e-error-${vp.width}x${vp.height}.png` }).catch(() => undefined)
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('gq-error-log') ?? '[]'))
    check(`[${name}] 錯誤被記到 localStorage（最近 5 筆之一）`, log.length >= 1 && /crash-probe/.test(log[log.length - 1].msg) && log[log.length - 1].where === 'child', JSON.stringify(log.map((e) => e.msg)))
    await page.getByTestId('error-home').click()
    await page.waitForSelector('[data-testid=room]', { timeout: 5000 })
    check(`[${name}] 按「回首頁」→ 回到首頁、錯誤畫面消失`, (await page.locator('[data-testid=error-screen]').count()) === 0 && (await page.evaluate(() => location.hash)) === '')
    check(`[${name}] 沒有 JS 錯誤（故意丟的除外）`, appErrors.filter(unexpected).length === 0, appErrors.filter(unexpected).join(' | '))
    if (vp === LAND) {
      // 再出一次錯 → 紀錄累積（0.3 秒內的同一個錯誤會合併，所以隔一下）；家長區設定頁看得到，預設收合
      await page.waitForTimeout(500)
      await page.goto(BASE + '#crash')
      await page.waitForSelector('[data-testid=error-screen]')
      await page.getByTestId('error-home').click()
      await page.waitForSelector('[data-testid=room]')
      await openParentTab(page, '設定')
      const det = page.getByTestId('error-log')
      check('家長區設定：有「錯誤紀錄」區塊、預設收合', (await det.count()) === 1 && (await det.evaluate((d) => d.open)) === false)
      await det.locator('summary').click()
      const items = await page.getByTestId('error-log-list').locator('li').count()
      const txt = await page.getByTestId('error-log-list').textContent()
      check('家長區設定：展開後看得到最近的錯誤（兩次）', items === 2 && /crash-probe/.test(txt ?? ''), `${items} 筆`)
      await page.getByRole('button', { name: '清除紀錄' }).click()
      check('家長區設定：可以清除紀錄', (await page.getByTestId('error-log-empty').count()) === 1)
    }
    await ctx.close()
  }
  {
    // 動態載入失敗（舊 chunk 找不到）→ 自動重新整理一次，第二次不再整理
    const { ctx, page } = await freshApp(browser, LAND)
    watch(page)
    await page.evaluate(() => {
      window.__marker = 1
      sessionStorage.removeItem('gq-chunk-reload')
      Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/old-1234.js'))
    })
    await page.waitForFunction(() => window.__marker === undefined, null, { timeout: 8000 }).catch(() => undefined)
    check('舊 chunk 找不到：自動重新整理一次', (await page.evaluate(() => window.__marker)) === undefined)
    await page.waitForSelector('[data-testid=room]', { timeout: 8000 })
    await page.evaluate(() => {
      window.__marker = 1
      Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/old-1234.js'))
    })
    await page.waitForTimeout(1200)
    check('舊 chunk 找不到：一分鐘內第二次不再整理（避免無限重整）', (await page.evaluate(() => window.__marker)) === 1)
    await ctx.close()
  }

  // ================= 6) 選寵物、落蛋 =================
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const { ctx, page } = await titleCtx(browser, vp)
    await page.goto(BASE)
    await page.waitForSelector('[data-testid=title]')
    await toEggStep(page, 'rabbit')
    check(`[${name}] 確認頁：沒有橫向溢出`, await noOverflow(page))
    const t0 = Date.now()
    await page.getByRole('button', { name: '開始冒險' }).click()
    await page.waitForSelector('[data-testid=egg-drop]', { timeout: 1000 })
    check(`[${name}] 開始冒險：先播落蛋（egg-drop）`, true)
    check(`[${name}] 落蛋：沒有橫向溢出`, await noOverflow(page))
    await page.waitForTimeout(300)
    check(`[${name}] 落蛋播放中，還沒進首頁`, (await page.locator('[data-testid=room]').count()) === 0)
    if (vp === LAND) await page.screenshot({ path: '/private/tmp/claude-501/line-n/e2e-eggdrop.png' }).catch(() => undefined)
    await page.waitForSelector('[data-testid=room]', { timeout: 4000 })
    const dt = Date.now() - t0
    check(`[${name}] 落蛋後進首頁（總長 < 2.4 秒，編排 1.5 秒內）`, dt < 2400 && dt > 1000, `${dt}ms`)
    await ctx.close()
  }
  {
    // 點一下跳過
    const { ctx, page } = await titleCtx(browser, LAND)
    await page.goto(BASE)
    await toEggStep(page, 'tiger')
    const t0 = Date.now()
    await page.getByRole('button', { name: '開始冒險' }).click()
    await page.waitForSelector('[data-testid=egg-drop]')
    await page.waitForTimeout(250)
    await page.getByTestId('egg-drop').click({ position: { x: 100, y: 100 } })
    await page.waitForSelector('[data-testid=room]', { timeout: 3000 })
    const dt = Date.now() - t0
    check('落蛋：點一下就跳過、直接進首頁', dt < 1300, `${dt}ms`)
    const species = await page.evaluate(() => document.querySelector('[data-testid=pet] .pet-sprite')?.dataset.species)
    check('落蛋跳過後，孩子還是建立成功（老虎）', species === 'tiger', String(species))
    await ctx.close()
  }
  {
    // 選寵物：卡片彈性放大、其他退後；點的那隻跳一下
    const { ctx, page } = await titleCtx(browser, LAND)
    await page.goto(BASE)
    await page.getByTestId('title-start').click()
    await page.waitForSelector('button.key')
    await pressPin(page, '1234')
    await pressPin(page, '1234')
    await page.getByPlaceholder('小朋友的名字').fill('小明')
    await page.getByRole('button', { name: '下一步' }).click()
    await page.getByTestId('onboard-age-skip').click()
    await page.waitForSelector('[data-testid=onboard-species]')
    await page.waitForTimeout(700)
    const scaleOf = (s) => page.evaluate((s) => getComputedStyle(document.querySelector(`[data-testid=species-${s}]`)).scale, s)
    check('選寵物：預設的阿悟放大、另外兩隻退後', (await scaleOf('monkey')) === '1.06' && (await scaleOf('rabbit')) === '0.97' && (await scaleOf('tiger')) === '0.97', `${await scaleOf('monkey')}/${await scaleOf('rabbit')}/${await scaleOf('tiger')}`)
    await page.getByTestId('species-tiger').click()
    await page.waitForTimeout(120)
    const hop = await page.evaluate(() => {
      const art = document.querySelector('[data-testid=species-tiger] .l75-pick-art')
      const anims = art.getAnimations().filter((a) => !a.animationName)
      return { n: anims.length, moved: getComputedStyle(art).transform !== 'none' }
    })
    check('點卡片那隻會跳一下（Web Animations 在播）', hop.n === 1 && hop.moved, JSON.stringify(hop))
    await page.waitForTimeout(700)
    check('選了虎虎：虎虎放大、阿悟退後', (await scaleOf('tiger')) === '1.06' && (await scaleOf('monkey')) === '0.97')
    check('選寵物頁沒有橫向溢出', await noOverflow(page))
    await ctx.close()
  }

  // ================= 7) 按鈕手感 =================
  {
    const { ctx, page } = await titleCtx(browser, LAND)
    await page.goto(BASE)
    await page.getByTestId('title-start').click()
    await page.waitForSelector('button.key')
    await page.waitForTimeout(500)
    const key = page.locator('button.key').first()
    const b = await key.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(120)
    const down = await key.evaluate((e) => ({ scale: getComputedStyle(e).scale, transform: getComputedStyle(e).transform }))
    check('按住按鈕：縮小（獨立的 scale 屬性，不動元件自己的 transform）', parseFloat(down.scale) < 1, JSON.stringify(down))
    await page.mouse.up()
    await page.waitForTimeout(30)
    const bounce = await key.evaluate((e) => e.getAnimations().filter((a) => !a.animationName).length)
    check('放開：彈回動畫在播', bounce >= 1, String(bounce))
    await page.waitForTimeout(500)
    const rest = await key.evaluate((e) => getComputedStyle(e).scale)
    check('彈完回到原大小', rest === 'none' || rest === '1', rest)
    await ctx.close()
  }

  // ================= 8) 啟動畫面（JS 載入前） =================
  {
    const ctx = await browser.newContext({ viewport: PHONE, javaScriptEnabled: false })
    const page = await ctx.newPage()
    await page.goto(BASE)
    const boot = await page.evaluate(() => {
      const b = document.getElementById('boot')
      const r = b?.getBoundingClientRect()
      return { has: !!b, full: !!r && r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1, egg: !!b?.querySelector('.egg'), bg: b ? getComputedStyle(b).backgroundImage : '' }
    })
    check('啟動畫面：JS 還沒執行就有（藍天底 + 蛋），不是白屏', boot.has && boot.full && boot.egg && /gradient/.test(boot.bg), JSON.stringify(boot))
    await ctx.close()
  }
  {
    const { ctx, page } = await titleCtx(browser, PHONE)
    await page.goto(BASE)
    const tc = await page.evaluate(() => document.querySelector('meta[name=theme-color]')?.content)
    check('index.html 的 theme-color 與開場藍天一致', tc === '#67b2fd', tc)
    await ctx.close()
  }
} finally {
  await browser.close()
}

check('全程沒有未預期的 JS 錯誤', errors.length === 0, errors.slice(0, 4).join(' | '))
if (state.failed) {
  console.log(`\n${state.failed} 項失敗`)
  process.exit(1)
}
console.log('\n全部通過')
