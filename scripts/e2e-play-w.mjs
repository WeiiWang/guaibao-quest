// v8.3 線 W E2E（Playwright）：捉迷藏與小小音樂會。
//   捉迷藏：三個年齡的物件數、三種尺寸不重疊不捲動、點空的驚喜與節流、三個年齡的提示、找到、禮物只送一次、換地方、減少動態、旋轉、計時器清乾淨
//   音樂會：三種尺寸的鍵夠大不捲動、按下當下就發聲、多指和音、鼓、音效開關、三個年齡的魔法演奏差異、自由彈 30 下、禮物只送一次、背景音樂靜音
// v8.5 越玩越多（新玩具，有、沒有兩種狀態都測；次數用 patchSettings({ playCount }) 設定）：
//   捉迷藏：換你藏（一定找得到、看錯 1 或 2 個、不算回合）、手電筒（變暗、光圈跟手指、眼睛、拖是照點才是找）
//   音樂會：兩首新歌（四張只有圖的歌卡）、換聲音（木琴、鈴鐺、喵喵）
// 手指一律用接近真機的 50px 寬（radiusX 25）。
// 用法：先啟動 dev server（pnpm dev --port 5212 --strictPort），再
//   BASE_URL=http://localhost:5212 node scripts/e2e-play-w.mjs      （或 pnpm e2e:play-w）
//   E2E_BROWSER=webkit BASE_URL=... node scripts/e2e-play-w.mjs
// 只跑一半：ONLY=hide 或 ONLY=music
// 想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-play-w.mjs
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
const SONG_MARY = 'E5 D5 C5 D5 E5 E5 E5 D5 D5 D5 E5 G5 G5 E5 D5 C5 D5 E5 E5 E5 E5 D5 D5 E5 D5 C5'.split(' ')
const SONG_BRIDGE = 'G5 A5 G5 F5 E5 F5 G5 D5 E5 F5 E5 F5 G5 G5 A5 G5 F5 E5 F5 G5 D5 G5 E5 C5'.split(' ')
const here = dirname(fileURLToPath(import.meta.url))
/** 捉迷藏與音樂會的台詞（含 v8.5 的新玩具）：語音還沒錄，測試時把 manifest 換成每句都有假檔，看 play() 播了哪一句 */
const LINES = Object.fromEntries(
  [...readFileSync(join(here, '../src/learning/lines.ts'), 'utf8').matchAll(/'(pet\.(?:play|toy)\.(?:hide|music)[\w.]*)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
)

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
async function enter(game, { size = SIZES.land, age, settings = {}, ctxOpts = {}, lines = false } = {}) {
  const app = await freshApp(browser, size, { ctxOpts })
  if (lines) {
    await app.ctx.route('**/voice/manifest.json', (r) => r.fulfill({ json: Object.fromEntries(Object.entries(LINES).map(([k, text]) => [k, { file: `__line__${k}.m4a`, text }])) }))
    await app.ctx.addInitScript(() => {
      localStorage.setItem('gq-place-test', '1')
      localStorage.setItem('gq-voice-pack-test', '1')
      window.__lines = []
      HTMLMediaElement.prototype.play = function () {
        const m = /__line__(.+)\.m4a/.exec(this.src)
        if (m) window.__lines.push(m[1])
        return Promise.resolve()
      }
    })
  }
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
  /** 手指按下、拖過一串點、放開（晚上版的手電筒用） */
  const drag = async (points) => {
    const P = (p) => [{ x: p.x, y: p.y, id: 0, radiusX: 25, radiusY: 25, force: 0.5 }]
    await send('touchStart', P(points[0]))
    for (const p of points.slice(1)) await send('touchMove', P(p))
    await send('touchEnd', [])
  }
  return { ...app, send, finger, drag }
}
/** 寵物說過哪些話（去掉 pet. 開頭）；要 enter(..., { lines: true }) */
const said = (page) => page.evaluate(() => window.__lines.map((x) => x.replace(/^pet\./, '')))
const clearSaid = (page) => page.evaluate(() => (window.__lines = []))
const settingsOf = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
/** 玩法叫過哪些音效名稱（新音效還沒有檔案，只驗有沒有叫到） */
const sfxCalls = (page) => page.evaluate(() => window.__pgSfx ?? [])
/** 等新玩具卡或禮物卡出現、過了不能點的 0.5 秒，再收掉 */
const takeGift = async (page) => {
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 5000 })
  await page.waitForTimeout(550)
  await page.locator('[data-testid=play-gift]').click()
  await page.waitForSelector('[data-testid=play-gift]', { state: 'detached' })
}
const boxOf = (page, sel) => page.locator(sel).first().boundingBox()
const insideViewport = (b, vp) => b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5

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

  // 多玩幾輪：位置不連續、食物不重複。v8.5：每輪玩完都算一次，第 3 次跳新玩具卡（不是食物），其他次只有小慶祝
  let prev = here
  let okMove = true
  const cards = []
  let cheers = 0
  for (let i = 0; i < 4; i++) {
    await page.locator('[data-testid=pg-hide-again]').click()
    check(`hide 第 ${i + 2} 輪：回到數數`, (await phase(page)) === 'count')
    await waitSeek(page)
    const cur = await hidingSpot(page)
    if (cur === prev) okMove = false
    prev = cur
    await tapSpot(app, cur)
    await page.waitForSelector('[data-testid=pg-hide-again]', { timeout: 4000 })
    await page.waitForTimeout(350)
    if ((await page.locator('[data-testid=play-cheer]').count()) === 1) cheers++
    if ((await page.locator('[data-testid=play-gift]').count()) !== 0) {
      cards.push(`${i + 2}:${await attr(page, '[data-testid=play-toy]', 'data-toy')}`)
      await takeGift(page)
    }
  }
  check('hide 多輪：不連續躲同一處', okMove)
  check('hide 多輪：只有玩完第 3 次跳卡，而且是新玩具「手電筒」', cards.join() === '3:night', cards.join())
  check('hide 多輪：沒有卡的那幾次有小慶祝（第 2、4、5 次）', cheers === 3, String(cheers))
  const afterAll = await foodTotal(page)
  check('hide 禮物：食物一天只送一次', delta(afterAll, before) === 1, JSON.stringify(afterAll.__daily))
  check('hide 多輪：玩完 5 次，一輪只算一次', (await settingsOf(page)).playCount?.hide === 5, JSON.stringify((await settingsOf(page)).playCount))
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

// ---------- v8.5 越玩越多：捉迷藏 ----------
const HIDE = '[data-testid=pg-hide]'
const hideAttr = (page, name) => attr(page, HIDE, name)
const toysOf = (page, game) => attr(page, `[data-testid=play-${game}]`, 'data-toys')
/** 找到寵物，等「再玩一次」出現（有卡就收掉） */
const findPet = async (app, { gift = false } = {}) => {
  await waitSeek(app.page)
  await tapSpot(app, await hidingSpot(app.page))
  if (gift) await takeGift(app.page)
  await app.page.waitForSelector('[data-testid=pg-hide-again]', { timeout: 5000 })
}

// 9) 沒有新玩具（舊存檔沒有 playCount）：沒有換你藏、沒有手電筒；玩完第 1 次得到「換你藏」，卡收掉之後按鈕才出現
{
  const app = await enter('hide', { age: '4-5' })
  const { page } = app
  await waitSeek(page)
  check('hide 沒有新玩具：殼給的是 toys=0', (await toysOf(page, 'hide')) === '0')
  check('hide 沒有新玩具：沒有手電筒按鈕、沒有夜色', (await page.locator('[data-testid=pg-hide-night]').count()) === 0 && (await page.locator('[data-testid=pg-hide-dark]').count()) === 0)
  await tapSpot(app, await hidingSpot(page))
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 5000 })
  check('hide 玩完第 1 次：卡上有新玩具「換你藏」', (await attr(page, '[data-testid=play-toy]', 'data-toy')) === 'swap')
  check('hide 卡還開著：還沒有換你藏的按鈕（收下才出現）', (await page.locator('[data-testid=pg-hide-again]').count()) === 1 && (await page.locator('[data-testid=pg-hide-swap]').count()) === 0)
  await takeGift(page)
  await page.waitForSelector('[data-testid=pg-hide-swap]', { timeout: 2000 })
  check('hide 收下卡：換你藏的按鈕出現', (await toysOf(page, 'hide')) === '1')
  check('hide 只有第一個新玩具：還沒有手電筒', (await page.locator('[data-testid=pg-hide-night]').count()) === 0)
  await close(app, 'hide 沒有新玩具')
}

// 10) 換你藏：三種尺寸的按鈕；孩子藏球 → 寵物數到三 → 先看錯再找到；不算回合；之後可以再玩一般的回合
for (const [name, size] of Object.entries(SIZES)) {
  const app = await enter('hide', { size, age: name === 'phone' ? '3' : '6-7', settings: { playCount: { hide: 1 } }, lines: name === 'land' })
  const { page } = app
  const tag2 = `hide 換你藏 ${name}`
  await findPet(app, { gift: true }) // 今天第一次玩完有食物卡（次數 1 → 2，沒有新玩具）
  await page.waitForSelector('[data-testid=pg-hide-swap]')
  await page.waitForTimeout(500)
  const again = await boxOf(page, '[data-testid=pg-hide-again]')
  const swap = await boxOf(page, '[data-testid=pg-hide-swap]')
  check(`${tag2}：兩顆按鈕都夠大（≥56）`, swap.width >= 56 && swap.height >= 56 && again.height >= 56, `${Math.round(swap.width)}x${Math.round(swap.height)}`)
  check(`${tag2}：兩顆按鈕不重疊、都在畫面內`, !overlapping(again, swap) && insideViewport(again, size) && insideViewport(swap, size))
  check(`${tag2}：無橫向捲動`, await noHScroll(page))
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-${name}-swap1-buttons-${tag}.png`) })
  if (name === 'land') await clearSaid(page)

  const before = await settingsOf(page)
  await page.locator('[data-testid=pg-hide-swap]').click()
  await page.waitForSelector(`${HIDE}[data-phase=swap-hide]`)
  check(`${tag2}：按了之後換孩子藏`, (await hideAttr(page, 'data-swap-turn')) === '1')
  await page.waitForSelector('[data-testid=pg-hide-pet] [data-testid=companion]')
  check(`${tag2}：寵物遮住眼睛`, (await attr(page, '[data-testid=pg-hide-pet] [data-testid=companion]', 'data-pose')) === 'shy')
  check(`${tag2}：孩子手上有一顆球`, (await page.locator('[data-testid=pg-hide-ball-wait]').count()) === 1)
  check(`${tag2}：按鈕收起來`, (await page.locator('[data-testid=pg-hide-swap]').count()) === 0 && (await page.locator('[data-testid=pg-hide-again]').count()) === 0)
  if (name === 'land') check(`${tag2}：寵物說把球藏起來`, (await said(page)).join() === 'play.hide.swap.ask', (await said(page)).join())
  await page.waitForTimeout(400)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-${name}-swap2-hide-${tag}.png`) })

  // 藏進箱子
  const sfx0 = (await sfxCalls(page)).length
  await tapSpot(app, 'box')
  check(`${tag2}：點哪個就藏進哪個，寵物開始數`, (await phase(page)) === 'swap-count' && (await hideAttr(page, 'data-swap-ball')) === 'box')
  check(`${tag2}：球掉進去`, (await page.locator('[data-testid=pg-hide-spot-box] [data-testid=pg-hide-ball]').count()) === 1)
  check(`${tag2}：藏球有彈跳的聲音`, (await sfxCalls(page)).slice(sfx0).includes('boing'), (await sfxCalls(page)).slice(sfx0).join())
  check(`${tag2}：有數到 3 的數字`, (await page.locator('[data-testid=pg-hide-count]').count()) === 1)
  await page.waitForTimeout(300)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-${name}-swap3-count-${tag}.png`) })
  // 數數的時候再點別的：球不會換地方
  await tapSpot(app, 'bush')
  check(`${tag2}：數數時再點別的：球不換地方`, (await hideAttr(page, 'data-swap-ball')) === 'box')

  await page.waitForSelector(`${HIDE}[data-phase=swap-seek]`, { timeout: 5000 })
  await page.waitForSelector(`${HIDE}[data-swap-looked="1"]`, { timeout: 3000 })
  const wrong = await page.locator('[data-testid=pg-hide-surprise]').first().evaluate((el) => el.closest('[data-testid^=pg-hide-spot-]').dataset.testid.replace('pg-hide-spot-', ''))
  check(`${tag2}：先看一個錯的（不是有球的那個），有驚喜跑出來`, wrong !== 'box', wrong)
  if (SHOT_DIR) {
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(SHOT_DIR, `hide-${name}-swap4-look-${tag}.png`) })
  }
  // 寵物在找的時候孩子亂點：不算、不打斷
  await tapSpot(app, 'box')
  await tapSpot(app, 'bush')
  check(`${tag2}：寵物在找的時候亂點不打斷`, (await phase(page)) === 'swap-seek' && (await hideAttr(page, 'data-misses')) === '0')
  await page.waitForSelector(`${HIDE}[data-phase=swap-found]`, { timeout: 8000 })
  check(`${tag2}：第 1 次只看錯 1 個就找到`, (await hideAttr(page, 'data-swap-looked')) === '1')
  check(`${tag2}：找到時寵物很開心`, (await attr(page, '[data-testid=pg-hide-pet] [data-testid=companion]', 'data-pose')) === 'cheer')
  check(`${tag2}：球從藏的地方跑出來`, (await page.locator('[data-testid=pg-hide-spot-box] [data-testid=pg-hide-ball]').count()) === 1)
  const petBox = await boxOf(page, '[data-testid=pg-hide-pet]')
  const spotBox = await boxOf(page, '[data-testid=pg-hide-spot-box]')
  check(`${tag2}：寵物走到藏球的地方旁邊，沒有跑出畫面`, overlapping(petBox, { x: spotBox.x - 40, y: spotBox.y - 40, width: spotBox.width + 80, height: spotBox.height + 80 }) && petBox.x >= -2 && petBox.x + petBox.width <= size.width + 2)
  await page.waitForTimeout(700)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-${name}-swap5-found-${tag}.png`) })
  if (name === 'land') check(`${tag2}：台詞依序是 藏起來 → 數到三 → 不在這裡 → 找到了`, (await said(page)).join() === 'play.hide.swap.ask,play.hide.swap.count,play.hide.swap.miss,play.hide.swap.found', (await said(page)).join())

  await page.waitForSelector('[data-testid=pg-hide-swap]', { timeout: 4000 })
  check(`${tag2}：結束後有再玩一次，也可以再藏一次`, (await page.locator('[data-testid=pg-hide-again]').count()) === 1)
  check(`${tag2}：這一段不算玩完一次、也沒有卡`, (await settingsOf(page)).playCount.hide === before.playCount.hide && (await page.locator('[data-testid=play-gift]').count()) === 0, JSON.stringify((await settingsOf(page)).playCount))

  if (name === 'land') {
    // 第 2 次：看錯 2 個再找到（用次數決定，不是亂數）
    await page.locator('[data-testid=pg-hide-swap]').click()
    await page.waitForSelector(`${HIDE}[data-phase=swap-hide]`)
    check(`${tag2}：第 2 次開始時上一顆球收掉了`, (await page.locator('[data-testid=pg-hide-ball]').count()) === 0 && (await hideAttr(page, 'data-swap-looked')) === '0')
    await tapSpot(app, 'tent')
    await page.waitForSelector(`${HIDE}[data-phase=swap-found]`, { timeout: 14000 })
    check(`${tag2}：第 2 次看錯 2 個才找到`, (await hideAttr(page, 'data-swap-looked')) === '2' && (await hideAttr(page, 'data-swap-ball')) === 'tent')
    check(`${tag2}：第 2 次球從帳篷跑出來`, (await page.locator('[data-testid=pg-hide-spot-tent] [data-testid=pg-hide-ball]').count()) === 1)
    await page.waitForSelector('[data-testid=pg-hide-again]', { timeout: 4000 })
  }

  // 再玩一般的回合：回到數數，寵物自己去躲，找到算一次
  await page.locator('[data-testid=pg-hide-again]').click()
  check(`${tag2}：再玩一次回到一般的回合`, (await phase(page)) === 'count' && (await page.locator('[data-testid=pg-hide-ball]').count()) === 0)
  await findPet(app)
  await page.waitForTimeout(400)
  const after = await settingsOf(page)
  check(`${tag2}：一般的回合照常算一次（2 → 3），得到第二個新玩具`, after.playCount.hide === before.playCount.hide + 1 && (await attr(page, '[data-testid=play-toy]', 'data-toy')) === 'night', JSON.stringify(after.playCount))
  await close(app, tag2)
}

// 10-1) 換你藏：減少動態也走得完；找到一半離開，計時器清乾淨、不會偷算次數
{
  const app = await enter('hide', { age: '3', settings: { playCount: { hide: 1 } }, ctxOpts: { reducedMotion: 'reduce' } })
  const { page } = app
  await findPet(app, { gift: true })
  await page.locator('[data-testid=pg-hide-swap]').click()
  await page.waitForSelector(`${HIDE}[data-phase=swap-hide]`)
  await page.waitForSelector('[data-testid=tap-hint]', { timeout: 7000 })
  check('hide 換你藏：第一次太久沒藏會出現手勢示範', true)
  await tapSpot(app, 'tree')
  check('hide 換你藏：藏了示範就收', (await page.locator('[data-testid=tap-hint]').count()) === 0)
  await page.waitForSelector(`${HIDE}[data-phase=swap-found]`, { timeout: 12000 })
  check('hide 換你藏（減少動態）：走得完，一定找得到', (await hideAttr(page, 'data-swap-ball')) === 'tree')
  check('hide 換你藏（減少動態）：球看得到', await page.locator('[data-testid=pg-hide-ball]').evaluate((el) => getComputedStyle(el).opacity === '1'))
  await close(app, 'hide 換你藏 減少動態')
}
{
  const app = await enter('hide', { age: '6-7', settings: { playCount: { hide: 1 } } })
  const { page } = app
  await toHub(page)
  await enterFromHub(page, 'hide')
  await findPet(app, { gift: true })
  await page.locator('[data-testid=pg-hide-swap]').click()
  await tapSpot(app, 'slide')
  await page.waitForSelector(`${HIDE}[data-phase=swap-seek]`, { timeout: 5000 })
  check('hide 換你藏：寵物在找的時候有計時器在跑', (await timers(page)) > 0)
  const n = (await settingsOf(page)).playCount.hide
  await leaveToHub(page, 'hide')
  check('hide 換你藏到一半離開：玩法的計時器全清掉', (await timers(page)) === 0, String(await timers(page)))
  await page.waitForTimeout(300)
  check('hide 換你藏到一半離開：不會偷算一次', (await settingsOf(page)).playCount.hide === n)
  await close(app, 'hide 換你藏 離開')
}

// 11) 手電筒（晚上版）：兩個新玩具都有才出現；變暗、光圈跟著手指、放開停在原地、3 歲光圈大、眼睛、拖是照、點才是找
for (const [name, size] of Object.entries(SIZES)) {
  for (const age of name === 'land' ? ['3', '6-7'] : ['4-5']) {
    const app = await enter('hide', { size, age, settings: { playCount: { hide: 3 } }, lines: name === 'land' && age === '3' })
    const { page } = app
    const tag2 = `hide 手電筒 ${name} ${age}`
    await waitSeek(page)
    check(`${tag2}：殼給的是 toys=2`, (await toysOf(page, 'hide')) === '2')
    const btn = await boxOf(page, '[data-testid=pg-hide-night]')
    const back = await boxOf(page, '[data-testid=game-back]')
    const spotBoxes = await spotsOf(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
    check(`${tag2}：按鈕夠大、在畫面內`, btn.width >= 56 && btn.height >= 56 && insideViewport(btn, size), `${Math.round(btn.width)}x${Math.round(btn.height)}`)
    check(`${tag2}：按鈕不壓回去鍵、不壓躲藏物`, !overlapping(btn, back) && spotBoxes.every((b) => !overlapping(btn, b)))
    check(`${tag2}：還沒按是白天`, (await hideAttr(page, 'data-night')) === null && (await page.locator('[data-testid=pg-hide-dark]').count()) === 0)
    if (name === 'land' && age === '3') await clearSaid(page)

    await page.locator('[data-testid=pg-hide-night]').click()
    await page.waitForSelector(`${HIDE}[data-night="1"]`)
    check(`${tag2}：按了變成晚上`, (await attr(page, '[data-testid=pg-hide-night]', 'aria-pressed')) === 'true')
    if (name === 'land' && age === '3') check(`${tag2}：進去時寵物說好暗`, (await said(page)).join() === 'play.hide.night', (await said(page)).join())
    await page.waitForTimeout(550)
    await page.screenshot() // 無頭 WebKit 要畫一格，transition 才會往前走
    const dark = await page.locator('[data-testid=pg-hide-dark]').evaluate((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return { bg: cs.backgroundImage, filter: cs.filter, backdrop: cs.backdropFilter ?? cs.webkitBackdropFilter ?? 'none', opacity: cs.opacity, pe: cs.pointerEvents, trans: cs.transitionProperty, anim: cs.animationName, w: r.width, h: r.height, lr: el.style.getPropertyValue('--lr') }
    })
    check(`${tag2}：整個畫面蓋一層半透明的夜色（radial-gradient 挖一圈光）`, /radial-gradient/.test(dark.bg) && dark.w >= size.width - 1 && dark.h >= size.height - 1, dark.bg.slice(0, 60))
    check(`${tag2}：變暗不用 filter（WebKit 動畫 filter 會閃退），只動 opacity`, dark.filter === 'none' && (dark.backdrop === 'none' || dark.backdrop === '') && dark.trans === 'opacity', JSON.stringify([dark.filter, dark.backdrop, dark.trans, dark.anim]))
    check(`${tag2}：找的時候全暗`, dark.opacity === '1', dark.opacity)
    check(`${tag2}：夜色不擋手指`, dark.pe === 'none')
    const want = { 3: '36vmin', '4-5': '28vmin', '6-7': '22vmin' }[age]
    check(`${tag2}：光圈大小跟年齡走（3 歲最大）`, dark.lr === want, dark.lr)
    check(`${tag2}：無橫向捲動`, await noHScroll(page))

    // 發亮的眼睛：在躲的那個東西上
    const here2 = await hidingSpot(page)
    const hb = await boxOf(page, `[data-testid=pg-hide-spot-${here2}]`)
    const eyes = await page.locator('[data-testid=pg-hide-eyes]').evaluate((el) => ({ r: el.getBoundingClientRect().toJSON(), lit: el.dataset.lit, z: Number(getComputedStyle(el).zIndex), pe: getComputedStyle(el).pointerEvents }))
    const darkZ = await page.locator('[data-testid=pg-hide-dark]').evaluate((el) => Number(getComputedStyle(el).zIndex))
    check(`${tag2}：躲的地方有一雙眼睛，在夜色上面`, eyes.r.x >= hb.x && eyes.r.right <= hb.x + hb.width && eyes.r.y >= hb.y && eyes.r.bottom <= hb.y + hb.height && eyes.z > darkZ && eyes.pe === 'none')
    const far = spotBoxes.map((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })).sort((p, q) => Math.hypot(q.x - hb.x - hb.width / 2, q.y - hb.y - hb.height / 2) - Math.hypot(p.x - hb.x - hb.width / 2, p.y - hb.y - hb.height / 2))[0]
    const near = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }

    // 光圈跟著手指走；放開之後停在最後的位置
    const lightAt = () => page.locator('[data-testid=pg-hide-dark]').evaluate((el) => [parseFloat(el.style.getPropertyValue('--lx')), parseFloat(el.style.getPropertyValue('--ly'))])
    const P = (p) => [{ x: p.x, y: p.y, id: 0, radiusX: 25, radiusY: 25, force: 0.5 }]
    const mid = { x: (far.x + near.x) / 2, y: (far.y + near.y) / 2 }
    await app.send('touchStart', P(far))
    const l0 = await lightAt()
    check(`${tag2}：手指按下去，光圈就在手指的位置`, Math.abs(l0[0] - far.x) < 2 && Math.abs(l0[1] - far.y) < 2, l0.join())
    await app.send('touchMove', P(mid))
    const l1 = await lightAt()
    check(`${tag2}：光圈跟著手指移動`, Math.abs(l1[0] - mid.x) < 2 && Math.abs(l1[1] - mid.y) < 2, l1.join())
    await app.send('touchEnd', [])
    await page.waitForTimeout(150)
    const l2 = await lightAt()
    check(`${tag2}：手指離開，光圈停在最後的位置`, l2[0] === l1[0] && l2[1] === l1[1], l2.join())
    check(`${tag2}：拖過去只是照，不算點（沒有驚喜、次數不變）`, (await phase(page)) === 'seek' && (await hideAttr(page, 'data-misses')) === '0' && (await page.locator('[data-testid=pg-hide-surprise]').count()) === 0)

    if (age === '6-7') {
      // 6–7 歲：照到才看得到眼睛
      await app.drag([far, { x: far.x + 30, y: far.y + 20 }])
      check(`${tag2}：光照在別的地方，看不到眼睛`, (await attr(page, '[data-testid=pg-hide-eyes]', 'data-lit')) === '0')
      await app.drag([mid, { x: near.x + 24, y: near.y + 24 }])
      await page.waitForTimeout(300)
      await page.screenshot()
      check(`${tag2}：光照到躲的地方，眼睛亮起來`, (await attr(page, '[data-testid=pg-hide-eyes]', 'data-lit')) === '1' && (await page.locator('[data-testid=pg-hide-eyes]').evaluate((el) => getComputedStyle(el).opacity)) === '1')
    } else {
      check(`${tag2}：小的孩子黑暗中一直看得到眼睛`, eyes.lit === '1' && (await page.locator('[data-testid=pg-hide-eyes]').evaluate((el) => getComputedStyle(el).opacity)) === '1')
    }
    // 從躲的地方開始拖（手指在上面滑過去）：還是只是照，不會被當成找到
    await app.drag([near, { x: near.x + 20, y: near.y + 30 }, { x: near.x + 40, y: near.y + 60 }])
    check(`${tag2}：在躲的地方上面滑過去不算找到`, (await phase(page)) === 'seek')
    await app.drag([{ x: near.x + 40, y: near.y + 60 }, near])
    await page.waitForTimeout(350)
    if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-${name}-night-${age}-${tag}.png`) })

    // 點（按下放開沒移動）才是找：點空的有驚喜、算一次
    const empty = await emptySpot(page)
    await tapSpot(app, empty)
    check(`${tag2}：點空的照常有驚喜`, (await hideAttr(page, 'data-misses')) === '1' && (await page.locator(`[data-testid=pg-hide-spot-${empty}] [data-testid=pg-hide-surprise]`).count()) === 1)
    // 手指稍微抖一下（8px）也算點
    const c = await centerOf(page, `[data-testid=pg-hide-spot-${here2}]`)
    await app.drag([c, { x: c.x + 6, y: c.y + 5 }])
    check(`${tag2}：手指抖一點點還是算點，找到了`, (await phase(page)) === 'found')
    await page.waitForTimeout(500)
    await page.screenshot()
    check(`${tag2}：找到之後眼睛收起來、夜色變淡（看得到寵物）`, (await page.locator('[data-testid=pg-hide-eyes]').count()) === 0 && (await page.locator('[data-testid=pg-hide-dark]').evaluate((el) => getComputedStyle(el).opacity)) === '0.5')
    if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `hide-${name}-night-${age}-found-${tag}.png`) })
    await takeGift(page)
    await page.waitForSelector('[data-testid=pg-hide-again]')

    if (name === 'land' && age === '3') {
      // 晚上版也可以換你藏；再按一次回到白天，跟原本一樣按下去就算
      await page.locator('[data-testid=pg-hide-swap]').click()
      await page.waitForSelector(`${HIDE}[data-phase=swap-hide]`)
      await tapSpot(app, 'bush')
      check(`${tag2}：晚上版也可以換你藏`, (await phase(page)) === 'swap-count')
      await page.waitForSelector(`${HIDE}[data-phase=swap-found]`, { timeout: 12000 })
      await page.waitForSelector('[data-testid=pg-hide-again]', { timeout: 4000 })
      await page.locator('[data-testid=pg-hide-night]').click()
      check(`${tag2}：再按一次回到白天`, (await hideAttr(page, 'data-night')) === null && (await page.locator('[data-testid=pg-hide-dark]').count()) === 0)
      check(`${tag2}：回到白天不再說一次好暗`, (await said(page)).filter((x) => x === 'play.hide.night').length === 1)
      await page.locator('[data-testid=pg-hide-again]').click()
      await waitSeek(page)
      const h = await centerOf(page, `[data-testid=pg-hide-spot-${await hidingSpot(page)}]`)
      await app.send('touchStart', [{ x: h.x, y: h.y, id: 0, radiusX: 25, radiusY: 25, force: 0.5 }])
      check(`${tag2}：白天跟原本一樣，手指按下去當下就算`, (await phase(page)) === 'found')
      await app.send('touchEnd', [])
    }
    await close(app, tag2)
  }
}

// 11-1) 手電筒：減少動態也能玩（不漸變，直接變暗）
{
  const app = await enter('hide', { age: '3', settings: { playCount: { hide: 3 } }, ctxOpts: { reducedMotion: 'reduce' } })
  const { page } = app
  await waitSeek(page)
  await page.locator('[data-testid=pg-hide-night]').click()
  await page.waitForTimeout(100)
  check('hide 手電筒（減少動態）：直接變暗', (await page.locator('[data-testid=pg-hide-dark]').evaluate((el) => getComputedStyle(el).opacity)) === '1')
  await tapSpot(app, await hidingSpot(page))
  check('hide 手電筒（減少動態）：找得到', (await phase(page)) === 'found')
  await close(app, 'hide 手電筒 減少動態')
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

// ---------- v8.5 越玩越多：音樂會 ----------
const songCard = (id) => `[data-testid=pg-mus-song-${id}]`
const voiceBtn = (v) => `[data-testid=pg-mus-voice-${v}]`
const ALL_SONGS = ['twinkle', 'tigers', 'mary', 'bridge']

// 13) 沒有新玩具：只有原本的兩首（歌卡有字）、沒有換聲音；玩完第 1 次得到「新歌」，卡收掉之後才多兩張
{
  const app = await enter('music', { age: '3' })
  const { page } = app
  check('music 沒有新玩具：殼給的是 toys=0', (await attr(page, '[data-testid=play-music]', 'data-toys')) === '0')
  check('music 沒有新玩具：只有兩張歌卡', (await page.locator('[data-testid^=pg-mus-song-]').count()) === 2 && (await page.locator(songCard('mary')).count()) === 0 && (await page.locator(songCard('bridge')).count()) === 0)
  check('music 沒有新玩具：歌卡跟原本一樣有歌名', await page.locator(`${songCard('twinkle')} .pg-mus-card-title`).evaluate((el) => getComputedStyle(el).display !== 'none' && el.textContent === '小星星'))
  check('music 沒有新玩具：沒有換聲音的按鈕，是木琴的聲音', (await page.locator('[data-testid=pg-mus-voices]').count()) === 0 && (await musAttr(page, 'data-voice')) === 'xylo')
  await page.locator(songCard('tigers')).click()
  const c = await keyCenter(page, 'C5')
  for (let i = 0; i < 32; i++) {
    await app.finger([c])
    await page.waitForTimeout(55)
  }
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 5000 })
  check('music 玩完第 1 次：卡上有新玩具「新歌」', (await attr(page, '[data-testid=play-toy]', 'data-toy')) === 'songs')
  check('music 卡還開著：歌卡還是兩張', (await page.locator('[data-testid^=pg-mus-song-]').count()) === 2)
  await takeGift(page)
  await page.waitForSelector(songCard('mary'), { timeout: 2000 })
  check('music 收下卡：多了兩張歌卡，還沒有換聲音', (await page.locator('[data-testid^=pg-mus-song-]').count()) === 4 && (await page.locator('[data-testid=pg-mus-voices]').count()) === 0)
  await close(app, 'music 沒有新玩具')
}

// 14) 新歌：四張只有圖的歌卡在四種尺寸都排得下；兩首新歌彈得完、譜正確
for (const [name, size] of Object.entries({ ...SIZES, phoneLand: { width: 844, height: 390 } })) {
  const app = await enter('music', { size, age: '4-5', settings: { playCount: { music: 1 } } })
  const { page } = app
  const tag2 = `music 新歌 ${name}`
  await page.waitForSelector(songCard('bridge'))
  await page.waitForTimeout(500) // 等進場的滑入動畫結束再量位置
  const cards = []
  for (const id of ALL_SONGS) cards.push(await boxOf(page, songCard(id)))
  const back = await boxOf(page, '[data-testid=game-back]')
  check(`${tag2}：四張歌卡都夠大（≥56）、在畫面內`, cards.every((b) => b.width >= 56 && b.height >= 56 && insideViewport(b, size)), cards.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`).join(' '))
  let ok = true
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (overlapping(cards[i], cards[j])) ok = false
  check(`${tag2}：歌卡不重疊、不壓回去鍵`, ok && cards.every((b) => !overlapping(b, back)))
  const noText = await page.locator('[data-testid^=pg-mus-song-]').evaluateAll((els) => els.every((el) => getComputedStyle(el.querySelector('.pg-mus-card-title')).display === 'none' && !!el.querySelector('svg') && !!el.getAttribute('aria-label')))
  check(`${tag2}：歌卡用圖示不靠字（歌名留在 aria-label）`, noText)
  const keys = []
  for (const n of NOTES) keys.push(await boxOf(page, key(n)))
  check(`${tag2}：8 鍵還是夠大、沒被擠到`, keys.every((b) => b.width >= 56 && b.height >= 56 && insideViewport(b, size)))
  check(`${tag2}：沒有換聲音的按鈕（只有第一個新玩具）`, (await page.locator('[data-testid=pg-mus-voices]').count()) === 0)
  check(`${tag2}：無橫向捲動`, await noHScroll(page))
  await page.locator(songCard('mary')).click()
  await page.waitForSelector(`${key('E5')}[data-lit="1"]`)
  await page.waitForTimeout(300)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `music-${name}-songs4-${tag}.png`) })
  await close(app, tag2)
}
{
  // 3 歲：瑪莉有隻小綿羊，一直按同一個鍵也彈得完；玩完算一次
  const app = await enter('music', { age: '3', settings: { playCount: { music: 1 } }, lines: true })
  const { page } = app
  await page.locator(songCard('mary')).click()
  await page.waitForSelector(`${key('E5')}[data-lit="1"]`)
  const total = Number(await musAttr(page, 'data-total'))
  check('music 瑪莉有隻小綿羊：26 個音', total === 26, String(total))
  const c = await keyCenter(page, 'C6')
  const played = []
  for (let i = 0; i < total; i++) {
    await app.finger([c])
    played.push(await musAttr(page, 'data-last'))
    await page.waitForTimeout(60)
  }
  check('music 瑪莉有隻小綿羊：亂按同一個鍵，彈出來的譜完全正確', played.join(' ') === SONG_MARY.join(' '), played.join(' '))
  await page.waitForSelector(`${MUS}[data-big="1"]`)
  check('music 瑪莉有隻小綿羊：彈完寵物大跳舞', true)
  await takeGift(page) // 今天第一次玩完有食物
  check('music 新歌彈完算玩完一次（1 → 2）', (await settingsOf(page)).playCount.music === 2)
  check('music 新歌彈完：寵物說這首歌好好聽', (await said(page)).includes('play.music.song'), (await said(page)).join())
  await close(app, 'music 瑪莉有隻小綿羊')
}
{
  // 6–7 歲：倫敦鐵橋，照亮的鍵按
  const app = await enter('music', { age: '6-7', settings: { playCount: { music: 1 } } })
  const { page } = app
  await page.locator(songCard('bridge')).click()
  await page.waitForSelector(`${key('G5')}[data-lit="1"]`)
  const total = Number(await musAttr(page, 'data-total'))
  check('music 倫敦鐵橋：24 個音', total === 24, String(total))
  let okSeq = true
  for (let i = 0; i < total; i++) {
    const next = await musAttr(page, 'data-next')
    if (next !== SONG_BRIDGE[i]) okSeq = false
    await app.finger([await keyCenter(page, next)])
    if (Number(await musAttr(page, 'data-index')) !== i + 1) okSeq = false
    await page.waitForTimeout(60)
  }
  check('music 倫敦鐵橋：6–7 歲照亮的按，譜完全正確', okSeq)
  await page.waitForSelector(`${MUS}[data-big="1"]`)
  // 原本的兩首還在、還能彈
  await page.waitForSelector(`${MUS}[data-mode=free]`, { timeout: 6000 })
  if ((await page.locator('[data-testid=play-gift]').count()) > 0) await takeGift(page) // 今天第一次玩完的食物卡
  await page.locator(songCard('twinkle')).click()
  check('music 有新歌之後原本的歌還在', (await musAttr(page, 'data-mode')) === 'twinkle' && (await musAttr(page, 'data-total')) === '42')
  await close(app, 'music 倫敦鐵橋')
}

// 15) 換聲音：兩個新玩具都有才出現；三顆按鈕在四種尺寸都排得下；木琴、鈴鐺、喵喵的聲音不一樣
for (const [name, size] of Object.entries({ ...SIZES, phoneLand: { width: 844, height: 390 } })) {
  const app = await enter('music', { size, age: '4-5', settings: { playCount: { music: 3 } } })
  const { page } = app
  const tag2 = `music 換聲音 ${name}`
  await page.waitForSelector(voiceBtn('cat'))
  await page.waitForTimeout(500) // 等進場的滑入動畫結束再量位置
  check(`${tag2}：殼給的是 toys=2`, (await attr(page, '[data-testid=play-music]', 'data-toys')) === '2')
  const voices = []
  for (const v of ['xylo', 'bell', 'cat']) voices.push(await boxOf(page, voiceBtn(v)))
  check(`${tag2}：三顆按鈕都夠大（≥56）、在畫面內`, voices.every((b) => b.width >= 56 && b.height >= 56 && insideViewport(b, size)), voices.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`).join(' '))
  const others = [await boxOf(page, '[data-testid=game-back]'), await boxOf(page, '[data-testid=pg-mus-drum-low]'), await boxOf(page, '[data-testid=pg-mus-drum-high]')]
  for (const id of ALL_SONGS) others.push(await boxOf(page, songCard(id)))
  for (const n of NOTES) others.push(await boxOf(page, key(n)))
  let ok = true
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) if (overlapping(voices[i], voices[j])) ok = false
    for (const o of others) if (overlapping(voices[i], o)) ok = false
  }
  check(`${tag2}：按鈕彼此不重疊，也不壓歌卡、鼓、琴鍵、回去鍵`, ok)
  const keys = []
  for (const n of NOTES) keys.push(await boxOf(page, key(n)))
  check(`${tag2}：8 鍵還是夠大`, keys.every((b) => b.width >= 56 && b.height >= 56 && insideViewport(b, size)))
  check(`${tag2}：無橫向捲動`, await noHScroll(page))
  check(`${tag2}：一開始是木琴`, (await musAttr(page, 'data-voice')) === 'xylo' && (await attr(page, voiceBtn('xylo'), 'aria-pressed')) === 'true')
  await app.finger([{ x: voices[2].x + voices[2].width / 2, y: voices[2].y + voices[2].height / 2 }])
  check(`${tag2}：手指按喵喵就換成喵喵`, (await musAttr(page, 'data-voice')) === 'cat' && (await attr(page, voiceBtn('cat'), 'aria-pressed')) === 'true' && (await attr(page, voiceBtn('xylo'), 'aria-pressed')) === 'false')
  await page.waitForTimeout(400)
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `music-${name}-voices-${tag}.png`) })
  await close(app, tag2)
}
{
  const app = await enter('music', { age: '3', settings: { playCount: { music: 3 } }, lines: true })
  const { page } = app
  await page.waitForSelector(voiceBtn('cat'))
  await page.waitForTimeout(700)
  await clearSaid(page)
  const g5 = await keyCenter(page, 'G5')
  const oscOf = async (fn) => {
    const a = await audio(page)
    await fn()
    return (await audio(page)).osc - a.osc
  }
  const xylo = await oscOf(() => app.finger([g5]))
  check('music 木琴：一個音 3 個分音（原本的聲音）', xylo === 3, String(xylo))

  // 鈴鐺：按下去馬上試聽一個音，之後琴鍵都是鈴鐺
  const bellPreview = await oscOf(async () => app.finger([await centerOf(page, voiceBtn('bell'))]))
  check('music 換成鈴鐺：馬上試聽一個音', bellPreview === 4 && (await musAttr(page, 'data-voice')) === 'bell', String(bellPreview))
  const free0 = await musAttr(page, 'data-free')
  const bell = await oscOf(() => app.finger([g5]))
  check('music 鈴鐺：聲音跟木琴不一樣（4 個分音、沒有噪音）', bell === 4, String(bell))
  check('music 換聲音不算自由彈的下數', Number(await musAttr(page, 'data-free')) === Number(free0) + 1, `${free0} → ${await musAttr(page, 'data-free')}`)
  check('music 換鈴鐺不說喵喵那句', (await said(page)).length === 0, (await said(page)).join())

  // 喵喵：一個振盪器的滑音；第一次切過來寵物說喵喵喵
  const catPreview = await oscOf(async () => app.finger([await centerOf(page, voiceBtn('cat'))]))
  check('music 換成喵喵：馬上試聽一聲喵', catPreview === 1 && (await musAttr(page, 'data-voice')) === 'cat', String(catPreview))
  check('music 第一次換成喵喵：寵物說喵喵喵', (await said(page)).join() === 'play.music.meow', (await said(page)).join())
  const cat = await oscOf(() => app.finger([g5]))
  check('music 喵喵：一個音是一聲滑音（1 個振盪器）', cat === 1, String(cat))
  const chord = await oscOf(async () => app.finger([await keyCenter(page, 'C5'), await keyCenter(page, 'E5'), await keyCenter(page, 'G5')]))
  check('music 喵喵：三指一起按是三聲', chord === 3, String(chord))
  // 鼓不變
  const d0 = await audio(page)
  await app.finger([await centerOf(page, '[data-testid=pg-mus-drum-low]')])
  const d1 = await audio(page)
  check('music 換聲音不影響鼓', d1.osc - d0.osc === 1 && d1.noise - d0.noise === 1, JSON.stringify([d0, d1]))

  // 用喵喵彈歌：進度照走；彈到一半換聲音不會動到進度
  await page.locator(songCard('mary')).click()
  await page.waitForSelector(`${key('E5')}[data-lit="1"]`)
  await app.finger([g5])
  await page.waitForTimeout(60)
  await app.finger([g5])
  check('music 用喵喵彈歌：進度照走', (await musAttr(page, 'data-index')) === '2')
  await app.finger([await centerOf(page, voiceBtn('xylo'))])
  check('music 彈到一半換聲音：進度不動、歌不變', (await musAttr(page, 'data-index')) === '2' && (await musAttr(page, 'data-mode')) === 'mary' && (await musAttr(page, 'data-voice')) === 'xylo')
  await page.waitForTimeout(60)
  const back = await oscOf(() => app.finger([g5]))
  check('music 換回木琴：又是原本的聲音', back === 3 && (await musAttr(page, 'data-index')) === '3', String(back))
  await app.finger([await centerOf(page, voiceBtn('cat'))])
  check('music 第二次換成喵喵：不再說一次', (await said(page)).filter((x) => x === 'play.music.meow').length === 1, (await said(page)).join())
  check('music 換聲音：背景音樂還是靜音', (await page.evaluate(() => window.__gqAudio().wantedScene)) === null)
  await close(app, 'music 換聲音 發聲')
}
{
  // 音效關：換聲音也不出聲，但按鈕照常切換
  const app = await enter('music', { age: '4-5', settings: { soundOn: false, playCount: { music: 3 } } })
  const { page } = app
  await page.waitForSelector(voiceBtn('cat'))
  await page.waitForTimeout(400)
  const a0 = await audio(page)
  await app.finger([await centerOf(page, voiceBtn('cat'))])
  await app.finger([await keyCenter(page, 'C5')])
  await app.finger([await centerOf(page, voiceBtn('bell'))])
  await app.finger([await keyCenter(page, 'C5')])
  const a1 = await audio(page)
  check('music 音效關：喵喵和鈴鐺都不發聲', a1.osc === a0.osc && a1.noise === a0.noise, JSON.stringify([a0, a1]))
  check('music 音效關：按鈕照常切換', (await musAttr(page, 'data-voice')) === 'bell')
  await close(app, 'music 換聲音 音效關')
}

} // 音樂會結束

closing = true
await browser.close()
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
