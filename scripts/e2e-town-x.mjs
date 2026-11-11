// v8.4 線 X E2E：寵物醫院（doctor）與晚安小屋（bedtime）。
// 寵物醫院：三種尺寸看完一次（拖一次、點一次）、禮物、再看一次換下一個毛病、四種毛病輪一圈、
//   3 歲馬上發亮 / 4–5 歲 4 秒後發亮 / 6–7 歲不亮且選錯只說「不是這裡」、聽診器的心跳聲與音效開關、三種寵物、離開後計時器清乾淨。
// 晚安小屋：三種尺寸走完刷牙 → 睡衣 → 故事 → 關燈 → 睡著 → 點牠翻身說夢話、搖籃曲與音效開關、手勢提示、
//   不改寵物資料、再玩一次、離開後計時器清乾淨。
// 毛病依日期輪替：測試讀畫面上的 data-ailment 決定要用哪些工具，不寫死某一天的結果。
// v8.5 新玩具（用 playCount 設定玩完幾次；每個都測「沒有」和「有」）：
//   寵物醫院：玩完 1 次多發燒、打嗝與冰枕、喝水（收下新玩具卡的下一回就是發燒）；玩完 3 次多照骨頭的板子（不算步驟、看完了也能玩）。
//   晚安小屋：玩完 1 次多「抱抱玩偶」（可以跳過）；玩完 3 次關燈後點夜燈換天花板（星星 → 海底 → 彩虹）。寵物睡前坐在被窩裡。
// 用法：先啟動 dev server（pnpm exec vite --port 5201 --strictPort），再
//   BASE_URL=http://localhost:5201 node scripts/e2e-town-x.mjs       （E2E_BROWSER=webkit 改用 WebKit）
//   想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-town-x.mjs（不要放 repo 裡）
//   只跑一個：ONLY=doctor 或 ONLY=bedtime；只跑新玩具：ONLY=doctor-toys 或 ONLY=bedtime-toys（原本的是 -base）
import { mkdirSync } from 'node:fs'
import { freshApp, getPet, idb, IS_WEBKIT, launch, makeChecker, patchPet, touchSender } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const SHOT_DIR = process.env.SHOT_DIR
const ONLY = process.env.ONLY
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
const shot = async (page, name) => {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${IS_WEBKIT ? 'wk-' : ''}${name}.png` })
}

// 跟 src/domain/doctor.ts 一致（測試自己也寫一份：規則改了這裡要跟著改，才知道是故意的）
const AILMENTS = ['sneeze', 'tummy', 'knee', 'throat']
const STEPS = { sneeze: ['thermo', 'spoon'], tummy: ['stetho', 'spoon'], knee: ['thermo', 'bandage'], throat: ['light', 'spoon'], fever: ['thermo', 'icepack'], hiccup: ['stetho', 'water'] }
const TOOLS = ['thermo', 'stetho', 'light', 'bandage', 'spoon']
// v8.5：玩完 1 次之後多出來的毛病與工具
const NEW_AILMENTS = ['fever', 'hiccup']
const NEW_TOOLS = ['icepack', 'water']

const touchOpts = (vp) => (vp.width < 500 ? { hasTouch: true, isMobile: true } : { hasTouch: true })
const finger = (x, y, id = 1) => ({ x, y, id, radiusX: 25, radiusY: 25, force: 0.5 })
const noOverflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const boxOf = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }
}
const overlap = (a, c) => a.x < c.x + c.width - 0.5 && c.x < a.x + a.width - 0.5 && a.y < c.y + c.height - 0.5 && c.y < a.y + a.height - 0.5
const inView = (b, vp) => b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1
const settings = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
const invTotal = (page) => idb(page, (db) => new Promise((r) => (db.transaction('inventory').objectStore('inventory').getAll().onsuccess = (e) => r(e.target.result.reduce((n, x) => n + x.qty, 0)))))
const patchSettings = (page, patch) =>
  idb(
    page,
    (db, patch) =>
      new Promise((r) => {
        const st = db.transaction('settings', 'readwrite').objectStore('settings')
        st.get('main').onsuccess = (e) => (st.put({ ...e.target.result, ...patch }).onsuccess = () => r(1))
      }),
    patch,
  )
const timers = (page) => page.evaluate(() => window.__timers.size)
const osc = (page) => page.evaluate(() => window.__audio.osc)
const waitFor = (page, fn, arg, timeout = 5000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false)
const attr = (page, sel, name) => page.locator(sel).first().getAttribute(name)
const said = async (page, sel) => ((await attr(page, sel, 'data-said')) ?? '').split(' ').filter(Boolean)

const browser = await launch()
const allErrors = []

/** 全新的 App，直接進某個地方 */
async function enter(game, { size = SIZES.land, age, species, plays = 0, settings: extra = {}, ctxOpts = {} } = {}) {
  const app = await freshApp(browser, size, { ctxOpts: { ...touchOpts(size), ...ctxOpts }, noFavorite: true })
  const patch = { ...extra }
  if (age) patch.ageBand = age
  // v8.5：這個地方玩完幾次（決定有幾個新玩具）
  if (plays) patch.playCount = { [game]: plays }
  if (Object.keys(patch).length) await patchSettings(app.page, patch)
  if (species) await patchPet(app.page, { species })
  // 先到小街再進去（回去鍵回小街）；只改網址再重新整理，WebKit 不會被中途打斷的 lazy 載入弄壞
  await app.page.evaluate(() => history.replaceState(null, '', '#town'))
  await app.page.reload()
  await app.page.waitForSelector('[data-testid=town-grid]')
  await app.page.waitForTimeout(300)
  app.t0 = await timers(app.page)
  await app.page.locator(`[data-testid=game-${game}]`).click()
  const root = game === 'doctor' ? '[data-testid=doc]' : '[data-testid=bed]'
  await app.page.waitForSelector(root)
  if (age) await app.page.waitForSelector(`${root}[data-age="${age}"]`)
  // 等寵物載入（useLiveQuery 非同步）
  await app.page.waitForSelector(`${root} [data-testid=companion]`)
  app.send = await touchSender(app.ctx, app.page)
  app.tap = async (x, y) => {
    await app.send('touchStart', [finger(x, y)])
    await app.send('touchEnd', [])
  }
  app.dragTo = async (from, to, steps = 8) => {
    await app.send('touchStart', [finger(from.cx, from.cy)])
    for (let i = 1; i <= steps; i++) await app.send('touchMove', [finger(from.cx + ((to.x - from.cx) * i) / steps, from.cy + ((to.y - from.cy) * i) / steps)])
    await app.send('touchEnd', [])
  }
  return app
}

async function leave(app, label) {
  await app.page.getByTestId('game-back').click()
  await app.page.waitForSelector('[data-testid=town-grid]')
  await app.page.waitForTimeout(600)
  const t1 = await timers(app.page)
  check(`${label}：回小街、計時器清乾淨`, t1 <= app.t0, `${app.t0} → ${t1}`)
}

/**
 * 玩完一回之後：等殼的結尾出來。有卡（食物、新玩具、皇冠）就收下，回傳卡上的新玩具 id（沒有新玩具是 ''）；
 * 沒有卡的那幾次只有星星和歡呼，回傳 null。
 */
async function settle(page) {
  const got = await waitFor(page, () => !!document.querySelector('[data-testid=play-gift], [data-testid=play-cheer]'), null, 4000)
  if (!got || !(await page.locator('[data-testid=play-gift]').count())) return null
  const toy = (await page.locator('[data-testid=play-toy]').count()) ? await attr(page, '[data-testid=play-toy]', 'data-toy') : ''
  await page.waitForTimeout(600) // 卡剛跳出來的 0.5 秒點不掉
  await page.getByTestId('play-gift').click()
  await page.waitForSelector('[data-testid=play-gift]', { state: 'detached' })
  return toy
}

async function close(app, label) {
  check(`${label}：沒有頁面錯誤`, app.errors.length === 0, app.errors.join(' | '))
  allErrors.push(...app.errors)
  await app.send?.detach()
  await app.ctx.close()
}

// ========== 寵物醫院 ==========

const DOC = '[data-testid=doc]'
const docAttr = (page, name) => attr(page, DOC, name)
const toolSel = (t) => `[data-testid=ui-doc-${t}]`

/** 用一個工具：drag = 拖到寵物身上放開；否則點一下讓它自己飛過去。等工具演完回托盤 */
async function useTool(app, tool, { drag = false } = {}) {
  const { page } = app
  await waitFor(page, () => document.querySelector('[data-testid=doc]')?.dataset.busy === '')
  const t = await boxOf(page, toolSel(tool))
  if (drag) {
    const pet = await boxOf(page, '[data-testid=doc-pet]')
    await app.dragTo(t, { x: pet.cx, y: pet.cy + 26 })
  } else await app.tap(t.cx, t.cy)
  const started = await waitFor(page, (tl) => document.querySelector('[data-testid=doc]')?.dataset.busy === tl, tool, 1500)
  await waitFor(page, () => document.querySelector('[data-testid=doc]')?.dataset.busy === '', null, 4000)
  return started
}

/** 照順序看完現在這個毛病 */
async function treat(app, { dragFirst = false } = {}) {
  const ailment = await docAttr(app.page, 'data-ailment')
  for (const [i, tool] of STEPS[ailment].entries()) await useTool(app, tool, { drag: dragFirst && i === 0 })
  return ailment
}

async function doctorSize(tag, vp) {
  const app = await enter('doctor', { size: vp })
  const { page } = app
  const before = await invTotal(page)
  check(`[${tag}] 醫院：寵物是孩子自己的`, (await page.locator('[data-testid=doc-pet] [data-testid=companion]').count()) === 1)
  check(`[${tag}] 醫院：沒有橫向捲動`, await noOverflowX(page))
  const ailment = await docAttr(page, 'data-ailment')
  check(`[${tag}] 醫院：今天的毛病是四種之一`, AILMENTS.includes(ailment), ailment)
  check(`[${tag}] 醫院：看得到生病的樣子`, (await page.locator('[data-testid=doc-symptom]').count()) === 1)
  check(`[${tag}] 醫院（沒有新玩具）：只有原本 5 個工具，沒有冰枕、喝水、板子`, (await page.locator('[data-testid=doc-tray] .doc-tool').count()) === 5 && (await page.locator('[data-testid=ui-doc-icepack], [data-testid=ui-doc-water], [data-testid=ui-doc-xray]').count()) === 0)
  for (const id of [...TOOLS.map((t) => `ui-doc-${t}`), 'game-back']) {
    const b = await boxOf(page, `[data-testid=${id}]`)
    check(`[${tag}] ${id} 夠大（≥56）且在畫面內`, b.width >= 56 && b.height >= 56 && inView(b, vp), `${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)}`)
  }
  const pet = await boxOf(page, '[data-testid=doc-pet]')
  const tray = await boxOf(page, '[data-testid=doc-tray]')
  check(`[${tag}] 醫院：工具盤不蓋寵物`, !overlap(pet, tray))
  check(`[${tag}] 醫院：寵物在畫面內`, inView(pet, vp), `${Math.round(pet.x)},${Math.round(pet.y)} ${Math.round(pet.width)}`)
  const back = await boxOf(page, '[data-testid=game-back]')
  check(`[${tag}] 醫院：回去鍵不壓寵物`, !overlap(back, pet))
  await page.waitForTimeout(2600)
  check(`[${tag}] 醫院：寵物說哪裡不舒服`, (await said(page, DOC)).includes(`pet.play.doctor.${ailment}`))
  await shot(page, `doc-${tag}-1-start`)

  // 第一步用拖的
  const [first, second] = STEPS[ailment]
  const t = await boxOf(page, toolSel(first))
  await app.send('touchStart', [finger(t.cx, t.cy)])
  await app.send('touchMove', [finger(t.cx - 40, t.cy - 10)])
  await app.send('touchMove', [finger(pet.cx, pet.cy)])
  await page.waitForTimeout(60)
  const held = await boxOf(page, toolSel(first))
  check(`[${tag}] 醫院：工具跟著手指`, Math.abs(held.cx - pet.cx) < 10, `${Math.round(held.cx)} vs ${Math.round(pet.cx)}`)
  await app.send('touchMove', [finger(pet.cx, pet.cy + 20)])
  await app.send('touchEnd', [])
  check(`[${tag}] 醫院：拖到寵物身上就開始看`, await waitFor(page, (tl) => document.querySelector('[data-testid=doc]')?.dataset.busy === tl, first, 1500))
  check(`[${tag}] 醫院：用對了往下一步`, await waitFor(page, () => document.querySelector('[data-testid=doc]')?.dataset.step === '1', null, 2000))
  await page.waitForTimeout(250)
  await shot(page, `doc-${tag}-2-${first}`)
  check(`[${tag}] 醫院：${first} 有效果`, first === 'bandage' || (await page.locator(`[data-testid=doc-fx-${first}]`).count()) === 1)
  check(`[${tag}] 醫院：寵物說 ${first} 的話`, (await said(page, DOC)).some((k) => k.startsWith('pet.play.doctor.') && !['intro', ailment].map((x) => `pet.play.doctor.${x}`).includes(k)))
  await waitFor(page, () => document.querySelector('[data-testid=doc]')?.dataset.busy === '', null, 4000)
  await page.waitForTimeout(450)
  const home = await boxOf(page, toolSel(first))
  check(`[${tag}] 醫院：工具回托盤`, Math.abs(home.cx - t.cx) < 6 && Math.abs(home.cy - t.cy) < 6, `${Math.round(home.cx)},${Math.round(home.cy)} vs ${Math.round(t.cx)},${Math.round(t.cy)}`)

  // 第二步用點的
  await useTool(app, second)
  check(`[${tag}] 醫院：看完了`, (await docAttr(page, 'data-done')) === '1')
  check(`[${tag}] 醫院：寵物說好多了`, await waitFor(page, () => (document.querySelector('[data-testid=doc]')?.dataset.said ?? '').includes('pet.play.doctor.done'), null, 2000))
  check(`[${tag}] 醫院：送貼紙`, await page.waitForSelector('[data-testid=doc-sticker]', { timeout: 2000 }).then(() => true, () => false))
  if (ailment === 'knee') check(`[${tag}] 醫院：OK 繃留在膝蓋上`, (await page.locator('[data-testid=doc-bandage-on]').count()) === 1)
  else check(`[${tag}] 醫院：病好了`, (await page.locator('[data-testid=doc-symptom]').count()) === 0)
  check(`[${tag}] 醫院：寵物開心`, (await attr(page, '[data-testid=doc-pet] [data-testid=companion]', 'data-pose')) === 'cheer')
  await page.waitForTimeout(500)
  await shot(page, `doc-${tag}-3-done`)

  // 禮物
  check(`[${tag}] 醫院：禮物跳出來`, await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 }).then(() => true, () => false))
  check(`[${tag}] 醫院：背包多一個食物`, (await invTotal(page)) === before + 1)
  check(`[${tag}] 醫院：今天記了 doctor`, !!(await settings(page)).playDaily?.done.includes('doctor'))
  check(`[${tag}] 醫院：玩完第 1 次，卡上有新玩具（新毛病）`, (await attr(page, '[data-testid=play-toy]', 'data-toy')) === 'ailments')
  check(`[${tag}] 醫院：卡還沒收下，新工具還沒出現`, (await attr(page, '[data-testid=play-doctor]', 'data-toys')) === '0')
  await page.waitForTimeout(550)
  await page.getByTestId('play-gift').click()
  const again = await boxOf(page, '[data-testid=play-again]')
  check(`[${tag}] 醫院：再看一次的按鈕夠大、在畫面內`, again.width >= 56 && again.height >= 56 && inView(again, vp))
  check(`[${tag}] 醫院：再看一次不壓寵物`, !overlap(again, pet))
  await shot(page, `doc-${tag}-4-again`)
  await page.getByTestId('play-again').click()
  // v8.5：收下新玩具的下一回一定是發燒，工具盤多冰枕和喝水
  check(`[${tag}] 醫院：收下新玩具，再看一次是發燒`, (await docAttr(page, 'data-ailment')) === 'fever' && (await docAttr(page, 'data-step')) === '0', `${ailment} → ${await docAttr(page, 'data-ailment')}`)
  check(`[${tag}] 醫院：發燒看得到熱氣`, (await page.locator('[data-testid=doc-symptom].doc-sym-fever').count()) === 1)
  check(`[${tag}] 醫院：工具盤變 7 個（還沒有板子）`, (await page.locator('[data-testid=doc-tray] .doc-tool').count()) === 7 && (await page.locator('[data-testid=ui-doc-xray]').count()) === 0)
  for (const t of [...TOOLS, ...NEW_TOOLS]) {
    const b = await boxOf(page, toolSel(t))
    check(`[${tag}] 7 個工具時 ui-doc-${t} 夠大（≥56）且在畫面內`, b.width >= 56 && b.height >= 56 && inView(b, vp), `${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)}`)
  }
  check(`[${tag}] 醫院：7 個工具的工具盤不蓋寵物、沒有橫向捲動`, !overlap(pet, await boxOf(page, '[data-testid=doc-tray]')) && (await noOverflowX(page)))
  await page.waitForTimeout(300)
  await shot(page, `doc-${tag}-5-fever`)
  await useTool(app, 'thermo')
  check(`[${tag}] 醫院：發燒量體溫說熱熱的（不說沒有發燒）`, (await said(page, DOC)).at(-1) === 'pet.play.doctor.hot')
  // 冰枕用拖的
  const ice = await boxOf(page, toolSel('icepack'))
  await app.dragTo(ice, { x: pet.cx, y: pet.cy + 26 })
  check(`[${tag}] 醫院：冰枕拖到寵物身上`, await waitFor(page, () => document.querySelector('[data-testid=doc]')?.dataset.busy === 'icepack', null, 1500))
  check(`[${tag}] 醫院：冰枕有小雪花、說冰冰的`, (await waitFor(page, () => !!document.querySelector('[data-testid=doc-fx-icepack]'), null, 1500)) && (await said(page, DOC)).includes('pet.play.doctor.icepack'))
  await page.waitForTimeout(250)
  await shot(page, `doc-${tag}-6-icepack`)
  await waitFor(page, () => document.querySelector('[data-testid=doc]')?.dataset.busy === '', null, 4000)
  check(`[${tag}] 醫院：發燒看得完、熱氣不見了`, (await docAttr(page, 'data-done')) === '1' && (await page.locator('[data-testid=doc-symptom]').count()) === 0)
  check(`[${tag}] 醫院：第 2 次沒有卡，只有星星和歡呼`, (await settle(page)) === null && (await page.locator('[data-testid=play-cheer]').count()) === 1)
  check(`[${tag}] 醫院：同一天不重複送`, (await page.locator('[data-testid=play-gift]').count()) === 0 && (await invTotal(page)) === before + 1)
  check(`[${tag}] 醫院：沒有橫向捲動（結束時）`, await noOverflowX(page))
  await leave(app, `[${tag}] 醫院`)
  await close(app, `[${tag}] 醫院`)
}

/** 3 歲：馬上發亮、有手勢、用別的工具也有反應不算錯；四種毛病輪一圈 */
async function doctorAge3() {
  const app = await enter('doctor', { age: '3' })
  const { page } = app
  check('醫院 3 歲：該用的工具馬上發亮', await waitFor(page, () => {
    const want = document.querySelector('[data-testid=doc]')?.dataset.next
    return document.querySelector(`[data-testid=ui-doc-${want}]`)?.parentElement?.dataset.glow === '1'
  }, null, 1200))
  check('醫院 3 歲：只有一個在亮', (await page.locator('[data-glow="1"]').count()) === 1)
  check('醫院 3 歲：有手勢示範', await page.waitForSelector('[data-testid=gesture-hint]', { timeout: 2000 }).then(() => true, () => false))
  check('醫院 3 歲：手勢不擋手指', (await page.getByTestId('gesture-hint').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none')
  await shot(page, 'doc-age3-glow')
  const ailment = await docAttr(page, 'data-ailment')
  const other = TOOLS.find((t) => !STEPS[ailment].includes(t) && t !== 'bandage')
  await useTool(app, other)
  check('醫院 3 歲：別的工具也有反應、不往前、不說錯', (await docAttr(page, 'data-step')) === '0' && !(await said(page, DOC)).includes('pet.play.doctor.wrong'))

  // 第一回（沒有新玩具）是原本四種之一；收下新玩具後六種都輪得到
  const seen = []
  const toysGot = []
  for (let i = 0; i < 10 && new Set(seen).size < 6; i++) {
    const a = await docAttr(page, 'data-ailment')
    if (i === 0) check('醫院：沒有新玩具的第一回是原本四種之一', AILMENTS.includes(a), a)
    if (seen.length) check(`醫院：不連續兩回一樣（${seen.at(-1)} → ${a}）`, a !== seen.at(-1))
    seen.push(a)
    if (a === 'knee') check('醫院：擦傷畫在膝蓋上（淡粉紅，沒有血）', (await page.locator('[data-testid=doc-symptom].doc-sym-knee').count()) === 1)
    if (NEW_AILMENTS.includes(a)) {
      check(`醫院 3 歲：${a} 該用的工具也會發亮`, await waitFor(page, () => {
        const want = document.querySelector('[data-testid=doc]')?.dataset.next
        return document.querySelector(`[data-testid=ui-doc-${want}]`)?.parentElement?.dataset.glow === '1'
      }, null, 1500))
    }
    if (a === 'hiccup') {
      check('醫院：打嗝看得到小泡泡', (await page.locator('[data-testid=doc-symptom].doc-sym-hiccup').count()) === 1)
      await useTool(app, 'stetho')
      const w = await boxOf(page, toolSel('water'))
      await app.tap(w.cx, w.cy)
      check('醫院：喝水有水滴、說不打嗝了', (await waitFor(page, () => !!document.querySelector('[data-testid=doc-fx-water]'), null, 2000)) && (await said(page, DOC)).includes('pet.play.doctor.water'))
      await page.waitForTimeout(200)
      await shot(page, 'doc-hiccup-water')
      await waitFor(page, () => document.querySelector('[data-testid=doc]')?.dataset.busy === '', null, 4000)
    } else await treat(app)
    if (a === 'knee') {
      check('醫院：OK 繃貼上去了、擦痕蓋住', (await page.locator('[data-testid=doc-bandage-on]').count()) === 1 && (await page.locator('[data-testid=doc-symptom]').count()) === 0)
      await shot(page, 'doc-knee-bandage')
    }
    check(`醫院：${a} 看得完`, (await docAttr(page, 'data-done')) === '1')
    // 玩完的卡（食物、新玩具、皇冠）說完話才跳出來：等它出來再收下，不然會蓋住下一回
    const toy = await settle(page)
    if (toy) toysGot.push(`${i + 1}:${toy}`)
    await page.waitForSelector('[data-testid=play-again]')
    await page.getByTestId('play-again').click()
  }
  check('醫院：收下新玩具後第二回是發燒', seen[1] === 'fever', seen.join(','))
  check('醫院：六種毛病都輪到', new Set(seen).size === 6, seen.join(','))
  check('醫院：第 1 次拿到新毛病、第 3 次拿到板子', toysGot.join(' ') === '1:ailments 3:xray', toysGot.join(' '))
  check('醫院：玩完 3 次之後工具盤有板子', (await page.locator('[data-testid=ui-doc-xray]').count()) === 1)
  check('醫院：新的一回 OK 繃拿掉了', (await page.locator('[data-testid=doc-bandage-on]').count()) === 0)
  await close(app, '醫院 3 歲')
}

async function doctorAge45() {
  const app = await enter('doctor', { age: '4-5' })
  const { page } = app
  await page.waitForTimeout(1500)
  check('醫院 4–5 歲：一開始不亮', (await page.locator('[data-glow="1"]').count()) === 0)
  check('醫院 4–5 歲：4 秒後該用的工具發亮', await waitFor(page, () => {
    const want = document.querySelector('[data-testid=doc]')?.dataset.next
    return document.querySelector(`[data-testid=ui-doc-${want}]`)?.parentElement?.dataset.glow === '1'
  }, null, 4000))
  check('醫院 4–5 歲：先說了哪裡不舒服', (await said(page, DOC)).includes(`pet.play.doctor.${await docAttr(page, 'data-ailment')}`))
  // 點寵物再說一次
  const n0 = (await said(page, DOC)).length
  const pet = await boxOf(page, '[data-testid=doc-pet]')
  await page.mouse.click(pet.cx, pet.cy)
  check('醫院：點寵物再說一次哪裡不舒服', (await said(page, DOC)).length === n0 + 1)
  await treat(app)
  check('醫院 4–5 歲：看得完', (await docAttr(page, 'data-done')) === '1')
  await close(app, '醫院 4–5 歲')
}

async function doctorAge67() {
  const app = await enter('doctor', { age: '6-7' })
  const { page } = app
  const before = await invTotal(page)
  await page.waitForTimeout(5500)
  check('醫院 6–7 歲：不發亮', (await page.locator('[data-glow="1"]').count()) === 0)
  const ailment = await docAttr(page, 'data-ailment')
  const wrong = TOOLS.find((t) => !STEPS[ailment].includes(t))
  await useTool(app, wrong)
  check('醫院 6–7 歲：選錯寵物說「不是這裡」', (await said(page, DOC)).includes('pet.play.doctor.wrong'))
  check('醫院 6–7 歲：選錯進度不變', (await docAttr(page, 'data-step')) === '0')
  // 順序反了也只是不是這裡
  await useTool(app, STEPS[ailment][1])
  check('醫院 6–7 歲：還沒檢查先處理也不算', (await docAttr(page, 'data-step')) === '0')
  await shot(page, 'doc-age67-wrong')
  await treat(app)
  check('醫院 6–7 歲：選錯過也看得完', (await docAttr(page, 'data-done')) === '1')
  check('醫院 6–7 歲：沒有扣分，禮物照送', await waitFor(page, () => !!document.querySelector('[data-testid=play-gift]'), null, 4000))
  check('醫院 6–7 歲：背包多一個', (await invTotal(page)) === before + 1)
  await close(app, '醫院 6–7 歲')
}

/** 聽診器的心跳聲（合成音）與音效開關；三種寵物；多指 */
async function doctorExtras() {
  for (const on of [true, false]) {
    const app = await enter('doctor', { age: '3', settings: on ? {} : { soundOn: false } })
    const { page } = app
    const o0 = await osc(page)
    await useTool(app, 'stetho')
    const d = (await osc(page)) - o0
    check(`醫院：聽診器${on ? '有咚咚心跳聲' : '在音效關掉時不響'}`, on ? d >= 4 : d === 0, String(d))
    await close(app, `醫院 音效${on ? '開' : '關'}`)
  }
  for (const species of ['rabbit', 'tiger']) {
    const app = await enter('doctor', { species })
    const { page } = app
    check(`醫院：${species} 是孩子自己的寵物`, (await attr(page, '[data-testid=doc-pet] [data-testid=companion]', 'data-species')) === species)
    await page.waitForTimeout(300)
    await shot(page, `doc-${species}`)
    await treat(app)
    check(`醫院：${species} 也看得完`, (await docAttr(page, 'data-done')) === '1')
    await close(app, `醫院 ${species}`)
  }
  {
    // 兩根手指同時拿兩個工具：一次只看一個，不會壞
    const app = await enter('doctor', { age: '3' })
    const { page } = app
    const ailment = await docAttr(page, 'data-ailment')
    const a = await boxOf(page, toolSel(STEPS[ailment][0]))
    const b = await boxOf(page, toolSel(TOOLS.find((t) => !STEPS[ailment].includes(t))))
    await app.send('touchStart', [finger(a.cx, a.cy, 1)])
    await app.send('touchStart', [finger(a.cx, a.cy, 1), finger(b.cx, b.cy, 2)])
    await app.send('touchEnd', [])
    await page.waitForTimeout(200)
    check('醫院 多指：一次只看一個工具', ['', STEPS[ailment][0]].includes(await docAttr(page, 'data-busy')))
    await waitFor(page, () => document.querySelector('[data-testid=doc]')?.dataset.busy === '', null, 4000)
    await treat(app)
    check('醫院 多指：之後照樣看得完', (await docAttr(page, 'data-done')) === '1')
    await close(app, '醫院 多指')
  }
  {
    // 減少動態：照樣能玩
    const app = await enter('doctor', { ctxOpts: { reducedMotion: 'reduce' } })
    await treat(app, { dragFirst: true })
    check('醫院 減少動態：看得完', (await docAttr(app.page, 'data-done')) === '1')
    // 中途離開不壞
    await leave(app, '醫院 減少動態')
    await close(app, '醫院 減少動態')
  }
}

/** v8.5 照骨頭（玩完 3 次）：板子拖到寵物身上看到骨頭和愛心，不算步驟、看完了也能玩；一進來就有新玩具時六種毛病一起輪 */
async function doctorXray(tag, vp) {
  const app = await enter('doctor', { size: vp, age: '6-7', plays: 3 })
  const { page } = app
  await page.waitForTimeout(800) // 進場的動畫演完再量位置
  check(`[${tag}] 照骨頭：一進來就有 2 個新玩具`, (await attr(page, '[data-testid=play-doctor]', 'data-toys')) === '2')
  const ailment = await docAttr(page, 'data-ailment')
  check(`[${tag}] 照骨頭：毛病是六種之一`, [...AILMENTS, ...NEW_AILMENTS].includes(ailment), ailment)
  check(`[${tag}] 照骨頭：工具盤 8 個`, (await page.locator('[data-testid=doc-tray] .doc-tool').count()) === 8)
  for (const t of [...TOOLS, ...NEW_TOOLS, 'xray']) {
    const b = await boxOf(page, toolSel(t))
    check(`[${tag}] 8 個工具時 ui-doc-${t} 夠大（≥56）且在畫面內`, b.width >= 56 && b.height >= 56 && inView(b, vp), `${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)}`)
  }
  const pet = await boxOf(page, '[data-testid=doc-pet]')
  check(`[${tag}] 照骨頭：8 個工具的工具盤不蓋寵物、不蓋回去鍵、沒有橫向捲動`, !overlap(pet, await boxOf(page, '[data-testid=doc-tray]')) && !overlap(await boxOf(page, '[data-testid=game-back]'), await boxOf(page, '[data-testid=doc-tray]')) && (await noOverflowX(page)))
  check(`[${tag}] 照骨頭：還沒拿板子時看不到骨頭`, (await docAttr(page, 'data-xray')) === '0' && !(await page.getByTestId('doc-xray-view').isVisible()))
  await shot(page, `doc-${tag}-7-tools8`)

  // 板子拖到寵物胸口
  const x = await boxOf(page, toolSel('xray'))
  await app.send('touchStart', [finger(x.cx, x.cy)])
  await app.send('touchMove', [finger(x.cx - 30, x.cy - 20)])
  await app.send('touchMove', [finger(pet.cx, pet.y + pet.height * 0.66 + 26)])
  await page.waitForTimeout(120)
  check(`[${tag}] 照骨頭：板子在寵物身上就看到骨頭`, (await docAttr(page, 'data-xray')) === '1' && (await page.getByTestId('doc-xray-view').isVisible()))
  check(`[${tag}] 照骨頭：有卡通骨頭和一顆愛心`, (await page.locator('[data-testid=doc-xray-view] .doc-bone').count()) >= 8 && (await page.locator('[data-testid=doc-xray-heart]').count()) === 1)
  check(`[${tag}] 照骨頭：寵物說看到骨頭了`, (await said(page, DOC)).includes('pet.play.doctor.xray'))
  const view = await boxOf(page, '[data-testid=doc-xray-view]')
  check(`[${tag}] 照骨頭：照的地方跟著板子（在胸口）`, Math.abs(view.cx - pet.cx) < 12 && Math.abs(view.cy - (pet.y + pet.height * 0.66)) < 12, `${Math.round(view.cx)},${Math.round(view.cy)}`)
  const heart = await boxOf(page, '[data-testid=doc-xray-heart]')
  check(`[${tag}] 照骨頭：愛心在照到的範圍裡`, heart.cx > view.x && heart.cx < view.x + view.width && heart.cy > view.y && heart.cy < view.y + view.height)
  check(`[${tag}] 照骨頭：愛心會跳（只動 transform）`, (await page.locator('.doc-xray-heart').evaluate((el) => getComputedStyle(el).animationName)) === 'doc-xbeat')
  check(`[${tag}] 照骨頭：照出來的畫面不擋手指`, (await page.getByTestId('doc-xray-view').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none')
  check(`[${tag}] 照骨頭：不算步驟`, (await docAttr(page, 'data-step')) === '0' && (await docAttr(page, 'data-busy')) === '')
  await shot(page, `doc-${tag}-8-xray`)
  // 移到頭上：骨頭不動、窗子動
  await app.send('touchMove', [finger(pet.cx, pet.y + pet.height * 0.3 + 26)])
  await page.waitForTimeout(80)
  const view2 = await boxOf(page, '[data-testid=doc-xray-view]')
  const heart2 = await boxOf(page, '[data-testid=doc-xray-heart]')
  check(`[${tag}] 照骨頭：板子移到頭上，骨頭留在原位`, Math.abs(view2.cy - (pet.y + pet.height * 0.3)) < 12 && Math.abs(heart2.cy - heart.cy) < 3, `${Math.round(heart.cy)} → ${Math.round(heart2.cy)}`)
  // 拖出寵物外面：收起來
  await app.send('touchMove', [finger(Math.max(30, pet.x - pet.width * 0.4), pet.cy)])
  await page.waitForTimeout(80)
  if (pet.x - pet.width * 0.4 > 30) check(`[${tag}] 照骨頭：板子離開寵物就看不到`, (await docAttr(page, 'data-xray')) === '0')
  await app.send('touchEnd', [])
  await page.waitForTimeout(500)
  const home = await boxOf(page, toolSel('xray'))
  check(`[${tag}] 照骨頭：放開後板子回工具盤、骨頭收起來`, Math.abs(home.cx - x.cx) < 6 && Math.abs(home.cy - x.cy) < 6 && (await docAttr(page, 'data-xray')) === '0', `${Math.round(home.cx - x.cx)},${Math.round(home.cy - x.cy)} xray=${await docAttr(page, 'data-xray')}`)

  // 點一下：自己照胸口一下再收起來
  const n0 = (await said(page, DOC)).filter((k) => k === 'pet.play.doctor.xray').length
  await app.tap(x.cx, x.cy)
  check(`[${tag}] 照骨頭：點一下板子也照得到`, await waitFor(page, () => document.querySelector('[data-testid=doc]')?.dataset.xray === '1', null, 1000))
  check(`[${tag}] 照骨頭：點一下也說一次`, (await said(page, DOC)).filter((k) => k === 'pet.play.doctor.xray').length === n0 + 1)
  check(`[${tag}] 照骨頭：過一下自己收起來`, await waitFor(page, () => document.querySelector('[data-testid=doc]')?.dataset.xray === '0', null, 4000))

  // 照過骨頭照樣看得完；看完了板子還在、還能玩
  await treat(app)
  check(`[${tag}] 照骨頭：照過之後照樣看得完`, (await docAttr(page, 'data-done')) === '1')
  await settle(page)
  await page.waitForSelector('[data-testid=play-again]')
  const again = await boxOf(page, '[data-testid=play-again]')
  const x2 = await boxOf(page, toolSel('xray'))
  check(`[${tag}] 照骨頭：看完了板子還在，夠大、在畫面內，不蓋寵物和再玩一次`, x2.width >= 56 && inView(x2, vp) && !overlap(x2, pet) && !overlap(x2, again) && inView(again, vp) && !overlap(again, pet))
  await app.dragTo(x2, { x: pet.cx, y: pet.cy + 26 }, 6)
  // dragTo 會放開：放開前那一刻有照到（說過第三次）
  check(`[${tag}] 照骨頭：看完了也能照`, (await said(page, DOC)).filter((k) => k === 'pet.play.doctor.xray').length === n0 + 2)
  await page.waitForTimeout(450)
  await shot(page, `doc-${tag}-9-done-xray`)
  await leave(app, `[${tag}] 照骨頭`)
  await close(app, `[${tag}] 照骨頭`)
}

/** v8.5：只有第一個新玩具（玩完 1 次）一進來就有冰枕和喝水、沒有板子；減少動態時新東西照樣能玩 */
async function doctorToyExtras() {
  {
    const app = await enter('doctor', { age: '4-5', plays: 1 })
    const { page } = app
    check('醫院（玩完 1 次）：有冰枕和喝水、沒有板子', (await page.locator('[data-testid=doc-tray] .doc-tool').count()) === 7 && (await page.locator('[data-testid=ui-doc-xray]').count()) === 0 && (await page.locator('[data-testid=doc-xray-view]').count()) === 0)
    // 沒打嗝時喝水：有反應、不說「不打嗝了」、不往前
    const ailment = await docAttr(page, 'data-ailment')
    if (ailment !== 'hiccup') {
      await useTool(app, 'water')
      check('醫院：沒打嗝時喝水有反應但不說「不打嗝了」、不往前', (await docAttr(page, 'data-step')) === '0' && !(await said(page, DOC)).includes('pet.play.doctor.water') && !(await said(page, DOC)).includes('pet.play.doctor.wrong'))
    }
    await treat(app)
    check('醫院（玩完 1 次）：看得完', (await docAttr(page, 'data-done')) === '1')
    await close(app, '醫院 玩完 1 次')
  }
  {
    const app = await enter('doctor', { age: '6-7', plays: 3, ctxOpts: { reducedMotion: 'reduce' } })
    const { page } = app
    const pet = await boxOf(page, '[data-testid=doc-pet]')
    const x = await boxOf(page, toolSel('xray'))
    await app.send('touchStart', [finger(x.cx, x.cy)])
    await app.send('touchMove', [finger(x.cx - 30, x.cy - 20)])
    await app.send('touchMove', [finger(pet.cx, pet.cy + 26)])
    await page.waitForTimeout(100)
    check('醫院 減少動態：照得到骨頭、愛心不跳', (await docAttr(page, 'data-xray')) === '1' && (await page.locator('.doc-xray-heart').evaluate((el) => getComputedStyle(el).animationName)) === 'none')
    await app.send('touchEnd', [])
    // 6–7 歲拿新工具去用在不對的毛病：只是「不是這裡」
    const ailment = await docAttr(page, 'data-ailment')
    if (!STEPS[ailment].includes('icepack')) {
      await useTool(app, 'icepack')
      check('醫院 6–7 歲：新工具用錯也只說「不是這裡」、進度不變', (await said(page, DOC)).includes('pet.play.doctor.wrong') && (await docAttr(page, 'data-step')) === '0')
    }
    await treat(app)
    check('醫院 減少動態（有新玩具）：看得完', (await docAttr(page, 'data-done')) === '1')
    await leave(app, '醫院 減少動態（有新玩具）')
    await close(app, '醫院 減少動態（有新玩具）')
  }
}

// ========== 晚安小屋 ==========

const BED = '[data-testid=bed]'
const bedAttr = (page, name) => attr(page, BED, name)
const bedStep = (page) => bedAttr(page, 'data-step')
const waitStep = (page, s, timeout = 5000) => waitFor(page, (s) => document.querySelector('[data-testid=bed]')?.dataset.step === s, s, timeout)

/** 拿牙刷在寵物嘴巴附近左右來回刷，直到刷好 */
async function brushTeeth(app, { direct = false } = {}) {
  const { page } = app
  const pet = await boxOf(page, '[data-testid=bed-pet]')
  const y = pet.y + pet.height * 0.5 + 26
  const left = pet.x + pet.width * 0.32
  const right = pet.x + pet.width * 0.68
  const start = direct ? { cx: left, cy: y } : await boxOf(page, '[data-testid=ui-bed-brush]')
  await app.send('touchStart', [finger(start.cx, start.cy)])
  await app.send('touchMove', [finger((start.cx + left) / 2, (start.cy + y) / 2)])
  let strokes = 0
  for (let i = 0; i < 30 && (await bedAttr(page, 'data-brush')) !== '1.00'; i++) {
    for (let k = 1; k <= 6; k++) {
      const f = k / 6
      await app.send('touchMove', [finger(i % 2 ? right - (right - left) * f : left + (right - left) * f, y)])
    }
    strokes++
  }
  await app.send('touchEnd', [])
  return strokes
}

async function bedtimeSize(tag, vp) {
  const app = await enter('bedtime', { size: vp })
  const { page } = app
  const petBefore = await getPet(page)
  check(`[${tag}] 晚安：寵物是孩子自己的`, (await page.locator('[data-testid=bed-pet] [data-testid=companion]').count()) === 1)
  check(`[${tag}] 晚安：沒有橫向捲動`, await noOverflowX(page))
  check(`[${tag}] 晚安：從刷牙開始`, (await bedStep(page)) === 'brush')
  for (const id of ['ui-bed-brush', 'ui-bed-pajamas', 'ui-bed-book', 'bed-song', 'ui-bed-lamp', 'game-back']) {
    const b = await boxOf(page, `[data-testid=${id}]`)
    check(`[${tag}] ${id} 夠大（≥56）且在畫面內`, b.width >= 56 && b.height >= 56 && inView(b, vp), `${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)}`)
  }
  const pet = await boxOf(page, '[data-testid=bed-pet]')
  check(`[${tag}] 晚安：寵物在畫面內`, inView(pet, vp))
  check(`[${tag}] 晚安：工具盤不蓋寵物`, !overlap(pet, await boxOf(page, '[data-testid=bed-tray]')))
  check(`[${tag}] 晚安：小床在畫面內`, inView(await boxOf(page, '[data-testid=ui-bed-bed]'), vp))
  // v8.5：睡前坐在被窩裡（被子蓋住腳），不是站在床上
  const blanket = await boxOf(page, '[data-testid=bed-blanket]')
  const edge = blanket.y + blanket.height * 0.48
  check(`[${tag}] 晚安：寵物坐在被窩裡（被子蓋住腳、不蓋到嘴巴）`, pet.y + pet.height > edge + pet.height * 0.12 && pet.y + pet.height * 0.6 < edge, `腳 ${Math.round(pet.y + pet.height)} 被子 ${Math.round(edge)}`)
  check(`[${tag}] 晚安：被子不擋手指`, (await page.getByTestId('bed-blanket').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none')
  check(`[${tag}] 晚安：刷牙有手勢提示`, await page.waitForSelector('[data-testid=gesture-hint]', { timeout: 4000 }).then(() => true, () => false))
  check(`[${tag}] 晚安：說了要刷牙`, (await said(page, BED)).includes('pet.play.bedtime.brush'))
  await shot(page, `bed-${tag}-1-start`)

  // 1. 刷牙：刷一點點有泡泡、不會馬上好
  const brush = await boxOf(page, '[data-testid=ui-bed-brush]')
  const y = pet.y + pet.height * 0.5 + 26
  await app.send('touchStart', [finger(brush.cx, brush.cy)])
  await app.send('touchMove', [finger(pet.x + pet.width * 0.35, y)])
  for (let k = 0; k < 4; k++) await app.send('touchMove', [finger(pet.x + pet.width * (k % 2 ? 0.35 : 0.65), y)])
  await page.waitForTimeout(80)
  check(`[${tag}] 晚安：刷的時候有泡泡`, (await page.locator('[data-testid=bed-foam]').count()) === 1)
  check(`[${tag}] 晚安：刷一下還沒好`, (await bedStep(page)) === 'brush' && Number(await bedAttr(page, 'data-brush')) > 0)
  await shot(page, `bed-${tag}-2-brush`)
  await app.send('touchEnd', [])
  await brushTeeth(app)
  check(`[${tag}] 晚安：刷好牙齒亮晶晶`, (await page.locator('[data-testid=bed-shine]').count()) === 1 && (await said(page, BED)).includes('pet.play.bedtime.brushed'))

  // 2. 換睡衣：拖到寵物身上
  check(`[${tag}] 晚安：換睡衣`, await waitStep(page, 'pajamas'))
  await page.waitForTimeout(300)
  const pj = await boxOf(page, '[data-testid=ui-bed-pajamas]')
  await app.dragTo(pj, { x: pet.cx, y: pet.cy })
  check(`[${tag}] 晚安：戴上睡帽`, await waitFor(page, () => !!document.querySelector('[data-testid=bed-cap]'), null, 2000))
  await shot(page, `bed-${tag}-3-cap`)

  // 3. 故事：點書，點書翻快一點
  check(`[${tag}] 晚安：選故事或唱歌`, await waitStep(page, 'story'))
  check(`[${tag}] 晚安：說要聽故事還是唱歌`, (await said(page, BED)).includes('pet.play.bedtime.story'))
  check(`[${tag}] 晚安（沒有新玩具）：換完睡衣直接選故事，沒有抱玩偶那一步`, (await page.locator('[data-testid=bed-dolls], [data-testid=bed-doll]').count()) === 0 && !(await said(page, BED)).includes('pet.toy.bedtime.doll'))
  const book = await boxOf(page, '[data-testid=ui-bed-book]')
  await app.tap(book.cx, book.cy)
  check(`[${tag}] 晚安：打開故事書`, await page.waitForSelector('[data-testid=bed-story]', { timeout: 1500 }).then(() => true, () => false))
  check(`[${tag}] 晚安：聽故事時眼睛慢慢閉上`, (await attr(page, '[data-testid=bed-pet] [data-testid=companion]', 'data-pose')) === 'sleepy')
  const story = await boxOf(page, '[data-testid=bed-story]')
  check(`[${tag}] 晚安：故事書在畫面內`, inView(story, vp))
  await page.waitForTimeout(300)
  await shot(page, `bed-${tag}-4-story`)
  await app.tap(story.cx, story.cy)
  await page.waitForTimeout(100)
  check(`[${tag}] 晚安：點書翻下一頁`, (await attr(page, '[data-testid=bed-story]', 'data-page')) === '1')
  check(`[${tag}] 晚安：故事講完說好想睡`, await waitFor(page, () => (document.querySelector('[data-testid=bed]')?.dataset.said ?? '').includes('pet.play.bedtime.sleepy'), null, 6000))

  // 4. 關燈
  check(`[${tag}] 晚安：輪到關燈`, await waitStep(page, 'lamp', 4000))
  check(`[${tag}] 晚安：說要關燈`, (await said(page, BED)).includes('pet.play.bedtime.light'))
  check(`[${tag}] 晚安：關燈有手勢提示`, await page.waitForSelector('[data-testid=gesture-hint]', { timeout: 3000 }).then(() => true, () => false))
  const lamp = await boxOf(page, '[data-testid=ui-bed-lamp]')
  await app.tap(lamp.cx, lamp.cy)
  check(`[${tag}] 晚安：睡著了`, await waitStep(page, 'asleep', 1500))
  await page.waitForTimeout(1400)
  await page.screenshot() // WebKit 無頭不跑 rAF：刷一幀
  const darkOpacity = await page.getByTestId('bed-dark').evaluate((el) => Number(getComputedStyle(el).opacity))
  check(`[${tag}] 晚安：房間變暗`, darkOpacity > 0.95, String(darkOpacity))
  check(`[${tag}] 晚安：星星出來`, (await page.locator('[data-testid=bed-stars] i').count()) > 5)
  check(`[${tag}] 晚安：寵物睡覺的樣子`, (await attr(page, '[data-testid=bed-pet] [data-testid=companion]', 'data-pose')) === 'sleep')
  check(`[${tag}] 晚安：打呼的 Z 字`, (await page.locator('[data-testid=bed-zzz]').count()) === 1)
  check(`[${tag}] 晚安：說晚安`, (await said(page, BED)).includes('pet.play.bedtime.night'))
  check(`[${tag}] 晚安：睡帽還戴著`, (await page.locator('[data-testid=bed-cap]').count()) === 1)
  await shot(page, `bed-${tag}-5-asleep`)

  // 禮物
  check(`[${tag}] 晚安：禮物跳出來`, await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 }).then(() => true, () => false))
  check(`[${tag}] 晚安：今天記了 bedtime`, !!(await settings(page)).playDaily?.done.includes('bedtime'))
  check(`[${tag}] 晚安：玩完第 1 次，卡上有新玩具（抱抱玩偶）`, (await attr(page, '[data-testid=play-toy]', 'data-toy')) === 'doll')
  await page.waitForTimeout(550)
  await page.getByTestId('play-gift').click()
  // 還沒有夜燈投影：睡著後點夜燈，天花板還是星星
  const lamp0 = await boxOf(page, '[data-testid=ui-bed-lamp]')
  await app.tap(lamp0.cx, lamp0.cy)
  await page.waitForTimeout(150)
  check(`[${tag}] 晚安（沒有投影）：點夜燈天花板不變`, (await bedAttr(page, 'data-ceiling')) === 'stars' && (await page.locator('[data-testid=bed-stars]').count()) === 1 && (await page.locator('[data-testid=bed-sea], [data-testid=bed-rainbow]').count()) === 0)

  // 5. 點睡著的寵物：翻身、說夢話
  const p2 = await boxOf(page, '[data-testid=bed-pet]')
  await app.tap(p2.cx, p2.cy + p2.height * 0.2)
  await page.waitForTimeout(100)
  check(`[${tag}] 晚安：點寵物會翻身`, (await bedAttr(page, 'data-flipped')) === '1')
  check(`[${tag}] 晚安：說夢話`, (await said(page, BED)).includes('pet.play.bedtime.dream') && (await page.locator('[data-testid=bed-dream]').count()) === 1)
  await page.waitForTimeout(700)
  await shot(page, `bed-${tag}-6-dream`)
  await app.tap(p2.cx, p2.cy + p2.height * 0.2)
  await page.waitForTimeout(100)
  check(`[${tag}] 晚安：再點翻回來`, (await bedAttr(page, 'data-flipped')) === '0')
  const again = await boxOf(page, '[data-testid=play-again]')
  check(`[${tag}] 晚安：再玩一次的按鈕夠大、在畫面內`, again.width >= 56 && inView(again, vp))
  check(`[${tag}] 晚安：沒有橫向捲動（結束時）`, await noOverflowX(page))

  // 只是扮演：寵物資料沒變
  const petAfter = await getPet(page)
  check(`[${tag}] 晚安：沒有改寵物資料`, JSON.stringify(petAfter) === JSON.stringify(petBefore))
  await leave(app, `[${tag}] 晚安`)
  await close(app, `[${tag}] 晚安`)
}

/** 刷牙、換睡衣，走到換睡衣之後的那一步（有玩偶是 doll，沒有是 story） */
async function toAfterPajamas(app, step) {
  const { page } = app
  await brushTeeth(app)
  await waitStep(page, 'pajamas')
  await page.waitForTimeout(300)
  const pj = await boxOf(page, '[data-testid=ui-bed-pajamas]')
  await app.tap(pj.cx, pj.cy)
  return waitStep(page, step)
}

/** 聽完故事、關燈、睡著 */
async function storyToAsleep(app) {
  const { page } = app
  const book = await boxOf(page, '[data-testid=ui-bed-book]')
  await app.tap(book.cx, book.cy)
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(150)
    if (!(await page.locator('[data-testid=bed-story]').count())) break
    const b = await boxOf(page, '[data-testid=bed-story]')
    await app.tap(b.cx, b.cy)
  }
  await waitStep(page, 'lamp', 6000)
  const lamp = await boxOf(page, '[data-testid=ui-bed-lamp]')
  await app.tap(lamp.cx, lamp.cy)
  return waitStep(page, 'asleep')
}

/** v8.5 有兩個新玩具（玩完 3 次）：抱抱玩偶（拖給寵物、抱著睡）與夜燈投影（星星 → 海底 → 彩虹） */
async function bedtimeToys(tag, vp) {
  const app = await enter('bedtime', { size: vp, plays: 3 })
  const { page } = app
  const petBefore = await getPet(page)
  check(`[${tag}] 玩偶：一進來就有 2 個新玩具`, (await attr(page, '[data-testid=play-bedtime]', 'data-toys')) === '2')
  check(`[${tag}] 玩偶：刷牙時還沒有玩偶`, (await page.locator('[data-testid=bed-dolls]').count()) === 0)
  check(`[${tag}] 玩偶：換睡衣之後是抱抱玩偶`, await toAfterPajamas(app, 'doll'))
  check(`[${tag}] 玩偶：寵物說想抱玩偶`, (await said(page, BED)).includes('pet.toy.bedtime.doll'))
  await page.waitForTimeout(450)
  const pet = await boxOf(page, '[data-testid=bed-pet]')
  const tray = await boxOf(page, '[data-testid=bed-tray]')
  const dolls = await boxOf(page, '[data-testid=bed-dolls]')
  check(`[${tag}] 玩偶：三個玩偶擺出來，不蓋寵物、工具盤、回去鍵`, (await page.locator('[data-testid^=ui-bed-doll-]').count()) === 3 && !overlap(dolls, pet) && !overlap(dolls, tray) && !overlap(dolls, await boxOf(page, '[data-testid=game-back]')))
  for (const d of ['bear', 'bunny', 'dino']) {
    const b = await boxOf(page, `[data-testid=ui-bed-doll-${d}]`)
    check(`[${tag}] ui-bed-doll-${d} 夠大（≥56）且在畫面內`, b.width >= 56 && b.height >= 56 && inView(b, vp), `${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)}`)
  }
  check(`[${tag}] 玩偶：沒有橫向捲動`, await noOverflowX(page))
  check(`[${tag}] 玩偶：有手勢提示`, await page.waitForSelector('[data-testid=gesture-hint]', { timeout: 3000 }).then(() => true, () => false))
  check(`[${tag}] 玩偶：故事和唱歌也亮著（可以跳過）`, (await page.locator('[data-testid=bed-tray] .bed-slot.active').count()) === 2)
  await shot(page, `bed-${tag}-7-dolls`)
  // 拖到外面放開：不算，玩偶回去
  const bunny = await boxOf(page, '[data-testid=ui-bed-doll-bunny]')
  await app.dragTo(bunny, { x: vp.width - 30, y: 40 })
  await page.waitForTimeout(500)
  check(`[${tag}] 玩偶：拖到寵物外面不算`, (await bedAttr(page, 'data-doll')) === '' && (await bedStep(page)) === 'doll')
  // 拖給寵物
  await app.dragTo(bunny, { x: pet.cx, y: pet.cy + 26 })
  check(`[${tag}] 玩偶：拖給寵物，寵物抱著`, (await waitFor(page, () => document.querySelector('[data-testid=bed]')?.dataset.doll === 'bunny', null, 2000)) && (await page.locator('[data-testid=bed-doll][data-doll=bunny]').count()) === 1)
  check(`[${tag}] 玩偶：寵物說抱著好舒服`, (await said(page, BED)).includes('pet.play.bedtime.doll'))
  const held = await boxOf(page, '[data-testid=bed-doll]')
  check(`[${tag}] 玩偶：抱在寵物身上、不擋手指`, overlap(held, pet) && (await page.getByTestId('bed-doll').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none')
  await page.waitForTimeout(300)
  await shot(page, `bed-${tag}-8-hug`)
  check(`[${tag}] 玩偶：抱好之後選故事或唱歌、玩偶收起來`, (await waitStep(page, 'story')) && (await page.locator('[data-testid=bed-dolls]').count()) === 0)
  check(`[${tag}] 玩偶：一路到睡著`, await storyToAsleep(app))
  await page.waitForTimeout(1400)
  await page.screenshot() // WebKit 無頭不跑 rAF：刷一幀
  check(`[${tag}] 玩偶：抱著玩偶睡`, (await page.locator('[data-testid=bed-doll][data-doll=bunny]').count()) === 1 && (await attr(page, '[data-testid=bed-pet] [data-testid=companion]', 'data-pose')) === 'sleep')
  check(`[${tag}] 投影：一開始是星星`, (await bedAttr(page, 'data-ceiling')) === 'stars' && (await page.locator('[data-testid=bed-stars] i').count()) > 5)
  check(`[${tag}] 投影：夜燈在邀請孩子點`, (await page.locator('[data-testid=ui-bed-lamp].proj').count()) === 1)
  await shot(page, `bed-${tag}-9-asleep-doll`)
  await settle(page)

  // 夜燈投影：星星 → 海底 → 彩虹 → 星星
  const lamp = await boxOf(page, '[data-testid=ui-bed-lamp]')
  check(`[${tag}] 投影：夜燈夠大（≥56）、在畫面內`, lamp.width >= 56 && lamp.height >= 56 && inView(lamp, vp))
  await app.tap(lamp.cx, lamp.cy)
  await page.waitForTimeout(1000)
  await page.screenshot()
  check(`[${tag}] 投影：點夜燈變海底`, (await bedAttr(page, 'data-ceiling')) === 'sea' && (await page.locator('[data-testid=bed-sea] .bed-fish').count()) >= 4 && (await page.locator('[data-testid=bed-stars]').count()) === 0)
  check(`[${tag}] 投影：點過就不再邀請`, (await page.locator('[data-testid=ui-bed-lamp].proj').count()) === 0)
  const sea = await boxOf(page, '[data-testid=bed-sea]')
  const p2 = await boxOf(page, '[data-testid=bed-pet]')
  check(`[${tag}] 投影：照在天花板，不擋手指、不蓋寵物的臉`, (await page.getByTestId('bed-sea').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none' && sea.y + sea.height < p2.y + p2.height * 0.55, `${Math.round(sea.y + sea.height)} vs ${Math.round(p2.y + p2.height * 0.55)}`)
  check(`[${tag}] 投影：動畫只用 transform 與 opacity`, await page.evaluate(() => {
    const names = [...document.querySelectorAll('[data-testid=bed-sea], [data-testid=bed-sea] *')].map((el) => getComputedStyle(el).animationName).filter((n) => n && n !== 'none')
    const ok = new Set(['bed-proj-in', 'bed-swim', 'bed-swim-rev', 'bed-bubble'])
    return names.length > 0 && names.every((n) => ok.has(n))
  }))
  await shot(page, `bed-${tag}-10-sea`)
  await app.tap(lamp.cx, lamp.cy)
  await page.waitForTimeout(1000)
  await page.screenshot()
  check(`[${tag}] 投影：再點變彩虹`, (await bedAttr(page, 'data-ceiling')) === 'rainbow' && (await page.locator('[data-testid=bed-rainbow] path').count()) >= 6 && (await page.locator('[data-testid=bed-sea]').count()) === 0)
  check(`[${tag}] 投影：彩虹在畫面內`, inView(await boxOf(page, '[data-testid=bed-rainbow]'), vp))
  await shot(page, `bed-${tag}-11-rainbow`)
  // 投影開著，照樣能點寵物翻身
  await app.tap(p2.cx, p2.cy + p2.height * 0.2)
  await page.waitForTimeout(100)
  check(`[${tag}] 投影：開著也能點寵物翻身、玩偶還抱著`, (await bedAttr(page, 'data-flipped')) === '1' && (await page.locator('[data-testid=bed-doll]').count()) === 1)
  await app.tap(lamp.cx, lamp.cy)
  await page.waitForTimeout(200)
  check(`[${tag}] 投影：第三下回到星星`, (await bedAttr(page, 'data-ceiling')) === 'stars' && (await page.locator('[data-testid=bed-stars]').count()) === 1)
  check(`[${tag}] 投影：沒有橫向捲動`, await noOverflowX(page))
  check(`[${tag}] 玩偶與投影：沒有改寵物資料`, JSON.stringify(await getPet(page)) === JSON.stringify(petBefore))

  // 再玩一次：玩偶放回去、天花板回到星星
  await page.getByTestId('play-again').click()
  check(`[${tag}] 再玩一次：沒有抱玩偶、燈打開`, (await bedStep(page)) === 'brush' && (await bedAttr(page, 'data-doll')) === '' && (await bedAttr(page, 'data-dark')) === '0' && (await page.locator('[data-testid=bed-doll]').count()) === 0)
  await leave(app, `[${tag}] 玩偶與投影`)
  await close(app, `[${tag}] 玩偶與投影`)
}

/** v8.5：只有抱抱玩偶（玩完 1 次）時可以跳過、點一下也能選、沒有投影；減少動態照樣能玩 */
async function bedtimeToyExtras() {
  {
    // 跳過：不選玩偶，直接選故事
    const app = await enter('bedtime', { plays: 1 })
    const { page } = app
    check('晚安（玩完 1 次）：有抱抱玩偶那一步', await toAfterPajamas(app, 'doll'))
    await page.waitForTimeout(300)
    check('晚安：不選玩偶直接選故事也能往下走', await storyToAsleep(app))
    check('晚安：跳過就沒有抱玩偶', (await bedAttr(page, 'data-doll')) === '' && (await page.locator('[data-testid=bed-doll]').count()) === 0)
    await settle(page)
    const lamp = await boxOf(page, '[data-testid=ui-bed-lamp]')
    await app.tap(lamp.cx, lamp.cy)
    await page.waitForTimeout(150)
    check('晚安（玩完 1–2 次）：還沒有夜燈投影', (await bedAttr(page, 'data-ceiling')) === 'stars' && (await page.locator('[data-testid=ui-bed-lamp].proj').count()) === 0)
    await close(app, '晚安 跳過玩偶')
  }
  {
    // 點一下玩偶就自己飛到懷裡（3 歲）
    const app = await enter('bedtime', { age: '3', plays: 1, settings: { soundOn: false } })
    const { page } = app
    await toAfterPajamas(app, 'doll')
    await page.waitForTimeout(300)
    const dino = await boxOf(page, '[data-testid=ui-bed-doll-dino]')
    await app.tap(dino.cx, dino.cy)
    check('晚安：點一下玩偶就抱到', await waitFor(page, () => document.querySelector('[data-testid=bed]')?.dataset.doll === 'dino', null, 2000))
    // 抱的動作還在演時點故事書：不會搶步驟
    const book = await boxOf(page, '[data-testid=ui-bed-book]')
    await app.tap(book.cx, book.cy)
    check('晚安：寵物還在抱的時候點故事書不會搶步驟', (await bedAttr(page, 'data-story')) === '')
    check('晚安：抱好之後輪到選故事', await waitStep(page, 'story'))
    await close(app, '晚安 點玩偶')
  }
  {
    const app = await enter('bedtime', { plays: 3, ctxOpts: { reducedMotion: 'reduce' } })
    const { page } = app
    await toAfterPajamas(app, 'doll')
    await page.waitForTimeout(200)
    const pet = await boxOf(page, '[data-testid=bed-pet]')
    await app.dragTo(await boxOf(page, '[data-testid=ui-bed-doll-bear]'), { x: pet.cx, y: pet.cy + 26 })
    check('晚安 減少動態：抱得到玩偶', await waitFor(page, () => document.querySelector('[data-testid=bed]')?.dataset.doll === 'bear', null, 2000))
    await waitStep(page, 'story')
    check('晚安 減少動態：睡得著', await storyToAsleep(app))
    await settle(page)
    const lamp = await boxOf(page, '[data-testid=ui-bed-lamp]')
    await app.tap(lamp.cx, lamp.cy)
    await page.waitForTimeout(300)
    check('晚安 減少動態：投影換得了、魚不游', (await bedAttr(page, 'data-ceiling')) === 'sea' && (await page.locator('.bed-fish').first().evaluate((el) => getComputedStyle(el).animationName)) === 'none')
    await shot(page, 'bed-reduced-sea')
    await leave(app, '晚安 減少動態（有新玩具）')
    await close(app, '晚安 減少動態（有新玩具）')
  }
}

async function bedtimeExtras() {
  // 搖籃曲與音效開關；3 歲的玩法：手指直接刷、點睡衣
  for (const on of [true, false]) {
    const app = await enter('bedtime', { age: '3', settings: on ? {} : { soundOn: false } })
    const { page } = app
    await brushTeeth(app, { direct: true })
    check(`晚安${on ? '' : '（音效關）'}：手指直接在嘴巴上刷也可以`, await waitStep(page, 'pajamas'))
    await page.waitForTimeout(300)
    const pj = await boxOf(page, '[data-testid=ui-bed-pajamas]')
    await app.tap(pj.cx, pj.cy)
    check(`晚安${on ? '' : '（音效關）'}：點睡衣就自己穿上`, await waitFor(page, () => !!document.querySelector('[data-testid=bed-cap]'), null, 2000))
    await waitStep(page, 'story')
    const o0 = await osc(page)
    const song = await boxOf(page, '[data-testid=bed-song]')
    await app.tap(song.cx, song.cy)
    await page.waitForTimeout(300)
    const d = (await osc(page)) - o0
    check(`晚安：搖籃曲${on ? '有聲音' : '在音效關掉時不響'}`, on ? d >= 40 : d === 0, String(d))
    check('晚安：唱歌時有音符', (await page.locator('[data-testid=bed-notes]').count()) === 1)
    if (on) await shot(page, 'bed-song')
    check('晚安：唱完輪到關燈', await waitStep(page, 'lamp', 15000))
    if (on) {
      // 再玩一次：從刷牙開始、燈打開
      const lamp = await boxOf(page, '[data-testid=ui-bed-lamp]')
      await app.tap(lamp.cx, lamp.cy)
      await waitStep(page, 'asleep')
      await page.getByTestId('play-again').click()
      check('晚安：再玩一次從刷牙開始、燈打開', (await bedStep(page)) === 'brush' && (await bedAttr(page, 'data-dark')) === '0' && (await page.locator('[data-testid=bed-cap]').count()) === 0)
    }
    await close(app, `晚安 搖籃曲${on ? '' : '（音效關）'}`)
  }
  // 唱到一半離開：計時器清乾淨、不會壞
  {
    const app = await enter('bedtime')
    const { page } = app
    await brushTeeth(app)
    await waitStep(page, 'pajamas')
    await page.waitForTimeout(300)
    const pj = await boxOf(page, '[data-testid=ui-bed-pajamas]')
    await app.tap(pj.cx, pj.cy)
    await waitStep(page, 'story')
    const song = await boxOf(page, '[data-testid=bed-song]')
    await app.tap(song.cx, song.cy)
    await page.waitForTimeout(600)
    await leave(app, '晚安 唱到一半離開')
    check('晚安 中途離開：不送禮物', !(await settings(page)).playDaily?.done.includes('bedtime'))
    await close(app, '晚安 唱到一半離開')
  }
  // 三種寵物、減少動態
  for (const species of ['rabbit', 'tiger']) {
    const app = await enter('bedtime', { species, ctxOpts: species === 'tiger' ? { reducedMotion: 'reduce' } : {} })
    const { page } = app
    check(`晚安：${species} 是孩子自己的寵物`, (await attr(page, '[data-testid=bed-pet] [data-testid=companion]', 'data-species')) === species)
    await brushTeeth(app)
    await waitStep(page, 'pajamas')
    await page.waitForTimeout(300)
    const pj = await boxOf(page, '[data-testid=ui-bed-pajamas]')
    await app.tap(pj.cx, pj.cy)
    await waitStep(page, 'story')
    const book = await boxOf(page, '[data-testid=ui-bed-book]')
    await app.tap(book.cx, book.cy)
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(150)
      const s = page.locator('[data-testid=bed-story]')
      if (!(await s.count())) break
      const b = await boxOf(page, '[data-testid=bed-story]')
      await app.tap(b.cx, b.cy)
    }
    await waitStep(page, 'lamp', 5000)
    const lamp = await boxOf(page, '[data-testid=ui-bed-lamp]')
    await app.tap(lamp.cx, lamp.cy)
    check(`晚安：${species} 睡得著${species === 'tiger' ? '（減少動態）' : ''}`, await waitStep(page, 'asleep'))
    await page.waitForTimeout(1500)
    await shot(page, `bed-${species}-asleep`)
    await close(app, `晚安 ${species}`)
  }
}

// ONLY=doctor / bedtime 跑一個地方；ONLY=doctor-toys / bedtime-toys 只跑那個地方的新玩具（改程式時省時間）
const want = (place, toys) => !ONLY || ONLY === place || ONLY === `${place}-${toys ? 'toys' : 'base'}`
try {
  if (want('doctor', false)) {
    for (const [tag, vp] of Object.entries(SIZES)) await doctorSize(tag, vp)
    await doctorAge3()
    await doctorAge45()
    await doctorAge67()
    await doctorExtras()
  }
  if (want('doctor', true)) {
    for (const [tag, vp] of Object.entries(SIZES)) await doctorXray(tag, vp)
    await doctorToyExtras()
  }
  if (want('bedtime', false)) {
    for (const [tag, vp] of Object.entries(SIZES)) await bedtimeSize(tag, vp)
    await bedtimeExtras()
  }
  if (want('bedtime', true)) {
    for (const [tag, vp] of Object.entries(SIZES)) await bedtimeToys(tag, vp)
    await bedtimeToyExtras()
  }
} finally {
  await browser.close()
}
console.log(`${IS_WEBKIT ? 'WebKit' : 'Chromium'}：${state.failed === 0 ? '全部通過' : `${state.failed} 項失敗`}`)
process.exit(state.failed === 0 ? 0 : 1)
