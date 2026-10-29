// v7.4 線 I：繪圖板 E2E（Playwright）。涵蓋：
//   I1 空白畫紙：填色桶（flood fill、防漏、復原、重載一致、橡皮擦清除）、形狀章（圓、方、愛心，點一下 / 拖大小）、背景工具照舊
//   I2 作品出口：畫廊「存圖」（Web Share API 帶 PNG、不支援就下載）、家長區「本週」最近作品縮圖、畫廊空狀態
//   I3 著色列表：完成的頁有勾勾與作品縮圖、「再畫一次」保留舊作
//   I4 貼紙盤：預設 8 張、解鎖的出現並標「新」、用過就不再標、舊作用過的貼紙視為已解鎖、拖貼紙 / 拖已貼的貼紙
//   I5 小修：完成對話框按鈕有圖示、空白畫紙 ≥ 3 筆或有貼紙才算完成並給星星、橫向面板的空白給「最近用過」
//   觸控一律用接近真機的手指（radiusX 25）。截圖放 SHOTS_DIR（預設 <系統暫存>/guaibao-paint74-shots），不放 repo。
// 用法：先啟動 dev server（pnpm dev --port 5202 --strictPort），再
//   BASE_URL=http://localhost:5202 node scripts/e2e-paint74.mjs      （或 pnpm e2e:paint74）
//   E2E_BROWSER=webkit BASE_URL=... node scripts/e2e-paint74.mjs     Safari 引擎 + iPad 模擬
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IS_WEBKIT, freshApp, idb, launch, makeChecker, openParentTab, touchSender } from './e2e-lib.mjs'

const OUT = process.env.SHOTS_DIR ?? join(tmpdir(), 'guaibao-paint74-shots')
mkdirSync(OUT, { recursive: true })
const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const R = 25 // 接近真機的手指（接觸半徑 25px = 寬 50px）
const FREE_LINE = '再多畫幾筆，或貼一張貼紙吧'
const EMPTY_LINE = '還沒有畫畫喔，我們去畫一張吧'
const DEFAULT_STICKERS = ['pet-adult-happy', 'obj-banana', 'obj-apple', 'obj-peach', 'obj-grape', 'food-cake', 'decor-rocket', 'decor-dino']
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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
const dump = (page, table) => idb(page, (db, t) => new Promise((res) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => res(e.target.result))), table)
const rowOf = (page, id) => idb(page, (db, id) => new Promise((res) => (db.transaction('coloring').objectStore('coloring').get(id).onsuccess = (e) => res(e.target.result ?? null))), id)
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
const settingsOf = async (page) => (await dump(page, 'settings'))[0]
const works = async (page) => (await dump(page, 'coloring')).filter((c) => c.pageId.startsWith('g:')).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
const shot = async (page, name) => {
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}
const board = (page) => page.getByTestId('paint-board').boundingBox()
/** 筆刷層上，螢幕位置 (sx, sy) 那一格的 RGBA */
const pxAt = (page, sx, sy) =>
  page.evaluate(
    ([sx, sy]) => {
      const c = document.querySelector('[data-testid=brush-canvas]')
      const r = c.getBoundingClientRect()
      const x = Math.min(c.width - 1, Math.max(0, Math.round(((sx - r.left) / r.width) * c.width)))
      const y = Math.min(c.height - 1, Math.max(0, Math.round(((sy - r.top) / r.height) * c.height)))
      return Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data)
    },
    [sx, sy],
  )
const canvasHash = (page) =>
  page.evaluate(() => {
    const s = document.querySelector('[data-testid=brush-canvas]').toDataURL()
    let h = 0
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
    return `${s.length}:${h}`
  })
const near = (rgba, h, tol = 6) => {
  const want = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  return rgba[3] >= 250 && want.every((v, i) => Math.abs(v - rgba[i]) <= tol)
}
const bboxOf = (pts) => ({ w: Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), h: Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])), cx: (Math.max(...pts.map((p) => p[0])) + Math.min(...pts.map((p) => p[0]))) / 2, cy: (Math.max(...pts.map((p) => p[1])) + Math.min(...pts.map((p) => p[1]))) / 2 })
const circlePts = (cx, cy, r, n = 48, gapFrom = -1, gapTo = -1) => {
  const pts = []
  for (let i = 0; i <= n; i++) {
    if (gapFrom >= 0 && i > gapFrom && i < gapTo) continue
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return pts
}
const openList = async (page) => {
  await page.getByRole('button', { name: /著色本/ }).first().click()
  await page.waitForSelector('[data-testid=free-1]')
}
const openFree = async (page, n = 1) => {
  await openList(page)
  await page.getByTestId(`free-${n}`).click()
  await page.waitForSelector('[data-testid=free-bg]')
  await page.waitForTimeout(300)
}
const swatch = (page, i) => page.locator('[data-testid=palette] .swatch').nth(i)
const regionsOf = (page, id) => page.evaluate(async (pid) => (await import('/src/art/coloring/pages.ts')).getColoringPage(pid).regions.map((r) => r.id), id)
/** 手指：send = touchSender；一律 radiusX/Y = 25 */
const fingerOf = (send) => {
  const pt = (x, y, id = 1) => ({ x, y, id, radiusX: R, radiusY: R })
  return {
    tap: async (x, y) => {
      await send('touchStart', [pt(x, y)])
      await send('touchEnd', [])
    },
    drag: async (pts) => {
      await send('touchStart', [pt(pts[0][0], pts[0][1])])
      for (const [x, y] of pts.slice(1)) await send('touchMove', [pt(x, y)])
      await send('touchEnd', [])
    },
  }
}

const browser = await launch()
try {
  // ================= I1：填色桶、形狀章（橫向 1180×820）=================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    const send = await touchSender(ctx, page)
    const finger = fingerOf(send)
    await openFree(page)
    const tools = await page.locator('.pt-tools .pt-tool').evaluateAll((els) => els.map((e) => ({ id: e.dataset.testid, label: e.querySelector('span:last-child').innerText.trim(), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })))
    check('I1 空白畫紙工具列：筆刷、形狀、填色、貼紙、橡皮擦、背景（6 顆）', tools.map((t) => t.id).join() === 'tool-brush,tool-shape,tool-bucket,tool-sticker,tool-eraser,tool-fill' && tools.map((t) => t.label).join() === '筆刷,形狀,填色,貼紙,橡皮擦,背景', JSON.stringify(tools.map((t) => t.label)))
    check('I1 工具鈕都 ≥ 44px 寬、≥ 56px 高', tools.every((t) => t.w >= 44 && t.h >= 56), JSON.stringify(tools.map((t) => Math.round(t.w))))
    await page.getByTestId('tool-bucket').click()
    check('I1 填色工具：有說明（點一下圈起來的地方）', (await page.getByTestId('opts-bucket').count()) === 1)

    const bb = await board(page)
    const cx = bb.x + bb.width * 0.3
    const cy = bb.y + bb.height * 0.32
    // 畫一個圓（手指，r=90px），故意留一個缺口（約 14px ≈ 9 單位，比預設防漏寬、比加大版窄）
    await page.getByTestId('tool-brush').click()
    await swatch(page, 13).click()
    const lineColor = await swatch(page, 13).getAttribute('data-color')
    await finger.drag(circlePts(cx, cy, 90, 40, 36, 38))
    await page.waitForTimeout(250)
    let doc = await rowOf(page, 'free-1')
    check('I1 前提：手指畫出一圈（1 筆）', doc.strokes.length === 1 && doc.strokes[0].kind === undefined || doc.strokes[0].kind === 'pen', `strokes=${doc.strokes.length}`)
    check('I1 前提：圈上有墨，圈內是空白', (await pxAt(page, cx + 90, cy))[3] > 200 && (await pxAt(page, cx, cy))[3] === 0)

    // 填色桶：選另一個顏色、手指點圈內
    await page.getByTestId('tool-bucket').click()
    await swatch(page, 14).click()
    const fillColor = await swatch(page, 14).getAttribute('data-color')
    await finger.tap(cx, cy)
    await page.waitForTimeout(500)
    doc = await rowOf(page, 'free-1')
    const f1 = doc.strokes[doc.strokes.length - 1]
    check('I1 填色桶：手指點一下 → 多一筆 kind "fill"（存檔只記位置與顏色）', doc.strokes.length === 2 && f1.kind === 'fill' && f1.color === fillColor && f1.points.length === 1, JSON.stringify(f1))
    check('I1 填色桶：圈內填滿了所選的顏色', near(await pxAt(page, cx, cy), fillColor) && near(await pxAt(page, cx + 40, cy + 30), fillColor) && near(await pxAt(page, cx - 60, cy - 50), fillColor))
    check('I1 防漏：圈有缺口也封得住，外面沒有被填', (await pxAt(page, bb.x + 20, bb.y + 20))[3] === 0 && (await pxAt(page, cx + 130, cy))[3] === 0 && (await pxAt(page, cx, cy + 130))[3] === 0)
    check('I1 填色桶：線沒有被蓋掉', near(await pxAt(page, cx - 90, cy), lineColor, 40))
    await shot(page, 'i1-land-bucket')
    const hashFilled = await canvasHash(page)

    // 復原：整個填色消失，線還在
    await page.getByTestId('undo-btn').click()
    await page.waitForTimeout(300)
    doc = await rowOf(page, 'free-1')
    check('I1 復原：填色那一筆不見，圈內回到空白，線還在', doc.strokes.length === 1 && (await pxAt(page, cx, cy))[3] === 0 && (await pxAt(page, cx - 90, cy))[3] > 200)
    // 再填一次（換另一個顏色），之後測重載
    await swatch(page, 17).click()
    const fill2 = await swatch(page, 17).getAttribute('data-color')
    await finger.tap(cx, cy)
    await page.waitForTimeout(500)
    check('I1 再填：換成新顏色', near(await pxAt(page, cx, cy), fill2))
    // 點已填色的區塊再換色（容差：同色的一塊）
    await swatch(page, 20).click()
    const fill3 = await swatch(page, 20).getAttribute('data-color')
    await finger.tap(cx + 20, cy + 20)
    await page.waitForTimeout(500)
    doc = await rowOf(page, 'free-1')
    check('I1 再換色：點在已填的區塊上，整塊換成新顏色', near(await pxAt(page, cx, cy), fill3) && near(await pxAt(page, cx - 50, cy + 40), fill3) && doc.strokes.length === 3)
    // 點在同一個顏色上不多存一筆
    await finger.tap(cx, cy)
    await page.waitForTimeout(300)
    check('I1 已經是這個顏色：不多存一筆', (await rowOf(page, 'free-1')).strokes.length === 3)

    // 重新載入：畫面與存檔一致（填色重畫的結果相同）
    const hashBefore = await canvasHash(page)
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openFree(page)
    await page.waitForTimeout(500)
    check('I1 重載：填色還在（圈內是同一個顏色）', near(await pxAt(page, cx, cy), fill3) && near(await pxAt(page, cx + 40, cy - 40), fill3))
    check('I1 重載：整張筆畫層的像素和重載前完全一致', (await canvasHash(page)) === hashBefore)
    void hashFilled

    // 橡皮擦：滑過去局部擦掉（填色也被擦）；點一下色塊 = 整塊清掉
    await page.getByTestId('tool-eraser').click()
    await finger.drag([[cx - 60, cy + 10], [cx - 20, cy + 10], [cx + 20, cy + 10], [cx + 60, cy + 10]])
    await page.waitForTimeout(400)
    doc = await rowOf(page, 'free-1')
    check('I1 橡皮擦：滑過填色 → 多一條 erase 筆畫，經過的地方清掉、旁邊還在', doc.strokes[doc.strokes.length - 1].kind === 'erase' && (await pxAt(page, cx, cy + 10))[3] === 0 && near(await pxAt(page, cx, cy - 60), fill3))
    await page.getByTestId('undo-btn').click()
    await page.waitForTimeout(300)
    check('I1 橡皮擦可以復原', near(await pxAt(page, cx, cy + 10), fill3))
    await finger.tap(cx + 30, cy - 40)
    await page.waitForTimeout(500)
    doc = await rowOf(page, 'free-1')
    const clr = doc.strokes[doc.strokes.length - 1]
    check('I1 橡皮擦：手指點一下填色 → 整塊清掉（存成一筆 clear 的填色）', clr.kind === 'fill' && clr.color === 'clear' && (await pxAt(page, cx, cy))[3] === 0 && (await pxAt(page, cx - 40, cy + 40))[3] === 0 && (await pxAt(page, cx - 90, cy))[3] > 200, JSON.stringify(clr))
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openFree(page)
    await page.waitForTimeout(500)
    check('I1 橡皮擦清掉的填色，重載後仍是空白（線還在）', (await pxAt(page, cx, cy))[3] === 0 && (await pxAt(page, cx - 90, cy))[3] > 200)

    // 形狀章
    await page.getByTestId('tool-shape').click()
    check('I1 形狀工具：圓、方、愛心 3 個按鈕，都 ≥ 56px', (await page.locator('[data-testid^=shape-]:not([data-testid^=shape-size])').count()) === 3 && (await page.locator('.i74-shape').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().width >= 56 && e.getBoundingClientRect().height >= 56))))
    const n0 = (await rowOf(page, 'free-1')).strokes.length
    const sx = bb.x + bb.width * 0.68
    const sy = bb.y + bb.height * 0.3
    await swatch(page, 12).click()
    await finger.tap(sx, sy)
    await page.waitForTimeout(300)
    doc = await rowOf(page, 'free-1')
    const c1 = doc.strokes[doc.strokes.length - 1]
    let b = bboxOf(c1.points)
    check('I1 形狀章（圓）：手指點一下 → 蓋出預設大小的外框（1 筆向量筆畫）', doc.strokes.length === n0 + 1 && c1.shape === 'circle' && c1.kind === 'pen' && Math.abs(b.w - 112) < 4 && Math.abs(b.h - 112) < 4, JSON.stringify(b))
    check('I1 形狀章：外框封閉、中心在點的位置', JSON.stringify(c1.points[0]) === JSON.stringify(c1.points[c1.points.length - 1]) && Math.abs(((sx - bb.x) / bb.width) * 400 - b.cx) < 8, JSON.stringify([b.cx, ((sx - bb.x) / bb.width) * 400]))
    await page.getByTestId('shape-square').click()
    await finger.tap(sx, bb.y + bb.height * 0.62)
    await page.waitForTimeout(250)
    await page.getByTestId('shape-heart').click()
    await finger.tap(bb.x + bb.width * 0.38, bb.y + bb.height * 0.78)
    await page.waitForTimeout(250)
    doc = await rowOf(page, 'free-1')
    const [sq, ht] = doc.strokes.slice(-2)
    check('I1 形狀章：方、愛心各一筆（shape 記錄圖形）', sq.shape === 'square' && ht.shape === 'heart' && doc.strokes.length === n0 + 3, `${sq.shape},${ht.shape}`)
    check('I1 方形：寬 = 高 ≈ 112', Math.abs(bboxOf(sq.points).w - 112) < 4 && Math.abs(bboxOf(sq.points).h - 112) < 4)
    // 拖大小：從圓心往外拉 120px（≈ 74 單位）
    await page.getByTestId('shape-circle').click()
    const dx = bb.x + bb.width * 0.15
    const dy = bb.y + bb.height * 0.82
    await finger.drag([[dx, dy], [dx + 20, dy], [dx + 60, dy], [dx + 120, dy]])
    await page.waitForTimeout(300)
    doc = await rowOf(page, 'free-1')
    const big = doc.strokes[doc.strokes.length - 1]
    const wantR = (120 / bb.width) * 416 // 座標空間單位（0–400 對應 416 單位的畫布邊）
    check('I1 形狀章：手指拉開 → 依距離調大小（半徑約 74 單位）', Math.abs(bboxOf(big.points).w / 2 - wantR * (400 / 416)) < 6, JSON.stringify(bboxOf(big.points)))
    await shot(page, 'i1-land-shapes')
    // 形狀用填色桶塗滿
    await page.getByTestId('tool-bucket').click()
    await swatch(page, 19).click()
    const fill4 = await swatch(page, 19).getAttribute('data-color')
    await finger.tap(sx, sy)
    await page.waitForTimeout(500)
    check('I1 形狀章蓋出來的圓，用填色桶塗滿（外框封得起來）', near(await pxAt(page, sx, sy), fill4) && (await pxAt(page, sx + 120, sy))[3] === 0)
    // 愛心也能塗
    await finger.tap(bb.x + bb.width * 0.38, bb.y + bb.height * 0.78 - 8)
    await page.waitForTimeout(500)
    check('I1 愛心塗滿', near(await pxAt(page, bb.x + bb.width * 0.38, bb.y + bb.height * 0.78 - 8), fill4))
    // 形狀章可以復原
    const nShape = (await rowOf(page, 'free-1')).strokes.length
    await page.getByTestId('undo-btn').click()
    await page.getByTestId('undo-btn').click()
    await page.waitForTimeout(300)
    check('I1 形狀章、填色都能復原', (await rowOf(page, 'free-1')).strokes.length === nShape - 2)
    await shot(page, 'i1-land-after')
    // 背景工具照舊
    await page.getByTestId('tool-fill').click()
    check('I1 背景工具仍在（場景 5 種、點一下換背景色）', (await page.locator('[data-testid^=bg-]').count()) === 5)
    await page.getByTestId('bg-night').click()
    await page.waitForTimeout(200)
    check('I1 背景：選夜空 → bg = night（和筆畫層互不影響）', (await rowOf(page, 'free-1')).bg === 'night')
    // 完成圖（匯出的 PNG）也有填色：筆畫層用同一套 drawStroke 重畫（填色桶那一筆在匯出時重新 flood fill）
    await page.getByTestId('tool-bucket').click()
    await swatch(page, 22).click()
    const fill5 = await swatch(page, 22).getAttribute('data-color')
    await finger.tap(sx, sy)
    await page.waitForTimeout(500)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    const png = (await works(page)).pop().png
    const out = await page.evaluate(
      async ([png, fx, fy, ox, oy]) => {
        const im = new Image()
        await new Promise((r) => ((im.onload = r), (im.src = png)))
        const c = document.createElement('canvas')
        c.width = im.width
        c.height = im.height
        const g = c.getContext('2d')
        g.drawImage(im, 0, 0)
        return { fill: Array.from(g.getImageData(Math.round(fx * im.width), Math.round(fy * im.height), 1, 1).data), outside: Array.from(g.getImageData(Math.round(ox * im.width), Math.round(oy * im.height), 1, 1).data) }
      },
      [png, (sx - bb.x) / bb.width, (sy - bb.y) / bb.height, (sx + 130 - bb.x) / bb.width, (sy - bb.y) / bb.height],
    )
    check('I1 完成圖（PNG）：形狀裡面有填色、外面沒有', near(out.fill, fill5, 10) && !near(out.outside, fill5, 10), JSON.stringify(out))
    await page.getByTestId('fc-keep-free').click()
    check('I1 JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= I1 小螢幕：直向、手機工具列不破版 =================
  for (const [tag, size] of [['port', SIZES.port], ['phone', SIZES.phone]]) {
    const { ctx, page, errors } = await freshApp(browser, size, { ctxOpts: { hasTouch: true, ...(tag === 'phone' ? { isMobile: true } : {}) } })
    const send = await touchSender(ctx, page)
    const finger = fingerOf(send)
    await openFree(page)
    const bar = await page.locator('.pt-tools').boundingBox()
    const tools = await page.locator('.pt-tools .pt-tool').evaluateAll((els) => els.map((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, x: e.getBoundingClientRect().x, r: e.getBoundingClientRect().right })))
    check(`I1 ${tag}：6 顆工具鈕排成一列、沒有溢出螢幕、每顆 ≥ 44px`, tools.length === 6 && tools.every((t) => t.x >= 0 && t.r <= size.width + 0.5 && t.w >= 44 && t.h >= 52), JSON.stringify(tools.map((t) => Math.round(t.w))) + ' bar ' + Math.round(bar.width))
    const bb = await board(page)
    await page.getByTestId('tool-shape').click()
    await shot(page, `i1-${tag}-shape-opts`)
    const rowFits = await page.getByTestId('opts-shape').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
    check(`I1 ${tag}：形狀選項（3 個圖形 + 粗細）看得到、圖形鈕 ≥ 56px`, (await page.locator('.i74-shape').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().width >= 56))) && (await page.getByTestId('shape-heart').isVisible()), JSON.stringify(rowFits))
    await finger.tap(bb.x + bb.width * 0.35, bb.y + bb.height * 0.4)
    await page.waitForTimeout(250)
    await page.getByTestId('tool-bucket').click()
    await finger.tap(bb.x + bb.width * 0.35, bb.y + bb.height * 0.4)
    await page.waitForTimeout(500)
    check(`I1 ${tag}：手指蓋形狀 + 手指點填色桶 → 填滿`, (await pxAt(page, bb.x + bb.width * 0.35, bb.y + bb.height * 0.4))[3] === 255)
    await shot(page, `i1-${tag}-bucket`)
    check(`I1 ${tag}：JS 沒有錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= I5：完成對話框圖示、空白畫紙完成門檻、橫向面板空白 =================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    await ctx.addInitScript(SPEECH_STUB)
    await page.evaluate(SPEECH_STUB)
    const send = await touchSender(ctx, page)
    const finger = fingerOf(send)
    await openFree(page)
    const bb = await board(page)
    // 橫向面板：筆刷模式「最近用過」放回來了，選項與色盤之間的空白縮小
    const gapOf = () =>
      page.evaluate(() => {
        const body = document.querySelector('[data-testid=pt-body]')
        const wrap = document.querySelector('[data-testid=palette-wrap]')
        const opts = [...body.children].filter((e) => e !== wrap && e.getBoundingClientRect().height > 0)
        const last = opts[opts.length - 1]
        const rec = document.querySelector('[data-testid=recent-colors]')
        return { gap: Math.round(wrap.getBoundingClientRect().top - (last ? last.getBoundingClientRect().bottom : body.getBoundingClientRect().top)), recentH: Math.round(rec.getBoundingClientRect().height), recentShown: getComputedStyle(rec).display !== 'none' }
      })
    const gaps = {}
    for (const t of ['brush', 'shape', 'bucket', 'fill', 'eraser']) {
      await page.getByTestId(`tool-${t}`).click()
      await page.waitForTimeout(150)
      gaps[t] = await gapOf()
    }
    check('I5 橫向 1180×820：筆刷模式「最近用過」一列顯示出來（不空著）', gaps.brush.recentShown && gaps.brush.recentH >= 40, JSON.stringify(gaps.brush))
    check('I5 橫向：各工具的選項與色盤之間的空白 ≤ 110px（原本約 190px）', Object.values(gaps).every((g) => g.gap <= 110), JSON.stringify(gaps))
    await page.getByTestId('tool-brush').click()
    const sizeH = await page.locator('[data-testid^=brush-]').evaluateAll((els) => els.filter((e) => /^brush-[sml]$/.test(e.dataset.testid)).map((e) => Math.round(e.getBoundingClientRect().height)))
    check('I5 橫向：筆粗按鈕變大（≥ 60px 高）', sizeH.length === 3 && sizeH.every((h) => h >= 60), JSON.stringify(sizeH))
    await shot(page, 'i5-land-brush')
    await page.getByTestId('tool-fill').click()
    await shot(page, 'i5-land-bg')

    // 空白畫紙只畫 1 筆 → 完成：先問「再畫一點好嗎？」
    await page.getByTestId('tool-brush').click()
    await finger.drag([[bb.x + 80, bb.y + 120], [bb.x + 200, bb.y + 160], [bb.x + 320, bb.y + 140]])
    await page.waitForTimeout(250)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-ask]')
    check('I5 空白畫紙只有 1 筆：按完成先問「再畫一點好嗎？」', (await page.getByTestId('finish-ask').count()) === 1 && /多畫幾筆/.test(await page.getByTestId('finish-ask').innerText()))
    check('I5 阿悟說「再多畫幾筆，或貼一張貼紙吧」', (await spoken(page)).includes(FREE_LINE), JSON.stringify(await spoken(page)))
    const ico = await page.locator('[data-testid=finish-more-ico], [data-testid=finish-anyway-ico]').evaluateAll((els) => els.map((e) => ({ t: e.textContent, fs: parseFloat(getComputedStyle(e).fontSize), v: e.getBoundingClientRect().height > 0 })))
    check('I5 完成對話框：「再畫一下」有筆圖示、「就這樣完成」有勾圖示（≥ 28px）', ico.length === 2 && ico[0].t.includes('✏') && ico[1].t.includes('✅') && ico.every((i) => i.v && i.fs >= 28), JSON.stringify(ico))
    await page.waitForTimeout(500)
    const btnH = await page.locator('.pb-ask-btn').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    check('I5 完成對話框：按鈕 ≥ 76px 高', btnH.length === 2 && btnH.every((h) => h >= 76), JSON.stringify(btnH))
    await shot(page, 'i5-land-ask')
    await page.getByTestId('finish-more').click()
    await page.waitForTimeout(200)
    check('I5 「再畫一下」：關掉對話框、回到畫板', (await page.getByTestId('finish-ask').count()) === 0)
    // 鏡像：一筆鏡像（2 筆資料）仍只算 1 筆
    await page.getByTestId('mirror-toggle').click()
    await finger.drag([[bb.x + 80, bb.y + 300], [bb.x + 160, bb.y + 340], [bb.x + 240, bb.y + 330]])
    await page.waitForTimeout(250)
    const d2 = await rowOf(page, 'free-1')
    check('I5 前提：鏡像一筆 = 資料 2 條（其中一條 twin）', d2.strokes.length === 3 && d2.strokes.filter((s) => s.twin).length === 1)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-ask]')
    check('I5 鏡像的兩條算 1 筆：共 2 筆，還是要問', (await page.getByTestId('finish-ask').count()) === 1)
    // 就這樣完成：存進畫廊，但沒有星星、不算畫框收藏
    await page.getByTestId('finish-anyway').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('I5 「就這樣完成」：進畫廊、沒有星星', (await works(page)).length === 1 && (await page.getByTestId('finish-celebration').getAttribute('data-stars')) === '0' && (await page.getByTestId('fc-stars').count()) === 0)
    check('I5 不算畫框收藏（framesDone 不增加）、流水帳沒有「完成作品」', !(await settingsOf(page)).framesDone && (await dump(page, 'ledger')).every((l) => l.reason !== '完成作品'))
    await page.getByTestId('free-restart').click()
    await page.waitForTimeout(250)
    // 畫 3 筆 → 直接完成、+5 星
    await page.getByTestId('tool-brush').click()
    await page.getByTestId('mirror-toggle').click() // 關鏡像
    for (let k = 0; k < 3; k++) await finger.drag([[bb.x + 80, bb.y + 100 + k * 50], [bb.x + 200, bb.y + 130 + k * 50], [bb.x + 320, bb.y + 110 + k * 50]])
    await page.waitForTimeout(250)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('I5 空白畫紙 3 筆：不用問，直接完成並給 +5 星星', (await page.getByTestId('finish-ask').count()) === 0 && (await page.getByTestId('finish-celebration').getAttribute('data-stars')) === '5' && (await dump(page, 'ledger')).some((l) => l.reason === '完成作品' && l.delta === 5))
    check('I5 算畫框收藏（framesDone = 1）', (await settingsOf(page)).framesDone === 1)
    await page.getByTestId('free-restart').click()
    await page.waitForTimeout(250)
    // 只貼一張貼紙 → 完成（有貼紙就算）。這張是第 2 個欄位，今天的星星獎勵是每個欄位一次
    await page.getByTestId('fc-back').count()
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=free-2]')
    await page.getByTestId('free-2').click()
    await page.waitForSelector('[data-testid=free-bg]')
    await page.getByTestId('tool-sticker').click()
    await page.getByTestId('add-sticker-obj-banana').click()
    await page.waitForTimeout(250)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('I5 只貼一張貼紙也算完成（+5 星星）', (await page.getByTestId('finish-ask').count()) === 0 && (await page.getByTestId('finish-celebration').getAttribute('data-stars')) === '5')
    // 著色頁（向量頁）完成度不足的對話框也有圖示
    await page.getByTestId('fc-back').click()
    await page.waitForSelector('[data-testid=page-monkey]')
    await page.getByTestId('page-monkey').getByRole('button').first().click()
    await page.waitForSelector('[data-testid=paint-board]')
    const ids = await regionsOf(page, 'monkey')
    await putRow(page, 'coloring', { pageId: 'monkey', fills: { [ids[0]]: '#e96a6a' }, strokes: [], stickers: [], updatedAt: Date.now() })
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openList(page)
    await page.getByTestId('page-monkey').getByRole('button').first().click()
    await page.waitForSelector('[data-testid=paint-board]')
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-ask]')
    check('I1 一般著色頁的工具列維持 4 顆（填色、筆刷、貼紙、橡皮擦），沒有桶子與形狀', (await page.locator('.pt-tools .pt-tool').count()) === 4 && (await page.getByTestId('tool-bucket').count()) === 0 && (await page.getByTestId('tool-shape').count()) === 0)
        check('I5 著色頁完成度不足：對話框一樣有筆與勾圖示，說明仍是「還有很多地方沒有塗到」', (await page.locator('[data-testid=finish-more-ico]').count()) === 1 && (await page.locator('[data-testid=finish-anyway-ico]').count()) === 1 && /還有很多地方/.test(await page.getByTestId('finish-ask').innerText()))
    check('I5 JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= I4：貼紙盤會成長 =================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true } })
    await ctx.addInitScript(SPEECH_STUB)
    await page.evaluate(SPEECH_STUB)
    const send = await touchSender(ctx, page)
    const finger = fingerOf(send)
    await openFree(page)
    await page.getByTestId('tool-sticker').click()
    const arts = () => page.locator('[data-testid^=add-sticker-]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('add-sticker-', '')))
    check('I4 預設只有 8 張貼紙（阿悟只有 1 張）', JSON.stringify(await arts()) === JSON.stringify(DEFAULT_STICKERS), JSON.stringify(await arts()))
    check('I4 預設的貼紙不標「新」', (await page.locator('.i74-new').count()) === 0)
    check('I4 貼紙按鈕 ≥ 52px', await page.locator('[data-testid^=add-sticker-]').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().width >= 51.5)))
    await shot(page, 'i4-land-default')
    // 舊作品用過的貼紙視為已解鎖：free-2 的舊作品上有 decor-rainbow（沒擁有）
    await putRow(page, 'coloring', { pageId: 'free-2', fills: {}, strokes: [], stickers: [{ id: 'old1', art: 'decor-rainbow', x: 200, y: 200, scale: 1.2, rot: 0 }], updatedAt: Date.now() })
    await putRow(page, 'coloring', { pageId: 'g:old', basePageId: 'free-3', fills: {}, strokes: [], stickers: [{ id: 'old2', art: 'mat-flower', x: 100, y: 100, scale: 1, rot: 0 }], png: PNG1, createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000 })
    // 收到禮物貼紙：obj-star、obj-fish
    await patchSettings(page, { stickers: ['obj-star', 'obj-fish'] })
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openFree(page, 2)
    check('I4 舊作品的貼紙（沒擁有的 decor-rainbow）還在畫布上', (await page.getByTestId('sticker').count()) === 1 && (await page.getByTestId('sticker').getAttribute('data-art')) === 'decor-rainbow')
    await page.getByTestId('tool-sticker').click()
    await page.waitForTimeout(300)
    const list = await arts()
    check('I4 解鎖：禮物的貼紙（obj-star、obj-fish）+ 舊作用過的（decor-rainbow、mat-flower）進了貼紙盤，共 12 張', list.length === 12 && ['obj-star', 'obj-fish', 'decor-rainbow', 'mat-flower'].every((a) => list.includes(a)), JSON.stringify(list))
    check('I4 沒擁有也沒用過的（obj-rabbit）不在貼紙盤', !list.includes('obj-rabbit'))
    check('I4 新解鎖的標「新」排最前面（star、fish）；舊作用過的不算新', JSON.stringify(list.slice(0, 2)) === JSON.stringify(['obj-star', 'obj-fish']) && (await page.locator('.i74-new').count()) === 2 && (await page.getByTestId('new-obj-star').isVisible()) && (await page.locator('[data-testid=new-decor-rainbow]').count()) === 0)
    check('I4 阿悟說「有新的貼紙喔！」', (await spoken(page)).includes('有新的貼紙喔！'), JSON.stringify(await spoken(page)))
    await shot(page, 'i4-land-new')
    // 手指把新貼紙從貼紙盤拖進畫布 → 貼在放開的位置；用過就不再標新
    const bb = await board(page)
    const star = await page.getByTestId('add-sticker-obj-star').boundingBox()
    const drop = [bb.x + bb.width * 0.7, bb.y + bb.height * 0.3]
    await finger.drag([[star.x + star.width / 2, star.y + star.height / 2], [star.x + star.width / 2 - 40, star.y + star.height / 2], [bb.x + bb.width * 0.9, bb.y + bb.height * 0.4], drop]) // 往畫布的方向（左）拖；托盤是直向捲動，橫向的移動才算拖曳
    await page.waitForTimeout(400)
    let doc = await rowOf(page, 'free-2')
    const st = doc.stickers.find((s) => s.art === 'obj-star')
    const want = [((drop[0] - bb.x) / bb.width) * 416 - 8, ((drop[1] - bb.y) / bb.height) * 416 - 8]
    check('I4 手指拖新貼紙進畫布：貼在放開的位置', !!st && Math.hypot(st.x - want[0], st.y - want[1]) < 14, JSON.stringify({ st, want }))
    check('I4 用過就記進 settings.stickersSeen、貼紙盤不再標它「新」', (await settingsOf(page)).stickersSeen?.includes('obj-star') && (await page.locator('[data-testid=new-obj-star]').count()) === 0 && (await page.locator('.i74-new').count()) === 1)
    // 手指把畫布上的貼紙拖到別處（選取後）
    const el = page.locator('[data-testid=sticker][data-art=obj-star]')
    const eb = await el.boundingBox()
    const to = [bb.x + bb.width * 0.25, bb.y + bb.height * 0.7]
    await finger.drag([[eb.x + eb.width / 2, eb.y + eb.height / 2], [eb.x + eb.width / 2 - 30, eb.y + eb.height / 2 + 30], [(eb.x + to[0]) / 2, (eb.y + to[1]) / 2], to])
    await page.waitForTimeout(400)
    doc = await rowOf(page, 'free-2')
    const moved = doc.stickers.find((s) => s.art === 'obj-star')
    check('I4 手指拖畫布上的貼紙：位置跟著手指（iPhone 手指不被當手掌）', !!moved && Math.hypot(moved.x - st.x, moved.y - st.y) > 40, JSON.stringify([st, moved]))
    // 點貼紙盤（手指）：貼上去、fish 用過 → 不再新
    await page.getByTestId('add-sticker-obj-fish').tap()
    await page.waitForTimeout(300)
    check('I4 點新貼紙（fish）貼上去，標記消失', (await rowOf(page, 'free-2')).stickers.some((s) => s.art === 'obj-fish') && (await page.locator('.i74-new').count()) === 0 && (await settingsOf(page)).stickersSeen.includes('obj-fish'))
    // 重新載入：不再標新、貼紙盤維持 12 張
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openFree(page, 2)
    await page.getByTestId('tool-sticker').click()
    await page.waitForTimeout(300)
    check('I4 重載：仍是 12 張、沒有「新」', (await arts()).length === 12 && (await page.locator('.i74-new').count()) === 0)
    // 預設的貼紙點一下貼得上（8 張都能貼）
    await page.getByTestId('add-sticker-obj-apple').tap()
    await page.waitForTimeout(250)
    check('I4 預設貼紙（蘋果）點一下貼上', (await rowOf(page, 'free-2')).stickers.some((s) => s.art === 'obj-apple'))
    check('I4 JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= I2/I3：畫廊、家長區、著色列表 =================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { ctxOpts: { hasTouch: true, acceptDownloads: true } })
    await ctx.addInitScript(SPEECH_STUB)
    await page.evaluate(SPEECH_STUB)
    // ---- 畫廊空狀態 ----
    await openList(page)
    await page.getByTestId('open-gallery').click()
    await page.waitForSelector('[data-testid=gallery]')
    await page.waitForTimeout(400)
    check('I2 畫廊空狀態：有阿悟的圖與「去畫畫」按鈕（≥ 56px）', (await page.locator('[data-testid=gallery-empty] .i74-empty-pet img, [data-testid=gallery-empty] .i74-empty-pet .art-emoji').count()) >= 1 && (await page.getByTestId('gallery-go-paint').boundingBox()).height >= 56)
    check('I2 畫廊空狀態：阿悟說一句（「還沒有畫畫喔，我們去畫一張吧」）', (await spoken(page)).includes(EMPTY_LINE), JSON.stringify(await spoken(page)))
    await shot(page, 'i2-land-gallery-empty')
    await page.getByTestId('gallery-go-paint').click()
    await page.waitForSelector('[data-testid=free-bg]')
    check('I2 「去畫畫」：直接進空白畫紙', (await page.getByTestId('paint-screen').getAttribute('data-page')) === 'free-1')
    // ---- 畫一張完成（3 筆）----
    const send = await touchSender(ctx, page)
    const finger = fingerOf(send)
    const bb = await board(page)
    for (let k = 0; k < 3; k++) await finger.drag([[bb.x + 80, bb.y + 100 + k * 50], [bb.x + 200, bb.y + 130 + k * 50], [bb.x + 320, bb.y + 110 + k * 50]])
    await page.waitForTimeout(250)
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    await page.getByTestId('to-gallery').click()
    await page.waitForSelector('[data-testid=gallery-item]')
    check('I2 有作品之後，空狀態消失', (await page.getByTestId('gallery-empty').count()) === 0)
    await page.getByTestId('gallery-item').first().getByRole('button').first().click()
    await page.waitForSelector('[data-testid=gallery-view]')
    await page.waitForTimeout(600)
    check('I2 畫廊大圖有「存圖」按鈕（≥ 48px 高）', (await page.getByTestId('save-art').count()) === 1 && (await page.getByTestId('save-art').boundingBox()).height >= 48)
    await shot(page, 'i2-land-gallery-view')
    // Web Share API（帶 PNG 檔）
    await page.evaluate(() => {
      window.__shared = []
      Object.defineProperty(navigator, 'canShare', { value: (d) => !!d.files?.length, configurable: true })
      Object.defineProperty(navigator, 'share', { value: async (d) => void window.__shared.push({ names: d.files.map((f) => f.name), types: d.files.map((f) => f.type), size: d.files[0].size, title: d.title }), configurable: true })
    })
    await page.getByTestId('save-art').click()
    await page.waitForTimeout(500)
    const shared = await page.evaluate(() => window.__shared)
    check('I2 存圖：叫出分享面板，帶一個 PNG 檔（檔名 guaibao-art-…png、非空）', shared.length === 1 && shared[0].types[0] === 'image/png' && /^guaibao-art-\d{8}-\w+\.png$/.test(shared[0].names[0]) && shared[0].size > 500, JSON.stringify(shared))
    // 分享面板按取消：不下載
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', { value: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) }, configurable: true })
      window.__dl = 0
      document.addEventListener('click', (e) => { if (e.target.closest?.('a[download]')) window.__dl++ }, true)
    })
    await page.getByTestId('save-art').click()
    await page.waitForTimeout(400)
    check('I2 分享面板按取消：不會硬給下載', (await page.evaluate(() => window.__dl)) === 0)
    // 不支援分享檔案：退回下載
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true })
    })
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.getByTestId('save-art').click()])
    check('I2 不支援分享檔案：退回下載 PNG', /^guaibao-art-\d{8}-\w+\.png$/.test(dl.suggestedFilename()), dl.suggestedFilename())
    const fs = await import('node:fs')
    const tmp = join(OUT, 'downloaded.png')
    await dl.saveAs(tmp)
    const head = fs.readFileSync(tmp).subarray(0, 8)
    check('I2 下載的檔案是真的 PNG（檔頭 89 50 4E 47）', head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)
    await page.keyboard.press('Escape')

    // ---- 家長區「本週」最近作品縮圖 ----
    // 補 7 幅作品（共 8 幅）：只顯示最近 6 幅
    for (let i = 0; i < 7; i++) await putRow(page, 'coloring', { pageId: `g:w${i}`, basePageId: 'free-1', fills: {}, strokes: [], stickers: [], png: PNG1, createdAt: Date.now() - (i + 1) * 3600_000, updatedAt: Date.now() })
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openParentTab(page, '本週')
    await page.waitForSelector('[data-testid=weekly-artworks]')
    const thumbs = page.getByTestId('weekly-art-thumb')
    check('I2 家長區「本週」有「最近的作品」，最多 6 幅縮圖', (await thumbs.count()) === 6, String(await thumbs.count()))
    check('I2 縮圖是孩子的作品（最新的第一個 = 剛畫的那張）', (await thumbs.first().locator('img').getAttribute('src')).startsWith('data:image/png') && (await thumbs.first().locator('img').getAttribute('src')) !== PNG1)
    await shot(page, 'i2-land-weekly')
    await thumbs.first().click()
    await page.waitForSelector('[data-testid=weekly-art-view]')
    check('I2 點縮圖看大圖，有「存圖」', (await page.getByTestId('weekly-art-save').count()) === 1)
    await shot(page, 'i2-land-weekly-view')
    await page.getByRole('button', { name: '關起來' }).click()
    check('I2 家長區週報其他內容還在（沒有被擠掉）', (await page.getByTestId('weekly-subjects').count()) === 1 && (await page.getByTestId('weekly-album').count()) === 1)
    await page.reload()
    await page.waitForSelector('[data-testid=room]')

    // ---- I3 著色列表：勾勾、作品縮圖、再畫一次 ----
    const ids = await regionsOf(page, 'monkey')
    const allFills = Object.fromEntries(ids.map((id, i) => [id, i % 2 ? '#e96a6a' : '#4a9fe0']))
    await putRow(page, 'coloring', { pageId: 'monkey', fills: allFills, strokes: [], stickers: [], updatedAt: Date.now() })
    await openList(page)
    check('I3 還沒按完成的頁：沒有勾勾', (await page.getByTestId('page-check-monkey').count()) === 0 && (await page.getByTestId('page-monkey').getAttribute('data-done')) === '0')
    await page.getByTestId('page-monkey').getByRole('button').first().click()
    await page.waitForSelector('[data-testid=paint-board]')
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    await page.getByTestId('fc-back').click()
    await page.waitForSelector('[data-testid=page-monkey]')
    await page.waitForTimeout(400)
    const card = page.getByTestId('page-monkey')
    check('I3 完成的頁（算數的完成）：卡片有勾勾', (await page.getByTestId('page-check-monkey').isVisible()) && (await card.getAttribute('data-done')) === '1')
    check('I3 縮圖用孩子的作品（完成圖 PNG），不是空線稿', (await page.getByTestId('page-work-monkey').getAttribute('src')).startsWith('data:image/png'))
    check('I3 進度列寫「完成了！」（不是 86% 之類）', /完成了/.test(await card.locator('.page-progress').innerText()))
    check('I3 有「再畫一次」按鈕（≥ 48px 高）', (await page.getByTestId('again-monkey').count()) === 1 && (await page.getByTestId('again-monkey').boundingBox()).height >= 48)
    check('I3 勾勾 ≥ 40px', (await page.getByTestId('page-check-monkey').boundingBox()).width >= 40)
    await shot(page, 'i3-land-list-done')
    const nWorks = (await works(page)).length
    await page.getByTestId('again-monkey').click()
    await page.waitForSelector('[data-testid=paint-board]')
    await page.waitForTimeout(400)
    const rowNow = await rowOf(page, 'monkey')
    check('I3 再畫一次：進行中的作品清空、直接開新的一張', !rowNow || Object.keys(rowNow.fills ?? {}).length === 0)
    check('I3 再畫一次：舊作還在畫廊（數量不變）', (await works(page)).length === nWorks && (await works(page)).some((w) => w.basePageId === 'monkey' && Object.keys(w.fills).length === ids.length))
    check('I3 再畫一次：完成度回到 0', (await page.locator('.f73-auto-pct').innerText()).includes('0%'))
    // 回列表：沒動過 → 還是顯示作品與勾勾，但沒有「再畫一次」
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=page-monkey]')
    check('I3 新的一張還沒畫：卡片維持勾勾與舊作縮圖，不再出現「再畫一次」', (await page.getByTestId('page-check-monkey').count()) === 1 && (await page.getByTestId('page-work-monkey').count()) === 1 && (await page.getByTestId('again-monkey').count()) === 0)
    // 畫一點 → 卡片改顯示進行中的樣子（勾勾還在）
    await page.getByTestId('page-monkey').getByRole('button').first().click()
    await page.waitForSelector('[data-testid=paint-board]')
    const bb2 = await board(page)
    await page.getByTestId('tool-fill').click()
    await page.mouse.click(bb2.x + bb2.width * 0.5, bb2.y + bb2.height * 0.5)
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=page-monkey]')
    check('I3 新一輪畫到一半：勾勾還在（畫過了）、縮圖改回進行中、顯示完成度', (await page.getByTestId('page-check-monkey').count()) === 1 && (await page.getByTestId('page-work-monkey').count()) === 0 && !/完成了/.test(await page.getByTestId('page-monkey').locator('.page-progress').innerText()))
    // 另一張沒畫過的頁沒有勾勾
    check('I3 其他頁沒有勾勾', (await page.locator('[data-testid^=page-check-]').count()) === 1)
    check('I3 JS 沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ================= 截圖：直向與手機（看版面）=================
  for (const [tag, size] of [['port', SIZES.port], ['phone', SIZES.phone]]) {
    const { ctx, page } = await freshApp(browser, size, { ctxOpts: { hasTouch: true, ...(tag === 'phone' ? { isMobile: true } : {}) } })
    await ctx.addInitScript(SPEECH_STUB)
    await page.evaluate(SPEECH_STUB)
    await patchSettings(page, { stickers: ['obj-star', 'obj-fish'] })
    await openList(page)
    await page.getByTestId('open-gallery').click()
    await page.waitForSelector('[data-testid=gallery-empty]')
    await shot(page, `i2-${tag}-gallery-empty`)
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=free-1]')
    await page.getByTestId('free-1').click()
    await page.waitForSelector('[data-testid=free-bg]')
    await page.getByTestId('tool-sticker').click()
    await shot(page, `i4-${tag}-sticker-new`)
    await ctx.close()
  }
  void IS_WEBKIT
} finally {
  await browser.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
