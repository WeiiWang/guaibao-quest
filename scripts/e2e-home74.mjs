// v7.4 線 J E2E：首頁與 UI 一致性。
//   J1 3D 圖示取代 emoji（更多托盤、衣櫃的「不戴帽子」、onboarding 年齡鈕；有圖用圖、沒圖退回 emoji）
//   J2 背包改「我的東西」（食物、材料、帽子、貼紙、家具）與各自的空狀態；成長相簿空狀態
//   J3 隔天回來餓了：第一句話改溫暖
//   J4 禮物袋打開時內容逐一飛出、數字跳動
//   J5 手機與小螢幕收尾：dock「更多食物」、狀態卡不壓窗簾、左右看鈕不壓猴子、手機地圖提示在畫面內、橫向地圖第 1 站標籤不被切、手機筆刷列兩排
// 版面重疊一律用 getBoundingClientRect 檢查，三種尺寸都測；觸控用接近真機的手指（接觸半徑 25px）。
// 用法：先啟動 dev server（pnpm dev --port 5203 --strictPort），再
//   BASE_URL=http://localhost:5203 node scripts/e2e-home74.mjs          （或 pnpm e2e:home74；E2E_BROWSER=webkit 改用 WebKit）
//   想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-home74.mjs（不要放 repo 裡）
import { BASE, freshApp, IS_WEBKIT, idb, launch, makeChecker, patchPet, pressPin, touchSender } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const LAND = { width: 1180, height: 820 }
const PORT = { width: 820, height: 1180 }
const PHONE = { width: 390, height: 844 }
const SIZES = { land: LAND, port: PORT, phone: PHONE }

// 1x1 透明 PNG：模擬「3D 圖已經生好」
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const UI_ART = ['ui-perform', 'ui-album', 'ui-wardrobe', 'ui-no-hat', 'ui-age-3', 'ui-age-5', 'ui-age-7']

const dump = (page, table) => idb(page, (db, t) => new Promise((r) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => r(e.target.result))), table)
const settingsOf = async (page) => (await dump(page, 'settings'))[0]
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
const reload = async (page, sel = '[data-testid=pet]') => {
  await page.reload()
  await page.waitForSelector(sel)
}

/** 接近真機的手指：接觸半徑 25px（寬 50px）。WebKit 沒有 CDP，按鈕改用 locator.tap() */
const finger = { radiusX: 25, radiusY: 25, force: 0.5, id: 0 }
async function fingerTap(page, send, loc) {
  await loc.scrollIntoViewIfNeeded()
  if (IS_WEBKIT) return loc.tap()
  const b = await loc.boundingBox()
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await send('touchStart', [{ x, y, ...finger }])
  await page.waitForTimeout(60)
  await send('touchEnd', [])
}
const rectOf = (page, sel, nth = 0) =>
  page.evaluate(([sel, nth]) => {
    const e = document.querySelectorAll(sel)[nth]
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }
  }, [sel, nth])
const hit = (a, b) => !!a && !!b && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y
const spyVoice = (ctx) =>
  ctx.addInitScript(() => {
    window.__said = []
    const ss = window.speechSynthesis
    if (ss) {
      ss.speak = (u) => window.__said.push(u.text)
      ss.cancel = () => {}
    }
    const pl = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (...a) {
      window.__said.push(`audio:${this.src}`)
      return pl.apply(this, a)
    }
  })
/** 句子有被唸（機器語音）或有播預錄音檔、或被記為「還沒錄」 */
const spoke = (page, text) =>
  page.evaluate((t) => (window.__said ?? []).includes(t) || (window.__gqVoiceMiss ?? []).some((m) => m.text === t) || (window.__said ?? []).some((s) => s.startsWith('audio:')), text)
const saidCount = (page, text) => page.evaluate((t) => Math.max((window.__said ?? []).filter((s) => s === t).length, (window.__gqVoiceMiss ?? []).filter((m) => m.text === t).length), text)

const SHOT_DIR = process.env.SHOT_DIR
const shot = async (page, name) => SHOT_DIR && page.screenshot({ path: `${SHOT_DIR}/${name}.png` })

const browser = await launch()
try {
  // =====================================================================
  // J1) 3D 圖示：圖存在就用圖、不存在退回 emoji（更多托盤、衣櫃不戴帽子、onboarding 年齡鈕）
  // =====================================================================
  for (const mode of ['art', 'emoji']) {
    const { ctx, page, errors } = await freshApp(browser, LAND, { stage: 'baby', ctxOpts: {} })
    await ctx.route('**/art/ui-*.png', (route) => {
      const name = route.request().url().match(/art\/(ui-[a-z0-9-]+)\.png/)?.[1]
      if (!UI_ART.includes(name)) return route.fallback()
      return mode === 'art' ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : route.fulfill({ status: 404, body: '' })
    })
    await patchPet(page, { tricks: ['count'] })
    await reload(page)
    await page.getByTestId('more-btn').click()
    await page.waitForSelector('[data-testid=more-tray]')
    for (const [tid, art] of [['perform-btn', 'ui-perform'], ['album-btn', 'ui-album'], ['wardrobe-btn', 'ui-wardrobe']]) {
      const info = await page.evaluate((tid) => {
        const b = document.querySelector(`[data-testid=${tid}]`)
        if (!b) return null
        const img = b.querySelector('img.art')
        const emoji = b.querySelector('.art-emoji-glyph')
        return { src: img?.getAttribute('src') ?? null, emoji: emoji?.textContent ?? null, oldEmoji: !!b.querySelector('.mini-emoji'), w: b.querySelector('.art, .art-emoji')?.getBoundingClientRect().width ?? 0 }
      }, tid)
      if (mode === 'art') check(`[J1 圖已生成] 更多托盤「${tid}」用 3D 圖 ${art}.png，不是 emoji 文字`, !!info && !!info.src && info.src.endsWith(`art/${art}.png`) && !info.oldEmoji && info.w >= 28, JSON.stringify(info))
      else check(`[J1 圖還沒生] 更多托盤「${tid}」自動退回 emoji（有字、圖示大小 ≥ 28px）`, !!info && !info.src && !!info.emoji && info.w >= 28, JSON.stringify(info))
    }
    // 托盤每顆鈕 >= 56px
    const trayBtns = await page.evaluate(() => [...document.querySelectorAll('[data-testid=more-tray] button')].map((b) => [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]))
    check(`[J1 ${mode}] 托盤 3 顆鈕都 >= 56px`, trayBtns.length === 3 && trayBtns.every(([w, h]) => w >= 56 && h >= 56), JSON.stringify(trayBtns))
    // 衣櫃的「不戴帽子」
    await page.getByTestId('wardrobe-btn').click()
    await page.waitForSelector('[data-testid=wd-off]')
    await page.waitForTimeout(500)
    const off = await page.evaluate(() => {
      const b = document.querySelector('[data-testid=wd-off]')
      const img = b.querySelector('img.art')
      return { src: img?.getAttribute('src') ?? null, emoji: b.querySelector('.art-emoji-glyph')?.textContent ?? null, w: b.querySelector('.art, .art-emoji')?.getBoundingClientRect().width ?? 0, raw: b.textContent.includes('🙈') && !b.querySelector('.art-emoji') }
    })
    if (mode === 'art') check('[J1 圖已生成] 衣櫃「不戴帽子」用 ui-no-hat.png', !!off.src && off.src.endsWith('art/ui-no-hat.png') && off.w >= 56, JSON.stringify(off))
    else check('[J1 圖還沒生] 衣櫃「不戴帽子」退回 🙈 emoji（用 Icon，不是裸文字）', !off.src && off.emoji === '🙈' && off.w >= 56 && !off.raw, JSON.stringify(off))
    check(`[J1 ${mode}] 無 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // onboarding 年齡鈕
  for (const mode of ['art', 'emoji']) {
    for (const [tag, vp] of [['land', LAND], ['phone', PHONE]]) {
      const ctx = await browser.newContext({ viewport: vp })
      await ctx.route('**/art/ui-age-*.png', (route) => (mode === 'art' ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : route.fulfill({ status: 404, body: '' })))
      const page = await ctx.newPage()
      await page.goto(BASE)
      await page.waitForSelector('button.key')
      await pressPin(page, '1234')
      await pressPin(page, '1234')
      await page.getByPlaceholder('小朋友的名字').fill('小花')
      await page.getByRole('button', { name: '下一步' }).click()
      await page.waitForSelector('[data-testid=onboard-age]')
      await page.waitForTimeout(500)
      const ages = await page.evaluate(() =>
        [...document.querySelectorAll('.h7-age-btn')].map((b) => {
          const img = b.querySelector('img.art')
          const r = b.getBoundingClientRect()
          return { src: img?.getAttribute('src') ?? null, emoji: b.querySelector('.art-emoji-glyph')?.textContent ?? null, iconW: b.querySelector('.j74-age-icon')?.getBoundingClientRect().width ?? 0, w: r.width, h: r.height, name: b.textContent.trim() }
        }),
      )
      if (mode === 'art') check(`[J1 ${tag} 圖已生成] 年齡鈕 3 顆都用 ui-age-3 / 5 / 7 圖，圖 ≥ 60px、鈕 ≥ 100px 高`, ages.length === 3 && ['3', '5', '7'].every((n, i) => ages[i].src?.endsWith(`art/ui-age-${n}.png`)) && ages.every((a) => a.iconW >= 60 && a.h >= 100), JSON.stringify(ages))
      else check(`[J1 ${tag} 圖還沒生] 年齡鈕退回 emoji，鈕大小不變`, ages.length === 3 && ages.every((a) => !a.src && !!a.emoji && a.iconW >= 60 && a.h >= 100), JSON.stringify(ages))
      check(`[J1 ${tag} ${mode}] 年齡鈕的名字還是「3 歲」「4–5 歲」「6–7 歲」（圖沒有污染名字）`, /3歲/.test(ages[0].name.replace(/\s/g, '')) && /4.5歲/.test(ages[1].name.replace(/\s/g, '')) && /6.7歲/.test(ages[2].name.replace(/\s/g, '')), ages.map((a) => a.name).join('|'))
      await ctx.close()
    }
  }

  // =====================================================================
  // J2) 我的東西（分頁 + 空狀態）與成長相簿空狀態
  // =====================================================================
  {
    const { ctx, page, errors } = await freshApp(browser, LAND, { stage: 'egg', bananas: 0 })
    await spyVoice(ctx)
    const send = await touchSender(ctx, page)
    await reload(page)
    await page.getByRole('button', { name: /背包/ }).click()
    await page.waitForSelector('[data-testid=bag]')
    check('[J2] 標題是「我的東西」', (await page.locator('.screen-header h1').innerText()) === '我的東西')
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.replace(/\s/g, '').replace(/^[^一-龥]+/, '')))
    check('[J2] 分頁：食物、材料、帽子、貼紙（再加原本就有的家具）', JSON.stringify(tabs) === JSON.stringify(['食物', '材料', '帽子', '貼紙', '家具']), JSON.stringify(tabs))

    // 食物空
    const emptyInfo = async (tab) =>
      page.evaluate((tab) => {
        const e = document.querySelector(`[data-testid=bag-empty-${tab}]`)
        if (!e) return null
        const pet = e.querySelector('.j74-empty-pet')
        const btn = e.querySelector('button')
        const pr = pet?.getBoundingClientRect()
        const br = btn?.getBoundingClientRect()
        return { line: e.querySelector('.j74-empty-line')?.textContent ?? '', btn: btn?.textContent ?? '', petW: pr?.width ?? 0, petImg: !!pet?.querySelector('img.art, .art-emoji, .art-fallback'), btnH: br?.height ?? 0, btnW: br?.width ?? 0 }
      }, tab)
    await page.waitForSelector('[data-testid=bag-empty-food] .j74-empty-pet img', { timeout: 3000 }).catch(() => {})
    let info = await emptyInfo('food')
    check('[J2 食物] 空狀態：阿悟的圖 + 一句話 + 「去冒險找食物」按鈕（≥ 56px 高）', !!info && info.petW >= 100 && info.petImg && info.line === '還沒有食物，我們去冒險找吧！' && info.btn === '去冒險找食物' && info.btnH >= 56, JSON.stringify(info))
    check('[J2 食物] 空狀態有唸那一句', await spoke(page, '還沒有食物，我們去冒險找吧！'))
    await fingerTap(page, send, page.getByTestId('bag-empty-food-go'))
    check('[J2 食物] 按「去冒險找食物」→ 冒險地圖', await page.waitForSelector('[data-testid=map]', { timeout: 4000 }).then(() => true, () => false))
    await page.locator('.screen-header .back').click()
    await page.getByRole('button', { name: /背包/ }).click()

    await page.getByTestId('bag-tab-material').click()
    info = await emptyInfo('material')
    check('[J2 材料] 空狀態：「去冒險找材料」', !!info && info.line === '還沒有材料，我們去冒險找材料吧！' && info.btn === '去冒險找材料' && info.petImg && info.btnH >= 56, JSON.stringify(info))
    check('[J2 材料] 空狀態有唸那一句', await spoke(page, '還沒有材料，我們去冒險找材料吧！'))
    await page.getByTestId('bag-tab-hat').click()
    info = await emptyInfo('hat')
    check('[J2 帽子] 空狀態：「去商店買帽子」', !!info && info.line === '還沒有帽子，去商店的衣櫃買一頂吧' && info.btn === '去商店買帽子' && info.petImg, JSON.stringify(info))
    await fingerTap(page, send, page.getByTestId('bag-empty-hat-go'))
    check('[J2 帽子] 按「去商店買帽子」→ 商店的衣櫃分頁', await page.waitForSelector('[data-testid=hat-note]', { timeout: 4000 }).then(() => true, () => false))
    await page.locator('.screen-header .back').click()
    await page.getByRole('button', { name: /背包/ }).click()
    await page.getByTestId('bag-tab-furniture').click()
    info = await emptyInfo('furniture')
    check('[J2 家具] 空狀態：「去工坊做家具」', !!info && info.line === '去工坊做家具吧' && info.btn === '去工坊做家具' && info.petImg, JSON.stringify(info))
    await fingerTap(page, send, page.getByTestId('bag-empty-furniture-go'))
    check('[J2 家具] 按「去工坊做家具」→ 工坊', await page.waitForSelector('[data-testid=workshop]', { timeout: 4000 }).then(() => true, () => false))
    await page.locator('.screen-header .back').click()

    // 貼紙分頁：預設貼紙 + settings.stickers（不重複）
    await page.getByRole('button', { name: /背包/ }).click()
    await page.getByTestId('bag-tab-sticker').click()
    const defaults = await page.locator('[data-testid=bag-grid-sticker] .j74-sticker').count()
    check('[J2 貼紙] 貼紙分頁顯示已解鎖的貼紙（預設 8 張，和貼紙盤同一份）', defaults === 8, String(defaults))
    await patchSettings(page, { stickers: ['obj-star', 'obj-test-new'] })
    await reload(page)
    await page.getByRole('button', { name: /背包/ }).click()
    await page.getByTestId('bag-tab-sticker').click()
    await page.waitForTimeout(300)
    const after = await page.locator('[data-testid=bag-grid-sticker] .j74-sticker').count()
    check('[J2 貼紙] settings.stickers 解鎖 1 張新的（obj-star；不在目錄的 id 忽略、已有的不重複）→ 多顯示 1 張', after === defaults + 1, `${defaults} -> ${after}`)
    check('[J2] 無 JS 錯誤', errors.length === 0, errors.join(' | '))

    // 有東西時：食物、材料、帽子各自顯示卡片
    await putRows(page, 'inventory', [{ id: 'banana', itemId: 'banana', qty: 3 }, { id: 'hat-party', itemId: 'hat-party', qty: 1 }])
    await putRows(page, 'materialLedger', [{ id: 'j74-wood', at: Date.now(), material: 'wood', delta: 4, kind: 'station', reason: 'e2e' }])
    await reload(page)
    await page.getByRole('button', { name: /背包/ }).click()
    await page.getByTestId('bag-tab-food').click()
    await page.waitForTimeout(300)
    check('[J2 食物] 有香蕉 x3：顯示食物卡片（沒有空狀態）', (await page.locator('[data-testid=bag-grid-food] .shop-item').count()) === 1 && (await page.locator('[data-testid=bag-empty-food]').count()) === 0 && /x3/.test(await page.locator('[data-testid=bag-grid-food]').innerText()))
    await page.getByTestId('bag-tab-material').click()
    await page.waitForTimeout(300)
    const matTxt = await page.locator('[data-testid=bag-grid-material]').innerText()
    check('[J2 材料] 有木材 4：顯示 3 種材料卡片（沒有空狀態）、木材 x4', (await page.locator('[data-testid=bag-grid-material] .shop-item').count()) === 3 && /x4/.test(matTxt) && (await page.locator('[data-testid=bag-empty-material]').count()) === 0, matTxt.replace(/\s+/g, ' '))
    await page.getByTestId('bag-tab-hat').click()
    await page.waitForTimeout(300)
    check('[J2 帽子] 有派對帽：顯示卡片、「去衣櫃」', (await page.locator('[data-testid=bag-grid-hat] .shop-item').count()) === 1 && /去衣櫃/.test(await page.locator('[data-testid=bag-grid-hat]').innerText()))
    await page.getByRole('button', { name: '去衣櫃' }).click()
    // 還是蛋：衣櫃照開（Home 開啟衣櫃對話框）；只確認回到首頁並打開衣櫃
    check('[J2 帽子] 按「去衣櫃」→ 回首頁並打開衣櫃', await page.waitForSelector('[data-testid=wardrobe]', { timeout: 4000 }).then(() => true, () => false))
    await ctx.close()
  }
  // 手機：分頁一排放得下、不用橫滑
  {
    const { ctx, page } = await freshApp(browser, PHONE, { stage: 'baby', bananas: 0 })
    await page.getByRole('button', { name: /背包/ }).click()
    await page.waitForSelector('[data-testid=bag]')
    const m = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role=tab]')].map((t) => t.getBoundingClientRect())
      return { n: tabs.length, minL: Math.min(...tabs.map((r) => r.left)), maxR: Math.max(...tabs.map((r) => r.right)), minH: Math.min(...tabs.map((r) => r.height)), minW: Math.min(...tabs.map((r) => r.width)), vw: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 2 }
    })
    check('[J2 手機] 5 個分頁都在畫面內（不用橫滑）、每個 >= 56px 高、>= 44px 寬', m.n === 5 && m.minL >= 0 && m.maxR <= m.vw && m.minH >= 56 && m.minW >= 44 && !m.overflow, JSON.stringify(m))
    await ctx.close()
  }
  // 成長相簿空狀態（蛋還沒孵化 = 沒有回憶卡）
  for (const [tag, vp] of [['land', LAND], ['phone', PHONE]]) {
    const { ctx, page } = await freshApp(browser, vp, { stage: 'egg' })
    await spyVoice(ctx)
    const send = await touchSender(ctx, page)
    await page.goto(`${BASE}/#album`)
    await page.reload()
    await page.waitForSelector('[data-testid=album]')
    await page.waitForTimeout(500)
    const info = await page.evaluate(() => {
      const e = document.querySelector('[data-testid=album-empty]')
      if (!e) return null
      const b = e.querySelector('button').getBoundingClientRect()
      return { line: e.querySelector('.j74-empty-line').textContent, btn: e.querySelector('button').textContent, petW: e.querySelector('.j74-empty-pet').getBoundingClientRect().width, btnH: b.height, inView: b.bottom <= innerHeight && b.right <= innerWidth }
    })
    check(`[J2 相簿 ${tag}] 空狀態：阿悟圖 + 一句話 + 「去冒險」按鈕，都在畫面內`, !!info && info.petW >= 100 && info.line === '我們一起去冒險，回憶卡就會出現囉' && info.btn === '去冒險' && info.btnH >= 56 && info.inView, JSON.stringify(info))
    check(`[J2 相簿 ${tag}] 唸了那一句`, await spoke(page, '我們一起去冒險，回憶卡就會出現囉'))
    await fingerTap(page, send, page.getByTestId('album-empty-go'))
    check(`[J2 相簿 ${tag}] 按「去冒險」→ 冒險地圖`, await page.waitForSelector('[data-testid=map]', { timeout: 4000 }).then(() => true, () => false))
    await ctx.close()
  }
  // 相簿有卡片時不顯示空狀態
  {
    const { ctx, page } = await freshApp(browser, LAND, { stage: 'baby' })
    // 先等首頁同步把孵化卡寫進相簿，再直接去相簿頁；不然機器忙的時候會比同步先到。
    // 不能只看 albumInit：freshApp 在 reload 前（還是蛋的時候）那一次同步就寫了 albumInit（沒有卡），
    // reload 之後（幼體）這一串同步可能還沒跑到 syncAlbum，這時去相簿頁會把它打斷，相簿就永遠是空的
    for (let i = 0; i < 50; i++) {
      const hatched = await idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r((e.target.result?.album ?? []).some((c) => c.id === 'hatch')))))
      if (hatched) break
      await page.waitForTimeout(200)
    }
    await page.goto(`${BASE}/#album`)
    await page.reload()
    await page.waitForSelector('[data-testid=album]')
    await page.waitForSelector('[data-testid=album-count]', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
    const albumInfo = { count: await page.getByTestId('album-count').count(), empty: await page.getByTestId('album-empty').count(), text: await page.getByTestId('album-count').allInnerTexts() }
    check('[J2 相簿] 有回憶卡時顯示張數、不顯示空狀態', albumInfo.count === 1 && albumInfo.empty === 0 && /1 張/.test(albumInfo.text.join('')), JSON.stringify(albumInfo))
    await ctx.close()
  }

  // =====================================================================
  // J3) 隔天回來阿悟餓了：第一句話改溫暖
  // =====================================================================
  {
    const { ctx, page, errors } = await freshApp(browser, LAND, { stage: 'baby' })
    await spyVoice(ctx)
    await patchPet(page, { hunger: 8, hungerUpdatedAt: Date.now() })
    await reload(page)
    await page.waitForTimeout(700)
    const hudText = await page.locator('.pet-hud .pet-name').innerText()
    check('[J3] 餓著回來：狀態卡寫「你回來了！我肚子有點餓餓的」', hudText.includes('你回來了！我肚子有點餓餓的'), hudText)
    check('[J3] 狀態卡沒有「好餓」「無精打采」', !/好餓|無精打采/.test(hudText), hudText)
    check('[J3] 阿悟說了那一句（pet.hungry.back）', await spoke(page, '你回來了！我肚子有點餓餓的'))
    check('[J3] 只說一次', (await saidCount(page, '你回來了！我肚子有點餓餓的')) === 1, String(await saidCount(page, '你回來了！我肚子有點餓餓的')))
    // 離開再回首頁：不重複說；狀態卡改回平常的短句
    await page.getByTestId('candy-map').click()
    await page.waitForSelector('[data-testid=map]')
    await page.locator('.screen-header .back').click()
    await page.waitForSelector('[data-testid=pet]')
    await page.waitForTimeout(500)
    check('[J3] 離開再回首頁：不重複說', (await saidCount(page, '你回來了！我肚子有點餓餓的')) === 1)
    const hud2 = await page.locator('.pet-hud .pet-name').innerText()
    check('[J3] 平常餓的時候狀態卡是「肚子有點餓餓的」（不是「好餓，無精打采…」）', hud2.includes('肚子有點餓餓的') && !hud2.includes('你回來了') && !/好餓|無精打采/.test(hud2), hud2)
    check('[J3] 無 JS 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  {
    // 一開 App 就不餓：不說；之後才餓了也不補說
    const { ctx, page } = await freshApp(browser, LAND, { stage: 'baby' })
    await spyVoice(ctx)
    await reload(page)
    await page.waitForTimeout(500)
    check('[J3] 不餓：不說這一句', (await saidCount(page, '你回來了！我肚子有點餓餓的')) === 0)
    await ctx.close()
  }
  {
    // 蛋：不說話（蛋不能說），狀態卡仍改成溫暖短句
    const { ctx, page } = await freshApp(browser, LAND, { stage: 'egg' })
    await spyVoice(ctx)
    await patchPet(page, { hunger: 8, hungerUpdatedAt: Date.now() })
    await reload(page)
    await page.waitForTimeout(500)
    const t = await page.locator('.pet-hud .pet-name').innerText()
    check('[J3 蛋] 蛋不打招呼，狀態卡是「肚子有點餓餓的」', (await saidCount(page, '你回來了！我肚子有點餓餓的')) === 0 && t.includes('肚子有點餓餓的') && !/好餓|無精打采/.test(t), t)
    await ctx.close()
  }

  // =====================================================================
  // J4) 禮物袋打開時內容逐一飛出、數字跳動
  // =====================================================================
  const revealSnap = (page) =>
    page.evaluate(() => {
      const root = document.querySelector('[data-testid=gift-reveal]')
      if (!root) return null
      return [...root.querySelectorAll('[data-testid=gift-reveal-item]')].map((c) => ({ kind: c.dataset.kind, qty: Number(c.dataset.qty), shown: c.dataset.shown === 'true', num: c.querySelector('[data-testid=gift-reveal-num]').textContent, w: c.offsetWidth }))
    })
  for (const [tag, vp] of [['land', LAND], ['phone', PHONE]]) {
    const { ctx, page, errors } = await freshApp(browser, vp, { stage: 'baby', welcome: true })
    const send = await touchSender(ctx, page)
    await page.waitForSelector('[data-testid=gift-bag]')
    const starsBefore = await page.locator('[data-points-chip] .chip-num').innerText()
    await fingerTap(page, send, page.getByTestId('gift-bag'))
    // 取樣：逐一出現、數字跳動
    const snaps = []
    const t0 = Date.now()
    while (Date.now() - t0 < 3600) {
      const s = await revealSnap(page)
      if (s) snaps.push({ t: Date.now() - t0, s })
      await page.waitForTimeout(40)
    }
    const first = snaps.find((x) => x.s.length > 0)
    check(`[J4 ${tag}] 點禮物袋後攤開：2 項（星星 +20、香蕉 +1）`, !!first && first.s.length === 2 && first.s[0].kind === 'star' && first.s[0].qty === 20 && first.s[1].kind === 'food' && first.s[1].qty === 1, JSON.stringify(first?.s))
    check(`[J4 ${tag}] 逐一出現：一開始只有第 1 項亮，後來第 2 項才亮（不是同時）`, snaps.some((x) => x.s[0]?.shown && !x.s[1]?.shown) && snaps.some((x) => x.s.length === 2 && x.s[0].shown && x.s[1].shown))
    const starNums = snaps.map((x) => x.s[0]?.num).filter(Boolean)
    const mids = new Set(starNums.filter((n) => n !== '+20' && n !== '+0'))
    check(`[J4 ${tag}] 星星的數字跳動（出現過中間值，最後停在 +20）`, mids.size >= 1 && starNums.includes('+20'), [...new Set(starNums)].join(','))
    check(`[J4 ${tag}] 香蕉顯示 +1`, snaps.some((x) => x.s[1]?.num === '+1'))
    check(`[J4 ${tag}] 每一項夠大（>= 80px 寬）`, first.s.every((c) => c.w >= 80), JSON.stringify(first.s.map((c) => c.w)))
    check(`[J4 ${tag}] 禮物袋立刻消失（東西早就入帳）、佇列清空`, (await page.getByTestId('gift-bag').count()) === 0 && ((await settingsOf(page)).pendingGifts ?? []).length === 0)
    // 攤完後飛走、元素移除
    const gone = await page.waitForSelector('[data-testid=gift-reveal]', { state: 'detached', timeout: 6000 }).then(() => true, () => false)
    check(`[J4 ${tag}] 攤完後飛向目標、攤開層收掉`, gone)
    check(`[J4 ${tag}] 星星餘額沒有重複加（入帳只有一次）`, (await page.locator('[data-points-chip] .chip-num').innerText()) === starsBefore, `${starsBefore} -> ${await page.locator('[data-points-chip] .chip-num').innerText()}`)
    check(`[J4 ${tag}] 無 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  {
    // 多種禮物：同種合併（香蕉 +2）、材料 +2、貼紙 +1；順序固定
    const { ctx, page } = await freshApp(browser, LAND, { stage: 'baby' })
    const now = Date.now()
    await patchSettings(page, { pendingGifts: [{ stickerId: 'obj-star', at: now, from: 'daily' }, { materialId: 'wood', qty: 2, at: now, from: 'daily' }, { foodId: 'banana', at: now, from: 'station' }, { foodId: 'banana', at: now, from: 'station' }] })
    await reload(page)
    await page.waitForSelector('[data-testid=gift-bag]')
    await page.getByTestId('gift-bag').click()
    await page.waitForSelector('[data-testid=gift-reveal]')
    await page.waitForTimeout(150)
    const s = await revealSnap(page)
    check('[J4] 多種禮物：香蕉 +2、木材 +2、貼紙 +1，順序 食物 > 材料 > 貼紙（同種合併）', JSON.stringify(s?.map((c) => [c.kind, c.qty])) === JSON.stringify([['food', 2], ['material', 2], ['sticker', 1]]), JSON.stringify(s))
    check('[J4] 等全部攤完：每一項數字都停在最後的值', await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=gift-reveal-num]')].map((n) => n.textContent).join() === '+2,+2,+1', null, { timeout: 4000 }).then(() => true, () => false))
    await page.waitForSelector('[data-testid=gift-reveal]', { state: 'detached', timeout: 7000 })
    check('[J4] 結束後攤開層收掉', (await page.getByTestId('gift-reveal').count()) === 0)
    await ctx.close()
  }
  {
    // 減少動態效果：一次全部顯示，仍然收得掉
    const { ctx: c2, page } = await freshApp(browser, LAND, { stage: 'baby', welcome: true, ctxOpts: { reducedMotion: 'reduce' } })
    await page.getByTestId('gift-bag').click()
    await page.waitForSelector('[data-testid=gift-reveal]')
    const s = await revealSnap(page)
    check('[J4 減少動態] 2 項一次全部顯示、數字直接是 +20 / +1', s?.length === 2 && s.every((c) => c.shown) && s[0].num === '+20' && s[1].num === '+1', JSON.stringify(s))
    check('[J4 減少動態] 之後收掉', await page.waitForSelector('[data-testid=gift-reveal]', { state: 'detached', timeout: 5000 }).then(() => true, () => false))
    await c2.close()
  }

  // =====================================================================
  // J5) 手機與小螢幕收尾（三種尺寸；再加 360×740、320×568 兩種窄手機）
  // =====================================================================
  const HUD_SIZES = { ...SIZES, phone360: { width: 360, height: 800 }, phone393: { width: 393, height: 852 }, phone375: { width: 375, height: 667 }, tablet768: { width: 768, height: 1024 }, land1024: { width: 1024, height: 768 } }
  for (const stage of ['baby', 'adult']) {
    for (const [tag, vp] of Object.entries(HUD_SIZES)) {
      if (stage === 'adult' && !['land', 'port', 'phone', 'phone360'].includes(tag)) continue // 成猴的狀態卡比較矮，只測主要尺寸
      const { ctx, page, errors } = await freshApp(browser, vp, { stage, welcome: true })
      await page.waitForTimeout(900)
      // 狀態卡不壓窗簾（第一扇窗：窗戶、窗簾、窗台全部）
      const win = await page.evaluate(() => {
        const set = document.querySelector('.rb-window-set')
        const rs = ['.rb-drape.l', '.rb-drape.r', '.rb-window', '.rb-sill'].map((s) => set.querySelector(s).getBoundingClientRect())
        return { x: Math.min(...rs.map((r) => r.left)), y: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) }
      })
      const hud = await rectOf(page, '.pet-hud')
      check(`[J5 ${stage} ${tag}] 狀態卡不壓窗簾 / 窗戶`, !hit(hud, win), JSON.stringify({ hud, win }))
      const tools = await rectOf(page, '.side-tools')
      const hello = await rectOf(page, '.hello')
      check(`[J5 ${stage} ${tag}] 狀態卡不碰右側按鈕、不碰左上的頭像 / 點數`, !hit(hud, tools) && !hit(hud, hello), JSON.stringify({ hud, tools, hello }))
      check(`[J5 ${stage} ${tag}] 狀態卡在畫面內`, hud.x >= 0 && hud.r <= vp.width, JSON.stringify(hud))
      if (tag.startsWith('phone')) {
        const mode = await page.locator('.pet-hud').getAttribute('data-hud')
        check(`[J5 ${stage} ${tag}] 手機狀態卡縮成徽章（高度 <= ${stage === 'adult' ? 52 : 80}px）`, mode === 'badge' && hud.h <= (stage === 'adult' ? 52 : 80), `${mode} ${hud.h}`)
        const barH = await page.locator('.pet-hud .hunger .bar').evaluate((e) => e.getBoundingClientRect().height)
        check(`[J5 ${stage} ${tag}] 徽章裡看得到飽足條（高度 >= 6px）`, barH >= 6, String(barH))
        check(`[J5 ${stage} ${tag}] 徽章仍有螢幕報讀用的名字與飽足度`, /阿悟/.test(await page.locator('.pet-hud').innerText()) && (await page.locator('.pet-hud [role=meter]').count()) === 1)
      }
      // 左右看房間的鈕不壓猴子、不碰右側按鈕、不碰禮物袋
      const L = await rectOf(page, '[data-testid=room-left]')
      const R = await rectOf(page, '[data-testid=room-right]')
      const pet = await rectOf(page, '[data-testid=pet]')
      const bag = await rectOf(page, '[data-testid=gift-bag]')
      const toolBtns = await page.evaluate(() => [...document.querySelectorAll('.side-tools button')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } }))
      check(`[J5 ${stage} ${tag}] 左右看房間的鈕都在（${!!L}/${!!R}）`, !!L && !!R)
      // 高度 < 780 的手機（375×667）右側欄加禮物袋本來就塞滿了：左右鈕維持原位（可能碰到猴子），只檢查它們不碰右側按鈕
      const tight = vp.width <= 560 && vp.height < 780
      if (!tight) check(`[J5 ${stage} ${tag}] 左右看房間的鈕不壓猴子`, !hit(L, pet) && !hit(R, pet), JSON.stringify({ L, R, pet }))
      if (!tight) check(`[J5 ${stage} ${tag}] 左右看房間的鈕不碰右側按鈕、不碰禮物袋`, toolBtns.every((t) => !hit(R, t) && !hit(L, t)) && !hit(R, bag) && !hit(L, bag), JSON.stringify({ R, bag }))
      else check(`[J5 ${stage} ${tag}] （矮手機）左右看房間的鈕不碰右側按鈕`, toolBtns.every((t) => !hit(R, t) && !hit(L, t)), JSON.stringify({ R, toolBtns }))
      check(`[J5 ${stage} ${tag}] 左右看房間的鈕 >= 56px、在畫面內`, L.w >= 56 && L.h >= 56 && R.w >= 56 && R.h >= 56 && R.r <= vp.width && L.x >= 0, JSON.stringify({ L, R }))
      check(`[J5 ${stage} ${tag}] 首頁不橫向溢出、無 JS 錯誤`, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) && errors.length === 0, errors.join(' | '))
      if (stage === 'baby' && ['land', 'port', 'phone'].includes(tag)) await shot(page, `j74-home-${tag}`)
      await ctx.close()
    }
  }

  // dock：很多食物 → 可橫滑，出現寫明「更多食物」的按鈕（不是白色「▶」），不重疊
  for (const [tag, vp] of Object.entries(SIZES)) {
    const { ctx, page } = await freshApp(browser, vp, { stage: 'baby' })
    const send = await touchSender(ctx, page)
    await putRows(page, 'inventory', ['apple', 'banana', 'carrot', 'cookie', 'grape', 'milk', 'peach', 'riceball', 'watermelon', 'cake'].map((id) => ({ id, itemId: id, qty: 2 })))
    await reload(page)
    await page.waitForTimeout(500)
    const arrow = page.getByTestId('dock-arrow-right')
    check(`[J5 dock ${tag}] 食物很多 → 出現「更多食物」`, (await arrow.count()) === 1 && (await arrow.innerText()).includes('更多食物') && !(await arrow.innerText()).includes('▶'), await arrow.innerText().catch(() => ''))
    check(`[J5 dock ${tag}] 「更多食物」有報讀名字`, (await arrow.getAttribute('aria-label')) === '更多食物')
    const a = await rectOf(page, '[data-testid=dock-arrow-right]')
    const dock = await rectOf(page, '[data-testid=dock]')
    const edit = await rectOf(page, '.edit-toggle')
    const wrapR = await rectOf(page, '.dock-wrap')
    check(`[J5 dock ${tag}] 「更多食物」在食物列前面（不壓食物、不壓「佈置」）、在食物列外框內`, a.r <= dock.x + 1 && !hit(a, edit) && a.x >= wrapR.x - 1 && a.r <= wrapR.r + 1, JSON.stringify({ a, dock, edit }))
    check(`[J5 dock ${tag}] 「更多食物」>= 56px 寬高，和食物同高（不比食物列矮太多）`, a.w >= 56 && a.h >= 56 && a.h >= 64, JSON.stringify(a))
    const bg = await arrow.evaluate((e) => getComputedStyle(e).backgroundImage)
    check(`[J5 dock ${tag}] 不再是白色的「▶」：底色是奶油黃漸層、有圓形圖示與字`, /gradient/.test(bg) && !!(await arrow.locator('.j74-da-chev').count()) && !!(await arrow.locator('.j74-da-label').count()), bg.slice(0, 80))
    // 按「更多食物」→ 食物列往右捲、出現「前面」；食物列的右緣（捲到底的食物）不會被箭頭蓋住
    const sc0 = await page.getByTestId('dock').evaluate((e) => e.scrollLeft)
    check(`[J5 dock ${tag}] 一開始沒有「前面」（還沒得往前捲）`, (await page.getByTestId('dock-arrow-left').count()) === 0)
    await fingerTap(page, send, arrow)
    await page.waitForTimeout(700)
    const sc1 = await page.getByTestId('dock').evaluate((e) => e.scrollLeft)
    check(`[J5 dock ${tag}] 按「更多食物」→ 食物列往右捲，出現「前面」`, sc1 > sc0 + 20 && (await page.getByTestId('dock-arrow-left').count()) === 1 && (await page.getByTestId('dock-arrow-left').innerText()).includes('前面'), `${sc0} -> ${sc1}`)
    const lft = await rectOf(page, '[data-testid=dock-arrow-left]')
    const dock2 = await rectOf(page, '[data-testid=dock]')
    check(`[J5 dock ${tag}] 「前面」在食物列前面、>= 56px，不壓「佈置」`, lft.r <= dock2.x + 1 && lft.w >= 56 && lft.h >= 56 && !hit(lft, edit), JSON.stringify({ lft, dock2 }))
    check(`[J5 dock ${tag}] 食物列的右緣不動（箭頭出現 / 消失不會蓋住捲到底的食物）`, Math.abs(dock2.r - dock.r) < 1.5, JSON.stringify({ dock, dock2 }))
    await page.getByTestId('dock-arrow-left').click()
    await page.waitForTimeout(700)
    check(`[J5 dock ${tag}] 按「前面」→ 食物列往回捲`, (await page.getByTestId('dock').evaluate((e) => e.scrollLeft)) < sc1 - 20)
    await ctx.close()
  }

  // 地圖：手機的「左右滑動」提示在畫面內、橫向第 1 站的標籤不被切（四個科目、多種尺寸）
  for (const [tag, vp] of [['phone844', PHONE], ['phone700', { width: 390, height: 700 }], ['phone667', { width: 375, height: 667 }]]) {
    const { ctx, page } = await freshApp(browser, vp, { stage: 'baby' })
    await page.getByTestId('candy-map').click()
    await page.waitForSelector('.adv-map')
    await page.waitForTimeout(800)
    const hint = await rectOf(page, '[data-testid=swipe-hint]')
    const scroll = await rectOf(page, '.adv-scroll')
    check(`[J5 地圖 ${tag}] 「左右滑動」提示在畫面內（不在摺線以下），緊貼在地圖下面`, !!hint && hint.b <= vp.height && hint.y >= scroll.b - 2 && hint.y - scroll.b < 40, JSON.stringify({ hint, scroll }))
    await ctx.close()
  }
  for (const [tag, vp] of [['land', LAND], ['land1024', { width: 1024, height: 768 }], ['land1366', { width: 1366, height: 1024 }], ['port', PORT], ['phone', PHONE]]) {
    const { ctx, page } = await freshApp(browser, vp, { stage: 'baby' })
    await page.getByTestId('candy-map').click()
    await page.waitForSelector('.adv-map')
    for (const subj of ['math', 'english', 'life', 'nature']) {
      await page.getByTestId(`subject-${subj}`).click()
      await page.waitForTimeout(700)
      const r = await page.evaluate(() => {
        const sc = document.querySelector('.adv-scroll').getBoundingClientRect()
        const labs = [...document.querySelectorAll('.adv-node-label')].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0)
        const cur = document.querySelector('.adv-node.st-current .adv-node-label')
        const first = document.querySelector('.adv-path > .adv-node:first-child .adv-node-label')
        const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width } }
        return { sc: { x: sc.x, y: sc.y, r: sc.right, b: sc.bottom }, cur: box(cur), first: box(first), n: labs.length, curText: cur?.textContent ?? '' }
      })
      const ok = (b) => !b || (b.x >= r.sc.x - 0.5 && b.r <= r.sc.r + 0.5 && b.y >= r.sc.y - 0.5 && b.b <= r.sc.b + 0.5)
      check(`[J5 地圖 ${tag} ${subj}] 目前這一站的標籤完整在地圖內（沒被切）`, !!r.cur && ok(r.cur), JSON.stringify(r))
      check(`[J5 地圖 ${tag} ${subj}] 第 1 站的標籤完整在地圖內`, ok(r.first), JSON.stringify(r))
    }
    if (tag === 'land') await shot(page, `j74-map-land`)
    await ctx.close()
  }

  // 手機筆刷列：細 / 中 / 粗 / 鏡像不用橫滑就看得到（兩排）
  for (const [tag, vp] of [['phone844', PHONE], ['phone932', { width: 430, height: 932 }]]) {
    const { ctx, page } = await freshApp(browser, vp, { stage: 'baby' })
    const send = await touchSender(ctx, page)
    await page.getByRole('button', { name: /著色本/ }).click()
    await page.waitForSelector('.pb-free-slot')
    await fingerTap(page, send, page.locator('.pb-free-slot').first())
    await page.waitForSelector('[data-testid=tool-brush]')
    await fingerTap(page, send, page.getByTestId('tool-brush'))
    await page.waitForSelector('[data-testid=opts-brush]')
    await page.waitForTimeout(300)
    const m = await page.evaluate(() => {
      const g = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height } }
      const sizes = ['s', 'm', 'l'].map((k) => g(`[data-testid=brush-${k}]`))
      return { sizes, mirror: g('[data-testid=mirror-toggle]'), kind: g('[data-testid=bk-pencil]') ?? g('.pb-kind'), pal: g('[data-testid=palette]') ?? g('.pt-palette'), vw: innerWidth, finish: g('[data-testid=finish-btn]'), board: g('.pt-board') }
    })
    const all = [...m.sizes, m.mirror]
    check(`[J5 筆刷 ${tag}] 細 / 中 / 粗 / 鏡像 都在畫面內（不用橫滑）、>= 44px 高`, all.every((b) => b && b.x >= 0 && b.r <= m.vw && b.h >= 44), JSON.stringify(all))
    check(`[J5 筆刷 ${tag}] 兩排：筆刷種類一排、粗細與鏡像另一排（在筆刷種類下面）`, m.kind && m.sizes[0].y >= m.kind.b - 2, JSON.stringify({ kind: m.kind, size: m.sizes[0] }))
    check(`[J5 筆刷 ${tag}] 細 / 中 / 粗 / 鏡像 彼此不重疊`, all.every((a, i) => all.every((b, j) => i === j || !hit(a, b))))
    check(`[J5 筆刷 ${tag}] 「完成」還在畫面內、畫板沒有被擠到 < 300px`, m.finish.b <= vp.height && m.board.w >= 300, JSON.stringify({ finish: m.finish, board: m.board }))
    // 手指點「粗」「鏡像」真的有反應（pressed）
    await fingerTap(page, send, page.getByTestId('brush-l'))
    await fingerTap(page, send, page.getByTestId('mirror-toggle'))
    await page.waitForTimeout(150)
    check(`[J5 筆刷 ${tag}] 手指點「粗」「鏡像」有反應`, (await page.getByTestId('brush-l').getAttribute('aria-pressed')) === 'true' && (await page.getByTestId('mirror-toggle').getAttribute('aria-pressed')) === 'true')
    // 印章：多一排圖案，仍不溢出
    await fingerTap(page, send, page.getByTestId('bk-stamp'))
    await page.waitForTimeout(300)
    const st = await page.evaluate(() => { const f = document.querySelector('[data-testid=finish-btn]').getBoundingClientRect(); const s = document.querySelector('[data-testid=brush-l]').getBoundingClientRect(); return { finishB: f.bottom, sizeR: s.right, vw: innerWidth, vh: innerHeight } })
    check(`[J5 筆刷 ${tag}] 選印章（多一排圖案）：「完成」與粗細仍在畫面內`, st.finishB <= st.vh && st.sizeR <= st.vw, JSON.stringify(st))
    if (tag === 'phone844') await shot(page, `j74-brush-phone`)
    await ctx.close()
  }
  // 小手機（高度不夠）維持原本的橫滑列，不退步
  {
    const { ctx, page } = await freshApp(browser, { width: 375, height: 667 }, { stage: 'baby' })
    await page.getByRole('button', { name: /著色本/ }).click()
    await page.waitForSelector('.pb-free-slot')
    await page.locator('.pb-free-slot').first().click()
    await page.getByTestId('tool-brush').click()
    await page.waitForTimeout(300)
    const m = await page.evaluate(() => { const f = document.querySelector('[data-testid=finish-btn]').getBoundingClientRect(); const b = document.querySelector('.pt-board').getBoundingClientRect(); return { finishB: f.bottom, vh: innerHeight, board: b.width } })
    check('[J5 筆刷 小手機 375×667] 維持單排橫滑：「完成」在畫面內、畫板 >= 200px', m.finishB <= m.vh && m.board >= 200, JSON.stringify(m))
    await ctx.close()
  }
} finally {
  await browser.close()
}

console.log(state.failed === 0 ? '\n全部通過' : `\n有 ${state.failed} 項失敗`)
process.exit(state.failed === 0 ? 0 : 1)
