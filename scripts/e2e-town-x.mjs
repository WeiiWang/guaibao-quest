// v8.4 線 X E2E：寵物醫院（doctor）與晚安小屋（bedtime）。
// 寵物醫院：三種尺寸看完一次（拖一次、點一次）、禮物、再看一次換下一個毛病、四種毛病輪一圈、
//   3 歲馬上發亮 / 4–5 歲 4 秒後發亮 / 6–7 歲不亮且選錯只說「不是這裡」、聽診器的心跳聲與音效開關、三種寵物、離開後計時器清乾淨。
// 晚安小屋：三種尺寸走完刷牙 → 睡衣 → 故事 → 關燈 → 睡著 → 點牠翻身說夢話、搖籃曲與音效開關、手勢提示、
//   不改寵物資料、再玩一次、離開後計時器清乾淨。
// 毛病依日期輪替：測試讀畫面上的 data-ailment 決定要用哪些工具，不寫死某一天的結果。
// 用法：先啟動 dev server（pnpm exec vite --port 5201 --strictPort），再
//   BASE_URL=http://localhost:5201 node scripts/e2e-town-x.mjs       （E2E_BROWSER=webkit 改用 WebKit）
//   想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-town-x.mjs（不要放 repo 裡）
//   只跑一個：ONLY=doctor 或 ONLY=bedtime
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
const STEPS = { sneeze: ['thermo', 'spoon'], tummy: ['stetho', 'spoon'], knee: ['thermo', 'bandage'], throat: ['light', 'spoon'] }
const TOOLS = ['thermo', 'stetho', 'light', 'bandage', 'spoon']

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
async function enter(game, { size = SIZES.land, age, species, settings: extra = {}, ctxOpts = {} } = {}) {
  const app = await freshApp(browser, size, { ctxOpts: { ...touchOpts(size), ...ctxOpts }, noFavorite: true })
  const patch = { ...extra }
  if (age) patch.ageBand = age
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
  await page.waitForTimeout(550)
  await page.getByTestId('play-gift').click()
  const again = await boxOf(page, '[data-testid=play-again]')
  check(`[${tag}] 醫院：再看一次的按鈕夠大、在畫面內`, again.width >= 56 && again.height >= 56 && inView(again, vp))
  check(`[${tag}] 醫院：再看一次不壓寵物`, !overlap(again, pet))
  await shot(page, `doc-${tag}-4-again`)
  await page.getByTestId('play-again').click()
  const next = AILMENTS[(AILMENTS.indexOf(ailment) + 1) % 4]
  check(`[${tag}] 醫院：再看一次換下一個毛病`, (await docAttr(page, 'data-ailment')) === next && (await docAttr(page, 'data-step')) === '0', `${ailment} → ${await docAttr(page, 'data-ailment')}`)
  await treat(app)
  await page.waitForTimeout(2200)
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

  // 四種毛病輪一圈
  const seen = []
  for (let i = 0; i < 4; i++) {
    const a = await docAttr(page, 'data-ailment')
    seen.push(a)
    if (a === 'knee') check('醫院：擦傷畫在膝蓋上（淡粉紅，沒有血）', (await page.locator('[data-testid=doc-symptom].doc-sym-knee').count()) === 1)
    await treat(app)
    if (a === 'knee') {
      check('醫院：OK 繃貼上去了、擦痕蓋住', (await page.locator('[data-testid=doc-bandage-on]').count()) === 1 && (await page.locator('[data-testid=doc-symptom]').count()) === 0)
      await shot(page, 'doc-knee-bandage')
    }
    check(`醫院：${a} 看得完`, (await docAttr(page, 'data-done')) === '1')
    // 第一次看完會送禮物（說完話才跳出來）：等它出來再收下，不然會蓋住下一回
    if (i === 0 && (await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 }).then(() => true, () => false))) {
      await page.waitForTimeout(550)
      await page.getByTestId('play-gift').click()
    }
    await page.waitForSelector('[data-testid=play-again]')
    await page.getByTestId('play-again').click()
  }
  check('醫院：四種毛病都輪到', new Set(seen).size === 4, seen.join(','))
  check('醫院：輪完回到第一個', (await docAttr(page, 'data-ailment')) === seen[0])
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
  await page.waitForTimeout(550)
  await page.getByTestId('play-gift').click()

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

try {
  if (ONLY !== 'bedtime') {
    for (const [tag, vp] of Object.entries(SIZES)) await doctorSize(tag, vp)
    await doctorAge3()
    await doctorAge45()
    await doctorAge67()
    await doctorExtras()
  }
  if (ONLY !== 'doctor') {
    for (const [tag, vp] of Object.entries(SIZES)) await bedtimeSize(tag, vp)
    await bedtimeExtras()
  }
} finally {
  await browser.close()
}
console.log(`${IS_WEBKIT ? 'WebKit' : 'Chromium'}：${state.failed === 0 ? '全部通過' : `${state.failed} 項失敗`}`)
process.exit(state.failed === 0 ? 0 : 1)
