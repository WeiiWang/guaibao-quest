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

/** 記錄語音：window.__spoken = 唸過的句子；WebAudio 發聲次數在 window.__audio.osc（e2e-lib 已掛） */
const spySpeech = (ctx) =>
  ctx.addInitScript(() => {
    window.__spoken = []
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

const SECTIONS = { lockScreen, feedingGuard, dockTouch }
void SECTIONS
void balance
void qtyOf
void giveStars
void spySpeech

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
