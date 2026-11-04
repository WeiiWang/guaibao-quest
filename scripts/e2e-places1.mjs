// v8.2 線 S E2E：商店、工坊、背包、任務變成「地方」：背景、寵物在場、三尺寸不溢出不蓋按鈕、點商品有反應、
// 錢與材料不夠用溫和的灰、任務流程不變、招呼一次開啟只說一次、空狀態不被招呼蓋掉。
// 用法：先啟動 dev server（pnpm dev --port 5183 --strictPort），再
//   BASE_URL=http://localhost:5183 node scripts/e2e-places1.mjs     （或 pnpm e2e:places1；E2E_BROWSER=webkit 改用 WebKit）
import { readFileSync } from 'node:fs'
import { freshApp, idb, IS_WEBKIT, launch, makeChecker } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const MANIFEST = JSON.parse(readFileSync(new URL('../public/voice/manifest.json', import.meta.url), 'utf8'))

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
const all = (page, t) => idb(page, (db, t) => new Promise((r) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => r(e.target.result))), t)
const giveStars = (page, n) => putRows(page, 'ledger', [{ id: `places1-${n}`, at: Date.now(), delta: n, reason: 'e2e', kind: 'bonus' }])
const reload = async (page) => {
  await page.reload()
  await page.waitForSelector('[data-testid=room]')
}

const NAV = { shop: '.candy.peach', tasks: '.candy.butter', bag: '.mini-candy.bubblegum', workshop: '.mini-candy.butter' }
const READY = { shop: '[data-testid=shop-grid-food] > li', tasks: '[data-testid=task-board]', bag: '[data-testid=bag]', workshop: '.ws-card' }
const enter = async (page, name) => {
  const back = page.locator('.screen-header .back')
  if (await back.count()) await back.first().click()
  await page.waitForSelector('[data-testid=room]')
  await page.locator(NAV[name]).first().click()
  await page.waitForSelector(READY[name], { state: 'attached' })
  await page.waitForTimeout(350)
}

/** 目前畫面：背景、寵物、橫向溢出、寵物有沒有蓋到按鈕（只算露在畫面裡、最上層真的是寵物的點） */
const inspect = (page) =>
  page.evaluate(() => {
    const backdrop = document.querySelector('[data-testid=place-backdrop] > div')
    const pet = document.querySelector('[data-testid=place-pet]')?.getBoundingClientRect()
    const wrap = document.querySelector('.place-backdrop')
    const covered = []
    if (pet) {
      for (const b of document.querySelectorAll('main button:not(.companion), main [role=tab]')) {
        const q = b.getBoundingClientRect()
        if (!q.width || !q.height) continue
        const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2)
        if (hit?.closest('[data-testid=place-pet]')) covered.push(b.textContent.trim().slice(0, 12))
      }
    }
    return {
      place: wrap?.getAttribute('data-place') ?? null,
      bg: backdrop?.style.backgroundImage ?? '',
      first: document.querySelector('main')?.firstElementChild?.getAttribute('data-testid') ?? null,
      mainClass: document.querySelector('main')?.className ?? '',
      overflow: document.documentElement.scrollWidth - innerWidth,
      pet: pet ? { w: pet.width, h: pet.height, left: pet.left, right: pet.right, top: pet.top, bottom: pet.bottom } : null,
      companion: !!document.querySelector('[data-testid=place-pet] [data-testid=companion]'),
      covered,
    }
  })

const bgLoaded = (page, id) =>
  page.evaluate(async (id) => {
    const r = await fetch(`art/scene-place-${id}.jpg`).catch(() => null)
    return !!r && r.ok && (r.headers.get('content-type') ?? '').includes('image')
  }, id)

async function testScreens(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await giveStars(page, 40)
    await putRows(page, 'materialLedger', [{ id: 'places1-w', at: Date.now(), material: 'wood', delta: 4, kind: 'station', reason: 'e2e' }])
    await reload(page)
    for (const [name, place] of [['shop', 'shop'], ['workshop', 'workshop'], ['bag', 'bag'], ['tasks', 'tasks']]) {
      await enter(page, name)
      const i = await inspect(page)
      check(`[${size} ${name}] 背景是第一個子元素、place 正確`, i.first === 'place-backdrop' && i.place === place && i.bg.includes(`scene-place-${place}.jpg`), JSON.stringify([i.first, i.place, i.bg]))
      check(`[${size} ${name}] 背景圖抓得到`, await bgLoaded(page, place))
      check(`[${size} ${name}] 主題色留著當缺圖底色`, /theme-/.test(i.mainClass) && /\bplace\b/.test(i.mainClass), i.mainClass)
      check(`[${size} ${name}] 寵物在場（Companion）`, i.companion && i.pet && i.pet.w >= 70, JSON.stringify(i.pet))
      check(`[${size} ${name}] 沒有橫向溢出`, i.overflow <= 0, String(i.overflow))
      check(`[${size} ${name}] 寵物沒蓋到按鈕`, i.covered.length === 0, i.covered.join())
      if (size === 'land') check(`[${size} ${name}] 橫向：寵物站在左下角`, i.pet.left < 40 && i.pet.bottom >= vp.height - 30, JSON.stringify(i.pet))
      if (size !== 'land') check(`[${size} ${name}] 直向與手機：寵物小一點`, i.pet.w <= 140, String(i.pet.w))
    }
    // 捲到底：寵物一樣不蓋按鈕（工坊 24 件最長）
    await enter(page, 'workshop')
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(150)
    const end = await inspect(page)
    check(`[${size}] 工坊捲到底：沒有按鈕被寵物蓋住`, end.covered.length === 0, end.covered.join())
    check(`[${size}] 無 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

async function testShop(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp, { bananas: 0 })
    await giveStars(page, 7)
    await reload(page)
    await enter(page, 'shop')
    const balance = async () => (await all(page, 'ledger')).reduce((n, l) => n + l.delta, 0)
    const before = await balance()

    // 點普通商品：泡泡出現那個東西、開心；沒有跳；沒有買
    const plain = page.locator('[data-testid=shop-grid-food] > li:not(.favorite)').first()
    const plainId = (await plain.getAttribute('data-testid')).replace('shop-', '')
    await plain.locator('[data-testid=shop-look]').click()
    await page.waitForSelector('[data-testid=pet-bubble]')
    check(`[${size}] 點商品：泡泡裡是那個東西`, (await page.getByTestId('pet-bubble').getAttribute('data-item')) === plainId)
    check(`[${size}] 點商品：泡泡裡看得到圖`, (await page.locator('[data-testid=pet-bubble] img, [data-testid=pet-bubble] .art-emoji').count()) >= 1)
    check(`[${size}] 點商品：寵物換開心`, (await page.locator('[data-testid=place-pet] [data-testid=companion]').getAttribute('data-pose')) === 'happy')
    const bubble = await page.getByTestId('pet-bubble').boundingBox()
    check(`[${size}] 泡泡整個在畫面裡`, bubble.x >= 0 && bubble.y >= 0 && bubble.x + bubble.width <= vp.width && bubble.y + bubble.height <= vp.height, JSON.stringify(bubble))
    check(`[${size}] 普通商品寵物不跳`, (await page.locator('.pl-spot-pet-in').getAttribute('data-hop')) === '0')
    check(`[${size}] 點商品不等於買：點數與背包沒變`, (await balance()) === before && !(await all(page, 'inventory')).some((v) => v.itemId === plainId && v.qty > 0))
    // 泡泡自己會收掉，寵物回到平常
    await page.waitForSelector('[data-testid=pet-bubble]', { state: 'detached', timeout: 4000 })
    check(`[${size}] 一下子之後泡泡收掉、姿勢回去`, (await page.locator('[data-testid=place-pet] [data-testid=companion]').getAttribute('data-pose')) === 'idle')

    // 點卡片別的地方（紙標籤）也算；今天最喜歡的食物會跳，連點會再跳
    const fav = page.locator('.shop-item.favorite')
    await fav.locator('.pl-shop-tag').click()
    await page.waitForSelector('[data-testid=pet-bubble]')
    check(`[${size}] 最喜歡的食物：寵物跳一下`, (await page.locator('.pl-spot-pet-in').getAttribute('data-hop')) === '1')
    const anim = await page.locator('.pl-spot-pet-in').evaluate((e) => getComputedStyle(e).animationName)
    check(`[${size}] 跳的動畫真的掛上去`, /pl-spot-hop/.test(anim), anim)
    await fav.locator('[data-testid=shop-look]').click()
    check(`[${size}] 再點一次再跳一次`, (await page.locator('.pl-spot-pet-in').getAttribute('data-hop')) === '2')

    // 按「買」：買得到，但這不是「點商品」，不會多跳一次（買不起的是 disabled）
    const hopBefore = await page.locator('.pl-spot-pet-in').getAttribute('data-hop')
    const carrot = page.locator('[data-testid=shop-carrot]')
    await carrot.locator('[data-testid=buy-btn]').click()
    await page.waitForSelector('[data-testid=undo-buy]')
    check(`[${size}] 按買：扣點、進背包`, (await balance()) < before && (await all(page, 'inventory')).some((v) => v.itemId === 'carrot' && v.qty === 1))
    check(`[${size}] 按買不會觸發寵物跳`, (await page.locator('.pl-spot-pet-in').getAttribute('data-hop')) === hopBefore)

    // 錢不夠：灰色、字留著、不是粉紅
    const cake = page.locator('[data-testid=shop-cake] [data-testid=buy-btn]')
    const look = await cake.evaluate((b) => {
      const s = getComputedStyle(b)
      return { bg: s.backgroundImage, color: s.color, op: s.opacity, filter: s.filter, dis: b.disabled, text: b.innerText }
    })
    const rgb = [...look.bg.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(',').map(Number))
    const pinkish = rgb.some(([r, g, b]) => r - g > 25 && r - b > 10)
    check(`[${size}] 錢不夠：按鈕是溫和的灰，不是紅或粉紅`, rgb.length > 0 && !pinkish && look.op === '1', JSON.stringify(look))
    check(`[${size}] 錢不夠：文字還在、按不了`, /^還差 \d+ 點$/.test(look.text) && look.dis, look.text)
    check(`[${size}] 無 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

async function testWorkshop(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await putRows(page, 'materialLedger', [{ id: 'places1-w', at: Date.now(), material: 'wood', delta: 4, kind: 'station', reason: 'e2e' }, { id: 'places1-s', at: Date.now(), material: 'stone', delta: 1, kind: 'station', reason: 'e2e' }])
    await reload(page)
    await enter(page, 'workshop')
    const gray = await page.evaluate(() => {
      const pinkish = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/)
        if (!m) return false
        const [r, g, b] = m[1].split(',').map(Number)
        return r - g > 25 && r - b > 10
      }
      const sel = '[data-testid=craft-decor-rocket]'
      const item = document.querySelector(`${sel} .ws-gap-item`)
      const short = document.querySelector(`${sel} .ws-cost-item.short`)
      return {
        gap: getComputedStyle(item).backgroundColor,
        num: getComputedStyle(item.querySelector('b')).color,
        short: getComputedStyle(short).backgroundColor,
        pink: [getComputedStyle(item).backgroundColor, getComputedStyle(item.querySelector('b')).color, getComputedStyle(short).backgroundColor].some(pinkish),
      }
    })
    check(`[${size}] 材料不夠：缺口與短缺都不是粉紅`, !gray.pink, JSON.stringify(gray))
    await page.locator('[data-testid=craft-decor-clock] [data-testid=craft-btn]').click()
    await page.waitForSelector('[data-testid=craft-done]')
    const top = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=craft-done-go]').getBoundingClientRect()
      return document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)?.closest('[data-testid=craft-done-go]') != null
    })
    check(`[${size}] 做好的大圖蓋在寵物與分頁上面，按鈕按得到`, top)
    await page.getByTestId('craft-done-close').click()
    check(`[${size}] 無 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

async function testBag(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp, { bananas: 0 })
    await enter(page, 'bag')
    await page.waitForSelector('[data-testid=bag-empty-food]')
    const e = await page.evaluate(() => {
      const pet = document.querySelector('.j74-empty-pet')?.getBoundingClientRect()
      const btn = document.querySelector('[data-testid=bag-empty-food-go]')?.getBoundingClientRect()
      const line = document.querySelector('.j74-empty-line')?.getBoundingClientRect()
      const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
      return {
        pets: document.querySelectorAll('[data-testid=place-pet]').length,
        crate: document.querySelectorAll('.pl-bag-emptyroom .pl-bag-slot').length,
        petW: pet?.width ?? 0,
        hit: !!pet && !!btn && !!line && (overlap(pet, btn) || overlap(pet, line)),
        over: document.documentElement.scrollWidth - innerWidth,
        btnTop: document.elementFromPoint(btn.left + btn.width / 2, btn.top + btn.height / 2)?.closest('[data-testid=bag-empty-food-go]') != null,
      }
    })
    check(`[${size}] 空狀態：只有一隻寵物（不會同時出現 Companion）`, e.pets === 0 && e.petW >= 100, JSON.stringify(e))
    check(`[${size}] 空狀態：空木箱還在`, e.crate === 8, String(e.crate))
    check(`[${size}] 空狀態：寵物不蓋字與按鈕、按鈕按得到、不溢出`, !e.hit && e.btnTop && e.over <= 0, JSON.stringify(e))
    // 分頁都還能切；有東西就是木箱格子
    await putRows(page, 'inventory', [{ id: 'banana', itemId: 'banana', qty: 3 }])
    await reload(page)
    await enter(page, 'bag')
    const crate = await page.evaluate(() => ({
      items: document.querySelectorAll('[data-testid=bag-grid-food] .shop-item').length,
      slots: document.querySelectorAll('[data-testid=bag-grid-food] .pl-bag-slot').length,
      flash: !!document.querySelector('[data-testid^=bag-empty]'),
    }))
    check(`[${size}] 有東西：香蕉一格、其餘是空格子、沒有空狀態`, crate.items === 1 && crate.slots === 7 && !crate.flash, JSON.stringify(crate))
    for (const t of ['material', 'hat', 'sticker', 'furniture', 'food']) {
      await page.getByTestId(`bag-tab-${t}`).click()
      await page.waitForTimeout(120)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      check(`[${size}] 分頁 ${t}：可切換、不溢出`, (await page.locator(`[data-testid=bag-grid-${t}], [data-testid=bag-empty-${t}]`).count()) === 1 && over <= 0, String(over))
    }
    check(`[${size}] 無 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

async function testTasks(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await enter(page, 'tasks')
    await page.waitForSelector('[data-testid=task-submit]')
    const look = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.pl-task-list > .task')]
      return {
        n: cards.length,
        tilts: cards.map((c) => getComputedStyle(c).transform),
        pin: getComputedStyle(cards[0], '::before').content !== 'none',
        bg: getComputedStyle(cards[0]).backgroundImage,
      }
    })
    check(`[${size}] 卡片釘在板上：有圖釘、每張都微傾`, look.n >= 2 && look.pin && look.tilts.every((t) => t !== 'none'), JSON.stringify(look.tilts))
    // 固定角度：重新整理一樣
    await reload(page)
    await enter(page, 'tasks')
    await page.waitForSelector('[data-testid=task-submit]')
    const tilts2 = await page.evaluate(() => [...document.querySelectorAll('.pl-task-list > .task')].map((c) => getComputedStyle(c).transform))
    check(`[${size}] 角度固定（不用亂數）`, JSON.stringify(tilts2) === JSON.stringify(look.tilts))

    // 流程不變：送出 → 等爸媽 → 收回 → 再送出
    const first = page.locator('.pl-task-list > .task').first()
    await first.locator('[data-testid=task-submit]').click()
    await page.waitForSelector('[data-testid=task-withdraw]')
    const statuses = async () => (await all(page, 'instances')).map((i) => i.status)
    check(`[${size}] 我做完了 → 送家長審核（pending），還沒有拿到點數`, (await statuses()).filter((s) => s === 'pending').length === 1 && (await all(page, 'ledger')).every((l) => !l.reason.startsWith('完成任務')))
    check(`[${size}] 卡片顯示等爸媽確認`, (await page.locator('.task.pending .status-pill.wait').innerText()) === '等爸媽確認')
    const wb = await page.getByTestId('task-withdraw').boundingBox()
    check(`[${size}] 收回鈕夠大（≥56）`, wb.height >= 56, JSON.stringify(wb))
    await page.getByTestId('task-withdraw').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=task-withdraw]').length === 0)
    check(`[${size}] 收回 → 回到待辦`, !(await statuses()).includes('pending'))

    // 做完：蓋章（字還在、章在紙裡）
    const inst = await all(page, 'instances')
    await putRows(page, 'instances', [{ ...inst[0], status: 'approved' }])
    await reload(page)
    await enter(page, 'tasks')
    await page.waitForSelector('.task.approved .status-pill.done')
    const stamp = await page.evaluate(() => {
      const s = document.querySelector('.task.approved .status-pill.done')
      const r = s.getBoundingClientRect()
      const c = s.closest('.task').getBoundingClientRect()
      const title = s.closest('.task').querySelector('.task-title').getBoundingClientRect()
      const cs = getComputedStyle(s)
      return { text: s.textContent, radius: cs.borderTopLeftRadius, transform: cs.transform, inCard: r.left >= c.left - 4 && r.right <= c.right + 4 && r.top >= c.top - 4 && r.bottom <= c.bottom + 4, overTitle: r.left < title.right && title.left < r.right && r.top < title.bottom && title.top < r.bottom, w: r.width }
    })
    check(`[${size}] 做完：蓋一個圓章（文字保留、微傾、在紙裡、不壓標題）`, stamp.text === '完成 ✓' && stamp.radius === '50%' && stamp.transform !== 'none' && stamp.inCard && !stamp.overTitle, JSON.stringify(stamp))
    check(`[${size}] 無 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 沒有任務：一張釘著的紙，文案不變
  const { ctx, page } = await freshApp(browser, SIZES.land)
  await idb(
    page,
    (db) =>
      new Promise((r) => {
        const tx = db.transaction(['templates', 'instances'], 'readwrite')
        tx.objectStore('instances').clear()
        const st = tx.objectStore('templates')
        st.getAll().onsuccess = (e) => e.target.result.forEach((t) => st.put({ ...t, active: false }))
        tx.oncomplete = () => r(1)
      }),
  )
  await reload(page)
  await enter(page, 'tasks')
  await page.waitForSelector('.pl-task-empty')
  check('沒有任務：文案不變', (await page.locator('.pl-task-empty').innerText()) === '今天沒有任務，好好玩吧！')
  await ctx.close()
}

/** 招呼：只播預錄音檔、一次開啟每個地方一句、沒開旗標不說、不用機器聲 */
async function testGreeting(browser) {
  const fresh = async () => {
    const r = await freshApp(browser, SIZES.land, { bananas: 3 })
    await r.ctx.addInitScript(() => {
      localStorage.setItem('gq-voice-pack-test', '1')
      window.__plays = []
      window.__spoken = []
      const p = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function (...a) {
        window.__plays.push(this.src)
        return p.apply(this, a)
      }
      const s = window.speechSynthesis
      if (s) {
        const f = s.speak.bind(s)
        s.speak = (u) => {
          window.__spoken.push(u.text)
          return f(u)
        }
      }
    })
    return r
  }
  const fileOf = (place) => MANIFEST[`pet.place.${place}`]?.file
  const plays = (page, place) => page.evaluate((f) => window.__plays.filter((u) => u.endsWith(f)).length, fileOf(place))

  // 開旗標：每個地方進兩次都只說一次
  {
    const { ctx, page } = await fresh()
    await page.evaluate(() => localStorage.setItem('gq-place-test', '1'))
    await reload(page)
    await page.mouse.click(5, 5) // 解鎖音訊（WebKit、Chromium 都要一次手勢）
    for (const place of ['shop', 'workshop', 'bag', 'tasks']) {
      check(`招呼語音檔存在：${place}`, !!fileOf(place))
      await enter(page, place)
      await page.waitForTimeout(800)
      check(`招呼：第一次進${place}說一次`, (await plays(page, place)) === 1, String(await plays(page, place)))
      await enter(page, place)
      await page.waitForTimeout(800)
      check(`招呼：再進${place}不再說`, (await plays(page, place)) === 1, String(await plays(page, place)))
    }
    const robot = await page.evaluate(() => window.__spoken)
    const lines = ['shop', 'workshop', 'bag', 'tasks'].map((x) => MANIFEST[`pet.place.${x}`]?.text)
    check('招呼：沒有用機器聲唸招呼', !robot.some((t) => lines.includes(t)), robot.join())
    await ctx.close()
  }
  // 沒開旗標：自動化環境不說（既有 e2e 的語音紀錄不受影響）
  {
    const { ctx, page } = await fresh()
    await reload(page)
    await page.mouse.click(5, 5)
    await enter(page, 'shop')
    await page.waitForTimeout(800)
    check('招呼：沒開 gq-place-test 不說', (await plays(page, 'shop')) === 0)
    await ctx.close()
  }
  // 背包空狀態會唸自己的話：招呼不能把它蓋掉；有東西才打招呼（一進來也不會閃過「還沒有食物」）
  {
    const { ctx, page } = await freshApp(browser, SIZES.land, { bananas: 0 })
    await ctx.addInitScript(() => {
      localStorage.setItem('gq-voice-pack-test', '1')
      window.__plays = []
      const p = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function (...a) {
        window.__plays.push(this.src)
        return p.apply(this, a)
      }
    })
    await page.evaluate(() => localStorage.setItem('gq-place-test', '1'))
    await reload(page)
    await page.mouse.click(5, 5)
    await enter(page, 'bag')
    await page.waitForSelector('[data-testid=bag-empty-food]')
    await page.waitForTimeout(800)
    check('背包空的：不打招呼，不蓋掉空狀態那句', (await plays(page, 'bag')) === 0)
    await putRows(page, 'inventory', [{ id: 'banana', itemId: 'banana', qty: 2 }])
    await reload(page)
    await page.mouse.click(5, 5)
    const emptyFile = MANIFEST['pet.empty.food']?.file
    await enter(page, 'bag')
    await page.waitForTimeout(800)
    check('背包有東西：打招呼', (await plays(page, 'bag')) === 1)
    check('背包有東西：不會唸「還沒有食物」', !!emptyFile && (await page.evaluate((f) => window.__plays.filter((u) => u.endsWith(f)).length, emptyFile)) === 0)
    await ctx.close()
  }
}

/** 減少動態：跳與泡泡的動畫都關掉 */
async function testReducedMotion(browser) {
  const { ctx, page } = await freshApp(browser, SIZES.land, { ctxOpts: { reducedMotion: 'reduce' } })
  await giveStars(page, 7)
  await reload(page)
  await enter(page, 'shop')
  await page.locator('.shop-item.favorite [data-testid=shop-look]').click()
  await page.waitForSelector('[data-testid=pet-bubble]')
  const r = await page.evaluate(() => ({
    hop: getComputedStyle(document.querySelector('.pl-spot-pet-in')).animationName,
    bubble: getComputedStyle(document.querySelector('[data-testid=pet-bubble]')).animationName,
  }))
  check('減少動態：跳與泡泡不動', r.hop === 'none' && r.bubble === 'none', JSON.stringify(r))
  await ctx.close()
}

const browser = await launch()
console.log(`瀏覽器：${IS_WEBKIT ? 'WebKit' : 'Chromium'}`)
await testScreens(browser)
await testShop(browser)
await testWorkshop(browser)
await testBag(browser)
await testTasks(browser)
await testGreeting(browser)
await testReducedMotion(browser)
await browser.close()
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
