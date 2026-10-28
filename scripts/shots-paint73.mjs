// v7.3 線 F 截圖：iPad 橫向 1180×820、直向 820×1180、手機 390×844，存到 design/reviews/v73-paint-shots/（已 gitignore，不提交）。
//   筆刷、印章模式的色盤、加大的畫布與移出的縮放鈕、3× 放大線稿、未塗區塊閃動、完成獎勵、100% 慶祝、連連看 30 點小魚、拿去塗色、著色本列表。
// 用法：先 pnpm dev --port 5196 --strictPort，再 BASE_URL=http://localhost:5196 node scripts/shots-paint73.mjs
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, idb, launch } from './e2e-lib.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../design/reviews/v73-paint-shots')
mkdirSync(OUT, { recursive: true })
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const RASTER = 'line-awu-banana'
const shot = async (page, name, tag, wait = 450) => {
  await page.waitForTimeout(wait)
  await page.screenshot({ path: join(OUT, `${tag}-${name}.png`) })
}
const putRow = (page, row) => idb(page, (db, r) => new Promise((res) => (db.transaction('coloring', 'readwrite').objectStore('coloring').put(r).onsuccess = () => res(1))), row)
const regionsOf = (page, id) =>
  page.evaluate(async (pid) => {
    const m = await import('/src/art/coloring/rasterArt.ts')
    const r = await import('/src/art/coloring/regions.ts')
    const art = await m.getRasterArt(pid)
    return art.map.regions.map((x) => ({ id: x.id, area: x.area, anchor: r.regionAnchor(art.map, x.label) }))
  }, id)
const openList = async (page) => {
  await page.getByRole('button', { name: /著色本/ }).first().click()
  await page.waitForSelector('[data-testid=page-monkey]')
}
const openRaster = async (page) => {
  await openList(page)
  await page.getByTestId(`page-${RASTER}`).getByRole('button').click()
  await page.waitForSelector('[data-testid=raster-layer]')
  await page.waitForFunction(() => { const i = document.querySelector('.pb-line'); return i && i.complete && i.naturalWidth > 0 })
}

const browser = await launch()
try {
  for (const [tag, vp] of Object.entries(SIZES)) {
    const mobile = tag === 'phone'
    const ctxOpts = { hasTouch: true, ...(mobile ? { isMobile: true } : {}) }
    const click = (page, sel) => page.locator(sel).first().click()

    // 1) 筆刷、印章：色盤完整；加大的畫布與標題列的縮放鈕
    {
      const { ctx, page } = await freshApp(browser, vp, { ctxOpts })
      await page.getByRole('button', { name: /著色本/ }).first().click()
      await page.waitForSelector('[data-testid=free-1]')
      await shot(page, 'coloring-list', tag, 300)
      await page.getByTestId('free-1').click()
      await page.waitForSelector('[data-testid=free-bg]')
      await page.getByTestId('tool-brush').click()
      await shot(page, 'brush-palette', tag)
      await page.getByTestId('bk-stamp').click()
      await shot(page, 'stamp-palette', tag)
      await ctx.close()
    }
    // 2) 點陣線稿：3× 放大、未塗區塊閃動、完成獎勵、100%
    {
      const { ctx, page } = await freshApp(browser, vp, { ctxOpts })
      await openRaster(page)
      const regs = (await regionsOf(page, RASTER)).sort((a, b) => b.area - a.area)
      const bb = await page.getByTestId('paint-board').boundingBox()
      await page.locator('[data-testid=palette] .swatch').nth(14).click()
      for (const r of regs.slice(1, 4)) {
        await page.mouse.click(bb.x + (r.anchor[0] / 768) * bb.width, bb.y + (r.anchor[1] / 768) * bb.height)
        await page.waitForTimeout(550)
      }
      await page.getByTestId('zoom-in').click()
      await page.getByTestId('zoom-in').click()
      await shot(page, 'zoom-3x-lineart', tag)
      await page.getByTestId('zoom-out').click()
      await page.getByTestId('zoom-out').click()
      await page.getByTestId('finish-btn').click()
      await page.waitForSelector('[data-testid=finish-ask]')
      await shot(page, 'flash-unpainted', tag, 330) // 閃動的第一個亮點
      await page.getByTestId('finish-more').click()
      await page.waitForTimeout(2300)
      const need = Math.ceil(regs.length * 0.7)
      const fills = {}
      for (const r of regs.slice(0, need)) fills[r.id] = '#9fd0e8'
      await putRow(page, { pageId: RASTER, fills, strokes: [], stickers: [], updatedAt: Date.now() })
      await page.reload()
      await page.waitForSelector('[data-testid=room]')
      await openRaster(page)
      await page.getByTestId('finish-btn').click()
      await page.waitForSelector('[data-testid=finish-celebration]')
      await shot(page, 'finish-stars', tag, 900)
      await click(page, '[data-testid=fc-keep]')
      const all = {}
      for (const r of regs) all[r.id] = '#f4b6a8'
      await putRow(page, { pageId: RASTER, fills: all, strokes: [], stickers: [], updatedAt: Date.now() })
      await page.reload()
      await page.waitForSelector('[data-testid=room]')
      await openRaster(page)
      await page.getByTestId('finish-btn').click()
      await page.waitForSelector('[data-testid=finish-celebration]')
      await shot(page, 'finish-full-100', tag, 900)
      await ctx.close()
    }
    // 3) 連連看 30 點小魚、拿去塗色
    {
      const { ctx, page } = await freshApp(browser, vp, { ctxOpts })
      await openList(page)
      await page.getByTestId('dots-level-h').click()
      await page.getByTestId('dots-obj-fish').getByRole('button').click()
      await page.waitForSelector('[data-testid=dots-screen]')
      await page.waitForFunction(() => document.querySelector('[data-testid=dots-screen]')?.getAttribute('data-ready') === '1')
      await shot(page, 'dots-30-start', tag, 300)
      for (let i = 0; i < 18; i++) {
        const b = await page.locator(`[data-dot="${i}"] .dt-dot-c`).boundingBox()
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
        await page.waitForTimeout(40)
      }
      await shot(page, 'dots-30-mid', tag, 300)
      for (let i = 18; i < 30; i++) {
        const b = await page.locator(`[data-dot="${i}"] .dt-dot-c`).boundingBox()
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
        await page.waitForTimeout(40)
      }
      await page.waitForFunction(() => document.querySelector('[data-testid=dots-screen]')?.getAttribute('data-phase') === 'reveal', null, { timeout: 8000 })
      await shot(page, 'dots-30-reveal', tag, 1000)
      await page.getByTestId('dots-to-paint').scrollIntoViewIfNeeded()
      await page.getByTestId('dots-to-paint').click()
      await page.waitForSelector('[data-testid=paint-screen]')
      await shot(page, 'dots-to-paint', tag, 700)
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
console.log('截圖完成 →', OUT)
