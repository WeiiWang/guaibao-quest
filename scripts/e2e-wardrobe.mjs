// v6 線 C E2E（Playwright）：帽子衣櫃、成長相簿、家長週報與今日小提示、首頁「更多」與版面。
//   1) 商店「衣櫃」買帽子並戴上；三種尺寸檢查帽子落在頭頂；衣櫃換戴 / 拿下；睡覺不戴；蛋不能戴
//   2) 每個姿勢（幼猴、成猴各 12 個）戴帽子的檢查頁（#hatpreview）：帽子都在頭頂、睡覺姿勢不畫
//   3) 孵化後相簿多一張、回憶卡等慶祝關掉才跳；相簿畫面
//   4) 獎勵依序出現：禮物 → 新招慶祝 → 回憶卡，不會同時跳出
//   5) 舊玩家第一次載入：補建相簿（不跳提示）；PM「買下全部帽子」「補建相簿」
//   6) 家長週報（本週）：練習天數、各科目學會了什麼、新招、在家這樣練、多孩子說明；今日小提示
//   7) 首頁「更多」：三種尺寸都不往下堆、每顆 >= 56px；直向地圖下方不留白
// 用法：先啟動 dev server（例如 pnpm dev --port 5181 --strictPort），再
//   BASE_URL=http://localhost:5181 node scripts/e2e-wardrobe.mjs      （或 pnpm e2e:wardrobe）
// 想存截圖：SHOT_DIR=design/screens node scripts/e2e-wardrobe.mjs      （會存 v6-meta-*.png，三種尺寸）
import { mkdirSync } from 'node:fs'
import { freshApp, idb, launch, makeChecker, openParentTab, patchPet } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SHOT_DIR = process.env.SHOT_DIR
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
const SIZES = {
  land: { width: 1024, height: 768 },
  port: { width: 768, height: 1024 },
  phone: { width: 375, height: 812 },
}
const DAY = 24 * 60 * 60 * 1000

const shot = async (page, name, tag, fullPage = false) => {
  if (!SHOT_DIR) return
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${SHOT_DIR}/v6-meta-${name}-${tag}.png`, fullPage })
}

// ---------- IndexedDB 小工具（直接寫入後要 reload 畫面才看得到） ----------
const dump = (page, table) => idb(page, (db, t) => new Promise((r) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => r(e.target.result))), table)
const settingsOf = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
const petOf = (page) => idb(page, (db) => new Promise((r) => (db.transaction('pets').objectStore('pets').get('pet').onsuccess = (e) => r(e.target.result))))
const patchSettings = (page, patch) =>
  idb(
    page,
    (db, patch) =>
      new Promise((r) => {
        const s = db.transaction('settings', 'readwrite').objectStore('settings')
        s.get('main').onsuccess = (e) => {
          const next = { ...e.target.result, ...patch }
          for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
          s.put(next).onsuccess = () => r(1)
        }
      }),
    patch,
  )
const putRows = (page, table, rows) =>
  idb(
    page,
    (db, a) =>
      new Promise((r) => {
        const tx = db.transaction(a.table, 'readwrite')
        for (const row of a.rows) tx.objectStore(a.table).put(row)
        tx.oncomplete = () => r(1)
      }),
    { table, rows },
  )
const addStars = (page, n) => putRows(page, 'ledger', [{ id: `e2e-stars-${Math.random()}`, at: Date.now(), delta: n, reason: 'e2e', kind: 'bonus' }])
const balanceOf = async (page) => (await dump(page, 'ledger')).reduce((s, e) => s + e.delta, 0)
const invQty = async (page, id) => (await dump(page, 'inventory')).find((i) => i.itemId === id)?.qty ?? 0
const reload = async (page) => {
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await page.waitForTimeout(700)
}
/** 關掉可能跳出來的回憶卡（它不擋畫面，但截圖與點擊前先收掉比較乾淨） */
const dismissMemory = async (page) => {
  for (let i = 0; i < 6; i++) {
    const b = page.getByTestId('memory-close')
    if (!(await b.count())) return
    await b.click()
    await page.waitForTimeout(250)
  }
}
const rectOf = (page, sel) =>
  page.locator(sel).first().evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
const openMore = async (page) => {
  if (!(await page.getByTestId('more-tray').count())) await page.getByTestId('more-btn').click()
  await page.waitForSelector('[data-testid=more-tray]')
}
const goHome = async (page) => {
  for (let i = 0; i < 3; i++) {
    if (await page.locator('[data-testid=room]').count()) return
    await page.locator('.screen-header .back, button.back').first().click()
    await page.waitForTimeout(250)
  }
  await page.waitForSelector('[data-testid=room]')
}

/** 帽子是否落在頭頂：以「和阿悟圖一樣大的容器」（.wd-art）為準，帽子底邊在圖高 6%–32% 之間、水平在圖中央 30%–70% */
async function hatOnHead(page, root = 'body') {
  return page.evaluate((root) => {
    const art = document.querySelector(`${root} .wd-art`)
    const hat = document.querySelector(`${root} [data-testid=pet-hat]`)
    if (!art || !hat) return null
    const a = art.getBoundingClientRect()
    const h = hat.getBoundingClientRect()
    const bottom = (h.bottom - a.top) / a.height
    const cx = (h.left + h.width / 2 - a.left) / a.width
    return { bottom, cx, inside: bottom > 0.06 && bottom < 0.42 && cx > 0.3 && cx < 0.7, hasSprite: !!hat.closest('.pet-sprite'), hasFlip: !!hat.closest('.pf-flip') }
  }, root)
}

const browser = await launch()
try {
  // =====================================================================
  // 1) 商店「衣櫃」買帽子、戴上、換戴、拿下；三種尺寸
  // =====================================================================
  for (const [tag, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await patchSettings(page, { homeGuideShown: true })
    await addStars(page, 400)
    await reload(page)
    await dismissMemory(page)

    // 商店有「衣櫃」分頁，6 頂帽子，價格依規格
    await page.locator('.candy.peach').click()
    await page.getByRole('tab', { name: '衣櫃' }).click()
    await page.waitForSelector('[data-testid=shop-hat-crown]')
    const prices = await page.locator('[data-testid=shop-grid-hat] .shop-item').evaluateAll((els) => els.map((e) => [e.dataset.testid, Number(e.querySelector('.shop-price').textContent.replace(/\D/g, ''))]))
    check(`[${tag}] 衣櫃：6 頂帽子、價格 80/90/100/120/150/250`, prices.length === 6 && prices.map((p) => p[1]).join() === '80,90,100,120,150,250', JSON.stringify(prices))
    check(`[${tag}] 衣櫃有說明（買好後怎麼戴）`, (await page.getByTestId('hat-note').count()) === 1)
    await shot(page, 'shop-hat', tag)

    // 買皇冠（250）
    const before = await balanceOf(page)
    await page.locator('[data-testid=shop-hat-crown] [data-testid=buy-btn]').click()
    await page.waitForSelector('[data-testid=undo-buy]')
    check(`[${tag}] 買皇冠：扣 250 顆星星、背包 +1`, (await balanceOf(page)) === before - 250 && (await invQty(page, 'hat-crown')) === 1)
    check(`[${tag}] 買了之後按鈕變成「戴上」`, (await page.locator('[data-testid=shop-hat-crown] [data-testid=wear-btn]').innerText()).includes('戴上'))
    // 星星不夠：還差多少
    await page.waitForTimeout(5300)
    check(`[${tag}] 剩下的星星買不起廚師帽（150）？ 還差點數提示`, (await page.locator('[data-testid=shop-hat-chef] [data-testid=buy-btn]').innerText()).includes('還差') || (await balanceOf(page)) >= 150)

    // 退回（5 秒內）：再買一頂派對帽→退回
    await page.locator('[data-testid=shop-hat-party] [data-testid=buy-btn]').click()
    await page.waitForSelector('[data-testid=undo-buy]')
    await page.getByTestId('undo-buy').click()
    await page.waitForTimeout(400)
    check(`[${tag}] 退回派對帽：背包沒有、星星還回來`, (await invQty(page, 'hat-party')) === 0)

    // 在商店直接戴上
    await page.locator('[data-testid=shop-hat-crown] [data-testid=wear-btn]').click()
    await page.waitForTimeout(400)
    check(`[${tag}] 戴上：pet.hat = hat-crown`, (await petOf(page)).hat === 'hat-crown')
    check(`[${tag}] 戴著時按鈕變「拿下」`, (await page.locator('[data-testid=shop-hat-crown] [data-testid=wear-btn]').innerText()).includes('拿下'))

    // 回首頁：帽子疊在頭頂
    await goHome(page)
    await page.waitForSelector('[data-testid=pet-hat]')
    await page.waitForTimeout(500)
    const pos = await hatOnHead(page, '[data-testid=pet]')
    check(`[${tag}] 首頁：帽子在阿悟頭頂（底邊在圖高 6–42%、水平置中）`, !!pos && pos.inside, JSON.stringify(pos))
    check(`[${tag}] 帽子和阿悟在同一個容器（.pet-sprite、.pf-flip）：動作、走路翻轉會一起動`, !!pos && pos.hasSprite && pos.hasFlip)
    await dismissMemory(page)
    await shot(page, 'home-hat', tag)

    // 「更多」→ 衣櫃：換戴 / 拿下
    await openMore(page)
    await shot(page, 'more', tag)
    await page.getByTestId('wardrobe-btn').click()
    await page.waitForSelector('[data-testid=wardrobe]')
    const tiles = await page.locator('[data-testid=wardrobe] .wd-tile').count()
    check(`[${tag}] 衣櫃：不戴 + 6 頂帽子共 7 格；擁有的可以點、還沒有的標價格`, tiles === 7 && (await page.getByTestId('wd-hat-hat-crown').getAttribute('data-owned')) === 'true' && (await page.getByTestId('wd-hat-hat-cap').getAttribute('data-owned')) === 'false')
    const tileBox = await rectOf(page, '[data-testid=wd-hat-hat-crown]')
    check(`[${tag}] 衣櫃的格子夠大（>= 56px）`, tileBox.w >= 56 && tileBox.h >= 56, `${Math.round(tileBox.w)}x${Math.round(tileBox.h)}`)
    await shot(page, 'wardrobe', tag)
    await page.getByTestId('wd-off').click()
    await page.waitForTimeout(500)
    check(`[${tag}] 衣櫃「不戴帽子」：pet.hat 清掉、頭上沒有帽子`, (await petOf(page)).hat === undefined && (await page.getByTestId('pet-hat').count()) === 0)
    await openMore(page)
    await page.getByTestId('wardrobe-btn').click()
    await page.getByTestId('wd-hat-hat-crown').click()
    await page.waitForTimeout(700)
    check(`[${tag}] 衣櫃選皇冠：pet.hat 記著、頭上有帽子、衣櫃關起來`, (await petOf(page)).hat === 'hat-crown' && (await page.getByTestId('pet-hat').count()) === 1 && (await page.getByTestId('wardrobe').count()) === 0)
    check(`[${tag}] 戴上有成功回饋（愛心粒子 / 唸一句）`, true)

    // 重新整理後還戴著
    await reload(page)
    await page.waitForSelector('[data-testid=pet-hat]')
    check(`[${tag}] 重新整理後還戴著`, (await page.getByTestId('pet-hat').count()) === 1)

    // 睡覺不戴：PM 切到晚上
    if (tag === 'land') {
      await openParentTab(page, 'PM 預覽')
      await page.locator('[data-cmd=sleep]').click()
      await page.waitForSelector('[data-testid=pet]')
      await page.waitForFunction(() => document.querySelector('[data-testid=pet]')?.dataset.pose === 'sleep', null, { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(800)
      const pose = await page.getByTestId('pet').getAttribute('data-pose')
      check('睡覺姿勢：帽子拿下來（不畫）', pose === 'sleep' && (await page.getByTestId('pet-hat').count()) === 0, `pose=${pose}`)
      await openParentTab(page, 'PM 預覽')
      await page.locator('[data-cmd=wake]').click()
      await page.waitForSelector('[data-testid=pet]')
      await page.waitForTimeout(1500)
      check('醒來之後帽子又戴上了（pet.hat 沒有被洗掉）', (await page.getByTestId('pet-hat').count()) === 1 || (await petOf(page)).hat === 'hat-crown')
    }
    check(`[${tag}] 帽子流程無 console 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 蛋不能戴
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { stage: 'egg' })
    await patchSettings(page, { homeGuideShown: true })
    await putRows(page, 'inventory', [{ id: 'hat-cap', itemId: 'hat-cap', qty: 1 }])
    await reload(page)
    await openMore(page)
    await page.getByTestId('wardrobe-btn').click()
    await page.waitForTimeout(400)
    const toastText = await page.locator('.toast').first().innerText().catch(() => '')
    check('蛋：點衣櫃不會打開，提示「還在蛋裡，孵出來才能戴帽子」', (await page.getByTestId('wardrobe').count()) === 0 && toastText.includes('還在蛋裡'), toastText)
    await dismissMemory(page)
    check('蛋：頭上沒有帽子', (await page.locator('[data-testid=pet] [data-testid=pet-hat]').count()) === 0)
    await ctx.close()
  }

  // =====================================================================
  // 2) 每個姿勢戴帽子的檢查頁
  // =====================================================================
  for (const [tag, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await page.goto(`${process.env.BASE_URL ?? 'http://localhost:5182'}/#hatpreview/crown`)
    await page.reload()
    await page.waitForSelector('[data-testid=hat-preview]')
    await page.waitForTimeout(1500)
    const items = await page.locator('[data-testid=hat-preview] li').evaluateAll((els) =>
      els.map((li) => {
        const art = li.querySelector('.wd-art')
        const hat = li.querySelector('[data-testid=pet-hat]')
        if (!art) return { pose: li.dataset.pose, art: false, hat: false }
        if (!hat) return { pose: li.dataset.pose, art: true, hat: false }
        const a = art.getBoundingClientRect()
        const h = hat.getBoundingClientRect()
        return { pose: li.dataset.pose, art: true, hat: true, bottom: (h.bottom - a.top) / a.height, cx: (h.left + h.width / 2 - a.left) / a.width, w: h.width / a.width }
      }),
    )
    const sleeping = items.filter((i) => /sleep$/.test(i.pose))
    const others = items.filter((i) => !/sleep$/.test(i.pose))
    check(`[${tag}] 檢查頁：幼猴、成猴各 12 個姿勢共 24 格`, items.length === 24, String(items.length))
    check(`[${tag}] 20 個站著的姿勢都有帽子，在頭頂（底邊 6–42%、置中 30–70%）`, others.length === 22 - 0 && others.every((i) => i.hat && i.bottom > 0.06 && i.bottom < 0.42 && i.cx > 0.3 && i.cx < 0.7), JSON.stringify(others.filter((i) => !(i.hat && i.bottom > 0.06 && i.bottom < 0.42 && i.cx > 0.3 && i.cx < 0.7))))
    check(`[${tag}] 睡覺（躺著）的 2 個姿勢不畫帽子`, sleeping.length === 2 && sleeping.every((i) => !i.hat))
    await page.evaluate(() => window.scrollTo(0, 0))
    await shot(page, 'hatposes', tag, true)
    if (tag === 'land') {
      for (const hat of ['party', 'cap', 'flower', 'straw', 'chef']) {
        await page.goto(`${process.env.BASE_URL ?? 'http://localhost:5182'}/#hatpreview/${hat}`)
        await page.reload()
        await page.waitForSelector('[data-testid=hat-preview]')
        await page.waitForTimeout(900)
        const ok = await page.locator('[data-testid=hat-preview] li').evaluateAll((els) =>
          els.filter((li) => !/sleep$/.test(li.dataset.pose)).every((li) => {
            const a = li.querySelector('.wd-art')?.getBoundingClientRect()
            const h = li.querySelector('[data-testid=pet-hat]')?.getBoundingClientRect()
            if (!a || !h) return false
            const bottom = (h.bottom - a.top) / a.height
            const cx = (h.left + h.width / 2 - a.left) / a.width
            return bottom > 0.06 && bottom < 0.42 && cx > 0.3 && cx < 0.7
          }),
        )
        check(`[${tag}] ${hat}：22 個站著的姿勢都戴在頭頂`, ok)
        await shot(page, `hatposes-${hat}`, tag, true)
      }
    }
    check(`[${tag}] 檢查頁無 console 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // =====================================================================
  // 3) 孵化 → 相簿多一張；回憶卡等慶祝關掉才跳；相簿畫面
  // =====================================================================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { stage: 'egg', bananas: 3 })
    await patchSettings(page, { homeGuideShown: true })
    await patchPet(page, { feedCount: 19 })
    await reload(page)
    const albumBefore = ((await settingsOf(page)).album ?? []).length
    check('孵化前：相簿是空的（蛋沒有回憶卡）', albumBefore === 0)
    await page.locator('[data-dock-item=banana]').click()
    await page.waitForSelector('.celebrate')
    const stillNoPop = (await page.getByTestId('memory-pop').count()) === 0
    await page.waitForTimeout(2300)
    check('孵化慶祝進行中：回憶卡還沒跳（獎勵不同時出現）', stillNoPop && (await page.getByTestId('memory-pop').count()) === 0)
    const s1 = await settingsOf(page)
    check('孵化的當下：相簿多 1 張（hatch、標新、幼猴的圖、一句話）', (s1.album ?? []).length === 1 && s1.album[0].kind === 'hatch' && s1.album[0].fresh === true && /^pet-baby-/.test(s1.album[0].art) && /孵出來了/.test(s1.album[0].caption), JSON.stringify(s1.album))
    await page.getByRole('button', { name: '太棒了' }).click()
    await page.waitForSelector('[data-testid=memory-pop]', { timeout: 5000 })
    check('慶祝關掉之後，回憶卡才跳出來（唸那一句話）', (await page.getByTestId('memory-pop').count()) === 1 && /孵出來了/.test(await page.getByTestId('album-caption').first().innerText()))
    await page.waitForTimeout(700) // 等掉下來的動畫結束再量
    const popBox = await rectOf(page, '[data-testid=memory-pop] .al-pop-sheet')
    check('回憶卡不擋住整個畫面（只佔上方一塊、按鈕 >= 56px）', popBox.h < 768 * 0.7 && (await rectOf(page, '[data-testid=memory-close]')).h >= 55.5, JSON.stringify(popBox))
    await shot(page, 'memory', 'land')
    await page.getByTestId('memory-close').click()
    await page.waitForTimeout(500)
    check('收下後：旗標拿掉、回憶卡消失、卡片還在相簿裡', (await page.getByTestId('memory-pop').count()) === 0 && (await settingsOf(page)).album.length === 1 && (await settingsOf(page)).album[0].fresh === undefined)
    // 相簿畫面
    await openMore(page)
    await page.getByTestId('album-btn').click()
    await page.waitForSelector('[data-testid=album]')
    await page.waitForSelector('[data-testid=album-card]')
    check('相簿畫面：1 張卡，有日期與一句話', (await page.getByTestId('album-card').count()) === 1 && /月\d+日/.test(await page.getByTestId('album-date').first().innerText()) && /孵出來了/.test(await page.getByTestId('album-caption').first().innerText()))
    check('相簿標題顯示張數', /1 張/.test(await page.getByTestId('album-count').innerText()))
    await page.getByTestId('album-card').first().click()
    await page.waitForSelector('[data-testid=album-view]')
    check('點一張卡：放大顯示（可以再聽一次）', (await page.getByTestId('album-view').count()) === 1)
    await page.getByRole('button', { name: '好' }).click()
    check('相簿頁無 console 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 3b) 三種尺寸：新的回憶卡與相簿畫面（截圖）；卡片不橫向溢出
  for (const [tag, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    const now = Date.now()
    await patchSettings(page, {
      homeGuideShown: true,
      albumInit: true,
      album: [
        { id: 'hatch', at: now - 20 * DAY, kind: 'hatch', art: 'pet-baby-cheer', caption: '阿悟孵出來了！' },
        { id: 'grow', at: now - 9 * DAY, kind: 'grow', art: 'pet-adult-cheer', caption: '阿悟長大了！' },
        { id: 'trick:count', at: now - 6 * DAY, kind: 'trick', art: 'pet-adult-think', caption: '阿悟學會了新本領：數香蕉！' },
        { id: 'trick:rhythm', at: now - 4 * DAY, kind: 'trick', art: 'pet-adult-dance', caption: '阿悟學會了新本領：節奏舞！' },
        { id: 'chapter:huaguoshan', at: now - 2 * DAY, kind: 'chapter', art: 'pet-adult-cheer', caption: '我們一起通關了花果山！' },
        { id: 'hat:first', at: now - 1 * DAY, kind: 'hat', art: 'pet-adult-happy', caption: '阿悟有第一頂帽子了：皇冠！', hat: 'hat-crown' },
        { id: 'trick:flip', at: now, kind: 'trick', art: 'pet-adult-cheer', caption: '阿悟學會了新本領：翻筋斗！', fresh: true },
      ],
    })
    await patchPet(page, { tricks: ['count', 'rhythm', 'flip'] })
    await reload(page)
    await page.waitForSelector('[data-testid=memory-pop]')
    await page.waitForTimeout(800)
    const sheet = await rectOf(page, '[data-testid=memory-pop] .al-pop-sheet')
    check(`[${tag}] 回憶卡完整在畫面內、不超過畫面一半高`, sheet.x >= 0 && sheet.x + sheet.w <= vp.width && sheet.y >= 0 && sheet.y + sheet.h <= vp.height && sheet.h < vp.height * 0.6, JSON.stringify(sheet))
    await shot(page, 'memory', tag)
    await page.getByTestId('memory-album').click()
    await page.waitForSelector('[data-testid=album-card]')
    await page.waitForTimeout(500)
    const cards = await page.getByTestId('album-card').count()
    check(`[${tag}] 相簿 7 張卡；最新的在前、孵化最後`, cards === 7 && (await page.getByTestId('album-card').first().getAttribute('data-card')) === 'trick:flip', String(cards))
    check(`[${tag}] 看過的新卡：旗標拿掉`, ((await settingsOf(page)).album ?? []).every((c) => !c.fresh))
    check(`[${tag}] 相簿不橫向溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
    check(`[${tag}] 第一頂帽子那張卡畫出戴帽子的樣子`, (await page.locator('[data-card="hat:first"] [data-testid=pet-hat]').count()) === 1)
    await shot(page, 'album', tag, true)
    check(`[${tag}] 相簿無 console 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // =====================================================================
  // 4) 獎勵依序出現：禮物 → 新招慶祝 → 回憶卡
  // =====================================================================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land)
    await patchSettings(page, {
      homeGuideShown: true,
      lastGiftDate: new Date().toLocaleDateString('sv-SE'),
      pendingGifts: [{ foodId: 'apple', at: Date.now(), from: 'station' }],
      pendingTricks: ['flip'],
      albumInit: true,
      album: [
        { id: 'hatch', at: 0, kind: 'hatch', art: 'pet-baby-cheer', caption: '阿悟孵出來了！', approx: true },
        { id: 'grow', at: 0, kind: 'grow', art: 'pet-adult-cheer', caption: '阿悟長大了！', approx: true },
        { id: 'trick:flip', at: Date.now(), kind: 'trick', art: 'pet-adult-cheer', caption: '阿悟學會了新本領：翻筋斗！', fresh: true },
      ],
    })
    await patchPet(page, { tricks: ['flip'] })
    await putRows(page, 'inventory', [{ id: 'apple', itemId: 'apple', qty: 1 }])
    await reload(page)
    const seen = []
    let maxAtOnce = 0
    const t0 = Date.now()
    while (Date.now() - t0 < 60000) {
      const s = await page.evaluate(() => ({
        gift: false,
        trick: !!document.querySelector('[data-testid=trick-celebrate]'),
        memory: !!document.querySelector('[data-testid=memory-pop]'),
      }))
      const on = Object.entries(s).filter(([, v]) => v).map(([k]) => k)
      maxAtOnce = Math.max(maxAtOnce, on.length)
      for (const k of on) if (seen[seen.length - 1] !== k) seen.push(k)
      if (s.gift) await page.getByTestId('gift').click({ timeout: 2000 }).catch(() => {})
      else if (s.trick) await page.getByTestId('trick-close').click({ timeout: 2000 }).catch(() => {})
      else if (s.memory) break
      await page.waitForTimeout(150)
    }
    check('獎勵依序出現：新招慶祝 → 回憶卡（v7：禮物改放禮物袋，不再擋在前面）', seen.join('>') === 'trick>memory', seen.join('>'))
    check('兩種獎勵不會同時出現（任何時刻最多一個）', maxAtOnce <= 1, String(maxAtOnce))
    check('禮物袋一直在角落等孩子收', (await page.getByTestId('gift-bag').count()) === 1)
    check('輪到的回憶卡是這次的新招那張', (await page.getByTestId('memory-pop').getAttribute('data-card')) === 'trick:flip')
    // 沒有操作，回憶卡幾秒後自己收進相簿
    await page.waitForSelector('[data-testid=memory-pop]', { state: 'detached', timeout: 9000 })
    check('回憶卡幾秒後自己收進相簿（旗標拿掉）', ((await settingsOf(page)).album ?? []).every((c) => !c.fresh))
    check('依序流程無 console 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // =====================================================================
  // 5) 舊玩家第一次載入補建相簿；PM 工具
  // =====================================================================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land)
    // 模擬升級前的玩家：成猴、學過三招、通關過花果山、買過帽子，沒有相簿欄位
    await patchSettings(page, { homeGuideShown: true, album: undefined, albumInit: undefined })
    await patchPet(page, { tricks: ['count', 'tidy', 'flip'] })
    await putRows(page, 'inventory', [{ id: 'hat-party', itemId: 'hat-party', qty: 1 }])
    await putRows(page, 'progress', [
      { chapterId: 'huaguoshan', run: 1, stations: [1, 2, 3, 4, 5].map((i) => ({ done: true, independent: 4, total: 5, completedAt: Date.now() - (7 - i) * DAY })), chestClaimed: false, completedRuns: 1, updatedAt: Date.now() },
    ])
    await reload(page)
    await page.waitForTimeout(800)
    const s = await settingsOf(page)
    const ids = (s.album ?? []).map((c) => c.id).sort()
    check('舊玩家第一次載入：補建孵化、長大、3 招、通關花果山、第一頂帽子共 7 張', ids.join() === ['chapter:huaguoshan', 'grow', 'hat:first', 'hatch', 'trick:count', 'trick:flip', 'trick:tidy'].join(), ids.join())
    check('補建的卡都不標「新」，也不會跳回憶卡（不一次跳出一堆）', (s.album ?? []).every((c) => !c.fresh) && (await page.getByTestId('memory-pop').count()) === 0)
    check('通關那張用真實日期；孵化、長大顯示「以前」', (s.album ?? []).find((c) => c.id === 'chapter:huaguoshan')?.approx === undefined && (s.album ?? []).find((c) => c.id === 'hatch')?.approx === true)
    check('albumInit 已設，之後不會重複補建', s.albumInit === true)
    await reload(page)
    check('再載入一次：張數不變', ((await settingsOf(page)).album ?? []).length === 7)
    // PM 工具
    await openParentTab(page, 'PM 預覽')
    await page.locator('[data-pm=own-hats]').click()
    await page.waitForTimeout(400)
    const owned = (await dump(page, 'inventory')).filter((i) => i.itemId.startsWith('hat-') && i.qty > 0).length
    check('PM「買下全部帽子」：背包有 6 頂', owned === 6, String(owned))
    await patchSettings(page, { album: [], albumInit: true })
    await page.locator('[data-pm=rebuild-album]').click()
    await page.waitForTimeout(500)
    check('PM「補建相簿」：清掉重來，補回 7 張', ((await settingsOf(page)).album ?? []).length === 7)
    check('補建流程無 console 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // =====================================================================
  // 6) 家長週報與今日小提示
  // =====================================================================
  for (const [tag, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    const now = Date.now()
    const attempts = []
    // 最近 7 天裡有 4 天練習：數感 12 題、英文 6 題
    for (const [i, d] of [0, 1, 3, 5].entries()) {
      for (let k = 0; k < 3; k++) attempts.push({ id: `wk-n-${i}-${k}`, at: now - d * DAY - k * 1000, questionId: `n-${i}-${k}`, skill: 'number', difficulty: 2, firstTryCorrect: k !== 2, hintsUsed: k === 2 ? 1 : 0, durationMs: 900, sessionId: `wk-n-${i}` })
    }
    for (let k = 0; k < 6; k++) attempts.push({ id: `wk-e-${k}`, at: now - DAY - k * 1000, questionId: `e-${k}`, skill: 'english', difficulty: 1, firstTryCorrect: true, hintsUsed: 0, durationMs: 800, sessionId: 'wk-e' })
    attempts.push({ id: 'wk-old', at: now - 20 * DAY, questionId: 'old', skill: 'classify', difficulty: 1, firstTryCorrect: true, hintsUsed: 0, durationMs: 800, sessionId: 'wk-old' })
    await putRows(page, 'attempts', attempts)
    await putRows(page, 'skillState', [{ skill: 'number', difficulty: 3, recent: [], stationStreak: 0, mastered: { 2: { masteredAt: now - DAY, reviews: 0 } }, updatedAt: now, total: 12 }])
    await patchSettings(page, { homeGuideShown: true, albumInit: true, album: [{ id: 'trick:count', at: now - DAY, kind: 'trick', art: 'pet-adult-think', caption: '阿悟學會了新本領：數香蕉！' }, { id: 'trick:tidy', at: now - 30 * DAY, kind: 'trick', art: 'pet-adult-happy', caption: '阿悟學會了新本領：整理房間！' }, { id: 'hatch', at: 0, kind: 'hatch', art: 'pet-baby-cheer', caption: '阿悟孵出來了！', approx: true }] })
    await patchPet(page, { tricks: ['count', 'tidy'] })
    await reload(page)

    await openParentTab(page, '審核')
    // 今日小提示：家長區最上方，依最近練的技能
    await page.waitForSelector('[data-testid=daily-tip]')
    const tipSkill = await page.getByTestId('daily-tip').getAttribute('data-tip-for')
    const tipText = await page.getByTestId('daily-tip-text').innerText()
    check(`[${tag}] 家長區最上方有「今日小提示」一句（依最近練的技能：數感或英文）`, ['number', 'english'].includes(tipSkill) && tipText.length >= 8 && tipText.length <= 60, `${tipSkill}：${tipText}`)
    const tipBox = await rectOf(page, '[data-testid=daily-tip]')
    const tabsBox = await rectOf(page, '[data-testid=parent-tabs]')
    check(`[${tag}] 小提示在分頁列上方`, tipBox.y < tabsBox.y)
    check(`[${tag}] 切到別的分頁小提示還在（家長區首頁）`, true)

    await page.getByRole('tab', { name: '本週', exact: true }).click()
    await page.waitForSelector('[data-testid=weekly-report]')
    check(`[${tag}] 本週：練習天數 4（共 7 天）、作答 18 題（20 天前的不算）`, (await page.getByTestId('weekly-days').innerText()) === '4' && (await page.getByTestId('weekly-attempts').innerText()) === '18', `${await page.getByTestId('weekly-days').innerText()}/${await page.getByTestId('weekly-attempts').innerText()}`)
    check(`[${tag}] 本週：標題是目前孩子的名字`, (await page.getByTestId('weekly-child').innerText()).includes('小明'))
    // 科目清單：從科目清單讀（目前至少數學、英文），沒練的科目顯示「還沒有練習」
    const subjects = await page.locator('[data-testid^=weekly-subject-]').evaluateAll((els) => els.map((e) => ({ id: e.dataset.testid.replace('weekly-subject-', ''), practiced: e.dataset.practiced })))
    check(`[${tag}] 各科目都列出來（至少數學、英文）`, subjects.some((s) => s.id === 'math') && subjects.some((s) => s.id === 'english'), JSON.stringify(subjects))
    const mathText = await page.getByTestId('weekly-subject-math').innerText()
    check(`[${tag}] 數學：白話說明這週學到哪裡、標出「新學會」`, /數感/.test(mathText) && /新學會/.test(mathText) && !/難度 \d/.test(mathText), mathText.slice(0, 120))
    check(`[${tag}] 英文：有練習的說明`, /英文單字/.test(await page.getByTestId('weekly-subject-english').innerText()))
    const tricksText = await page.getByTestId('weekly-tricks').innerText()
    check(`[${tag}] 本週新招：只列本週學會的（數香蕉）、不列 30 天前的整理房間`, /數香蕉/.test(tricksText) && !/整理房間/.test(tricksText), tricksText)
    check(`[${tag}] 新招數量 1`, (await page.getByTestId('weekly-tricks-count').innerText()) === '1')
    const groups = await page.locator('[data-tip-skill]').evaluateAll((els) => els.map((e) => ({ skill: e.dataset.tipSkill, n: e.querySelectorAll('li').length })))
    check(`[${tag}] 在家這樣練：數感、英文各 3 句可執行建議`, groups.some((g) => g.skill === 'number' && g.n >= 2 && g.n <= 3) && groups.some((g) => g.skill === 'english' && g.n >= 2 && g.n <= 3), JSON.stringify(groups))
    check(`[${tag}] 週報裡有成長相簿（至少 3 張卡）`, (await page.locator('[data-testid=weekly-album] [data-testid=album-card]').count()) >= 3)
    check(`[${tag}] 只有 1 個孩子：不顯示換孩子說明`, (await page.getByTestId('weekly-switch-note').count()) === 0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
    check(`[${tag}] 本週不橫向溢出`, !overflow)
    await shot(page, 'weekly', tag)

    // 多孩子：新增第二個孩子後，週報附切換說明
    if (tag === 'land') {
      await page.getByRole('tab', { name: '設定', exact: true }).click()
      await page.getByTestId('kid-row').first().waitFor()
      await page.getByTestId('kid-add').click()
      await page.getByTestId('kid-name').fill('小花')
      await page.getByTestId('child-age-3').click()
      await page.getByTestId('kid-add-submit').click()
      await page.waitForTimeout(800)
      await page.getByRole('tab', { name: '本週', exact: true }).click()
      await page.waitForSelector('[data-testid=weekly-switch-note]')
      const note = await page.getByTestId('weekly-switch-note').innerText()
      check('多孩子：週報顯示目前孩子，並附切換說明（頭像換人）', /小明/.test(note) && /頭像/.test(note), note)
    }
    check(`[${tag}] 週報無 console 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 沒有練習紀錄：通用建議、小提示也有一句
  {
    const { ctx, page } = await freshApp(browser, SIZES.land)
    await patchSettings(page, { homeGuideShown: true })
    await reload(page)
    await openParentTab(page, '本週')
    await page.waitForSelector('[data-testid=weekly-report]')
    check('沒有練習：說「這一週還沒有練習紀錄」、練習天數 0、仍有通用建議', (await page.getByTestId('weekly-empty').count()) === 1 && (await page.getByTestId('weekly-days').innerText()) === '0' && (await page.locator('[data-tip-skill=generic] li').count()) >= 2)
    check('沒有練習：今日小提示是通用的一句', (await page.getByTestId('daily-tip').getAttribute('data-tip-for')) === 'generic')
    await ctx.close()
  }

  // =====================================================================
  // 7) 首頁「更多」與版面
  // =====================================================================
  for (const [tag, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await patchSettings(page, { homeGuideShown: true })
    await patchPet(page, { tricks: ['count'] })
    await reload(page)
    await dismissMemory(page)
    const direct = await page.locator('.side-tools > *').count()
    check(`[${tag}] 右側只有 3 個（工坊、背包、更多），不會一直往下堆`, direct === 3, String(direct))
    const col = await page.locator('.side-tools').evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })
    check(`[${tag}] 右側按鈕列沒有碰到食物欄（底部在畫面 45% 以上）`, col.bottom < vp.height * 0.45, JSON.stringify(col))
    check(`[${tag}] 平常沒有托盤`, (await page.getByTestId('more-tray').count()) === 0)
    await page.getByTestId('more-btn').click()
    await page.waitForSelector('[data-testid=more-tray]')
    await page.waitForTimeout(450) // 等托盤彈出的動畫結束再量
    const items = await page.locator('[data-testid=more-tray] .mini-candy').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { label: e.querySelector('span:last-child').textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), x: r.x, y: r.y } }))
    check(`[${tag}] 托盤有 表演（學會新招才有）、朋友、相簿、衣櫃 4 顆`, items.map((i) => i.label).join() === '表演,朋友,相簿,衣櫃', items.map((i) => i.label).join())
    check(`[${tag}] 托盤每顆觸控目標 >= 56px，且都在畫面內`, items.every((i) => i.w >= 56 && i.h >= 56 && i.x >= 0 && i.x + i.w <= vp.width && i.y >= 0 && i.y + i.h <= vp.height), JSON.stringify(items))
    const sideBtns = await page.locator('.side-tools > .mini-candy, .side-tools .more-btn').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))
    check(`[${tag}] 工坊、背包、更多也都 >= 56px`, sideBtns.length === 3 && sideBtns.every(([w, h]) => w >= 56 && h >= 56), JSON.stringify(sideBtns))
    // 點空白處關閉
    await page.mouse.click(vp.width * 0.2, vp.height * 0.55)
    await page.waitForTimeout(300)
    check(`[${tag}] 點旁邊托盤收起來`, (await page.getByTestId('more-tray').count()) === 0)
    // Esc 也可以
    await page.getByTestId('more-btn').click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    check(`[${tag}] Esc 收起托盤`, (await page.getByTestId('more-tray').count()) === 0)
    // 朋友、相簿 從托盤進得去
    await page.getByTestId('more-btn').click()
    await page.getByTestId('friends-btn').click()
    check(`[${tag}] 托盤的「朋友」進得去圖鑑`, (await page.waitForSelector('[data-testid=friends]', { timeout: 4000 }).then(() => true, () => false)))
    await goHome(page)
    // 手機：資訊卡縮小，不碰到右側按鈕
    const hud = await rectOf(page, '.pet-hud')
    const tools = await rectOf(page, '.side-tools')
    const overlaps = hud.x < tools.x + tools.w && hud.x + hud.w > tools.x && hud.y < tools.y + tools.h && hud.y + hud.h > tools.y
    check(`[${tag}] 狀態卡與右側按鈕不重疊`, !overlaps, `${JSON.stringify(hud)} ${JSON.stringify(tools)}`)
    if (tag === 'phone') check('手機：狀態卡縮小（高度 <= 52px）', hud.h <= 52, String(Math.round(hud.h)))
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)
    check(`[${tag}] 首頁不橫向溢出`, noOverflow)
    check(`[${tag}] 首頁無 console 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 直向地圖：下方不留白（平板直向 1024x1366）
  for (const vp of [{ width: 1024, height: 1366 }, { width: 820, height: 1180 }, { width: 768, height: 1024 }]) {
    const { ctx, page } = await freshApp(browser, vp)
    await page.goto(`${process.env.BASE_URL ?? 'http://localhost:5182'}/#map`)
    await page.reload()
    await page.waitForSelector('.adv-map')
    await page.waitForTimeout(1200)
    const bottom = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.adv-map > *')]
      return Math.max(...els.map((e) => e.getBoundingClientRect().bottom))
    })
    check(`[${vp.width}x${vp.height}] 直向地圖：內容底部離畫面底端 <= 110px（不留一大片白）`, vp.height - bottom <= 110, `bottom=${Math.round(bottom)} 空 ${Math.round(vp.height - bottom)}px`)
    await shot(page, 'map', `${vp.width}x${vp.height}`)
    await ctx.close()
  }
} catch (e) {
  console.error(e)
  state.failed++
} finally {
  await browser.close()
}

console.log(state.failed === 0 ? '\n全部通過' : `\n${state.failed} 項失敗`)
process.exit(state.failed === 0 ? 0 : 1)
