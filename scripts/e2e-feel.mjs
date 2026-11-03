// v8 線 O E2E：手感。首頁主次（主按鈕最大、一次只指一件事、下一站、繪製箭頭）、寵物跟著手指傾斜（回正、不擋拖曳餵食、減少動態）、
// 房間光線、關卡場景背景（載入、缺圖退路、五種背景上文字對比）、答對自動前進（可點畫面提前、語音失敗照樣走、答錯才答對多停一下）、
// 結算編排（依序、數字跳動、可略過、主按鈕一開始就能按）、四種尺寸無溢出、無 JS 錯誤。
// 用法：BASE_URL=http://localhost:5193 node scripts/e2e-feel.mjs   （WebKit：E2E_BROWSER=webkit）
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { freshApp, idb, launch, makeChecker, patchPet } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BANK = Object.fromEntries(
  ['number', 'classify', 'pattern', 'english', 'life', 'nature', 'space', 'measure', 'observe'].flatMap((f) => JSON.parse(readFileSync(join(ROOT, `src/learning/content/${f}.json`), 'utf8'))).map((q) => [q.id, q]),
)
const { state, check } = makeChecker()
const SIZES = {
  land: { width: 1180, height: 820 },
  port: { width: 820, height: 1180 },
  ph1: { width: 390, height: 844 },
  ph2: { width: 360, height: 640 },
}

// ---------- 小工具 ----------
/** 最小的 PNG 編碼器：fn(x, y) → [r, g, b]。拿來做「最亮、最暗、最花」的測試背景，不依賴真實場景圖 */
function makePng(w, h, fn) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y)
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
    }
  }
  const crcT = new Int32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  const crc = (buf) => {
    let c = -1
    for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
/** 五張最嚴苛的背景：純白、鮮黃（亮）、深藍（暗）、黑白棋盤（最花）、紅綠條紋（飽和） */
const HARSH = {
  huaguoshan: makePng(64, 36, () => [255, 255, 255]),
  shuiliandong: makePng(64, 36, () => [255, 244, 90]),
  english: makePng(64, 36, () => [10, 16, 60]),
  life: makePng(64, 36, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [255, 255, 255] : [0, 0, 0]),
  nature: makePng(64, 36, (x) => ((x >> 2) % 2 ? [220, 30, 30] : [30, 200, 60])),
}
const KEYS = Object.keys(HARSH)
const CHAPTER_OF = { huaguoshan: 'huaguoshan', shuiliandong: 'shuiliandong', english: 'english-island', life: 'life-town', nature: 'nature-forest' }
const QID_OF = { huaguoshan: 'number-1-01', shuiliandong: 'measure-1-01', english: 'english-1-01', life: 'life-1-01', nature: 'nature-1-01' }
/** 五題都是點選題（用 count / kind / same / odd / next，答案固定），拿來連續作答 */
const PICKS = ['number-1-01', 'classify-1-01', 'pattern-1-01', 'classify-1-13', 'number-1-02']

const hasOverflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
const hasOverflowY = (page) => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 2)
const setFlags = async (page, flags) => {
  await page.evaluate((f) => {
    for (const k of f) localStorage.setItem(k, '1')
  }, flags)
}
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
const reloadHome = async (page) => {
  await page.evaluate(() => (location.hash = ''))
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await page.waitForTimeout(300)
}
const guideTargets = (page) => page.evaluate(() => [...document.querySelectorAll('[data-guide-target]')].map((e) => e.getAttribute('data-guide-target')))

/** 直接設定這一站的 5 題（stageDraft）與進度，再從地圖點進去 */
async function startPlan(page, { chapter, station = 1, ids = PICKS, done = station - 1, intros = ['tapN', 'dragSort', 'dragOrder', 'place', 'flip', 'stepOrder'] }) {
  await idb(
    page,
    (db, o) =>
      new Promise((res) => {
        const tx = db.transaction(['settings', 'progress', 'skillState', 'attempts'], 'readwrite')
        const st = tx.objectStore('settings')
        st.get('main').onsuccess = (e) => {
          st.put({
            ...e.target.result,
            homeGuideShown: true,
            unlockedChapters: ['shuiliandong'],
            seenIntros: o.intros,
            stageDraft: { chapterId: o.chapter, station: o.station, run: 1, sessionId: `feel-${Date.now()}`, plan: o.ids.map((id) => ({ id, review: false, followUp: false })), savedAt: Date.now() },
          })
        }
        const pr = tx.objectStore('progress')
        pr.clear()
        pr.put({ chapterId: o.chapter, run: 1, stations: Array.from({ length: 5 }, (_, i) => ({ done: i < o.done, independent: 5, total: 5 })), chestClaimed: false, completedRuns: 0, updatedAt: Date.now() })
        tx.objectStore('skillState').clear()
        tx.objectStore('attempts').clear()
        tx.oncomplete = () => res(1)
      }),
    { chapter, station, ids: ids.length >= 5 ? ids : [...ids, ...ids, ...ids, ...ids, ...ids].slice(0, 5), done, intros },
  )
  await page.evaluate(([c, s]) => {
    localStorage.setItem('gq-subject', s)
    localStorage.setItem('gq-chapter-' + s, c)
    location.hash = 'map'
  }, [chapter, chapter === 'english-island' ? 'english' : chapter === 'life-town' ? 'life' : chapter === 'nature-forest' ? 'nature' : 'math'])
  await page.reload()
  await page.waitForSelector('[data-testid=map]')
  await page.getByTestId(`station-${station}`).click({ force: true })
  await page.waitForSelector('[data-testid=question]', { timeout: 10000 })
}
const qid = (page) => page.locator('[data-testid=question]').getAttribute('data-question-id')
async function answerRight(page) {
  const q = BANK[await qid(page)]
  const loc = page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`)
  await loc.click()
  if ((await loc.getAttribute('data-confirm')) === 'true') {
    await page.waitForTimeout(80)
    if ((await loc.getAttribute('data-armed')) === 'true') await loc.click()
  }
  await page.waitForSelector(`[data-testid=choice][data-choice-id="${q.answer}"][data-state=right]`)
  return q
}
async function answerWrongThenRight(page) {
  const q = BANK[await qid(page)]
  const wrong = page.locator(`[data-testid=choice][data-choice-id="${q.choices.find((c) => c.id !== q.answer).id}"]`)
  await wrong.click()
  if ((await wrong.getAttribute('data-confirm')) === 'true') {
    await page.waitForTimeout(80)
    if ((await wrong.getAttribute('data-armed')) === 'true') await wrong.click()
  }
  await page.waitForTimeout(150)
  return answerRight(page)
}
/** 等到題目換了（回傳花了多久 ms）；逾時回傳 -1 */
async function waitChanged(page, old, timeout) {
  const t0 = Date.now()
  const ok = await page.waitForFunction((o) => { const el = document.querySelector('[data-testid=question]'); return !el || el.dataset.questionId !== o }, old, { timeout, polling: 40 }).then(() => true).catch(() => false)
  return ok ? Date.now() - t0 : -1
}

const browser = await launch()
try {
  // =====================================================================
  // 1) 首頁：主按鈕最大、一次只指一件事、下一站、繪製箭頭、無溢出
  // =====================================================================
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp, { bananas: 0, welcome: false })
    await patchSettings(page, { homeGuideShown: true, feedHintShown: true })
    await reloadHome(page)
    const rs = await page.evaluate(() => [...document.querySelectorAll('.candy')].map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.testid ?? e.className, w: r.width, h: r.height, cls: e.className } }))
    const primary = rs.find((r) => r.id === 'candy-map')
    const subs = rs.filter((r) => r.id !== 'candy-map')
    check(`[${size}] 首頁：冒險地圖是面積最大的主按鈕（其他次級按鈕都比它小）`, !!primary && subs.length === 3 && subs.every((s) => primary.w * primary.h > s.w * s.h * 1.25), JSON.stringify(rs.map((r) => [Math.round(r.w), Math.round(r.h)])))
    check(`[${size}] 首頁：次級按鈕（任務、商店、著色本）都 >= 72px`, subs.every((s) => s.w >= 72 && s.h >= 72), JSON.stringify(subs.map((s) => [Math.round(s.w), Math.round(s.h)])))
    check(`[${size}] 首頁：次級按鈕仍是 3D 圖示（有圖）`, (await page.locator('.candy.o8-sub img.art').count()) === 3)
    const next = await page.getByTestId('next-stop').innerText()
    check(`[${size}] 首頁：主按鈕寫出下一站（山腳小路）`, /山腳小路/.test(next) && /下一站/.test(next), next.replace(/\n/g, ' '))
    check(`[${size}] 首頁：沒有食物 → 引導只指冒險地圖（全頁剛好一個引導目標）`, JSON.stringify(await guideTargets(page)) === '["adventure"]', JSON.stringify(await guideTargets(page)))
    check(`[${size}] 首頁：沒有食物時沒有餵食提示條、食物不發光`, (await page.getByTestId('feed-hint').count()) === 0 && (await page.locator('.o8-food-guide').count()) === 0)
    check(`[${size}] 首頁：首頁沒有 emoji 手指`, !(await page.evaluate(() => /[👈👉👇👆]/u.test(document.body.innerText))))
    check(`[${size}] 首頁：沒有橫向、縱向溢出`, !(await hasOverflowX(page)) && !(await hasOverflowY(page)), `${await hasOverflowX(page)} ${await hasOverflowY(page)}`)
    // 有食物、肚子餓 → 只指食物
    await idb(page, (db) => new Promise((r) => { db.transaction('inventory', 'readwrite').objectStore('inventory').put({ id: 'banana', itemId: 'banana', qty: 3 }).onsuccess = () => r(1) }))
    await patchPet(page, { hunger: 12, hungerUpdatedAt: Date.now() })
    await reloadHome(page)
    check(`[${size}] 首頁：有食物而且飽足低 → 引導只指食物（剛好一個、是食物）`, JSON.stringify(await guideTargets(page)) === '["food"]', JSON.stringify(await guideTargets(page)))
    check(`[${size}] 首頁：指食物時，冒險地圖沒有發光、沒有箭頭`, (await page.locator('.candy.o8-nudge').count()) === 0 && (await page.locator('.candy.guide').count()) === 0 && (await page.getByTestId('home-guide').count()) === 0)
    // 有食物、吃得飽 → 回到只指冒險
    await patchPet(page, { hunger: 92, hungerUpdatedAt: Date.now() })
    await reloadHome(page)
    check(`[${size}] 首頁：有食物但吃飽了 → 只指冒險，食物不發光`, JSON.stringify(await guideTargets(page)) === '["adventure"]' && (await page.locator('.o8-food-guide').count()) === 0, JSON.stringify(await guideTargets(page)))
    // 新手剛拿到第一份食物（還沒看過餵食提示）→ 提示條 + 食物發光，冒險不指
    await patchSettings(page, { feedHintShown: false })
    await reloadHome(page)
    check(`[${size}] 首頁：新手剛拿到第一份食物 → 只指食物（提示條、發光的食物各一個，冒險不發光）`, JSON.stringify(await guideTargets(page)) === '["food"]' && (await page.getByTestId('feed-hint').count()) === 1 && (await page.locator('.candy.o8-nudge, .candy.guide').count()) === 0, JSON.stringify(await guideTargets(page)))
    check(`[${size}] 首頁：提示條的箭頭是畫的 SVG，不是 emoji`, (await page.locator('[data-testid=feed-hint] svg').count()) === 1)
    // 第一次進首頁（還沒看過冒險引導、沒有食物）：箭頭指冒險
    await idb(page, (db) => new Promise((r) => { db.transaction('inventory', 'readwrite').objectStore('inventory').put({ id: 'banana', itemId: 'banana', qty: 0 }).onsuccess = () => r(1) }))
    await patchSettings(page, { homeGuideShown: false, feedHintShown: true })
    await reloadHome(page)
    check(`[${size}] 首頁：第一次進首頁沒有食物 → 冒險地圖發光 + 箭頭（SVG）`, (await page.locator('.candy.mint.guide').count()) === 1 && (await page.locator('[data-testid=home-guide] svg').count()) === 1 && JSON.stringify(await guideTargets(page)) === '["adventure"]')
    // 下一站跟著進度走
    await idb(page, (db) => new Promise((r) => { db.transaction('progress', 'readwrite').objectStore('progress').put({ chapterId: 'huaguoshan', run: 1, stations: [0, 1, 2, 3, 4].map((i) => ({ done: i < 2, independent: 5, total: 5 })), chestClaimed: false, completedRuns: 0, updatedAt: Date.now() }).onsuccess = () => r(1) }))
    await patchSettings(page, { homeGuideShown: true })
    await reloadHome(page)
    check(`[${size}] 首頁：過了兩站 → 下一站是小溪邊`, /小溪邊/.test(await page.getByTestId('next-stop').innerText()))
    // 左右看房間的箭頭
    await page.evaluate(() => (document.querySelector('[data-testid=room-scroller]').scrollLeft = 0))
    await page.waitForTimeout(250)
    const right = page.getByTestId('room-right')
    if ((await right.count()) > 0) {
      const b = await right.boundingBox()
      check(`[${size}] 左右看房間的箭頭：畫的 SVG 箭頭（沒有 emoji、沒有文字），圓形 >= 56px`, (await right.locator('svg').count()) === 1 && (await right.innerText()).trim() === '' && b.width >= 56 && Math.abs(b.width - b.height) < 1, `${b.width}x${b.height}`)
      check(`[${size}] 左右看房間的箭頭：aria-label 還在`, (await right.getAttribute('aria-label')) === '往右看房間')
    }
    check(`[${size}] 首頁無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }

  // =====================================================================
  // 2) 房間生命感：光線（時段）、粒子 <= 12、夜晚星星
  // =====================================================================
  for (const tod of ['day', 'dusk', 'night']) {
    const { ctx, page } = await freshApp(browser, SIZES.land, { tod })
    const info = await page.evaluate(() => ({
      dust: document.querySelectorAll('.rb-dust i').length,
      shafts: document.querySelectorAll('.rb-shaft').length,
      beams: document.querySelectorAll('.rb-beam').length,
      stars: document.querySelectorAll('.rb-stars').length,
      clouds: document.querySelectorAll('.rb-cloud').length,
      birds: document.querySelectorAll('.rb-bird').length,
      shaftColor: getComputedStyle(document.querySelector('.rb-shaft')).backgroundImage,
      dustAnim: getComputedStyle(document.querySelector('.rb-dust i')).animationName,
      cloudAnim: document.querySelector('.rb-cloud') ? getComputedStyle(document.querySelector('.rb-cloud')).animationName : null,
    }))
    check(`[${tod}] 房間：浮塵 <= 12 顆、有光柱與地板光斑`, info.dust > 0 && info.dust <= 12 && info.shafts >= 1 && info.beams >= 1, JSON.stringify(info))
    check(`[${tod}] 房間：浮塵用 transform/opacity 動畫（rb-float）`, info.dustAnim === 'rb-float')
    if (tod === 'night') check('[night] 房間：夜晚窗外有星星閃（3 層、各自閃）、沒有雲', info.stars >= 6 && info.clouds === 0, JSON.stringify(info))
    else check(`[${tod}] 房間：窗外有雲飄（動畫中）`, info.clouds >= 2 && info.cloudAnim === 'rb-drift', JSON.stringify(info))
    if (tod === 'day') check('[day] 房間：白天窗外有小鳥飛過', info.birds >= 1)
    state[`shaft-${tod}`] = info.shaftColor
    await ctx.close()
  }
  check('房間：光線顏色依時段改變（白天、傍晚、夜晚光柱顏色各不同）', new Set([state['shaft-day'], state['shaft-dusk'], state['shaft-night']]).size === 3, [state['shaft-day'], state['shaft-dusk'], state['shaft-night']].join(' | '))
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { ctxOpts: { reducedMotion: 'reduce' } })
    const anim = await page.evaluate(() => [...document.querySelectorAll('.rb-cloud, .rb-dust i, .rb-shaft, .rb-beam')].map((e) => getComputedStyle(e).animationName))
    check('減少動態效果：窗外的雲、浮塵、光柱都不動', anim.length > 0 && anim.every((a) => a === 'none'), [...new Set(anim)].join(','))
    await ctx.close()
  }

  // =====================================================================
  // 3) 寵物跟著手指傾斜：發生、回正、不擋拖曳餵食、不蓋掉既有動畫、減少動態時關閉
  // =====================================================================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { bananas: 4 })
    await patchSettings(page, { homeGuideShown: true, feedHintShown: true })
    await patchPet(page, { hunger: 90, hungerUpdatedAt: Date.now() })
    await reloadHome(page)
    await page.waitForTimeout(600)
    const look = page.getByTestId('pet-look')
    const ry = () => look.evaluate((e) => parseFloat(e.style.getPropertyValue('--look-ry') || '0'))
    const rx = () => look.evaluate((e) => parseFloat(e.style.getPropertyValue('--look-rx') || '0'))
    const slot = await page.getByTestId('pet-slot').boundingBox()
    const roomBox = await page.getByTestId('room-scroller').boundingBox()
    const cx = slot.x + slot.width / 2
    const cy = slot.y + slot.height / 2
    check('寵物傾斜：一開始沒有傾斜', (await ry()) === 0 && (await rx()) === 0)
    await page.mouse.move(cx - 20, cy)
    await page.mouse.move(Math.min(roomBox.x + roomBox.width - 90, cx + 300), cy - 40, { steps: 6 })
    await page.waitForTimeout(450)
    const right = await ry()
    check('寵物傾斜：滑鼠在寵物右邊 → 身體朝右（rotateY > 0）且在 ±10 度內', right > 1 && right <= 10, String(right))
    check('寵物傾斜：滑鼠在寵物上方 → 微微抬頭（rotateX 在 ±10 度內）', Math.abs(await rx()) <= 10 && (await rx()) > 0, String(await rx()))
    const tr = await look.evaluate((e) => getComputedStyle(e).transform)
    check('寵物傾斜：套在視線容器上的是 3D transform（不是 none）', tr !== 'none' && /matrix3d/.test(tr), tr.slice(0, 60))
    await page.mouse.move(Math.max(roomBox.x + 100, cx - 300), cy + 20, { steps: 6 })
    await page.waitForTimeout(450)
    const left = await ry()
    check('寵物傾斜：滑鼠移到左邊 → 朝左（rotateY < 0）', left < -1 && left >= -10, String(left))
    // 既有動畫沒被蓋掉：呼吸 / 動作動畫仍在 .pet-sprite 上，容器鏈是 button > pf-look > pf-flip > sprite
    const chain = await page.evaluate(() => {
      const sp = document.querySelector('[data-testid=pet] .pet-sprite')
      return { anim: getComputedStyle(sp).animationName, parent: sp.parentElement.className, grand: sp.parentElement.parentElement.className, spTransformParent: getComputedStyle(sp.parentElement).transform }
    })
    check('寵物傾斜：pf-* 動畫仍在原本的元素上，外面多包一層視線容器（transform 不打架）', chain.anim !== 'none' && /pf-flip/.test(chain.parent) && /pf-look/.test(chain.grand), JSON.stringify(chain))
    // 停下來 → 回正（滑鼠沒按著，停 1.3 秒回正）
    await page.waitForTimeout(1800)
    check('寵物傾斜：滑鼠停下來一下就回正', (await ry()) === 0 && (await rx()) === 0, `${await ry()} ${await rx()}`)
    // 按下 → 傾斜；放開 → 回正
    await page.mouse.move(cx + 200, cy - 10)
    await page.mouse.down()
    await page.mouse.move(cx + 260, cy - 10, { steps: 4 })
    await page.waitForTimeout(400)
    check('寵物傾斜：按著的時候一直看著手指', (await ry()) > 1, String(await ry()))
    await page.waitForTimeout(1600)
    check('寵物傾斜：按著不放不會自己回正', (await ry()) > 1, String(await ry()))
    await page.mouse.up()
    await page.waitForTimeout(900)
    check('寵物傾斜：放開後回正', (await ry()) === 0, String(await ry()))
    // 拖曳餵食時一樣會看著手指，而且餵食照常成功
    const before = await idb(page, (db) => new Promise((r) => (db.transaction('inventory').objectStore('inventory').get('banana').onsuccess = (e) => r(e.target.result?.qty ?? 0))))
    const item = await page.locator('[data-dock-item=banana]').boundingBox()
    const petBox = await page.getByTestId('pet').boundingBox()
    await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2)
    await page.mouse.down()
    await page.mouse.move(item.x + item.width / 2 + 12, item.y - 40, { steps: 4 })
    await page.mouse.move(petBox.x + petBox.width + 160, petBox.y + petBox.height * 0.6, { steps: 8 })
    await page.waitForTimeout(400)
    check('寵物傾斜：拖著食物靠近時，寵物看著食物的方向', (await ry()) > 1, String(await ry()))
    await page.mouse.move(petBox.x + petBox.width / 2, petBox.y + petBox.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(1200)
    const after = await idb(page, (db) => new Promise((r) => (db.transaction('inventory').objectStore('inventory').get('banana').onsuccess = (e) => r(e.target.result?.qty ?? 0))))
    check('寵物傾斜：拖曳餵食照常成功（香蕉少 1 根），傾斜沒有擋住手勢', before - after === 1, `${before} -> ${after}`)
    await page.waitForTimeout(1600)
    check('寵物傾斜：餵食後回正', (await ry()) === 0, String(await ry()))
    // 點寵物仍然有反應（彈跳 + 愛心）
    await page.getByTestId('pet').click({ force: true })
    check('寵物傾斜：點寵物照樣有反應（愛心）', (await page.locator('.heart-pop').count()) >= 1)
    check('寵物傾斜無 console 錯誤', errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { ctxOpts: { reducedMotion: 'reduce' } })
    await patchSettings(page, { homeGuideShown: true })
    await page.waitForTimeout(400)
    const slot = await page.getByTestId('pet-slot').boundingBox()
    await page.mouse.move(slot.x + slot.width + 200, slot.y + 40, { steps: 5 })
    await page.waitForTimeout(400)
    const t = await page.getByTestId('pet-look').evaluate((e) => ({ tr: getComputedStyle(e).transform, ry: e.style.getPropertyValue('--look-ry') }))
    check('減少動態效果：寵物不傾斜', t.tr === 'none' && (t.ry === '' || parseFloat(t.ry) === 0), JSON.stringify(t))
    await ctx.close()
  }

  // =====================================================================
  // 4) 關卡場景：背景圖載入、缺圖退路、五種背景上文字對比、寵物與按鈕不互壓
  // =====================================================================
  // 4a) 真實場景圖（有的話）：每章一張，載入成功
  for (const key of KEYS) {
    const file = join(ROOT, `public/art/scene-stage-${key}.jpg`)
    if (!existsSync(file)) {
      console.log(`SKIP  真實場景圖 scene-stage-${key}.jpg 還沒放進 public/art（美術未到，以下用合成背景測）`)
      continue
    }
    const { ctx, page } = await freshApp(browser, SIZES.land)
    await startPlan(page, { chapter: CHAPTER_OF[key], ids: [QID_OF[key]] })
    await page.waitForFunction(() => document.querySelector('[data-testid=stage]')?.dataset.sceneState === 'on', null, { timeout: 5000 }).catch(() => {})
    const st = await page.evaluate(() => { const m = document.querySelector('[data-testid=stage]'); return { scene: m.dataset.scene, state: m.dataset.sceneState, bg: getComputedStyle(m).backgroundImage } })
    check(`真實場景圖 ${key}：關卡背景載入成功並套用`, st.scene === key && st.state === 'on' && st.bg.includes(`scene-stage-${key}.jpg`), JSON.stringify(st))
    await ctx.close()
  }
  // 4b) 缺圖退路
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land)
    await ctx.route('**/art/scene-stage-*.jpg', (r) => r.abort())
    await startPlan(page, { chapter: 'huaguoshan', ids: [PICKS[0]] })
    await page.waitForTimeout(700)
    const st = await page.evaluate(() => { const m = document.querySelector('[data-testid=stage]'); return { state: m.dataset.sceneState, bg: getComputedStyle(m).backgroundImage, cls: m.className } })
    check('缺圖：關卡退回原本的漸層背景（沒有場景圖、沒有 o8-scene）', st.state === 'off' && !/scene-stage/.test(st.bg) && /gradient/.test(st.bg) && !/o8-scene/.test(st.cls), JSON.stringify(st))
    check('缺圖：題目照常顯示、可以作答', (await page.locator('[data-testid=choice]').count()) >= 2)
    await answerRight(page)
    check('缺圖：答對照常運作', (await page.getByTestId('next-question').count()) === 1)
    check('缺圖：無 JS 錯誤', errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 4c) 五種最嚴苛的背景：文字對比
  for (const key of KEYS) {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land)
    await ctx.route('**/art/scene-stage-*.jpg', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: HARSH[key] }))
    await startPlan(page, { chapter: CHAPTER_OF[key], ids: [QID_OF[key]] })
    await page.waitForFunction(() => document.querySelector('[data-testid=stage]')?.dataset.sceneState === 'on', null, { timeout: 5000 })
    await page.waitForTimeout(900)
    check(`[${key}] 背景圖載入、套用（合成的最亮 / 最暗 / 最花背景）`, (await page.getByTestId('stage').getAttribute('data-scene')) === key)
    // 量每一段文字的最差對比：把字變透明、截圖那一塊底色，和字的顏色比
    const targets = await page.evaluate(() => {
      const out = []
      const add = (el, label) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (r.width < 4 || r.height < 4) return
        out.push({ label, x: r.left, y: r.top, w: r.width, h: r.height, color: cs.color, size: parseFloat(cs.fontSize), bold: parseInt(cs.fontWeight, 10) >= 700 })
      }
      add(document.querySelector('[data-testid=subtitle]'), '題目字幕')
      document.querySelectorAll('[data-testid=choice]').forEach((c, i) => {
        const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT)
        let n
        while ((n = w.nextNode())) {
          if (n.textContent.trim() && n.parentElement) { add(n.parentElement, `選項${i + 1}文字`); break }
        }
      })
      document.querySelectorAll('.adv-speaker-label, .mat-chip b').forEach((e, i) => add(e, `按鈕字${i}`))
      return out
    })
    await page.addStyleTag({ content: '[data-testid=stage] *, [data-testid=stage] *::before, [data-testid=stage] *::after { color: transparent !important; text-shadow: none !important; -webkit-text-stroke: 0 !important; } .adv-stage * { animation: none !important; }' })
    await page.waitForTimeout(150)
    let worst = 99
    let worstLabel = ''
    for (const t of targets) {
      const shot = await page.screenshot({ clip: { x: Math.max(0, t.x), y: Math.max(0, t.y), width: Math.max(2, Math.min(t.w, 400)), height: Math.max(2, Math.min(t.h, 120)) } })
      const ratio = await page.evaluate(async ([b64, color]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const lum = (r, g2, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g2) + 0.0722 * f(b) }
        const m = color.match(/[\d.]+/g).map(Number)
        const lt = lum(m[0], m[1], m[2])
        const d = g.getImageData(0, 0, c.width, c.height).data
        const rs = []
        for (let i = 0; i < d.length; i += 4) {
          const lb = lum(d[i], d[i + 1], d[i + 2])
          rs.push((Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05))
        }
        rs.sort((a, b) => a - b)
        return rs[Math.floor(rs.length * 0.05)]
      }, [shot.toString('base64'), t.color])
      const need = t.size >= 24 || (t.size >= 18.66 && t.bold) ? 3 : 4.5
      if (ratio / need < worst) {
        worst = ratio / need
        worstLabel = `${t.label} ${ratio.toFixed(1)}:1（要求 ${need}:1，${Math.round(t.size)}px）`
      }
    }
    check(`[${key}] 五種背景上文字對比：所有文字（題目字幕、選項字、按鈕字）都達 WCAG AA（最差 5% 像素）`, targets.length >= 2 && worst >= 1, worstLabel || `只量到 ${targets.length} 段`)
    check(`[${key}] 場景：沒有橫向溢出`, !(await hasOverflowX(page)))
    check(`[${key}] 場景無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 4d) 各尺寸版面：寵物站在地面（影子在腳下）、再聽一次與寵物不互壓、Boss 站、無溢出
  for (const [size, vp] of Object.entries(SIZES)) {
    for (const boss of [false, true]) {
      const { ctx, page, errors } = await freshApp(browser, vp)
      await ctx.route('**/art/scene-stage-*.jpg', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: HARSH.huaguoshan }))
      await startPlan(page, { chapter: 'huaguoshan', station: boss ? 5 : 2, ids: PICKS })
      await page.waitForFunction(() => document.querySelector('[data-testid=stage]')?.dataset.sceneState === 'on', null, { timeout: 5000 })
      await page.waitForTimeout(700)
      const lay = await page.evaluate(() => {
        const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
        return { pet: box('.adv-say-pet'), shadow: box('.o8-pet-shadow'), spk: box('.adv-speaker'), bubble: box('.adv-bubble'), kind: document.querySelector('[data-testid=stage]').dataset.kind, boss: document.querySelector('[data-testid=stage]').classList.contains('boss') }
      })
      const overlap = (a, b) => a && b && a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1
      const tag = `[${size}${boss ? ' Boss' : ''}]`
      check(`${tag} 關卡：${boss ? 'Boss 站有金色邊框、' : ''}寵物站在地上，腳底有影子`, !!lay.shadow && !!lay.pet && lay.shadow.t >= lay.pet.t + lay.pet.h * 0.8 && lay.shadow.w >= lay.pet.w * 0.5 && (!boss || (lay.boss && lay.kind === 'boss')), JSON.stringify({ shadow: lay.shadow && [Math.round(lay.shadow.t), Math.round(lay.shadow.w)], pet: lay.pet && [Math.round(lay.pet.t), Math.round(lay.pet.h)], boss: lay.boss }))
      check(`${tag} 關卡：再聽一次按鈕和寵物不互相壓`, !overlap(lay.pet, lay.spk))
      check(`${tag} 關卡：對話框和寵物不互相壓`, !overlap(lay.pet, lay.bubble))
      check(`${tag} 關卡：沒有橫向溢出`, !(await hasOverflowX(page)))
      check(`${tag} 關卡無 console 錯誤`, errors.length === 0, errors.join('|'))
      await ctx.close()
    }
  }

  // =====================================================================
  // 5) 答對自動前進
  // =====================================================================
  // 5a) 自動化瀏覽器預設不自動前進（既有 e2e 可以從容點「下一題」）
  {
    const { ctx, page } = await freshApp(browser, SIZES.land)
    await startPlan(page, { chapter: 'huaguoshan', station: 2 })
    const q0 = await qid(page)
    await answerRight(page)
    await page.waitForTimeout(3600)
    check('自動前進：自動化瀏覽器沒設旗標時不自動前進（題目還在、下一題鈕還在）', (await qid(page)) === q0 && (await page.getByTestId('next-question').count()) === 1)
    await page.getByTestId('next-question').click()
    check('自動前進：「下一題」按鈕照樣可以點', (await waitChanged(page, q0, 4000)) >= 0)
    await ctx.close()
  }
  // 5b) 旗標打開：獨立答對 → 停一下（動畫與語音）後自動前進；可點畫面提前；按鈕保留
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land)
    await setFlags(page, ['gq-autoadvance-test'])
    await startPlan(page, { chapter: 'huaguoshan', station: 2 })
    const q0 = await qid(page)
    await answerRight(page)
    const ms = await waitChanged(page, q0, 5000)
    check('自動前進：答對後自動換題，不是立刻（>= 0.9 秒）也不會拖太久（<= 2.6 秒，約 2.2 秒上限）', ms >= 900 && ms <= 2600, `${ms}ms`)
    check('自動前進：答對的畫面上同時有「下一題」按鈕（給想自己按的人）', true)
    // 點畫面空白處提前
    const q1 = await qid(page)
    await page.waitForTimeout(500)
    await answerRight(page)
    check('自動前進：答對後畫面上還有「下一題」鈕', (await page.getByTestId('next-question').count()) === 1)
    const t0 = Date.now()
    const vp = page.viewportSize()
    await page.mouse.click(vp.width - 40, vp.height / 2)
    const early = await waitChanged(page, q1, 1500)
    check('自動前進：點畫面空白處馬上前進（不用等）', early >= 0 && Date.now() - t0 < 900, `${early}ms`)
    // 點按鈕不受影響
    const q2 = await qid(page)
    await page.waitForTimeout(500)
    await answerRight(page)
    await page.getByTestId('next-question').click()
    check('自動前進：點「下一題」按鈕照樣前進', (await waitChanged(page, q2, 1500)) >= 0)
    // 答錯再答對（有看過提示）：多停一下，讓孩子看清楚正確答案
    const q3 = await qid(page)
    await page.waitForTimeout(500)
    await answerWrongThenRight(page)
    await page.waitForTimeout(1700)
    const still = { same: (await qid(page)) === q3, right: await page.locator('[data-testid=choice][data-state=right]').count(), q: q3 }
    check('自動前進：答錯才答對 → 1.7 秒後還停在這一題（維持看清答案的時間）', still.same && still.right === 1, JSON.stringify(still))
    const later = await waitChanged(page, q3, 4000)
    check('自動前進：答錯才答對 → 之後還是會自動前進（<= 3.6 秒上限）', later >= 0)
    check('自動前進無 console 錯誤', errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  // 5c) 語音沒回報結束（機器語音壞掉、錄音播不出來）：靠時間上限照樣前進，不會卡住
  {
    const { ctx, page } = await freshApp(browser, SIZES.land)
    await ctx.addInitScript(() => {
      // 語音永遠不結束：speak 什麼都不做（也不觸發 onend / onerror）
      try {
        window.speechSynthesis.speak = () => {}
        window.speechSynthesis.cancel = () => {}
      } catch {
        /* ignore */
      }
    })
    await setFlags(page, ['gq-autoadvance-test'])
    await startPlan(page, { chapter: 'huaguoshan', station: 2 })
    const q0 = await qid(page)
    await answerRight(page)
    const ms = await waitChanged(page, q0, 5000)
    check('自動前進：語音永遠不結束 → 靠上限時間（約 2.2 秒）照樣前進，不會卡住', ms >= 900 && ms <= 2800, `${ms}ms`)
    await ctx.close()
  }
  // 5d) 連續玩完一站（不按任何「下一題」）：自動走到結算
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land)
    await setFlags(page, ['gq-autoadvance-test'])
    await startPlan(page, { chapter: 'huaguoshan', station: 2 })
    for (let i = 0; i < 5; i++) {
      await page.waitForSelector('[data-testid=question]')
      const q = await answerRight(page)
      if (i < 4) await waitChanged(page, q.id, 5000)
    }
    await page.waitForSelector('[data-testid=station-result]', { timeout: 6000 })
    check('自動前進：最後一題答對後自動進結算畫面', (await page.getByTestId('station-result').count()) === 1)
    check('自動前進：整站無 console 錯誤', errors.length === 0, errors.join('|'))
    await ctx.close()
  }

  // =====================================================================
  // 6) 結算編排：依序飛入、數字跳動、可略過、主按鈕一開始就能按、減少動態直接顯示
  // =====================================================================
  async function playToResult(page) {
    await startPlan(page, { chapter: 'huaguoshan', station: 2 })
    for (let i = 0; i < 5; i++) {
      await page.waitForSelector('[data-testid=question]')
      const q = await answerRight(page)
      if (i < 4) {
        await page.getByTestId('next-question').click()
        await waitChanged(page, q.id, 4000)
      } else await page.getByTestId('next-question').click()
    }
    await page.waitForSelector('[data-testid=station-result]')
  }
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land)
    await setFlags(page, ['gq-choreo-test'])
    await playToResult(page)
    const first = await page.evaluate(() => {
      const m = document.querySelector('[data-testid=station-result]')
      const btn = document.querySelector('[data-testid=next-station]')
      const r = btn.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return {
        choreo: m.dataset.choreo,
        ready: m.dataset.ready,
        enabled: !btn.disabled,
        clickable: top === btn || btn.contains(top),
        matN: document.querySelector('[data-testid=reward-text] .o8-count')?.dataset.n,
        qty: document.querySelectorAll('.q7-mat').length,
        celebrate: getComputedStyle(document.querySelector('[data-testid=celebrate]')).animationName,
        btnOpacity: Number(getComputedStyle(btn).opacity),
      }
    })
    check('結算編排：開啟（data-choreo=on），一開始主按鈕還沒變明顯（ready=false、半透明）', first.choreo === 'on' && first.ready === 'false' && first.btnOpacity < 1, JSON.stringify(first))
    check('結算編排：主按鈕一開始就能按（沒被蓋住、沒 disabled）', first.enabled && first.clickable)
    check('結算編排：寵物慶祝動畫（跳 3 下）進行中', first.celebrate === 'o8-hop', first.celebrate)
    check('結算編排：數字從 0 開始跳（材料數字起始 < 最後的數字）', first.qty >= 1 && Number(first.matN) < first.qty, `${first.matN} / ${first.qty}`)
    // 獎勵依序：食物先出現，材料晚一點
    const t = await page.evaluate(() => new Promise((res) => {
      const out = { food0: null, mat0: null, t0: performance.now() }
      const poll = () => {
        const op = (s) => { const e = document.querySelector(s); return e ? Number(getComputedStyle(e).opacity) : 0 }
        const now = performance.now() - out.t0
        if (out.food0 === null && op('.q7-food') > 0.5) out.food0 = Math.round(now)
        if (out.mat0 === null && op('.q7-mat') > 0.5) out.mat0 = Math.round(now)
        if (now > 4200 || (out.food0 !== null && out.mat0 !== null)) res(out)
        else requestAnimationFrame(poll)
      }
      poll()
    }))
    check('結算編排：食物先飛進來，材料接著飛進來（依序，不同時）', t.food0 !== null && t.mat0 !== null && t.mat0 > t.food0 + 300, JSON.stringify(t))
    await page.waitForFunction(() => document.querySelector('[data-testid=station-result]')?.dataset.ready === 'true', null, { timeout: 6000 })
    const qty = first.qty
    await page.waitForTimeout(500) // 按鈕的淡入轉場 0.3 秒
    const done = await page.evaluate(() => ({ text: document.querySelector('[data-testid=reward-text]').innerText.replace(/\s+/g, ' '), n: document.querySelector('[data-testid=reward-text] .o8-count').dataset.n, btnOpacity: Number(getComputedStyle(document.querySelector('[data-testid=next-station]')).opacity), anim: getComputedStyle(document.querySelector('[data-testid=next-station]')).animationName }))
    check('結算編排：演完後數字停在正確的最後數字（獲得花朵 × 材料數）', new RegExp(`花朵\\s*×\\s*${qty}$`).test(done.text) && done.n === String(qty), `${done.text} / ${qty}`)
    check('結算編排：演完後主按鈕變明顯（不透明、彈一下 + 發光）', done.btnOpacity === 1 && /o8-ready|o8-main-glow/.test(done.anim), JSON.stringify(done))
    check('結算編排：食物與材料圖示都留在畫面上', (await page.locator('[data-testid=result-food-item]').count()) >= 1 && (await page.locator('.q7-mat').count()) === qty)
    check('結算編排無 console 錯誤', errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  {
    // 可略過：點一下畫面，馬上顯示全部、按鈕變明顯
    const { ctx, page } = await freshApp(browser, SIZES.land)
    await setFlags(page, ['gq-choreo-test'])
    await playToResult(page)
    const qty2 = await page.locator('.q7-mat').count()
    await page.waitForTimeout(250)
    await page.mouse.click(30, 400)
    await page.waitForTimeout(500)
    const s = await page.evaluate(() => ({ choreo: document.querySelector('[data-testid=station-result]').dataset.choreo, ready: document.querySelector('[data-testid=station-result]').dataset.ready, n: document.querySelector('[data-testid=reward-text] .o8-count').dataset.n, mats: [...document.querySelectorAll('.q7-mat')].every((e) => Number(getComputedStyle(e).opacity) === 1), foods: [...document.querySelectorAll('.q7-food')].every((e) => Number(getComputedStyle(e).opacity) === 1), btn: Number(getComputedStyle(document.querySelector('[data-testid=next-station]')).opacity) }))
    check('結算編排：點一下畫面就略過（全部直接顯示、數字是最後的、按鈕明顯）', s.choreo === 'off' && s.ready === 'true' && s.n === String(qty2) && s.mats && s.foods && s.btn === 1, JSON.stringify(s))
    await page.getByTestId('next-station').click()
    await page.waitForSelector('[data-testid=question]')
    check('結算編排：略過後「下一站」照樣可以點', (await page.getByTestId('stage').getAttribute('data-station')) === '3')
    await ctx.close()
  }
  {
    // 減少動態效果：直接顯示
    const { ctx, page } = await freshApp(browser, SIZES.land, { ctxOpts: { reducedMotion: 'reduce' } })
    await setFlags(page, ['gq-choreo-test'])
    await playToResult(page)
    const s = await page.evaluate(() => ({ choreo: document.querySelector('[data-testid=station-result]').dataset.choreo, ready: document.querySelector('[data-testid=station-result]').dataset.ready, n: document.querySelector('[data-testid=reward-text] .o8-count').dataset.n, qty: document.querySelectorAll('.q7-mat').length, btn: Number(getComputedStyle(document.querySelector('[data-testid=next-station]')).opacity) }))
    check('減少動態效果：結算直接顯示最後的樣子（沒有編排、數字不跳、按鈕明顯）', s.choreo === 'off' && s.ready === 'true' && s.n === String(s.qty) && s.btn === 1, JSON.stringify(s))
    await ctx.close()
  }
  // 結算在四種尺寸都無溢出、主按鈕在畫面內
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page } = await freshApp(browser, vp)
    await setFlags(page, ['gq-choreo-test'])
    await playToResult(page)
    await page.waitForTimeout(600)
    const inView = await page.evaluate(() => { const r = document.querySelector('[data-testid=next-station]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth })
    check(`[${size}] 結算：沒有橫向溢出、主按鈕在畫面內`, !(await hasOverflowX(page)) && inView)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
