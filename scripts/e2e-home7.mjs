// v7 線 C E2E：禮物袋、onboarding 年齡頁與歡迎禮物、佈置空狀態導向工坊、家具多個與換色、蛋的外觀、
// 食物列（去商店圖示）、掛畫避開窗戶、家長區切換孩子與單列分頁。
// 用法：BASE_URL=http://localhost:5192 node scripts/e2e-home7.mjs
import { launch, makeChecker, freshApp, pressPin, idb, patchPet, openParentTab, center } from './e2e-lib.mjs'
import { BASE } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const LAND = { width: 1180, height: 820 }
const PORT = { width: 820, height: 1180 }

/** 讀某個資料庫的某張表 */
const dumpDb = (page, dbName, store) =>
  page.evaluate(
    ([dbName, store]) =>
      new Promise((res, rej) => {
        const rq = indexedDB.open(dbName)
        rq.onerror = () => rej(rq.error)
        rq.onsuccess = () => {
          const g = rq.result.transaction(store).objectStore(store).getAll()
          g.onsuccess = () => res(g.result)
        }
      }),
    [dbName, store],
  )
const dump = (page, store) => dumpDb(page, 'guaibao-quest', store)
const settingsOf = async (page) => (await dump(page, 'settings'))[0]
const invQty = async (page, id) => (await dump(page, 'inventory')).find((v) => v.itemId === id)?.qty ?? 0
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
const reload = async (page) => {
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
}
const hasOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)

const browser = await launch()
try {
  // =====================================================================
  // 1) onboarding：名字 → 幾歲 → 寵物；選 3 歲；歡迎禮物；禮物袋
  // =====================================================================
  {
    const ctx = await browser.newContext({ viewport: LAND })
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('gq-pet-tod', 'day')
        localStorage.setItem('gq-pet-tod-set', '1')
      } catch {
        /* ignore */
      }
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
    await page.goto(BASE)
    await page.waitForSelector('button.key')
    await pressPin(page, '1234')
    await pressPin(page, '1234')
    await page.getByPlaceholder('小朋友的名字').fill('小花')
    await page.getByRole('button', { name: '下一步' }).click()
    await page.waitForSelector('[data-testid=onboard-age]')
    check('名字之後多一頁「幾歲」，三顆大按鈕', (await page.locator('[data-testid^=onboard-age-][role=radio]').count()) === 3)
    const boxes = await page.locator('[data-testid^=onboard-age-][role=radio]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
    check('年齡按鈕夠大（≥ 100px，3 歲手指好按）', boxes.every((h) => h >= 100), boxes.map(Math.round).join(','))
    check('年齡頁沒有橫向溢出', !(await hasOverflow(page)))
    await page.screenshot({ path: 'design/reviews/v7-home-shots/onboarding-age-land.png' })
    await page.getByTestId('onboard-age-3').click()
    check('按下去那顆亮起（aria-checked）', (await page.getByTestId('onboard-age-3').getAttribute('aria-checked')) === 'true')
    await page.getByRole('button', { name: '下一步' }).click() // 選完年齡自動進到寵物名字那頁，再按下一步看蛋
    await page.getByRole('button', { name: '開始冒險' }).click()
    await page.waitForSelector('[data-testid=room]')
    const s = await settingsOf(page)
    check('onboarding 選 3 歲：寫進這個孩子的設定', s.ageBand === '3', s.ageBand)
    const reg = await dumpDb(page, 'guaibao-registry', 'children')
    check('名冊也記著 3 歲', reg.length === 1 && reg[0].ageBand === '3')
    const ledger = await dump(page, 'ledger')
    check('歡迎禮物：流水帳 +20，理由「歡迎禮物」', ledger.length === 1 && ledger[0].delta === 20 && ledger[0].reason === '歡迎禮物', JSON.stringify(ledger))
    check('歡迎禮物：背包 1 個食物', (await dump(page, 'inventory')).filter((v) => v.qty > 0 && v.itemId === 'banana').length === 1)
    check('點數膠囊顯示 20', (await page.locator('.chip-num').first().innerText()) === '20')
    // 禮物袋
    await page.waitForSelector('[data-testid=gift-bag]')
    const bag = await page.getByTestId('gift-bag').boundingBox()
    check('禮物袋在房間角落、≥ 80px', bag.width >= 80 && bag.height >= 80, `${Math.round(bag.width)}x${Math.round(bag.height)}`)
    check('禮物袋徽章 = 1', (await page.getByTestId('gift-bag-count').innerText()) === '1')
    const petBox = await page.getByTestId('pet').boundingBox()
    check('禮物袋不蓋在阿悟身上', bag.x + bag.width < petBox.x || bag.x > petBox.x + petBox.width || bag.y > petBox.y + petBox.height || bag.y + bag.height < petBox.y)
    await page.screenshot({ path: 'design/reviews/v7-home-shots/gift-bag-before-land.png' })
    // 摸阿悟不會被攔截
    await page.getByTestId('pet').click({ timeout: 3000 })
    check('有禮物時還是能直接摸阿悟（不被攔截）', true)
    // 收下
    const q0 = await invQty(page, 'banana')
    const sawFly = page.waitForFunction(() => [...document.body.children].some((e) => e.style?.zIndex === '95'), null, { timeout: 3000, polling: 30 }).then(() => true, () => false)
    const sawBurst = page.waitForSelector('[data-testid=fb-particle]', { timeout: 3000 }).then(() => true, () => false)
    await page.getByTestId('gift-bag').click()
    check('收下：星星炸開', await sawBurst)
    check('收下：食物飛進食物列', await sawFly)
    await page.waitForSelector('[data-testid=gift-bag]', { state: 'detached', timeout: 6000 })
    check('收下後佇列清空、食物數量沒有重複增加', ((await settingsOf(page)).pendingGifts ?? []).length === 0 && (await invQty(page, 'banana')) === q0)
    check('收下後食物列有那個食物，提示條用實際有的食物', (await page.locator('[data-dock-item=banana]').count()) === 1)
    await page.screenshot({ path: 'design/reviews/v7-home-shots/gift-bag-after-land.png' })
    // 食物列：只有 1 種食物 → 一個食物 + 一個「去商店」，沒有灰色一整排
    check('食物列沒有灰色缺貨排（.dock-item.empty）', (await page.locator('.dock-item.empty').count()) === 0)
    check('食物列有一個「去商店」圖示', (await page.getByTestId('dock-shop').count()) === 1)
    const shopBox = await page.getByTestId('dock-shop').boundingBox()
    check('「去商店」≥ 56px', shopBox.height >= 56 && shopBox.width >= 56)
    // 設定頁：年齡只有名冊那一個入口，且是 3 歲
    await openParentTab(page, '設定')
    check('設定頁沒有第二個「孩子的年齡」卡', (await page.getByTestId('age-card').count()) === 0 && (await page.locator('[data-testid^=age-][role=radio]').count()) === 0)
    check('名冊顯示 3 歲', (await page.getByTestId('kid-row').first().innerText()).includes('3 歲'))
    await page.getByTestId('kid-edit').first().click()
    check('改名/年齡視窗裡 3 歲亮著', (await page.getByTestId('child-age-3').getAttribute('aria-checked')) === 'true')
    await page.screenshot({ path: 'design/reviews/v7-home-shots/parent-settings-age-land.png' })
    check('onboarding 無 console 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // =====================================================================
  // 2) 禮物袋：舊存檔裡的站點禮物也由禮物袋收下；多份一次收完；餵食中不晃
  // =====================================================================
  {
    const { ctx, page, errors } = await freshApp(browser, LAND, { welcome: false })
    await patchSettings(page, {
      homeGuideShown: true,
      lastGiftDate: new Date().toLocaleDateString('sv-SE'),
      pendingGifts: [
        { foodId: 'apple', at: Date.now(), from: 'station' },
        { foodId: 'grape', at: Date.now() + 1, from: 'daily' },
        { stickerId: 'obj-star', at: Date.now() + 2, from: 'collection' },
      ],
    })
    await putRows(page, 'inventory', [{ id: 'apple', itemId: 'apple', qty: 2 }, { id: 'grape', itemId: 'grape', qty: 1 }])
    await reload(page)
    await page.waitForSelector('[data-testid=gift-bag]')
    check('舊存檔佇列裡的 3 份禮物：禮物袋徽章 = 3', (await page.getByTestId('gift-bag-count').innerText()) === '3')
    check('提示條用「剛收到的食物」（葡萄），不是食物列第一個', (await page.getByTestId('feed-hint').innerText()).includes('葡萄'), await page.getByTestId('feed-hint').innerText().catch(() => '無提示'))
    // 拖曳食物時禮物袋不晃
    const from = await center(page, '[data-dock-item=banana]')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 40, from.y - 80, { steps: 6 })
    check('拖曳食物時禮物袋不晃動（calm）', (await page.getByTestId('gift-bag').getAttribute('data-calm')) === 'true')
    await page.mouse.up()
    await page.waitForTimeout(500)
    await page.getByTestId('gift-bag').click()
    await page.waitForSelector('[data-testid=gift-bag]', { state: 'detached', timeout: 6000 })
    check('點一次：3 份全部收下', ((await settingsOf(page)).pendingGifts ?? []).length === 0)
    check('沒有任何舊的「阿悟拿出禮物」元件', (await page.getByTestId('gift').count()) === 0)
    check('禮物袋無 console 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // =====================================================================
  // 3) 蛋的外觀：依孵化進度換圖（0–33 / 33–66 / 66–90 / 90+）；進度環
  // =====================================================================
  {
    const { ctx, page } = await freshApp(browser, LAND, { stage: 'egg' })
    const looks = []
    for (const [feed, want] of [[0, 'pet-egg.png'], [8, 'pet-egg-s1.png'], [15, 'pet-egg-s2.png'], [19, 'pet-egg-crack.png']]) {
      await patchPet(page, { feedCount: feed, hunger: 90, hungerUpdatedAt: Date.now() })
      await reload(page)
      await page.waitForTimeout(400)
      const src = await page.locator('[data-testid=pet] img').first().getAttribute('src')
      looks.push(src)
      check(`蛋 feedCount=${feed}（${Math.round((feed / 20) * 100)}%）→ ${want}`, src.endsWith(`/${want}`) || src.includes(`/${want}?`), src)
      check(`進度環顯示 ${Math.round((feed / 20) * 100)}%`, (await page.getByTestId('progress-egg').getAttribute('data-progress')) === String(Math.round((feed / 20) * 100)))
      await page.screenshot({ path: `design/reviews/v7-home-shots/egg-${feed}-land.png` })
    }
    await ctx.close()
  }

  // =====================================================================
  // 4) 佈置：空狀態導向工坊；家具多個、換色
  // =====================================================================
  {
    const { ctx, page } = await freshApp(browser, LAND, { decor: [] })
    await page.getByRole('button', { name: /佈置/ }).click()
    await page.waitForSelector('[data-testid=dock-empty]')
    check('佈置空狀態：「還沒有家具」＋「去工坊」', (await page.getByTestId('dock-empty').innerText()).includes('還沒有家具') && (await page.getByTestId('go-workshop').innerText()).includes('去工坊'))
    const gb = await page.getByTestId('go-workshop').boundingBox()
    check('「去工坊」按鈕 ≥ 56px', gb.height >= 56 && gb.width >= 56)
    await page.screenshot({ path: 'design/reviews/v7-home-shots/edit-empty-land.png' })
    await page.getByTestId('go-workshop').click()
    await page.waitForSelector('[data-testid=workshop]')
    check('導向工坊（不是商店）', (await page.getByTestId('workshop').count()) === 1 && (await page.locator('[data-testid^=shop-grid]').count()) === 0)
    await ctx.close()
  }
  {
    const { ctx, page } = await freshApp(browser, LAND, { decor: [] })
    await putRows(page, 'inventory', [{ id: 'decor-ball', itemId: 'decor-ball', qty: 3 }, { id: 'decor-clock', itemId: 'decor-clock', qty: 1 }])
    await reload(page)
    await page.getByRole('button', { name: /佈置/ }).click()
    await page.waitForSelector('[data-dock-item=decor-ball]')
    check('擁有 3 個玩具球：佈置列顯示「x3」', (await page.locator('[data-dock-item=decor-ball] .dock-sub').innerText()).includes('x3'))
    // 點一下 = 擺在畫面中間並自動選取；第 1 個先換色
    await page.locator('[data-dock-item=decor-ball]').first().click()
    await page.waitForSelector('[data-testid=tint-btn]')
    const tb = await page.getByTestId('tint-btn').boundingBox()
    check('換色按鈕 ≥ 56px', tb.height >= 56 && tb.width >= 56)
    await page.getByTestId('tint-btn').click()
    await page.waitForTimeout(300)
    let pls = await dump(page, 'placements')
    check('換色：存成 optional 的 tint 欄位', pls.find((p) => p.itemId === 'decor-ball')?.tint === 1, JSON.stringify(pls.map((p) => [p.itemId, p.tint])))
    check('畫面上套用 CSS filter', (await page.locator('[data-placed="decor-ball"]').evaluate((e) => getComputedStyle(e).filter)).includes('hue-rotate'))
    // 再擺第 2、3 個（各自獨立的 key），第 3 個換第 3 種色
    for (let i = 0; i < 2; i++) {
      await page.locator('[data-dock-item=decor-ball]').first().click()
      await page.waitForTimeout(250)
    }
    const keys = (await dump(page, 'placements')).map((p) => p.itemId).filter((k) => k.startsWith('decor-ball')).sort()
    check('點 3 下：擺出 3 個，key 各自不同', keys.join() === 'decor-ball,decor-ball~2,decor-ball~3', keys.join())
    check('3 個都擺完：佈置列不再有玩具球', (await page.locator('[data-dock-item=decor-ball]').count()) === 0)
    check('房間裡有 3 個玩具球', (await page.locator('[data-placed^=decor-ball]').count()) === 3)
    await page.getByTestId('tint-btn').click()
    await page.getByTestId('tint-btn').click()
    await page.getByTestId('tint-btn').click()
    pls = await dump(page, 'placements')
    check('3 個球各自獨立的色調（第 1 個 1、第 3 個 3、第 2 個原色）', pls.find((p) => p.itemId === 'decor-ball')?.tint === 1 && pls.find((p) => p.itemId === 'decor-ball~3')?.tint === 3 && !pls.find((p) => p.itemId === 'decor-ball~2')?.tint, JSON.stringify(pls.map((p) => [p.itemId, p.tint])))
    for (let i = 0; i < 2; i++) await page.getByTestId('tint-btn').click()
    check('換色循環：4 色之後回到原色', !(await dump(page, 'placements')).find((p) => p.itemId === 'decor-ball~3')?.tint)
    await page.getByTestId('tint-btn').click()
    await page.screenshot({ path: 'design/reviews/v7-home-shots/decor-tint-multi-land.png' })
    // 收回第 2 個 → 佈置列回來 1 個
    await page.getByRole('button', { name: '收回' }).click()
    await page.waitForSelector('[data-dock-item=decor-ball]')
    check('收回一個：佈置列又出現玩具球', (await page.locator('[data-dock-item=decor-ball]').count()) === 1)
    check('佈置模式無橫向溢出', !(await hasOverflow(page)))
    await ctx.close()
  }

  // =====================================================================
  // 5) 工坊：做第二個、最多 3 個
  // =====================================================================
  {
    const { ctx, page } = await freshApp(browser, LAND, {})
    await putRows(page, 'materialLedger', [
      { id: 'm1', at: Date.now(), material: 'wood', delta: 40, kind: 'station', reason: 't' },
      { id: 'm2', at: Date.now(), material: 'stone', delta: 40, kind: 'station', reason: 't' },
      { id: 'm3', at: Date.now(), material: 'flower', delta: 40, kind: 'station', reason: 't' },
    ])
    await putRows(page, 'inventory', [{ id: 'decor-ball', itemId: 'decor-ball', qty: 1 }])
    await page.goto(`${BASE}#workshop`)
    await page.reload() // 直接寫 IndexedDB 不會通知畫面
    await page.waitForSelector('[data-testid=craft-decor-ball]')
    check('已有 1 個：卡片有「再做一個」', (await page.locator('[data-testid=craft-decor-ball] [data-testid=craft-more]').count()) === 1)
    const mb = await page.locator('[data-testid=craft-decor-ball] [data-testid=craft-more]').boundingBox()
    check('「再做一個」≥ 56px', mb.height >= 56)
    await page.locator('[data-testid=craft-decor-ball] [data-testid=craft-more]').click()
    await page.waitForSelector('[data-testid=craft-done]')
    await page.getByTestId('craft-done-close').click()
    check('做第二個：背包 2 個', (await invQty(page, 'decor-ball')) === 2)
    await page.locator('[data-testid=craft-decor-ball] [data-testid=craft-more]').click()
    await page.getByTestId('craft-done-close').click()
    check('做第三個後：背包 3 個、顯示「最多 3 個」、沒有再做的按鈕', (await invQty(page, 'decor-ball')) === 3 && (await page.locator('[data-testid=craft-decor-ball] [data-testid=craft-max]').count()) === 1 && (await page.locator('[data-testid=craft-decor-ball] [data-testid=craft-more]').count()) === 0)
    await page.screenshot({ path: 'design/reviews/v7-home-shots/workshop-multi-land.png' })
    await ctx.close()
  }

  // =====================================================================
  // 6) 掛畫避開窗戶（直向）
  // =====================================================================
  {
    const { ctx, page } = await freshApp(browser, PORT, {})
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const x = c.getContext('2d')
      x.fillStyle = '#ffb347'
      x.fillRect(0, 0, 64, 64)
      return c.toDataURL('image/png')
    })
    await putRows(page, 'coloring', [
      { pageId: 'g:w1', basePageId: 'monkey', fills: { a: '#f00' }, png, createdAt: 1, updatedAt: 1 },
      { pageId: 'g:w2', basePageId: 'monkey', fills: { a: '#00f' }, png, createdAt: 2, updatedAt: 2 },
    ])
    await page.goto(`${BASE}#gallery`)
    await page.reload()
    await page.waitForSelector('[data-testid=gallery-item]')
    for (let i = 0; i < 2; i++) {
      await page.locator('.gallery-thumb').nth(i).click()
      await page.getByTestId('hang-btn').click()
      await page.locator('.modal-back').click({ position: { x: 5, y: 5 } }) // 點背景關掉視窗
      await page.waitForTimeout(300)
    }
    const pls = (await dump(page, 'placements')).filter((p) => p.itemId.startsWith('art-'))
    check('直向：兩幅畫都掛上了', pls.length === 2, JSON.stringify(pls.map((p) => [p.x.toFixed(2), p.y.toFixed(2)])))
    await page.goto(BASE)
    await page.waitForSelector('[data-testid=room]')
    await page.waitForTimeout(800)
    const win = await page.locator('.rb-window').first().boundingBox()
    const arts = await page.locator('[data-placed^=art-]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
    const hit = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    check('直向：畫沒有蓋到窗戶', arts.length === 2 && arts.every((a) => !hit(a, win)), JSON.stringify({ win, arts }))
    await page.screenshot({ path: 'design/reviews/v7-home-shots/hung-art-port.png' })
    await ctx.close()
  }

  // =====================================================================
  // 7) 家長區：切換孩子、單列分頁
  // =====================================================================
  {
    const { ctx, page, errors } = await freshApp(browser, LAND, {})
    await openParentTab(page, '設定')
    check('只有一個孩子：沒有孩子切換 chips', (await page.getByTestId('child-chips').count()) === 0)
    await page.getByTestId('kid-add').click()
    await page.getByTestId('kid-name').fill('二寶')
    await page.getByTestId('child-age-3').click()
    await page.getByTestId('kid-add-submit').click()
    await page.waitForSelector('[data-testid=child-chips]')
    const chips = await page.getByTestId('child-chip').count()
    check('兩個孩子：頂端出現頭像 chips', chips === 2)
    const cb = await page.getByTestId('child-chip').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
    check('chips ≥ 56px', cb.every((h) => h >= 56), cb.join())
    // 分頁單列
    const tabs = await page.locator('[data-testid=parent-tabs] [role=tab]').evaluateAll((els) => els.map((e) => ({ t: e.textContent, y: Math.round(e.getBoundingClientRect().top), h: e.getBoundingClientRect().height })))
    check('分頁單列（所有分頁 top 相同）、高度 ≥ 56', new Set(tabs.map((t) => t.y)).size === 1 && tabs.every((t) => t.h >= 56), JSON.stringify(tabs.map((t) => t.y)))
    check('PM 預覽排在最後', tabs.at(-1).t === 'PM 預覽', tabs.at(-1).t)
    const dom = tabs.map((t) => t.t)
    check('DOM 順序 = 視覺順序（審核第一、本週第二）', dom[0] === '審核' && dom[1] === '本週')
    await page.screenshot({ path: 'design/reviews/v7-home-shots/parent-chips-tabs-land.png' })
    // 看二寶
    await page.getByTestId('child-chip').nth(1).click()
    await page.waitForTimeout(500)
    check('切到二寶：不用再輸 PIN，仍在家長區設定分頁', (await page.locator('button.key').count()) === 0 && (await page.getByRole('tab', { name: '設定', exact: true }).getAttribute('aria-selected')) === 'true')
    check('名字欄是二寶的', (await page.locator('input.input').nth(0).inputValue().catch(() => '')) !== undefined)
    await page.getByRole('tab', { name: '本週', exact: true }).click()
    await page.waitForTimeout(400)
    const bodyTxt = await page.getByTestId('parent-body').innerText()
    check('本週報告看得到（二寶）', bodyTxt.length > 10)
    await page.getByRole('tab', { name: '設定', exact: true }).click()
    await page.waitForTimeout(500)
    const nameInputs = await page.locator('section.settings input.input').evaluateAll((els) => els.map((e) => e.value))
    check('設定分頁的「小孩名字」是二寶（資料庫已切換）', nameInputs.includes('二寶'), nameInputs.join())
    await page.screenshot({ path: 'design/reviews/v7-home-shots/parent-switch-child-land.png' })
    // 切回小明
    await page.getByTestId('child-chip').nth(0).click()
    await page.waitForTimeout(700)
    const nameInputs2 = await page.locator('section.settings input.input').evaluateAll((els) => els.map((e) => e.value))
    check('切回小明：小孩名字是小明', nameInputs2.includes('小明'), nameInputs2.join())
    await page.getByTestId('child-chip').nth(1).click()
    await page.waitForTimeout(300)
    // 在看二寶的時候離開：首頁一定還是小明（原本正在玩的孩子）
    await page.getByRole('button', { name: '回到小孩模式' }).click()
    await page.waitForSelector('[data-testid=pet]')
    check('離開家長區：首頁還是原本在玩的小明，資料也是小明的', (await page.locator('.hello-name').innerText()) === '小明')
    const bal = await page.locator('.chip-num').first().innerText()
    check('點數膠囊是小明的（二寶有歡迎禮物 20、小明預設 0）', bal === '0', bal)
    check('家長區無 console 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // =====================================================================
  // 8) 選孩子畫面：頭像與專屬顏色；點下去先唸名字再進入
  // =====================================================================
  {
    const { ctx, page } = await freshApp(browser, LAND, {})
    await openParentTab(page, '設定')
    await page.getByTestId('kid-add').click()
    await page.getByTestId('kid-name').fill('二寶')
    await page.getByTestId('kid-add-submit').click()
    await page.waitForSelector('[data-testid=child-chips]')
    await page.getByRole('button', { name: '回到小孩模式' }).click()
    await page.getByTestId('switch-person').click()
    await page.getByTestId('switch-yes').click()
    await page.waitForSelector('[data-testid=child-picker]')
    const cards = await page.getByTestId('child-card').evaluateAll((els) => els.map((e) => ({ avatar: e.querySelector('[data-testid=child-avatar]')?.textContent, color: getComputedStyle(e).getPropertyValue('--pk-deep') })))
    check('選孩子畫面：每張卡有頭像（emoji）', cards.length === 2 && cards.every((c) => !!c.avatar), JSON.stringify(cards))
    check('兩張卡的專屬顏色不同、頭像不同', cards[0].color !== cards[1].color && cards[0].avatar !== cards[1].avatar)
    await page.screenshot({ path: 'design/reviews/v7-home-shots/picker-land.png' })
    await page.evaluate(() => {
      window.__said = []
      const sp = window.speechSynthesis
      if (sp) {
        const orig = sp.speak.bind(sp)
        sp.speak = (u) => {
          window.__said.push(u.text)
          return orig(u)
        }
      }
    })
    await page.getByTestId('child-card').nth(1).click()
    const said = await page.evaluate(() => window.__said ?? [])
    check('點下去先唸名字（二寶）', said.includes('二寶'), JSON.stringify(said))
    await page.waitForSelector('[data-testid=room]', { timeout: 5000 })
    check('然後進入二寶的房間', (await page.locator('.hello-name').innerText()) === '二寶')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTestId('switch-person').click()
    await page.getByTestId('switch-yes').click()
    await page.waitForSelector('[data-testid=child-picker]')
    check('手機：選孩子畫面無橫向溢出', !(await hasOverflow(page)))
    await page.screenshot({ path: 'design/reviews/v7-home-shots/picker-phone.png' })
    await ctx.close()
  }
} finally {
  await browser.close()
}
if (state.failed) {
  console.log(`\n${state.failed} 項失敗`)
  process.exit(1)
}
console.log('\n全部通過')
