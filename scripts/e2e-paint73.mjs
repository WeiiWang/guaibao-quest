// v7.3 線 F：繪圖板與連連看修正 E2E（Playwright）。涵蓋：
//   F1 色盤 24 色一律看得到（橫向 6×4 固定在面板底、直向 12×2、手機 2 排可橫滑 + 右緣漸層）、色票 ≥ 44px、第一個色票的選取環不被切掉
//   F2 橫向畫布吃滿高度、縮放鈕在畫布外（標題列）、點陣線稿用 2048 高解析圖（區塊表仍是 1024 那份）、載入時間與記憶體
//   F3 完成度不足：沒塗的區塊閃動 2 秒 + 阿悟一句；首次算數的完成 +5 星星（每日上限、不重複）；100% 專屬慶祝；完成對話框三個主按鈕
//   F4 連連看：30 點間距、引線、拿去塗色有 25% 參考底圖、完成圖含參考、完成給星星
//   F5 著色本列表：阿悟抱香蕉第一個、向量頁在簡單區後面
//   截圖到 design/reviews/v73-paint-shots/（已 gitignore）。
// 用法：先啟動 dev server（pnpm dev --port 5196 --strictPort），再
//   BASE_URL=http://localhost:5196 node scripts/e2e-paint73.mjs      （或 pnpm e2e:paint73）
//   E2E_BROWSER=webkit BASE_URL=... node scripts/e2e-paint73.mjs     Safari 引擎 + iPad 模擬
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IS_WEBKIT, freshApp, idb, launch, makeChecker } from './e2e-lib.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../design/reviews/v73-paint-shots')
mkdirSync(OUT, { recursive: true })
const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const MORE_LINE = '還有這些地方喔'
const FULL_LINE = '全部塗滿了！'
const RASTER = 'line-awu-banana'

const SPEECH_STUB = () => {
  window.__spoken = []
  const fake = {
    speaking: false,
    speak(u) {
      window.__spoken.push(u.text)
      window.setTimeout(() => u.onend && u.onend(), 30)
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
const spoken = (page) => page.evaluate(() => window.__spoken.slice())
const clearSpoken = (page) => page.evaluate(() => (window.__spoken.length = 0))
const dump = (page, table) => idb(page, (db, t) => new Promise((res) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => res(e.target.result))), table)
const putRow = (page, table, row) => idb(page, (db, [t, r]) => new Promise((res) => (db.transaction(t, 'readwrite').objectStore(t).put(r).onsuccess = () => res(1))), [table, row])
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
const shot = async (page, name, tag) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${tag}-${name}.png`) })
}
const openList = async (page) => {
  await page.getByRole('button', { name: /著色本/ }).first().click()
  await page.waitForSelector('[data-testid=page-monkey]')
}
const openPage = async (page, id) => {
  await page.getByTestId(`page-${id}`).getByRole('button').click()
  await page.waitForSelector('[data-testid=paint-board]')
  if (id.startsWith('line-')) await page.waitForSelector('[data-testid=raster-layer]')
}
const openFree = async (page) => {
  await page.getByRole('button', { name: /著色本/ }).first().click()
  await page.waitForSelector('[data-testid=free-1]')
  await page.getByTestId('free-1').click()
  await page.waitForSelector('[data-testid=free-bg]')
}
const rect = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s)
  if (!e) return null
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }
}, sel)
const inside = (a, c, pad = 0.5) => a.x >= c.x - pad && a.y >= c.y - pad && a.r <= c.r + pad && a.b <= c.b + pad
const touches = (a, c) => a.x < c.r && a.r > c.x && a.y < c.b && a.b > c.y
const ledger = (page) => dump(page, 'ledger')
const work = async (page) => (await dump(page, 'coloring')).filter((c) => c.pageId.startsWith('g:'))
/** 填色：點區塊代表點（768 工作解析度）；點陣頁用 dev server 的模組取得區塊 */
const regionsOf = (page, id) =>
  page.evaluate(async (pid) => {
    const m = await import('/src/art/coloring/rasterArt.ts')
    const r = await import('/src/art/coloring/regions.ts')
    const art = await m.getRasterArt(pid)
    return art.map.regions.map((x) => ({ id: x.id, area: x.area, anchor: r.regionAnchor(art.map, x.label) }))
  }, id)
const boardBox = (page) => page.getByTestId('paint-board').boundingBox()
const anchorPt = (bb, a) => ({ x: bb.x + (a[0] / 768) * bb.width, y: bb.y + (a[1] / 768) * bb.height })

const browser = await launch()
try {
  // ================= F1/F2：橫向 1180×820 =================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    await openFree(page)
    await page.getByTestId('tool-brush').click()
    await page.getByTestId('bk-stamp').click() // 最擠的情況：筆刷盒 + 印章列 + 筆粗細 + 鏡像
    await page.waitForTimeout(300)
    const body = await rect(page, '[data-testid=pt-body]')
    const panel = await rect(page, '.pt-panel')
    const sw = await page.evaluate(() => [...document.querySelectorAll('[data-testid=palette] .swatch')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } }))
    check('F1 橫向（筆刷 + 印章）：24 色都在，色票 ≥ 44px', sw.length === 24 && sw.every((s) => s.w >= 44 && s.h >= 44), JSON.stringify(sw.slice(0, 2)))
    check('F1 橫向（筆刷 + 印章）：24 色都在面板可見範圍內，不用捲動', sw.every((s) => inside(s, body, 6) && inside(s, panel)), JSON.stringify({ body, last: sw[23] }))
    check('F1 橫向：選項區沒有被擠到需要捲動', await page.evaluate(() => { const b = document.querySelector('[data-testid=pt-body]'); return b.scrollHeight <= b.clientHeight + 1 }))
    check('F1 橫向：色盤排成 6 欄 × 4 排的緊湊格', new Set(sw.map((s) => Math.round((s.y + s.h / 2) / 25))).size === 4 && new Set(sw.map((s) => Math.round((s.x + s.w / 2) / 25))).size === 6)
    for (const t of ['fill', 'eraser']) {
      await page.getByTestId(`tool-${t}`).click()
      await page.waitForTimeout(150)
      const b2 = await rect(page, '[data-testid=pt-body]')
      const s2 = await page.evaluate(() => [...document.querySelectorAll('[data-testid=palette] .swatch')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } }))
      check(`F1 橫向（${t}）：24 色都看得到`, s2.length === 24 && s2.every((s) => inside(s, b2, 6)))
    }
    await page.getByTestId('tool-brush').click()
    await page.getByTestId('bk-pen').click()

    // F2：畫布吃滿高度、整頁不捲動
    const bb = await boardBox(page)
    check('F2 橫向：畫布高度 ≥ 660px（1180×820 約 680）', bb.height >= 660, String(bb.height))
    check('F2 橫向：畫布在視窗內、整頁不出現捲軸', bb.y + bb.height <= SIZES.land.height && (await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)))
    const panelB = await rect(page, '.pt-panel')
    check('F2 橫向：面板高度跟畫布外框一致（同步拉高）', Math.abs(panelB.h - (bb.height + 32)) <= 2, `${panelB.h} vs ${bb.height + 32}`)
    // 縮放鈕在畫布外（標題列），不壓在線稿上
    const zoom = await rect(page, '[data-testid=pb-zoom]')
    const board = await rect(page, '[data-testid=paint-board]')
    const header = await rect(page, '.screen-header')
    check('F2 縮放鈕：不與畫布重疊、在標題列內', !touches(zoom, board) && inside(zoom, header, 4), JSON.stringify({ zoom, header }))
    const zb = await page.getByTestId('zoom-in').boundingBox()
    check('F2 縮放鈕：按鈕 ≥ 56px', zb.width >= 55.5 && zb.height >= 55.5, JSON.stringify(zb))
    await page.getByTestId('zoom-in').click()
    check('F2 縮放鈕：還是按得動（1× → 2×）', (await page.getByTestId('paint-board').getAttribute('data-zoom')) === '2.00')
    await page.getByTestId('zoom-out').click()
    await shot(page, 'brush-stamp-palette', 'land')
    check('F1/F2 橫向：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= F2：點陣線稿 2048 =================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    await openList(page)
    const t0 = Date.now()
    await openPage(page, RASTER)
    await page.waitForFunction(() => { const i = document.querySelector('.pb-line'); return i && i.complete && i.naturalWidth > 0 })
    const loadMs = Date.now() - t0
    const info = await page.evaluate(async (pid) => {
      const line = document.querySelector('.pb-line')
      const m = await import('/src/art/coloring/rasterArt.ts')
      const art = await m.getRasterArt(pid)
      const raster = document.querySelector('[data-testid=raster-layer]')
      const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
      return { hd: line.dataset.hd, nat: line.naturalWidth, base: art.img.naturalWidth, regions: art.map.regions.length, shown: Number(raster.dataset.regions), src: line.getAttribute('src'), mem }
    }, RASTER)
    check('F2 線稿：畫板顯示用 2048 的 -hd.png', info.hd === '1' && info.nat === 2048 && /-hd\.png$/.test(info.src), JSON.stringify(info))
    check('F2 線稿：區塊表仍用 1024 那份算（區塊數不變）', info.base === 1024 && info.regions === info.shown && info.regions >= 8, JSON.stringify(info))
    const counts = await page.evaluate(async () => (await import('/src/art/coloring/region-counts.json')).default)
    check('F2 線稿：區塊數與預先算好的 region-counts.json 一致', counts[RASTER] === info.regions, `${counts[RASTER]} vs ${info.regions}`)
    console.log(`INFO  2048 線稿 ${RASTER}：進頁到線稿載入完成 ${loadMs}ms；JS heap ${info.mem ?? 'n/a'}MB`)
    check('F2 線稿：載入時間合理（< 4 秒）', loadMs < 4000, `${loadMs}ms`)
    // 放大 3×：線稿層仍是 2048，視覺上沒有因放大而換圖
    await page.getByTestId('zoom-in').click()
    await page.getByTestId('zoom-in').click()
    check('F2 線稿：放大到 3×', (await page.getByTestId('paint-board').getAttribute('data-zoom')) === '3.00')
    await shot(page, 'zoom3x-hd-lineart', 'land')
    // 載不到 -hd：退回 1024（不會是破圖）
    await page.route('**/*-hd.png', (r) => r.abort())
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openList(page)
    await openPage(page, RASTER)
    await page.waitForFunction(() => { const i = document.querySelector('.pb-line'); return i && i.complete && i.naturalWidth > 0 && i.dataset.hd === '0' }, null, { timeout: 8000 }).catch(() => {})
    check('F2 線稿：-hd 載不到時退回 1024 那份', (await page.locator('.pb-line').getAttribute('data-hd')) === '0' && (await page.locator('.pb-line').evaluate((i) => i.naturalWidth)) === 1024)
    check('F2 線稿：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= F3：沒塗的區塊閃動、完成獎勵、100%、三個主按鈕（點陣頁） =================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    await ctx.addInitScript(SPEECH_STUB)
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)
    await openPage(page, RASTER)
    const regs = (await regionsOf(page, RASTER)).sort((a, b) => b.area - a.area)
    const bb = await boardBox(page)
    // 塗 2 個區塊（遠低於 60%）→ 按完成
    await page.locator('[data-testid=palette] .swatch').nth(14).click()
    for (const r of regs.slice(1, 3)) {
      const p = anchorPt(bb, r.anchor)
      await page.mouse.click(p.x, p.y)
      await page.waitForTimeout(550)
    }
    await clearSpoken(page)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-ask]')
    const flash = page.getByTestId('flash-layer')
    check('F3 閃動：完成度不足 → 出現「再畫一點好嗎？」對話框，沒塗的區塊同時閃動', (await flash.getAttribute('data-on')) === '1')
    const nUn = regs.length - 2
    check('F3 閃動：閃動的區塊數 = 還沒塗的區塊數', Number(await flash.getAttribute('data-n')) === nUn, `${await flash.getAttribute('data-n')} vs ${nUn}`)
    const px = (a) => flash.evaluate((c, [x, y]) => Array.from(c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data), a)
    check('F3 閃動：沒塗的區塊上有暖色，塗過的區塊上是透明', (await px(regs[0].anchor))[3] > 100 && (await px(regs[1].anchor))[3] === 0 && (await px(regs[2].anchor))[3] === 0)
    check('F3 閃動：阿悟說「還有這些地方喔」', (await spoken(page)).includes(MORE_LINE), JSON.stringify(await spoken(page)))
    check('F3 閃動：播的是 2 秒的動畫', await flash.evaluate((c) => { const a = c.getAnimations()[0]; return !!a && Math.abs(a.effect.getComputedTiming().duration - 2000) < 5 }))
    const ask = await rect(page, '[data-testid=finish-ask]')
    const bd = await rect(page, '[data-testid=paint-board]')
    check('F3 閃動：對話框沒有蓋住畫布（閃動看得見）', !touches(ask, bd), JSON.stringify({ ask, bd }))
    await shot(page, 'flash-unpainted', 'land')
    await page.waitForTimeout(2300)
    check('F3 閃動：2 秒後停止', (await flash.getAttribute('data-on')) === '0')
    // 沒有新增作品、沒有星星
    check('F3 閃動：還沒完成、沒有作品、沒有星星', (await work(page)).length === 0 && !(await ledger(page)).some((l) => l.reason === '完成作品'))
    await page.getByTestId('finish-more').click()
    // 塗到 ≥ 60%：用資料直接補滿（等同孩子塗了），再按完成
    const need = Math.ceil(regs.length * 0.62)
    const fills = {}
    for (const r of regs.slice(0, need)) fills[r.id] = '#e8a6a0'
    await putRow(page, 'coloring', { pageId: RASTER, fills, strokes: [], stickers: [], updatedAt: Date.now() })
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openList(page)
    await openPage(page, RASTER)
    await clearSpoken(page)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    const fc = page.getByTestId('finish-celebration')
    check('F3 星星：第一次算數的完成顯示 +5 完成作品', (await fc.getAttribute('data-stars')) === '5' && /\+5/.test(await page.getByTestId('fc-stars').innerText()))
    const rows = (await ledger(page)).filter((l) => l.reason === '完成作品')
    check('F3 星星：寫進點數流水帳（理由「完成作品」、+5、kind bonus、refId art:頁面）', rows.length === 1 && rows[0].delta === 5 && rows[0].kind === 'bonus' && rows[0].refId === `art:${RASTER}`, JSON.stringify(rows))
    await page.waitForTimeout(700) // 慶祝卡的彈出動畫與依序唸的語音
    check('F3 星星：阿悟說「得到五顆星星囉！」', (await spoken(page)).includes('得到五顆星星囉！'), JSON.stringify(await spoken(page)))
    check('F3 慶祝：不是 100% 就沒有「全部塗滿」', (await fc.getAttribute('data-full')) === '0' && (await page.getByTestId('fc-confetti').getAttribute('data-n')) === '28')
    // 三個主按鈕；畫廊入口是次要
    const acts = await page.locator('[data-testid=fc-actions] .btn, [data-testid=fc-actions] .fc-hung').evaluateAll((els) => els.map((e) => ({ t: e.textContent.trim(), h: e.getBoundingClientRect().height })))
    check('F3 完成對話框：三個主按鈕（掛到房間、繼續畫、回著色本），都 ≥ 56px', acts.length === 3 && acts.map((a) => a.t).join('|') === '掛到房間|繼續畫|回著色本' && acts.every((a) => a.h >= 55.5), JSON.stringify(acts))
    const gal = await rect(page, '[data-testid=to-gallery]')
    const actsBox = await rect(page, '[data-testid=fc-actions]')
    check('F3 完成對話框：畫廊入口改成次要（在主按鈕下面、按鈕 ≥ 56px）', gal && gal.y >= actsBox.b - 1 && gal.h >= 55.5, JSON.stringify({ gal, actsBox }))
    await shot(page, 'finish-stars', 'land')
    // 同一張不重複給：繼續畫、改一點、再完成
    await page.getByTestId('fc-keep').click()
    await page.getByTestId('tool-fill').click()
    await page.locator('[data-testid=palette] .swatch').nth(3).click()
    const p4 = anchorPt(await boardBox(page), regs[need].anchor)
    await page.mouse.click(p4.x, p4.y)
    await page.waitForTimeout(550)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('F3 星星：同一張再完成一次不重複給（沒有 +5 區塊、流水帳還是一筆）', (await page.getByTestId('fc-stars').count()) === 0 && (await ledger(page)).filter((l) => l.reason === '完成作品').length === 1)
    await ctx.close()

    // 100%：全部塗滿的專屬慶祝（另一個全新的 app，避免上面的星星干擾）
    const a2 = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    await a2.ctx.addInitScript(SPEECH_STUB)
    await a2.page.reload()
    await a2.page.waitForSelector('[data-testid=pet]')
    await openList(a2.page)
    await openPage(a2.page, RASTER)
    const regs2 = await regionsOf(a2.page, RASTER)
    const all = {}
    for (const r of regs2) all[r.id] = '#9fd0e8'
    await putRow(a2.page, 'coloring', { pageId: RASTER, fills: all, strokes: [], stickers: [], updatedAt: Date.now() })
    await a2.page.reload()
    await a2.page.waitForSelector('[data-testid=room]')
    await openList(a2.page)
    await openPage(a2.page, RASTER)
    check('F3 100%：完成度顯示 100%', /100%/.test(await a2.page.locator('.autosave').innerText()))
    await clearSpoken(a2.page)
    await a2.page.getByTestId('finish-btn').click()
    await a2.page.waitForSelector('[data-testid=finish-celebration]')
    const fc2 = a2.page.getByTestId('finish-celebration')
    check('F3 100%：專屬慶祝「全部塗滿了！」+ 加強版彩帶（64 片，一般是 28）', (await fc2.getAttribute('data-full')) === '1' && /全部塗滿了/.test(await fc2.innerText()) && (await a2.page.getByTestId('fc-confetti').getAttribute('data-n')) === '64')
    await a2.page.waitForTimeout(900)
    check('F3 100%：阿悟說「全部塗滿了！」，接著說星星', (await spoken(a2.page)).slice(0, 4).includes(FULL_LINE) && (await spoken(a2.page)).includes('得到五顆星星囉！'), JSON.stringify(await spoken(a2.page)))
    await shot(a2.page, 'finish-full-100', 'land')
    // 語音關閉：不唸
    await a2.page.getByTestId('fc-back').click()
    await a2.ctx.close()
    check('F3：JS 沒有錯誤', errors.length === 0 && a2.errors.length === 0, errors.concat(a2.errors).join(' | '))
  }

  // ================= F3：向量頁閃動、每日上限、語音開關、減少動態 =================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    await ctx.addInitScript(SPEECH_STUB)
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)
    await openPage(page, 'monkey')
    const all = await page.evaluate(() => [...document.querySelectorAll('[data-region]')].map((e) => e.getAttribute('data-region')))
    await page.locator('[data-testid=palette] .swatch').nth(14).click()
    const hb = await page.locator('[data-region=head]').boundingBox()
    await page.mouse.click(hb.x + 4, hb.y + hb.height / 2) // 頭的最左邊（沒被臉蓋住）
    await page.waitForTimeout(300)
    const painted = Object.keys((await dump(page, 'coloring')).find((c) => c.pageId === 'monkey')?.fills ?? {})
    await clearSpoken(page)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-ask]')
    const nFlash = await page.locator('.f73-flash-region').count()
    check('F3 向量頁：沒塗的區塊閃動（區塊數 = 全部 − 已塗）', painted.length >= 1 && nFlash === all.length - painted.length && (await page.locator(`[data-region=${painted[0]}].f73-flash-region`).count()) === 0, `${nFlash}/${all.length} painted=${painted}`)
    check('F3 向量頁：阿悟說「還有這些地方喔」', (await spoken(page)).includes(MORE_LINE))
    await page.waitForTimeout(2300)
    check('F3 向量頁：2 秒後停止閃動', (await page.locator('.f73-flash-region').count()) === 0)
    await page.getByTestId('finish-more').click()
    // 語音關閉：不唸，但閃動仍然有
    await patchSettings(page, { voiceOn: false })
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openList(page)
    await openPage(page, 'monkey')
    await clearSpoken(page)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-ask]')
    check('F3 語音關閉：不唸「還有這些地方喔」，閃動照樣有', !(await spoken(page)).includes(MORE_LINE) && (await page.locator('.f73-flash-region').count()) > 0)
    // 減少動態：不閃，靜靜標示
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByTestId('finish-more').click()
    await page.waitForTimeout(2300)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-ask]')
    const anim = await page.locator('.f73-flash-region').first().evaluate((e) => getComputedStyle(e).animationName)
    check('F3 減少動態：改用靜態標示（不閃）', anim === 'f73-flash-fill-still', anim)
    await ctx.close()
    check('F3 向量頁：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
  }

  // ================= F3：每日上限 =================
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    // 今天已經拿到 98 點（任務 / 家長加點的總和），上限 100：完成作品只給得到 2
    await putRow(page, 'ledger', { id: 'cap-test', at: Date.now(), delta: 98, reason: '家長加點', kind: 'bonus' })
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openFree(page)
    const bb = await boardBox(page)
    await page.getByTestId('tool-brush').click()
    await page.mouse.move(bb.x + 100, bb.y + 100)
    await page.mouse.down()
    await page.mouse.move(bb.x + 300, bb.y + 200, { steps: 8 })
    await page.mouse.up()
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    const row = (await ledger(page)).find((l) => l.reason === '完成作品')
    check('F3 每日上限：只剩 2 點就只給 2（不超過每日上限）', row?.delta === 2 && (await page.getByTestId('finish-celebration').getAttribute('data-stars')) === '2', JSON.stringify(row))
    await ctx.close()
  }

  // ================= F1/F3：空白畫紙的完成對話框（再畫一張新的） =================
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    await openFree(page)
    const bb = await boardBox(page)
    await page.getByTestId('tool-brush').click()
    await page.mouse.move(bb.x + 100, bb.y + 100)
    await page.mouse.down()
    await page.mouse.move(bb.x + 300, bb.y + 200, { steps: 8 })
    await page.mouse.up()
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    const acts = await page.locator('[data-testid=fc-actions] .btn, [data-testid=fc-actions] .fc-hung').evaluateAll((els) => els.map((e) => e.textContent.trim()))
    check('F3 畫紙：三個主按鈕（掛到房間、再畫一張新的、回著色本）', acts.join('|') === '掛到房間|再畫一張新的|回著色本', acts.join('|'))
    check('F3 畫紙：「繼續畫」與畫廊在次要區', (await page.locator('[data-testid=fc-more] .btn').allInnerTexts()).join('|') === '繼續畫|看我的畫廊')
    check('F3 畫紙：第一次完成 +5 星星', (await page.getByTestId('finish-celebration').getAttribute('data-stars')) === '5')
    await page.getByTestId('free-restart').click()
    await page.waitForSelector('[data-testid=finish-celebration]', { state: 'detached' })
    await page.waitForTimeout(300)
    // 再畫一張新的、同一天再完成：不再給（每個欄位每天一次）
    const bb2 = await boardBox(page)
    await page.mouse.move(bb2.x + 120, bb2.y + 300)
    await page.mouse.down()
    await page.mouse.move(bb2.x + 380, bb2.y + 260, { steps: 8 })
    await page.mouse.up()
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('F3 畫紙：同一欄位同一天「再畫一張新的」不能刷星星', (await page.getByTestId('finish-celebration').getAttribute('data-stars')) === '0' && (await ledger(page)).filter((l) => l.reason === '完成作品').length === 1)
    await ctx.close()
  }

  // ================= F5：著色本列表排序 =================
  {
    const { ctx, page } = await freshApp(browser, SIZES.land)
    await openList(page)
    const ids = await page.locator('[data-testid=grid-easy] > li').evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace(/^(page|locked)-/, '')))
    check('F5 列表：簡單區第一個是「阿悟抱香蕉」', ids[0] === RASTER, ids.slice(0, 3).join(','))
    const owned = await page.locator('[data-testid=grid-easy] > li:not(.locked)').count()
    check('F5 列表：已擁有的在前、上鎖的在後（原則不變）', (await page.locator('[data-testid=grid-easy] > li').evaluateAll((els) => /^O+L+$/.test(els.map((e) => (e.classList.contains('locked') ? 'L' : 'O')).join('')))))
    const own = ids.slice(0, owned)
    check('F5 列表：已擁有的裡面，點陣頁在前、向量頁（小猴子、香蕉樹）在後', own.length >= 3 && own[0] === RASTER && own.findIndex((i) => !i.startsWith('line-')) > 0 && own.slice(own.findIndex((i) => !i.startsWith('line-'))).every((i) => !i.startsWith('line-')), own.join(','))
    const lockedIds = ids.slice(owned)
    const firstLockedVec = lockedIds.findIndex((i) => !i.startsWith('line-'))
    check('F5 列表：上鎖的也是點陣頁在前、向量頁在最後', firstLockedVec > 0 && lockedIds.slice(0, firstLockedVec).every((i) => i.startsWith('line-')) && lockedIds.slice(firstLockedVec).every((i) => !i.startsWith('line-')), lockedIds.join(','))
    await shot(page, 'coloring-list-order', 'land')
    await ctx.close()
  }

  // ================= F1：直向與手機（色盤 2 排、右緣提示、縮放鈕在畫布外） =================
  for (const tag of ['port', 'phone']) {
    const vp = SIZES[tag]
    const { ctx, page, errors } = await freshApp(browser, vp, { ctxOpts: { hasTouch: true, ...(tag === 'phone' ? { isMobile: true } : {}) } })
    await page.getByRole('button', { name: /著色本/ }).first().tap()
    await page.waitForSelector('[data-testid=free-1]')
    await page.getByTestId('free-1').tap()
    await page.waitForSelector('[data-testid=free-bg]')
    await page.getByTestId('tool-brush').tap()
    await page.getByTestId('bk-stamp').tap()
    await page.waitForTimeout(300)
    const info = await page.evaluate(() => {
      const sc = document.querySelector('[data-testid=palette-scroll]')
      const wrap = document.querySelector('[data-testid=palette-wrap]')
      const c = sc.getBoundingClientRect()
      const sw = [...document.querySelectorAll('[data-testid=palette] .swatch')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } })
      return { c: { x: c.x, y: c.y, r: c.right, b: c.bottom }, sw, scrollW: sc.scrollWidth, clientW: sc.clientWidth, more: wrap.dataset.more, rows: new Set(sw.map((s) => Math.round((s.y + s.h / 2) / 30))).size }
    })
    check(`F1 [${tag}] 24 色都在，色票 ≥ 44px`, info.sw.length === 24 && info.sw.every((s) => s.w >= 43.5 && s.h >= 43.5), JSON.stringify(info.sw[0]))
    check(`F1 [${tag}] 色盤是 2 排`, info.rows === 2, String(info.rows))
    check(`F1 [${tag}] 第一個色票（選取環）不被左邊切掉`, info.sw[0].x >= info.c.x + 2, JSON.stringify([info.sw[0].x, info.c.x]))
    if (tag === 'port') {
      check('F1 [port] 直向：12 欄 × 2 排一次攤開，不用橫滑', info.scrollW <= info.clientW + 1 && info.sw.every((s) => s.r <= info.c.r + 1), JSON.stringify(info))
    } else {
      check('F1 [phone] 手機：2 排可橫滑，右緣有漸層提示（data-more=1）', info.scrollW > info.clientW + 20 && info.more === '1', JSON.stringify(info))
      await page.getByTestId('palette-scroll').evaluate((e) => e.scrollTo({ left: e.scrollWidth }))
      await page.waitForTimeout(300)
      check('F1 [phone] 滑到最右邊：提示消失，最後一個色票（黑）完整看得到', (await page.getByTestId('palette-wrap').getAttribute('data-more')) === '0' && (await page.evaluate(() => { const l = [...document.querySelectorAll('[data-testid=palette] .swatch')].at(-1).getBoundingClientRect(); const c = document.querySelector('[data-testid=palette-scroll]').getBoundingClientRect(); return l.right <= c.right + 1 })))
      await page.getByTestId('palette-scroll').evaluate((e) => e.scrollTo({ left: 0 }))
    }
    const board = await rect(page, '[data-testid=paint-board]')
    const zoom = await rect(page, '[data-testid=pb-zoom]')
    check(`F2 [${tag}] 縮放鈕在畫布外（不壓在線稿上），按鈕 ≥ 56px`, !touches(zoom, board) && (await page.getByTestId('zoom-in').boundingBox()).height >= 55.5, JSON.stringify({ zoom, board }))
    check(`F2 [${tag}] 沒有橫向破版`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
    await shot(page, 'brush-stamp-palette', tag)
    // 工具列固定高度：點色、換工具，「完成」不跳位
    const f0 = await rect(page, '[data-testid=finish-btn]')
    await page.locator('[data-testid=palette] .swatch').nth(5).tap()
    for (const t of ['fill', 'eraser', 'brush']) {
      await page.getByTestId(`tool-${t}`).tap()
      await page.waitForTimeout(100)
    }
    const f1 = await rect(page, '[data-testid=finish-btn]')
    check(`F1 [${tag}] 「完成」位置固定`, Math.abs(f1.y - f0.y) < 1)
    check(`F1/F2 [${tag}] JS 沒有錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= F4：連連看 =================
  for (const tag of ['land', 'port', 'phone']) {
    const vp = SIZES[tag]
    const { ctx, page, errors } = await freshApp(browser, vp, { ctxOpts: { hasTouch: true, ...(tag === 'phone' ? { isMobile: true } : {}) } })
    await ctx.addInitScript(SPEECH_STUB)
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)
    await page.getByTestId('dots-level-h').click()
    await page.getByTestId('dots-obj-fish').getByRole('button').click()
    await page.waitForSelector('[data-testid=dots-screen]')
    await page.waitForFunction(() => document.querySelector('[data-testid=dots-screen]')?.getAttribute('data-ready') === '1')
    const dots = await page.evaluate(() => [...document.querySelectorAll('.dt-dot')].map((g) => ({ x: Number(g.dataset.x), y: Number(g.dataset.y) })))
    let minPair = Infinity
    for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) minPair = Math.min(minPair, Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y))
    check(`F4 [${tag}] 挑戰 30 點小魚：${dots.length} 點，任兩點距離 ≥ 18（0–400 座標）`, dots.length === 30 && minPair >= 18, minPair.toFixed(1))
    const lead = await page.getByTestId('dots-leader').count()
    check(`F4 [${tag}] 引線只在真的需要時才畫（≤ 2 條）`, lead <= 2, String(lead))
    const lay = await page.evaluate(() => {
      const nums = [...document.querySelectorAll('.dt-num')].map((t) => { const r = t.getBoundingClientRect(); const k = r.height * 0.14; return { left: r.left, right: r.right, top: r.top + k, bottom: r.bottom - k } })
      let overlaps = 0
      for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) if (nums[i].left < nums[j].right && nums[i].right > nums[j].left && nums[i].top < nums[j].bottom && nums[i].bottom > nums[j].top) overlaps++
      const circles = [...document.querySelectorAll('.dt-dot-c')].map((c) => c.getBoundingClientRect())
      let covered = 0
      for (const n of nums) for (const c of circles) if (n.left < c.right && n.right > c.left && n.top < c.bottom && n.bottom > c.top) covered++
      // 每條引線的兩端：一端在點的圓邊上、另一端在某個標籤旁（不孤立）
      const orphan = [...document.querySelectorAll('.dt-leader')].filter((l) => {
        const a = l.getBoundingClientRect()
        const near = (x, y, rs) => rs.some((r) => x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6)
        const p1 = { x: a.left, y: a.top }
        const p2 = { x: a.right, y: a.bottom }
        const ok = (p) => near(p.x, p.y, nums) || near(p.x, p.y, circles)
        return !(ok(p1) && ok(p2))
      }).length
      return { overlaps, covered, orphan }
    })
    check(`F4 [${tag}] 標籤不重疊、不蓋到點、引線沒有孤立的`, lay.overlaps === 0 && lay.covered === 0 && lay.orphan === 0, JSON.stringify(lay))
    // 觸控範圍：離點中心 24px 仍點得到（直徑 ≥ 48px）
    const c0 = await page.locator('[data-dot="0"] .dt-dot-c').boundingBox()
    await page.touchscreen.tap(c0.x + c0.width / 2 + 22, c0.y + c0.height / 2)
    check(`F4 [${tag}] 觸控範圍 ≥ 44px：離點中心 22px 點得到`, (await page.getByTestId('dots-screen').getAttribute('data-at')) === '1')
    if (tag === 'land') await shot(page, 'dots-30-fish', tag)
    if (tag === 'phone') await shot(page, 'dots-30-fish', tag)
    await ctx.close()
    check(`F4 [${tag}] JS 沒有錯誤`, errors.length === 0, errors.join(' | '))
  }

  // 連連看 → 拿去塗色：參考底圖、完成圖含參考、完成給星星
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    await putRow(page, 'coloring', { pageId: 'dots:obj-fish:h', fills: {}, strokes: [], stickers: [], dotsAt: 30, dotsDone: true, updatedAt: Date.now() })
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openList(page)
    await page.getByTestId('dots-level-h').click()
    await page.getByTestId('dots-obj-fish').getByRole('button').click()
    await page.waitForSelector('[data-testid=dots-screen]')
    await page.waitForFunction(() => document.querySelector('[data-testid=dots-screen]')?.getAttribute('data-phase') === 'reveal')
    await page.getByTestId('dots-to-paint').click()
    await page.waitForSelector('[data-testid=paint-screen]')
    const ref = page.getByTestId('dots-reference')
    check('F4 拿去塗色：剪影裡有原 3D 圖當參考底圖，透明度 25%', (await ref.count()) === 1 && (await ref.getAttribute('opacity')) === '0.25' && /art\/obj-fish\.png$/.test(await ref.getAttribute('href')))
    check('F4 拿去塗色：參考圖被剪影裁切（clip-path）、不攔截點擊', (await ref.getAttribute('clip-path')) === 'url(#f73-ref-clip)' && (await ref.evaluate((e) => getComputedStyle(e).pointerEvents)) === 'none')
    await page.waitForTimeout(600)
    await shot(page, 'dots-to-paint-reference', 'land')
    // 塗一個淡色，筆刷描一下，完成：完成圖（PNG）剪影內不是單一色（有參考的細節）
    await page.getByTestId('tool-fill').click()
    await page.locator('[data-testid=palette] .swatch').nth(2).click()
    const sb = await page.locator('[data-region=shape]').boundingBox()
    await page.mouse.click(sb.x + sb.width * 0.5, sb.y + sb.height * 0.5)
    await page.waitForTimeout(300)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    const g = (await work(page)).at(-1)
    const distinct = await page.evaluate(
      (png) =>
        new Promise((res) => {
          const im = new Image()
          im.onload = () => {
            const c = document.createElement('canvas')
            c.width = im.width
            c.height = im.height
            const x = c.getContext('2d')
            x.drawImage(im, 0, 0)
            const d = x.getImageData(Math.round(im.width * 0.3), Math.round(im.height * 0.3), Math.round(im.width * 0.4), Math.round(im.height * 0.4)).data
            const set = new Set()
            for (let i = 0; i < d.length; i += 4) set.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`)
            res(set.size)
          }
          im.src = png
        }),
      g.png,
    )
    check('F4 拿去塗色：完成圖含參考底圖（剪影內不是單一色）', distinct > 12, String(distinct))
    const stars = (await ledger(page)).filter((l) => l.reason === '完成作品')
    check('F4 拿去塗色：完成給 +5 星星（連連看的頁一張一次）', stars.length === 1 && stars[0].refId === 'art:dots:obj-fish:h' && (await page.getByTestId('finish-celebration').getAttribute('data-stars')) === '5')
    await ctx.close()
    check('F4 拿去塗色：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
  }
} finally {
  await browser.close()
}
console.log(state.failed === 0 ? '\n全部通過' : `\n有 ${state.failed} 項失敗`, IS_WEBKIT ? '（WebKit）' : '')
process.exit(state.failed === 0 ? 0 : 1)
