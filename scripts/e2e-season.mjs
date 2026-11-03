// v8.1 線 Q E2E：房間內建陳設、節慶（掛飾、寵物一句話、紀念家具、相簿、開關）、地圖 iPad 柔焦背景與放大。
// 美術可能還沒生成：陳設與掛飾的圖一律攔截成 1x1 PNG（ART_REAL=1 才用真圖），另外測缺圖時不破版。
// 用法：先啟動 dev server（pnpm dev --port 5193 --strictPort），再
//   BASE_URL=http://localhost:5193 node scripts/e2e-season.mjs          （或 pnpm e2e:season；E2E_BROWSER=webkit 改用 WebKit）
//   想存截圖：SHOT_DIR=<資料夾> ART_REAL=1 node scripts/e2e-season.mjs（不要放 repo 裡）
import { mkdirSync } from 'node:fs'
import { center, drag, freshApp, idb, IS_WEBKIT, launch, makeChecker, openParentTab, patchPet } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const LAND = { width: 1180, height: 820 }
const PORT = { width: 820, height: 1180 }
const PHONE = { width: 390, height: 844 }
const SIZES = { land: LAND, port: PORT, phone: PHONE }
const SHOT_DIR = process.env.SHOT_DIR
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
const shot = async (page, name) => {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}.png` })
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const NEW_ART = /\/art\/(ui-room-|ui-fest-|decor-fest-)[a-z]+\.png$/
const fakeArt = (ctx) => (process.env.ART_REAL ? Promise.resolve() : ctx.route(NEW_ART, (r) => r.fulfill({ contentType: 'image/png', body: PNG })))
const noArt = (ctx) => ctx.route(NEW_ART, (r) => r.fulfill({ status: 404, body: '' }))

const FESTS = [
  { id: 'cny', date: '2027-02-06', art: 'ui-fest-cny', item: 'decor-fest-lion', line: '新年快樂！紅燈籠好漂亮！', caption: '我們一起過春節，收到小舞獅！' },
  { id: 'children', date: '2027-04-04', art: 'ui-fest-children', item: 'decor-fest-balloon', line: '兒童節快樂！我們一起玩！', caption: '我們一起過兒童節，收到一束氣球！' },
  { id: 'dragon', date: '2027-06-09', art: 'ui-fest-dragon', item: 'decor-fest-dragonboat', line: '端午節到了！粽子香香的！', caption: '我們一起過端午節，收到小龍舟！' },
  { id: 'moon', date: '2027-09-15', art: 'ui-fest-moon', item: 'decor-fest-rabbitlamp', line: '中秋節到了！月亮圓圓的！', caption: '我們一起過中秋節，收到兔子燈！' },
  { id: 'xmas', date: '2027-12-25', art: 'ui-fest-xmas', item: 'decor-fest-tree', line: '聖誕節到了！鈴鐺叮叮噹！', caption: '我們一起過聖誕節，收到聖誕樹！' },
]

const all = (page, t) => idb(page, (db, t) => new Promise((r) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => r(e.target.result))), t)
const settingsOf = async (page) => (await all(page, 'settings'))[0]
const qtyOf = async (page, id) => (await all(page, 'inventory')).find((i) => i.itemId === id)?.qty ?? 0
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
const delRow = (page, store, key) =>
  idb(
    page,
    (db, a) =>
      new Promise((r) => {
        const tx = db.transaction(a.store, 'readwrite')
        tx.objectStore(a.store).delete(a.key)
        tx.oncomplete = () => r(1)
      }),
    { store, key },
  )
const reload = async (page) => {
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
}
const setDate = async (page, date) => {
  await page.evaluate((d) => localStorage.setItem('gq-fest-date', d), date)
  await reload(page)
}
const rectOf = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s)
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }, sel)
const overlap = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
/** 記下機器語音唸過的句子：沒錄音的節慶台詞不該唸 */
const spySpeech = (ctx) =>
  ctx.addInitScript(() => {
    window.__spoken = []
    const s = window.speechSynthesis
    if (!s) return
    const f = s.speak.bind(s)
    s.speak = (u) => {
      window.__spoken.push(u.text)
      return f(u)
    }
  })
const fresh = async (browser, viewport, opts) => {
  const r = await freshApp(browser, viewport, opts)
  await fakeArt(r.ctx)
  await spySpeech(r.ctx)
  await reload(r.page)
  return r
}

async function testFixtures(b) {
  for (const [name, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await fresh(b, vp)
    await page.waitForSelector('[data-testid=room-fixture-cabinet]')
    const fx = await page.evaluate(() => ['cabinet', 'photos', 'mat'].map((id) => !!document.querySelector(`.room-backdrop [data-testid=room-fixture-${id}]`)))
    check(`${name}：開局就有矮櫃、相框、地墊，都在背景層`, fx.every(Boolean), fx.join())
    check(`${name}：陳設不佔擺放格`, (await all(page, 'placements')).length === 0)
    const room = await rectOf(page, '[data-testid=room]')
    const cab = await rectOf(page, '[data-testid=room-fixture-cabinet]')
    const pet = await rectOf(page, '[data-testid=pet-slot]')
    check(`${name}：矮櫃比寵物矮（比例協調）`, cab.height < pet.height, `${Math.round(cab.height)} vs ${Math.round(pet.height)}`)
    check(`${name}：矮櫃下緣站在地板上（牆地分界 62% 之下）`, (cab.bottom - room.top) / room.height > 0.62 && (cab.bottom - room.top) / room.height < 0.8)
    const z = await page.evaluate(() => {
      const layer = document.querySelector('.pf-backdrop-layer')
      const slot = document.querySelector('[data-testid=pet-slot]')
      return { layer: Number(getComputedStyle(layer).zIndex), slot: Number(getComputedStyle(slot).zIndex), pe: getComputedStyle(document.querySelector('.rb-fixtures')).pointerEvents }
    })
    check(`${name}：陳設在寵物之下、不擋觸控`, z.layer < z.slot && z.pe === 'none', JSON.stringify(z))
    // 主要 UI：狀態卡、右側工具列；陳設不壓到（起始畫面）
    const hud = await rectOf(page, '.pet-hud')
    const side = await rectOf(page, '.side-tools')
    const photos = await rectOf(page, '[data-testid=room-fixture-photos]')
    check(`${name}：相框不壓狀態卡`, !overlap(photos, hud))
    check(`${name}：相框不壓右側工具`, !overlap(photos, side))
    check(`${name}：矮櫃不壓狀態卡與右側工具`, !overlap(cab, hud) && !overlap(cab, side))
    await page.waitForTimeout(600) // 等雲朵轉場散開
    await shot(page, `room-${name}`)
    if (SHOT_DIR && name === 'phone') {
      await page.getByTestId('room-right').click()
      await page.waitForTimeout(500)
      await shot(page, 'room-phone-right')
      await page.getByTestId('room-left').click()
      await page.waitForTimeout(500)
    }
    check(`${name}：沒有錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 讓位
  const { ctx, page, errors } = await fresh(b, LAND)
  await page.waitForSelector('[data-testid=room-fixture-mat]')
  const put = (itemId, x, y) => putRows(page, 'placements', [{ itemId, x, y, z: 0, flipped: false, placedAt: 1 }])
  await putRows(page, 'inventory', ['decor-rug', 'decor-shelf', 'decor-frame', 'decor-ball'].map((id) => ({ id, itemId: id, qty: 1 })))
  await put('decor-rug', 0.3, 0.88)
  await reload(page)
  await page.waitForTimeout(300)
  check('擺了地毯（舊存檔的預設位置）：地墊讓位', (await page.getByTestId('room-fixture-mat').count()) === 0)
  check('矮櫃、相框還在', (await page.getByTestId('room-fixture-cabinet').count()) === 1 && (await page.getByTestId('room-fixture-photos').count()) === 1)
  await put('decor-shelf', 0.385, 0.6)
  await put('decor-frame', 0.385, 0.28)
  await reload(page)
  await page.waitForTimeout(300)
  check('書架擺到矮櫃那裡：矮櫃讓位', (await page.getByTestId('room-fixture-cabinet').count()) === 0)
  check('畫框掛到相框那裡：相框讓位', (await page.getByTestId('room-fixture-photos').count()) === 0)
  await shot(page, 'room-giveway')
  for (const k of ['decor-rug', 'decor-shelf', 'decor-frame']) await delRow(page, 'placements', k)
  await put('decor-ball', 0.385, 0.68)
  await reload(page)
  await page.waitForSelector('[data-testid=room-fixture-cabinet]')
  check('收回之後陳設回來；小球擺在矮櫃前面不用讓', (await page.getByTestId('room-fixture-mat').count()) === 1 && (await page.getByTestId('room-fixture-photos').count()) === 1)
  check('沒有錯誤（讓位）', errors.length === 0, errors.join(' | '))
  await ctx.close()

  // 缺圖
  const m = await freshApp(b, LAND)
  await noArt(m.ctx)
  await m.page.evaluate(() => localStorage.setItem('gq-fest-date', '2027-02-06'))
  await reload(m.page)
  await m.page.waitForTimeout(1500)
  const missing = await m.page.evaluate(() => ({
    fx: document.querySelectorAll('.rb-fixture').length,
    fest: document.querySelectorAll('.rb-fest').length,
    fallback: document.querySelectorAll('.room-backdrop .art-fallback').length,
  }))
  check('缺圖：陳設與掛飾都不顯示、沒有色塊', missing.fx === 0 && missing.fest === 0 && missing.fallback === 0, JSON.stringify(missing))
  check('缺圖：沒有錯誤', m.errors.length === 0, m.errors.join(' | '))
  await m.ctx.close()
}

async function testFestivals(b) {
  // 預設（自動化、沒有測試日期）：不演節慶
  const { ctx, page, errors } = await fresh(b, LAND)
  await page.waitForTimeout(1200)
  check('沒有測試日期：自動化環境不演節慶', (await page.getByTestId('room-festival').count()) === 0 && !(await settingsOf(page)).festival)

  for (const f of FESTS) {
    await setDate(page, f.date)
    await page.waitForSelector(`[data-testid=room-festival][data-art=${f.art}]`, { timeout: 8000 })
    await page.waitForSelector('[data-testid=pet-bubble]', { timeout: 3000 })
    check(`${f.id}：掛飾出現，寵物說一句`, (await page.getByTestId('pet-bubble').innerText()).includes(f.line))
    const hang = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=room-festival]')
      const r = el.getBoundingClientRect()
      const win = document.querySelector('.rb-drape')
      const z = (e) => Number(getComputedStyle(e).zIndex) || 0
      return { z: z(el.parentElement), drape: z(win), right: r.right, left: r.left, w: r.width }
    })
    check(`${f.id}：掛飾在窗戶前面，不會被窗簾蓋住`, hang.z > hang.drape, JSON.stringify(hang))
    check(`${f.id}：掛飾在起始畫面內`, hang.left >= 0 && hang.right <= LAND.width && hang.w > 100, JSON.stringify(hang))
    check(`${f.id}：牆面掛飾第一次有掉下來的演出`, await page.locator('[data-testid=room-festival].enter').count() === 1)
    check(`${f.id}：回憶卡等寵物說完才跳`, (await page.getByTestId('memory-pop').count()) === 0)
    if (f.id === 'cny') await shot(page, `fest-show-${f.id}`)
    check(`${f.id}：紀念家具進背包`, (await qtyOf(page, f.item)) === 1)
    await page.waitForSelector(`[data-testid=memory-pop][data-card="festival:${f.id}"]`, { timeout: 6000 })
    check(`${f.id}：回憶卡的句子正確`, (await page.getByTestId('album-caption').innerText()) === f.caption)
    if (f.id === 'cny') await shot(page, `fest-card-${f.id}`)
    await page.getByTestId('memory-close').click()
    await page.waitForTimeout(250)
    const spoken = await page.evaluate(() => window.__spoken ?? [])
    check(`${f.id}：沒錄音的句子不用機器語音唸`, !spoken.includes(f.line) && !spoken.includes(f.caption), spoken.join('|'))
    // 重開不重送
    await reload(page)
    await page.waitForSelector('[data-testid=room-festival]')
    await page.waitForTimeout(1200)
    check(`${f.id}：重開不重送、不重說`, (await qtyOf(page, f.item)) === 1 && (await page.getByTestId('pet-bubble').count()) === 0 && (await page.getByTestId('memory-pop').count()) === 0)
    check(`${f.id}：之後掛飾沒有掉下來的演出`, (await page.locator('[data-testid=room-festival].enter').count()) === 0)
  }

  const s = await settingsOf(page)
  check('settings 記下五個節慶', s.festival.seen.length === 5 && s.festival.got.length === 5, JSON.stringify(s.festival))
  check('相簿有五張節慶卡', s.album.filter((c) => c.kind === 'festival').length === 5)

  // 隔年
  await setDate(page, '2028-01-26')
  await page.waitForSelector('[data-testid=pet-bubble]', { timeout: 5000 })
  check('隔年春節：寵物再說一次', (await page.getByTestId('pet-bubble').innerText()).includes(FESTS[0].line))
  await page.waitForTimeout(800)
  check('隔年春節：不再多送一隻', (await qtyOf(page, 'decor-fest-lion')) === 1)
  await page.waitForTimeout(4200)
  check('隔年春節：沒有新回憶卡', (await page.getByTestId('memory-pop').count()) === 0)

  // 平日：掛飾收掉
  await setDate(page, '2028-03-01')
  await page.waitForTimeout(600)
  check('節慶過了：掛飾收掉（沒有提示、沒有倒數）', (await page.getByTestId('room-festival').count()) === 0)
  const body = await page.locator('body').innerText()
  check('畫面沒有「限定」「快結束」「倒數」字樣', !/限定|快結束|倒數|只剩|還剩/.test(body))

  // 背包、相簿、佈置
  await page.getByRole('button', { name: /背包/ }).click()
  await page.getByTestId('bag-tab-furniture').click()
  await page.getByText('聖誕樹').first().waitFor()
  const bag = await page.getByTestId('bag').innerText()
  check('「我的東西」看得到紀念家具', bag.includes('小舞獅') && bag.includes('聖誕樹'), bag.replace(/\s+/g, ' ').slice(0, 300))
  await page.waitForTimeout(700) // 等雲朵轉場散開
  await shot(page, 'fest-bag')
  await page.locator('.screen-header .back, .back').first().click()
  await page.waitForSelector('[data-testid=room]')
  await page.getByTestId('more-btn').or(page.getByRole('button', { name: /更多/ })).first().click()
  await page.getByTestId('album-btn').click()
  await page.waitForSelector(`[data-card="festival:cny"]`)
  const tag = await page.locator(`[data-card="festival:cny"] .al-tag`).innerText()
  check('相簿：節慶卡標籤沒有 emoji', tag.trim() === '節慶', tag)
  check('相簿：節慶卡有紀念家具的小圖', (await page.locator(`[data-card="festival:cny"] [data-reward=decor-fest-lion]`).count()) === 1)
  await page.waitForTimeout(700)
  await shot(page, 'fest-album')
  await page.locator(`[data-card="festival:cny"]`).click()
  await page.waitForSelector('[data-testid=album-view]')
  const spoken = await page.evaluate(() => window.__spoken ?? [])
  check('相簿點卡片：沒錄音不唸', !spoken.includes(FESTS[0].caption))
  check('沒有錯誤（節慶）', errors.length === 0, errors.join(' | '))
  await ctx.close()

  // 擺進房間
  const p = await fresh(b, LAND)
  await p.page.evaluate(() => localStorage.setItem('gq-fest-date', '2027-12-25'))
  await reload(p.page)
  await p.page.waitForSelector('[data-testid=memory-pop]', { timeout: 8000 })
  await p.page.getByTestId('memory-close').click()
  await p.page.getByRole('button', { name: /佈置/ }).click()
  const from = await center(p.page, '[data-dock-item=decor-fest-tree]')
  await drag(p.page, from, { x: 760, y: 500 }, { settle: 400 })
  check('紀念家具可以擺進房間', (await all(p.page, 'placements')).some((x) => x.itemId === 'decor-fest-tree'))
  check('擺好的紀念家具畫得出來', (await p.page.locator('[data-placed=decor-fest-tree]').count()) === 1)
  await shot(p.page, 'fest-placed')
  check('沒有錯誤（擺放）', p.errors.length === 0, p.errors.join(' | '))
  await p.ctx.close()

  // 不在商店與工坊
  const sh = await fresh(b, LAND)
  await sh.page.evaluate(() => localStorage.setItem('gq-fest-date', '2027-02-06'))
  await reload(sh.page)
  await sh.page.waitForSelector('[data-testid=memory-pop]', { timeout: 8000 })
  await sh.page.getByTestId('memory-close').click()
  await sh.page.getByRole('button', { name: '工坊', exact: true }).click()
  await sh.page.waitForTimeout(400)
  check('工坊沒有紀念家具', !(await sh.page.locator('body').innerText()).includes('小舞獅'))
  await sh.ctx.close()

  // 蛋
  const egg = await fresh(b, LAND, { stage: 'egg' })
  await egg.page.evaluate(() => localStorage.setItem('gq-fest-date', '2027-09-15'))
  await reload(egg.page)
  await egg.page.waitForSelector('[data-testid=room-festival]')
  await egg.page.waitForTimeout(1500)
  check('還是蛋：掛飾照掛，不說話、不送', (await egg.page.getByTestId('pet-bubble').count()) === 0 && (await qtyOf(egg.page, 'decor-fest-rabbitlamp')) === 0)
  await patchPet(egg.page, { stage: 'baby', feedCount: 20 })
  await reload(egg.page)
  await egg.page.waitForSelector('[data-testid=memory-pop]', { timeout: 8000 })
  check('孵出來之後：節慶還在就補上', (await qtyOf(egg.page, 'decor-fest-rabbitlamp')) === 1)
  await egg.ctx.close()

  // 晚上寵物睡著：一年一次的演出會醒來說
  const night = await fresh(b, LAND, { tod: 'night' })
  await night.page.evaluate(() => localStorage.setItem('gq-fest-date', '2027-12-25'))
  await reload(night.page)
  await night.page.waitForSelector('[data-testid=pet-bubble]', { timeout: 8000 })
  check('晚上：寵物也會說那一句', (await night.page.getByTestId('pet-bubble').innerText()).includes('聖誕節到了'))
  await night.page.waitForSelector('[data-testid=memory-pop]', { timeout: 8000 })
  await night.page.getByTestId('memory-close').click()
  await night.page.waitForTimeout(500)
  await shot(night.page, 'fest-night')
  await night.ctx.close()

  // 家長開關
  const sw = await fresh(b, LAND)
  await openParentTab(sw.page, '設定')
  const toggle = sw.page.getByTestId('festival-switch')
  await toggle.waitFor()
  await shot(sw.page, 'fest-switch')
  check('家長區有節慶開關，預設開', (await settingsOf(sw.page)).festivalOn === undefined)
  await toggle.click()
  await sw.page.waitForTimeout(200)
  check('關掉節慶：存進 settings', (await settingsOf(sw.page)).festivalOn === false)
  await sw.page.evaluate(() => localStorage.setItem('gq-fest-date', '2027-02-06'))
  await reload(sw.page)
  await sw.page.waitForTimeout(1500)
  check('關掉節慶：沒有掛飾、不送', (await sw.page.getByTestId('room-festival').count()) === 0 && (await qtyOf(sw.page, 'decor-fest-lion')) === 0)
  await openParentTab(sw.page, '設定')
  await sw.page.getByTestId('festival-switch').click()
  await sw.page.waitForTimeout(200)
  await reload(sw.page)
  await sw.page.waitForSelector('[data-testid=memory-pop]', { timeout: 8000 })
  check('再打開：當節還在就送', (await qtyOf(sw.page, 'decor-fest-lion')) === 1)
  await sw.ctx.close()

  // 五個節慶、三種尺寸的畫面（只在要截圖時）
  if (SHOT_DIR) {
    for (const [name, vp] of Object.entries(SIZES)) {
      const v = await fresh(b, vp)
      for (const f of FESTS) {
        await v.page.evaluate((d) => localStorage.setItem('gq-fest-date', d), f.date)
        await reload(v.page)
        await v.page.waitForSelector('[data-testid=memory-pop]', { timeout: 8000 })
        await v.page.getByTestId('memory-close').click()
        await v.page.waitForTimeout(300)
        const hang = await v.page.evaluate(() => {
          const r = document.querySelector('[data-testid=room-festival]').getBoundingClientRect()
          const s = (q) => document.querySelector(q)?.getBoundingClientRect()
          const o = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
          return { inView: r.left >= 0 && r.right <= innerWidth, hello: o(r, s('.hello')), side: o(r, s('.side-tools')), hud: o(r, s('.pet-hud')) }
        })
        check(`${name} ${f.id}：掛飾在畫面內、不壓頭像、工具列、狀態卡`, hang.inView && !hang.hello && !hang.side && !hang.hud, JSON.stringify(hang))
        await shot(v.page, `fest-${f.id}-${name}`)
      }
      await v.ctx.close()
    }
  }
}

async function testPerChild(b) {
  const { ctx, page } = await fresh(b, LAND)
  await page.evaluate(() => localStorage.setItem('gq-fest-date', '2027-02-06'))
  await reload(page)
  await page.waitForSelector('[data-testid=memory-pop]', { timeout: 8000 })
  await page.getByTestId('memory-close').click()
  await openParentTab(page, '設定')
  await page.getByTestId('kid-add').click()
  await page.getByTestId('kid-name').fill('小花')
  await page.getByTestId('child-age-3').click()
  await page.getByTestId('kid-add-submit').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=kid-row]').length === 2)
  const rows = await page.evaluate(
    () =>
      new Promise((res) => {
        const rq = indexedDB.open('guaibao-registry')
        rq.onsuccess = () => (rq.result.transaction('children').objectStore('children').getAll().onsuccess = (e) => res(e.target.result))
      }),
  )
  const hua = rows.find((k) => k.name === '小花')
  const huaSettings = await page.evaluate(
    (dbName) =>
      new Promise((res) => {
        const rq = indexedDB.open(dbName)
        rq.onsuccess = () => (rq.result.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => res(e.target.result))
      }),
    hua.dbName,
  )
  check('每個孩子各自：小花的存檔還沒有節慶紀錄', !huaSettings.festival, JSON.stringify(huaSettings.festival))
  check('每個孩子各自：第一個孩子有', !!(await settingsOf(page)).festival?.got?.includes('cny'))
  await ctx.close()
}

async function testMap(b) {
  for (const [name, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await fresh(b, vp)
    await page.getByTestId('candy-map').click()
    await page.waitForSelector('[data-testid=map]')
    await page.waitForSelector('[data-testid=map-bgblur]')
    await page.waitForTimeout(400)
    const r = await page.evaluate(() => {
      const bg = document.querySelector('[data-testid=map-bgblur]')
      const b = bg.getBoundingClientRect()
      const sc = document.querySelector('.adv-scene').getBoundingClientRect()
      const scroll = document.querySelector('.adv-scroll').getBoundingClientRect()
      const st = document.querySelector('[data-testid=station-1]').getBoundingClientRect()
      const chest = document.querySelector('[data-testid=chest-node]').getBoundingClientRect()
      const daily = document.querySelector('.adv-daily').getBoundingClientRect()
      return {
        cover: b.left <= 0 && b.top <= 0 && b.right >= innerWidth && b.bottom >= innerHeight,
        image: getComputedStyle(bg).backgroundImage,
        blur: getComputedStyle(bg).filter,
        ratio: sc.width / sc.height,
        sw: scroll.width,
        s1: [(st.left + st.width / 2 - sc.left) / sc.width, (st.top + st.height / 2 - sc.top) / sc.height],
        chest: [(chest.left + chest.width / 2 - sc.left) / sc.width, (chest.top + chest.height / 2 - sc.top) / sc.height],
        dailyBottom: daily.bottom,
        overflow: document.documentElement.scrollWidth - innerWidth,
        portrait: document.querySelector('.adv-scene').dataset.portrait,
      }
    })
    check(`${name}：柔焦背景蓋滿整頁、用同一張場景圖`, r.cover && /scene-map-huaguoshan/.test(r.image) && /blur/.test(r.blur), r.image.slice(-40))
    check(`${name}：沒有橫向溢出`, r.overflow <= 0, String(r.overflow))
    if (name === 'land') {
      check('iPad 橫向：地圖放大（寬 >= 900，原本 676）', r.sw >= 900, String(Math.round(r.sw)))
      check('iPad 橫向：場景維持 16:9', Math.abs(r.ratio - 16 / 9) < 0.02, r.ratio.toFixed(3))
      check('iPad 橫向：第 1 站仍在場景的 (11%, 84%)', Math.abs(r.s1[0] - 0.11) < 0.01 && Math.abs(r.s1[1] - 0.84) < 0.01, r.s1.map((x) => x.toFixed(3)).join())
      check('iPad 橫向：寶箱仍在場景的 (87%, 11%)', Math.abs(r.chest[0] - 0.87) < 0.01 && Math.abs(r.chest[1] - 0.11) < 0.01, r.chest.map((x) => x.toFixed(3)).join())
      check('iPad 橫向：今日冒險一屏看得到', r.dailyBottom <= vp.height, String(Math.round(r.dailyBottom)))
    }
    if (name === 'port') check('iPad 直向：地圖撐滿寬度', r.sw >= vp.width - 40, String(Math.round(r.sw)))
    if (name === 'phone') check('手機：地圖高度不變小', (await rectOf(page, '.adv-scroll')).height >= 299)
    await shot(page, `map-${name}`)
    // 換科目：背景跟著轉色
    await page.getByTestId('subject-english').click()
    await page.waitForTimeout(300)
    const en = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=map-bgblur]')).filter)
    check(`${name}：英文小島的背景跟地圖同色調或用專屬圖`, /blur/.test(en), en)
    check(`${name}：地圖沒有錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

const b = await launch()
try {
  await testFixtures(b)
  await testFestivals(b)
  await testPerChild(b)
  await testMap(b)
} catch (e) {
  check('e2e 沒有中斷', false, String(e))
} finally {
  await b.close()
}
console.log(`\n${IS_WEBKIT ? 'WebKit' : 'Chromium'}：${state.failed ? `FAILED ${state.failed}` : 'ALL PASS'}`)
process.exit(state.failed ? 1 : 0)
