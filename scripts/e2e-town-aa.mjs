// v8.4 線 AA E2E：開車兜風、照相館。
// 三種尺寸排版（路、房子、紅綠燈都在畫面內、寵物不擋、觸控目標）、手指拖車沿路開（離開路面拉回路上）、
// 紅燈與斑馬線真的停得住、3 歲按著自己開、4–5 歲繞一圈載完乘客、6–7 歲選岔路送到房子、喇叭；
// 照相館選佈景、拖寵物 / 換姿勢 / 換大小、拖帽子與貼紙、倒數與「現在拍」、canvas 合成 JPEG 存進畫廊、掛到房間、
// 不算畫框幅數、滿 30 張不存、禮物、離開後計時器清乾淨。
// v8.5 新玩具（有、沒有兩種狀態都測；次數用 patchSettings({ playCount }) 設定）：
//   開車：車庫換車（消防車的警笛、冰淇淋車的小旋律）、洗車站（停一下刷一刷、亮晶晶，紅綠燈／斑馬線／乘客照常，3 歲按著也過得去）；
//   照相：動物朋友（拖進來、移動、換大小、拍進照片）、相框與色調（真的存進照片的像素）。
// 用法：先啟動 dev server（pnpm exec vite --port 5204 --strictPort），再
//   BASE_URL=http://localhost:5204 node scripts/e2e-town-aa.mjs      （或 pnpm e2e:town-aa；E2E_BROWSER=webkit 改用 WebKit）
//   想存截圖：SHOT_DIR=<資料夾>（不要放 repo 裡）；只跑某一段：E2E_ONLY=drive-lap
import { mkdirSync, writeFileSync } from 'node:fs'
import { freshApp, idb, IS_WEBKIT, launch, makeChecker, touchSender } from './e2e-lib.mjs'
import { CROSS_BLOCK, LIGHT_BLOCK, LOOP_LEN, SPURS, WASH_S, loopAt, spurAt, viewSize } from '../src/domain/drive.ts'

const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const SHOT_DIR = process.env.SHOT_DIR
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
const tagB = IS_WEBKIT ? 'webkit' : 'chromium'
const shot = async (page, name) => {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}-${tagB}.png` })
}
const TOUCH = { ctxOpts: { hasTouch: true } }
const FINGER = { radiusX: 25, radiusY: 25, force: 0.5 }
const pt = (p, id = 0) => ({ x: p.x, y: p.y, id, ...FINGER })
const sleep = (page, ms) => page.waitForTimeout(ms)
/** 無頭 WebKit 不跑 requestAnimationFrame：拍一張刷一幀 */
const flush = async (page) => {
  if (IS_WEBKIT) await page.screenshot()
}
const centerOf = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}
const fingerDrag = async (send, from, to, { steps = 10, hold = 0, page } = {}) => {
  await send('touchStart', [pt(from)])
  for (let i = 1; i <= steps; i++) await send('touchMove', [pt({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps })])
  if (hold && page) await sleep(page, hold)
  await send('touchEnd', [])
}
const fingerTap = async (send, at) => {
  await send('touchStart', [pt(at)])
  await send('touchEnd', [])
}
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
const settings = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
const coloringRows = (page) => idb(page, (db) => new Promise((r) => (db.transaction('coloring').objectStore('coloring').getAll().onsuccess = (e) => r(e.target.result.map((x) => ({ pageId: x.pageId, basePageId: x.basePageId, len: x.png?.length ?? 0, head: (x.png ?? '').slice(0, 24), createdAt: x.createdAt }))))))
const giveHat = (page, id) => idb(page, (db, id) => new Promise((res) => { const tx = db.transaction('inventory', 'readwrite'); tx.objectStore('inventory').put({ id, itemId: id, qty: 1 }); tx.oncomplete = () => res(1) }), id)

/** 設年齡後直接進玩法（用 replaceState + reload，不觸發 hashchange） */
const enter = async (page, game, age) => {
  if (age) await patchSettings(page, { ageBand: age })
  await page.evaluate((g) => history.replaceState(null, '', `#game/${g}`), game)
  await page.reload()
  await page.waitForSelector(`[data-testid=${game}]`)
  if (age) await page.waitForSelector(`[data-testid=${game}][data-band="${age}"]`)
  await sleep(page, 300)
}
const ds = (page, game) => page.evaluate((g) => ({ ...document.querySelector(`[data-testid=${g}]`)?.dataset }), game)
const said = async (page, game) => ((await ds(page, game)).said ?? '').split(' ').filter(Boolean)
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1)
const smallTargets = (page, root) =>
  page.evaluate((root) => {
    const out = []
    for (const b of document.querySelectorAll(`[data-testid=${root}] button, [data-testid=game-back]`)) {
      const r = b.getBoundingClientRect()
      if (r.width && (r.width < 55.5 || r.height < 55.5)) out.push(`${b.dataset.testid ?? b.className} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    return out
  }, root)
const allInside = (page, sel) =>
  page.evaluate((sel) => {
    const bad = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) bad.push(`${el.dataset.testid ?? el.className}`)
    }
    return bad
  }, sel)
const overlaps = (page, a, b) =>
  page.evaluate(
    ([a, b]) => {
      const out = []
      for (const x of document.querySelectorAll(a))
        for (const y of document.querySelectorAll(b)) {
          if (x === y || x.contains(y) || y.contains(x)) continue
          const p = x.getBoundingClientRect()
          const q = y.getBoundingClientRect()
          if (p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1) out.push(`${x.dataset.testid ?? x.className}×${y.dataset.testid ?? y.className}`)
        }
      return out
    },
    [a, b],
  )
const closeGift = async (page) => {
  const g = page.getByTestId('play-gift')
  if (await g.count()) {
    await sleep(page, 550) // 禮物剛跳出來的 0.5 秒不接受點擊
    await g.click()
  }
}

// ---------- 開車：世界座標 ↔ 螢幕 ----------
async function mapInfo(page) {
  return page.evaluate(() => {
    const m = document.querySelector('[data-testid=drive-map]').getBoundingClientRect()
    const r = document.querySelector('[data-testid=drive]')
    return { left: m.left, top: m.top, width: m.width, height: m.height, portrait: r.dataset.portrait === '1' }
  })
}
const toScreen = (m, p) => {
  const v = viewSize(m.portrait)
  const q = m.portrait ? { x: p.y, y: p.x } : p
  return { x: m.left + (q.x / v.w) * m.width, y: m.top + (q.y / v.h) * m.height }
}
const toWorld = (m, s) => {
  const v = viewSize(m.portrait)
  const q = { x: ((s.x - m.left) / m.width) * v.w, y: ((s.y - m.top) / m.height) * v.h }
  return m.portrait ? { x: q.y, y: q.x } : q
}
/** 車子中心離環線多遠（世界單位） */
const offRoad = (w) => {
  let best = Infinity
  for (let s = 0; s < LOOP_LEN; s += 2) {
    const p = loopAt(s)
    best = Math.min(best, Math.hypot(p.x - w.x, p.y - w.y))
  }
  return best
}

async function driveLayout(b, name, vp, band, toys = 0) {
  const { page, errors } = await freshApp(b, vp, TOUCH)
  const tag = `開車[${name} ${band}${toys ? ` 新玩具${toys}` : ''}]`
  if (toys) await patchSettings(page, { playCount: { drive: toys >= 2 ? 3 : 1 } })
  await enter(page, 'drive', band)
  check(`${tag} 車庫按鈕：${toys >= 1 ? '有' : '沒有'}`, (await page.getByTestId('drive-garage').count()) === (toys >= 1 ? 1 : 0))
  check(`${tag} 洗車站：${toys >= 2 ? '有' : '沒有'}`, (await page.getByTestId('drive-wash').count()) === (toys >= 2 ? 1 : 0) && (await page.getByTestId('drive-wash-bay').count()) === (toys >= 2 ? 1 : 0))
  check(`${tag} 一開始是小紅車`, (await ds(page, 'drive')).car === 'red')
  check(`${tag} 有路面`, (await page.locator('[data-testid=drive-road] path').count()) >= 4)
  check(`${tag} 房子數量（6–7 歲才有岔路與三棟房子）`, (await page.locator('[data-testid^=drive-house-]').count()) === (band === '6-7' ? 3 : 0))
  const inside = await allInside(page, '[data-testid=drive-map], .drive-sprite, [data-testid=drive-horn], [data-testid=drive-garage]')
  check(`${tag} 路、車、房子、紅綠燈、喇叭都在畫面內`, inside.length === 0, inside.join())
  check(`${tag} 不橫向溢出`, await noOverflow(page))
  const small = await smallTargets(page, 'drive')
  check(`${tag} 觸控目標 ≥ 56`, small.length === 0, small.join())
  const petHit = await overlaps(page, '[data-testid=drive-pet] .companion', '[data-testid=drive-car], [data-testid^=drive-house-], [data-testid=drive-light], [data-testid=drive-stop], [data-testid=drive-rider], [data-testid=drive-horn], [data-testid=drive-wash], [data-testid=drive-garage]')
  check(`${tag} 寵物不擋車子、房子、紅綠燈、站牌`, petHit.length === 0, petHit.join())
  const backHit = await overlaps(page, '[data-testid=game-back]', '.drive-sprite, [data-testid=drive-horn], [data-testid=drive-garage]')
  check(`${tag} 回去鍵沒有蓋到東西`, backHit.length === 0, backHit.join())
  if (toys >= 1) {
    const gHit = await overlaps(page, '[data-testid=drive-garage]', '.drive-sprite, [data-testid=drive-horn]')
    check(`${tag} 車庫按鈕沒有蓋到車子、房子、紅綠燈、喇叭`, gHit.length === 0, gHit.join())
    // 車庫也不能壓在路上（手指要在路上拖車）
    const m0 = await mapInfo(page)
    const g = await page.getByTestId('drive-garage').boundingBox()
    const corners = [[g.x, g.y], [g.x + g.width, g.y], [g.x, g.y + g.height], [g.x + g.width, g.y + g.height], [g.x + g.width / 2, g.y + g.height / 2]]
    const near = Math.min(...corners.map(([x, y]) => offRoad(toWorld(m0, { x, y }))))
    check(`${tag} 車庫按鈕不壓在路上`, near > 50, near.toFixed(0))
  }
  if (toys >= 2) {
    const wHit = await overlaps(page, '[data-testid=drive-wash]', '[data-testid^=drive-house-], [data-testid=drive-light], [data-testid=drive-stop], [data-testid=drive-rider], [data-testid=game-back], [data-testid=drive-horn], [data-testid=drive-garage]')
    check(`${tag} 洗車站沒有蓋到房子、紅綠燈、站牌、按鈕`, wHit.length === 0, wHit.join())
  }
  check(`${tag} 第一次有手勢示範`, (await page.locator('[data-testid=gesture-hint]').count()) === 1)
  // 路面真的在環線上：車子中心在路中間
  const m = await mapInfo(page)
  const car = await centerOf(page, '[data-testid=drive-car]')
  check(`${tag} 車子在路上`, offRoad(toWorld(m, car)) < 3, offRoad(toWorld(m, car)).toFixed(1))
  // 小車的大小：手指（50px）按得到
  check(`${tag} 小車夠大`, car.box.width >= 40, String(Math.round(car.box.width)))
  await shot(page, `drive-${name}-${band}${toys ? `-toys${toys}` : ''}`)
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await page.context().close()
}

/** 4–5 歲：一根手指一直把車往前拖，繞一圈載完一位乘客；紅燈、斑馬線停得住；手指離開路面車子還在路上 */
async function driveLap(b, wash = false) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = wash ? '開車[4-5 繞一圈 有洗車站]' : '開車[4-5 繞一圈]'
  if (wash) await patchSettings(page, { playCount: { drive: 3 } })
  await enter(page, 'drive', '4-5')
  const m = await mapInfo(page)
  // 手指往草地上拖（離開路面）：車子動了，但還在路上
  const car0 = await centerOf(page, '[data-testid=drive-car]')
  await fingerDrag(send, car0, { x: car0.x + 60, y: car0.y - 160 }, { steps: 12, hold: 400, page })
  await flush(page)
  const car1 = await centerOf(page, '[data-testid=drive-car]')
  check(`${tag} 手指離開路面：車子被拉回路上`, offRoad(toWorld(m, car1)) < 3, offRoad(toWorld(m, car1)).toFixed(1))
  check(`${tag} 手指拖了車子有動`, Math.hypot(car1.x - car0.x, car1.y - car0.y) > 10)
  check(`${tag} 手勢示範在第一次碰之後消失`, (await page.locator('[data-testid=gesture-hint]').count()) === 0)
  // 車頭跟著路的方向：轉彎處的車身角度
  // 一直拖：每 60ms 把手指移到車子前面的路上
  const start = await centerOf(page, '[data-testid=drive-car]')
  await send('touchStart', [pt(start)])
  let redMax = -Infinity
  let crossMax = -Infinity
  let sawRed = false
  let sawCross = false
  let angles = new Set()
  const washS = []
  let sawSuds = false
  let sawShine = false
  let shot1 = false
  const t0 = Date.now()
  let d = {}
  while (Date.now() - t0 < 45000) {
    const a = await centerOf(page, '[data-testid=drive-ahead]')
    await send('touchMove', [pt(a)])
    await sleep(page, 60)
    d = await ds(page, 'drive')
    const s = Number(d.s)
    if (d.wash === '1') {
      washS.push(s)
      sawSuds ||= (await page.getByTestId('drive-suds').count()) === 1
      if (!shot1 && washS.length > 4) {
        shot1 = true
        await shot(page, 'drive-wash-suds')
      }
    }
    if (d.shiny === '1' && !sawShine) {
      sawShine = (await page.getByTestId('drive-shine').count()) === 1
      await shot(page, 'drive-wash-shiny')
    }
    if (d.light !== 'green') {
      sawRed = true
      redMax = Math.max(redMax, s)
    }
    if (d.cross === '1') {
      sawCross = true
      crossMax = Math.max(crossMax, s)
    }
    const rot = await page.evaluate(() => document.querySelector('.drive-car-body').style.transform)
    angles.add(rot)
    if (d.served === '1') break
  }
  // 開車的手指還按著，另一根手指按喇叭（多指）
  const hornAt = await centerOf(page, '[data-testid=drive-horn]')
  const lastA = await centerOf(page, '[data-testid=drive-ahead]')
  await send('touchStart', [pt(lastA, 0), pt(hornAt, 1)])
  await sleep(page, 100)
  check(`${tag} 開車的手指不放，另一根手指按喇叭`, (await page.evaluate(() => document.querySelector('[data-testid=drive-car]').dataset.honks)) === '1')
  await send('touchEnd', [])
  check(`${tag} 有遇到紅燈`, sawRed)
  check(`${tag} 紅燈時車頭沒有過停止線`, redMax <= LIGHT_BLOCK + 0.5, `${redMax} ≤ ${LIGHT_BLOCK.toFixed(1)}`)
  check(`${tag} 有小動物過馬路`, sawCross)
  check(`${tag} 小動物過馬路時車子停在斑馬線前`, crossMax <= CROSS_BLOCK + 0.5, `${crossMax} ≤ ${CROSS_BLOCK.toFixed(1)}`)
  check(`${tag} 車頭跟著路轉向（角度變過很多次）`, angles.size > 10, String(angles.size))
  check(`${tag} 繞一圈回站牌，乘客下車`, d.served === '1', JSON.stringify({ s: d.s, rider: d.rider }))
  const lines = await said(page, 'drive')
  if (wash) {
    check(`${tag} 開進洗車站停下來刷（一圈一次）`, washS.length > 5 && d.washes === '1', `${washS.length} 次取樣 washes ${d.washes}`)
    check(`${tag} 洗的時候車子停在洗車站裡不動`, washS.every((s) => Math.abs(s - WASH_S) <= 2), `${Math.min(...washS)}–${Math.max(...washS)} vs ${WASH_S}`)
    check(`${tag} 洗的時候有泡泡、洗好亮晶晶`, sawSuds && sawShine)
    check(`${tag} 洗好了寵物說一次`, lines.filter((x) => x === 'pet.play.drive.wash').length === 1, lines.join(' '))
    check(`${tag} 泡泡和星星不接手指`, (await page.evaluate(() => getComputedStyle(document.querySelector('.drive-sprite')).pointerEvents)) === 'none')
  } else {
    check(`${tag} 沒有洗車站：一路沒停下來洗、也沒說洗車`, washS.length === 0 && d.washes === '0' && !sawShine && !lines.includes('pet.play.drive.wash'))
  }
  for (const k of ['rider', 'red', 'green', 'cross', 'arrive']) check(`${tag} 寵物說了 ${k}`, lines.includes(`pet.play.drive.${k}`), lines.join(' '))
  check(`${tag} 3–5 歲不說「想去哪」`, !lines.includes('pet.play.drive.where'))
  check(`${tag} 紅燈只說一次`, lines.filter((x) => x === 'pet.play.drive.red').length === 1)
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 5000 }).catch(() => {})
  check(`${tag} 載完一位：送禮物`, (await page.getByTestId('play-gift').count()) === 1)
  await closeGift(page)
  // 喇叭：叭叭，沒有語音
  const before = (await said(page, 'drive')).length
  const horn = await centerOf(page, '[data-testid=drive-horn]')
  await fingerTap(send, horn)
  await sleep(page, 150)
  await page.getByTestId('drive-horn').click()
  await sleep(page, 150)
  check(`${tag} 喇叭按了有反應`, (await page.evaluate(() => document.querySelector('[data-testid=drive-car]').dataset.honks)) === '3')
  check(`${tag} 小紅車的喇叭是叭叭`, (await page.evaluate(() => document.querySelector('[data-testid=drive-car]').dataset.horn)) === 'horn')
  check(`${tag} 喇叭沒有語音`, (await said(page, 'drive')).length === before)
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await shot(page, wash ? 'drive-lap-wash-done' : 'drive-lap-done')
  await ctx.close()
}

/** 3 歲：手指按著（不用拖、不用按在車上）車子就自己開；放開就停；一樣會停紅燈、載完乘客 */
async function drive3(b, wash = false) {
  const { ctx, page, errors } = await freshApp(b, SIZES.port, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = wash ? '開車[3 歲按著 有洗車站]' : '開車[3 歲按著]'
  if (wash) await patchSettings(page, { playCount: { drive: 3 } })
  await enter(page, 'drive', '3')
  const m = await mapInfo(page)
  // 按在環線中間的草地（不是車上）
  const grass = toScreen(m, { x: 360, y: 300 })
  await send('touchStart', [pt(grass)])
  // 先開到站牌（乘客上車時停一下），再繼續開
  await sleep(page, 3200)
  const s1 = Number((await ds(page, 'drive')).s)
  check(`${tag} 按著不動，車子自己往前開（載了乘客繼續開）`, s1 > 160 && (await ds(page, 'drive')).rider === 'ride', String(s1))
  await send('touchEnd', [])
  await sleep(page, 400)
  const s2 = Number((await ds(page, 'drive')).s)
  await sleep(page, 600)
  const s3 = Number((await ds(page, 'drive')).s)
  check(`${tag} 放開就停`, s3 === s2, `${s2}→${s3}`)
  // 再按著一直開到載完一位
  await send('touchStart', [pt(grass)])
  let redMax = -Infinity
  let d = {}
  let washN = 0
  const t0 = Date.now()
  while (Date.now() - t0 < 40000) {
    await sleep(page, 120)
    d = await ds(page, 'drive')
    if (d.light !== 'green') redMax = Math.max(redMax, Number(d.s))
    if (d.wash === '1') {
      washN++
      if (washN === 4) await shot(page, 'drive-wash-3yo-port')
    }
    if (d.served === '1') break
  }
  await send('touchEnd', [])
  if (wash) check(`${tag} 按著自己開進洗車站、洗完自己開出來`, washN >= 3 && d.washes === '1' && (await said(page, 'drive')).includes('pet.play.drive.wash'), `${washN} ${d.washes}`)
  else check(`${tag} 沒有洗車站`, washN === 0 && d.washes === '0')
  check(`${tag} 紅燈停得住`, redMax > -Infinity && redMax <= LIGHT_BLOCK + 0.5, String(redMax))
  check(`${tag} 按著就能載完一位乘客`, d.served === '1', JSON.stringify(d))
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 5000 }).catch(() => {})
  check(`${tag} 送禮物`, (await page.getByTestId('play-gift').count()) === 1)
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/** 6–7 歲：乘客頭上泡泡顯示想去的房子；先送錯（提醒一次、乘客還在車上），再送對（下車、禮物） */
async function drive67(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = '開車[6-7 送乘客回家]'
  await enter(page, 'drive', '6-7')
  const m = await mapInfo(page)
  const goal = async (house) => {
    const d = await ds(page, 'drive')
    const j = SPURS.findIndex((s) => s.house === house)
    const spur = Number(d.spur)
    const s = Number(d.s)
    if (spur >= 0 && spur !== j) return toScreen(m, loopAt(SPURS[spur].at + 40))
    if (spur === j) return toScreen(m, SPURS[j].houseAt)
    const gap = (((SPURS[j].at - s) % LOOP_LEN) + LOOP_LEN) % LOOP_LEN
    return toScreen(m, gap < 45 || gap > LOOP_LEN - 20 ? spurAt(j, SPURS[j].len) : loopAt(s + 60))
  }
  const driveUntil = async (house, done, ms = 30000) => {
    const c = await centerOf(page, '[data-testid=drive-car]')
    await send('touchStart', [pt(c)])
    const t0 = Date.now()
    let d = {}
    while (Date.now() - t0 < ms) {
      const g = house ? await goal(house) : await centerOf(page, '[data-testid=drive-ahead]')
      await send('touchMove', [pt(g)])
      await sleep(page, 60)
      d = await ds(page, 'drive')
      if (done(d)) break
    }
    await send('touchEnd', [])
    return d
  }
  // 先開到站牌載客
  let d = await driveUntil(null, (d) => d.rider === 'ride', 10000)
  check(`${tag} 乘客上車`, d.rider === 'ride')
  const want = d.want
  check(`${tag} 泡泡顯示想去的房子`, (await page.locator(`[data-testid=drive-want][data-house=${want}]`).count()) === 1, want)
  const wrong = SPURS.find((s) => s.house !== want).house
  d = await driveUntil(wrong, (d) => (d.said ?? '').split(' ').filter((x) => x === 'pet.play.drive.where').length >= 2)
  const spurNow = SPURS[Number(d.spur)]?.house
  check(`${tag} 開進錯的岔路，停在房子前`, spurNow === wrong, `${d.spur}`)
  check(`${tag} 送錯：提醒想去哪、乘客還在車上`, d.rider === 'ride' && d.served === '0')
  d = await driveUntil(want, (d) => d.served === '1', 40000)
  check(`${tag} 送到對的房子：乘客下車`, d.served === '1', JSON.stringify({ spur: d.spur, s: d.s, rider: d.rider }))
  check(`${tag} 停在對的那棟`, SPURS[Number(d.spur)]?.house === want)
  const lines = await said(page, 'drive')
  check(`${tag} 說了 rider、where、arrive`, ['rider', 'where', 'arrive'].every((k) => lines.includes(`pet.play.drive.${k}`)), lines.join(' '))
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 5000 }).catch(() => {})
  check(`${tag} 送禮物`, (await page.getByTestId('play-gift').count()) === 1)
  await closeGift(page)
  await sleep(page, OFF_WAIT)
  check(`${tag} 下一位乘客在站牌等`, (await ds(page, 'drive')).rider === 'wait')
  await shot(page, 'drive-67-done')
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}
const OFF_WAIT = 1500

/** v8.5 換車：車庫按一下換下一台；消防車的喇叭是警笛、冰淇淋車是叮叮的小旋律；第一次換各說一句 */
async function driveCars(b, art) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `換車[${art ? '有圖' : '沒圖'}]`
  // 新車的 3D 圖：還沒生好（404）時用自己畫的 SVG；生好了就用圖
  await ctx.route('**/art/ui-car-*-top.png', (r) => (art ? r.fulfill({ path: new URL('../public/art/ui-car-top.png', import.meta.url).pathname }) : r.fulfill({ status: 404, body: '' })))
  await patchSettings(page, { playCount: { drive: 1 } })
  await enter(page, 'drive', '4-5')
  const car = () => page.evaluate(() => ({ ...document.querySelector('[data-testid=drive-car]').dataset }))
  const garage = await centerOf(page, '[data-testid=drive-garage]')
  check(`${tag} 車庫按鈕夠大`, garage.box.width >= 56 && garage.box.height >= 56, `${garage.box.width}x${garage.box.height}`)
  check(`${tag} 車庫裡停著下一台（消防車）`, (await page.getByTestId('drive-garage').getAttribute('data-next')) === 'fire')
  check(`${tag} 只有第一個新玩具：路上沒有洗車站`, (await page.getByTestId('drive-wash').count()) === 0)
  const s0 = Number((await ds(page, 'drive')).s)
  await fingerTap(send, garage)
  await sleep(page, 150)
  check(`${tag} 按一下換成消防車`, (await ds(page, 'drive')).car === 'fire' && (await car()).car === 'fire')
  check(`${tag} 第一次換消防車寵物說一句`, (await said(page, 'drive')).filter((k) => k === 'pet.play.drive.fire').length === 1)
  check(`${tag} 換車不會動到車子的位置`, Number((await ds(page, 'drive')).s) === s0)
  await sleep(page, 400)
  const kind = await page.evaluate(() => (document.querySelector('[data-testid=drive-car] .drive-car-body img') ? 'img' : document.querySelector('[data-testid=drive-car] .drive-car-body svg') ? 'svg' : 'none'))
  check(`${tag} 消防車${art ? '用 3D 圖' : '用自己畫的圖（不是空的、不是 emoji）'}`, kind === (art ? 'img' : 'svg'), kind)
  await shot(page, `drive-car-fire-${art ? 'art' : 'svg'}`)
  const horn = await centerOf(page, '[data-testid=drive-horn]')
  await fingerTap(send, horn)
  await sleep(page, 120)
  check(`${tag} 消防車的喇叭是警笛`, (await car()).horn === 'siren' && (await car()).honks === '1')
  await fingerTap(send, garage)
  await sleep(page, 150)
  check(`${tag} 再按一下換成冰淇淋車、說一句`, (await ds(page, 'drive')).car === 'ice' && (await said(page, 'drive')).filter((k) => k === 'pet.play.drive.ice').length === 1)
  await sleep(page, 400)
  await shot(page, `drive-car-ice-${art ? 'art' : 'svg'}`)
  await fingerTap(send, horn)
  await sleep(page, 120)
  check(`${tag} 冰淇淋車的喇叭是叮叮的小旋律`, (await car()).horn === 'jingle')
  // 開著新車照樣開：手指拖車往前
  {
    const c = await centerOf(page, '[data-testid=drive-car]')
    await send('touchStart', [pt(c)])
    for (let i = 0; i < 8; i++) {
      await send('touchMove', [pt(await centerOf(page, '[data-testid=drive-ahead]'))])
      await sleep(page, 60)
    }
    // 開車的手指不放，另一根手指按車庫（多指）
    await send('touchStart', [pt(await centerOf(page, '[data-testid=drive-ahead]'), 0), pt(garage, 1)])
    await sleep(page, 120)
    await send('touchEnd', [])
    const d = await ds(page, 'drive')
    check(`${tag} 開著冰淇淋車照樣往前開`, Number(d.s) > s0 + 30, d.s)
    check(`${tag} 開車的手指不放也能換車（換回小紅車）`, d.car === 'red')
  }
  await fingerTap(send, horn)
  await sleep(page, 120)
  check(`${tag} 換回小紅車喇叭是叭叭`, (await car()).horn === 'horn')
  await fingerTap(send, garage)
  await sleep(page, 120)
  await page.getByTestId('drive-garage').click()
  await sleep(page, 120)
  const lines = await said(page, 'drive')
  check(`${tag} 再換到同一台不重複說`, (await ds(page, 'drive')).car === 'ice' && lines.filter((k) => k === 'pet.play.drive.fire').length === 1 && lines.filter((k) => k === 'pet.play.drive.ice').length === 1, lines.join(' '))
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/** v8.5 洗車站的圖：還沒生好時用自己畫的；動作減少時泡泡不動 */
async function driveWashReduced(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.phone, { ...TOUCH, ctxOpts: { hasTouch: true, reducedMotion: 'reduce' } })
  const send = await touchSender(ctx, page)
  const tag = '洗車站[手機 動作減少]'
  await ctx.route('**/art/ui-drive-wash.png', (r) => r.fulfill({ status: 404, body: '' }))
  await patchSettings(page, { playCount: { drive: 4 } })
  await enter(page, 'drive', '3')
  await sleep(page, 300)
  check(`${tag} 沒有圖：用自己畫的洗車站`, (await page.locator('[data-testid=drive-wash] svg').count()) === 1)
  const m = await mapInfo(page)
  const grass = toScreen(m, { x: 360, y: 300 })
  await send('touchStart', [pt(grass)])
  let d = {}
  const t0 = Date.now()
  while (Date.now() - t0 < 30000) {
    await sleep(page, 100)
    d = await ds(page, 'drive')
    if (d.wash === '1') break
  }
  check(`${tag} 3 歲按著開到洗車站`, d.wash === '1', JSON.stringify(d))
  const anim = await page.evaluate(() => [...document.querySelectorAll('[data-testid=drive-suds] i')].map((el) => getComputedStyle(el).animationName))
  check(`${tag} 動作減少：泡泡不動`, anim.length === 8 && anim.every((a) => a === 'none'), anim.join())
  await shot(page, 'drive-wash-phone-reduced')
  await page.waitForFunction(() => document.querySelector('[data-testid=drive]').dataset.washes === '1' && !document.querySelector('[data-testid=drive]').dataset.wash, null, { timeout: 5000 }).catch(() => {})
  await sleep(page, 600)
  d = await ds(page, 'drive')
  check(`${tag} 洗完繼續往前開`, Number(d.s) > WASH_S + 20 && d.wash === undefined, d.s)
  await send('touchEnd', [])
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- 照相館 ----------
async function photoLayout(b, name, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `照相[${name}]`
  await giveHat(page, 'hat-crown')
  await enter(page, 'photo')
  check(`${tag} 佈景 8 張`, (await page.locator('[data-testid^=photo-bg-]').count()) === 8)
  const bgSmall = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=photo-bg-]')].filter((b) => b.getBoundingClientRect().width < 96).length)
  check(`${tag} 佈景縮圖夠大`, bgSmall === 0)
  check(`${tag} 佈景都在畫面內`, (await allInside(page, '[data-testid^=photo-bg-]')).length === 0, (await allInside(page, '[data-testid^=photo-bg-]')).join())
  check(`${tag} 佈景沒蓋到回去鍵`, (await overlaps(page, '[data-testid=game-back]', '[data-testid^=photo-bg-]')).length === 0)
  await shot(page, `photo-1-pick-${name}`)
  await page.getByTestId('photo-bg-scene-play-orchard').click()
  await page.waitForSelector('[data-testid=photo-frame]')
  await page.waitForSelector('[data-testid=photo-pet] img.pet-img')
  await sleep(page, 300)
  const fr = await centerOf(page, '[data-testid=photo-frame]')
  check(`${tag} 照片是方的`, Math.abs(fr.box.width - fr.box.height) < 2, `${Math.round(fr.box.width)}x${Math.round(fr.box.height)}`)
  check(`${tag} 照片夠大`, fr.box.width >= Math.min(vp.width, vp.height) * 0.6, String(Math.round(fr.box.width)))
  const ins = await allInside(page, '[data-testid=photo-frame], [data-testid=photo-shutter], [data-testid=photo-size], [data-testid=photo-change-bg], [data-testid=photo-tray]')
  check(`${tag} 照片、托盤、快門都在畫面內`, ins.length === 0, ins.join())
  check(`${tag} 不橫向溢出`, await noOverflow(page))
  const small = await smallTargets(page, 'photo')
  check(`${tag} 觸控目標 ≥ 56`, small.length === 0, small.join())
  const hit = await overlaps(page, '[data-testid=photo-frame]', '[data-testid=game-back], [data-testid=photo-tray], [data-testid=photo-shutter], [data-testid=photo-size]')
  check(`${tag} 照片不擋回去鍵、托盤、快門`, hit.length === 0, hit.join())
  check(`${tag} 托盤有帽子和預設 8 張貼紙`, (await page.locator('[data-testid=photo-hat-hat-crown]').count()) === 1 && (await page.locator('[data-testid=photo-tray-sticker]').count()) >= 8)
  check(`${tag} 還沒有新玩具：沒有動物朋友、沒有相框與色調按鈕`, (await page.locator('[data-testid=photo-tray-friend], [data-testid=photo-frame-btn], [data-testid=photo-tone-btn], [data-testid=photo-decor], [data-testid=photo-tone]').count()) === 0)
  check(`${tag} 還沒有新玩具：托盤第一個是帽子（跟以前一樣）`, (await page.evaluate(() => document.querySelector('[data-testid=photo-tray] button')?.dataset.testid)) === 'photo-hat-hat-crown')
  check(`${tag} 第一次有手勢示範`, (await page.locator('[data-testid=gesture-hint]').count()) === 1)
  // 托盤的貼紙拖進照片（往照片的方向拖：橫向往左、直向往上，跟托盤捲動的方向垂直）
  const st = await centerOf(page, '[data-testid=photo-tray-sticker]')
  await fingerDrag(send, st, { x: fr.box.x + fr.box.width * 0.3, y: fr.box.y + fr.box.height * 0.25 })
  await sleep(page, 150)
  check(`${tag} 貼紙拖進照片`, (await ds(page, 'photo')).stickers === '1')
  // 帽子拖到照片上：戴在寵物頭上
  const hat = await centerOf(page, '[data-testid=photo-hat-hat-crown]')
  await fingerDrag(send, hat, { x: fr.x, y: fr.y })
  await sleep(page, 300)
  check(`${tag} 帽子拖上去戴好`, (await ds(page, 'photo')).hat === 'hat-crown' && (await page.locator('[data-testid=photo-pet] [data-testid=pet-hat]').count()) === 1)
  await shot(page, `photo-2-stage-${name}`)
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function photoFlow(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = '照相[流程]'
  await giveHat(page, 'hat-party')
  await enter(page, 'photo')
  await page.getByTestId('photo-bg-scene-play-sky').click()
  await page.waitForSelector('[data-testid=photo-pet] img.pet-img')
  await sleep(page, 300)
  check(`${tag} 選好佈景寵物說「站哪裡」`, (await said(page, 'photo')).includes('pet.play.photo.pose'))
  const fr = await centerOf(page, '[data-testid=photo-frame]')
  // 點寵物換姿勢
  const pet = await centerOf(page, '[data-testid=photo-pet]')
  await fingerTap(send, { x: pet.x, y: pet.y + pet.box.height * 0.2 })
  await sleep(page, 150)
  check(`${tag} 點寵物換姿勢`, (await ds(page, 'photo')).pose === 'cheer')
  await page.waitForSelector('[data-testid=photo-pet] .pet-sprite.mood-cheer')
  // 拖寵物
  const p0 = await centerOf(page, '[data-testid=photo-pet]')
  await fingerDrag(send, { x: p0.x, y: p0.y + p0.box.height * 0.2 }, { x: p0.x - fr.box.width * 0.25, y: p0.y + p0.box.height * 0.2 - 20 })
  await sleep(page, 150)
  const p1 = await centerOf(page, '[data-testid=photo-pet]')
  check(`${tag} 拖著寵物走`, p1.x < p0.x - fr.box.width * 0.15, `${Math.round(p0.x)}→${Math.round(p1.x)}`)
  check(`${tag} 拖完不算點（姿勢不變）`, (await ds(page, 'photo')).pose === 'cheer')
  // 大小：按鈕輪流換
  const w0 = p1.box.width
  await page.getByTestId('photo-size').click()
  await sleep(page, 100)
  const w1 = (await centerOf(page, '[data-testid=photo-pet]')).box.width
  check(`${tag} 按大小鈕寵物變大`, (await ds(page, 'photo')).size === '2' && w1 > w0 * 1.15, `${Math.round(w0)}→${Math.round(w1)}`)
  // 雙指捏：變小
  const p2 = await centerOf(page, '[data-testid=photo-pet]')
  const a0 = { x: p2.x - 60, y: p2.y }
  const b0 = { x: p2.x + 60, y: p2.y }
  await send('touchStart', [pt(a0, 1), pt(b0, 2)])
  for (let i = 1; i <= 8; i++) await send('touchMove', [pt({ x: a0.x + i * 6, y: a0.y }, 1), pt({ x: b0.x - i * 6, y: b0.y }, 2)])
  await send('touchEnd', [])
  await sleep(page, 150)
  check(`${tag} 雙指捏小`, Number((await ds(page, 'photo')).size) < 2, (await ds(page, 'photo')).size)
  // 貼紙：點一下貼上、拖進來、拖出去拿掉
  const tray = page.locator('[data-testid=photo-tray-sticker]')
  const t1 = await tray.nth(1).boundingBox()
  await fingerTap(send, { x: t1.x + t1.width / 2, y: t1.y + t1.height / 2 })
  await sleep(page, 120)
  const t2 = await tray.nth(2).boundingBox()
  await fingerDrag(send, { x: t2.x + t2.width / 2, y: t2.y + t2.height / 2 }, { x: fr.box.x + fr.box.width * 0.8, y: fr.box.y + fr.box.height * 0.3 })
  await sleep(page, 120)
  check(`${tag} 點一下 + 拖進來：兩張貼紙`, (await ds(page, 'photo')).stickers === '2')
  const placed = await centerOf(page, '[data-testid=photo-sticker]')
  await fingerDrag(send, placed, { x: fr.box.x + fr.box.width * 0.5, y: fr.box.y + fr.box.height * 0.08 })
  await sleep(page, 120)
  check(`${tag} 照片上的貼紙可以拖著移動`, (await ds(page, 'photo')).stickers === '2')
  const pl2 = await centerOf(page, '[data-testid=photo-sticker]')
  await fingerDrag(send, pl2, { x: fr.box.x + fr.box.width + 120, y: pl2.y })
  await sleep(page, 150)
  check(`${tag} 貼紙拖出照片就拿掉`, (await ds(page, 'photo')).stickers === '1')
  // 帽子：點一下戴、再點一下拿下來、再戴回去
  const hatBtn = await centerOf(page, '[data-testid=photo-hat-hat-party]')
  await fingerTap(send, hatBtn)
  await sleep(page, 120)
  check(`${tag} 點帽子戴上`, (await ds(page, 'photo')).hat === 'hat-party')
  await fingerTap(send, hatBtn)
  await sleep(page, 120)
  check(`${tag} 再點一下拿下來`, (await ds(page, 'photo')).hat === '')
  await fingerTap(send, hatBtn)
  await sleep(page, 200)
  // 快門：倒數 3、2…，可以直接按「現在拍」
  await page.getByTestId('photo-shutter').click()
  await page.waitForSelector('[data-testid=photo-count][data-count="3"]')
  check(`${tag} 按快門寵物說「準備好了嗎」`, (await said(page, 'photo')).includes('pet.play.photo.ready'))
  await page.waitForSelector('[data-testid=photo-count][data-count="2"]', { timeout: 3000 })
  check(`${tag} 倒數用手指比數字`, (await page.locator('[data-testid=photo-count] .photo-fingers').count()) === 1)
  await page.getByTestId('photo-now').click()
  await page.waitForSelector('[data-testid=photo-print-img]', { timeout: 8000 })
  const src = await page.getByTestId('photo-print-img').getAttribute('src')
  check(`${tag} 拍好的照片是 JPEG`, src.startsWith('data:image/jpeg'), src.slice(0, 30))
  check(`${tag} 照片有內容（不是空白）`, src.length > 30000, String(src.length))
  // 照片解得開、尺寸對
  const px = await page.evaluate(async (src) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    return { w: c.width, h: c.height }
  }, src)
  check(`${tag} 照片 1080×1080`, px.w === 1080 && px.h === 1080, `${px.w}x${px.h}`)
  if (SHOT_DIR) writeFileSync(`${SHOT_DIR}/photo-composed-${tagB}.jpg`, Buffer.from(src.split(',')[1], 'base64'))
  await page.waitForSelector('[data-testid=photo][data-saved="1"]', { timeout: 4000 })
  const rows = (await coloringRows(page)).filter((r) => r.pageId.startsWith('g:photo-'))
  check(`${tag} 存進 coloring 表（g:photo-<時間戳>、JPEG、basePageId=photo）`, rows.length === 1 && rows[0].head.startsWith('data:image/jpeg') && rows[0].basePageId === 'photo' && /^g:photo-\d+$/.test(rows[0].pageId), JSON.stringify(rows))
  check(`${tag} 沒放進 settings`, !JSON.stringify(await settings(page)).includes('data:image/jpeg'))
  check(`${tag} 不算畫框的幅數`, ((await settings(page)).framesDone ?? 0) === 0)
  check(`${tag} 寵物說「放進畫廊」`, (await said(page, 'photo')).includes('pet.play.photo.saved'))
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 5000 }).catch(() => {})
  check(`${tag} 拍完：送禮物`, (await page.getByTestId('play-gift').count()) === 1)
  await shot(page, 'photo-3-print')
  await closeGift(page)
  // 再拍一張：回到攝影棚，東西都還在
  await page.getByTestId('photo-again').click()
  await page.waitForSelector('[data-testid=photo][data-phase=stage]')
  check(`${tag} 再拍一張：帽子貼紙都還在`, (await ds(page, 'photo')).hat === 'hat-party' && (await ds(page, 'photo')).stickers === '1')
  // 去畫廊：照片在牆上，可以掛到房間
  await page.getByTestId('photo-shutter').click()
  await page.getByTestId('photo-now').click()
  await page.waitForSelector('[data-testid=photo][data-saved="1"]', { timeout: 8000 })
  await page.getByTestId('photo-gallery').click()
  await page.waitForSelector('[data-testid=gallery]')
  await page.waitForSelector('[data-testid=gallery-item]')
  check(`${tag} 畫廊看得到兩張照片`, (await page.locator('[data-testid=gallery-item]').count()) === 2)
  const thumbSrc = await page.locator('[data-testid=gallery-item] img').first().getAttribute('src')
  check(`${tag} 畫廊的縮圖是照片`, (thumbSrc ?? '').startsWith('data:image/jpeg'))
  await page.locator('[data-testid=gallery-item] .gallery-thumb').first().click()
  await page.getByTestId('hang-btn').click()
  await sleep(page, 300)
  const placements = await idb(page, (db) => new Promise((r) => (db.transaction('placements').objectStore('placements').getAll().onsuccess = (e) => r(e.target.result.map((p) => p.itemId)))))
  check(`${tag} 照片掛到房間`, placements.some((p) => /^art-photo-\d+$/.test(p)), placements.join())
  await shot(page, 'photo-4-gallery')
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- v8.5 照相館的新玩具 ----------
/** 按快門、直接拍，等存好；回傳照片（data URL）。玩完的卡跳出來就收掉 */
const snap = async (page) => {
  await page.getByTestId('photo-shutter').click()
  await page.getByTestId('photo-now').click()
  await page.waitForSelector('[data-testid=photo-print-img]', { timeout: 8000 })
  await page.waitForFunction(() => document.querySelector('[data-testid=photo]').dataset.saved !== '', null, { timeout: 5000 })
  const src = await page.getByTestId('photo-print-img').getAttribute('src')
  // 玩完的卡（或星星）在 1.5 秒後才出來：等它、收掉，才按得到「再拍一張」
  await page.waitForSelector('[data-testid=play-gift], [data-testid=play-cheer]', { timeout: 4000 }).catch(() => {})
  await closeGift(page)
  return src
}
const againPhoto = async (page) => {
  await page.getByTestId('photo-again').click()
  await page.waitForSelector('[data-testid=photo][data-phase=stage]')
  await sleep(page, 150)
}
/** 照片上幾個點的顏色（位置是百分比） */
const pixelsAt = (page, src, pts) =>
  page.evaluate(
    async ([src, pts]) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      return pts.map(([x, y]) => [...g.getImageData(Math.round((x * c.width) / 100), Math.round((y * c.height) / 100), 1, 1).data].slice(0, 3))
    },
    [src, pts],
  )
/** 一塊區域（百分比的 x, y, w, h）的平均顏色，以及兩張照片在這一塊差多少 */
const boxStats = (page, a, b, box) =>
  page.evaluate(
    async ([a, b, box]) => {
      const read = async (src) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const k = c.width / 100
        return g.getImageData(Math.round(box[0] * k), Math.round(box[1] * k), Math.max(1, Math.round(box[2] * k)), Math.max(1, Math.round(box[3] * k))).data
      }
      const A = await read(a)
      const B = b ? await read(b) : A
      const mean = [0, 0, 0]
      let diff = 0
      let chroma = 0
      for (let i = 0; i < A.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          mean[k] += A[i + k]
          diff += Math.abs(A[i + k] - B[i + k])
        }
        chroma += Math.max(A[i], A[i + 1], A[i + 2]) - Math.min(A[i], A[i + 1], A[i + 2])
      }
      const n = A.length / 4
      return { mean: mean.map((v) => v / n), diff: diff / (n * 3), chroma: chroma / n }
    },
    [a, b, box],
  )
const lastPhotoPng = (page) =>
  idb(page, (db) => new Promise((r) => (db.transaction('coloring').objectStore('coloring').getAll().onsuccess = (e) => r(e.target.result.filter((x) => x.pageId.startsWith('g:photo-')).sort((a, c) => a.createdAt - c.createdAt).at(-1)?.png ?? ''))))

/** v8.5 動物朋友：玩完 1 次之後盤子最前面多一排動物，可以拖進來、移動、換大小，跟貼紙一樣拍進照片 */
async function photoFriends(b, name, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `動物朋友[${name}]`
  await patchSettings(page, { playCount: { photo: 1 } })
  await enter(page, 'photo')
  await page.getByTestId('photo-bg-scene-play-orchard').click()
  await page.waitForSelector('[data-testid=photo-pet] img.pet-img')
  await sleep(page, 300)
  const fr = await centerOf(page, '[data-testid=photo-frame]')
  const arts = await page.evaluate(() => [...document.querySelectorAll('[data-testid=photo-tray] button')].slice(0, 6).map((e) => `${e.dataset.testid}:${e.dataset.art}`))
  check(`${tag} 盤子最前面多一排六種動物`, JSON.stringify(arts) === JSON.stringify(['obj-bear', 'obj-rabbit', 'obj-chick', 'obj-cow', 'obj-fish', 'obj-octopus'].map((a) => `photo-tray-friend:${a}`)), arts.join())
  check(`${tag} 貼紙都還在`, (await page.locator('[data-testid=photo-tray-sticker]').count()) >= 8)
  check(`${tag} 只有第一個新玩具：沒有相框與色調按鈕`, (await page.locator('[data-testid=photo-frame-btn], [data-testid=photo-tone-btn]').count()) === 0)
  check(`${tag} 不橫向溢出`, await noOverflow(page))
  const small = await smallTargets(page, 'photo')
  check(`${tag} 觸控目標 ≥ 56`, small.length === 0, small.join())
  const ins = await allInside(page, '[data-testid=photo-frame], [data-testid=photo-shutter], [data-testid=photo-size], [data-testid=photo-change-bg], [data-testid=photo-tray]')
  check(`${tag} 照片、托盤、快門都在畫面內`, ins.length === 0, ins.join())
  const friends = () => page.evaluate(() => [...document.querySelectorAll('[data-testid=photo-friend]')].map((el) => { const r = el.getBoundingClientRect(); return { art: el.dataset.art, size: Number(el.dataset.size), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width } }))
  // 點一下：站到寵物旁邊
  const bear = await centerOf(page, '[data-testid=photo-tray-friend][data-art=obj-bear]')
  await fingerTap(send, bear)
  await sleep(page, 150)
  let fs = await friends()
  check(`${tag} 點一下小熊：站進照片裡`, fs.length === 1 && fs[0].art === 'obj-bear' && (await ds(page, 'photo')).friends === '1' && (await ds(page, 'photo')).stickers === '0', JSON.stringify(fs))
  check(`${tag} 動物朋友比貼紙大（照片的三成）`, Math.abs(fs[0].w - fr.box.width * 0.3) < 2, `${fs[0].w} vs ${fr.box.width * 0.3}`)
  check(`${tag} 第一次放進來寵物說「一起拍照」`, (await said(page, 'photo')).filter((k) => k === 'pet.play.photo.friend').length === 1)
  // 拖進來：放在手指放開的地方
  const rabbit = await centerOf(page, '[data-testid=photo-tray-friend][data-art=obj-rabbit]')
  const dropAt = { x: fr.box.x + fr.box.width * 0.75, y: fr.box.y + fr.box.height * 0.35 }
  await fingerDrag(send, rabbit, dropAt)
  await sleep(page, 150)
  fs = await friends()
  const rb = fs.find((f) => f.art === 'obj-rabbit')
  check(`${tag} 兔子拖進照片：放在放開的地方`, fs.length === 2 && !!rb && Math.hypot(rb.x - dropAt.x, rb.y - dropAt.y) < 6, JSON.stringify(rb))
  check(`${tag} 第二隻不再說`, (await said(page, 'photo')).filter((k) => k === 'pet.play.photo.friend').length === 1)
  // 拖著移動
  const to = { x: fr.box.x + fr.box.width * 0.25, y: fr.box.y + fr.box.height * 0.3 }
  await fingerDrag(send, { x: rb.x, y: rb.y }, to)
  await sleep(page, 150)
  fs = await friends()
  const rb2 = fs.find((f) => f.art === 'obj-rabbit')
  check(`${tag} 照片上的動物可以拖著移動`, fs.length === 2 && Math.hypot(rb2.x - to.x, rb2.y - to.y) < 6 && rb2.size === 1, JSON.stringify(rb2))
  // 點一下換大小：中 → 大 → 小
  await fingerTap(send, { x: rb2.x, y: rb2.y })
  await sleep(page, 350)
  const big = (await friends()).find((f) => f.art === 'obj-rabbit')
  await fingerTap(send, { x: rb2.x, y: rb2.y })
  await sleep(page, 350)
  const tiny = (await friends()).find((f) => f.art === 'obj-rabbit')
  check(`${tag} 點一下動物換大小（中 → 大 → 小）`, big.size === 2 && big.w > rb2.w * 1.25 && tiny.size === 0 && tiny.w < rb2.w * 0.8, `${rb2.w}→${big.w}→${tiny.w}`)
  check(`${tag} 最小的動物也按得到（≥ 56）`, name === 'phone' ? tiny.w >= 55.5 : tiny.w >= 56, String(tiny.w))
  // 雙指張開：變大；位置不動、不算點
  {
    const a0 = { x: tiny.x - 14, y: tiny.y }
    const b0 = { x: tiny.x + 14, y: tiny.y }
    await send('touchStart', [pt(a0, 1), pt(b0, 2)])
    for (let i = 1; i <= 8; i++) await send('touchMove', [pt({ x: a0.x - i * 4, y: a0.y }, 1), pt({ x: b0.x + i * 4, y: b0.y }, 2)])
    await send('touchEnd', [])
    await sleep(page, 200)
    const z = (await friends()).find((f) => f.art === 'obj-rabbit')
    check(`${tag} 兩根手指張開：動物變大`, z.size === 2, String(z.size))
    check(`${tag} 縮放時位置不動`, Math.hypot(z.x - tiny.x, z.y - tiny.y) < 2, `${z.x - tiny.x},${z.y - tiny.y}`)
    const a1 = { x: z.x - 50, y: z.y }
    const b1 = { x: z.x + 50, y: z.y }
    await send('touchStart', [pt(a1, 1), pt(b1, 2)])
    for (let i = 1; i <= 8; i++) await send('touchMove', [pt({ x: a1.x + i * 4, y: a1.y }, 1), pt({ x: b1.x - i * 4, y: b1.y }, 2)])
    await send('touchEnd', [])
    await sleep(page, 200)
    const z2 = (await friends()).find((f) => f.art === 'obj-rabbit')
    check(`${tag} 兩根手指捏起來：動物變小`, z2.size < 2, String(z2.size))
  }
  // 動物不擋寵物：寵物照樣拖得動
  await shot(page, `photo-6-friends-${name}`)
  // 拍下來：動物在照片裡（跟把動物拿掉之後再拍一張比）
  const bearAt = (await friends()).find((f) => f.art === 'obj-bear')
  const box = [((bearAt.x - bearAt.w * 0.25 - fr.box.x) / fr.box.width) * 100, ((bearAt.y - bearAt.w * 0.25 - fr.box.y) / fr.box.height) * 100, ((bearAt.w * 0.5) / fr.box.width) * 100, ((bearAt.w * 0.5) / fr.box.height) * 100]
  const withBear = await snap(page)
  if (SHOT_DIR) writeFileSync(`${SHOT_DIR}/photo-friends-${name}-${tagB}.jpg`, Buffer.from(withBear.split(',')[1], 'base64'))
  await againPhoto(page)
  check(`${tag} 再拍一張：動物都還在`, (await ds(page, 'photo')).friends === '2')
  // 把小熊拖出照片：拿掉
  await fingerDrag(send, { x: bearAt.x, y: bearAt.y }, { x: bearAt.x, y: fr.box.y + fr.box.height + (name === 'land' ? 400 : 130) }, { steps: 6 })
  await sleep(page, 200)
  check(`${tag} 動物拖出照片就拿掉`, (await ds(page, 'photo')).friends === '1', (await ds(page, 'photo')).friends)
  const noBear = await snap(page)
  const there = await boxStats(page, withBear, noBear, box)
  const corner = await boxStats(page, withBear, noBear, [1, 1, 8, 8])
  check(`${tag} 動物真的拍進照片（那一塊不一樣，別的地方一樣）`, there.diff > 12 && corner.diff < 4, `${there.diff.toFixed(1)} / ${corner.diff.toFixed(1)}`)
  await againPhoto(page)
  // 最多六位
  for (let i = 0; i < 7; i++) {
    await fingerTap(send, await centerOf(page, `[data-testid=photo-tray-friend] >> nth=${i % 6}`))
    await sleep(page, 80)
  }
  check(`${tag} 最多六位動物朋友`, (await ds(page, 'photo')).friends === '6')
  check(`${tag} 動物都在照片範圍裡`, (await page.evaluate(() => { const f = document.querySelector('[data-testid=photo-frame]').getBoundingClientRect(); return [...document.querySelectorAll('[data-testid=photo-friend]')].every((el) => { const r = el.getBoundingClientRect(); const cx = r.x + r.width / 2; const cy = r.y + r.height / 2; return cx > f.left && cx < f.right && cy > f.top && cy < f.bottom }) })))
  await sleep(page, 200)
  await shot(page, `photo-7-friends-six-${name}`)
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/** v8.5 相框與色調：玩完 3 次之後多兩顆按鈕；選了什麼，拍下來的照片（像素）就是什麼 */
async function photoFrames(b, name, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const tag = `相框與色調[${name}]`
  await patchSettings(page, { playCount: { photo: 3 } })
  await enter(page, 'photo')
  await page.getByTestId('photo-bg-scene-play-orchard').click()
  await page.waitForSelector('[data-testid=photo-pet] img.pet-img')
  await sleep(page, 300)
  check(`${tag} 多了相框與色調按鈕`, (await page.locator('[data-testid=photo-frame-btn]').count()) === 1 && (await page.locator('[data-testid=photo-tone-btn]').count()) === 1)
  check(`${tag} 一開始沒有相框、原色`, (await ds(page, 'photo')).frame === 'none' && (await ds(page, 'photo')).tone === 'plain' && (await page.locator('[data-testid=photo-decor], [data-testid=photo-tone]').count()) === 0)
  check(`${tag} 不橫向溢出`, await noOverflow(page))
  const small = await smallTargets(page, 'photo')
  check(`${tag} 觸控目標 ≥ 56`, small.length === 0, small.join())
  const ins = await allInside(page, '[data-testid=photo-frame], [data-testid=photo-shutter], [data-testid=photo-size], [data-testid=photo-change-bg], [data-testid=photo-frame-btn], [data-testid=photo-tone-btn], [data-testid=photo-tray]')
  check(`${tag} 四顆工具、托盤、快門都在畫面內`, ins.length === 0, ins.join())
  const toolHit = await overlaps(page, '.photo-tool, [data-testid=photo-shutter], [data-testid=photo-tray], [data-testid=game-back], [data-testid=photo-frame]', '.photo-tool')
  check(`${tag} 工具按鈕不互相蓋到、不擋照片與托盤`, toolHit.length === 0, toolHit.join())
  const fr = await centerOf(page, '[data-testid=photo-frame]')
  check(`${tag} 照片還是夠大`, fr.box.width >= Math.min(vp.width, vp.height) * 0.6, String(Math.round(fr.box.width)))
  // 先拍一張原樣的（對照用）
  const plain = await snap(page)
  await againPhoto(page)
  // 相框按一下換下一個：星星 → 愛心 → 底片 → 沒有
  const seen = []
  for (let i = 0; i < 4; i++) {
    await page.getByTestId('photo-frame-btn').click()
    await sleep(page, 80)
    seen.push(`${(await ds(page, 'photo')).frame}:${await page.locator('[data-testid=photo-decor] path').count()}`)
    if (i < 3) await shot(page, `photo-8-frame-${i}-${name}`)
  }
  check(`${tag} 相框按一下換下一個（星星、愛心、底片、沒有），畫面上看得到`, /^stars:\d+,hearts:\d+,film:\d+,none:0$/.test(seen.join()) && !seen.slice(0, 3).some((x) => x.endsWith(':0')), seen.join())
  // 色調：暖暖 → 黑白 → 原色
  const tones = []
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('photo-tone-btn').click()
    await sleep(page, 80)
    tones.push(`${(await ds(page, 'photo')).tone}:${await page.evaluate(() => document.querySelector('[data-testid=photo-tone]')?.className ?? '')}`)
  }
  check(`${tag} 色調按一下換下一個（暖暖、黑白、原色）`, tones.join() === 'warm:photo-tone photo-tone-warm,mono:photo-tone photo-tone-mono,plain:', tones.join())
  // 預覽不用 filter、沒有 filter 的動畫；蓋在上面的那幾層不接手指
  await page.getByTestId('photo-tone-btn').click()
  await page.getByTestId('photo-frame-btn').click()
  await sleep(page, 100)
  const st = await page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('[data-testid=photo-tone]'))
    const d = getComputedStyle(document.querySelector('[data-testid=photo-decor]'))
    return { filter: t.filter, pe: [t.pointerEvents, d.pointerEvents], anim: document.getAnimations().filter((a) => JSON.stringify(a.effect?.getKeyframes?.() ?? []).includes('filter')).length }
  })
  check(`${tag} 預覽沒有 filter 動畫、不接手指`, st.filter === 'none' && st.pe.every((v) => v === 'none') && st.anim === 0, JSON.stringify(st))
  // 選了相框和色調，寵物照樣拖得動（那幾層不擋）
  {
    const send = await touchSender(ctx, page)
    const p0 = await centerOf(page, '[data-testid=photo-pet]')
    await fingerDrag(send, { x: p0.x, y: p0.y + p0.box.height * 0.2 }, { x: p0.x - fr.box.width * 0.2, y: p0.y + p0.box.height * 0.2 })
    await sleep(page, 150)
    const p1 = await centerOf(page, '[data-testid=photo-pet]')
    check(`${tag} 有相框時寵物照樣拖得動`, p1.x < p0.x - fr.box.width * 0.1, `${p0.x}→${p1.x}`)
    await fingerDrag(send, { x: p1.x, y: p1.y + p1.box.height * 0.2 }, { x: p0.x, y: p0.y + p0.box.height * 0.2 })
    await sleep(page, 150)
  }
  // 星星相框 + 暖暖：拍下來
  await shot(page, `photo-9-stars-warm-${name}`)
  const warm = await snap(page)
  if (SHOT_DIR) writeFileSync(`${SHOT_DIR}/photo-stars-warm-${name}-${tagB}.jpg`, Buffer.from(warm.split(',')[1], 'base64'))
  {
    // 上面那條邊（兩顆星星中間）是相框的淡黃色；中間是暖色調（比原樣紅一點、藍少一點）
    const [band] = await pixelsAt(page, warm, [[50, 1.2]])
    check(`${tag} 星星相框畫進照片（邊是淡黃色）`, band[0] > 235 && band[1] > 215 && band[2] > 140 && band[2] < 200, band.join())
    const [star] = await pixelsAt(page, warm, [[40.6, 3.3]])
    check(`${tag} 星星畫進照片（橘黃色）`, star[0] > 230 && star[1] > 150 && star[1] < 215 && star[2] < 90, star.join())
    const a = await boxStats(page, warm, null, [30, 12, 40, 20])
    const p = await boxStats(page, plain, null, [30, 12, 40, 20])
    check(`${tag} 暖暖色調畫進照片（紅多、藍少）`, a.mean[0] > p.mean[0] + 3 && a.mean[2] < p.mean[2] - 12, `${a.mean.map(Math.round)} vs ${p.mean.map(Math.round)}`)
    check(`${tag} 存進畫廊的就是這一張（有相框與色調）`, (await lastPhotoPng(page)) === warm)
  }
  await againPhoto(page)
  check(`${tag} 再拍一張：相框與色調都還在`, (await ds(page, 'photo')).frame === 'stars' && (await ds(page, 'photo')).tone === 'warm')
  // 底片 + 黑白
  await page.getByTestId('photo-frame-btn').click()
  await page.getByTestId('photo-frame-btn').click()
  await page.getByTestId('photo-tone-btn').click()
  await sleep(page, 150)
  check(`${tag} 換成底片 + 黑白`, (await ds(page, 'photo')).frame === 'film' && (await ds(page, 'photo')).tone === 'mono')
  await shot(page, `photo-10-film-mono-${name}`)
  const mono = await snap(page)
  if (SHOT_DIR) writeFileSync(`${SHOT_DIR}/photo-film-mono-${name}-${tagB}.jpg`, Buffer.from(mono.split(',')[1], 'base64'))
  {
    const [dark, hole, side] = await pixelsAt(page, mono, [[44.4, 5], [50, 5], [1.2, 50]])
    check(`${tag} 底片相框畫進照片（黑邊、白色齒孔）`, dark.every((v) => v < 90) && side.every((v) => v < 90) && hole.every((v) => v > 215), `${dark} / ${hole} / ${side}`)
    const m = await boxStats(page, mono, null, [20, 15, 60, 60])
    const p = await boxStats(page, plain, null, [20, 15, 60, 60])
    check(`${tag} 黑白色調畫進照片（沒有彩度、但不是一片灰）`, m.chroma < 6 && p.chroma > 25 && m.mean[0] > 40 && m.mean[0] < 235, `${m.chroma.toFixed(1)} vs ${p.chroma.toFixed(1)} mean ${Math.round(m.mean[0])}`)
    check(`${tag} 存進畫廊的就是這一張`, (await lastPhotoPng(page)) === mono)
    const dim = await page.evaluate(async (src) => { const i = new Image(); i.src = src; await i.decode(); return `${i.naturalWidth}x${i.naturalHeight}` }, mono)
    check(`${tag} 照片還是 1080×1080 的 JPEG`, dim === '1080x1080' && mono.startsWith('data:image/jpeg'))
  }
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/** 30 張滿了：照樣可以拍、可以看，只是不存；寵物說請爸爸媽媽整理 */
async function photoFull(b) {
  const { page, errors, ctx } = await freshApp(b, SIZES.phone, TOUCH)
  const tag = '照相[滿 30 張]'
  await idb(page, (db) => new Promise((res) => {
    const tx = db.transaction('coloring', 'readwrite')
    const s = tx.objectStore('coloring')
    for (let i = 0; i < 30; i++) s.put({ pageId: `g:photo-${1000 + i}`, basePageId: 'photo', fills: {}, png: 'data:image/jpeg;base64,/9j/AAAA', createdAt: 1000 + i, updatedAt: 1000 + i })
    tx.oncomplete = () => res(1)
  }))
  await enter(page, 'photo')
  await page.getByTestId('photo-bg-scene-play-music').click()
  await page.waitForSelector('[data-testid=photo-pet] img.pet-img')
  await page.getByTestId('photo-shutter').click()
  await page.getByTestId('photo-now').click()
  await page.waitForSelector('[data-testid=photo][data-saved="0"]', { timeout: 8000 })
  check(`${tag} 照樣拍得出來（看得到照片）`, ((await page.getByTestId('photo-print-img').getAttribute('src')) ?? '').startsWith('data:image/jpeg'))
  check(`${tag} 寵物說放滿了`, (await said(page, 'photo')).includes('pet.play.photo.full'))
  check(`${tag} 沒有多存、舊的沒刪`, (await coloringRows(page)).filter((r) => r.pageId.startsWith('g:photo-')).length === 30)
  check(`${tag} 沒存就不顯示「去畫廊看」`, (await page.getByTestId('photo-gallery').count()) === 0)
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 5000 }).catch(() => {})
  check(`${tag} 照樣算玩完一回（禮物）`, (await page.getByTestId('play-gift').count()) === 1)
  await shot(page, 'photo-5-full-phone')
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/** 演到一半離開：計時器清乾淨（開車、倒數中） */
async function timers(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const send = await touchSender(ctx, page)
  const live = () => page.evaluate(() => window.__timers.size)
  await page.evaluate(() => (location.hash = 'town'))
  await page.waitForSelector('[data-testid=town-grid]')
  await sleep(page, 4000)
  const base = await live()
  await page.getByTestId('game-drive').click()
  await page.waitForSelector('[data-testid=drive]')
  const c = await centerOf(page, '[data-testid=drive-car]')
  await send('touchStart', [pt(c)])
  for (let i = 0; i < 6; i++) {
    const a = await centerOf(page, '[data-testid=drive-ahead]')
    await send('touchMove', [pt(a)])
    await sleep(page, 80)
  }
  await page.getByTestId('game-back').click()
  await send('touchEnd', [])
  await page.waitForSelector('[data-testid=town-grid]')
  await page.getByTestId('game-photo').click()
  await page.getByTestId('photo-bg-scene-play-sky').click()
  await page.getByTestId('photo-shutter').click()
  await page.waitForSelector('[data-testid=photo-count]')
  await page.getByTestId('game-back').click()
  await page.waitForSelector('[data-testid=town-grid]')
  await sleep(page, 3400)
  const after = await live()
  check('計時器：開車、倒數到一半離開，計時器清乾淨', after <= base, `${base}→${after}`)
  check('計時器：倒數到一半離開不會偷拍', (await coloringRows(page)).filter((r) => r.pageId.startsWith('g:photo-')).length === 0)
  check('計時器：沒有錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

const b = await launch()
const only = process.env.E2E_ONLY
const run = async (name, fn) => {
  if (!only || only.split(',').includes(name)) await fn()
}
try {
  await run('drive-layout', () => driveLayout(b, 'land', SIZES.land, '6-7'))
  await run('drive-layout', () => driveLayout(b, 'port', SIZES.port, '6-7'))
  await run('drive-layout', () => driveLayout(b, 'phone', SIZES.phone, '6-7'))
  await run('drive-layout', () => driveLayout(b, 'phone', SIZES.phone, '4-5'))
  await run('drive-lap', () => driveLap(b))
  await run('drive-3', () => drive3(b))
  await run('drive-toys', () => driveLayout(b, 'land', SIZES.land, '6-7', 2))
  await run('drive-toys', () => driveLayout(b, 'port', SIZES.port, '6-7', 2))
  await run('drive-toys', () => driveLayout(b, 'phone', SIZES.phone, '6-7', 2))
  await run('drive-toys', () => driveLayout(b, 'phone', SIZES.phone, '4-5', 1))
  await run('drive-toys', () => driveCars(b, false))
  await run('drive-toys', () => driveCars(b, true))
  await run('drive-toys', () => driveLap(b, true))
  await run('drive-toys', () => drive3(b, true))
  await run('drive-toys', () => driveWashReduced(b))
  await run('drive-67', () => drive67(b))
  await run('photo-layout', () => photoLayout(b, 'land', SIZES.land))
  await run('photo-layout', () => photoLayout(b, 'port', SIZES.port))
  await run('photo-layout', () => photoLayout(b, 'phone', SIZES.phone))
  await run('photo-flow', () => photoFlow(b))
  await run('photo-toys', () => photoFriends(b, 'land', SIZES.land))
  await run('photo-toys', () => photoFriends(b, 'port', SIZES.port))
  await run('photo-toys', () => photoFriends(b, 'phone', SIZES.phone))
  await run('photo-toys', () => photoFrames(b, 'land', SIZES.land))
  await run('photo-toys', () => photoFrames(b, 'port', SIZES.port))
  await run('photo-toys', () => photoFrames(b, 'phone', SIZES.phone))
  await run('photo-full', () => photoFull(b))
  await run('timers', () => timers(b))
} finally {
  await b.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
