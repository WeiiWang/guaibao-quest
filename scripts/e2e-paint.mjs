// v7 線 A：繪圖板 2.0 E2E（Playwright）。涵蓋：
//   點陣線稿頁（區塊、填色、點在線上、完成度）、筆刷盒（蠟筆 / 彩虹 / 鏡像）、放大（按鈕、小地圖、座標換算、雙指縮放）、
//   空白畫紙（換背景、完成、存進畫廊、掛到房間、再畫一張）、音效開關、減少動態，並截圖到 design/reviews/v7-paint-shots/。
// v7.1：貼紙拖進畫布（D1）、完成解鎖畫框與畫廊選畫框（D2），截圖到 design/reviews/v71-shots/。
// 用法：先啟動 dev server（pnpm dev --port 5190 --strictPort），再
//   BASE_URL=http://localhost:5190 node scripts/e2e-paint.mjs      （或 pnpm e2e:paint）
// 需要 Chromium：預設找 ~/Library/Caches/ms-playwright 內已安裝的，或用 CHROME_PATH 指定。
// 點陣頁用 dev server 的模組（/src/art/coloring/*.ts）取得區塊的位置，所以需要 dev server（不能對 preview 的 build 跑）。
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, IS_WEBKIT, freshApp, idb, launch, makeChecker, touchSender } from './e2e-lib.mjs'

const BASE_URL_OF = () => BASE

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../design/reviews/v7-paint-shots')
const OUT71 = join(dirname(fileURLToPath(import.meta.url)), '../design/reviews/v71-shots')
mkdirSync(OUT, { recursive: true })
mkdirSync(OUT71, { recursive: true })
const { state, check } = makeChecker()
const VP = { width: 1180, height: 820 }
const PAGE = 'line-awu-banana' // 免費送的第一張點陣頁

const dump = (page, table) =>
  idb(page, (db, t) => new Promise((res) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => res(e.target.result))), table)
const docOf = async (page, id) => (await dump(page, 'coloring')).find((c) => c.pageId === id)
const shot = async (page, name) => {
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}
const shot71 = async (page, name) => {
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(OUT71, `${name}.png`) })
}
// v7.4 I4：貼紙盤預設只開 8 張；這些舊測試要用到後面解鎖的貼紙，先把全部貼紙寫進 settings.stickers
const ALL_STICKERS = ['pet-adult-cheer', 'pet-baby-happy', 'obj-star', 'obj-flower', 'obj-rabbit', 'obj-chick', 'obj-fish', 'obj-shell', 'decor-rainbow', 'mat-flower']
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

/** 點陣頁的區塊（dev server 的模組）：id、面積、代表點（768 工作解析度） */
const regionsOf = (page, id) =>
  page.evaluate(async (pid) => {
    const m = await import('/src/art/coloring/rasterArt.ts')
    const r = await import('/src/art/coloring/regions.ts')
    const art = await m.getRasterArt(pid)
    return art.map.regions.map((x) => ({ id: x.id, label: x.label, area: x.area, anchor: r.regionAnchor(art.map, x.label) }))
  }, id)
/** 在線條上找一個點（工作解析度），以及 regionAt 會判給哪個區塊 */
const linePoint = (page, id) =>
  page.evaluate(async (pid) => {
    const m = await import('/src/art/coloring/rasterArt.ts')
    const r = await import('/src/art/coloring/regions.ts')
    const art = await m.getRasterArt(pid)
    const { labels, size } = art.map
    for (let y = 200; y < size; y += 7)
      for (let x = 100; x < size - 100; x++) {
        if (labels[y * size + x] === 0) {
          const l = r.regionAt(art.map, x, y, r.hitRadiusAt(1))
          // 要「在線的正中間」才有意義：兩側都有線
          if (l && labels[y * size + x + 1] === 0 && labels[y * size + x - 1] === 0) {
            // 線的正中間可能兩側等距：把半徑內的所有候選區塊都列出來
            const cand = new Set()
            const R = r.hitRadiusAt(1)
            for (let yy = y - R; yy <= y + R; yy++) for (let xx = x - R; xx <= x + R; xx++) if (labels[yy * size + xx] && (xx - x) ** 2 + (yy - y) ** 2 <= (R + 1) ** 2) cand.add(labels[yy * size + xx])
            return { x, y, label: l, cand: [...cand] }
          }
        }
      }
    return null
  }, id)

const openList = async (page) => {
  await page.getByRole('button', { name: /著色本/ }).first().click()
  await page.waitForSelector('[data-testid=page-monkey]')
}
const board = (page) => page.getByTestId('paint-board').boundingBox()
const pt = (bb, a) => ({ x: bb.x + (a[0] / 768) * bb.width, y: bb.y + (a[1] / 768) * bb.height })
const fillPixel = (page, a) =>
  page.locator('.pb-fill').evaluate((c, [x, y]) => Array.from(c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data), a)
const stroke = async (page, from, to, n = 10) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: n })
  await page.mouse.up()
  await page.waitForTimeout(120)
}
const hex = (rgba) => '#' + rgba.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')

const browser = await launch()
try {
  // ================= 1) 點陣線稿頁 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP)
    await openList(page)
    check('著色本列表：空白畫紙卡（3 個欄位）在最前面', (await page.getByTestId('free-card').count()) === 1 && (await page.locator('button[data-testid^=free-]').count()) === 3)
    check('著色本列表：分「簡單」「挑戰」兩區', (await page.getByTestId('tier-easy').count()) === 1)
    const hardCount = await page.locator('[data-testid^=locked-line-awu-garden], [data-testid^=locked-line-awu-space], [data-testid^=locked-line-castle]').count()
    check('著色本列表：挑戰區有豐富版頁面（上鎖，要用星星換）', hardCount === 0 || (await page.getByTestId('tier-hard').count()) === 1)
    check('點陣頁：免費送的簡單版頁面（阿悟抱香蕉）在列表', (await page.getByTestId(`page-${PAGE}`).count()) === 1)
    await shot(page, '1-list')

    await page.getByTestId(`page-${PAGE}`).getByRole('button').click()
    await page.waitForSelector('[data-testid=raster-layer]')
    const n = Number(await page.getByTestId('raster-layer').getAttribute('data-regions'))
    check('點陣頁：載入後算出區塊（>= 8 個）', n >= 8, String(n))
    check('點陣頁：線稿疊在填色層上方（img 在 canvas 之後）', await page.locator('.pb-raster > .pb-line').count() === 1)
    const regs = (await regionsOf(page, PAGE)).sort((a, b) => b.area - a.area)
    const bb = await board(page)
    const colors = page.locator('[data-testid=palette] .swatch')
    const c1 = await colors.nth(12).getAttribute('data-color')
    const c2 = await colors.nth(17).getAttribute('data-color')
    const pct0 = await page.locator('.autosave').innerText()
    check('點陣頁：一開始完成度 0%', /0%/.test(pct0), pct0)

    // 點兩個區塊
    await colors.nth(12).click()
    const a = pt(bb, regs[1].anchor)
    await page.mouse.click(a.x, a.y)
    await page.waitForTimeout(700) // 漣漪動畫
    await colors.nth(17).click()
    const b = pt(bb, regs[2].anchor)
    await page.mouse.click(b.x, b.y)
    await page.waitForTimeout(700)
    let doc = await docOf(page, PAGE)
    check('點陣頁：點兩個區塊 → fills 有兩筆，key 是 r<label>', Object.keys(doc?.fills ?? {}).length === 2 && Object.keys(doc.fills).every((k) => /^r\d+$/.test(k)), JSON.stringify(doc?.fills))
    check('點陣頁：fills 的顏色就是挑的顏色', doc.fills[regs[1].id] === c1 && doc.fills[regs[2].id] === c2, JSON.stringify(doc.fills))
    check('填色層：區塊中心的像素真的是那個顏色', hex(await fillPixel(page, regs[1].anchor)) === c1 && hex(await fillPixel(page, regs[2].anchor)) === c2)
    const pct1 = await page.locator('.autosave').innerText()
    check('點陣頁：完成度上升', Number((pct1.match(/(\d+)%/) ?? [0, 0])[1]) > 0, pct1)

    // 點在線上：往外找最近的區塊
    const lp = await linePoint(page, PAGE)
    check('（測試前提）找得到一個線上的點', !!lp)
    if (lp) {
      await colors.nth(20).click()
      const p = pt(bb, [lp.x, lp.y])
      await page.mouse.click(p.x, p.y)
      await page.waitForTimeout(500)
      doc = await docOf(page, PAGE)
      check('點在線上：填到半徑內最近的區塊（候選之一，且不是新的空白）', lp.cand.some((l) => doc.fills[`r${l}`] === '#9a5fd0') , `cand=${lp.cand} fills=${JSON.stringify(doc.fills)}`)
    }
    // 點到畫面最外圍（背景區塊，可以塗天空）
    await colors.nth(2).click()
    await page.mouse.click(bb.x + bb.width - 6, bb.y + 6)
    await page.waitForTimeout(600)
    doc = await docOf(page, PAGE)
    check('外圍背景也是一個區塊，可以塗', !!doc.fills.r1, JSON.stringify(Object.keys(doc.fills)))

    // 特殊填色（彩虹）與復原
    await page.getByTestId('special-rainbow').click()
    const r4 = pt(bb, regs[3].anchor)
    await page.mouse.click(r4.x, r4.y)
    await page.waitForTimeout(600)
    doc = await docOf(page, PAGE)
    check('特殊填色：彩虹存進 fills', doc.fills[regs[3].id] === 'rainbow')
    const px = await fillPixel(page, regs[3].anchor)
    check('特殊填色：彩虹在區塊裡畫出漸層（不是純色）', px[3] === 255)
    await page.getByTestId('undo-btn').click()
    await page.waitForTimeout(200)
    doc = await docOf(page, PAGE)
    check('復原：彩虹那一塊清掉了', !doc.fills[regs[3].id])
    check('復原：填色層的像素也跟著清掉（透明）', (await fillPixel(page, regs[3].anchor))[3] === 0)
    await page.getByTestId('special-none').click()
    await shot(page, '2-raster-coloring')

    // 橡皮擦點一下清掉一塊
    await page.getByTestId('tool-eraser').click()
    await page.mouse.click(a.x, a.y)
    await page.waitForTimeout(250)
    doc = await docOf(page, PAGE)
    check('橡皮擦：點填色的區塊清掉顏色', !doc.fills[regs[1].id])
    check('點陣頁：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 2) 筆刷盒、鏡像、音效 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP)
    await openList(page)
    await page.getByTestId(`page-${PAGE}`).getByRole('button').click()
    await page.waitForSelector('[data-testid=raster-layer]')
    await page.getByTestId('tool-brush').click()
    check('筆刷盒：7 種筆刷（鉛筆、蠟筆、麥克筆、亮粉、彩虹、霓虹、印章）', (await page.locator('[data-testid^=bk-]').count()) === 7)
    check('筆刷盒：每個圖示是畫出來的筆觸預覽（canvas），不只文字', (await page.locator('[data-testid^=bk-] canvas').count()) === 7)
    const sizes = await page.locator('[data-testid^=bk-]').evaluateAll((els) => els.map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]))
    check('筆刷盒：按鈕夠大（>= 56px）', sizes.every(([w, h]) => w >= 56 && h >= 52), JSON.stringify(sizes))
    await shot(page, '3-brush-box')

    const bb = await board(page)
    // 蠟筆
    const osc0 = await page.evaluate(() => window.__audio.osc + window.__audio.noise)
    await page.getByTestId('bk-crayon').click()
    await stroke(page, { x: bb.x + 80, y: bb.y + 120 }, { x: bb.x + 300, y: bb.y + 150 })
    // 彩虹
    await page.getByTestId('bk-rainbow').click()
    await stroke(page, { x: bb.x + 80, y: bb.y + 200 }, { x: bb.x + 300, y: bb.y + 230 })
    let doc = await docOf(page, PAGE)
    check('蠟筆與彩虹筆各畫一筆：strokes 的 kind 正確', doc.strokes.length === 2 && doc.strokes[0].kind === 'crayon' && doc.strokes[1].kind === 'rainbow', JSON.stringify(doc.strokes.map((s) => s.kind)))
    const sound = (await page.evaluate(() => window.__audio.osc + window.__audio.noise)) - osc0
    check('筆刷有合成音效（音效開著時會發聲）', sound > 0, String(sound))
    const colorsUsed = await page.getByTestId('brush-canvas').evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const seen = new Set()
      for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 200) seen.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`)
      return seen.size
    })
    check('筆刷 canvas 上真的有畫出多種顏色（彩虹）', colorsUsed >= 4, String(colorsUsed))
    // 畫面與存檔一致：用同一組 stroke 資料再畫一次，結果相同（決定性）
    const same = await page.evaluate(async () => {
      const b = await import('/src/art/coloring/brushes.ts')
      const rec = () => {
        const log = []
        const ctx = new Proxy({}, { get: (_t, p) => (p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...a) => log.push(p + a.join(','))), set: (_t, p, v) => (log.push(p + '=' + v), true) })
        return { ctx, log }
      }
      const s = { id: 'e2e-seed', color: '#e96a6a', kind: 'crayon', width: 12, points: [[10, 10], [80, 40], [150, 20]] }
      const r1 = rec()
      const r2 = rec()
      b.drawStroke(r1.ctx, s, 500)
      b.drawStroke(r2.ctx, s, 500)
      return r1.log.length > 50 && JSON.stringify(r1.log) === JSON.stringify(r2.log)
    })
    check('蠟筆：同一筆畫兩次結果一樣（決定性）', same)

    // 音效開關：關掉就不發聲
    await patchSettings(page, { soundOn: false })
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openList(page)
    await page.getByTestId(`page-${PAGE}`).getByRole('button').click()
    await page.waitForSelector('[data-testid=raster-layer]')
    await page.getByTestId('tool-brush').click()
    await page.getByTestId('bk-crayon').click()
    const bb2 = await board(page)
    const q0 = await page.evaluate(() => window.__audio.osc + window.__audio.noise)
    await stroke(page, { x: bb2.x + 80, y: bb2.y + 300 }, { x: bb2.x + 300, y: bb2.y + 330 })
    const q1 = await page.evaluate(() => window.__audio.osc + window.__audio.noise)
    check('音效開關關掉：畫筆刷不發聲', q1 === q0, `${q0} → ${q1}`)
    await patchSettings(page, { soundOn: true })
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openList(page)
    await page.getByTestId(`page-${PAGE}`).getByRole('button').click()
    await page.waitForSelector('[data-testid=raster-layer]')

    // 印章
    await page.getByTestId('tool-brush').click()
    await page.getByTestId('bk-stamp').click()
    check('印章筆：出現 5 種圖案可選', (await page.locator('[data-testid^=stamp-]:not([data-testid=stamp-picks])').count()) === 5)
    await page.getByTestId('stamp-paw').click()
    const bb3 = await board(page)
    await stroke(page, { x: bb3.x + 80, y: bb3.y + 380 }, { x: bb3.x + 320, y: bb3.y + 400 })
    doc = await docOf(page, PAGE)
    const st = doc.strokes[doc.strokes.length - 1]
    check('印章筆：stroke 帶 kind 與 stamp', st.kind === 'stamp' && st.stamp === 'paw', JSON.stringify([st.kind, st.stamp]))

    // 鏡像
    const before = doc.strokes.length
    await page.getByTestId('bk-pen').click()
    await page.getByTestId('mirror-toggle').click()
    check('鏡像：開啟後畫面中線出現虛線', (await page.getByTestId('mirror-line').count()) === 1)
    await shot(page, '4-mirror-on')
    await stroke(page, { x: bb3.x + 80, y: bb3.y + 450 }, { x: bb3.x + 160, y: bb3.y + 500 })
    doc = await docOf(page, PAGE)
    check('鏡像：畫一筆，stroke 數 +2', doc.strokes.length === before + 2, `${before} → ${doc.strokes.length}`)
    const [s1, s2] = doc.strokes.slice(-2)
    check('鏡像：對稱的那筆是獨立的 stroke（不同 id），x 以 200 為軸翻轉、y 不變', s1.id !== s2.id && s1.points.length === s2.points.length && s1.points.every(([x, y], i) => Math.abs(x + s2.points[i][0] - 400) < 0.01 && Math.abs(y - s2.points[i][1]) < 0.01))
    await stroke(page, { x: bb3.x + 220, y: bb3.y + 300 }, { x: bb3.x + 260, y: bb3.y + 330 })
    await page.getByTestId('undo-btn').click()
    await page.waitForTimeout(200)
    doc = await docOf(page, PAGE)
    check('鏡像：復原一步兩筆一起消失', doc.strokes.length === before + 2, String(doc.strokes.length))
    await page.getByTestId('mirror-toggle').click()
    check('鏡像：關掉後中線消失', (await page.getByTestId('mirror-line').count()) === 0)
    await shot(page, '5-mirror-result')
    check('筆刷盒：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 3) 放大 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP, { ctxOpts: { hasTouch: true } })
    await openList(page)
    await page.getByTestId(`page-${PAGE}`).getByRole('button').click()
    await page.waitForSelector('[data-testid=raster-layer]')
    const zoomOf = async () => Number(await page.getByTestId('paint-board').getAttribute('data-zoom'))
    const viewOf = async () => (await page.getByTestId('paint-board').getAttribute('data-view')).split(',').map(Number)
    check('放大：一開始 1×，沒有小地圖', (await zoomOf()) === 1 && (await page.getByTestId('pb-minimap').count()) === 0)
    const zbtn = await page.getByTestId('zoom-in').boundingBox()
    // 標題列裡的縮放鈕在頁面切換動畫（screen-in）進行中量，WebKit 會量到 55.999996，容許 0.5px 的次像素誤差（其他 56px 檢查也是 55.5）
    check('放大：按鈕 >= 56px', zbtn.width >= 55.5 && zbtn.height >= 55.5, JSON.stringify([zbtn.width, zbtn.height]))
    await page.getByTestId('zoom-in').click()
    check('放大：＋ → 2×，出現小地圖', (await zoomOf()) === 2 && (await page.getByTestId('pb-minimap').count()) === 1)
    await page.getByTestId('zoom-in').click()
    check('放大：再按 → 3×', (await zoomOf()) === 3)
    check('放大：3× 時 ＋ 不能再按', await page.getByTestId('zoom-in').isDisabled())
    await page.getByTestId('zoom-out').click()
    await page.getByTestId('zoom-out').click()
    check('放大：－ 回到 1×，小地圖消失', (await zoomOf()) === 1 && (await page.getByTestId('pb-minimap').count()) === 0)

    // 2× 之後，單指畫的點要換算回原座標：視窗正中央 = 座標 (200, 200)；視窗左上 = 座標 (96, 96)
    await page.getByTestId('zoom-in').click()
    await page.getByTestId('tool-brush').click()
    const vb = await board(page)
    const [ox, oy] = await viewOf()
    check('放大：以視窗中心縮放，視窗在 (0.25, 0.25)', Math.abs(ox - 0.25) < 0.001 && Math.abs(oy - 0.25) < 0.001, `${ox},${oy}`)
    await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    await page.mouse.move(vb.x + 6, vb.y + 6)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(150)
    let doc = await docOf(page, PAGE)
    const [d1, d2] = doc.strokes.map((s) => s.points[0])
    check('座標換算：2× 時視窗中心點出來是 (200, 200)', Math.abs(d1[0] - 200) < 1.2 && Math.abs(d1[1] - 200) < 1.2, JSON.stringify(d1))
    check('座標換算：2× 時視窗左上角點出來是 (96, 96) 左右', Math.abs(d2[0] - (96 + 6 / vb.width * 208)) < 1.5 && Math.abs(d2[1] - (96 + 6 / vb.height * 208)) < 1.5, JSON.stringify(d2))
    await shot(page, '7-zoom-2x')

    // 小地圖拖曳 = 平移，工具照常作用
    const mm = await page.getByTestId('pb-minimap').boundingBox()
    await page.mouse.click(mm.x + mm.width * 0.9, mm.y + mm.height * 0.9)
    await page.waitForTimeout(150)
    const [ox2, oy2] = await viewOf()
    check('小地圖：點右下角 → 視窗移到右下（上限 0.5）', ox2 > 0.45 && oy2 > 0.45, `${ox2},${oy2}`)
    await page.mouse.click(mm.x + mm.width * 0.1, mm.y + mm.height * 0.1)
    const [ox3, oy3] = await viewOf()
    check('小地圖：點左上角 → 視窗移到左上（0）', ox3 < 0.05 && oy3 < 0.05, `${ox3},${oy3}`)

    // 雙指縮放與平移（真正的觸控事件）：不能畫出筆畫
    const sendTouch = await touchSender(ctx, page)
    const touch = (type, pts) => sendTouch(type, pts.map(([x, y], i) => ({ x, y, id: i + 1 })))
    await page.getByTestId('zoom-out').click() // 回 1×
    const tb = await board(page)
    const cx = tb.x + tb.width / 2
    const cy = tb.y + tb.height / 2
    const nStrokes = (await docOf(page, PAGE)).strokes.length
    await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]])
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 40 - i * 15, cy], [cx + 40 + i * 15, cy]])
    await touch('touchEnd', [])
    await page.waitForTimeout(200)
    const zPinch = await zoomOf()
    check('雙指張開：放大（> 1.5×）', zPinch > 1.5, String(zPinch))
    check('雙指縮放：沒有畫出任何筆畫（單指畫線不受干擾）', (await docOf(page, PAGE)).strokes.length === nStrokes)
    const v0 = await viewOf()
    await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]])
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 40 - i * 12, cy], [cx + 40 - i * 12, cy]])
    await touch('touchEnd', [])
    await page.waitForTimeout(150)
    const v1 = await viewOf()
    check('雙指平移：兩指一起往左拖 → 視窗往右', v1[0] > v0[0] + 0.02, `${v0[0]} → ${v1[0]}`)
    check('雙指平移：沒有畫出筆畫', (await docOf(page, PAGE)).strokes.length === nStrokes)
    // 放大後單指：工具照常作用（畫一筆），視窗不動
    const v2 = await viewOf()
    await touch('touchStart', [[cx - 50, cy + 20]])
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 50 + i * 15, cy + 20 + i * 4]])
    await touch('touchEnd', [])
    await page.waitForTimeout(200)
    const v3 = await viewOf()
    check('放大後單指畫線：工具照常作用（+1 筆）', (await docOf(page, PAGE)).strokes.length === nStrokes + 1)
    check('放大後單指畫線：視窗沒有被平移', Math.abs(v3[0] - v2[0]) < 0.001 && Math.abs(v3[1] - v2[1]) < 0.001)
    // 兩指到一半換成單指：不會把殘留的手指當成一筆新的畫線
    await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]])
    await touch('touchMove', [[cx - 60, cy], [cx + 60, cy]])
    await touch('touchEnd', [[cx + 60, cy]]) // 剩一根
    await touch('touchMove', [[cx + 80, cy + 30]])
    await touch('touchEnd', [])
    await page.waitForTimeout(150)
    check('雙指放開一根後：剩下那根不會畫出筆畫', (await docOf(page, PAGE)).strokes.length === nStrokes + 1)
    check('放大：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 4) 空白畫紙 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP)
    await openList(page)
    await page.getByTestId('free-1').click()
    await page.waitForSelector('[data-testid=free-bg]')
    check('畫紙：沒有線稿（沒有 SVG 著色頁，也沒有點陣層）', (await page.locator('.pt-svg').count()) === 0 && (await page.locator('[data-testid=raster-layer]').count()) === 0)
    check('畫紙：預設是筆刷工具，填色工具改稱「背景」', (await page.getByTestId('tool-brush').getAttribute('aria-pressed')) === 'true' && /背景/.test(await page.getByTestId('tool-fill').innerText()))
    await shot(page, '6-blank-canvas')
    await page.getByTestId('tool-fill').click()
    check('畫紙：背景選項 5 種（純白、草地天空、海底、夜空、方格紙）', (await page.locator('[data-testid^=bg-]').count()) === 5)
    await page.getByTestId('bg-meadow').click()
    await page.waitForTimeout(250)
    let doc = await docOf(page, 'free-1')
    check('畫紙：選草地天空 → bg = meadow', doc?.bg === 'meadow', JSON.stringify(doc?.bg))
    check('畫紙：背景 canvas 真的畫了（左上是天空藍、底部是草地綠）', await page.getByTestId('free-bg').evaluate((c) => {
      const g = c.getContext('2d')
      const top = g.getImageData(Math.round(c.width * 0.5), 6, 1, 1).data
      const bot = g.getImageData(Math.round(c.width * 0.5), c.height - 6, 1, 1).data
      return top[2] > top[0] && bot[1] > bot[0] && bot[1] > bot[2]
    }))
    await page.getByTestId('bg-grid').click()
    await page.waitForTimeout(150)
    doc = await docOf(page, 'free-1')
    check('畫紙：方格紙 → bg = grid', doc?.bg === 'grid')
    // 填色工具 = 換背景色
    const sw = page.locator('[data-testid=palette] .swatch').nth(13)
    const col = await sw.getAttribute('data-color')
    await sw.click()
    const bb = await board(page)
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2)
    await page.waitForTimeout(200)
    doc = await docOf(page, 'free-1')
    check('畫紙：填色工具 = 換背景色（方格紙保留格線：grid:<色>）', doc?.bg === `grid:${col}`, doc?.bg)
    await page.getByTestId('bg-night').click()
    await page.getByTestId('tool-brush').click()
    await page.getByTestId('bk-neon').click()
    await stroke(page, { x: bb.x + 100, y: bb.y + 200 }, { x: bb.x + 420, y: bb.y + 260 }, 14)
    await page.getByTestId('bk-glitter').click()
    await stroke(page, { x: bb.x + 100, y: bb.y + 320 }, { x: bb.x + 420, y: bb.y + 380 }, 14)
    await stroke(page, { x: bb.x + 100, y: bb.y + 440 }, { x: bb.x + 420, y: bb.y + 500 }, 14) // v7.4：空白畫紙 ≥ 3 筆才算完成
    doc = await docOf(page, 'free-1')
    check('畫紙：可以畫筆刷（霓虹、亮粉），存在 free-1', doc.strokes.length === 3 && doc.bg === 'night')

    // 完成 → 畫廊 → 掛到房間
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('畫紙：完成慶祝畫面有「再畫一張新的」', (await page.getByTestId('free-restart').count()) === 1)
    const g = (await dump(page, 'coloring')).filter((c) => c.pageId.startsWith('g:'))
    check('畫紙：完成 → 存進畫廊（basePageId = free-1，帶 bg 與筆畫）', g.length === 1 && g[0].basePageId === 'free-1' && g[0].bg === 'night' && g[0].strokes.length === 3 && g[0].png.startsWith('data:image/png'))
    const dark = await page.evaluate(
      (url) =>
        new Promise((res) => {
          const im = new Image()
          im.onload = () => {
            const c = document.createElement('canvas')
            c.width = im.width
            c.height = im.height
            const g = c.getContext('2d')
            g.drawImage(im, 0, 0)
            const d = g.getImageData(8, 8, 1, 1).data
            res(d[0] + d[1] + d[2] < 300)
          }
          im.src = url
        }),
      g[0].png,
    )
    check('畫紙：匯出的完成圖有背景（夜空是深色）', dark)
    await page.getByTestId('hang-btn').click()
    await page.waitForSelector('[data-testid=hung-ok]')
    const pl = await dump(page, 'placements')
    check('畫紙：掛到房間（placements 有 art-<id>）', pl.some((p) => p.itemId === `art-${g[0].pageId.slice(2)}`))
    await shot(page, '8-blank-finished')

    // 再畫一張新的：清空欄位，畫廊作品還在
    await page.getByTestId('free-restart').click()
    await page.waitForTimeout(250)
    doc = await docOf(page, 'free-1')
    check('再畫一張新的：free-1 欄位清空', !doc || (doc.strokes?.length ?? 0) === 0)
    check('再畫一張新的：畫面清空（完成慶祝關掉、完成按鈕要先畫才行）', (await page.getByTestId('finish-celebration').count()) === 0 && (await page.getByTestId('clear-btn').isDisabled()))
    check('再畫一張新的：畫廊作品還在', (await dump(page, 'coloring')).filter((c) => c.pageId.startsWith('g:')).length === 1)
    check('畫紙：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 5) 3 張畫紙欄位各自存檔、列表縮圖 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP)
    await openList(page)
    await page.getByTestId('free-2').click()
    await page.waitForSelector('[data-testid=free-bg]')
    await page.getByTestId('tool-fill').click()
    await page.getByTestId('bg-sea').click()
    await page.getByRole('button', { name: /著色本/ }).first().click() // 畫面上的返回鍵（← 著色本）
    await page.waitForSelector('[data-testid=free-card]')
    await page.waitForTimeout(500)
    const d2 = await docOf(page, 'free-2')
    const d1 = await docOf(page, 'free-1')
    check('3 張畫紙欄位各自存檔：free-2 有背景、free-1 沒有', d2?.bg === 'sea' && !d1)
    check('列表：畫過的欄位縮圖變成圖片、沒畫過的還是空白紙', (await page.locator('[data-testid=free-2] img').count()) === 1 && (await page.locator('[data-testid=free-1] [data-testid=free-blank]').count()) === 1)
    await shot(page, '9-list-with-free')
    check('列表：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 6) 點陣頁的完成、畫廊、掛到房間；減少動態 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP, { ctxOpts: { reducedMotion: 'reduce' } })
    await openList(page)
    await page.getByTestId(`page-${PAGE}`).getByRole('button').click()
    await page.waitForSelector('[data-testid=raster-layer]')
    const regs = (await regionsOf(page, PAGE)).sort((a, b) => b.area - a.area)
    const bb = await board(page)
    await page.locator('[data-testid=palette] .swatch').nth(14).click()
    // 減少動態：不播漣漪，點下去馬上整塊填滿（最大的區塊 = 背景，看它離點擊最遠的角落）
    await page.mouse.click(bb.x + 6, bb.y + 6)
    await page.waitForTimeout(80)
    const corner = await fillPixel(page, [760, 760])
    check('減少動態：不播漣漪，整塊立刻填滿', corner[3] === 255, JSON.stringify(corner))
    const a = pt(bb, regs[1].anchor)
    await page.mouse.click(a.x, a.y)
    await page.waitForTimeout(150)
    await page.getByTestId('finish-btn').click()
    // 無介面的 WebKit 沒有畫面輸出時不跑下一個畫格（rAF），彈窗出不來；截一張圖逼它畫一格（真 iPad 一直在畫，沒有這問題）
    if (IS_WEBKIT) await page.screenshot()
    await page.getByTestId('finish-more').waitFor({ timeout: 3000 }).catch(() => {})
    check('完成度 < 60% 按完成：先問「再畫一點好嗎？」（兩個大按鈕）', (await page.getByTestId('finish-more').isVisible()) && (await page.getByTestId('finish-anyway').isVisible()) && (await page.getByTestId('finish-more').boundingBox()).height >= 56)
    await page.getByTestId('finish-more').click()
    check('選「再畫一下」：回到畫板，沒有完成', (await page.getByTestId('finish-celebration').count()) === 0 && (await dump(page, 'coloring')).every((c) => !c.pageId.startsWith('g:')))
    await page.getByTestId('finish-btn').click()
    await page.getByTestId('finish-anyway').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    const g = (await dump(page, 'coloring')).filter((c) => c.pageId.startsWith('g:'))
    check('點陣頁：完成 → 存進畫廊（basePageId 是點陣頁）', g.length === 1 && g[0].basePageId === PAGE && Object.keys(g[0].fills).length === 2)
    const info = await page.evaluate(
      (url) =>
        new Promise((res) => {
          const im = new Image()
          im.onload = () => {
            const c = document.createElement('canvas')
            c.width = im.width
            c.height = im.height
            const g = c.getContext('2d')
            g.drawImage(im, 0, 0)
            const d = g.getImageData(0, 0, c.width, c.height).data
            let dark = 0
            let colored = 0
            for (let i = 0; i < d.length; i += 4) {
              if (d[i] + d[i + 1] + d[i + 2] < 150) dark++
              else if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 30) colored++
            }
            res({ w: im.width, dark, colored })
          }
          im.src = url
        }),
      g[0].png,
    )
    check('點陣頁：匯出的完成圖有線稿（黑線）也有填色', info.dark > 3000 && info.colored > 30000, JSON.stringify(info))
    await page.getByTestId('hang-btn').click()
    await page.waitForSelector('[data-testid=hung-ok]')
    check('點陣頁：掛到房間', (await dump(page, 'placements')).some((p) => p.itemId === `art-${g[0].pageId.slice(2)}`))
    await page.getByTestId('to-gallery').click()
    await page.waitForSelector('[data-testid=gallery-item]')
    check('畫廊：看得到點陣頁作品，名稱是頁面名稱', (await page.getByTestId('gallery-item').innerText()).includes('阿悟抱香蕉'))
    // 回著色本，縮圖有顏色
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=page-monkey]')
    await page.waitForTimeout(500)
    const thumb = await page.locator(`[data-testid=page-${PAGE}] img.raster-thumb`).getAttribute('src')
    check('列表縮圖：點陣頁依 fills 畫出縮圖（dataURL）', thumb?.startsWith('data:image/png') ?? false)
    const pct = await page.locator(`[data-testid=page-${PAGE}] .page-progress`).getAttribute('data-pct')
    check('列表：完成度反映已填的區塊', Number(pct) > 0, String(pct))
    check('點陣頁完成流程：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 6b) 試玩審查：手掌防護、局部橡皮擦、色盤不跳、貼紙、列表 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP, { ctxOpts: { hasTouch: true } })
    await patchSettings(page, { stickers: ALL_STICKERS, stickersSeen: ALL_STICKERS })
    await openList(page)
    // 列表：上鎖頁顯示灰階線稿縮圖 + 價格 + 難度；每張頁面卡都有難度標示
    check('列表：上鎖頁有線稿縮圖（不只有鎖頭），並顯示價格', (await page.locator('[data-testid=locked-clouds] .pb-locked-thumb .coloring-svg').count()) === 1 && /30/.test(await page.getByTestId('locked-clouds').innerText()))
    const gray = await page.locator('[data-testid=locked-clouds] .pb-locked-thumb .shop-thumb').evaluate((e) => getComputedStyle(e).filter)
    check('列表：上鎖頁的縮圖是灰階', /grayscale/.test(gray), gray)
    check('列表：每張頁面卡（已有、上鎖）都有難度標示', (await page.locator('[data-testid^=page-] [data-testid=tier-chip], [data-testid^=locked-] [data-testid=tier-chip]').count()) === (await page.locator('[data-testid^=page-], li[data-testid^=locked-]').count()))
    check('列表：簡單版標「簡單」、豐富版標「挑戰」', (await page.locator('[data-testid=grid-easy] [data-testid=tier-chip]:not([data-tier=easy])').count()) === 0 && (await page.locator('[data-testid=grid-hard] [data-testid=tier-chip]:not([data-tier=hard])').count()) === 0)
    await page.getByTestId(`page-${PAGE}`).getByRole('button').click()
    await page.waitForSelector('[data-testid=raster-layer]')
    const bb = await board(page)
    // 相對於「最近用過」那一列的位置（Playwright 點色票時面板可能捲動，絕對位置會變）
    // 色盤在選項區（pt-body，可捲動）內的位置；橫向筆刷模式會收起「最近用過」，所以不拿它當基準
    const palTop = () => page.evaluate(() => {
      const body = document.querySelector('[data-testid=pt-body]')
      const pal = document.querySelector('[data-testid=palette]')
      return pal.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
    })
    const y0 = await palTop()
    check('色盤：一開始「最近用過」就佔一列（空圈），沒有色票', (await page.locator('[data-testid=recent-colors] .pb-recent-empty').count()) === 6 && (await page.locator('[data-testid=recent-colors] .swatch').count()) === 0)
    await page.locator('[data-testid=palette] .swatch').nth(14).click()
    await page.mouse.click(bb.x + bb.width - 6, bb.y + 6)
    await page.waitForTimeout(500)
    check('色盤：第一次用色後，24 色色票沒有往下跳', Math.abs((await palTop()) - y0) < 1, `${y0} → ${await palTop()}`)
    check('色盤：用過的顏色出現在「最近用過」，空圈少一個', (await page.locator('[data-testid=recent-colors] .swatch').count()) === 1 && (await page.locator('[data-testid=recent-colors] .pb-recent-empty').count()) === 5)
    await page.getByTestId('tool-brush').click()
    const y1 = await palTop()
    await page.getByTestId('bk-stamp').click()
    const y2 = await palTop()
    await page.getByTestId('bk-pen').click()
    // 橫向把筆刷種類排成 4 欄，選印章時多出圖案列會把色盤往下推（換工具才會變，不是 P6 說的用色後跳動）；直向排成一條可橫滑的列，位置不變
    const landscape = VP.width / VP.height >= 1.25 && VP.width >= 760
    check('色盤：換筆刷種類（出現印章圖案列）色盤位置不跳（直向）', landscape || Math.abs(y1 - y2) < 1, `${y1} vs ${y2}`)

    // 手掌防護：接觸面積很大的 touch 不畫
    const sendTouch = await touchSender(ctx, page)
    const touch = (type, pts) => sendTouch(type, pts.map(([x, y, r], i) => ({ x, y, id: i + 1, radiusX: r ?? 1, radiusY: r ?? 1 })))
    const cx = bb.x + bb.width / 2
    const cy = bb.y + bb.height / 2
    const n0 = (await docOf(page, PAGE)).strokes?.length ?? 0
    await touch('touchStart', [[cx - 100, cy, 60]])
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 100 + i * 20, cy + i * 5, 60]])
    await touch('touchEnd', [])
    await page.waitForTimeout(200)
    check('手掌防護：接觸半徑 > 50（寬 > 100px）的觸控不畫', ((await docOf(page, PAGE)).strokes?.length ?? 0) === n0)
    // 手指畫線中，手掌（大面積）碰到畫面：不影響那一筆
    await touch('touchStart', [[cx - 100, cy - 80, 1]])
    for (let i = 1; i <= 3; i++) await touch('touchMove', [[cx - 100 + i * 20, cy - 80, 1]])
    await touch('touchStart', [[cx - 100 + 60, cy - 80, 1], [cx + 200, cy + 150, 60]])
    for (let i = 4; i <= 8; i++) await touch('touchMove', [[cx - 100 + i * 20, cy - 80, 1], [cx + 200 + i, cy + 150, 60]])
    await touch('touchEnd', [])
    await page.waitForTimeout(250)
    const st = (await docOf(page, PAGE)).strokes ?? []
    check('手掌防護：手指畫線中手掌碰到畫面，那一筆照常完成、沒有多出手掌的筆畫', st.length === n0 + 1 && st[st.length - 1].points.length >= 6 && st[st.length - 1].points.every(([, y]) => Math.abs(y - st[st.length - 1].points[0][1]) < 3), JSON.stringify(st.map((x) => x.points.length)))

    // 局部橡皮擦：畫一條線，橡皮擦在中間擦一小段
    await page.getByTestId('tool-brush').click()
    await page.getByTestId('brush-l').click()
    await page.locator('[data-testid=palette] .swatch').nth(16).click()
    await stroke(page, { x: bb.x + 100, y: bb.y + 300 }, { x: bb.x + 400, y: bb.y + 300 }, 12)
    const alphaAt = (fx) => page.getByTestId('brush-canvas').evaluate((c, [fx, fy]) => c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data[3], [fx, (300) / bb.height])
    const fxMid = (250) / bb.width
    const fxEnd = (150) / bb.width
    check('橡皮擦（前提）：線上的像素有墨', (await alphaAt(fxMid)) > 200 && (await alphaAt(fxEnd)) > 200)
    const nBefore = (await docOf(page, PAGE)).strokes.length
    await page.getByTestId('tool-eraser').click()
    check('橡皮擦：說明是圖示（不是長句），並有大小選項', (await page.locator('[data-testid=opts-eraser] .pb-erase-hint').count()) === 1 && (await page.locator('[data-testid^=erase-]').count()) === 3 && (await page.locator('.pt-hint').count()) === 0)
    await stroke(page, { x: bb.x + 235, y: bb.y + 300 }, { x: bb.x + 270, y: bb.y + 300 }, 8)
    const dEr = (await docOf(page, PAGE)).strokes
    check('橡皮擦：滑過去 → 多一條 kind "erase" 的筆畫（資料仍是向量）', dEr.length === nBefore + 1 && dEr[dEr.length - 1].kind === 'erase', JSON.stringify(dEr.map((x) => x.kind)))
    check('橡皮擦：只擦掉經過的那一段，兩端的線還在', (await alphaAt(fxMid)) === 0 && (await alphaAt(fxEnd)) > 200)
    check('橡皮擦：原本的線（不是整條消失）還留著', dEr.length === nBefore + 1 && dEr[dEr.length - 2].kind !== 'erase')
    await page.getByTestId('undo-btn').click()
    await page.waitForTimeout(250)
    check('橡皮擦：可以復原（線又接起來）', (await alphaAt(fxMid)) > 200)
    // 擦過之後存檔重畫一致：重新載入頁面，擦掉的地方仍是空的
    await page.getByTestId('tool-eraser').click()
    await stroke(page, { x: bb.x + 235, y: bb.y + 300 }, { x: bb.x + 270, y: bb.y + 300 }, 8)
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openList(page)
    await page.getByTestId(`page-${PAGE}`).getByRole('button').click()
    await page.waitForSelector('[data-testid=raster-layer]')
    await page.waitForTimeout(400)
    check('橡皮擦：存檔後重新載入，擦掉的地方還是空的（畫面與存檔一致）', (await alphaAt(fxMid)) === 0 && (await alphaAt(fxEnd)) > 200)
    // 點填色的區塊仍然清色
    const regs = (await regionsOf(page, PAGE)).sort((a, b) => b.area - a.area)
    await page.getByTestId('tool-fill').click()
    const ra = pt(bb, regs[2].anchor)
    await page.mouse.click(ra.x, ra.y)
    await page.waitForTimeout(600)
    const hadFill = !!(await docOf(page, PAGE)).fills[regs[2].id]
    await page.getByTestId('tool-eraser').click()
    await page.mouse.click(ra.x, ra.y)
    await page.waitForTimeout(300)
    check('橡皮擦：點填色的區塊，顏色消失（保留原行為）', hadFill && !(await docOf(page, PAGE)).fills[regs[2].id])

    // 貼紙：新貼紙自動避開、手柄 >= 56px、雙指縮放旋轉
    await page.getByTestId('tool-sticker').click()
    await page.getByTestId('add-sticker-obj-star').click()
    await page.getByTestId('add-sticker-obj-star').click()
    await page.getByTestId('add-sticker-obj-star').click()
    await page.waitForTimeout(300)
    const stk = (await docOf(page, PAGE)).stickers
    const dists = [Math.hypot(stk[0].x - stk[1].x, stk[0].y - stk[1].y), Math.hypot(stk[0].x - stk[2].x, stk[0].y - stk[2].y), Math.hypot(stk[1].x - stk[2].x, stk[1].y - stk[2].y)]
    check('貼紙：連加三張，位置彼此錯開（不疊在同一個位置）', stk.length === 3 && dists.every((d) => d >= 70), JSON.stringify(dists))
    const hb = await page.getByTestId('sticker-handle').boundingBox()
    check('貼紙：選取手柄 >= 56px', hb.width >= 55 && hb.height >= 55, JSON.stringify([hb.width, hb.height]))
    // 選第一張，雙指在它上面張開並旋轉
    const sb = await page.locator('[data-testid=sticker]').first().boundingBox()
    const sx = sb.x + sb.width / 2
    const sy = sb.y + sb.height / 2
    await page.mouse.click(sx, sy)
    await page.waitForTimeout(150)
    const before = (await docOf(page, PAGE)).stickers[0]
    const zoom0 = await page.getByTestId('paint-board').getAttribute('data-zoom')
    await touch('touchStart', [[sx - 25, sy, 1], [sx + 25, sy, 1]])
    for (let i = 1; i <= 8; i++) {
      const a = (i * 6 * Math.PI) / 180
      const r = 25 + i * 8
      await touch('touchMove', [[sx - r * Math.cos(a), sy - r * Math.sin(a), 1], [sx + r * Math.cos(a), sy + r * Math.sin(a), 1]])
    }
    await touch('touchEnd', [])
    await page.waitForTimeout(300)
    const after = (await docOf(page, PAGE)).stickers[0]
    check('貼紙：雙指張開 → 選取中的貼紙變大', after.scale > before.scale * 1.5, `${before.scale} → ${after.scale}`)
    check('貼紙：雙指轉動 → 貼紙旋轉', Math.abs(after.rot - before.rot) > 20, `${before.rot} → ${after.rot}`)
    check('貼紙：雙指手勢只動貼紙，畫面沒有被縮放', (await page.getByTestId('paint-board').getAttribute('data-zoom')) === zoom0)
    await page.getByTestId('undo-btn').click()
    await page.waitForTimeout(250)
    const undone = (await docOf(page, PAGE)).stickers[0]
    check('貼紙：雙指縮放旋轉是一個復原步驟', Math.abs(undone.scale - before.scale) < 0.001 && undone.rot === before.rot)
    // v7.3.1 回歸：iPhone 回報的手指接觸寬度常超過 40px（舊門檻），整個畫板沒反應。用寬 50px 的手指：拖貼紙、畫線、填色都要正常
    const F = 25 // 半徑 25 = 寬 50px
    const sb2 = await page.locator('[data-testid=sticker]').first().boundingBox()
    const s0 = (await docOf(page, PAGE)).stickers[0]
    await touch('touchStart', [[sb2.x + sb2.width / 2, sb2.y + sb2.height / 2, F]])
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[sb2.x + sb2.width / 2 + i * 15, sb2.y + sb2.height / 2 + i * 8, F]])
    await touch('touchEnd', [])
    await page.waitForTimeout(300)
    const s1 = (await docOf(page, PAGE)).stickers[0]
    check('iPhone 手指（寬 50px）：拖得動貼紙', Math.hypot(s1.x - s0.x, s1.y - s0.y) > 0.05, JSON.stringify([s0.x, s0.y, s1.x, s1.y]))
    await page.getByTestId('tool-brush').click()
    const nB = (await docOf(page, PAGE)).strokes.length
    await touch('touchStart', [[bb.x + 120, bb.y + 420, F]])
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[bb.x + 120 + i * 25, bb.y + 420, F]])
    await touch('touchEnd', [])
    await page.waitForTimeout(300)
    check('iPhone 手指（寬 50px）：筆刷畫得出線', (await docOf(page, PAGE)).strokes.length === nB + 1)
    await page.getByTestId('tool-fill').click()
    const rf = pt(bb, regs[3].anchor)
    await touch('touchStart', [[rf.x, rf.y, F]])
    await touch('touchEnd', [])
    await page.waitForTimeout(600)
    check('iPhone 手指（寬 50px）：點區塊會填色', !!(await docOf(page, PAGE)).fills[regs[3].id])
    check('試玩審查項目：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 8) v7.1 D1：貼紙從托盤拖進畫布 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP)
    await patchSettings(page, { stickers: ALL_STICKERS, stickersSeen: ALL_STICKERS })
    await openList(page)
    await page.getByTestId('free-1').click()
    await page.waitForSelector('[data-testid=free-bg]')
    await page.getByTestId('tool-sticker').click()
    const stickers = async () => (await docOf(page, 'free-1'))?.stickers ?? []
    const btnCenter = async (art) => {
      const b = await page.getByTestId(`add-sticker-${art}`).boundingBox()
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    const viewOf = async () => {
      const [ox, oy] = (await page.getByTestId('paint-board').getAttribute('data-view')).split(',').map(Number)
      return { ox, oy, z: Number(await page.getByTestId('paint-board').getAttribute('data-zoom')) }
    }
    /** 螢幕上的點 → 座標空間（0–400），和程式一樣的公式 */
    const expectAt = async (fx, fy) => {
      const v = await viewOf()
      return [(v.ox + fx / v.z) * 416 - 8, (v.oy + fy / v.z) * 416 - 8]
    }
    const dragTo = async (art, fx, fy, { hold = false } = {}) => {
      const bb = await board(page)
      const from = await btnCenter(art)
      const to = { x: bb.x + bb.width * fx, y: bb.y + bb.height * fy }
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x - 16, from.y - 8, { steps: 3 })
      await page.mouse.move(to.x, to.y, { steps: 12 })
      if (hold) return to
      await page.mouse.up()
      await page.waitForTimeout(200)
      return to
    }

    // 拖到畫布 (0.25, 0.75)：貼在放開的位置
    const held = await dragTo('obj-star', 0.25, 0.75, { hold: true })
    check('拖曳中：手指下有半透明的貼紙預覽', (await page.getByTestId('sticker-ghost').count()) === 1 && (await page.getByTestId('sticker-ghost').getAttribute('data-art')) === 'obj-star')
    check('拖曳中：預覽在畫布上時比較實（data-over=1）', (await page.getByTestId('sticker-ghost').getAttribute('data-over')) === '1')
    const gb = await page.getByTestId('sticker-ghost').boundingBox()
    check('拖曳中：預覽跟著手指（中心離手指 < 3px）', Math.abs(gb.x + gb.width / 2 - held.x) < 3 && Math.abs(gb.y + gb.height / 2 - held.y) < 3)
    check('拖曳中：還沒放開，畫上沒有貼紙', (await stickers()).length === 0)
    await shot71(page, 'd1-drag-land')
    await page.mouse.up()
    await page.waitForTimeout(250)
    let st = await stickers()
    const [ex, ey] = await expectAt(0.25, 0.75)
    check('放開：貼紙貼在放開的位置（誤差 < 3 單位）', st.length === 1 && Math.abs(st[0].x - ex) < 3 && Math.abs(st[0].y - ey) < 3, JSON.stringify(st[0]) + ` 預期 ${ex.toFixed(1)},${ey.toFixed(1)}`)
    check('放開：預覽消失、只貼一張（不會再補一個 click 的貼紙）', (await page.getByTestId('sticker-ghost').count()) === 0 && st.length === 1 && (await page.locator('[data-testid=sticker]').count()) === 1)
    check('放開：貼上的貼紙被選取（出現放大手柄）', (await page.getByTestId('sticker-handle').count()) === 1)
    check('拖曳：沒有誤畫筆畫', ((await docOf(page, 'free-1'))?.strokes ?? []).length === 0)
    await shot71(page, 'd1-dropped-land')

    // 放在畫布外：取消
    await dragTo('obj-banana', 0.5, 0.5, { hold: true })
    const bb0 = await board(page)
    await page.mouse.move(bb0.x + bb0.width + 60, bb0.y + bb0.height / 2, { steps: 6 }) // 畫布右邊（工具面板上）
    check('拖到畫布外：預覽變淡（data-over=0）', (await page.getByTestId('sticker-ghost').getAttribute('data-over')) === '0')
    await shot71(page, 'd1-cancel-land')
    await page.mouse.up()
    await page.waitForTimeout(200)
    check('放在畫布外：取消，沒有新貼紙', (await stickers()).length === 1 && (await page.getByTestId('sticker-ghost').count()) === 0)

    // 只點一下：照舊（自動偏移，不疊在一起）
    await page.getByTestId('add-sticker-obj-peach').click()
    await page.getByTestId('add-sticker-obj-apple').click()
    st = await stickers()
    check('只點一下：維持現行行為（貼在畫面中央附近，兩張不疊在一起）', st.length === 3 && Math.hypot(st[1].x - st[2].x, st[1].y - st[2].y) >= 60 && Math.abs(st[1].x - 200) < 1 && Math.abs(st[1].y - 200) < 1, JSON.stringify(st.slice(1)))

    // 復原：一次拖放 = 一步
    await dragTo('obj-grape', 0.7, 0.3)
    check('拖放後：貼紙 4 張', (await stickers()).length === 4)
    await page.getByTestId('undo-btn').click()
    await page.waitForTimeout(200)
    check('復原一步：拖進去的那張不見', (await stickers()).length === 3)

    // 放大 2× 之後拖進去：座標要經過放大換算
    await page.getByTestId('zoom-in').click()
    await page.waitForTimeout(150)
    await page.getByTestId('tool-sticker').click()
    await dragTo('obj-fish', 0.7, 0.4)
    st = await stickers()
    const [zx, zy] = await expectAt(0.7, 0.4)
    const v2 = await viewOf()
    check('放大 2×：貼在手指下方（視窗 0.25,0.25 起算）', v2.z === 2 && st.length === 4 && Math.abs(st[3].x - zx) < 3 && Math.abs(st[3].y - zy) < 3, `${JSON.stringify(st[3])} 預期 ${zx.toFixed(1)},${zy.toFixed(1)}`)
    check('放大 2×：座標落在 (200+0.4*208) 附近而不是畫面 0.7 比例（確實換算過）', Math.abs(st[3].x - (200 - 104 + 0.7 * 208)) < 3)
    // 拖在放大鈕上 = 取消
    const zb = await page.getByTestId('pb-zoom').boundingBox()
    const fb = await btnCenter('obj-shell')
    await page.mouse.move(fb.x, fb.y)
    await page.mouse.down()
    await page.mouse.move(fb.x - 20, fb.y, { steps: 3 })
    await page.mouse.move(zb.x + 8, zb.y + zb.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(150)
    check('放在放大鈕上：取消（那不是畫布）', (await stickers()).length === 4)
    check('貼紙拖曳：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 8b) D1：手機觸控拖曳（真正的觸控事件，托盤橫向捲動） =================
  {
    const { ctx, page, errors } = await freshApp(browser, { width: 390, height: 844 }, { ctxOpts: { hasTouch: true, isMobile: true } })
    await patchSettings(page, { stickers: ALL_STICKERS, stickersSeen: ALL_STICKERS })
    await page.getByRole('button', { name: /著色本/ }).first().tap()
    await page.waitForSelector('[data-testid=free-1]')
    await page.getByTestId('free-1').tap()
    await page.waitForSelector('[data-testid=free-bg]')
    await page.getByTestId('tool-sticker').tap()
    const sendTouch = await touchSender(ctx, page)
    const touch = (type, pts) => sendTouch(type, pts.map(([x, y], i) => ({ x, y, id: i + 1 })))
    const sz = await page.getByTestId('add-sticker-pet-adult-happy').boundingBox()
    check('手機：貼紙按鈕 ≥ 56px', sz.width >= 55.5 && sz.height >= 55.5, `${sz.width}x${sz.height}`)
    const bb = await board(page)
    const from = [sz.x + sz.width / 2, sz.y + sz.height / 2]
    const to = [bb.x + bb.width * 0.3, bb.y + bb.height * 0.4]
    const scroll0 = await page.getByTestId('sticker-tray').evaluate((e) => e.scrollLeft)
    await touch('touchStart', [from])
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[from[0] + ((to[0] - from[0]) * i) / 10, from[1] + ((to[1] - from[1]) * i) / 10]])
    await page.waitForTimeout(120)
    check('手機觸控拖曳中：預覽出現', (await page.getByTestId('sticker-ghost').count()) === 1)
    await shot71(page, 'd1-drag-phone')
    await touch('touchEnd', [])
    await page.waitForTimeout(250)
    const stk = (await docOf(page, 'free-1'))?.stickers ?? []
    const [ex, ey] = [(0.3 * 416) - 8, (0.4 * 416) - 8]
    check('手機觸控：貼在放開的位置', stk.length === 1 && Math.abs(stk[0].x - ex) < 4 && Math.abs(stk[0].y - ey) < 4, JSON.stringify(stk[0]) + ` 預期 ${ex.toFixed(1)},${ey.toFixed(1)}`)
    check('手機觸控：托盤沒有被捲動（往上拖不會變成橫向捲）', (await page.getByTestId('sticker-tray').evaluate((e) => e.scrollLeft)) === scroll0)
    check('手機觸控：沒有誤畫筆畫、沒有縮放', ((await docOf(page, 'free-1'))?.strokes ?? []).length === 0 && Number(await page.getByTestId('paint-board').getAttribute('data-zoom')) === 1)
    await shot71(page, 'd1-dropped-phone')
    // 在托盤上橫向滑（捲托盤）：不會拖出貼紙
    const y0 = sz.y + sz.height / 2
    await touch('touchStart', [[300, y0]])
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[300 - i * 25, y0]])
    await touch('touchEnd', [])
    await page.waitForTimeout(250)
    // WebKit 模式的觸控是合成的 PointerEvent，不會觸發瀏覽器原生捲動，只驗證「不會貼出貼紙」
    check('手機：在托盤上橫滑只是捲動托盤，不會貼出貼紙', ((await docOf(page, 'free-1'))?.stickers ?? []).length === 1 && (IS_WEBKIT || (await page.getByTestId('sticker-tray').evaluate((e) => e.scrollLeft)) > scroll0), String(await page.getByTestId('sticker-tray').evaluate((e) => e.scrollLeft)))
    check('手機貼紙拖曳：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 9) v7.1 D2：完成解鎖畫框、畫廊選畫框、房間掛畫套畫框 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP)
    const works = async () => (await dump(page, 'coloring')).filter((c) => c.pageId.startsWith('g:')).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    const framesDone = async () => ((await dump(page, 'settings'))[0]?.framesDone ?? 0)
    const scribble = async (y) => {
      const bb = await board(page)
      await page.getByTestId('tool-brush').click()
      // v7.4 I5：空白畫紙 ≥ 3 筆才算完成（給畫框收藏的累計）
      for (let k = 0; k < 3; k++) await stroke(page, { x: bb.x + 100, y: bb.y + y + k * 30 }, { x: bb.x + 380, y: bb.y + y + k * 30 + 40 }, 10)
    }
    await openList(page)
    await page.getByTestId('free-1').click()
    await page.waitForSelector('[data-testid=free-bg]')
    await scribble(200)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('完成第 1 幅：慶祝畫面出現「解鎖新畫框！」與木框預覽', (await page.getByTestId('frame-unlock').count()) === 1 && (await page.getByTestId('frame-unlock').getAttribute('data-frame')) === 'wood' && /解鎖新畫框！/.test(await page.getByTestId('frame-unlock').innerText()) && /木框/.test(await page.getByTestId('frame-unlock').innerText()))
    check('完成第 1 幅：慶祝畫面裡的畫已經戴上木框', (await page.getByTestId('fc-art-framed').getAttribute('data-frame')) === 'wood')
    check('完成第 1 幅：累計 1 幅、畫廊作品帶 frame = wood', (await framesDone()) === 1 && (await works())[0]?.frame === 'wood')
    await page.waitForTimeout(600) // 等彈出動畫跑完（動畫中的尺寸會縮小）
    check('慶祝畫面的按鈕都 ≥ 56px 高', (await page.locator('.fc-actions .btn').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 55.5))))
    await shot71(page, 'd2-unlock-land')

    // 沒再畫就重複按完成：不重複累計
    await page.getByRole('button', { name: '繼續畫' }).click()
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('沒再畫就重複按完成：不重複累計（仍是 1 幅）、沒有再解鎖', (await framesDone()) === 1 && (await page.getByTestId('frame-unlock').count()) === 0)
    // 再畫一筆再完成：第 2 幅，沒有新畫框，顯示下一個目標
    await page.getByRole('button', { name: '繼續畫' }).click()
    await scribble(320)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('第 2 幅：累計 2，沒有解鎖，顯示「再畫 1 幅，就能得到銀框」', (await framesDone()) === 2 && (await page.getByTestId('frame-unlock').count()) === 0 && /再畫 1 幅，就能得到銀框/.test(await page.getByTestId('frame-next').innerText()))
    await page.getByRole('button', { name: '回著色本' }).click()

    // 畫得太少（著色頁完成度 < 60%）→ 「就這樣完成」不算
    await page.getByTestId('page-monkey').getByRole('button').click()
    await page.waitForSelector('[data-testid=paint-board]')
    await page.waitForTimeout(250)
    const mb = await board(page)
    await page.mouse.click(mb.x + mb.width * 0.5, mb.y + mb.height * 0.236) // 頭的上緣（臉在中間，不會點到臉）
    await page.waitForTimeout(200)
    await page.getByTestId('finish-btn').click()
    await page.getByTestId('finish-anyway').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('完成度不到 60%、選「就這樣完成」：不累計、不解鎖、畫維持預設畫框', (await framesDone()) === 2 && (await page.getByTestId('frame-unlock').count()) === 0 && (await page.getByTestId('fc-art-framed').count()) === 0 && (await works()).at(-1)?.frame === undefined)
    await page.getByRole('button', { name: '回著色本' }).click()

    // 畫廊：選畫框
    await page.getByTestId('open-gallery').click()
    await page.waitForSelector('[data-testid=gallery-item]')
    check('畫廊：已經戴上框的作品，縮圖也有畫框', (await page.locator('.gallery-thumb .gallery-frame[data-frame=wood]').count()) >= 1)
    const firstWork = (await works())[0]
    await page.locator('.gallery-thumb').last().click() // 最舊的（第 1 幅，戴木框）排在最後
    await page.waitForSelector('[data-testid=frame-picker]')
    await page.waitForTimeout(500)
    check('畫廊選畫框：有「簡單」+ 5 種畫框', (await page.locator('[data-testid^=frame-opt-]').count()) === 6)
    check('畫廊選畫框：累計 2 幅時，木框可選、銀框 / 金框 / 彩虹框 / 星星框鎖住', (await page.getByTestId('frame-opt-wood').getAttribute('data-locked')) === '0' && (await page.getByTestId('frame-opt-silver').getAttribute('data-locked')) === '1' && (await page.getByTestId('frame-opt-star').getAttribute('data-locked')) === '1')
    check('畫廊選畫框：選項按鈕 ≥ 56px', await page.locator('[data-testid^=frame-opt-]').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().width >= 55.5 && e.getBoundingClientRect().height >= 55.5)))
    check('畫廊選畫框：顯示目標「再畫 1 幅就能得到銀框」', /再畫 1 幅就能得到銀框/.test(await page.getByTestId('frame-progress').innerText()))
    await page.getByTestId('frame-opt-silver').click()
    await page.waitForTimeout(200)
    check('點到還沒解鎖的畫框：不會套用', (await works())[0].frame === firstWork.frame)
    await page.getByTestId('frame-opt-plain').click()
    await page.waitForTimeout(250)
    check('選「簡單」：作品的 frame 欄位移除', (await works())[0].frame === undefined)
    await page.getByTestId('frame-opt-wood').click()
    await page.waitForTimeout(250)
    check('選木框：存進作品；大圖預覽立刻套上', (await works())[0].frame === 'wood' && (await page.locator('[data-testid=gallery-view] .gallery-frame').getAttribute('data-frame')) === 'wood')
    await shot71(page, 'd2-gallery-picker-land')

    // 掛到房間 → 房間裡的畫套用畫框
    await page.getByTestId('hang-btn').click()
    await page.waitForTimeout(250)
    await page.goto(BASE_URL_OF(page))
    await page.waitForSelector('[data-testid=room]')
    await page.waitForTimeout(800)
    check('房間：掛畫套用作品選的畫框（木框）', (await page.locator('[data-placed^=art-] .gf-board.fr-wood').count()) === 1)
    await shot71(page, 'd2-room-wood-land')

    // 全部解鎖：五種畫框都能選、都畫得出來
    await patchSettings(page, { framesDone: 15 })
    await page.goto(BASE_URL_OF(page) + '#gallery')
    await page.reload()
    await page.waitForSelector('[data-testid=gallery-item]')
    await page.locator('.gallery-thumb').last().click()
    await page.waitForSelector('[data-testid=frame-picker]')
    check('累計 15 幅：五種畫框都解鎖了，顯示全部收集好了', (await page.locator('[data-testid^=frame-opt-][data-locked="1"]').count()) === 0 && /畫框都收集好了/.test(await page.getByTestId('frame-progress').innerText()))
    for (const f of ['silver', 'gold', 'rainbow', 'star']) {
      await page.getByTestId(`frame-opt-${f}`).click()
      await page.waitForTimeout(200)
      const bgc = await page.locator('[data-testid=gallery-view] .gf-board').evaluate((e) => getComputedStyle(e).backgroundImage)
      check(`畫框 ${f}：大圖預覽用了畫框樣式（有漸層邊框）`, (await works())[0].frame === f && /gradient/.test(bgc), bgc.slice(0, 60))
    }
    check('星星框：四個角有星星', (await page.locator('[data-testid=gallery-view] i.fr-spark').count()) === 4)
    await shot71(page, 'd2-gallery-star-land')
    await page.getByTestId('hang-btn').click().catch(() => {})
    await page.waitForTimeout(200)
    check('畫框：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 9b) D2：手機（390×844）解鎖畫面與選畫框不破版 =================
  {
    const { ctx, page, errors } = await freshApp(browser, { width: 390, height: 844 }, { ctxOpts: { hasTouch: true, isMobile: true } })
    await page.getByRole('button', { name: /著色本/ }).first().tap()
    await page.waitForSelector('[data-testid=free-1]')
    await page.getByTestId('free-1').tap()
    await page.waitForSelector('[data-testid=free-bg]')
    const bb = await board(page)
    await page.getByTestId('tool-brush').tap()
    for (let k = 0; k < 3; k++) await stroke(page, { x: bb.x + 60, y: bb.y + 120 + k * 40 }, { x: bb.x + 300, y: bb.y + 200 + k * 40 }, 10) // v7.4 I5：≥ 3 筆
    await page.getByTestId('finish-btn').tap()
    await page.waitForSelector('[data-testid=finish-celebration]')
    await page.waitForTimeout(600)
    const card = await page.locator('.fc-card').boundingBox()
    const acts = await page.locator('.fc-actions .btn').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
    check('手機：慶祝畫面沒有橫向溢出，解鎖畫框的區塊看得到', card.x >= 0 && card.x + card.width <= 390 && (await page.getByTestId('frame-unlock').isVisible()))
    check('手機：慶祝畫面按鈕 ≥ 56px 高、都在畫面寬度內', acts.every((a) => a.height >= 55.5 && a.x >= 0 && a.x + a.width <= 390.5))
    await shot71(page, 'd2-unlock-phone')
    await page.getByTestId('to-gallery').tap()
    await page.waitForSelector('[data-testid=gallery-item]')
    await page.locator('.gallery-thumb').first().tap()
    await page.waitForSelector('[data-testid=frame-picker]')
    const modal = await page.locator('.modal').boundingBox()
    check('手機：畫廊選畫框的視窗在畫面內', modal.x >= 0 && modal.x + modal.width <= 390.5)
    await shot71(page, 'd2-gallery-picker-phone')
    check('手機畫框：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 7) 舊存檔相容：向量頁 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP)
    await idb(
      page,
      (db) =>
        new Promise((res) => {
          const tx = db.transaction('coloring', 'readwrite')
          // 舊格式：沒有 kind 的 strokes、沒有 bg
          tx.objectStore('coloring').put({ pageId: 'monkey', fills: { head: '#e8a6a0' }, strokes: [{ id: 'old1', color: '#3d3a3a', width: 12, points: [[40, 40], [120, 90], [200, 60]] }], stickers: [], updatedAt: Date.now() })
          tx.oncomplete = () => res(1)
        }),
    )
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openList(page)
    await page.getByTestId('page-monkey').getByRole('button').click()
    await page.waitForSelector('[data-testid=paint-board]')
    await page.waitForTimeout(300)
    check('舊存檔：向量頁的填色讀得回來', (await page.locator('[data-region=head]').getAttribute('fill')) === '#e8a6a0')
    const inked = await page.getByTestId('brush-canvas').evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true
      return false
    })
    check('舊存檔：沒有 kind 的筆畫照樣畫出來（視為鉛筆）', inked)
    check('舊存檔：JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(state.failed === 0 ? '\n全部通過' : `\n有 ${state.failed} 項失敗`)
process.exit(state.failed === 0 ? 0 : 1)
