// v3 內容擴充 E2E（Playwright）：工坊兌換壁紙並套用、做新家具、買新食物、房間背景、著色（筆刷/貼紙/復原/完成/畫廊/掛到房間）。
// 用法：先啟動 dev server（pnpm dev --port 5181 --strictPort），再
//   BASE_URL=http://localhost:5181 node scripts/e2e-content.mjs
// 需要 Chromium：預設找 ~/Library/Caches/ms-playwright 內已安裝的，或用 CHROME_PATH 指定。
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:5181'

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(root)) return undefined
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const p = join(root, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(p)) return p
  }
  return undefined
}

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`)
  if (!ok) failed++
}

const dump = (page, table) =>
  page.evaluate(
    (t) =>
      new Promise((res, rej) => {
        const rq = indexedDB.open('guaibao-quest')
        rq.onerror = () => rej(rq.error)
        rq.onsuccess = () => {
          const g = rq.result.transaction(t).objectStore(t).getAll()
          g.onsuccess = () => res(g.result)
        }
      }),
    table,
  )
const putRows = (page, table, rows) =>
  page.evaluate(
    ([t, r]) =>
      new Promise((res, rej) => {
        const rq = indexedDB.open('guaibao-quest')
        rq.onerror = () => rej(rq.error)
        rq.onsuccess = () => {
          const tx = rq.result.transaction(t, 'readwrite')
          for (const row of r) tx.objectStore(t).put(row)
          tx.oncomplete = () => res(1)
        }
      }),
    [table, rows],
  )
const giveMaterials = (page, wood, stone, flower, tag = 'g') =>
  putRows(page, 'materialLedger', [
    { id: `${tag}-w`, at: Date.now(), material: 'wood', delta: wood, kind: 'station', reason: 'test' },
    { id: `${tag}-s`, at: Date.now(), material: 'stone', delta: stone, kind: 'station', reason: 'test' },
    { id: `${tag}-f`, at: Date.now(), material: 'flower', delta: flower, kind: 'station', reason: 'test' },
  ])

async function freshApp(browser, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    // 美術圖還沒生成時會有 404，屬預期，不算錯
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  await page.goto(BASE)
  await page.waitForSelector('button.key')
  const press = async (pin) => {
    await page.evaluate(async (p) => {
      for (const d of p) [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
      await new Promise((r) => setTimeout(r, 200))
    }, pin)
  }
  await press('1234')
  await press('1234')
  await page.getByPlaceholder('小朋友的名字').fill('小明')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '開始冒險' }).click()
  await page.waitForSelector('[data-testid=room]')
  return { ctx, page, errors }
}
/** 直接寫 IndexedDB 不會觸發 Dexie 的即時查詢（還會讓快取過期），寫完要重新載入才讀得到 */
const reloadHome = async (page) => {
  await page.reload()
  await page.waitForSelector('[data-testid=room]')
}
/** 點某個著色區域：用外框的相對位置（預設中心）；圓形區域的外框角落在區域外，所以要自己給位置 */
const clickRegion = async (page, id, fx = 0.5, fy = 0.5) => {
  const b = await page.locator(`[data-region=${id}]`).boundingBox()
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy)
}
const toHash = (page, hash) => page.evaluate((h) => (location.hash = h), hash)

const browser = await chromium.launch({ executablePath: findChrome() })
try {
  // ---------- 1) 工坊：壁紙 / 地板兌換並套用 ----------
  {
    const { ctx, page, errors } = await freshApp(browser, { width: 1024, height: 768 })
    await giveMaterials(page, 6, 4, 6)
    await toHash(page, 'workshop')
    await page.waitForSelector('[data-testid=workshop]')
    check('工坊有三個分頁：家具 / 壁紙 / 地板', (await page.locator('.workshop .tab').allInnerTexts()).join() === '家具,壁紙,地板')
    await page.getByTestId('ws-tab-wall').click()
    const wallIds = await page.locator('.ws-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    check('壁紙 6 種，預設奶油素色排最前', wallIds.length === 6 && wallIds[0] === 'craft-wall-cream', wallIds.join())
    const totals = await page.locator('.ws-card').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.ws-cost-item b')].reduce((s, b) => s + Number(b.textContent), 0)))
    check('壁紙依材料成本由低到高', totals.every((t, i) => i === 0 || t >= totals[i - 1]), totals.join())
    check('預設壁紙顯示「使用中」', (await page.locator('[data-testid=craft-wall-cream] [data-testid=apply-btn]').innerText()) === '使用中')
    // 星空藍要 石頭4 花4：材料夠 → 兌換
    const need = await page.locator('[data-testid=craft-wall-stars] .ws-btn').innerText()
    check('做不起的標出還差多少（星空藍：木材/石頭/花朵夠才可製作）', need === '製作' || need.startsWith('還差'), need)
    await page.locator('[data-testid=craft-wall-mint] [data-testid=craft-btn]').click()
    await page.getByTestId('craft-done-close').click() // v4：做好了的慶祝畫面先關掉
    await page.waitForSelector('[data-testid=craft-wall-mint] [data-testid=apply-btn]')
    let inv = await dump(page, 'inventory')
    check('兌換薄荷條紋：背包出現 wall-mint', inv.some((v) => v.itemId === 'wall-mint' && v.qty === 1))
    const mats = await dump(page, 'materialLedger')
    const sum = (m) => mats.filter((x) => x.material === m).reduce((s, x) => s + x.delta, 0)
    check('兌換扣掉材料（木 1、石 0、花 3）', sum('wood') === 5 && sum('stone') === 4 && sum('flower') === 3, `${sum('wood')}/${sum('stone')}/${sum('flower')}`)
    await page.locator('[data-testid=craft-wall-mint] [data-testid=apply-btn]').click()
    await page.waitForTimeout(250)
    let st = (await dump(page, 'settings'))[0]
    check('套用後 settings.roomTheme.wall = wall-mint', st.roomTheme?.wall === 'wall-mint', JSON.stringify(st.roomTheme))
    check('卡片變成「使用中」，預設壁紙變回可套用', (await page.locator('[data-testid=craft-wall-mint] [data-testid=apply-btn]').innerText()) === '使用中' && (await page.locator('[data-testid=craft-wall-cream] [data-testid=apply-btn]').innerText()) === '套用')
    // 地板
    await page.getByTestId('ws-tab-floor').click()
    check('地板 4 種', (await page.locator('.ws-card').count()) === 4)
    await page.locator('[data-testid=craft-floor-oak] [data-testid=craft-btn]').click()
    await page.getByTestId('craft-done-close').click() // v4：做好了的慶祝畫面先關掉
    await page.waitForSelector('[data-testid=craft-floor-oak] [data-testid=apply-btn]')
    await page.locator('[data-testid=craft-floor-oak] [data-testid=apply-btn]').click()
    await page.waitForTimeout(250)
    st = (await dump(page, 'settings'))[0]
    check('套用地板後壁紙設定仍在', st.roomTheme?.wall === 'wall-mint' && st.roomTheme?.floor === 'floor-oak', JSON.stringify(st.roomTheme))
    // 重新整理後仍然在
    await page.reload()
    await page.waitForSelector('[data-testid=workshop]')
    await page.getByTestId('ws-tab-wall').click()
    check('重新整理後仍是使用中', (await page.locator('[data-testid=craft-wall-mint] [data-testid=apply-btn]').innerText()) === '使用中')
    // 沒擁有的主題不能套用（資料層）
    const applied = await page.evaluate(async () => {
      const rq = indexedDB.open('guaibao-quest')
      return new Promise((res) => {
        rq.onsuccess = () => res(rq.result.objectStoreNames.length)
      })
    })
    check('資料庫沒有升版（table 數量不變為 15）', applied === 15, String(applied))
    check('工坊流程沒有 JS 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---------- 2) 工坊：做新家具 ----------
  {
    const { ctx, page, errors } = await freshApp(browser, { width: 1024, height: 768 })
    await giveMaterials(page, 5, 5, 3)
    await toHash(page, 'workshop')
    await page.waitForSelector('[data-testid=workshop]')
    check('家具 24 件', (await page.locator('.ws-card').count()) === 24)
    const totals = await page.locator('.ws-card').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.ws-cost-item b')].reduce((s, b) => s + Number(b.textContent), 0)))
    check('家具依材料成本由低到高', totals.every((t, i) => i === 0 || t >= totals[i - 1]), totals.join())
    const rocketBtn = await page.locator('[data-testid=craft-decor-rocket] .ws-btn').innerText()
    check('做不起的火箭顯示還差多少', /^還差 /.test(rocketBtn) && /木材|石頭|花朵/.test(rocketBtn), rocketBtn)
    check('做不起的按鈕是 disabled', await page.locator('[data-testid=craft-decor-rocket] .ws-btn').isDisabled())
    // 木5 石5 花3：小汽車 (木5 石4) 可以做
    await page.locator('[data-testid=craft-decor-car] [data-testid=craft-btn]').click()
    await page.getByTestId('craft-done-close').click() // v4：做好了的慶祝畫面先關掉
    await page.waitForSelector('[data-testid=craft-decor-car].owned')
    const inv = await dump(page, 'inventory')
    check('做好小汽車：背包 decor-car = 1', inv.some((v) => v.itemId === 'decor-car' && v.qty === 1))
    const mats = await dump(page, 'materialLedger')
    const sum = (m) => mats.filter((x) => x.material === m).reduce((s, x) => s + x.delta, 0)
    check('扣掉材料（木 0、石 1、花 3）', sum('wood') === 0 && sum('stone') === 1 && sum('flower') === 3, `${sum('wood')}/${sum('stone')}/${sum('flower')}`)
    check('做好的變成「去佈置」', (await page.locator('[data-testid=craft-decor-car] .ws-btn').innerText()) === '去佈置')
    // 佈置模式能拿到新家具
    await page.locator('[data-testid=craft-decor-car] .ws-btn').click()
    await page.waitForSelector('[data-dock-item=decor-car]')
    check('去佈置後，新家具出現在佈置列', (await page.locator('[data-dock-item=decor-car]').count()) === 1)
    check('做家具流程沒有 JS 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---------- 3) 商店：新食物 ----------
  {
    const { ctx, page, errors } = await freshApp(browser, { width: 1024, height: 768 })
    await putRows(page, 'ledger', [{ id: 'seed', at: Date.now(), delta: 80, reason: '測試', kind: 'bonus' }])
    await reloadHome(page)
    await page.getByRole('button', { name: /商店/ }).first().click()
    await page.waitForSelector('[data-testid=shop-grid-food]')
    const ids = await page.locator('[data-testid=shop-grid-food] > li').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    check('食物 10 種，依價格由低到高', ids.length === 10 && ids.join() === 'shop-carrot,shop-cookie,shop-banana,shop-apple,shop-grape,shop-milk,shop-peach,shop-riceball,shop-watermelon,shop-cake', ids.join())
    const hearts = await page.locator('[data-testid=shop-grid-food] .hearts').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-hearts'))))
    check('每個食物顯示飽足值（愛心 1→5 遞增）', hearts.length === 10 && hearts[0] === 1 && hearts[9] === 5 && hearts.every((h, i) => i === 0 || h >= hearts[i - 1]), hearts.join())
    check('「今天最喜歡」標記剛好一個', (await page.getByTestId('fav-badge').count()) === 1)
    const cakeBtn = await page.locator('[data-testid=shop-cake] .btn').innerText()
    check('蛋糕 60 點：餘額 80 買得起', cakeBtn === '買', cakeBtn)
    const wmBtn = page.locator('[data-testid=shop-watermelon] .btn')
    await page.locator('[data-testid=shop-cake] .btn').click()
    await page.waitForTimeout(300)
    let inv = await dump(page, 'inventory')
    check('買蛋糕：背包 cake = 1', inv.some((v) => v.itemId === 'cake' && v.qty === 1))
    const led = await dump(page, 'ledger')
    check('扣 60 點（剩 20）', led.reduce((s, x) => s + x.delta, 0) === 20)
    check('剩 20 點買不起西瓜，顯示還差 15', (await wmBtn.innerText()) === '還差 15 點' && (await wmBtn.isDisabled()))
    await page.locator('[data-testid=shop-carrot] .btn').click()
    await page.waitForTimeout(300)
    inv = await dump(page, 'inventory')
    check('再買胡蘿蔔（6 點）', inv.some((v) => v.itemId === 'carrot' && v.qty === 1))
    // 首頁飼料列有新食物
    await page.getByRole('button', { name: /回首頁/ }).click()
    await page.waitForSelector('[data-testid=room]')
    check('首頁飼料列出現新買的蛋糕與胡蘿蔔', (await page.locator('[data-dock-item=cake]').count()) === 1 && (await page.locator('[data-dock-item=carrot]').count()) === 1)
    check('買食物流程沒有 JS 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---------- 4) 房間背景：日夜 / 壁紙 / 地板 ----------
  {
    const { ctx, page, errors } = await freshApp(browser, { width: 1024, height: 768 })
    for (const [tod, selector] of [['day', '.rb-cloud'], ['dusk', '.rb-sun'], ['night', '.rb-moon']]) {
      await toHash(page, `backdrop/${tod}/wall-stars/floor-grass`)
      await page.waitForSelector(`[data-testid=backdrop-preview] ${selector}`)
      const cls = await page.locator('.room-backdrop').getAttribute('class')
      check(`背景 ${tod}：class 帶時段與主題，窗景元素存在`, cls.includes(`tod-${tod}`) && cls.includes('wall-stars') && cls.includes('floor-grass') && (await page.locator('.rb-window').count()) === 2, cls)
    }
    check('夜晚有星星與燈光暈', (await page.locator('.rb-stars').count()) === 4 && (await page.locator('.rb-glow').count()) === 1)
    await toHash(page, 'backdrop/day/wall-cream/floor-wood')
    await page.waitForSelector('.rb-cloud')
    check('白天有雲、沒有星星與月亮', (await page.locator('.rb-stars, .rb-moon').count()) === 0)
    check('背景不吃點擊（pointer-events none）', (await page.locator('.room-backdrop').evaluate((e) => getComputedStyle(e).pointerEvents)) === 'none')
    check('背景流程沒有 JS 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---------- 5) 著色本 ----------
  {
    const { ctx, page, errors } = await freshApp(browser, { width: 1024, height: 768 })
    await putRows(page, 'inventory', [
      { id: 'coloring-monkey', itemId: 'coloring-monkey', qty: 1 },
      { id: 'coloring-staff', itemId: 'coloring-staff', qty: 1 },
    ])
    await reloadHome(page)
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=page-monkey]')
    check('著色本列表顯示完成度（還沒開始）', (await page.locator('[data-testid=page-monkey] .page-progress').getAttribute('data-pct')) === '0')
    check('著色本有畫廊入口', (await page.getByTestId('open-gallery').count()) === 1)
    check('西遊記新頁面（金箍棒）在列表', (await page.getByTestId('page-staff').count()) === 1)
    await page.getByTestId('page-monkey').getByRole('button').click()
    await page.waitForSelector('[data-testid=paint-board]')

    check('色盤 24 色', (await page.locator('[data-testid=palette] .swatch').count()) === 24)
    check('工具列有 填色/筆刷/貼紙/橡皮擦', (await page.locator('[data-testid^=tool-]').count()) === 4)
    // v7：「最近用過」永遠佔一列（空的時候是空圈），所以改檢查「還沒有色票」
    check('一開始「最近用過」沒有色票、復原不能按', (await page.locator('[data-testid=recent-colors] .swatch').count()) === 0 && (await page.getByTestId('undo-btn').isDisabled()))

    // 填色
    await page.locator('[data-testid=palette] .swatch').nth(3).click()
    const picked = await page.locator('[data-testid=palette] .swatch').nth(3).getAttribute('data-color')
    await clickRegion(page, 'head', 0.2, 0.3)
    await page.waitForTimeout(300)
    let col = await dump(page, 'coloring')
    check('填色：head 存成選的顏色', col.find((c) => c.pageId === 'monkey')?.fills?.head === picked, picked)
    check('填色回饋：區域有「啵」動畫 class', (await page.locator('[data-region=head]').getAttribute('class'))?.includes('pop') === true)
    check('填色後「最近用過」出現該色', (await page.locator('[data-testid=recent-colors] .swatch').count()) === 1)
    // 特殊填色
    await page.getByTestId('special-rainbow').click()
    await clickRegion(page, 'body', 0.22, 0.45)
    await page.getByTestId('special-stripes').click()
    await clickRegion(page, 'tail')
    await page.waitForTimeout(300)
    col = await dump(page, 'coloring')
    const fills = col.find((c) => c.pageId === 'monkey').fills
    check('特殊填色：彩虹 / 條紋', fills.body === 'rainbow' && /^stripes:#[0-9a-f]{6}$/.test(fills.tail), JSON.stringify(fills))
    check('特殊填色渲染成 pattern / gradient', (await page.locator('defs #gq-rainbow').count()) === 1 && (await page.locator('defs pattern[id^=gq-stripes]').count()) === 1)
    await page.getByTestId('special-none').click()

    // 筆刷
    await page.getByTestId('tool-brush').click()
    check('筆刷有 3 種粗細', (await page.locator('[data-testid^=brush-]:not([data-testid=brush-canvas])').count()) === 3)
    await page.getByTestId('brush-l').click()
    const cb = await page.getByTestId('brush-canvas').boundingBox()
    await page.mouse.move(cb.x + 20, cb.y + 20)
    await page.mouse.down()
    await page.mouse.move(cb.x + 80, cb.y + 60, { steps: 6 })
    await page.mouse.move(cb.x + 40, cb.y + 120, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    col = await dump(page, 'coloring')
    let doc = col.find((c) => c.pageId === 'monkey')
    check('筆刷：strokes 存進資料庫（寬度為粗筆刷、多個點）', doc.strokes?.length === 1 && doc.strokes[0].width === 18 && doc.strokes[0].points.length >= 5, JSON.stringify(doc.strokes?.[0]?.width))
    const inked = await page.getByTestId('brush-canvas').evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true
      return false
    })
    check('筆刷：canvas 上真的有畫出來', inked)
    // 畫在線稿區域外（左上角空白處）
    await page.getByTestId('brush-s').click()
    await page.mouse.move(cb.x + 30, cb.y + 30)
    await page.mouse.down()
    await page.mouse.move(cb.x + 80, cb.y + 34, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    col = await dump(page, 'coloring')
    check('筆刷可以畫在線稿外面', col.find((c) => c.pageId === 'monkey').strokes.length === 2, `strokes=${col.find((c) => c.pageId === 'monkey').strokes.length}`)

    // 貼紙
    await page.getByTestId('tool-sticker').click()
    check('貼紙盤 18 種可選', (await page.locator('[data-testid^=add-sticker-]').count()) === 18)
    await page.getByTestId('add-sticker-obj-star').click()
    await page.waitForTimeout(300)
    col = await dump(page, 'coloring')
    doc = col.find((c) => c.pageId === 'monkey')
    check('貼紙：stickers 存進資料庫', doc.stickers?.length === 1 && doc.stickers[0].art === 'obj-star', JSON.stringify(doc.stickers))
    const st0 = doc.stickers[0]
    // 拖放
    const sb = await page.getByTestId('sticker').boundingBox()
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
    await page.mouse.down()
    await page.mouse.move(sb.x + sb.width / 2 + 80, sb.y + sb.height / 2 + 40, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    col = await dump(page, 'coloring')
    const st1 = col.find((c) => c.pageId === 'monkey').stickers[0]
    check('貼紙可以拖放（位置改變）', st1.x > st0.x + 20 && st1.y > st0.y + 10, `${st0.x},${st0.y} -> ${st1.x},${st1.y}`)
    // 縮放 / 旋轉
    await page.getByRole('button', { name: '放大' }).click()
    await page.getByRole('button', { name: '向右轉' }).click()
    await page.waitForTimeout(300)
    col = await dump(page, 'coloring')
    const st2 = col.find((c) => c.pageId === 'monkey').stickers[0]
    check('貼紙可以縮放與旋轉', st2.scale > st1.scale && st2.rot === st1.rot + 15, `${st1.scale}->${st2.scale} rot ${st2.rot}`)
    // 控制點拖曳縮放
    const hb = await page.getByTestId('sticker-handle').boundingBox()
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2 + 60, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    col = await dump(page, 'coloring')
    const st3 = col.find((c) => c.pageId === 'monkey').stickers[0]
    check('拖曳右下角控制點：縮放+旋轉', st3.scale !== st2.scale || st3.rot !== st2.rot, `${st2.scale}/${st2.rot} -> ${st3.scale}/${st3.rot}`)

    // 復原
    const undoCount = async () => Number(((await page.getByTestId('undo-btn').innerText()).match(/\((\d+)\)/) ?? [0, 0])[1])
    const before = await undoCount()
    check('復原堆疊有累積', before >= 6, String(before))
    await page.getByTestId('undo-btn').click() // 撤銷最後一次貼紙手勢
    await page.waitForTimeout(300)
    col = await dump(page, 'coloring')
    const st4 = col.find((c) => c.pageId === 'monkey').stickers[0]
    check('復原：貼紙回到上一步', st4.scale === st2.scale && st4.rot === st2.rot, `${st4.scale}/${st4.rot}`)
    check('復原次數減少', (await undoCount()) === before - 1)
    await page.getByTestId('undo-btn').click() // 轉
    await page.getByTestId('undo-btn').click() // 放大
    await page.getByTestId('undo-btn').click() // 拖放
    await page.getByTestId('undo-btn').click() // 新增貼紙
    await page.waitForTimeout(300)
    col = await dump(page, 'coloring')
    check('復原到貼紙新增之前：貼紙消失、筆刷還在', col.find((c) => c.pageId === 'monkey').stickers.length === 0 && col.find((c) => c.pageId === 'monkey').strokes.length === 2)
    await page.getByTestId('undo-btn').click() // 小筆刷
    await page.getByTestId('undo-btn').click() // 粗筆刷
    await page.waitForTimeout(300)
    col = await dump(page, 'coloring')
    check('再復原兩步：筆刷都消失，填色還在', col.find((c) => c.pageId === 'monkey').strokes.length === 0 && col.find((c) => c.pageId === 'monkey').fills.tail?.startsWith('stripes'))

    // 橡皮擦：點填色區域清掉
    await page.getByTestId('tool-eraser').click()
    await clickRegion(page, 'head', 0.2, 0.3)
    await page.waitForTimeout(300)
    col = await dump(page, 'coloring')
    check('橡皮擦：點填色區域清掉顏色', col.find((c) => c.pageId === 'monkey').fills.head === undefined)

    // 完成
    await page.getByTestId('tool-fill').click()
    await clickRegion(page, 'head', 0.2, 0.3)
    await page.getByTestId('finish-btn').click()
    // v7：完成度 < 60% 會先問「再畫一點好嗎？」，這裡選「就這樣完成」
    await page.getByTestId('finish-anyway').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('完成：慶祝畫面（阿悟拿著畫說好漂亮）', (await page.getByText('好漂亮！').count()) === 1)
    col = await dump(page, 'coloring')
    const works = col.filter((c) => c.pageId.startsWith('g:'))
    check('完成：作品存進畫廊（含 PNG data URL）', works.length === 1 && works[0].png?.startsWith('data:image/png;base64,') && works[0].basePageId === 'monkey', works[0]?.png?.slice(0, 30))
    const dim = await page.evaluate(
      (src) =>
        new Promise((res) => {
          const i = new Image()
          i.onload = () => res([i.naturalWidth, i.naturalHeight])
          i.onerror = () => res(null)
          i.src = src
        }),
      works[0].png,
    )
    check('完成圖是 720×720 的有效圖片', JSON.stringify(dim) === '[720,720]', JSON.stringify(dim))
    check('完成圖不是空白（有顏色像素）', await page.evaluate(
      (src) =>
        new Promise((res) => {
          const i = new Image()
          i.onload = () => {
            const c = document.createElement('canvas')
            c.width = c.height = 720
            const x = c.getContext('2d')
            x.drawImage(i, 0, 0)
            const d = x.getImageData(0, 0, 720, 720).data
            let colored = 0
            for (let k = 0; k < d.length; k += 4 * 50) if (!(d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 245)) colored++
            res(colored > 200)
          }
          i.src = src
        }),
      works[0].png,
    ))
    // 掛到房間
    await page.getByTestId('hang-btn').click()
    await page.waitForSelector('[data-testid=hung-ok]')
    const gid = works[0].pageId.slice(2)
    const pl = await dump(page, 'placements')
    const invAfter = await dump(page, 'inventory')
    const shopAfter = await dump(page, 'shopItems')
    const placed = pl.find((p) => p.itemId === `art-${gid}`)
    check('掛到房間：寫入牆面 placement（art-<id>，y 在牆面）', !!placed && placed.y < 0.62, JSON.stringify(placed))
    check('掛到房間：背包與商品表都有該畫框（kind decor / slot wall）', invAfter.some((v) => v.itemId === `art-${gid}` && v.qty === 1) && shopAfter.some((s) => s.id === `art-${gid}` && s.kind === 'decor' && s.slot === 'wall'))
    // 畫廊
    await page.getByTestId('to-gallery').click()
    await page.waitForSelector('[data-testid=gallery-item]')
    check('畫廊：看到剛完成的作品，標示掛在房間', (await page.getByTestId('gallery-item').count()) === 1 && (await page.getByText('掛在房間').count()) === 1, `items=${await page.getByTestId('gallery-item').count()} badge=${await page.getByText('掛在房間').count()}`)
    await page.getByTestId('gallery-item').getByRole('button').click()
    check('畫廊：點開大圖，有取下 / 刪除', (await page.getByRole('button', { name: '從房間取下' }).count()) === 1 && (await page.getByRole('button', { name: '刪除' }).count()) === 1)
    await page.keyboard.press('Escape')
    await page.mouse.click(5, 5) // 點背景關閉
    await page.waitForTimeout(200)
    // 首頁不會壞
    await toHash(page, '')
    await page.evaluate(() => history.replaceState(null, '', location.pathname))
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    check('掛了畫之後首頁房間正常顯示', (await page.getByTestId('room').count()) === 1)
    check('著色流程沒有 JS 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---------- 6) 版面：375 與 768×1024 ----------
  for (const vp of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
    const { ctx, page } = await freshApp(browser, vp, vp.width < 500 ? { hasTouch: true, isMobile: true } : {})
    await giveMaterials(page, 3, 3, 3)
    await putRows(page, 'inventory', [{ id: 'coloring-monkey', itemId: 'coloring-monkey', qty: 1 }])
    await putRows(page, 'ledger', [{ id: 'seed', at: Date.now(), delta: 80, reason: '測試', kind: 'bonus' }])
    await reloadHome(page)
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    const results = []
    await toHash(page, 'workshop')
    await page.waitForSelector('[data-testid=workshop]')
    results.push(['工坊', await noOverflow()])
    await page.getByTestId('ws-tab-wall').click()
    results.push(['壁紙', await noOverflow()])
    await page.getByRole('button', { name: /回首頁/ }).click()
    await page.waitForSelector('[data-testid=room]')
    await page.getByRole('button', { name: /商店/ }).first().click()
    await page.waitForSelector('[data-testid=shop-grid-food]')
    results.push(['商店', await noOverflow()])
    await page.getByRole('button', { name: /回首頁/ }).click()
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.getByTestId('page-monkey').getByRole('button').click()
    await page.waitForSelector('[data-testid=paint-board]')
    results.push(['著色', await noOverflow()])
    await page.getByTestId('tool-sticker').click()
    results.push(['貼紙', await noOverflow()])
    const boardW = (await page.getByTestId('paint-board').boundingBox()).width
    check(`${vp.width}px：工坊/商店/著色不橫向溢出`, results.every(([, ok]) => ok), results.map(([n, ok]) => `${n}=${ok}`).join(' '))
    check(`${vp.width}px：畫板夠大（>= 300px）`, boardW >= 300, String(Math.round(boardW)))
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(failed ? `\n${failed} 項失敗` : '\n全部通過')
process.exit(failed ? 1 : 0)
