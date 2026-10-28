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
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp, { bananas: 5 })
    await patchPet(page, { hunger: 100, hungerUpdatedAt: Date.now() })
    // 阿悟頭上的泡泡改用預錄的阿悟聲（只播預錄、沒有就安靜）：開啟語音包測試模式，記下播了哪個音檔
    await ctx.addInitScript(() => {
      localStorage.setItem('gq-voice-pack-test', '1')
      window.__played = []
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function (...a) {
        if (/\.m4a/.test(this.src)) window.__played.push(this.src)
        return play.apply(this, a)
      }
    })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await page.waitForTimeout(600)
    await page.evaluate(() => {
      window.__spoken = []
      const orig = window.speechSynthesis.speak.bind(window.speechSynthesis)
      window.speechSynthesis.speak = (u) => (window.__spoken.push(u.text), orig(u))
    })
    const before = await getPet(page)
    await page.locator('[data-dock-item=banana]').click()
    await page.waitForTimeout(250)
    check(`[${size}] 飽足 100：輕點食物，食物不扣（x5）`, (await qtyOf(page, 'banana')) === 5)
    check(`[${size}] 飽足 100：feedCount 不增加`, (await getPet(page)).feedCount === before.feedCount)
    const bubble = await page.getByTestId('pet-bubble').innerText().catch(() => '')
    check(`[${size}] 阿悟說「我吃飽了～」`, bubble.includes('我吃飽了'), bubble)
    check(`[${size}] 阿悟搖頭（headshake 動畫）`, (await page.getByTestId('pet').getAttribute('data-anim')) === 'headshake')
    const fullFile = await page.evaluate(async () => Object.values(await (await fetch('/voice/manifest.json')).json()).find((v) => v.text === '我吃飽了～')?.file)
    check(`[${size}] 語音唸「我吃飽了」（阿悟聲預錄音檔）`, !!fullFile && (await page.evaluate(() => window.__played)).some((u) => u.includes(fullFile)), String(fullFile))
    check(`[${size}] 被拒絕的食物圖示抖一下（nope）`, (await page.locator('[data-dock-item=banana].nope').count()) === 1)
    await shot(page, 'feed-full', size)
    // 拖給阿悟也一樣
    await page.waitForTimeout(2300)
    const from = await center(page, '[data-dock-item=banana]')
    const to = await center(page, '[data-testid=pet]')
    await drag(page, from, to, { settle: 600 })
    check(`[${size}] 飽足 100：拖給阿悟吃，食物也不扣`, (await qtyOf(page, 'banana')) === 5 && (await getPet(page)).feedCount === before.feedCount)
    check(`[${size}] 無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 家長關語音：不唸
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { bananas: 5 })
    await patchSettings(page, { voiceOn: false })
    await patchPet(page, { hunger: 100, hungerUpdatedAt: Date.now() })
    // 阿悟頭上的泡泡改用預錄的阿悟聲（只播預錄、沒有就安靜）：開啟語音包測試模式，記下播了哪個音檔
    await ctx.addInitScript(() => {
      localStorage.setItem('gq-voice-pack-test', '1')
      window.__played = []
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function (...a) {
        if (/\.m4a/.test(this.src)) window.__played.push(this.src)
        return play.apply(this, a)
      }
    })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await page.waitForTimeout(600)
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
    await shot(page, 'coloring-list', size)
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

// ---------- 第 6 項：掛到房間的畫不被狀態卡蓋住；第 7 項：佈置擺放的成功回饋 ----------
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

async function artworkSpot(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await spyAll(ctx)
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    for (let n = 0; n < 2; n++) {
      await page.locator('.candy.lavender').click()
      await page.getByTestId('page-monkey').locator('.thumb-btn').click()
      await page.waitForSelector('[data-testid=paint-screen]')
      await page.waitForTimeout(300)
      const sb = await boxOf(page, '.pt-svg')
      await page.mouse.click(sb.x + sb.w * 0.5, sb.y + sb.h * 0.5)
      await page.waitForTimeout(200)
      await page.getByTestId('finish-btn').click()
      await page.getByTestId('hang-btn').click()
      await page.waitForSelector('[data-testid=hung-ok]')
      await page.getByRole('button', { name: '回著色本' }).click()
      await page.waitForSelector('[data-testid=open-gallery]')
      await page.locator('.screen-header .back').click()
      await page.waitForSelector('[data-testid=room]')
      await page.waitForTimeout(700)
      const arts = await page.locator('[data-placed^=art-]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }))
      const hud = await boxOf(page, '.pet-hud')
      const tools = await boxOf(page, '.side-tools')
      const last = arts[arts.length - 1]
      // v7：掛畫以「不蓋到窗戶、狀態卡、按鈕」為先；手機畫面太窄，第一屏可能沒有空牆，這時掛在旁邊要捲動才看得到
      const win = await boxOf(page, '.rb-window')
      check(`[${size}] 第 ${n + 1} 幅畫掛上去：${size === 'phone' ? '房間內、沒蓋到窗戶' : '在畫面內可見、沒蓋到窗戶'}`, !!last && !overlaps(last, win) && last.y >= 0 && last.y + last.h <= vp.height && (size === 'phone' || (last.x >= 0 && last.x + last.w <= vp.width)), JSON.stringify(last))
      check(`[${size}] 第 ${n + 1} 幅畫：沒有被左上角狀態卡蓋住`, arts.every((a) => !overlaps(a, hud)), `hud ${JSON.stringify(hud)} art ${JSON.stringify(arts)}`)
      check(`[${size}] 第 ${n + 1} 幅畫：沒有被右上角工坊/背包按鈕蓋住`, arts.every((a) => !overlaps(a, tools)))
      if (n === 0) await shot(page, 'art-hung', size)
    }
    check(`[${size}] 狀態卡是半透明的`, await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.pet-hud')).backgroundColor; const a = Number(c.match(/[\d.]+(?=\)$)/)?.[0] ?? 1); return a < 0.8 }))
    check(`[${size}] 掛畫無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
}

// ---------- 第 7 項：佈置擺放、清便便的成功回饋 ----------
async function placeAndPoop(browser) {
  const { ctx, page, errors } = await freshApp(browser, SIZES.land, { decor: ['decor-clock', 'decor-ball'] })
  await spyAll(ctx)
  await page.reload()
  await page.waitForSelector('[data-testid=room]')
  await page.getByRole('button', { name: /佈置/ }).click()
  await page.waitForSelector('.dock-item.decor-item')
  const from = await center(page, '[data-dock-item=decor-clock]')
  const to = await center(page, '[data-testid=room]')
  await drag(page, from, { x: to.x, y: to.y - 120 }, { settle: 300 })
  const fb = await page.evaluate(() => window.__fb)
  check('擺放家具：觸發共用成功回饋（kind=place，有音效與粒子）', fb.some((f) => f.kind === 'place' && f.sound && f.particles > 0), JSON.stringify(fb))
  check('擺放家具：語音「放好了！」', (await page.evaluate(() => window.__spoken)).includes('放好了！'))
  // 清便便
  await page.getByRole('button', { name: /完成/ }).click()
  await patchPet(page, { poops: [{ id: 'p1', x: 0.4, at: Date.now() - 60000 }], poopDue: [] })
  await page.reload()
  await page.waitForSelector('[data-testid=poop]')
  await page.evaluate(() => (window.__fb.length = 0))
  await page.locator('[data-testid=poop]').first().click({ force: true })
  await page.waitForTimeout(1200)
  const fb2 = await page.evaluate(() => window.__fb)
  check('清便便：觸發共用成功回饋（kind=poop，愛心粒子）', fb2.some((f) => f.kind === 'poop' && f.particles > 0), JSON.stringify(fb2))
  check('清便便：語音「乾淨了！」', (await page.evaluate(() => window.__spoken)).includes('乾淨了！'))
  check('擺放與清便便無 console 錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}

// ---------- 第 8 項：工坊做得起 / 做不起的視覺、做好的慶祝 ----------
const giveMaterials = (page, wood, stone, flower, tag = 'g') =>
  putRows(page, 'materialLedger', [
    { id: `${tag}-w`, at: Date.now(), material: 'wood', delta: wood, kind: 'station', reason: 'test' },
    { id: `${tag}-s`, at: Date.now(), material: 'stone', delta: stone, kind: 'station', reason: 'test' },
    { id: `${tag}-f`, at: Date.now(), material: 'flower', delta: flower, kind: 'station', reason: 'test' },
  ])

async function workshop(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await spyAll(ctx)
    await giveMaterials(page, 4, 1, 0) // 木 4 石 1 花 0：做得起時鐘、木箱、牆上層板
    await page.goto(new URL('/#workshop', page.url()).href)
    await page.reload()
    await page.waitForSelector('[data-testid=workshop]')
    await page.waitForTimeout(600)
    const can = await page.locator('.ws-card.can').evaluateAll((els) => els.map((e) => e.dataset.testid))
    check(`[${size}] 做得起的卡片有標記（時鐘、木箱、牆上層板）`, ['craft-decor-clock', 'craft-decor-crate', 'craft-decor-wallshelf'].every((id) => can.includes(id)) && can.length === 3, can.join())
    const lit = await page.evaluate(() => {
      const art = getComputedStyle(document.querySelector('[data-testid=craft-decor-clock] .ws-art'))
      const card = getComputedStyle(document.querySelector('[data-testid=craft-decor-clock]'))
      return { anim: art.animationName, shadow: card.boxShadow }
    })
    check(`[${size}] 做得起：家具跳動（有動畫）、卡片發光（光暈陰影）`, lit.anim !== 'none' && /rgba\(255, 214, 107, 0\.75\)/.test(lit.shadow), JSON.stringify(lit))
    const dim = await page.evaluate(() => {
      const art = getComputedStyle(document.querySelector('[data-testid=craft-decor-rocket] .ws-art'))
      return { filter: art.filter, anim: art.animationName }
    })
    check(`[${size}] 做不起：卡片退成灰階、不跳動`, /grayscale/.test(dim.filter) && dim.anim === 'none', JSON.stringify(dim))
    // 做不起的按鈕：材料圖示 + 數字缺口，不是「還差石頭2」的文字
    const gap = await page.locator('[data-testid=craft-decor-rocket] .ws-gap-item').evaluateAll((els) => els.map((e) => ({ n: e.querySelector('b').textContent, hasIcon: !!e.querySelector('img, .art-emoji') })))
    check(`[${size}] 火箭做不起：按鈕是 3 個材料圖示 + 缺口數字（−1 −6 −2）`, gap.length === 3 && gap.map((g) => g.n).join() === '−1,−6,−2' && gap.every((g) => g.hasIcon), JSON.stringify(gap))
    const visibleText = await page.locator('[data-testid=craft-decor-rocket] .ws-btn').evaluate((b) => [...b.querySelectorAll(':scope > *')].filter((e) => !e.classList.contains('sr-only')).map((e) => e.innerText).join(''))
    check(`[${size}] 做不起的按鈕畫面上沒有「還差…」文字`, !/還差/.test(visibleText), visibleText)
    const gb = await boxOf(page, '[data-testid=craft-decor-rocket] .ws-btn')
    check(`[${size}] 缺口按鈕夠大（高 ≥56）`, gb.h >= 56, JSON.stringify(gb))
    if (size !== 'phone') await shot(page, 'workshop', size)
    else {
      await page.locator('[data-testid=craft-decor-clock]').scrollIntoViewIfNeeded()
      await shot(page, 'workshop', size)
    }
    // 點做不起的：語音說明、卡片晃一下
    await page.locator('[data-testid=craft-decor-rocket] .ws-btn').click({ force: true }) // aria-disabled：Playwright 預設不點，孩子的手指點得到
    await page.waitForTimeout(100)
    check(`[${size}] 點做不起的：語音「還差 1 個木材，6 個石頭，2 個花朵」`, (await page.evaluate(() => window.__spoken)).includes('還差1個木材，6個石頭，2個花朵'), String(await page.evaluate(() => window.__spoken)))
    check(`[${size}] 點做不起的：卡片晃一下`, (await page.locator('[data-testid=craft-decor-rocket].ux-shake').count()) === 1)
    check(`[${size}] 點做不起的：什麼都沒被做出來、材料沒扣`, (await qtyOf(page, 'decor-rocket')) === 0 && (await dump(page, 'materialLedger')).every((e) => e.delta >= 0))
    // 做得起的：做 → 大圖慶祝 → 去擺放
    await page.locator('[data-testid=craft-decor-clock] [data-testid=craft-btn]').click()
    await page.waitForSelector('[data-testid=craft-done]')
    await page.waitForTimeout(700)
    const art = await boxOf(page, '[data-testid=craft-done-art]')
    check(`[${size}] 做好：跳出家具大圖（≥200px）`, art.w >= 200 && art.h >= 200, JSON.stringify(art))
    check(`[${size}] 做好：觸發共用成功回饋（kind=craft）與語音「時鐘做好了！」`, (await page.evaluate(() => window.__fb)).some((f) => f.kind === 'craft' && f.sound && f.particles > 0) && (await page.evaluate(() => window.__spoken)).includes('時鐘做好了！'))
    const goBox = await boxOf(page, '[data-testid=craft-done-go]')
    check(`[${size}] 做好：有大大的「去擺放」按鈕（高 ≥72）`, goBox.h >= 72 && /去擺放/.test(await page.getByTestId('craft-done-go').innerText()), JSON.stringify(goBox))
    check(`[${size}] 做好：材料扣了、背包有時鐘`, (await qtyOf(page, 'decor-clock')) === 1)
    await shot(page, 'craft-done', size)
    await page.getByTestId('craft-done-go').click()
    await page.waitForSelector('[data-dock-item=decor-clock]')
    check(`[${size}] 按「去擺放」：直接進佈置模式，時鐘就在佈置列`, (await page.locator('.room.edit').count()) === 1 && (await page.locator('[data-dock-item=decor-clock]').count()) === 1)
    check(`[${size}] 工坊無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 壁紙：做好 → 「套用」直接換上
  {
    const { ctx, page } = await freshApp(browser, SIZES.land)
    await giveMaterials(page, 6, 4, 6)
    await page.goto(new URL('/#workshop', page.url()).href)
    await page.reload()
    await page.waitForSelector('[data-testid=workshop]')
    await page.getByTestId('ws-tab-wall').click()
    await page.locator('[data-testid=craft-wall-mint] [data-testid=craft-btn]').click()
    await page.waitForSelector('[data-testid=craft-done]')
    check('壁紙做好：慶祝畫面的主按鈕是「套用」', /套用/.test(await page.getByTestId('craft-done-go').innerText()))
    await page.getByTestId('craft-done-go').click()
    await page.waitForTimeout(400)
    const st = (await dump(page, 'settings'))[0]
    check('按「套用」：房間壁紙換成 wall-mint、慶祝畫面關掉', st.roomTheme?.wall === 'wall-mint' && (await page.getByTestId('craft-done').count()) === 0)
    await ctx.close()
  }
}

// ---------- 第 10 項：首頁引導、地圖回饋、任務收回、家長分頁列、房間箭頭、toast ----------
async function misc(browser) {
  // 首頁首次引導
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await spyAll(ctx)
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await page.waitForTimeout(500)
    check(`[${size}] 首次進首頁：冒險地圖按鈕發光、有手指指著`, (await page.locator('.candy.mint.guide').count()) === 1 && (await page.getByTestId('home-guide').count()) === 1)
    check(`[${size}] 首次進首頁：語音「我們去冒險吧」`, (await page.evaluate(() => window.__spoken)).includes('我們去冒險吧'))
    await shot(page, 'home-guide', size)
    await page.getByTestId('candy-map').click()
    await page.waitForSelector('[data-testid=map]')
    await page.locator('.screen-header .back').click()
    await page.waitForSelector('[data-testid=room]')
    check(`[${size}] 去過一次之後，引導不再出現`, (await page.getByTestId('home-guide').count()) === 0 && (await page.locator('.candy.guide').count()) === 0)
    check(`[${size}] 引導無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 房間左右「看旁邊」鈕
  {
    const { ctx, page } = await freshApp(browser, SIZES.land)
    await page.evaluate(() => (document.querySelector('[data-testid=room-scroller]').scrollLeft = 0))
    await page.waitForTimeout(200)
    const r = page.getByTestId('room-right')
    const b = await r.boundingBox()
    const radius = await r.evaluate((e) => getComputedStyle(e).borderRadius)
    const text = await r.innerText()
    check('房間右側「看旁邊」鈕：圓形、≥56px，內容不是返回鍵的「›」', b.width >= 56 && b.height >= 56 && Math.abs(b.width - b.height) < 1 && radius.startsWith('50%') && !/[‹›]/.test(text), `${b.width}x${b.height} ${radius} ${JSON.stringify(text)}`)
    await ctx.close()
  }
  // 地圖：點鎖住 / 已通關的站有回饋
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land)
    await spyAll(ctx)
    await putRows(page, 'progress', [
      { chapterId: 'huaguoshan', run: 1, stations: [{ done: true, independent: 4, total: 5 }, ...Array.from({ length: 4 }, () => ({ done: false, independent: 0, total: 0 }))], chestClaimed: false, completedRuns: 0, updatedAt: Date.now() },
    ])
    await page.reload()
    await page.getByTestId('candy-map').click()
    await page.waitForSelector('[data-testid=station-3]')
    await page.getByTestId('station-3').click({ force: true })
    await page.waitForTimeout(100)
    check('地圖：點鎖住的站 → 晃一下 + 語音「還沒到喔」，不會進關卡', (await page.locator('[data-testid=station-3].ux-wobble').count()) === 1 && (await page.evaluate(() => window.__spoken)).some((t) => t.startsWith('還沒到喔')) && (await page.getByTestId('map').count()) === 1)
    await page.waitForTimeout(700)
    await page.getByTestId('station-1').click({ force: true })
    await page.waitForTimeout(100)
    check('地圖：點已通關的站 → 晃一下 + 語音「這一站過關囉」，不會進關卡', (await page.locator('[data-testid=station-1].ux-wobble').count()) === 1 && (await page.evaluate(() => window.__spoken)).some((t) => t.startsWith('這一站過關囉')) && (await page.getByTestId('map').count()) === 1)
    await page.getByTestId('chest-node').click({ force: true })
    check('地圖：點鎖著的寶箱 → 語音說明', (await page.evaluate(() => window.__spoken)).some((t) => t.includes('寶箱還鎖著')))
    await shot(page, 'map-locked', 'land')
    check('地圖：目前這一站照常可以進入（第 2 站）', (await page.getByTestId('station-2').getAttribute('aria-disabled')) === 'false')
    check('地圖無 console 錯誤', errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 任務：送出 → 收回
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await spyAll(ctx)
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await page.locator('.candy.butter').click()
    await page.waitForSelector('[data-testid=task-submit]')
    await page.locator('[data-testid=task-submit]').first().click()
    await page.waitForSelector('[data-testid=task-withdraw]')
    const fb = await page.evaluate(() => window.__fb)
    check(`[${size}] 任務送出：觸發共用成功回饋（kind=task、有粒子）`, fb.some((f) => f.kind === 'task' && f.sound && f.particles > 0) && (await page.evaluate(() => window.__spoken)).includes('好棒喔！'))
    const toast = await boxOf(page, '.toast')
    check(`[${size}] toast 在畫面上方，不蓋底部按鈕（pointer-events: none）`, toast.y < 120 && (await page.locator('.toast').evaluate((e) => getComputedStyle(e).pointerEvents)) === 'none', JSON.stringify(toast))
    const st1 = (await dump(page, 'instances')).filter((i) => i.status === 'pending').length
    check(`[${size}] 送出後狀態是等審核（1 筆 pending）`, st1 === 1)
    const wb = await boxOf(page, '[data-testid=task-withdraw]')
    check(`[${size}] 「收回」鈕夠大（高 ≥56）`, wb.h >= 56, JSON.stringify(wb))
    await shot(page, 'task-pending', size)
    await page.getByTestId('task-withdraw').click()
    await page.waitForTimeout(300)
    const after = await dump(page, 'instances')
    check(`[${size}] 按「收回」：回到待辦（沒有 pending），可以再送出`, after.filter((i) => i.status === 'pending').length === 0 && (await page.locator('[data-testid=task-submit]').count()) === 5)
    await page.locator('[data-testid=task-submit]').first().click()
    await page.waitForTimeout(300)
    check(`[${size}] 收回後再送出：又是 pending`, (await dump(page, 'instances')).filter((i) => i.status === 'pending').length === 1)
    check(`[${size}] 任務無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 家長分頁列：11 個分頁（v6 新增「本週」）都找得到
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page } = await freshApp(browser, vp)
    await page.getByRole('button', { name: /家長入口/ }).click()
    await page.waitForSelector('button.key')
    await page.evaluate(async () => {
      for (const d of '1234') [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
      await new Promise((r) => setTimeout(r, 300))
    })
    await page.waitForSelector('[data-testid=parent-tabs]')
    const tabs = await page.locator('[data-testid=parent-tabs] .tab').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { name: e.textContent, x: r.x, y: Math.round(r.y), w: r.width, h: r.height } }))
    check(`[${size}] 家長分頁 11 個全部存在（含 v6「本週」）`, tabs.length === 11 && tabs.some((t) => t.name === '本週'), String(tabs.length))
    const rows = new Set(tabs.map((t) => t.y)).size
    check(`[${size}] v7：家長分頁單列（可橫向捲動），視覺順序 = DOM 順序`, rows === 1 && tabs.every((t, i) => i === 0 || t.x > tabs[i - 1].x), String(rows))
    check(`[${size}] v7：「PM 預覽」排在最後`, tabs.at(-1).name === 'PM 預覽')
    {
      const scrollable = await page.getByTestId('parent-tabs').evaluate((e) => e.scrollWidth > e.clientWidth + 4)
      await page.getByRole('tab', { name: 'PM 預覽', exact: true }).scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      const pm = await boxOf(page, '[role=tab]:has-text("PM 預覽")')
      check(`[${size}] 分頁列可以左右捲，捲到最後能點到「PM 預覽」`, (scrollable || size === 'land') && pm.x + pm.w <= vp.width + 1, JSON.stringify(pm))
    }
    await shot(page, 'parent-tabs', size)
    await page.getByRole('tab', { name: '設定', exact: true }).click({ force: true })
    check(`[${size}] 點「設定」分頁有反應`, (await page.getByRole('tab', { name: '設定', exact: true }).getAttribute('aria-selected')) === 'true')
    await ctx.close()
  }
}

const SECTIONS = { lockScreen, feedingGuard, dockTouch, shopBuy, coloringList, coloringLayout, artworkSpot, placeAndPoop, workshop, misc }

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
