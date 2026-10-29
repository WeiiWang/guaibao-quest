// v7.4 線 K E2E（Playwright）：朋友來作客（K1）與阿悟的小願望（K2）。
//   1) 作客：第一位朋友出現、站的位置不壓阿悟／家具／按鈕／氣泡（三種尺寸）、阿悟繞開它、點牠唸中文與英文
//   2) 第一次來的禮物：禮物卡、背包有新的畫、「去畫畫」打開那一張；全部畫都有了改送食物
//   3) 跨日：每天最多 1 位、順序固定、同一天重新整理不變、漏掉的日子不補；佈置模式收起來
//   4) 小願望：泡泡 → 工坊食譜（缺多少）→ 材料夠了做出來 → 擺進房間 → 阿悟演一段、說話、回憶卡 → 下一個願望
//   5) 不限時（隔天願望不變）、蛋不出願望、套裝願望（6–7 歲）、睡覺的願望（阿悟躺到床上再醒來）
//   6) 家長區「本週」一行字、相簿有回憶卡
// 觸控一律用接近真機的手指（radiusX 25）；WebKit 沒有 CDP，改用 touchscreen.tap。
// 用法：先啟動 dev server（pnpm dev --port 5204 --strictPort），再
//   BASE_URL=http://localhost:5204 node scripts/e2e-play74.mjs      （或 pnpm e2e:play74）
//   E2E_BROWSER=webkit BASE_URL=... node scripts/e2e-play74.mjs
// 想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-play74.mjs
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { freshApp, idb, IS_WEBKIT, launch, makeChecker, openParentTab, touchSender } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SHOT_DIR = process.env.SHOT_DIR
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
const allErrors = []
const SIZES = {
  land: { width: 1180, height: 820 },
  port: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
}
const DAY = 24 * 60 * 60 * 1000

// ---------- 題庫：讓孩子「認識」指定的朋友 ----------
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const bank = await vite.ssrLoadModule('/src/learning/bank.ts')
const friends = await vite.ssrLoadModule('/src/domain/friends.ts')
const play = await vite.ssrLoadModule('/src/domain/play74.ts')
await vite.close()
const questionFor = (id) => bank.QUESTIONS.find((q) => friends.objectsInQuestion(q).includes(id))
const attemptRows = (ids, at0 = Date.now() - 20 * DAY) =>
  ids.map((id, i) => {
    const q = questionFor(id)
    return { id: `k74-${id}-${i}`, at: at0 + i * 1000, questionId: q.id, skill: q.skill, difficulty: q.difficulty ?? 1, firstTryCorrect: true, hintsUsed: 0, durationMs: 1000, sessionId: 'k74' }
  })

// ---------- 假的 speechSynthesis：記下唸了什麼；每句 40ms 後觸發 onend（連續唸才會接著唸英文）----------
const SPEECH_STUB = () => {
  window.__spoken = []
  const fake = {
    speaking: false,
    speak(u) {
      window.__spoken.push({ t: u.text, lang: u.lang })
      window.setTimeout(() => u.onend && u.onend(), 40)
    },
    cancel() {},
    getVoices: () => [],
  }
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true })
  window.SpeechSynthesisUtterance = class {
    constructor(t) {
      this.text = t
    }
  }
}
const spoken = (page) => page.evaluate(() => window.__spoken.map((s) => s.t))
const spokenFull = (page) => page.evaluate(() => window.__spoken.slice())
const clearSpoken = (page) => page.evaluate(() => (window.__spoken.length = 0))
const hasSpoken = async (page, t) => (await spoken(page)).includes(t)
const waitSpoken = (page, t, timeout = 6000) => page.waitForFunction((t) => window.__spoken.some((s) => s.t === t), t, { timeout }).then(() => true, () => false)

// ---------- 資料庫小工具 ----------
const dump = (page, store) => idb(page, (db, s) => new Promise((r) => (db.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result))), store)
const settingsOf = async (page) => (await dump(page, 'settings'))[0]
const playOf = async (page) => (await settingsOf(page)).play ?? {}
const invQty = async (page, id) => (await dump(page, 'inventory')).find((v) => v.itemId === id)?.qty ?? 0
const putRows = (page, store, rows) =>
  idb(
    page,
    (db, a) =>
      new Promise((r) => {
        const tx = db.transaction(a.store, 'readwrite')
        for (const row of a.rows) tx.objectStore(a.store).put(row)
        tx.oncomplete = () => r(1)
      }),
    { store, rows },
  )
const patchSettings = (page, patch) =>
  idb(
    page,
    (db, patch) =>
      new Promise((r) => {
        const s = db.transaction('settings', 'readwrite').objectStore('settings')
        s.get('main').onsuccess = (e) => {
          s.put({ ...e.target.result, ...patch }).onsuccess = () => r(1)
        }
      }),
    patch,
  )
const giveMaterials = (page, wood, stone, flower) =>
  putRows(page, 'materialLedger', [
    { id: `k74-w-${Date.now()}`, at: Date.now(), material: 'wood', delta: wood, kind: 'station', reason: 'k74' },
    { id: `k74-s-${Date.now()}`, at: Date.now(), material: 'stone', delta: stone, kind: 'station', reason: 'k74' },
    { id: `k74-f-${Date.now()}`, at: Date.now(), material: 'flower', delta: flower, kind: 'station', reason: 'k74' },
  ])
const reload = async (page) => {
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
}

/**
 * 全新的 App + 假語音 + 已認識的朋友。ids = 依序認識的朋友 id；opts 轉給 freshApp。
 * 預設拿掉「把香蕉拖給阿悟吃」的第一次提示（它會蓋住房間左下角），讓版面檢查看到穩定狀態。
 */
async function app(browser, vp, ids, opts = {}) {
  const r = await freshApp(browser, vp, { ctxOpts: { hasTouch: true }, ...opts })
  const close = r.ctx.close.bind(r.ctx)
  r.ctx.close = async () => {
    allErrors.push(...r.errors)
    return close()
  }
  await r.ctx.addInitScript(SPEECH_STUB)
  await patchSettings(r.page, { feedHintShown: true, homeGuideShown: true })
  if (ids.length) await putRows(r.page, 'attempts', attemptRows(ids))
  await reload(r.page)
  r.touch = await touchSender(r.ctx, r.page)
  return r
}

/** 用接近真機的手指點一下（Chromium：CDP 觸控，接觸半徑 25；WebKit：touchscreen.tap） */
async function finger(r, x, y) {
  if (IS_WEBKIT) return r.page.touchscreen.tap(x, y)
  await r.touch('touchStart', [{ x, y, id: 1, radiusX: 25, radiusY: 25, force: 1 }])
  await r.page.waitForTimeout(70)
  await r.touch('touchEnd', [])
}
async function tapEl(r, sel) {
  const loc = r.page.locator(sel).first()
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  await finger(r, b.x + b.width / 2, b.y + b.height / 2)
}

const box = (page, sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }
  }, sel)
const overlapRatio = (a, b) => (!a || !b ? 0 : (Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))) / (a.w * a.h))
const inter = (a, b, pad = 0) => !!a && !!b && a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad
const shot = async (page, name) => {
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) })
}
const advanceDays = (page, n) => page.evaluate((n) => window.__debug.advanceDays(n), n)
const guestId = (page) => page.evaluate(() => document.querySelector('[data-testid=guest]')?.dataset.friend ?? null)
const waitGuest = (page, id) => page.waitForFunction((id) => document.querySelector('[data-testid=guest]')?.dataset.friend === id, id, { timeout: 8000 }).then(() => true, () => false)
const placeAt = (page, itemId, x, y) =>
  putRows(page, 'placements', [{ itemId, x, y, z: 0, flipped: false, placedAt: Date.now() }])

const browser = await launch()
try {
  // =====================================================================
  // 1) 第一位朋友來作客：位置、不重疊、阿悟繞開、點牠唸名字
  // =====================================================================
  for (const [name, vp] of Object.entries(SIZES)) {
    const r = await app(browser, vp, ['obj-rabbit', 'obj-banana', 'obj-star', 'obj-flower'], { fast: true, decor: ['decor-bed', 'decor-lamp'] })
    const { page } = r
    // 房間裡擺兩件地板家具，朋友要站在它們以外
    await placeAt(page, 'decor-bed', 0.46, 0.8)
    if (name !== 'phone') await placeAt(page, 'decor-lamp', 0.2, 0.78) // 手機畫面太窄，床 + 落地燈 + 阿悟已經塞滿，只擺床
    await reload(page)
    await page.waitForSelector('[data-testid=guest]', { timeout: 8000 })
    await page.waitForTimeout(900)
    check(`[${name}] 第一天：第一位認識的朋友（小兔子）來作客`, (await guestId(page)) === 'obj-rabbit')
    check(`[${name}] 第一次來：頭上有禮物標記`, (await page.locator('[data-testid=guest-gift-tag]').count()) === 1)
    const g = await box(page, '[data-testid=guest]')
    const sc = await box(page, '[data-testid=room-scroller]')
    check(`[${name}] 朋友完整在畫面裡（沒被切掉），大小 >= 56px（手指點得到）`, g.l >= sc.l - 1 && g.r <= sc.r + 1 && g.t >= sc.t && g.b <= sc.b && g.w >= 56 && g.h >= 56, JSON.stringify(g))
    const others = {
      阿悟: await box(page, '[data-testid=pet]'),
      狀態卡: await box(page, '.pet-hud'),
      名字膠囊: await box(page, '.hello'),
      右側按鈕欄: await box(page, '.side-tools'),
      左箭頭: await box(page, '[data-testid=room-left]'),
      右箭頭: await box(page, '[data-testid=room-right]'),
      小床: await box(page, '[data-placed="decor-bed"]'),
      落地燈: await box(page, '[data-placed="decor-lamp"]'),
      願望泡泡: await box(page, '[data-testid=wish-bubble]'),
    }
    for (const [k, b] of Object.entries(others)) {
      if (!b) continue
      // 家具的方框含透明邊，而且這裡故意把房間擺得很擠（床 + 落地燈）：家具允許方框擦到一點點（< 12%），阿悟與按鈕一律不能碰
      if (k === '小床' || k === '落地燈') check(`[${name}] 朋友幾乎沒有壓到${k}（方框重疊 < 12%）`, overlapRatio(g, b) < 0.12, `${(overlapRatio(g, b) * 100).toFixed(1)}%`)
      else check(`[${name}] 朋友沒有壓到${k}`, !inter(g, b), `${JSON.stringify(g)} vs ${JSON.stringify(b)}`)
    }
    check(`[${name}] 願望泡泡（有的話）沒有壓到右側按鈕欄與狀態卡`, !others.願望泡泡 || (!inter(others.願望泡泡, others.右側按鈕欄) && !inter(others.願望泡泡, others.狀態卡) && !inter(others.願望泡泡, others.名字膠囊)))
    await shot(page, `k74-${name}-guest`)

    // 阿悟走動 12 秒（自主行為加速）：不會走進朋友身上
    const hits = await page.evaluate(
      () =>
        new Promise((res) => {
          let n = 0
          let samples = 0
          const t0 = performance.now()
          const tick = () => {
            const p = document.querySelector('[data-testid=pet-slot]')?.getBoundingClientRect()
            const gg = document.querySelector('[data-testid=guest]')?.getBoundingClientRect()
            if (p && gg) {
              samples++
              // 阿悟的身體寬度取中間 60%（左右的空白不算）
              const pl = p.left + p.width * 0.2
              const pr = p.right - p.width * 0.2
              if (pl < gg.right - 4 && pr > gg.left + 4) n++
            }
            if (performance.now() - t0 < 12000) setTimeout(tick, 100)
            else res({ n, samples })
          }
          tick()
        }),
    )
    check(`[${name}] 阿悟走動 12 秒，沒有走進朋友身上`, hits.n === 0 && hits.samples > 80, JSON.stringify(hits))
    await r.ctx.close()
  }

  // =====================================================================
  // 2) 打招呼、點朋友、禮物卡、去畫畫
  // =====================================================================
  {
    const r = await app(browser, SIZES.land, ['obj-rabbit', 'obj-banana', 'obj-star', 'obj-flower'])
    const { page } = r
    await page.waitForSelector('[data-testid=guest]')
    check('打招呼：「今天小兔子來玩囉！」', await waitSpoken(page, '今天小兔子來玩囉！'), (await spoken(page)).join('|'))
    const p1 = await playOf(page)
    check('紀錄：settings.play 有今天的訪客、來過的朋友、紀錄', p1.guest?.friendId === 'obj-rabbit' && p1.guest.first === true && p1.guestVisited?.join() === 'obj-rabbit' && p1.guestVisits === 1 && p1.guestLog?.length === 1)
    const gift = p1.guest.gift
    check('第一次來：留下固定禮物（第一張還沒有的著色頁：小恐龍；免費送的兩張不重複送）寫進背包', gift?.kind === 'coloring' && gift.id === 'line-dino' && (await invQty(page, 'coloring-line-dino')) === 1, JSON.stringify(gift))
    await page.waitForTimeout(500)
    check('打招呼只說一次（記在 guest.greeted）', (await playOf(page)).guest.greeted === true)
    await clearSpoken(page)
    await tapEl(r, '[data-testid=guest]')
    check('點朋友：唸中文名字「小兔子」', await waitSpoken(page, '小兔子', 3000))
    await waitSpoken(page, 'rabbit', 3000)
    const full = await spokenFull(page)
    check('點朋友：接著唸英文 rabbit（en-US）', full.some((s) => s.t === 'rabbit' && /^en/i.test(s.lang)), JSON.stringify(full))
    await page.waitForSelector('[data-testid=guest-gift]')
    check('點朋友：跳出禮物卡，寫「小兔子送你一張新的畫！」，有縮圖與「去畫畫」', (await page.locator('[data-testid=guest-gift] h2').innerText()) === '小兔子送你一張新的畫！' && (await page.locator('[data-testid=guest-gift-item] svg, [data-testid=guest-gift-item] img').count()) >= 1 && (await page.locator('[data-testid=guest-gift-go]').count()) === 1)
    check('禮物卡唸「小兔子送你一張新的畫！」', await waitSpoken(page, '小兔子送你一張新的畫！', 3000))
    await page.waitForTimeout(600)
    const gb = await box(page, '[data-testid=guest-gift-go]')
    check('「去畫畫」鈕 >= 56px', gb.h >= 56 && gb.w >= 56, JSON.stringify(gb))
    await shot(page, 'k74-gift-card')
    await tapEl(r, '[data-testid=guest-gift-go]')
    await page.waitForSelector('[data-testid=paint-screen]')
    check('「去畫畫」：直接打開送的那一張（小恐龍）', (await page.locator('[data-testid=paint-screen]').getAttribute('data-page')) === 'line-dino')
    await reload(page)
    check('看過禮物以後：禮物標記不見，朋友還在', (await page.locator('[data-testid=guest-gift-tag]').count()) === 0 && (await guestId(page)) === 'obj-rabbit' && (await playOf(page)).guest.seen === true)
    await clearSpoken(page)
    await page.waitForTimeout(2200)
    check('同一天再進首頁：不再重複打招呼', !(await hasSpoken(page, '今天小兔子來玩囉！')))
    // 佈置模式：朋友先收起來
    await page.getByRole('button', { name: /佈置/ }).click()
    await page.waitForTimeout(300)
    check('佈置模式：朋友收起來，不擋著擺家具', (await page.locator('[data-testid=guest]').count()) === 0)
    await page.getByRole('button', { name: /完成/ }).click()
    await page.waitForTimeout(300)
    check('離開佈置模式：朋友回來', (await guestId(page)) === 'obj-rabbit')
    await r.ctx.close()
  }

  // =====================================================================
  // 3) 跨日：每天最多 1 位、順序固定、不補；後認識的排後面；全部畫都有了改送食物
  // =====================================================================
  {
    const r = await app(browser, SIZES.land, ['obj-rabbit', 'obj-banana', 'obj-star', 'obj-flower'])
    const { page } = r
    await page.waitForSelector('[data-testid=guest]')
    check('第 1 天：小兔子', (await guestId(page)) === 'obj-rabbit')
    const before = await playOf(page)
    await advanceDays(page, 1)
    check('第 2 天：下一位（香蕉），不是同時兩位', await waitGuest(page, 'obj-banana') && (await page.locator('[data-testid=guest]').count()) === 1)
    const p2 = await playOf(page)
    check('第 2 天：禮物換成另一種（連連看），背包真的有', p2.guest.gift?.kind === 'dots' && (await invQty(page, `coloring-${p2.guest.gift.id}`)) === 1, JSON.stringify(p2.guest.gift))
    check('第 2 天：來過的朋友依序是 小兔子、香蕉；總共來 2 次', p2.guestVisited.join() === 'obj-rabbit,obj-banana' && p2.guestVisits === 2)
    await reload(page)
    check('同一天重新整理：還是香蕉，不會多來一位、不會多送禮物', (await guestId(page)) === 'obj-banana' && (await playOf(page)).guestVisits === 2 && (await playOf(page)).guestLog.length === 2)
    // 漏掉 4 天：隔 5 天回來，只來「下一位」（星星），不補中間漏掉的日子
    await advanceDays(page, 5)
    check('漏掉 5 天再回來：只來 1 位，而且是順序的下一位（星星），不補', await waitGuest(page, 'obj-star'))
    const p3 = await playOf(page)
    check('漏掉的日子不補：總共來過 3 次（不是 7 次）', p3.guestVisits === 3 && p3.guestLog.length === 3 && before.guestVisits === 1)
    // 當天又認識了新朋友：今天的訪客不變，新朋友排在最後
    await putRows(page, 'attempts', attemptRows(['obj-fish'], Date.now() + 1000))
    await reload(page)
    check('當天認識新朋友：今天的訪客不變', (await guestId(page)) === 'obj-star')
    await advanceDays(page, 1)
    check('隔天：先來原本排在前面的（花），新朋友（小魚）排在後面', await waitGuest(page, 'obj-flower'))
    await advanceDays(page, 1)
    check('再隔天：才輪到小魚', await waitGuest(page, 'obj-fish'))
    // 朋友都來過了：回訪，不再留禮物
    await advanceDays(page, 1)
    await page.waitForFunction(() => document.querySelector('[data-testid=guest]')?.dataset.friend === 'obj-rabbit', null, { timeout: 8000 }).catch(() => {})
    const p4 = await playOf(page)
    check('朋友都來過了：回訪的朋友不再留禮物、也沒有禮物標記', p4.guest.first === false && !p4.guest.gift && (await page.locator('[data-testid=guest-gift-tag]').count()) === 0, JSON.stringify(p4.guest))
    await r.ctx.close()
  }
  {
    // 全部畫都有了：第一次來的朋友改送食物
    const r = await app(browser, SIZES.land, [])
    const { page } = r
    const rows = play.allGiftItemIds('4-5').map((id) => ({ id, itemId: id, qty: 1 }))
    await putRows(page, 'inventory', rows)
    await putRows(page, 'attempts', attemptRows(['obj-rabbit']))
    await reload(page)
    await page.waitForSelector('[data-testid=guest]')
    const p = await playOf(page)
    check('全部的著色頁與連連看都有了：禮物改成食物（固定第一種）', p.guest.gift?.kind === 'food' && p.guest.gift.id === play.GUEST_FOODS[0], JSON.stringify(p.guest.gift))
    const foodBefore = await invQty(page, play.GUEST_FOODS[0])
    check('食物寫進背包', foodBefore >= 1)
    await tapEl(r, '[data-testid=guest]')
    await page.waitForSelector('[data-testid=guest-gift]')
    check('食物禮物卡：「小兔子送你好吃的！」，沒有「去畫畫」', (await page.locator('[data-testid=guest-gift] h2').innerText()) === '小兔子送你好吃的！' && (await page.locator('[data-testid=guest-gift-go]').count()) === 0)
    await r.ctx.close()
  }

  // =====================================================================
  // 4) 小願望：泡泡 → 工坊食譜 → 做出來 → 擺進房間 → 阿悟演一段、回憶卡 → 下一個
  // =====================================================================
  {
    const r = await app(browser, SIZES.land, ['obj-rabbit'], { stage: 'adult' })
    const { page } = r
    await page.waitForSelector('[data-testid=wish-bubble]')
    check('首頁：出現第一個小願望泡泡（皮球），一次只有 1 個', (await page.locator('[data-testid=wish-bubble]').count()) === 1 && (await page.locator('[data-testid=wish-bubble]').getAttribute('data-wish')) === 'w-ball')
    check('泡泡裡是那件家具的 3D 圖', (await page.locator('[data-testid=wish-bubble] img').count()) >= 1 && (await page.locator('[data-testid=wish-bubble] img').first().getAttribute('src')).includes('decor-ball'))
    const wb = await box(page, '[data-testid=wish-bubble]')
    check('泡泡 >= 56px 手指點得到', wb.w >= 56 && wb.h >= 56, JSON.stringify(wb))
    check('阿悟自己說一次願望', await waitSpoken(page, '我想要一顆球，可以滾來滾去！', 6000))
    await shot(page, 'k74-wish-bubble')
    await clearSpoken(page)
    await tapEl(r, '[data-testid=wish-bubble]')
    await page.waitForSelector('[data-testid=wish-recipe]')
    check('點泡泡：到工坊，最上面亮出這個願望的食譜（皮球）', (await page.locator('[data-testid=wish-recipe]').getAttribute('data-wish')) === 'w-ball' && (await page.locator('[data-testid=wish-item-decor-ball]').count()) === 1)
    check('食譜：材料不夠，顯示缺多少（圖示 + 數字：木材 2、花朵 1）', (await page.locator('[data-testid=wish-item-decor-ball]').getAttribute('data-state')) === 'gap' && /還差.*木材2.*花朵1|還差 木材2 花朵1/.test((await page.locator('[data-testid=wish-gap]').getAttribute('aria-label')) ?? ''), (await page.locator('[data-testid=wish-gap]').getAttribute('aria-label')) ?? '')
    check('進工坊：阿悟說願望（食譜上一次）', await waitSpoken(page, '我想要一顆球，可以滾來滾去！', 3000))
    await shot(page, 'k74-workshop-gap')
    await tapEl(r, '[data-testid=wish-short]')
    check('材料不夠按「材料還不夠」：唸「材料還不夠喔，去冒險找材料吧」', await waitSpoken(page, '材料還不夠喔，去冒險找材料吧', 3000))
    // 給材料：木材 2、花朵 1 剛好夠
    await giveMaterials(page, 2, 0, 1)
    await reload(page)
    await page.waitForSelector('[data-testid=wish-bubble]')
    await tapEl(r, '[data-testid=wish-bubble]')
    await page.waitForSelector('[data-testid=wish-recipe]')
    await page.waitForFunction(() => document.querySelector('[data-testid=wish-item-decor-ball]')?.dataset.state === 'can')
    check('材料夠了：食譜上出現「製作」', (await page.locator('[data-testid=wish-craft]').count()) === 1)
    await tapEl(r, '[data-testid=wish-craft]')
    await page.waitForSelector('[data-testid=craft-done]')
    check('食譜上直接做：做好了慶祝，背包有皮球', (await invQty(page, 'decor-ball')) === 1)
    await tapEl(r, '[data-testid=craft-done-go]')
    await page.waitForSelector('.room-frame.editing')
    check('「去擺放」：進佈置模式，這時還沒實現願望', (await playOf(page)).wishActive === 'w-ball' && (await playOf(page)).wishLog === undefined)
    await page.locator('[data-dock-item="decor-ball"]').first().click()
    await page.waitForTimeout(500)
    check('把皮球擺進房間（佈置中）：願望還沒演（等離開佈置模式）', (await page.locator('[data-testid=memory-pop]').count()) === 0 && (await playOf(page)).wishLog === undefined)
    await clearSpoken(page)
    await page.getByRole('button', { name: /完成/ }).click()
    check('離開佈置模式：阿悟說「哇，是球！一起玩吧！」', await waitSpoken(page, '哇，是球！一起玩吧！', 4000), (await spoken(page)).join('|'))
    check('願望實現後泡泡先收起來（沒有倒數、不立刻出下一個）', (await page.locator('[data-testid=wish-bubble]').count()) === 0)
    const sawAnim = await page.evaluate(
      () =>
        new Promise((res) => {
          const t0 = performance.now()
          const tick = () => {
            const pet = document.querySelector('[data-testid=pet]')
            if (pet && (pet.dataset.anim || (pet.dataset.pose && pet.dataset.pose !== 'idle'))) return res(true)
            if (performance.now() - t0 > 2500) return res(false)
            setTimeout(tick, 60)
          }
          tick()
        }),
    )
    check('阿悟演一段（用既有的動作：跳舞）', sawAnim)
    await page.waitForSelector('[data-testid=memory-pop][data-card="wish:w-ball"]', { timeout: 9000 })
    check('送一張回憶卡「小願望實現了：皮球！」（標「新」，卡上有皮球的圖）', (await page.locator('[data-testid=memory-pop] [data-testid=album-caption]').innerText()) === '小願望實現了：皮球！' && (await page.locator('[data-testid=memory-pop] [data-testid=album-reward]').getAttribute('data-reward')) === 'decor-ball')
    await shot(page, 'k74-wish-card')
    const pw = await playOf(page)
    check('紀錄：願望完成、下一個是小盆栽', pw.wishDone.join() === 'w-ball' && pw.wishActive === 'w-plant' && pw.wishLog.length === 1)
    check('回憶卡出現的時候，下一個願望還沒出現（先喘口氣）', (await page.locator('[data-testid=wish-bubble]').count()) === 0)
    await tapEl(r, '[data-testid=memory-close]')
    await page.waitForSelector('[data-testid=wish-bubble][data-wish="w-plant"]', { timeout: 12000 })
    check('接著出現下一個願望（小盆栽），一次仍然只有 1 個', (await page.locator('[data-testid=wish-bubble]').count()) === 1)
    // 不限時：隔 3 天，願望還是同一個、沒有任何東西被扣
    const matsBefore = (await dump(page, 'materialLedger')).reduce((s, m) => s + m.delta, 0)
    await advanceDays(page, 3)
    await page.waitForTimeout(800)
    check('不限時：隔了 3 天願望沒有換、沒有倒數', (await page.locator('[data-testid=wish-bubble]').getAttribute('data-wish')) === 'w-plant' && (await playOf(page)).wishDone.join() === 'w-ball')
    check('不做也沒有損失：材料、背包都沒有被扣（只會多、不會少）', (await dump(page, 'materialLedger')).reduce((s, m) => s + m.delta, 0) >= matsBefore && (await invQty(page, 'decor-ball')) === 1)
    // 家長區本週
    await openParentTab(page, '本週')
    await page.waitForSelector('[data-testid=weekly-play]')
    const wg = await page.locator('[data-testid=weekly-guests]').innerText()
    const ww = await page.locator('[data-testid=weekly-wishes]').innerText()
    check('家長區「本週」：這週來作客的朋友與收到的新玩意（白話）', wg.includes('小兔子') && wg.includes('小恐龍'), wg)
    check('家長區「本週」：這週實現的小願望與現在想要的家具', ww.includes('1 個小願望') && ww.includes('皮球') && ww.includes('小盆栽'), ww)
    await shot(page, 'k74-parent-weekly')
    await r.ctx.close()
  }

  // 成長相簿有回憶卡
  {
    const r = await app(browser, SIZES.land, ['obj-rabbit'], { stage: 'adult' })
    const { page } = r
    await patchSettings(page, { play: { wishDone: [], wishActive: 'w-ball', wishSaid: 'w-ball' } })
    await putRows(page, 'inventory', [{ id: 'decor-ball', itemId: 'decor-ball', qty: 1 }])
    await placeAt(page, 'decor-ball', 0.5, 0.82)
    await reload(page)
    await page.waitForSelector('[data-testid=memory-pop][data-card="wish:w-ball"]', { timeout: 9000 })
    await tapEl(r, '[data-testid=memory-album]')
    await page.waitForSelector('[data-testid=album-card]')
    check('成長相簿：有「小願望」的回憶卡', (await page.locator('[data-testid=album-card][data-kind=wish]').count()) === 1)
    await shot(page, 'k74-album')
    await r.ctx.close()
  }

  // =====================================================================
  // 5) 蛋不出願望、舊存檔略過已擺好的、睡覺的願望、套裝（6–7 歲）
  // =====================================================================
  {
    const r = await app(browser, SIZES.land, [], { stage: 'egg' })
    await r.page.waitForTimeout(1500)
    check('蛋還沒孵出來：沒有願望泡泡', (await r.page.locator('[data-testid=wish-bubble]').count()) === 0 && (await playOf(r.page)).wishActive === undefined)
    await r.ctx.close()
  }
  {
    // 舊存檔：球與小盆栽早就擺好了 → 願望直接從時鐘開始，沒有回憶卡
    const r = await app(browser, SIZES.land, [], { stage: 'adult' })
    const { page } = r
    await patchSettings(page, { play: undefined, album: undefined, albumInit: false }) // 像舊存檔：還沒有任何小願望的紀錄
    await putRows(page, 'inventory', [{ id: 'decor-ball', itemId: 'decor-ball', qty: 1 }, { id: 'decor-plant', itemId: 'decor-plant', qty: 1 }])
    await placeAt(page, 'decor-ball', 0.5, 0.82)
    await placeAt(page, 'decor-plant', 0.35, 0.8)
    await reload(page)
    await page.waitForSelector('[data-testid=wish-bubble]')
    check('舊存檔：已經擺好的家具直接略過（不演、不送卡），願望從時鐘開始', (await page.locator('[data-testid=wish-bubble]').getAttribute('data-wish')) === 'w-clock' && (await settingsOf(page)).album?.some((c) => c.kind === 'wish') !== true)
    await r.ctx.close()
  }
  {
    // 睡覺的願望：床擺好 → 阿悟躺到床上睡一下，再醒來
    const r = await app(browser, SIZES.land, [], { stage: 'adult' })
    const { page } = r
    const singles = play.WISHES.filter((w) => !w.set).map((w) => w.id)
    const idx = singles.indexOf('w-bed')
    await patchSettings(page, { play: { wishDone: singles.slice(0, idx), wishActive: 'w-bed', wishSaid: 'w-bed' } })
    await putRows(page, 'inventory', [{ id: 'decor-bed', itemId: 'decor-bed', qty: 1 }])
    await placeAt(page, 'decor-bed', 0.5, 0.82)
    await reload(page)
    const slept = await page.evaluate(
      () =>
        new Promise((res) => {
          const t0 = performance.now()
          const tick = () => {
            if (document.querySelector('[data-testid=pet]')?.dataset.asleep === 'true') return res(true)
            if (performance.now() - t0 > 3500) return res(false)
            setTimeout(tick, 60)
          }
          tick()
        }),
    )
    check('睡覺的願望：床擺好，阿悟躺下睡覺', slept)
    await shot(page, 'k74-wish-sleep')
    await page.waitForSelector('[data-testid=memory-pop][data-card="wish:w-bed"]', { timeout: 9000 })
    await page.waitForTimeout(1200)
    check('睡了一下就醒來（不會一直睡著）', (await page.locator('[data-testid=pet]').getAttribute('data-asleep')) === null)
    check('回憶卡用「睡覺」的姿勢', (await settingsOf(page)).album.find((c) => c.id === 'wish:w-bed').art === 'pet-adult-sleep')
    await r.ctx.close()
  }
  {
    // 套裝（6–7 歲）：單一願望做完後出現，泡泡裡 3 件家具，食譜列出 3 件
    const r = await app(browser, SIZES.land, [], { stage: 'adult' })
    const { page } = r
    const singles = play.WISHES.filter((w) => !w.set).map((w) => w.id)
    await patchSettings(page, { ageBand: '6-7', play: { wishDone: singles, wishActive: 'w-camp', wishSaid: 'w-camp' } })
    await reload(page)
    await page.waitForSelector('[data-testid=wish-bubble]')
    check('6–7 歲：單一願望做完後出現套裝願望（露營組），泡泡裡 3 件家具', (await page.locator('[data-testid=wish-bubble]').getAttribute('data-wish')) === 'w-camp' && (await page.locator('[data-testid=wish-bubble] img').count()) === 3)
    await shot(page, 'k74-wish-set')
    await tapEl(r, '[data-testid=wish-bubble]')
    await page.waitForSelector('[data-testid=wish-recipe]')
    check('套裝食譜：列出帳篷、落地燈、圓地毯 3 件，各自顯示缺多少', (await page.locator('[data-testid^=wish-item-]').count()) === 3 && (await page.locator('[data-testid=wish-gap]').count()) === 3)
    await shot(page, 'k74-workshop-set')
    await r.ctx.close()
  }
  {
    // 4–5 歲沒有套裝願望
    const r = await app(browser, SIZES.land, [], { stage: 'adult' })
    const { page } = r
    const singles = play.WISHES.filter((w) => !w.set).map((w) => w.id)
    await patchSettings(page, { ageBand: '4-5', play: { wishDone: singles } })
    await reload(page)
    await page.waitForTimeout(1200)
    check('4–5 歲：單一願望都做完就沒有下一個（套裝只給 6–7 歲）', (await page.locator('[data-testid=wish-bubble]').count()) === 0)
    await r.ctx.close()
  }

  // =====================================================================
  // 6) 三種尺寸：朋友 + 願望泡泡 + 禮物袋同時在，不互相壓
  // =====================================================================
  for (const [name, vp] of Object.entries(SIZES)) {
    const r = await app(browser, vp, ['obj-rabbit'], { stage: 'adult', welcome: true })
    const { page } = r
    await page.waitForSelector('[data-testid=guest]')
    await page.waitForSelector('[data-testid=wish-bubble]')
    await page.waitForTimeout(800)
    const g = await box(page, '[data-testid=guest]')
    const w = await box(page, '[data-testid=wish-bubble]')
    const bag = await box(page, '[data-testid=gift-bag]')
    check(`[${name}] 朋友、願望泡泡同時出現，互不重疊`, !inter(g, w))
    check(`[${name}] 有禮物袋時，朋友沒有壓到禮物袋`, !bag || !inter(g, bag), JSON.stringify({ g, bag }))
    check(`[${name}] 願望泡泡完整在畫面裡`, w.l >= 0 && w.r <= vp.width && w.t >= 0)
    await shot(page, `k74-${name}-both`)
    await r.ctx.close()
  }

  check('全程沒有 pageerror / console error', allErrors.length === 0, allErrors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
