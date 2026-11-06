// v8.3 線 W E2E（Playwright）：捉迷藏與小小音樂會。
//   捉迷藏：三個年齡的物件數、三種尺寸不重疊不捲動、點空的驚喜與節流、三個年齡的提示、找到、禮物只送一次、換地方、減少動態、旋轉、計時器清乾淨
//   音樂會：三種尺寸的鍵夠大不捲動、按下當下就發聲、多指和音、鼓、音效開關、三個年齡的魔法演奏差異、自由彈 30 下、禮物只送一次、背景音樂靜音
// 手指一律用接近真機的 50px 寬（radiusX 25）。
// 用法：先啟動 dev server（pnpm dev --port 5212 --strictPort），再
//   BASE_URL=http://localhost:5212 node scripts/e2e-play-w.mjs      （或 pnpm e2e:play-w）
//   E2E_BROWSER=webkit BASE_URL=... node scripts/e2e-play-w.mjs
// 只跑一半：ONLY=hide 或 ONLY=music
// 想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-play-w.mjs
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { freshApp, idb, IS_WEBKIT, launch, makeChecker, touchSender } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SHOT_DIR = process.env.SHOT_DIR
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
const tag = IS_WEBKIT ? 'webkit' : 'chromium'
const allErrors = []
const SIZES = {
  land: { width: 1180, height: 820 },
  port: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
}
const SONG_TWINKLE = 'C5 C5 G5 G5 A5 A5 G5 F5 F5 E5 E5 D5 D5 C5'.split(' ')
const SONG_TIGERS = 'C5 D5 E5 C5 C5 D5 E5 C5 E5 F5 G5 E5 F5 G5 G5 A5 G5 F5 E5 C5 G5 A5 G5 F5 E5 C5 C6 G5 C6 C6 G5 C6'.split(' ')

const browser = await launch()
// WebKit 曾因動畫 filter 整個閃退（CAPresentationModifier）：閃退要明確報出來，不要混在逾時裡
let closing = false
browser.on('disconnected', () => {
  if (!closing) check('瀏覽器沒有閃退', false)
})
const ONLY = process.env.ONLY

const patchSettings = (page, patch) =>
  idb(
    page,
    (db, patch) =>
      new Promise((r) => {
        const st = db.transaction('settings', 'readwrite').objectStore('settings')
        st.get('main').onsuccess = (e) => {
          st.put({ ...e.target.result, ...patch }).onsuccess = () => r(1)
        }
      }),
    patch,
  )

const foodTotal = (page) =>
  idb(
    page,
    (db) =>
      new Promise((r) => {
        const out = {}
        const tx = db.transaction(['inventory', 'settings'])
        tx.objectStore('inventory').getAll().onsuccess = (e) => {
          for (const i of e.target.result) out[i.id] = i.qty
        }
        tx.objectStore('settings').get('main').onsuccess = (e) => {
          out.__daily = e.target.result.playDaily ?? null
        }
        tx.oncomplete = () => r(out)
      }),
  )

/** 開一個全新的 App，設定好年齡，直接進某個玩法 */
async function enter(game, { size = SIZES.land, age, settings = {}, ctxOpts = {} } = {}) {
  const app = await freshApp(browser, size, { ctxOpts })
  // 記下每個計時器是誰排的（疊在 e2e-lib 的 __timers 外面），驗證離開時清乾淨
  await app.ctx.addInitScript(() => {
    const pending = new Map()
    window.__pgTimers = pending
    const st = window.setTimeout
    const ct = window.clearTimeout
    window.setTimeout = (fn, ms, ...a) => {
      const stack = new Error().stack ?? ''
      const id = st(() => {
        pending.delete(id)
        return typeof fn === 'function' ? fn(...a) : undefined
      }, ms)
      pending.set(id, { ms, stack })
      return id
    }
    window.clearTimeout = (id) => {
      pending.delete(id)
      return ct(id)
    }
  })
  const patch = { ...settings }
  if (age) patch.ageBand = age
  await patchSettings(app.page, patch)
  // 只改網址不觸發換畫面，再重新整理：不然 lazy 載入中途被 reload 打斷，WebKit 會報 module 載入失敗
  await app.page.evaluate((g) => history.replaceState(null, '', `#game/${g}`), game)
  await app.page.reload()
  await app.page.waitForSelector(game === 'hide' ? '[data-testid=pg-hide]' : '[data-testid=pg-mus]')
  if (age) await app.page.waitForSelector(`[data-age="${age}"]`)
  const send = await touchSender(app.ctx, app.page)
  const finger = async (points) => {
    const pts = points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 25, radiusY: 25, force: 0.5 }))
    await send('touchStart', pts)
    await send('touchEnd', [])
  }
  return { ...app, send, finger }
}

const close = async (app, label) => {
  check(`${label}：沒有頁面錯誤`, app.errors.length === 0, app.errors.join(' | '))
  allErrors.push(...app.errors)
  await app.ctx.close()
}

const centerOf = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}
const attr = (page, sel, name) => page.locator(sel).first().getAttribute(name)
const phase = (page) => attr(page, '[data-testid=pg-hide]', 'data-phase')
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1)
const waitSeek = (page) => page.waitForSelector('[data-testid=pg-hide][data-phase=seek]', { timeout: 15000 })
const spotsOf = (page) => page.locator('[data-testid^=pg-hide-spot-]')
const hidingSpot = (page) => page.locator('[data-hiding="1"]').first().getAttribute('data-testid').then((s) => s.replace('pg-hide-spot-', ''))
const emptySpot = async (page, not = []) => {
  const here = await hidingSpot(page)
  const ids = await spotsOf(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('pg-hide-spot-', '')))
  return ids.find((id) => id !== here && !not.includes(id))
}
const tapSpot = async (app, id) => {
  const c = await centerOf(app.page, `[data-testid=pg-hide-spot-${id}]`)
  await app.finger([c])
}
/** 還沒觸發的計時器裡，由玩法的程式碼（playground/ 底下）排的有幾個 */
// 大廳（Playground.tsx）自己的公車提示計時器不算：它卸載時會清，這裡只驗玩法本身
const timers = (page) => page.evaluate(() => [...window.__pgTimers.values()].filter((t) => /\/playground\//.test(t.stack) && !/\/playground\/Playground\.tsx/.test(t.stack)).length)
const toHub = async (page) => {
  await page.evaluate(() => history.replaceState(null, '', '#playground'))
  await page.reload()
  await page.waitForSelector('[data-testid=playground-grid]')
}
const enterFromHub = async (page, game) => {
  await page.locator(`[data-testid=game-${game}]`).click()
  await page.waitForSelector(`[data-testid=play-${game}]`)
}
const leaveToHub = async (page, game) => {
  await page.locator('[data-testid=game-back]').click()
  await page.waitForSelector(`[data-testid=play-${game}]`, { state: 'detached' })
  await page.waitForSelector('[data-testid=playground-grid]')
  await page.waitForTimeout(150)
}
const overlapping = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5

async function checkHideLayout(page, name, vp, expectCount) {
  const boxes = await spotsOf(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
  check(`${name}：物件數量 ${expectCount}`, boxes.length === expectCount, String(boxes.length))
  let ok = true
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlapping(boxes[i], boxes[j])) ok = false
  check(`${name}：物件不重疊`, ok)
  check(`${name}：每個至少 100px（遠大於 56）`, boxes.every((b) => b.width >= 100 && b.height >= 100), boxes.map((b) => Math.round(b.width)).join(','))
  check(`${name}：都在畫面內`, boxes.every((b) => b.x >= 0 && b.y >= 0 && b.right <= vp.width + 0.5 && b.bottom <= vp.height + 0.5))
  check(`${name}：物件不壓回去鍵`, (await page.locator('[data-testid=game-back]').boundingBox()).y + 60 <= Math.min(...boxes.map((b) => b.y)) + 4)
  check(`${name}：無橫向捲動`, await noHScroll(page))
}

// ========== 捉迷藏 ==========
if (ONLY !== 'music') {

// 1) 三種尺寸 + 三個年齡的物件數
for (const [name, size] of Object.entries(SIZES)) {
  for (const [age, n] of [['3', 4], ['4-5', 5], ['6-7', 6]]) {
    const app = await enter('hide', { size, age })
    const { page } = app
    await page.waitForSelector('[data-testid=pg-hide-spot-bush]')
    if (age === '6-7') {
      // 開場：寵物站著，數數，然後不見
      check(`hide ${name}：開場寵物在場`, (await page.locator('[data-testid=pg-hide-pet]').count()) === 1)
      if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-${name}-1intro-${tag}.png`) })
      await page.waitForSelector('[data-testid=pg-hide-count]', { timeout: 6000 })
      await page.waitForTimeout(1800)
      if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-${name}-2count-${tag}.png`) })
    }
    await waitSeek(page)
    check(`hide ${name} ${age}：開始找時寵物不見了`, (await page.locator('[data-testid=pg-hide-pet]').count()) === 0)
    await checkHideLayout(page, `hide ${name} ${age}`, size, n)
    if (age === '6-7') {
      await page.waitForTimeout(300)
      if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-${name}-3seek-${tag}.png`) })
    }
    await close(app, `hide ${name} ${age}`)
  }
}

// 2) 未設定年齡當 4–5 歲
{
  const app = await enter('hide', {})
  await waitSeek(app.page)
  check('hide 未設定年齡：5 個物件', (await spotsOf(app.page).count()) === 5)
  await close(app, 'hide 未設定年齡')
}

// 3) 點空：驚喜、節流、台詞節奏；動畫中不連發
{
  const app = await enter('hide', { age: '6-7' })
  const { page } = app
  await waitSeek(page)
  const id = await emptySpot(page)
  await tapSpot(app, id)
  check('hide 點空：出現驚喜', (await page.locator(`[data-testid=pg-hide-spot-${id}] [data-testid=pg-hide-surprise]`).count()) === 1)
  check('hide 點空：算一次', (await attr(page, '[data-testid=pg-hide]', 'data-misses')) === '1')
  check('hide 點空：第一次有講話', (await attr(page, '[data-testid=pg-hide]', 'data-said-empty')) === '1')
  if (SHOT_DIR) {
    await page.waitForTimeout(350)
    await page.screenshot({ path: join(SHOT_DIR, `hide-surprise-${tag}.png`) })
  }
  // 驚喜演完前連點同一個：不連發
  for (let i = 0; i < 3; i++) await tapSpot(app, id)
  check('hide 連點同一個：驚喜演完前不再算', (await attr(page, '[data-testid=pg-hide]', 'data-misses')) === '1')
  // 演完會自己收掉
  await page.waitForFunction((id) => !document.querySelector(`[data-testid=pg-hide-spot-${id}] [data-testid=pg-hide-surprise]`), id, { timeout: 4000 })
  check('hide 驚喜：演完自己消失', true)
  // 每個物件一種驚喜（所有非答案物件各點一次）
  const ids = await spotsOf(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('pg-hide-spot-', '')))
  const here = await hidingSpot(page)
  const kinds = new Set()
  for (const s of ids.filter((x) => x !== here)) {
    await tapSpot(app, s)
    kinds.add(await attr(page, `[data-testid=pg-hide-spot-${s}] [data-testid=pg-hide-surprise]`, 'data-kind'))
  }
  check('hide 驚喜：一個物件一種', kinds.size === ids.length - 1 && !kinds.has(null), [...kinds].join(','))
  const said = Number(await attr(page, '[data-testid=pg-hide]', 'data-said-empty'))
  const misses = Number(await attr(page, '[data-testid=pg-hide]', 'data-misses'))
  check('hide 台詞：第二次起只是偶爾講', said < misses && said >= 1, `${said}/${misses}`)
  await close(app, 'hide 點空')
}

// 4) 提示隨年齡
{
  // 3 歲：點 2 次才晃，晃的是有寵物的那個
  const app = await enter('hide', { age: '3' })
  const { page } = app
  await waitSeek(page)
  await page.waitForSelector('[data-testid=tap-hint]', { timeout: 6500 })
  check('hide 3 歲：第一輪不點會出現手勢示範', true)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-hint-${tag}.png`) })
  check('hide 3 歲：一開始不晃也不露', (await page.locator('[data-wiggle="1"]').count()) === 0 && (await attr(page, '[data-testid=pg-hide]', 'data-peek')) === '0')
  const a = await emptySpot(page)
  await tapSpot(app, a)
  check('hide 3 歲：點了手勢示範就收', (await page.locator('[data-testid=tap-hint]').count()) === 0)
  check('hide 3 歲：點 1 次還不晃', (await page.locator('[data-wiggle="1"]').count()) === 0)
  const b = await emptySpot(page, [a])
  await tapSpot(app, b)
  await page.waitForSelector('[data-wiggle="1"]')
  check('hide 3 歲：點 2 次後有寵物的那個會晃', (await page.locator('[data-wiggle="1"]').getAttribute('data-hiding')) === '1')
  const anim = await page.locator('[data-wiggle="1"] .pg-hide-obj').evaluate((e) => getComputedStyle(e).animationName)
  check('hide 3 歲：有晃的動畫', anim !== 'none', anim)
  await close(app, 'hide 3 歲提示')
}
{
  // 4–5 歲：一開始完全躲好、久了才露，不晃
  const app = await enter('hide', { age: '4-5' })
  const { page } = app
  await waitSeek(page)
  check('hide 4–5 歲：一開始不露', (await attr(page, '[data-testid=pg-hide]', 'data-peek')) === '0')
  for (let i = 0; i < 3; i++) {
    await tapSpot(app, await emptySpot(page))
    await page.waitForTimeout(850)
  }
  check('hide 4–5 歲：點再多也不晃', (await page.locator('[data-wiggle="1"]').count()) === 0)
  await page.waitForSelector('[data-testid=pg-hide][data-peek="2"]', { timeout: 13000 })
  check('hide 4–5 歲：久了露出一點，就在有寵物的那個後面', (await page.locator('[data-hiding="1"] [data-testid=pg-hide-peek]').count()) === 1)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-peek2-${tag}.png`) })
  await close(app, 'hide 4–5 歲提示')
}
{
  // 6–7 歲：一開始就露很小一點，久了更多，不晃
  const app = await enter('hide', { age: '6-7' })
  const { page } = app
  await waitSeek(page)
  await page.waitForSelector('[data-testid=pg-hide][data-peek="1"]', { timeout: 1000 })
  check('hide 6–7 歲：一開始只露很小一點', (await page.locator('[data-hiding="1"] [data-testid=pg-hide-peek]').getAttribute('data-level')) === '1')
  for (let i = 0; i < 3; i++) {
    await tapSpot(app, await emptySpot(page))
    await page.waitForTimeout(850)
  }
  check('hide 6–7 歲：不晃', (await page.locator('[data-wiggle="1"]').count()) === 0)
  await page.waitForSelector('[data-testid=pg-hide][data-peek="2"]', { timeout: 18000 })
  check('hide 6–7 歲：久了露更多', true)
  await close(app, 'hide 6–7 歲提示')
}

// 5) 找到：寵物跳出來、禮物只送一次、再玩一次換地方；多指同時點不連發
{
  const app = await enter('hide', { age: '4-5' })
  const { page } = app
  await waitSeek(page)
  const before = await foodTotal(page)
  const here = await hidingSpot(page)
  const c = await centerOf(page, `[data-testid=pg-hide-spot-${here}]`)
  const other = await centerOf(page, `[data-testid=pg-hide-spot-${await emptySpot(page)}]`)
  await app.finger([c, other]) // 兩根手指同時點：答案 + 空的
  check('hide 找到：進入 found', (await phase(page)) === 'found')
  await page.waitForSelector('[data-testid=pg-hide-pet] [data-testid=companion]', { timeout: 1000 }) // 寵物資料是非同步讀的，要等一下
  check('hide 找到：寵物跳出來', (await page.locator('[data-testid=pg-hide-pet] [data-testid=companion]').getAttribute('data-pose')) === 'cheer')
  await page.waitForTimeout(400)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-found-${tag}.png`) })
  // 動畫中連點：不再觸發
  await app.finger([c])
  await app.finger([c])
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-gift-${tag}.png`) })
  const onTop = await page.evaluate(() => {
    const again = document.querySelector('[data-testid=pg-hide-again]')
    const gift = document.querySelector('[data-testid=play-gift]')
    const r = (again ?? document.querySelector('[data-testid=pg-hide-pet]')).getBoundingClientRect()
    return gift.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
  })
  check('hide 禮物：浮層蓋在玩法上面（寵物、再玩一次不會跑到上面）', onTop)
  const afterFirst = await foodTotal(page)
  const delta = (a, b) => Object.keys(a).filter((k) => k !== '__daily').reduce((n, k) => n + (a[k] - (b[k] ?? 0)), 0)
  check('hide 禮物：多了 1 份', delta(afterFirst, before) === 1, JSON.stringify(afterFirst))
  await page.waitForTimeout(550) // 禮物剛跳出來的 0.5 秒不接受點擊
  await page.locator('[data-testid=play-gift]').click()
  await page.waitForSelector('[data-testid=pg-hide-again]')
  const b = await page.locator('[data-testid=pg-hide-again]').boundingBox()
  check('hide 再玩一次：大按鈕', b.height >= 56 && b.width >= 120, `${Math.round(b.width)}x${Math.round(b.height)}`)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-again-${tag}.png`) })

  // 多玩幾輪：位置不連續、禮物不重複
  let prev = here
  let okMove = true
  for (let i = 0; i < 4; i++) {
    await page.locator('[data-testid=pg-hide-again]').click()
    check(`hide 第 ${i + 2} 輪：回到數數`, (await phase(page)) === 'count')
    await waitSeek(page)
    const cur = await hidingSpot(page)
    if (cur === prev) okMove = false
    prev = cur
    await tapSpot(app, cur)
    await page.waitForSelector('[data-testid=pg-hide-again]', { timeout: 4000 })
    if ((await page.locator('[data-testid=play-gift]').count()) !== 0) okMove = false
  }
  check('hide 多輪：不連續躲同一處、也不再送禮', okMove)
  const afterAll = await foodTotal(page)
  check('hide 禮物：一天只送一次', delta(afterAll, before) === 1, JSON.stringify(afterAll.__daily))
  await close(app, 'hide 找到')
}

// 6) 減少動態：3 歲不晃也找得到（改成露出來），可以玩完
{
  const app = await enter('hide', { age: '3', ctxOpts: { reducedMotion: 'reduce' } })
  const { page } = app
  await waitSeek(page)
  const a = await emptySpot(page)
  await tapSpot(app, a)
  await page.waitForTimeout(200)
  check('hide 減少動態：驚喜還是有（看得到，不是一閃即逝）', (await page.locator('[data-testid=pg-hide-surprise]').count()) === 1, await page.evaluate(() => document.querySelector('[data-testid=pg-hide-surprise]')?.getAttribute('data-kind') ?? '沒有'))
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-reduced-${tag}.png`) })
  await page.waitForFunction(() => !document.querySelector('[data-testid=pg-hide-surprise]'), null, { timeout: 4000 })
  check('hide 減少動態：驚喜會自己收掉', true)
  await tapSpot(app, await emptySpot(page, [a]))
  await page.waitForSelector('[data-testid=pg-hide][data-peek="3"]')
  check('hide 減少動態：3 歲的提示改成露出來', (await page.locator('[data-hiding="1"] [data-testid=pg-hide-peek]').count()) === 1)
  await tapSpot(app, await hidingSpot(page))
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  check('hide 減少動態：玩得完', true)
  await close(app, 'hide 減少動態')
}

// 7) 旋轉不壞：找到一半轉向，物件重排、答案不變、還能找到
{
  const app = await enter('hide', { age: '6-7', size: SIZES.land })
  const { page } = app
  await waitSeek(page)
  const here = await hidingSpot(page)
  await page.setViewportSize(SIZES.port)
  await page.waitForTimeout(250)
  await checkHideLayout(page, 'hide 轉成直向', SIZES.port, 6)
  check('hide 轉向：答案不變', (await hidingSpot(page)) === here)
  await page.setViewportSize(SIZES.phone)
  await page.waitForTimeout(250)
  await checkHideLayout(page, 'hide 轉成手機', SIZES.phone, 6)
  await tapSpot(app, here)
  check('hide 轉向後：點得到', (await phase(page)) === 'found')
  await close(app, 'hide 旋轉')
}

// 8) 離開：計時器清乾淨（開場中途、找到一半、找到後）
{
  const app = await enter('hide', { age: '6-7' })
  const { page } = app
  await toHub(page)
  await enterFromHub(page, 'hide')
  await page.waitForTimeout(800) // 開場中途
  check('hide 開場中有計時器在跑', (await timers(page)) > 0)
  await leaveToHub(page, 'hide')
  check('hide 開場中途離開：玩法的計時器全清掉', (await timers(page)) === 0, String(await timers(page)))
  await enterFromHub(page, 'hide')
  await waitSeek(page)
  check('hide 找的時候有提示的計時器', (await timers(page)) > 0)
  await leaveToHub(page, 'hide')
  check('hide 找到一半離開：玩法的計時器全清掉', (await timers(page)) === 0, String(await timers(page)))
  await enterFromHub(page, 'hide')
  await waitSeek(page)
  const before = await foodTotal(page)
  await tapSpot(app, await hidingSpot(page))
  check('hide 找到：送禮物的計時器在跑', (await timers(page)) > 0)
  await leaveToHub(page, 'hide')
  check('hide 找到後馬上離開：玩法的計時器全清掉', (await timers(page)) === 0, String(await timers(page)))
  const after = await foodTotal(page)
  check('hide 找到後馬上離開：禮物不會不見', after.__daily?.done?.includes('hide') && !before.__daily?.done?.includes('hide'), JSON.stringify(after.__daily))
  await close(app, 'hide 離開')
}

} // 捉迷藏結束

// ========== 音樂會 ==========

const MUS = '[data-testid=pg-mus]'
const NOTES = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6']
const key = (n) => `[data-testid=pg-mus-key-${n}]`
const audio = (page) => page.evaluate(() => ({ ...window.__audio }))
const keyCenter = (page, n) => centerOf(page, key(n))
const musAttr = (page, name) => attr(page, MUS, name)

if (ONLY !== 'hide') {
// 1) 三種尺寸
for (const [name, size] of Object.entries(SIZES)) {
  const app = await enter('music', { size, age: '4-5' })
  const { page } = app
  const boxes = []
  for (const n of NOTES) boxes.push(await page.locator(key(n)).boundingBox())
  check(`music ${name}：8 鍵都夠大（≥56px）`, boxes.every((b) => b.width >= 56 && b.height >= 56), boxes.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`).join(' '))
  check(`music ${name}：8 鍵都在畫面內`, boxes.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.width <= size.width + 0.5 && b.y + b.height <= size.height + 0.5))
  let ok = true
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) if (overlapping(boxes[i], boxes[j])) ok = false
  check(`music ${name}：鍵不重疊`, ok)
  const drums = [await page.locator('[data-testid=pg-mus-drum-low]').boundingBox(), await page.locator('[data-testid=pg-mus-drum-high]').boundingBox()]
  check(`music ${name}：2 個鼓夠大、在畫面內`, drums.every((b) => b.width >= 56 && b.height >= 56 && b.x >= 0 && b.x + b.width <= size.width + 0.5 && b.y + b.height <= size.height + 0.5), drums.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`).join(' '))
  check(`music ${name}：鼓不壓鍵`, drums.every((d) => boxes.every((b) => !overlapping(d, b))))
  for (const id of ['twinkle', 'tigers']) {
    const c = await page.locator(`[data-testid=pg-mus-song-${id}]`).boundingBox()
    check(`music ${name}：歌卡 ${id} 夠大、不壓回去鍵`, c.height >= 56 && c.width >= 56 && c.x >= 12 + 60 - 1, `${Math.round(c.x)},${Math.round(c.width)}x${Math.round(c.height)}`)
  }
  const pet = await page.locator('.pg-mus-pet').boundingBox()
  check(`music ${name}：寵物有站在旁邊`, pet.width >= 80 && pet.height >= 80, `${Math.round(pet.width)}x${Math.round(pet.height)}`)
  check(`music ${name}：無橫向捲動`, await noHScroll(page))
  await page.waitForTimeout(600)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `music-${name}-1free-${tag}.png`) })
  // 選歌後：版面不跳、亮鍵看得見
  const y0 = (await page.locator(key('C5')).boundingBox()).y
  await page.locator('[data-testid=pg-mus-song-twinkle]').click()
  await page.waitForSelector(`${key('C5')}[data-lit="1"]`)
  check(`music ${name}：選歌後版面不跳`, Math.abs((await page.locator(key('C5')).boundingBox()).y - y0) < 24)
  check(`music ${name}：選歌後無橫向捲動`, await noHScroll(page))
  await app.finger([await keyCenter(page, 'E5')])
  await page.waitForTimeout(200)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `music-${name}-2song-${tag}.png`) })
  await close(app, `music ${name}`)
}

// 2) 橫式手機與旋轉不壞
{
  const app = await enter('music', { size: { width: 844, height: 390 }, age: '4-5' })
  const { page } = app
  const boxes = []
  for (const n of NOTES) boxes.push(await page.locator(key(n)).boundingBox())
  check('music 手機橫向：鍵夠寬', boxes.every((b) => b.width >= 56 && b.height >= 56), boxes.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`).join(' '))
  check('music 手機橫向：無橫向捲動', await noHScroll(page))
  await page.waitForTimeout(400)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `music-phone-land-${tag}.png`) })
  for (const size of [SIZES.land, SIZES.port, SIZES.phone]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(150)
    const b = await page.locator(key('C6')).boundingBox()
    check(`music 旋轉到 ${size.width}x${size.height}：還在畫面內`, b.x + b.width <= size.width + 0.5 && b.y + b.height <= size.height + 0.5 && b.width >= 56)
  }
  await close(app, 'music 旋轉')
}

// 3) 自由彈：按下就發聲（手指還沒放開）、多指和音、鼓
{
  const app = await enter('music', { age: '4-5' })
  const { page, send } = app
  await page.waitForTimeout(300)
  const a0 = await audio(page)
  const c = await keyCenter(page, 'G5')
  await send('touchStart', [{ x: c.x, y: c.y, id: 0, radiusX: 25, radiusY: 25, force: 0.5 }])
  const a1 = await audio(page)
  const perNote = a1.osc - a0.osc
  check('music 自由彈：pointerdown 當下就發聲（手指還沒放開）', perNote >= 1, `+${perNote} osc`)
  check('music 自由彈：記下彈了 G5', (await musAttr(page, 'data-last')) === 'G5')
  await send('touchEnd', [])
  await page.waitForTimeout(50)
  const a2 = await audio(page)
  check('music 自由彈：放開不重複發聲', a2.osc === a1.osc, `${a1.osc} → ${a2.osc}`)
  check('music 自由彈：飄一個音符', (await page.locator('[data-testid=pg-mus-note]').count()) >= 1)
  check('music 自由彈：寵物跳舞', (await page.locator('[data-testid=companion]').getAttribute('data-pose')) === 'dance')

  // 三指同時：三個音
  const b0 = await audio(page)
  const pts = [await keyCenter(page, 'C5'), await keyCenter(page, 'E5'), await keyCenter(page, 'G5')]
  await app.finger(pts)
  const b1 = await audio(page)
  check('music 多指：三指和音發三個音', b1.osc - b0.osc === perNote * 3, `+${b1.osc - b0.osc}（單音 +${perNote}）`)
  check('music 多指：算三下', (await musAttr(page, 'data-free')) === '4', await musAttr(page, 'data-free'))

  // 兩指按住不放，第三指再按：後面按的也要響
  const d0 = await audio(page)
  const [p, q, r] = [await keyCenter(page, 'A5'), await keyCenter(page, 'B5'), await keyCenter(page, 'C6')]
  const P = { x: p.x, y: p.y, id: 0, radiusX: 25, radiusY: 25, force: 0.5 }
  const Q = { x: q.x, y: q.y, id: 1, radiusX: 25, radiusY: 25, force: 0.5 }
  const R = { x: r.x, y: r.y, id: 2, radiusX: 25, radiusY: 25, force: 0.5 }
  await send('touchStart', [P])
  await send('touchStart', [P, Q])
  await send('touchStart', [P, Q, R])
  const d1 = await audio(page)
  await send('touchEnd', [])
  check('music 多指：先後按下也都響', d1.osc - d0.osc === perNote * 3, `+${d1.osc - d0.osc}`)

  // 鼓
  const e0 = await audio(page)
  await app.finger([await centerOf(page, '[data-testid=pg-mus-drum-low]')])
  const e1 = await audio(page)
  check('music 大鼓：有低頻也有噪音', e1.osc > e0.osc && e1.noise > e0.noise, JSON.stringify([e0, e1]))
  await app.finger([await centerOf(page, '[data-testid=pg-mus-drum-high]')])
  const e2 = await audio(page)
  check('music 小鼓：有低頻也有噪音', e2.osc > e1.osc && e2.noise > e1.noise)
  check('music 鼓：一鍵多音同按', (await musAttr(page, 'data-last')) === 'drum-high')
  const ctxOn = await page.evaluate(() => window.__gqAudio().wantedScene)
  check('music 背景音樂：靜音（場景是 null）', ctxOn === null, String(ctxOn))
  await close(app, 'music 自由彈')
}

// 4) 音效開關：關著時不發聲，但一樣有反應
{
  const app = await enter('music', { age: '4-5', settings: { soundOn: false } })
  const { page } = app
  await page.waitForTimeout(400)
  const a0 = await audio(page)
  await app.finger([await keyCenter(page, 'C5')])
  await app.finger([await centerOf(page, '[data-testid=pg-mus-drum-low]')])
  const a1 = await audio(page)
  check('music 音效關：木琴和鼓都不發聲', a1.osc === a0.osc && a1.noise === a0.noise, JSON.stringify([a0, a1]))
  check('music 音效關：還是有反應', (await page.locator('[data-testid=pg-mus-note]').count()) >= 1 && (await musAttr(page, 'data-free')) === '2')
  await close(app, 'music 音效關')
}

// 5) 魔法演奏：3 歲與 4–5 歲按任何鍵都彈得完（亂按同一個鍵）
for (const age of ['3', '4-5']) {
  const app = await enter('music', { age })
  const { page } = app
  const before = await foodTotal(page)
  await page.locator('[data-testid=pg-mus-song-twinkle]').click()
  await page.waitForSelector(`${key('C5')}[data-lit="1"]`)
  const total = Number(await musAttr(page, 'data-total'))
  check(`music ${age} 歲：小星星 42 個音`, total === 42, String(total))
  const dots = await page.locator('[data-testid=pg-mus-progress] i').count()
  check(`music ${age} 歲：進度用一串小音符點顯示`, dots === total, String(dots))
  const c = await keyCenter(page, 'B5')
  const played = []
  let litOk = true
  let singleLit = true
  for (let i = 0; i < total; i++) {
    const next = await musAttr(page, 'data-next')
    if ((await page.locator('[data-lit="1"]').count()) !== 1) singleLit = false
    await app.finger([c])
    const last = await musAttr(page, 'data-last')
    played.push(last)
    if (last !== next) litOk = false
    await page.waitForTimeout(60)
  }
  check(`music ${age} 歲：一直按同一個鍵，彈出的是亮著的下一個音`, litOk)
  check(`music ${age} 歲：任何時候只亮一個鍵`, singleLit)
  check(`music ${age} 歲：旋律對（前 14 個音）`, played.slice(0, 14).join(' ') === SONG_TWINKLE.join(' '), played.slice(0, 14).join(' '))
  await page.waitForSelector(`${MUS}[data-big="1"]`)
  check(`music ${age} 歲：彈完寵物大跳舞`, (await page.locator('[data-testid=companion]').getAttribute('data-pose')) === 'dance')
  if (SHOT_DIR && age === '3') await page.screenshot({ path: join(SHOT_DIR, `music-bigdance-${tag}.png`) })
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  const afterSong = await foodTotal(page)
  check(`music ${age} 歲：彈完送禮物`, afterSong.__daily?.done?.includes('music') && !before.__daily?.done?.includes('music'))
  await page.waitForTimeout(550) // 禮物剛跳出來的 0.5 秒不接受點擊
  await page.locator('[data-testid=play-gift]').click()
  await page.waitForSelector(`${MUS}[data-mode=free]`, { timeout: 5000 })
  check(`music ${age} 歲：慶祝完回自由彈`, true)
  await close(app, `music ${age} 歲魔法演奏`)
}

// 6) 魔法演奏：多指一掌下去只前進一個音（旋律不會被跳過）
{
  const app = await enter('music', { age: '3' })
  const { page } = app
  await page.locator('[data-testid=pg-mus-song-tigers]').click()
  await page.waitForSelector(`${key('C5')}[data-lit="1"]`)
  const pts = [await keyCenter(page, 'C5'), await keyCenter(page, 'G5'), await keyCenter(page, 'C6')]
  await app.finger(pts)
  const idx = Number(await musAttr(page, 'data-index'))
  check('music 3 歲：一掌按三個鍵只前進一個音', idx === 1, String(idx))
  await close(app, 'music 手掌')
}

// 7) 魔法演奏：6–7 歲按亮的才前進；按別的會發聲、不前進、不算錯
{
  const app = await enter('music', { age: '6-7' })
  const { page } = app
  const before = await foodTotal(page)
  await page.locator('[data-testid=pg-mus-song-tigers]').click()
  await page.waitForSelector(`${key('C5')}[data-lit="1"]`)
  const total = Number(await musAttr(page, 'data-total'))
  check('music 6–7 歲：兩隻老虎 32 個音', total === 32, String(total))
  const a0 = await audio(page)
  await app.finger([await keyCenter(page, 'B5')])
  const a1 = await audio(page)
  check('music 6–7 歲：按別的鍵還是會發聲', a1.osc > a0.osc)
  check('music 6–7 歲：按別的鍵彈的是按的那個音', (await musAttr(page, 'data-last')) === 'B5')
  check('music 6–7 歲：按別的鍵不前進', (await musAttr(page, 'data-index')) === '0')
  check('music 6–7 歲：亮的還是同一個鍵', (await musAttr(page, 'data-next')) === 'C5')
  let okSeq = true
  for (let i = 0; i < total; i++) {
    const next = await musAttr(page, 'data-next')
    if (next !== SONG_TIGERS[i]) okSeq = false
    await app.finger([await keyCenter(page, next)])
    if ((await musAttr(page, 'data-last')) !== next) okSeq = false
    if (Number(await musAttr(page, 'data-index')) !== i + 1) okSeq = false
    await page.waitForTimeout(60)
  }
  check('music 6–7 歲：照亮的按，每次前進一格，譜完全正確', okSeq)
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  check('music 6–7 歲：彈完送禮物', !before.__daily?.done?.includes('music'))
  await close(app, 'music 6–7 歲')
}

// 8) 自由彈 30 下算玩完；再彈完一首也不會多送
{
  const app = await enter('music', { age: '3' })
  const { page } = app
  const before = await foodTotal(page)
  const delta = (a, b) => Object.keys(a).filter((k) => k !== '__daily').reduce((n, k) => n + (a[k] - (b[k] ?? 0)), 0)
  const c = await keyCenter(page, 'A5')
  for (let i = 0; i < 29; i++) await app.finger([c])
  await page.waitForTimeout(1200)
  check('music 自由彈 29 下：還沒送', (await page.locator('[data-testid=play-gift]').count()) === 0)
  // 禮物一出現就有手指按下去（孩子還在敲）：不能把它點掉
  await page.evaluate(() => {
    new MutationObserver((_, ob) => {
      const g = document.querySelector('[data-testid=play-gift]')
      if (!g) return
      ob.disconnect()
      g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      g.click()
    }).observe(document.body, { childList: true, subtree: true })
  })
  await app.finger([await centerOf(page, '[data-testid=pg-mus-drum-low]')])
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 3000 })
  await page.waitForTimeout(150)
  check('music 禮物剛跳出來就被按到：不會被點掉', (await page.locator('[data-testid=play-gift]').count()) === 1)
  check('music 自由彈第 30 下（含鼓）：停下來後送禮物', (await musAttr(page, 'data-free')) === '30')
  const a1 = await foodTotal(page)
  check('music 自由彈：多 1 份', delta(a1, before) === 1)
  await page.waitForTimeout(550) // 禮物剛跳出來的 0.5 秒不接受點擊
  await page.locator('[data-testid=play-gift]').click()
  check('music 禮物：收下後就不在了', (await page.locator('[data-testid=play-gift]').count()) === 0)
  for (let i = 0; i < 10; i++) await app.finger([c])
  await page.locator('[data-testid=pg-mus-song-twinkle]').click()
  await page.waitForSelector(`${key('C5')}[data-lit="1"]`)
  const total = Number(await musAttr(page, 'data-total'))
  for (let i = 0; i < total; i++) {
    await app.finger([c])
    await page.waitForTimeout(55)
  }
  await page.waitForSelector(`${MUS}[data-big="1"]`)
  await page.waitForTimeout(2200)
  check('music 同一天再彈完一首：不再跳禮物', (await page.locator('[data-testid=play-gift]').count()) === 0)
  check('music 同一天：總共只多 1 份', delta(await foodTotal(page), before) === 1)
  await close(app, 'music 禮物')
}

// 8-1) 敲到第 30 下還一直敲：不跳禮物打斷，停下來才跳；放開手指的那一下不會把禮物點掉
{
  const app = await enter('music', { age: '4-5' })
  const { page } = app
  const c = await keyCenter(page, 'C5')
  for (let i = 0; i < 30; i++) await app.finger([c])
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(250)
    await app.finger([c])
  }
  check('music 還在敲：不跳禮物', (await page.locator('[data-testid=play-gift]').count()) === 0)
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 3000 })
  await page.waitForTimeout(400)
  check('music 停下來：禮物出現而且留著', (await page.locator('[data-testid=play-gift]').count()) === 1)
  await close(app, 'music 還在敲')
}

// 9) 魔法演奏進行中自由彈的計數不動，不會彈到一半跳禮物；再點一次歌卡回自由彈
{
  const app = await enter('music', { age: '4-5' })
  const { page } = app
  await page.locator('[data-testid=pg-mus-song-tigers]').click()
  await page.waitForSelector(`${key('C5')}[data-lit="1"]`)
  await app.finger([await keyCenter(page, 'A5')])
  check('music 演奏中：不算自由彈的下數', (await musAttr(page, 'data-free')) === '0')
  await page.locator('[data-testid=pg-mus-song-tigers]').click()
  check('music 再點歌卡：回自由彈', (await musAttr(page, 'data-mode')) === 'free' && (await page.locator('[data-lit="1"]').count()) === 0)
  await page.locator('[data-testid=pg-mus-song-twinkle]').click()
  await app.finger([await keyCenter(page, 'A5')])
  await page.locator('[data-testid=pg-mus-song-tigers]').click()
  check('music 換歌：進度歸零', (await musAttr(page, 'data-index')) === '0' && (await musAttr(page, 'data-mode')) === 'tigers')
  await close(app, 'music 切換')
}

// 10) 手勢示範：沒敲就出現，敲了就收
{
  const app = await enter('music', { age: '3' })
  const { page } = app
  await page.waitForSelector('[data-testid=tap-hint]', { timeout: 6000 })
  check('music 手勢示範：不敲會出現', true)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `music-hint-${tag}.png`) })
  await app.finger([await keyCenter(page, 'D5')])
  check('music 手勢示範：敲了就收', (await page.locator('[data-testid=tap-hint]').count()) === 0)
  await close(app, 'music 手勢')
}

// 11) 減少動態：可以玩、音符會自己消失
{
  const app = await enter('music', { age: '3', ctxOpts: { reducedMotion: 'reduce' } })
  const { page } = app
  await page.locator('[data-testid=pg-mus-song-twinkle]').click()
  await app.finger([await keyCenter(page, 'D5')])
  check('music 減少動態：彈得出下一個音', (await musAttr(page, 'data-index')) === '1')
  await page.waitForTimeout(200)
  check('music 減少動態：音符看得到，不是一閃即逝', (await page.locator('[data-testid=pg-mus-note]').count()) === 1)
  await page.waitForFunction(() => !document.querySelector('[data-testid=pg-mus-note]'), null, { timeout: 3000 })
  check('music 減少動態：音符會收掉', true)
  await close(app, 'music 減少動態')
}

// 12) 離開：計時器清乾淨（跳舞中、慶祝中）
{
  const app = await enter('music', { age: '3' })
  const { page } = app
  await toHub(page)
  await enterFromHub(page, 'music')
  await page.waitForSelector(`${MUS}[data-age="3"]`)
  await app.finger([await keyCenter(page, 'C5')])
  check('music 跳舞中有計時器在跑', (await timers(page)) > 0)
  await leaveToHub(page, 'music')
  check('music 跳舞中離開：玩法的計時器全清掉', (await timers(page)) === 0, String(await timers(page)))

  await enterFromHub(page, 'music')
  await page.waitForSelector(`${MUS}[data-age="3"]`)
  await page.locator('[data-testid=pg-mus-song-tigers]').click()
  const c = await keyCenter(page, 'C5')
  for (let i = 0; i < 32; i++) {
    await app.finger([c])
    await page.waitForTimeout(55)
  }
  await page.waitForSelector(`${MUS}[data-big="1"]`)
  check('music 慶祝中有計時器在跑', (await timers(page)) > 0)
  await leaveToHub(page, 'music')
  check('music 慶祝中離開：玩法的計時器全清掉', (await timers(page)) === 0, String(await timers(page)))
  const f = await foodTotal(page)
  check('music 慶祝中離開：禮物不會不見', f.__daily?.done?.includes('music'))
  await close(app, 'music 離開')
}

} // 音樂會結束

closing = true
await browser.close()
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
