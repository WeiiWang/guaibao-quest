// v8.3 線 V E2E：點心屋、小菜園。
// 三種尺寸、不橫向溢出、觸控目標、點心三步走完、裝飾拖入拖出、禮物只送一次、
// 菜園種下 / 澆水 / 隔天再澆（用 ctx.clock 換日，真的經過畫面）/ 收成進背包、重開頁面資料還在、計時器清乾淨、台詞在對的時機說。
// 用法：先啟動 dev server（pnpm dev --port 5213 --strictPort），再
//   BASE_URL=http://localhost:5213 node scripts/e2e-play-v.mjs       （或 pnpm e2e:play-v；E2E_BROWSER=webkit 改用 WebKit）
//   想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-play-v.mjs（不要放 repo 裡）
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, getPet, idb, IS_WEBKIT, launch, makeChecker, touchSender } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const SHOT_DIR = process.env.SHOT_DIR
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
const browserTag = IS_WEBKIT ? 'webkit' : 'chromium'
const shot = async (page, name) => {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}-${browserTag}.png` })
}
const here = dirname(fileURLToPath(import.meta.url))
const DAY = 24 * 60 * 60 * 1000
const T0 = new Date(2026, 10, 4, 10, 0, 0).getTime()
const TOUCH = { ctxOpts: { hasTouch: true } }

/** 手指：接觸面積像真機（約 50px 寬） */
const FINGER = { radiusX: 25, radiusY: 25, force: 0.5 }
const pt = (p, id = 0) => ({ x: p.x, y: p.y, id, ...FINGER })
const sleep = (page, ms) => page.waitForTimeout(ms)
const centerOf = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}
const fingerDrag = async (send, from, to, { steps = 8, end = 'touchEnd' } = {}) => {
  await send('touchStart', [pt(from)])
  for (let i = 1; i <= steps; i++) await send('touchMove', [pt({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps })])
  await send(end, [])
}
const fingerTap = async (send, at) => {
  await send('touchStart', [pt(at)])
  await send('touchEnd', [])
}
const noOverflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const gameHash = async (page, id) => {
  await page.evaluate((id) => (location.hash = `game/${id}`), id)
  await page.waitForSelector(`[data-testid=play-${id}]`)
  await sleep(page, 200)
}
/** 畫面上所有按鈕的觸控目標 ≥ 56，回傳不合格的 */
const smallTargets = (page) =>
  page.evaluate(() => {
    const out = []
    for (const b of document.querySelectorAll('[data-testid^=play-] button')) {
      const r = b.getBoundingClientRect()
      if (r.width && (r.width < 55.5 || r.height < 55.5)) out.push(`${b.dataset.testid ?? b.className} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    return out
  })
/** 這些元素都在畫面內 */
const allInside = (page, sel) =>
  page.evaluate((sel) => {
    const bad = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) bad.push(el.dataset.testid ?? el.className)
    }
    return bad
  }, sel)
/** 兩組元素有沒有重疊 */
const overlaps = (page, a, b) =>
  page.evaluate(
    ([a, b]) => {
      const out = []
      for (const x of document.querySelectorAll(a))
        for (const y of document.querySelectorAll(b)) {
          const p = x.getBoundingClientRect()
          const q = y.getBoundingClientRect()
          if (p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1) out.push(`${x.dataset.testid ?? x.className}×${y.dataset.testid ?? y.className}`)
        }
      return out
    },
    [a, b],
  )
const decoCount = (page) => page.locator('[data-testid=bake-deco]:not([data-leaving])').count()
const inventory = (page) => idb(page, (db) => new Promise((r) => (db.transaction('inventory').objectStore('inventory').getAll().onsuccess = (e) => r(Object.fromEntries(e.target.result.map((x) => [x.id, x.qty]))))))
const settings = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
/** 底層 GameShell 的禮物卡把 Companion（button）放在 button 裡，React dev 會警告；這是所有玩法共通的底層問題，不是這條線的，先濾掉、回報 */
const realErrors = (errors) => errors.filter((e) => !(/validateDOMNesting/.test(e) && /GameShell/.test(e)))
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

/** 點心屋：三步走完 + 裝飾的各種拖法。每個尺寸一種底座 */
async function testBakery(b, name, vp, baseId) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `點心[${name}]`
  // 遊樂場的每一格中心都點得到（寵物不能擋住）
  await page.evaluate(() => (location.hash = 'playground'))
  await page.waitForSelector('[data-testid=playground-grid]')
  await sleep(page, 500)
  const covered = await page.evaluate(() =>
    [...document.querySelectorAll('.pg-tile')]
      .filter((t) => {
        const q = t.getBoundingClientRect()
        return !t.contains(document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2))
      })
      .map((t) => t.dataset.testid),
  )
  check(`${tag} 遊樂場每一格都點得到`, covered.length === 0, covered.join())
  await gameHash(page, 'bakery')
  check(`${tag} 三張底座`, (await page.locator('[data-testid^=bake-base-]').count()) === 3)
  check(`${tag} 底座夠大`, (await page.locator(`[data-testid=bake-base-${baseId}]`).boundingBox()).width >= 96)
  check(`${tag} 選底座：不橫向溢出`, await noOverflowX(page))
  check(`${tag} 選底座：都在畫面內`, (await allInside(page, '[data-testid^=bake-base-]')).length === 0, (await allInside(page, '[data-testid^=bake-base-]')).join())
  check(`${tag} 選底座：沒有蓋到回去鍵`, (await overlaps(page, '[data-testid^=bake-base-]', '[data-testid=game-back]')).length === 0)
  await shot(page, `bakery-1-choose-${name}`)
  const inv0 = await inventory(page)
  const pet0 = await getPet(page)
  await page.locator(`[data-testid=bake-base-${baseId}]`).tap()
  await page.waitForSelector('[data-testid=bake-tray]')
  await sleep(page, 200)
  check(`${tag} 第一次有手勢示範`, (await page.locator('[data-testid=gesture-hint]').count()) === 1)
  check(`${tag} 裝飾：不橫向溢出`, await noOverflowX(page))
  check(`${tag} 裝飾：觸控目標 ≥ 56`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join())
  const inside = await allInside(page, '[data-testid=bake-tray] button, [data-testid=bake-sprinkle], [data-testid=bake-done], [data-testid=bake-treat]')
  check(`${tag} 裝飾：工具都在畫面內`, inside.length === 0, inside.join())
  const clash = await overlaps(page, '[data-testid=bake-treat]', '[data-testid=bake-tray], [data-testid=bake-sprinkle], [data-testid=bake-done], [data-testid=game-back]')
  check(`${tag} 裝飾：點心不蓋工具`, clash.length === 0, clash.join())
  const box = await centerOf(page, '[data-testid=bake-treat]')
  check(`${tag} 點心夠大`, box.box.width >= 220, String(Math.round(box.box.width)))

  // 拖一個上去：黏住、寵物有反應、示範消失
  const reacts0 = Number(await page.getByTestId('bake-pet').getAttribute('data-reacts'))
  const from = await centerOf(page, '[data-testid=bake-top-cherry]')
  await fingerDrag(send, from, { x: box.x, y: box.y })
  await sleep(page, 120)
  check(`${tag} 拖到點心上就黏住`, (await decoCount(page)) === 1)
  check(`${tag} 寵物有小反應`, Number(await page.getByTestId('bake-pet').getAttribute('data-reacts')) === reacts0 + 1)
  check(`${tag} 放了之後示範消失`, (await page.locator('[data-testid=gesture-hint]').count()) === 0)
  const deco = await centerOf(page, '[data-testid=bake-deco]')
  check(`${tag} 放在手指放開的地方`, Math.abs(deco.x - box.x) < 3 && Math.abs(deco.y - box.y) < 3, `${Math.round(deco.x - box.x)},${Math.round(deco.y - box.y)}`)

  // 放外面：彈回去，不算
  const star = await centerOf(page, '[data-testid=bake-top-star]')
  await fingerDrag(send, star, { x: box.box.x + 2, y: box.box.y + 2 })
  await sleep(page, 60)
  check(`${tag} 放在點心外不黏（角落）`, (await decoCount(page)) === 1)
  check(`${tag} 放外面的會飛回去`, (await page.locator('[data-testid=bake-ghost][data-back]').count()) === 1)
  await sleep(page, 480)
  check(`${tag} 飛回去後消失`, (await page.locator('[data-testid=bake-ghost]').count()) === 0)

  // 拖到一半被系統打斷（pointercancel）：不留鬼影、不黏
  await fingerDrag(send, star, { x: box.x, y: box.y }, { end: 'touchCancel' })
  await sleep(page, 80)
  check(`${tag} 拖到一半被打斷：沒有鬼影`, (await page.locator('[data-testid=bake-ghost]').count()) === 0)
  check(`${tag} 拖到一半被打斷：沒有放上去`, (await decoCount(page)) === 1)

  // 點一下托盤也放得上去（3 歲不一定會拖）
  await fingerTap(send, star)
  await sleep(page, 100)
  check(`${tag} 點一下托盤也放得上去`, (await decoCount(page)) === 2)

  // 兩根手指同時拖兩個
  const ca = await centerOf(page, '[data-testid=bake-top-candle]')
  const ch = await centerOf(page, '[data-testid=bake-top-choco]')
  const t1 = { x: box.x - box.box.width * 0.2, y: box.y }
  const t2 = { x: box.x + box.box.width * 0.2, y: box.y + box.box.height * 0.05 }
  await send('touchStart', [pt(ca, 0), pt(ch, 1)])
  for (let i = 1; i <= 6; i++) await send('touchMove', [pt({ x: ca.x + ((t1.x - ca.x) * i) / 6, y: ca.y + ((t1.y - ca.y) * i) / 6 }, 0), pt({ x: ch.x + ((t2.x - ch.x) * i) / 6, y: ch.y + ((t2.y - ch.y) * i) / 6 }, 1)])
  await send('touchEnd', [])
  await sleep(page, 120)
  check(`${tag} 兩根手指同時放兩個`, (await decoCount(page)) === 4, String(await decoCount(page)))

  // 點一下裝飾會彈
  const first = page.locator('[data-testid=bake-deco]').first()
  const fb = await first.boundingBox()
  await fingerTap(send, { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 })
  await sleep(page, 60)
  check(`${tag} 點一下裝飾會彈`, (await page.locator('[data-testid=bake-deco][data-bop]').count()) >= 1)
  check(`${tag} 點一下裝飾不會少`, (await decoCount(page)) === 4)

  // 在點心上移動位置；拖出去就消失
  const lastDeco = page.locator('[data-testid=bake-deco]').last()
  const lb = await lastDeco.boundingBox()
  const lc = { x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 }
  const near = { x: box.x, y: box.y + box.box.height * 0.1 }
  await fingerDrag(send, lc, near)
  await sleep(page, 80)
  const lb2 = await page.locator('[data-testid=bake-deco]').last().boundingBox()
  check(`${tag} 裝飾可以換位置`, Math.abs(lb2.x + lb2.width / 2 - near.x) < 4 && Math.abs(lb2.y + lb2.height / 2 - near.y) < 4 && (await decoCount(page)) === 4)
  await fingerDrag(send, near, { x: box.box.x + 2, y: box.box.y + box.box.height - 2 })
  await sleep(page, 60)
  check(`${tag} 拖出點心外就消失`, (await decoCount(page)) === 3)
  await sleep(page, 320)
  check(`${tag} 消失後從畫面移除`, (await page.locator('[data-testid=bake-deco]').count()) === 3)

  // 糖珠
  await page.getByTestId('bake-sprinkle').tap()
  await sleep(page, 80)
  const dots = await page.locator('[data-testid=bake-dot]').count()
  check(`${tag} 撒糖珠`, dots > 10, String(dots))
  await page.getByTestId('bake-sprinkle').tap()
  await sleep(page, 80)
  check(`${tag} 再撒一次更多`, (await page.locator('[data-testid=bake-dot]').count()) > dots)
  check(`${tag} 糖珠不算裝飾`, (await decoCount(page)) === 3)
  await shot(page, `bakery-2-decorate-${name}`)

  // 完成 → 送給寵物
  await page.getByTestId('bake-done').tap()
  await sleep(page, 200)
  check(`${tag} 送禮物那步有手勢示範`, (await page.locator('[data-testid=gesture-hint]').count()) === 1)
  check(`${tag} 送禮物那步：不橫向溢出`, await noOverflowX(page))
  const insideGive = await allInside(page, '[data-testid=bake-pet], [data-testid=bake-treat]')
  check(`${tag} 送禮物那步：都在畫面內`, insideGive.length === 0, insideGive.join())
  await shot(page, `bakery-3-give-${name}`)
  // 拖一下沒拖到寵物：回到原位
  const treat = await centerOf(page, '[data-testid=bake-treat]')
  const petC = await centerOf(page, '[data-testid=bake-pet]')
  const miss = { x: treat.x + (treat.x - petC.x) * 0.2, y: treat.y + (treat.y - petC.y) * 0.2 }
  await fingerDrag(send, treat, miss)
  await sleep(page, 600)
  check(`${tag} 沒拖到寵物：還在等`, (await page.getByTestId('bakery').getAttribute('data-phase')) === 'give')
  // 拖到一半被打斷也回原位
  await fingerDrag(send, treat, petC, { end: 'touchCancel' })
  await sleep(page, 600)
  check(`${tag} 拖到一半被打斷：還在等`, (await page.getByTestId('bakery').getAttribute('data-phase')) === 'give')
  const t2Box = await page.getByTestId('bake-treat').boundingBox()
  check(`${tag} 被打斷後回到原位`, Math.abs(t2Box.x - treat.box.x) < 2 && Math.abs(t2Box.y - treat.box.y) < 2)
  // 拖給寵物：一口一口吃
  await fingerDrag(send, treat, petC)
  await page.waitForFunction(() => document.querySelector('[data-testid=bakery]')?.dataset.phase === 'eat')
  check(`${tag} 拖給寵物就開始吃`, true)
  const counts = new Set()
  for (let i = 0; i < 40; i++) {
    counts.add(await page.locator('[data-testid=bake-deco]').count())
    if ((await page.getByTestId('bakery').getAttribute('data-phase')) === 'done') break
    await sleep(page, 60)
  }
  check(`${tag} 裝飾一個一個不見`, [3, 2, 1, 0].filter((n) => counts.has(n)).length >= 3, [...counts].join())
  await page.waitForSelector('[data-testid=bakery][data-phase=done]')
  check(`${tag} 吃完有愛心`, (await page.getByTestId('bake-hearts').count()) === 1)
  await shot(page, `bakery-4-done-${name}`)
  check(`${tag} 吃完才過一下禮物還沒跳（先讓寵物說完）`, (await page.getByTestId('play-gift').count()) === 0)
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  check(`${tag} 第一次吃完有禮物`, true)
  const inv1 = await inventory(page)
  check(`${tag} 只多 1 個食物（沒有消耗背包）`, sum(inv1) === sum(inv0) + 1 && Object.entries(inv0).every(([k, v]) => (inv1[k] ?? 0) >= v), `${sum(inv0)}→${sum(inv1)}`)
  const pet1 = await getPet(page)
  check(`${tag} 不增加成長`, pet1.feedCount === pet0.feedCount && pet1.stage === pet0.stage && pet1.hunger === pet0.hunger)
  await page.getByTestId('play-gift').tap()
  check(`${tag} 不橫向溢出（吃完）`, await noOverflowX(page))

  // 再做一個：這次用點的；同一天不再送
  await page.getByTestId('bake-again').tap()
  await page.waitForSelector('[data-testid^=bake-base-]')
  check(`${tag} 再做一個回到選底座`, (await decoCount(page)) === 0)
  await page.locator('[data-testid=bake-base-cake]').tap()
  await page.getByTestId('bake-done').tap()
  await sleep(page, 150)
  await page.getByTestId('bake-pet').locator('button').tap({ force: true }) // 按寵物也算送給牠（寵物一直在呼吸，等不到「穩定」）
  await page.waitForSelector('[data-testid=bakery][data-phase=done]', { timeout: 5000 })
  check(`${tag} 沒放裝飾也能送、按寵物也能送`, true)
  await sleep(page, 2700)
  check(`${tag} 同一天第二次不再送禮物`, (await page.getByTestId('play-gift').count()) === 0)
  check(`${tag} 背包數量沒再變`, sum(await inventory(page)) === sum(inv1))
  check(`${tag} 沒有錯誤`, realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()
}

/** 放滿、旋轉、減少動態 */
async function testBakeryEdge(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const send = await touchSender(ctx, page)
  await gameHash(page, 'bakery')
  await page.getByTestId('bake-base-cake').tap()
  await page.waitForSelector('[data-testid=bake-tray]')
  const star = await centerOf(page, '[data-testid=bake-top-star]')
  for (let i = 0; i < 33; i++) await fingerTap(send, star)
  await sleep(page, 200)
  check('點心：上限 30 個', (await decoCount(page)) === 30, String(await decoCount(page)))
  const box = await centerOf(page, '[data-testid=bake-treat]')
  await fingerDrag(send, star, { x: box.x, y: box.y })
  await sleep(page, 60)
  check('點心：放滿再拖只會飛回去', (await decoCount(page)) === 30 && (await page.locator('[data-testid=bake-ghost][data-back]').count()) === 1)
  await sleep(page, 480)
  await shot(page, 'bakery-full-land')
  // 旋轉：裝飾跟著點心走（存百分比），不溢出
  const before = await page.evaluate(() => {
    const box = document.querySelector('[data-testid=bake-treat]').getBoundingClientRect()
    const r = document.querySelector('[data-testid=bake-deco]').getBoundingClientRect()
    return [(r.left + r.width / 2 - box.left) / box.width, (r.top + r.height / 2 - box.top) / box.height]
  })
  for (const [n, vp] of [['port', SIZES.port], ['phone', SIZES.phone], ['phone-land', { width: 844, height: 390 }], ['land', SIZES.land]]) {
    await page.setViewportSize(vp)
    await sleep(page, 150)
    const after = await page.evaluate(() => {
      const box = document.querySelector('[data-testid=bake-treat]').getBoundingClientRect()
      const r = document.querySelector('[data-testid=bake-deco]').getBoundingClientRect()
      return [(r.left + r.width / 2 - box.left) / box.width, (r.top + r.height / 2 - box.top) / box.height]
    })
    check(`點心：旋轉到 ${n} 裝飾相對位置不變`, Math.abs(after[0] - before[0]) < 0.01 && Math.abs(after[1] - before[1]) < 0.01)
    check(`點心：旋轉到 ${n} 不溢出`, await noOverflowX(page))
    const inside = await allInside(page, '[data-testid=bake-tray] button, [data-testid=bake-sprinkle], [data-testid=bake-done], [data-testid=bake-treat]')
    check(`點心：旋轉到 ${n} 工具都在畫面內`, inside.length === 0, inside.join())
    const clash = await overlaps(page, '[data-testid=bake-treat]', '[data-testid=bake-tray], [data-testid=bake-sprinkle], [data-testid=bake-done]')
    check(`點心：旋轉到 ${n} 點心不蓋工具`, clash.length === 0, clash.join())
    if (n === 'phone-land') {
      check(`點心：旋轉到 ${n} 觸控目標 ≥ 56`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join())
      await shot(page, 'bakery-2-decorate-phone-land')
    }
  }
  // 30 個吃掉也不會等太久
  await page.getByTestId('bake-done').tap()
  await sleep(page, 150)
  const t0 = Date.now()
  await page.getByTestId('bake-treat').tap()
  await page.waitForSelector('[data-testid=bakery][data-phase=done]', { timeout: 8000 })
  check('點心：30 個裝飾 6 秒內吃完', Date.now() - t0 < 6000, `${Date.now() - t0}ms`)
  check('點心（放滿）：沒有錯誤', realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()

  // 減少動態：一樣走得完
  const r = await freshApp(b, SIZES.land, TOUCH)
  await r.page.emulateMedia({ reducedMotion: 'reduce' })
  await gameHash(r.page, 'bakery')
  await r.page.getByTestId('bake-base-icecream').tap()
  const send2 = await touchSender(r.ctx, r.page)
  await fingerTap(send2, await centerOf(r.page, '[data-testid=bake-top-cherry]'))
  await r.page.getByTestId('bake-done').tap()
  await sleep(r.page, 100)
  await r.page.getByTestId('bake-treat').tap()
  await r.page.waitForSelector('[data-testid=bakery][data-phase=done]', { timeout: 6000 })
  check('點心（減少動態）：走得完', true)
  await r.page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  check('點心（減少動態）：有禮物', true)
  await send2.detach()
  await r.ctx.close()
}

const plotAttr = (page, i, a) => page.getByTestId(`plot-${i}`).getAttribute(a)

/** 小菜園：完整走一輪，用 ctx.clock 換日 */
async function testGarden(b, name, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `菜園[${name}]`
  await ctx.clock.setFixedTime(T0)
  await gameHash(page, 'garden')
  await page.waitForSelector('[data-testid=plot-5]')
  check(`${tag} 6 塊田`, (await page.locator('[data-testid^=plot-][data-state]').count()) === 6)
  check(`${tag} 舊存檔沒有 garden 欄位也正常`, (await settings(page)).garden === undefined)
  check(`${tag} 不橫向溢出`, await noOverflowX(page))
  check(`${tag} 觸控目標 ≥ 56`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join())
  const p0 = await page.getByTestId('plot-0').boundingBox()
  const p1 = await page.getByTestId('plot-1').boundingBox()
  const p2 = await page.getByTestId('plot-2').boundingBox()
  check(`${tag} 田夠大`, p0.width >= 140 && p0.height >= 140, `${Math.round(p0.width)}x${Math.round(p0.height)}`)
  if (name === 'land') check(`${tag} 橫向 3×2`, Math.abs(p0.y - p2.y) < 1 && p2.x > p1.x)
  else check(`${tag} 直向 2×3`, Math.abs(p0.y - p1.y) < 1 && p2.y > p1.y)
  const inside = await allInside(page, '[data-testid^=plot-][data-state], [data-testid=garden-can], [data-testid=garden-bag]')
  check(`${tag} 都在畫面內`, inside.length === 0, inside.join())
  const clash = await overlaps(page, '[data-testid^=plot-][data-state]', '[data-testid=game-back], [data-testid=garden-can], [data-testid=garden-bag]')
  check(`${tag} 田不蓋回去鍵與工具`, clash.length === 0, clash.join())
  check(`${tag} 第一次有手勢示範`, (await page.locator('[data-testid=gesture-hint]').count()) === 1)
  await shot(page, `garden-1-empty-${name}`)

  // 空田 → 選種子 → 也可以不種
  await page.getByTestId('plot-1').tap()
  await page.waitForSelector('[data-testid=seed-picker]')
  check(`${tag} 六種種子`, (await page.locator('[data-testid^=seed-]:not([data-testid=seed-picker]):not([data-testid=seed-close])').count()) === 6)
  const seedSmall = await smallTargets(page)
  check(`${tag} 種子觸控目標 ≥ 56`, seedSmall.length === 0, seedSmall.join())
  const seedBox = await page.getByTestId('seed-carrot').boundingBox()
  check(`${tag} 種子是大圖`, seedBox.width >= 88, String(Math.round(seedBox.width)))
  check(`${tag} 種子都在畫面內`, (await allInside(page, '[data-testid^=seed-]')).length === 0, (await allInside(page, '[data-testid^=seed-]')).join())
  await sleep(page, 300)
  await shot(page, `garden-2-picker-${name}`)
  await page.getByTestId('seed-close').tap()
  check(`${tag} 不種就關掉，田還是空的`, (await plotAttr(page, 1, 'data-state')) === 'empty' && (await page.getByTestId('seed-picker').count()) === 0)

  await page.getByTestId('plot-0').tap()
  await page.getByTestId('seed-carrot').tap()
  await page.waitForSelector('[data-testid=plot-0][data-stage="0"]')
  check(`${tag} 種下是小芽`, (await plotAttr(page, 0, 'data-crop')) === 'carrot')
  check(`${tag} 資料長度 6`, (await settings(page)).garden.length === 6)
  await sleep(page, 120)
  check(`${tag} 種下後示範澆水`, (await page.locator('[data-testid=gesture-hint]').count()) === 1)

  // 拖到一半被打斷：不算澆水，水壺回原位
  const can = await centerOf(page, '[data-testid=garden-can]')
  const plot0 = await centerOf(page, '[data-testid=plot-0]')
  await fingerDrag(send, can, plot0, { end: 'touchCancel' })
  await sleep(page, 400)
  check(`${tag} 拖水壺被打斷：沒澆到`, (await plotAttr(page, 0, 'data-stage')) === '0')
  const canB = await page.getByTestId('garden-can').boundingBox()
  check(`${tag} 拖水壺被打斷：回原位`, Math.abs(canB.x - can.box.x) < 2 && Math.abs(canB.y - can.box.y) < 2)
  check(`${tag} 拖水壺被打斷：田沒有留下高亮`, (await page.locator('[data-testid^=plot-][data-over="1"]').count()) === 0)

  // 當天第一次澆：長一階（第一次就看得到變化）
  const osc0 = await page.evaluate(() => window.__audio.osc + window.__audio.noise)
  await fingerDrag(send, can, plot0)
  await page.waitForSelector('[data-testid=plot-0][data-stage="1"]')
  check(`${tag} 拖水壺到田上：長成葉子`, true)
  check(`${tag} 有水滴動畫`, (await page.getByTestId('plot-fx-0').count()) === 1)
  check(`${tag} 澆水有聲音`, (await page.evaluate(() => window.__audio.osc + window.__audio.noise)) > osc0)
  check(`${tag} 澆過之後示範消失`, (await page.locator('[data-testid=gesture-hint]').count()) === 0)
  await shot(page, `garden-3-watering-${name}`)
  const after1 = await settings(page)
  check(`${tag} 記下今天長過`, after1.garden[0].grewOn === '2026-11-04' && after1.garden[0].stage === 1, JSON.stringify(after1.garden[0]))
  await sleep(page, 1200)
  check(`${tag} 動畫結束會清掉`, (await page.getByTestId('plot-fx-0').count()) === 0)
  check(`${tag} 今天長過了在睡覺`, (await plotAttr(page, 0, 'data-state')) === 'sleeping' && (await page.getByTestId('plot-zzz-0').count()) === 1)

  // 同一天再澆：還是有水滴，不長大（拖、點都一樣）
  await fingerDrag(send, can, plot0)
  await sleep(page, 150)
  check(`${tag} 今天再澆有水滴`, (await page.getByTestId('plot-fx-0').count()) === 1)
  check(`${tag} 今天再澆不會長`, (await plotAttr(page, 0, 'data-stage')) === '1')
  await sleep(page, 1200)
  await page.getByTestId('plot-0').tap()
  await sleep(page, 150)
  check(`${tag} 點田也是澆水`, (await page.getByTestId('plot-fx-0').count()) === 1)
  check(`${tag} 點田也不會多長`, (await plotAttr(page, 0, 'data-stage')) === '1')
  const invMid = await inventory(page)
  check(`${tag} 沒長好不能收`, (invMid.carrot ?? 0) === 0)

  // 另一塊田用點的種和澆
  await page.getByTestId('plot-3').tap()
  await page.getByTestId('seed-grape').tap()
  await page.waitForSelector('[data-testid=plot-3][data-stage="0"]')
  await page.getByTestId('plot-3').tap()
  await page.waitForSelector('[data-testid=plot-3][data-stage="1"]')
  check(`${tag} 點田澆水也會長`, true)
  await sleep(page, 1200)
  await shot(page, `garden-4-sleeping-${name}`)

  // 重開頁面：資料還在
  await page.reload()
  await page.waitForSelector('[data-testid=plot-5]')
  check(`${tag} 重開頁面資料還在`, (await plotAttr(page, 0, 'data-stage')) === '1' && (await plotAttr(page, 0, 'data-crop')) === 'carrot' && (await plotAttr(page, 3, 'data-crop')) === 'grape')
  check(`${tag} 重開頁面同一天還在睡`, (await plotAttr(page, 0, 'data-state')) === 'sleeping')

  // 隔天：真的換日，再經過畫面
  await ctx.clock.setFixedTime(T0 + DAY)
  await page.reload()
  await page.waitForSelector('[data-testid=plot-5]')
  check(`${tag} 隔天回來可以澆了`, (await plotAttr(page, 0, 'data-state')) === 'thirsty')
  check(`${tag} 沒有倒數、沒有天數`, !/[0-9]\s*天|明天還|倒數/.test(await page.getByTestId('garden').innerText()))
  const can2 = await centerOf(page, '[data-testid=garden-can]')
  const plot0b = await centerOf(page, '[data-testid=plot-0]')
  await fingerDrag(send, can2, plot0b)
  await page.waitForSelector('[data-testid=plot-0][data-stage="2"]')
  check(`${tag} 隔天再澆：長好`, (await plotAttr(page, 0, 'data-state')) === 'ready')
  check(`${tag} 長好有閃光`, (await page.getByTestId('plot-spark-0').count()) === 1)
  check(`${tag} 長好時另一塊田不受影響`, (await plotAttr(page, 3, 'data-stage')) === '1')
  await sleep(page, 1200)
  await shot(page, `garden-5-ready-${name}`)
  // 長好再澆也不會怎樣
  await fingerDrag(send, can2, plot0b)
  await sleep(page, 150)
  check(`${tag} 長好再澆不會出事`, (await plotAttr(page, 0, 'data-stage')) === '2' && (await plotAttr(page, 0, 'data-crop')) === 'carrot')
  await sleep(page, 1100)

  // 遊樂場那格的小閃光，再從那格走回來（走 UI）
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=playground-grid]')
  await page.waitForSelector('[data-testid=game-garden].pg-gard-ready-hint', { timeout: 1500 })
  check(`${tag} 遊樂場裡小菜園那格有閃光`, true)
  await page.getByTestId('game-garden').tap()
  await page.waitForSelector('[data-testid=plot-5]')

  // 收成：進背包，田變空；連點兩下也只收一次
  const inv0 = await inventory(page)
  await page.getByTestId('plot-0').tap()
  await page.waitForSelector('[data-testid=plot-0][data-state=empty]')
  await sleep(page, 200)
  const inv1 = await inventory(page)
  check(`${tag} 收成 2 個進背包`, (inv1.carrot ?? 0) === (inv0.carrot ?? 0) + 2, `${inv0.carrot ?? 0}→${inv1.carrot ?? 0}`)
  check(`${tag} 只有那個食物變多`, sum(inv1) === sum(inv0) + 2)
  await sleep(page, 1000)
  check(`${tag} 飛行動畫結束會清掉`, (await page.evaluate(() => document.querySelectorAll('body > div[aria-hidden=true]').length)) === 0)
  check(`${tag} 收成不走 finish()：沒有遊樂場禮物`, (await page.getByTestId('play-gift').count()) === 0)
  check(`${tag} 收完不再閃`, (await page.getByTestId('plot-spark-0').count()) === 0)
  const s = await settings(page)
  check(`${tag} 田的資料清掉`, s.garden[0] === null && s.garden.length === 6 && !s.playDaily?.done?.includes('garden'))
  // 空了可以再種
  await page.getByTestId('plot-0').tap()
  await page.getByTestId('seed-banana').tap()
  await page.waitForSelector('[data-testid=plot-0][data-stage="0"]')
  check(`${tag} 收完可以再種`, (await plotAttr(page, 0, 'data-crop')) === 'banana')
  check(`${tag} 不橫向溢出（收完）`, await noOverflowX(page))
  check(`${tag} 沒有錯誤`, realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()
}

/** 手機橫放、旋轉、減少動態、連點、舊資料、首頁閃光、離開後計時器 */
async function testGardenEdge(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const send = await touchSender(ctx, page)
  await ctx.clock.setFixedTime(T0)
  // 壞資料與長度不對的舊資料
  await idb(
    page,
    (db) =>
      new Promise((res) => {
        const st = db.transaction('settings', 'readwrite').objectStore('settings')
        st.get('main').onsuccess = (e) => (st.put({ ...e.target.result, garden: [{ crop: 'pizza', stage: 7, grewOn: 1 }, { crop: 'apple', stage: 2, grewOn: '2026-11-03' }] }).onsuccess = () => res(1))
      }),
  )
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await sleep(page, 250)
  check('菜園：長好時首頁遊樂場鍵有閃光', await page.getByTestId('playground-btn').evaluate((el) => el.classList.contains('pg-gard-ready-hint')))
  await shot(page, 'home-garden-hint-land')
  await gameHash(page, 'garden')
  await page.waitForSelector('[data-testid=plot-5]')
  check('菜園：壞資料當空田', (await plotAttr(page, 0, 'data-state')) === 'empty')
  check('菜園：長度不足的舊資料正常顯示', (await plotAttr(page, 1, 'data-state')) === 'ready' && (await page.locator('[data-testid^=plot-][data-state=empty]').count()) === 5)
  // 連點收成：只收一次
  const inv0 = await inventory(page)
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=plot-1]')
    el.click()
    el.click()
    el.click()
  })
  await sleep(page, 300)
  const inv1 = await inventory(page)
  check('菜園：連點收成只收一次', (inv1.apple ?? 0) === (inv0.apple ?? 0) + 2, `${inv0.apple ?? 0}→${inv1.apple ?? 0}`)
  // 連點種下後的澆水：一天只長一階
  await page.locator('[data-testid=seed-close]').click({ timeout: 500 }).catch(() => {})
  await page.getByTestId('plot-2').tap()
  await page.getByTestId('seed-peach').tap()
  await page.waitForSelector('[data-testid=plot-2][data-stage="0"]')
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=plot-2]')
    for (let i = 0; i < 5; i++) el.click()
  })
  await sleep(page, 300)
  check('菜園：連點澆水只長一階', (await plotAttr(page, 2, 'data-stage')) === '1')

  // 旋轉與手機橫放
  for (const [n, vp] of [['port', SIZES.port], ['phone', SIZES.phone], ['phone-land', { width: 844, height: 390 }], ['land', SIZES.land]]) {
    await page.setViewportSize(vp)
    await sleep(page, 120)
    check(`菜園：旋轉到 ${n} 不溢出`, await noOverflowX(page))
    const inside = await allInside(page, '[data-testid^=plot-][data-state], [data-testid=garden-can], [data-testid=garden-bag]')
    check(`菜園：旋轉到 ${n} 都在畫面內`, inside.length === 0, inside.join())
    const clash = await overlaps(page, '[data-testid^=plot-][data-state]', '[data-testid=game-back], [data-testid=garden-can], [data-testid=garden-bag]')
    check(`菜園：旋轉到 ${n} 田不蓋工具`, clash.length === 0, clash.join())
    check(`菜園：旋轉到 ${n} 觸控目標 ≥ 56`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join())
    if (n === 'phone-land') {
      await shot(page, 'garden-1-phone-land')
      await page.getByTestId('plot-4').tap()
      await page.waitForSelector('[data-testid=seed-picker]')
      const insideSeeds = await allInside(page, '[data-testid^=seed-]')
      check('菜園：手機橫放選種子都在畫面內', insideSeeds.length === 0, insideSeeds.join())
      await page.getByTestId('seed-close').tap()
    }
  }

  // 減少動態：一樣能澆能收
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await ctx.clock.setFixedTime(T0 + DAY)
  await page.reload()
  await page.waitForSelector('[data-testid=plot-5]')
  const can = await centerOf(page, '[data-testid=garden-can]')
  await fingerDrag(send, can, await centerOf(page, '[data-testid=plot-2]'))
  await page.waitForSelector('[data-testid=plot-2][data-stage="2"]')
  await sleep(page, 100)
  check('菜園（減少動態）：水滴還是看得到', await page.getByTestId('plot-fx-2').evaluate((el) => getComputedStyle(el.querySelector('i')).opacity !== '0'))
  const invB = await inventory(page)
  await page.getByTestId('plot-2').tap()
  await page.waitForSelector('[data-testid=plot-2][data-state=empty]')
  await sleep(page, 150)
  check('菜園（減少動態）：收成進背包', ((await inventory(page)).peach ?? 0) === (invB.peach ?? 0) + 2)
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // 開著過夜：從背景回來會換成今天的樣子
  await page.getByTestId('plot-5').tap()
  await page.getByTestId('seed-apple').tap()
  await page.waitForSelector('[data-testid=plot-5][data-stage="0"]')
  await page.getByTestId('plot-5').tap()
  await page.waitForSelector('[data-testid=plot-5][data-state=sleeping]')
  await ctx.clock.setFixedTime(T0 + 2 * DAY)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.waitForSelector('[data-testid=plot-5][data-state=thirsty]', { timeout: 1500 })
  check('菜園：開著過夜，回來就換成今天', true)
  check('菜園（邊界）：沒有錯誤', realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()
}

/** 離開後計時器要清乾淨（演到一半就離開） */
async function testTimers(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const send = await touchSender(ctx, page)
  await page.evaluate(() => (location.hash = 'playground'))
  await page.waitForSelector('[data-testid=playground-grid]')
  const live = () => page.evaluate(() => window.__timers.size)
  // 基準：先進出一次什麼都不做（首頁留下的長計時器此時已被清掉），等一次性的都走完。不這樣基準偏高，漏洞測不出來
  await page.getByTestId('game-bubbles').tap()
  await page.waitForSelector('[data-testid=game-back]')
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=playground-grid]')
  await sleep(page, 5000)
  const base = await live()

  // 點心：吃到一半離開
  await page.getByTestId('game-bakery').tap()
  await page.waitForSelector('[data-testid=bakery]')
  await page.getByTestId('bake-base-cake').tap()
  const star = await centerOf(page, '[data-testid=bake-top-star]')
  for (let i = 0; i < 6; i++) await fingerTap(send, star)
  await page.getByTestId('bake-done').tap()
  await sleep(page, 100)
  await page.getByTestId('bake-treat').tap()
  await page.waitForSelector('[data-testid=bakery][data-phase=eat]')
  await sleep(page, 200)
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=playground-grid]')
  const inv = await inventory(page)
  // Dexie 的 useLiveQuery 卸載後自己留一個 3 秒的計時器，等它走完才比（吃完要 4 秒以上，漏掉的話這時還活著）
  await sleep(page, 3400)
  const afterBake = await live()
  check('點心：吃到一半離開，計時器清乾淨', afterBake <= base, `${base}→${afterBake}`)
  await sleep(page, 3500)
  check('點心：吃到一半離開不會偷偷送禮物', sum(await inventory(page)) === sum(inv) && !(await settings(page)).playDaily?.done?.includes('bakery'))

  // 點心：吃完還沒送禮物就離開：計時器也清掉，下次玩還拿得到（沒有損失）
  await page.getByTestId('game-bakery').tap()
  await page.getByTestId('bake-base-cake').tap()
  await page.getByTestId('bake-done').tap()
  await sleep(page, 100)
  await page.getByTestId('bake-treat').tap()
  await page.waitForSelector('[data-testid=bakery][data-phase=done]')
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=playground-grid]')
  await sleep(page, 2600)
  check('點心：吃完立刻離開，禮物還留著', !(await settings(page)).playDaily?.done?.includes('bakery'))
  await page.getByTestId('game-bakery').tap()
  await page.getByTestId('bake-base-cake').tap()
  await page.getByTestId('bake-done').tap()
  await sleep(page, 100)
  await page.getByTestId('bake-treat').tap()
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 6000 })
  check('點心：再玩一次拿得到', true)
  await page.getByTestId('play-gift').tap()
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=playground-grid]')

  // 菜園：水滴的計時器只有 1.1 秒，等不到 Dexie 走完，所以用對照組比：一樣進出但沒澆水 vs 澆到一半離開
  await page.getByTestId('game-garden').tap()
  await page.waitForSelector('[data-testid=plot-5]')
  await page.getByTestId('plot-0').tap()
  await page.getByTestId('seed-carrot').tap()
  await page.waitForSelector('[data-testid=plot-0][data-stage="0"]')
  await sleep(page, 1500)
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=playground-grid]')
  await sleep(page, 3400)
  await page.getByTestId('game-garden').tap()
  await page.waitForSelector('[data-testid=plot-5]')
  await sleep(page, 700)
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=playground-grid]')
  await sleep(page, 500)
  const control = await live()
  await sleep(page, 3000)
  await page.getByTestId('game-garden').tap()
  await page.waitForSelector('[data-testid=plot-5]')
  await sleep(page, 700)
  await page.getByTestId('plot-0').tap()
  await sleep(page, 80)
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=playground-grid]')
  await sleep(page, 500)
  const afterGarden = await live()
  check('菜園：澆到一半離開，計時器清乾淨', afterGarden <= control, `對照 ${control}→${afterGarden}`)
  check('計時器：沒有錯誤', realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()
}

/** 台詞：語音還在錄，所以把 manifest 換成每句都有假檔，看 play() 播了哪一句 */
async function testLines(b) {
  const src = readFileSync(join(here, '../src/learning/lines.ts'), 'utf8')
  const LINES = Object.fromEntries([...src.matchAll(/'(pet\.play\.(?:bakery|garden|reward)[\w.]*)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]))
  check('台詞：lines.ts 讀得到', Object.keys(LINES).length === 11, String(Object.keys(LINES).length))
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const send = await touchSender(ctx, page)
  await ctx.route('**/voice/manifest.json', (r) =>
    r.fulfill({ json: Object.fromEntries(Object.entries(LINES).map(([k, text]) => [k, { file: `__line__${k}.m4a`, text }])) }),
  )
  await ctx.addInitScript(() => {
    localStorage.setItem('gq-place-test', '1')
    localStorage.setItem('gq-voice-pack-test', '1')
    window.__lines = []
    HTMLMediaElement.prototype.play = function () {
      const m = /__line__(.+)\.m4a/.exec(this.src)
      if (m) window.__lines.push(m[1])
      return Promise.resolve()
    }
  })
  await ctx.clock.setFixedTime(T0)
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  const lines = () => page.evaluate(() => window.__lines.map((x) => x.replace('pet.play.', '')))
  const clear = () => page.evaluate(() => (window.__lines = []))

  await gameHash(page, 'bakery')
  await sleep(page, 500)
  check('台詞：點心屋進場', (await lines()).join() === 'bakery.intro', (await lines()).join())
  await clear()
  await page.getByTestId('bake-base-cake').tap()
  await sleep(page, 80)
  check('台詞：選完底座', (await lines()).join() === 'bakery.decorate', (await lines()).join())
  await clear()
  await fingerTap(send, await centerOf(page, '[data-testid=bake-top-star]'))
  await sleep(page, 80)
  check('台詞：放裝飾不說話', (await lines()).length === 0, (await lines()).join())
  await page.getByTestId('bake-done').tap()
  await sleep(page, 80)
  check('台詞：完成', (await lines()).join() === 'bakery.give', (await lines()).join())
  await clear()
  await page.getByTestId('bake-treat').tap()
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 7000 })
  await sleep(page, 80)
  check('台詞：吃完先說好吃、再說送你', (await lines()).join() === 'bakery.yum,reward', (await lines()).join())
  await page.getByTestId('play-gift').tap()
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=playground-grid]')
  await clear()

  // 菜園：第一次（沒東西）
  await page.getByTestId('game-garden').tap()
  await page.waitForSelector('[data-testid=plot-5]')
  await sleep(page, 600)
  check('台詞：沒種東西進場說 intro', (await lines()).join() === 'garden.intro', (await lines()).join())
  await clear()
  await page.getByTestId('plot-0').tap()
  await page.getByTestId('seed-carrot').tap()
  await page.waitForSelector('[data-testid=plot-0][data-stage="0"]')
  await sleep(page, 60)
  check('台詞：種下請孩子澆水', (await lines()).join() === 'garden.water', (await lines()).join())
  await clear()
  await page.getByTestId('plot-0').tap()
  await page.waitForSelector('[data-testid=plot-0][data-stage="1"]')
  await sleep(page, 60)
  check('台詞：長大', (await lines()).join() === 'garden.grow', (await lines()).join())
  await clear()
  await sleep(page, 1200)
  await page.getByTestId('plot-0').tap()
  await sleep(page, 120)
  check('台詞：今天長過了說明天再來', (await lines()).join() === 'garden.tomorrow', (await lines()).join())
  await clear()
  await sleep(page, 1200)

  // 隔天進場：有能澆的說 water（前面是點遊樂場那格進來的，網址還停在點心屋，重開要直接回菜園）
  await page.evaluate(() => history.replaceState(null, '', '#game/garden'))
  await ctx.clock.setFixedTime(T0 + DAY)
  await page.reload()
  await page.waitForSelector('[data-testid=plot-5]')
  await sleep(page, 700)
  check('台詞：隔天進場請孩子澆水', (await lines()).join() === 'garden.water', (await lines()).join())
  await clear()
  await page.getByTestId('plot-0').tap()
  await page.waitForSelector('[data-testid=plot-0][data-stage="2"]')
  await sleep(page, 60)
  check('台詞：長好那次說長大', (await lines()).join() === 'garden.grow', (await lines()).join())
  await sleep(page, 1200)
  await page.reload()
  await page.waitForSelector('[data-testid=plot-5]')
  await sleep(page, 700)
  check('台詞：有長好的進場說可以採收', (await lines()).join() === 'garden.ready', (await lines()).join())
  await clear()
  await page.getByTestId('plot-0').tap()
  await page.waitForSelector('[data-testid=plot-0][data-state=empty]')
  await sleep(page, 60)
  check('台詞：收成', (await lines()).join() === 'garden.harvest', (await lines()).join())
  check('台詞：沒有錯誤', realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()
}

const b = await launch()
// E2E_ONLY=timers 只跑某一段（改程式時省時間）
const only = process.env.E2E_ONLY
const run = async (name, fn) => {
  if (!only || only === name) await fn()
}
try {
  await run('bakery', () => testBakery(b, 'land', SIZES.land, 'cake'))
  await run('bakery', () => testBakery(b, 'port', SIZES.port, 'icecream'))
  await run('bakery', () => testBakery(b, 'phone', SIZES.phone, 'pancake'))
  await run('bakery-edge', () => testBakeryEdge(b))
  await run('garden', () => testGarden(b, 'land', SIZES.land))
  await run('garden', () => testGarden(b, 'port', SIZES.port))
  await run('garden', () => testGarden(b, 'phone', SIZES.phone))
  await run('garden-edge', () => testGardenEdge(b))
  await run('timers', () => testTimers(b))
  await run('lines', () => testLines(b))
} finally {
  await b.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
