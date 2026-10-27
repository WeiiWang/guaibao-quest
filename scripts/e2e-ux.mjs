// v4 線 U（操作與回饋）E2E：每一項 UX 修正都有斷言，並存三種尺寸的截圖到 design/screens/v4-ux-*.png。
// 用法：先啟動 dev server（例如 pnpm dev --port 5181 --strictPort），再
//   BASE_URL=http://localhost:5181 node scripts/e2e-ux.mjs      （或 pnpm e2e:ux）
// 需要 Chromium：預設找 ~/Library/Caches/ms-playwright 內已安裝的，或用 CHROME_PATH 指定。
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { center, drag, freshApp, getPet, idb, launch, makeChecker, patchPet } from './e2e-lib.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../design/screens')
mkdirSync(OUT, { recursive: true })
const { state, check } = makeChecker()

const SIZES = {
  land: { width: 1024, height: 768 },
  port: { width: 768, height: 1024 },
  phone: { width: 375, height: 812 },
}
const shot = async (page, name, size) => {
  await page.waitForTimeout(600) // 等進場動畫跑完，截圖才不會是半透明
  await page.screenshot({ path: join(OUT, `v4-ux-${name}-${size}.png`) })
}

// ---------- 小工具 ----------
const dump = (page, table) =>
  idb(page, (db, t) => new Promise((res) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => res(e.target.result))), table)

const balance = async (page) => (await dump(page, 'ledger')).reduce((s, e) => s + e.delta, 0)
const qtyOf = async (page, id) => (await dump(page, 'inventory')).find((v) => v.itemId === id)?.qty ?? 0

/** 直接寫進 IndexedDB（寫完要 reload 畫面才看得到） */
const putRows = (page, table, rows) =>
  idb(
    page,
    (db, a) =>
      new Promise((res) => {
        const tx = db.transaction(a.table, 'readwrite')
        for (const r of a.rows) tx.objectStore(a.table).put(r)
        tx.oncomplete = () => res(1)
      }),
    { table, rows },
  )
const giveStars = (page, n) => putRows(page, 'ledger', [{ id: `t-${Math.random()}`, at: Date.now(), delta: n, reason: '測試', kind: 'bonus' }])
const patchSettings = (page, patch) =>
  idb(
    page,
    (db, p) =>
      new Promise((res) => {
        const s = db.transaction('settings', 'readwrite').objectStore('settings')
        s.get('main').onsuccess = (e) => (s.put({ ...e.target.result, ...p }).onsuccess = () => res(1))
      }),
    patch,
  )

/**
 * 掛在 context 上（之後每次載入頁面都生效）：
 * window.__spoken = 唸過的句子、window.__fb = 共用成功回饋觸發過的事件（kind/sound/voice/particles）；
 * WebAudio 發聲次數在 window.__audio.osc（e2e-lib 已掛）。
 */
const spyAll = (ctx) =>
  ctx.addInitScript(() => {
    window.__spoken = []
    window.__fb = []
    window.addEventListener('gq-feedback', (e) => window.__fb.push(e.detail))
    try {
      const orig = window.speechSynthesis.speak.bind(window.speechSynthesis)
      window.speechSynthesis.speak = (u) => {
        window.__spoken.push(u.text)
        return orig(u)
      }
    } catch {
      /* 沒有 speechSynthesis 就沒有語音可記 */
    }
  })

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- 第 1 項：鎖定畫面按鈕 ----------
async function lockScreen(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await patchSettings(page, { dailyLimitMin: 15 })
    await putRows(page, 'playTime', [{ date: today(), seconds: 99999, bonusSeconds: 0 }])
    await page.reload()
    await page.waitForSelector('[data-testid=lock-screen]', { timeout: 10000 })
    const tasks = await page.getByTestId('lock-tasks').boundingBox()
    const col = await page.getByTestId('lock-coloring').boundingBox()
    check(
      `[${size}] 鎖定畫面：「今日任務」「著色本」是大膠囊（高 ≥72、寬 ≥150），不是小圓`,
      tasks.height >= 72 && col.height >= 72 && tasks.width >= 150 && col.width >= 150,
      `${Math.round(tasks.width)}x${Math.round(tasks.height)} / ${Math.round(col.width)}x${Math.round(col.height)}`,
    )
    const oneLine = await page.evaluate(() => [...document.querySelectorAll('.lock-go span:not(.art-emoji):not(.art-emoji-glyph)')].every((s) => s.getBoundingClientRect().height < 36))
    check(`[${size}] 鎖定畫面：按鈕文字不斷行`, oneLine)
    check(`[${size}] 鎖定畫面：沒有水平溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`[${size}] 鎖定畫面沒有首頁的圓形鎖頭 class`, (await page.locator('.lock-screen .parent-lock').count()) === 0)
    await shot(page, 'lock', size)
    check(`[${size}] 鎖定畫面無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  const { ctx, page } = await freshApp(browser, SIZES.land)
  const b = await page.locator('.parent-lock').boundingBox()
  check('首頁家長鎖頭維持圓形（58×58）', Math.abs(b.width - 58) < 1 && Math.abs(b.height - 58) < 1, `${b.width}x${b.height}`)
  await ctx.close()
}


// ---------- 第 2 項：餵食防呆 ----------
async function feedingGuard(browser) {
  // 吃飽了（≥95）：點、拖都不扣食物，阿悟搖頭說「我吃飽了～」
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { bananas: 5 })
    await patchPet(page, { hunger: 100, hungerUpdatedAt: Date.now() })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await page.evaluate(() => {
      window.__spoken = []
      const orig = window.speechSynthesis.speak.bind(window.speechSynthesis)
      window.speechSynthesis.speak = (u) => (window.__spoken.push(u.text), orig(u))
    })
    const before = await getPet(page)
    await page.locator('[data-dock-item=banana]').click()
    await page.waitForTimeout(250)
    check('飽足 100：輕點食物，食物不扣（x5）', (await qtyOf(page, 'banana')) === 5)
    check('飽足 100：feedCount 不增加', (await getPet(page)).feedCount === before.feedCount)
    const bubble = await page.getByTestId('pet-bubble').innerText().catch(() => '')
    check('阿悟說「我吃飽了～」', bubble.includes('我吃飽了'), bubble)
    check('阿悟搖頭（headshake 動畫）', (await page.getByTestId('pet').getAttribute('data-anim')) === 'headshake')
    check('語音唸「我吃飽了」', (await page.evaluate(() => window.__spoken)).some((t) => t.includes('我吃飽了')))
    check('被拒絕的食物圖示抖一下（nope）', (await page.locator('[data-dock-item=banana].nope').count()) === 1)
    await shot(page, 'feed-full', 'land')
    // 拖給阿悟也一樣
    await page.waitForTimeout(2300)
    const from = await center(page, '[data-dock-item=banana]')
    const to = await center(page, '[data-testid=pet]')
    await drag(page, from, to, { settle: 600 })
    check('飽足 100：拖給阿悟吃，食物也不扣', (await qtyOf(page, 'banana')) === 5 && (await getPet(page)).feedCount === before.feedCount)
    check('無 console 錯誤', errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 家長關語音：不唸
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { bananas: 5 })
    await patchSettings(page, { voiceOn: false })
    await patchPet(page, { hunger: 100, hungerUpdatedAt: Date.now() })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await page.evaluate(() => {
      window.__spoken = []
      const orig = window.speechSynthesis.speak.bind(window.speechSynthesis)
      window.speechSynthesis.speak = (u) => (window.__spoken.push(u.text), orig(u))
    })
    await page.locator('[data-dock-item=banana]').click()
    await page.waitForTimeout(300)
    check('家長關語音：吃飽了不唸（字幕泡泡還在）', (await page.evaluate(() => window.__spoken.length)) === 0 && (await page.getByTestId('pet-bubble').count()) === 1)
    await ctx.close()
  }
  // 輕點防連點：800ms 內只算一次；拖曳不受限
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { bananas: 8 })
    await patchPet(page, { hunger: 5, hungerUpdatedAt: Date.now() })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    for (let i = 0; i < 6; i++) {
      await page.locator('[data-dock-item=banana]').click()
      await page.waitForTimeout(90)
    }
    await page.waitForTimeout(300)
    check('狂點 6 下（0.5 秒內）：只吃 1 個（8→7）', (await qtyOf(page, 'banana')) === 7, String(await qtyOf(page, 'banana')))
    await page.waitForTimeout(3600) // 等吃完、過了 800ms
    await page.locator('[data-dock-item=banana]').click()
    await page.waitForTimeout(300)
    check('800ms 之後再點一次又可以吃（7→6）', (await qtyOf(page, 'banana')) === 6)
    await patchPet(page, { hunger: 5, hungerUpdatedAt: Date.now() })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    const from = await center(page, '[data-dock-item=banana]')
    const to = await center(page, '[data-testid=pet]')
    await drag(page, from, to, { settle: 300 })
    await patchPet(page, { hunger: 5, hungerUpdatedAt: Date.now() }) // 兩次拖曳之間不被「吃飽」擋住，單純驗證「拖曳不受 800ms 限制」
    await drag(page, await center(page, '[data-dock-item=banana]'), await center(page, '[data-testid=pet]'), { settle: 300 })
    check('連續兩次拖曳（間隔 <800ms）都有餵到（6→4）', (await qtyOf(page, 'banana')) === 4, String(await qtyOf(page, 'banana')))
    await ctx.close()
  }
}

// ---------- 第 4 項：食物欄拖曳（觸控、偏水平） ----------
/** 用 CDP 送真實觸控：從 a 拖到 b（steps 步），放開 */
async function touchDrag(page, a, b, steps = 14) {
  const cdp = await page.context().newCDPSession(page)
  const pt = (p) => [{ x: Math.round(p.x), y: Math.round(p.y), id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(a) })
  for (let i = 1; i <= steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(p) })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

async function dockTouch(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page } = await freshApp(browser, vp, { bananas: 5, ctxOpts: { hasTouch: true } })
    // 讓 10 種食物都有庫存，食物欄一定比畫面寬（可以捲動）
    await putRows(page, 'inventory', ['carrot', 'cookie', 'apple', 'grape', 'milk', 'peach', 'riceball', 'watermelon', 'cake'].map((id) => ({ id, itemId: id, qty: 2 })))
    await patchPet(page, { hunger: 20, hungerUpdatedAt: Date.now(), stage: 'adult' })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    const first = page.locator('.dock-item.food').first()
    const id = await first.getAttribute('data-dock-item')
    const a = await center(page, '.dock-item.food')
    const pet = await center(page, '[data-testid=pet]')
    const dxy = { x: pet.x - a.x, y: pet.y - a.y }
    const before = (await getPet(page)).feedCount
    // 偏水平的拖曳（ux-review #5 的失敗案例：位移 +384, −216，水平分量比垂直大）
    await touchDrag(page, a, pet)
    await page.waitForTimeout(500)
    const after = await getPet(page)
    check(`[${size}] 觸控：從最左邊的食物偏水平拖給阿悟 → 餵到了（feedCount +1）`, after.feedCount === before + 1, `位移 ${Math.round(dxy.x)},${Math.round(dxy.y)}；${id}`)
    check(`[${size}] 觸控拖曳後，食物欄沒有被捲走（scrollLeft = 0）`, (await page.getByTestId('dock').evaluate((e) => e.scrollLeft)) === 0)
    // 食物欄能捲：箭頭
    const right = page.getByTestId('dock-arrow-right')
    check(`[${size}] 食物欄溢出時顯示右箭頭`, (await right.count()) === 1)
    await right.click()
    await page.waitForTimeout(500)
    check(`[${size}] 按右箭頭：食物欄往右捲`, (await page.getByTestId('dock').evaluate((e) => e.scrollLeft)) > 40)
    check(`[${size}] 捲過之後出現左箭頭`, (await page.getByTestId('dock-arrow-left').count()) === 1)
    await shot(page, 'dock', size)
    await ctx.close()
  }
}


// ---------- 第 3 項：商店防雙擊 + 退回；第 7 項：購買的成功回饋 ----------
async function shopBuy(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp, { bananas: 0 })
    await spyAll(ctx)
    await giveStars(page, 160)
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await page.locator('.candy.peach').click()
    await page.waitForSelector('[data-testid=shop-banana]')
    const buy = page.locator('[data-testid=shop-banana] [data-testid=buy-btn]')
    const osc0 = await page.evaluate(() => window.__audio.osc)
    await buy.dblclick({ delay: 0 }) // 兩下之間只隔幾十毫秒
    await page.waitForTimeout(300)
    check(`[${size}] 雙擊「買」：只買一份（香蕉 1 個）`, (await qtyOf(page, 'banana')) === 1, String(await qtyOf(page, 'banana')))
    check(`[${size}] 雙擊「買」：只扣一次星星（160→150）`, (await balance(page)) === 150, String(await balance(page)))
    const fb = await page.evaluate(() => window.__fb)
    check(`[${size}] 購買觸發共用成功回饋（kind=buy、有音效、有粒子）`, fb.length === 1 && fb[0].kind === 'buy' && fb[0].sound === true && fb[0].particles > 0, JSON.stringify(fb))
    check(`[${size}] 購買：真的有發出音效（WebAudio）`, (await page.evaluate(() => window.__audio.osc)) > osc0)
    check(`[${size}] 購買：語音「買到香蕉囉！」`, (await page.evaluate(() => window.__spoken)).includes('買到香蕉囉！'))
    check(`[${size}] 購買：畫面上有星星粒子`, (await page.locator('[data-testid=fb-particle]').count()) > 0)
    check(`[${size}] 出現「退回」小按鈕`, (await page.getByTestId('undo-buy').count()) === 1)
    const pill = await page.getByTestId('undo-buy').boundingBox()
    const lastBuyBtns = await page.locator('[data-testid=buy-btn]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))
    const overlap = lastBuyBtns.some((r) => r.left < pill.x + pill.width && r.right > pill.x && r.top < pill.y + pill.height && r.bottom > pill.y)
    check(`[${size}] 退回按鈕不蓋住任何「買」按鈕`, !overlap)
    await shot(page, 'shop-bought', size)
    await page.getByTestId('undo-buy').click()
    await page.waitForTimeout(400)
    check(`[${size}] 按「退回」：庫存回 0、星星回 160`, (await qtyOf(page, 'banana')) === 0 && (await balance(page)) === 160, `${await qtyOf(page, 'banana')}/${await balance(page)}`)
    check(`[${size}] 退回後按鈕消失`, (await page.getByTestId('undo-buy').count()) === 0)
    // 退回後再買得到（沒有留下半套狀態），而且 5 秒後退回鈕自己消失
    await buy.click()
    await page.waitForTimeout(300)
    check(`[${size}] 退回後再買：庫存 1、星星 150`, (await qtyOf(page, 'banana')) === 1 && (await balance(page)) === 150)
    await page.waitForTimeout(5300)
    check(`[${size}] 5 秒後「退回」鈕自己消失`, (await page.getByTestId('undo-buy').count()) === 0)
    check(`[${size}] 商店無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 慢慢點兩下（隔 >600ms）是兩次獨立的購買
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { bananas: 0 })
    await giveStars(page, 160)
    await page.reload()
    await page.locator('.candy.peach').click()
    const buy = page.locator('[data-testid=shop-banana] [data-testid=buy-btn]')
    await buy.click()
    await page.waitForTimeout(800)
    await buy.click()
    await page.waitForTimeout(300)
    check('隔 0.8 秒再按：是第二次購買（香蕉 2 個、星星 140）', (await qtyOf(page, 'banana')) === 2 && (await balance(page)) === 140)
    await ctx.close()
  }
  // 家長關掉音效與語音：成功回饋只剩畫面粒子
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { bananas: 0 })
    await spyAll(ctx)
    await patchSettings(page, { soundOn: false, voiceOn: false })
    await giveStars(page, 160)
    await page.reload()
    await page.locator('.candy.peach').click()
    const osc0 = await page.evaluate(() => window.__audio.osc)
    await page.locator('[data-testid=shop-banana] [data-testid=buy-btn]').click()
    await page.waitForTimeout(300)
    const fb = await page.evaluate(() => window.__fb)
    check('家長關音效：購買沒有發聲', (await page.evaluate(() => window.__audio.osc)) === osc0 && fb[0]?.sound === false)
    check('家長關語音：購買不唸（speak 收到 enabled=false，沒有真的開始唸）', fb[0]?.voice === false)
    check('音效語音都關：粒子還是會出現', (await page.locator('[data-testid=fb-particle]').count()) > 0)
    await ctx.close()
  }
  // 減少動態效果：粒子改成原地淡入淡出（沒有位移）
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { bananas: 0, ctxOpts: { reducedMotion: 'reduce' } })
    await giveStars(page, 160)
    await page.reload()
    await page.locator('.candy.peach').click()
    await page.locator('[data-testid=shop-banana] [data-testid=buy-btn]').click()
    await page.waitForTimeout(450)
    const moved = await page.evaluate(() => [...document.querySelectorAll('[data-testid=fb-particle]')].map((e) => getComputedStyle(e).transform))
    check('prefers-reduced-motion：粒子沒有位移（transform 為 none）', moved.length > 0 && moved.every((t) => t === 'none'), moved[0])
    await ctx.close()
  }
}

// ---------- 第 5 項：著色本新手空狀態 ----------
async function coloringList(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await spyAll(ctx)
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await page.locator('.candy.lavender').click()
    await page.waitForSelector('[data-testid=page-monkey]')
    const owned = await page.locator('[data-testid^=page-]').evaluateAll((els) => els.map((e) => e.dataset.testid))
    check(`[${size}] 新使用者的著色本有 2 張免費頁（小猴子、香蕉樹）`, owned.length === 2 && owned.includes('page-monkey') && owned.includes('page-banana-tree'), owned.join(','))
    const order = await page.locator('ul.shop-grid > li').evaluateAll((els) => els.map((e) => (e.classList.contains('locked') ? 'L' : 'O')).join(''))
    check(`[${size}] 已擁有的排在最前面，上鎖的在後面`, /^O+L+$/.test(order), order)
    const monkeyBtn = await page.locator('[data-testid=page-monkey] .thumb-btn').boundingBox()
    check(`[${size}] 免費頁的縮圖可以點、夠大（≥100px）`, monkeyBtn.width >= 100 && monkeyBtn.height >= 100)
    // 點鎖頭：晃一下、語音、大按鈕「去商店」
    await page.getByTestId('locked-clouds').locator('.locked-btn').click()
    await page.waitForSelector('[data-testid=locked-guide]')
    check(`[${size}] 點鎖頭：卡片晃一下`, (await page.locator('[data-testid=locked-clouds].ux-shake').count()) === 1)
    check(`[${size}] 點鎖頭：語音「這張要用 30 顆星星，在商店換喔」`, (await page.evaluate(() => window.__spoken)).includes('這張要用30顆星星，在商店換喔'))
    await page.waitForTimeout(500) // 等彈出動畫跑完再量尺寸
    const go = await page.getByTestId('guide-go-shop').boundingBox()
    check(`[${size}] 「去商店」是大按鈕（高 ≥72）`, go.height >= 72, `${Math.round(go.width)}x${Math.round(go.height)}`)
    await shot(page, 'coloring-locked', size)
    await page.getByTestId('guide-go-shop').click()
    await page.waitForSelector('[data-testid=shop-grid-coloring]')
    check(`[${size}] 按「去商店」：直接到商店的著色頁分頁`, (await page.getByRole('tab', { name: '著色頁' }).getAttribute('aria-selected')) === 'true')
    const monkeyShop = await page.locator('[data-testid=shop-coloring-monkey] [data-testid=buy-btn]').innerText()
    check(`[${size}] 商店裡免費頁顯示「已擁有」`, monkeyShop.includes('已擁有'))
    check(`[${size}] 著色本無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 免費頁只送一次：退掉之後重開 App 不會再補
  {
    const { ctx, page } = await freshApp(browser, SIZES.land)
    await idb(page, (db) => new Promise((res) => { const tx = db.transaction('inventory', 'readwrite'); tx.objectStore('inventory').put({ id: 'coloring-monkey', itemId: 'coloring-monkey', qty: 0 }); tx.oncomplete = () => res(1) }))
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await page.waitForTimeout(500)
    check('免費頁只送一次（庫存被改成 0 後，重開不會再補）', (await qtyOf(page, 'coloring-monkey')) === 0)
    await ctx.close()
  }
}

// ---------- 第 9 項：著色頁直向 / 手機版面 ----------
const boxOf = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
}
const sameBox = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

async function coloringLayout(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await page.locator('.candy.lavender').click()
    await page.getByTestId('page-monkey').locator('.thumb-btn').click()
    await page.waitForSelector('[data-testid=paint-screen]')
    await page.waitForTimeout(500)
    const inView = (b) => b.y >= 0 && b.y + b.h <= vp.height + 1 && b.x >= 0 && b.x + b.w <= vp.width + 1
    const finish0 = await boxOf(page, '[data-testid=finish-btn]')
    const panel0 = await boxOf(page, '.pt-panel')
    const board = await boxOf(page, '.pt-board')
    check(`[${size}] 著色頁：畫布完整在畫面內（不用捲動）`, inView(board), JSON.stringify(board))
    check(`[${size}] 著色頁：「完成」「復原」「工具」不用捲動就看得到`, inView(finish0) && inView(await boxOf(page, '[data-testid=undo-btn]')) && inView(await boxOf(page, '[data-testid=tool-fill]')), JSON.stringify(finish0))
    check(`[${size}] 著色頁：整頁沒有垂直捲動（直向 / 手機工具列固定在畫布下方）`, size === 'land' || (await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)))
    check(`[${size}] 著色頁：沒有水平溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    if (size !== 'land') {
      const toolsY = (await boxOf(page, '.pt-tools')).y
      check(`[${size}] 工具列在畫布下方`, toolsY >= board.y + board.h - 1, `${toolsY} vs ${board.y + board.h}`)
    }
    // 色票 ≥48px
    const sw = await page.locator('[data-testid=palette] .swatch').evaluateAll((els) => els.map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]))
    check(`[${size}] 24 個色票每個 ≥48×48`, sw.length === 24 && sw.every(([w, h]) => w >= 48 && h >= 48), `最小 ${Math.min(...sw.map((x) => x[0]))}x${Math.min(...sw.map((x) => x[1]))}`)
    const firstVisible = await page.locator('[data-testid=palette] .swatch').first().boundingBox()
    check(`[${size}] 進頁面第一個色票就在畫面內（換色不用捲）`, firstVisible.y >= 0 && firstVisible.y + firstVisible.height <= vp.height)
    await shot(page, 'paint', size)
    // 「完成」位置穩定：點色 → 出現「最近用過」→ 換各種工具，位置都不動
    const states = []
    await page.locator('[data-testid=palette] .swatch').nth(3).click()
    await page.locator('[data-testid=palette] .swatch').nth(3).scrollIntoViewIfNeeded()
    // 填一個區塊讓「最近用過」出現
    const svgBox = await boxOf(page, '.pt-svg')
    await page.mouse.click(svgBox.x + svgBox.w * 0.5, svgBox.y + svgBox.h * 0.5)
    await page.waitForTimeout(250)
    states.push(['填色後（出現最近用過）', await boxOf(page, '[data-testid=finish-btn]')])
    for (const t of ['brush', 'sticker', 'eraser', 'fill']) {
      await page.getByTestId(`tool-${t}`).click()
      await page.waitForTimeout(120)
      states.push([`切到${t}`, await boxOf(page, '[data-testid=finish-btn]')])
      if (t === 'sticker') await shot(page, 'paint-sticker', size)
    }
    await page.getByTestId('special-rainbow').click()
    states.push(['彩虹填色', await boxOf(page, '[data-testid=finish-btn]')])
    const moved = states.filter(([, b]) => !sameBox(b, finish0))
    check(`[${size}] 「完成」按鈕位置固定（填色、最近用過、4 種工具、彩虹都不跳位）`, moved.length === 0, moved.map(([n, b]) => `${n}:${JSON.stringify(b)}`).join(' ') + ' 原本 ' + JSON.stringify(finish0))
    check(`[${size}] 工具列整體高度固定`, sameBox(await boxOf(page, '.pt-panel'), panel0))
    const recent = await page.locator('[data-testid=recent-colors] .swatch').count()
    check(`[${size}] 點色之後「最近用過」有出現（功能沒被拿掉）`, recent >= 1, String(recent))
    check(`[${size}] 著色頁無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
}

const SECTIONS = { lockScreen, feedingGuard, dockTouch, shopBuy, coloringList, coloringLayout }
void SECTIONS
void balance
void qtyOf
void giveStars

const only = process.argv[2]
const browser = await launch()
try {
  for (const [name, fn] of Object.entries(SECTIONS)) {
    if (only && only !== name) continue
    console.log(`\n# ${name}`)
    await fn(browser)
  }
} finally {
  await browser.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
