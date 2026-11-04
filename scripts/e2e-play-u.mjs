// v8.3 線 U E2E：泡泡派對、接水果、翻翻配對。
//   三種尺寸（1180x820、820x1180、390x844）× 三個年齡檔的版面、無橫向捲動、觸控目標 ≥ 56px；
//   多指（每根手指獨立、手指接觸直徑 50px，像真機）、整回走完、禮物只送一次、離開後計時器清乾淨、
//   動作減少仍能玩、旋轉不壞、缺圖不破版。
// 用法：先啟動 dev server（pnpm dev --port 5211 --strictPort），再
//   BASE_URL=http://localhost:5211 node scripts/e2e-play-u.mjs     （或 pnpm e2e:play-u；E2E_BROWSER=webkit 改用 WebKit）
//   SHOTS_DIR=<目錄> 會存截圖；ONLY=bubbles,catch,memory,layout 只跑其中幾段。
// 無頭 WebKit 不跑 rAF、CSS 動畫也只在畫一幀時才前進：讀泡泡位置前先 page.screenshot() 刷一幀（flush）。
import { mkdirSync } from 'node:fs'
import { loadavg } from 'node:os'
import { IS_WEBKIT, freshApp, idb, launch, makeChecker, touchSender } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const AGES = ['3', '4-5', '6-7']
const GOAL = { 3: 15, '4-5': 20, '6-7': 25 }
const CARDS = { 3: 4, '4-5': 8, '6-7': 12 }
const SHOTS = process.env.SHOTS_DIR
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const ONLY = process.env.ONLY?.split(',')
const on = (name) => !ONLY || ONLY.includes(name)
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}${IS_WEBKIT ? '-webkit' : ''}.png` })
}
const flush = async (page) => {
  if (IS_WEBKIT) await page.screenshot()
}
const R = 25
const pt = (x, y, id = 1) => ({ x, y, id, radiusX: R, radiusY: R, force: 0.5 })
const tapAll = async (send, pts) => {
  await send('touchStart', pts)
  await send('touchEnd', [])
}

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
const settings = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
const foodTotal = (page) =>
  idb(page, (db) => new Promise((r) => (db.transaction('inventory').objectStore('inventory').getAll().onsuccess = (e) => r(e.target.result.reduce((a, i) => a + (i.qty ?? 0), 0)))))

/** 設年齡後直接進玩法（hash 路由） */
const enter = async (page, game, age, reload = true) => {
  if (age) await patchSettings(page, { ageBand: age })
  // 要重新載入時用 replaceState：不觸發 hashchange，否則 lazy import 跑到一半被 reload 打斷，WebKit 會報模組載入失敗
  if (reload) {
    await page.evaluate((g) => history.replaceState(null, '', `#game/${g}`), game)
    await page.reload()
  } else await page.evaluate((g) => (location.hash = `#game/${g}`), game)
  await page.waitForSelector(`[data-testid=${game}]`)
  if (age) await page.waitForSelector(`[data-testid=${game}][data-band="${age}"]`)
}
const said = (page, game) => page.evaluate((g) => (document.querySelector(`[data-testid=${g}]`)?.dataset.said ?? '').split(' ').filter(Boolean), game)
const attr = (page, game, name) => page.evaluate(([g, n]) => document.querySelector(`[data-testid=${g}]`)?.getAttribute(`data-${n}`), [game, name])
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth)
const backOk = (page) =>
  page.evaluate(() => {
    const r = document.querySelector('[data-testid=game-back]').getBoundingClientRect()
    return r.width >= 56 && r.height >= 56 && r.left >= 0 && r.top >= 0
  })
const closeGift = async (page) => {
  const g = page.getByTestId('play-gift')
  if (await g.count()) await g.click()
}

// ---------- 泡泡 ----------
const bubbles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-bubble]')]
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { id: el.dataset.bubble, x: r.left + r.width / 2, y: r.top + r.height / 2, d: r.width, big: !!el.dataset.big, mini: !!el.dataset.mini }
      })
      // 避開回去鍵與畫面外
      .filter((b) => b.x > 20 && b.x < innerWidth - 20 && b.y > 90 && b.y < innerHeight - 10),
  )
const popped = async (page) => Number(await attr(page, 'bubbles', 'popped'))
/** 等到畫面上至少 n 顆再讀（剛戳完可能還沒補上） */
async function waitBubbles(page, n) {
  const t0 = Date.now()
  for (;;) {
    await flush(page)
    const list = await bubbles(page)
    if (list.length >= n || Date.now() - t0 > 8000) return list
    await page.waitForTimeout(150)
  }
}

/** 一根手指戳到 target 顆為止（戳的是當下看到的泡泡）。回傳過程中看到的最大顆數 */
async function popUntil(page, send, target, { timeout = 60000 } = {}) {
  const t0 = Date.now()
  let maxAlive = 0
  while (Date.now() - t0 < timeout) {
    await closeGift(page)
    const n = await popped(page)
    maxAlive = Math.max(maxAlive, Number(await attr(page, 'bubbles', 'alive')))
    if (n >= target) break
    await flush(page)
    const list = await bubbles(page)
    if (!list.length) {
      await page.waitForTimeout(150)
      continue
    }
    await tapAll(send, [pt(list[0].x, list[0].y)])
    await page.waitForTimeout(40)
  }
  return maxAlive
}

async function testBubbles(browser) {
  // 整回走完：三個年齡各自的數量，禮物只送一次，到了還能繼續戳
  for (const age of AGES) {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { stage: 'adult' })
    const send = await touchSender(ctx, page)
    const food0 = await foodTotal(page)
    await enter(page, 'bubbles', age)
    check(`泡泡 ${age}：目標 ${GOAL[age]} 顆`, Number(await attr(page, 'bubbles', 'goal')) === GOAL[age])
    check(`泡泡 ${age}：開場有手勢示範`, (await page.getByTestId('play-hand').count()) === 1)
    await flush(page)
    const first = await bubbles(page)
    check(`泡泡 ${age}：一進來就有泡泡`, first.length > 0)
    await shot(page, `bubbles-${age}-start`)
    const hops0 = Number((await page.getByTestId('bubbles-pet').getAttribute('data-hops')) ?? 0)
    const maxAlive = await popUntil(page, send, GOAL[age] - 1)
    check(`泡泡 ${age}：手勢示範碰了就消失`, (await page.getByTestId('play-hand').count()) === 0)
    check(`泡泡 ${age}：戳破時寵物跳`, Number((await page.getByTestId('bubbles-pet').getAttribute('data-hops')) ?? 0) > hops0)
    check(`泡泡 ${age}：還沒滿不算玩完`, !(await said(page, 'bubbles')).includes('pet.play.bubbles.done') && (await foodTotal(page)) === food0)
    await popUntil(page, send, GOAL[age])
    check(`泡泡 ${age}：滿了說 done`, (await said(page, 'bubbles')).includes('pet.play.bubbles.done'))
    await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
    check(`泡泡 ${age}：送一份禮物`, (await foodTotal(page)) === food0 + 1)
    const giftArt = await page.evaluate(() => document.querySelector('[data-testid=play-gift] img[src*="food-"]') !== null)
    check(`泡泡 ${age}：禮物顯示食物的圖`, giftArt)
    await shot(page, `bubbles-${age}-gift`)
    await closeGift(page)
    await popUntil(page, send, GOAL[age] + 3)
    check(`泡泡 ${age}：滿了還能繼續戳`, (await popped(page)) >= GOAL[age] + 3)
    await page.waitForTimeout(1800)
    check(`泡泡 ${age}：繼續戳不會再送`, (await page.getByTestId('play-gift').count()) === 0 && (await foodTotal(page)) === food0 + 1)
    check(`泡泡 ${age}：done 只說一次`, (await said(page, 'bubbles')).filter((k) => k === 'pet.play.bubbles.done').length === 1)
    check(`泡泡 ${age}：顆數沒超過上限`, maxAlive <= 20, `max ${maxAlive}`)
    check(`泡泡 ${age}：今日紀錄`, (await settings(page)).playDaily?.done?.includes('bubbles'))
    // 重新進來玩滿：今天不再送
    await enter(page, 'bubbles', age)
    const send2 = await touchSender(ctx, page)
    await popUntil(page, send2, GOAL[age])
    await page.waitForTimeout(1900)
    check(`泡泡 ${age}：今天第二回不再送`, (await page.getByTestId('play-gift').count()) === 0 && (await foodTotal(page)) === food0 + 1)
    check(`泡泡 ${age}：沒有錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 多指、大泡泡、碎片清除、顆數上限、離開後計時器
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { stage: 'adult' })
    const send = await touchSender(ctx, page)
    await patchSettings(page, { ageBand: '6-7' })
    await page.evaluate(() => history.replaceState(null, '', '#playground'))
    await page.reload()
    await page.waitForSelector('.pg-grid')
    await page.waitForTimeout(600)
    const timers0 = await page.evaluate(() => window.__timers.size)
    await enter(page, 'bubbles', null, false)
    await page.waitForSelector('[data-testid=bubbles][data-band="6-7"]')
    await page.waitForTimeout(1500)

    // 三根手指同一瞬間各戳一顆
    let list = await waitBubbles(page, 3)
    const p0 = await popped(page)
    const fingers = list.slice(0, 3)
    check('多指：畫面上有至少 3 顆', fingers.length === 3, `${list.length} 顆`)
    await tapAll(send, fingers.map((b, i) => pt(b.x, b.y, i + 1)))
    await page.waitForTimeout(60)
    check('多指：三根手指同時戳破三顆', (await popped(page)) === p0 + 3, `${p0} → ${await popped(page)}`)
    check('戳破有碎片', (await page.getByTestId('bubble-fx').count()) >= 1)
    await shot(page, 'bubbles-burst')
    // 一根手指按著不放，另一根再戳：還是算（每根手指獨立）
    list = await waitBubbles(page, 3)
    const p1 = await popped(page)
    await send('touchStart', [pt(list[0].x, list[0].y, 1)])
    await page.waitForTimeout(80)
    const others = (await waitBubbles(page, 1)).filter((b) => b.id !== list[0].id)
    await send('touchStart', [pt(list[0].x, list[0].y, 1), pt(others[0].x, others[0].y, 2)])
    await send('touchEnd', [])
    await page.waitForTimeout(60)
    check('多指：按著不放時另一根手指照樣戳得破', (await popped(page)) === p1 + 2, `${p1} → ${await popped(page)}`)
    // 同一顆兩根手指一起戳：只破一次
    list = await waitBubbles(page, 1)
    const p2 = await popped(page)
    const alone = list.find((b) => list.every((o) => o === b || Math.hypot(o.x - b.x, o.y - b.y) > 300))
    if (alone) {
      await tapAll(send, [pt(alone.x - 4, alone.y, 1), pt(alone.x + 4, alone.y, 2)])
      await page.waitForTimeout(60)
      check('多指：兩根手指戳同一顆只算一次', (await popped(page)) === p2 + 1, `${p2} → ${await popped(page)}`)
    } else console.log('SKIP  多指：兩根手指戳同一顆（這次沒有落單的泡泡）')
    // 空的地方戳：沒事
    const p3 = await popped(page)
    await flush(page)
    list = await bubbles(page)
    const empty = [[600, 100], [300, 700], [900, 400], [100, 400], [600, 500]].find(([x, y]) => list.every((b) => Math.hypot(b.x - x, b.y - y) > b.d / 2 + 60))
    if (empty) {
      await tapAll(send, [pt(empty[0], empty[1])])
      await page.waitForTimeout(40)
      check('戳空的地方不算', (await popped(page)) === p3)
    }

    // 碎片到時間會被拿掉
    await page.waitForTimeout(1300)
    check('碎片演完清乾淨', (await page.getByTestId('bubble-fx').count()) === 0)

    // 大泡泡：固定節奏出現，戳破噴小泡泡，小泡泡也戳得破
    const t0 = Date.now()
    let big = null
    while (Date.now() - t0 < 15000) {
      await flush(page)
      big = (await bubbles(page)).find((b) => b.big)
      if (big) break
      await page.waitForTimeout(150)
    }
    check('大彩虹泡泡出現', !!big)
    check('大泡泡說一句', (await said(page, 'bubbles')).includes('pet.play.bubbles.big'))
    if (big) {
      await shot(page, 'bubbles-big')
      check('大泡泡比一般大', big.d >= 120, `${big.d}px`)
      await flush(page)
      const fresh = (await bubbles(page)).find((b) => b.big) ?? big
      await tapAll(send, [pt(fresh.x, fresh.y)])
      await page.waitForTimeout(450)
      await flush(page)
      await shot(page, 'bubbles-big-burst')
      const minis = (await bubbles(page)).filter((b) => b.mini)
      check('大泡泡噴出小泡泡', minis.length >= 3, `${minis.length} 顆`)
      check('小泡泡觸控目標 ≥ 56', minis.every((b) => b.d >= 56), minis.map((b) => Math.round(b.d)).join())
      if (minis.length) {
        const before = await popped(page)
        await flush(page)
        const now = (await bubbles(page)).filter((b) => b.mini)
        await tapAll(send, [pt(now[0].x, now[0].y)])
        await page.waitForTimeout(60)
        check('小泡泡戳得破', (await popped(page)) === before + 1)
      }
    }

    // 放著不戳：舊的泡泡會被收掉，DOM 不會一直長
    await page.waitForTimeout(9000)
    const dom = await page.evaluate(() => document.querySelectorAll('[data-bubble]').length)
    check('放著不戳：畫面上的泡泡不超過上限', dom <= 20, `${dom} 顆`)
    check('放著不戳：飄走的有被收掉（累計冒出比現存多很多）', Number((await page.locator('.pg-bub-ball').last().getAttribute('data-bubble')) ?? 0) > dom, `最新 id ${await page.locator('.pg-bub-ball').last().getAttribute('data-bubble')}`)

    // 離開：泡泡全部不見、計時器回到進來前
    await closeGift(page)
    await page.getByTestId('game-back').click()
    await page.waitForSelector('.pg-grid')
    // Dexie 的 liveQuery 取消訂閱後有自己的一次性 3 秒快取清理計時器，不是玩法留下的，等它走完再比
    await page.waitForTimeout(3300)
    const timers1 = await page.evaluate(() => window.__timers.size)
    check('離開：計時器清乾淨', timers1 <= timers0, `${timers0} → ${timers1}`)
    check('離開：畫面上沒有泡泡', (await page.locator('[data-bubble]').count()) === 0)
    check('多指段沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 動作減少：泡泡不飄，還是戳得破；寵物不跳
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.phone, { stage: 'adult', ctxOpts: { reducedMotion: 'reduce' } })
    const send = await touchSender(ctx, page)
    await enter(page, 'bubbles', '3')
    await page.waitForTimeout(600)
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.pg-bub-rise')).animationName)
    check('動作減少：泡泡只淡入淡出', anim === 'pg-bub-still', anim)
    await flush(page)
    const a = await bubbles(page)
    await page.waitForTimeout(500)
    await flush(page)
    const b = await bubbles(page)
    const same = a.find((x) => b.find((y) => y.id === x.id && Math.abs(y.y - x.y) < 1 && Math.abs(y.x - x.x) < 1))
    check('動作減少：泡泡不會動', !!same)
    await popUntil(page, send, 3, { timeout: 12000 })
    check('動作減少：戳得破', (await popped(page)) >= 3)
    check('動作減少：寵物不跳', ((await page.getByTestId('bubbles-pet').getAttribute('data-hops')) ?? null) === null)
    check('動作減少段沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

// ---------- 接水果 ----------
const catchState = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-testid=catch]')
    if (!root) return null
    const basket = document.querySelector('[data-testid=catch-basket]').getBoundingClientRect()
    const fruits = [...document.querySelectorAll('[data-testid=catch-fruit]')]
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
    return {
      basket: { x: basket.left + basket.width / 2, y: basket.top, w: basket.width, h: basket.height, left: basket.left, right: basket.right },
      fruits,
      caught: Number(root.dataset.caught),
      missed: Number(root.dataset.missed),
      ended: root.dataset.ended === 'true',
      w: innerWidth,
      h: innerHeight,
    }
  })

/** 自動玩一回：手指一直放著，追最低的那顆還沒過籃子的水果 */
async function playRound(page, send, { skill = true, timeout = 90000 } = {}) {
  const t0 = Date.now()
  let down = false
  let last = t0
  let worst = 0
  const y = (s) => s.h - 40
  while (Date.now() - t0 < timeout) {
    const s = await catchState(page)
    if (!s || s.ended) break
    if (skill) {
      // 水果要過了籃口判定帶（籃子高度的 75%）才換下一顆，不能還沒進籃就放棄
      const target = s.fruits.filter((f) => f.y < s.basket.y + s.basket.h * 0.75).sort((a, b) => b.y - a.y)[0]
      const x = target ? target.x : s.basket.x
      if (!down) {
        await send('touchStart', [pt(s.basket.x, y(s))])
        down = true
      }
      await send('touchMove', [pt(x, y(s))])
    }
    await page.waitForTimeout(25)
    worst = Math.max(worst, Date.now() - last)
    last = Date.now()
  }
  if (down) await send('touchEnd', [])
  await page.waitForSelector('[data-testid=catch-end]', { timeout: 8000 })
  // 機器人反應多慢、機器多忙：接到的顆數偏低時用來分辨是遊戲的問題還是測試機太忙
  return `機器人最慢一輪 ${worst}ms，負載 ${loadavg()[0].toFixed(1)}`
}

async function testCatch(browser) {
  const FALL = { 3: 5200, '4-5': 3700, '6-7': 2500 }
  const seen = {}
  // 6–7 歲：整回；禮物一次；有同時兩顆；第二回破紀錄
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { stage: 'adult' })
    const send = await touchSender(ctx, page)
    const food0 = await foodTotal(page)
    await enter(page, 'catch', '6-7')
    check('接水果：一回 15 顆（元素數）', (await page.getByTestId('catch-fruit').count()) === 15)
    check('接水果：開場有手勢示範', (await page.getByTestId('play-hand').count()) === 1)
    // 量同時在空中的顆數（6–7 歲一定有同時掉的）
    let simultaneous = 0
    const watcher = setInterval(async () => {
      const s = await catchState(page).catch(() => null)
      if (s) {
        const high = s.fruits.filter((f) => f.y < s.h * 0.5)
        simultaneous = Math.max(simultaneous, s.fruits.length)
        seen.high = Math.max(seen.high ?? 0, high.length)
      }
    }, 120)
    await page.waitForTimeout(3200)
    await shot(page, 'catch-6-7-play')
    await playRound(page, send)
    clearInterval(watcher)
    check('6–7 歲：畫面上同時有多顆', simultaneous >= 2, `${simultaneous}`)
    const first = await catchState(page)
    const n1 = Number(await page.getByTestId('catch-end-num').textContent())
    check('6–7 歲：接得到大部分', n1 >= 9, `${n1} 顆`)
    check('結束：接到幾顆顯示一致', n1 === first.caught)
    check('結束：接到 + 沒接到 = 15', first.caught + first.missed === 15, `${first.caught}+${first.missed}`)
    check('結束：第一回不算破紀錄', (await page.getByTestId('catch-end').getAttribute('data-broke')) === 'false')
    check('結束：第一回說 catch.done', (await said(page, 'catch')).includes('pet.play.catch.done'))
    check('結束：紀錄寫入', (await settings(page)).playBest?.catch === n1)
    check('結束：水果圖一顆一顆堆著', (await page.locator('.pg-catch-end-fruits > span').count()) === n1)
    await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
    check('結束：送一份禮物', (await foodTotal(page)) === food0 + 1)
    await closeGift(page)
    await page.waitForTimeout(200)
    await shot(page, 'catch-6-7-end')
    check('再玩一次：夠大', await page.getByTestId('play-again').evaluate((el) => el.offsetHeight >= 56 && el.offsetWidth >= 56))

    // 把紀錄改低再玩一回：破紀錄說 catch.more，顯示「比上次多」，但不再送禮物
    await patchSettings(page, { playBest: { catch: 1 } })
    await page.getByTestId('play-again').click()
    await page.waitForSelector('[data-testid=catch-fruit]')
    check('再玩一次：重新開始', (await catchState(page)).caught === 0)
    await playRound(page, send)
    const n2 = Number(await page.getByTestId('catch-end-num').textContent())
    if (n2 > 1) {
      check('破紀錄：顯示比上次多', (await page.getByTestId('catch-more').count()) === 1, `${n2} 顆`)
      check('破紀錄：說 catch.more', (await said(page, 'catch')).includes('pet.play.catch.more'))
      check('破紀錄：更新紀錄', (await settings(page)).playBest?.catch === n2)
    } else check('第二回接得到（才能驗破紀錄）', false, `${n2} 顆`)
    await page.waitForTimeout(1800)
    check('第二回不再送禮物', (await page.getByTestId('play-gift').count()) === 0 && (await foodTotal(page)) === food0 + 1)
    await shot(page, 'catch-6-7-more')
    check('6–7 歲段沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 3 歲：慢、籃子大、有吸力；4–5 歲放著不動也能結束（沒接到不扣東西）
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.phone, { stage: 'adult' })
    const send = await touchSender(ctx, page)
    await enter(page, 'catch', '3')
    await page.waitForTimeout(400)
    const s3 = await catchState(page)
    check('3 歲：手機上籃子夠大', s3.basket.w >= 170, `${s3.basket.w}px`)
    await page.waitForTimeout(3000)
    await shot(page, 'catch-3-phone')
    await playRound(page, send)
    const n = Number(await page.getByTestId('catch-end-num').textContent())
    check('3 歲：追著接幾乎都接得到', n >= 14, `${n} 顆`)
    check('手機結束畫面沒有超出', await page.getByTestId('play-again').evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight))
    await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
    await closeGift(page)
    await shot(page, 'catch-3-phone-end')
    check('3 歲段沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.port, { stage: 'adult' })
    const send = await touchSender(ctx, page)
    const food0 = await foodTotal(page)
    await enter(page, 'catch', '4-5')
    await playRound(page, send, { skill: false })
    const s = await catchState(page)
    check('放著不動：一回照樣結束', s.ended && s.caught + s.missed === 15, `${s.caught}+${s.missed}`)
    await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
    check('放著不動：不扣東西，照樣有禮物', (await foodTotal(page)) === food0 + 1)
    check('放著不動：沒接到不說「接到好多」以外的責備', !(await said(page, 'catch')).some((k) => !k.startsWith('pet.play.catch.')))
    await closeGift(page)
    await shot(page, 'catch-4-5-port-end')
    check('放著不動段沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 多指：第一根手指拖籃子，第二根不搶；放開後新手指可以接手。拖到邊邊不會出界；旋轉不壞；中途離開不留計時器、不記錄
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { stage: 'adult' })
    const send = await touchSender(ctx, page)
    await patchSettings(page, { ageBand: '4-5' })
    await page.evaluate(() => history.replaceState(null, '', '#playground'))
    await page.reload()
    await page.waitForSelector('.pg-grid')
    await page.waitForTimeout(600)
    const timers0 = await page.evaluate(() => window.__timers.size)
    const food0 = await foodTotal(page)
    await enter(page, 'catch', null, false)
    await page.waitForSelector('[data-testid=catch][data-band="4-5"]')
    await page.waitForTimeout(300)
    const near = async (x) => {
      await page.waitForTimeout(220)
      const s = await catchState(page)
      return Math.abs(s.basket.x - x) < 6
    }
    await send('touchStart', [pt(300, 400, 1)])
    check('碰畫面任何地方，籃子過去', await near(300))
    await send('touchMove', [pt(500, 400, 1)])
    check('拖曳：籃子跟著手指', await near(500))
    check('手勢示範碰了就消失', (await page.getByTestId('play-hand').count()) === 0)
    await send('touchStart', [pt(500, 400, 1), pt(900, 300, 2)])
    check('第二根手指不搶籃子', await near(500))
    await send('touchMove', [pt(500, 400, 1), pt(950, 300, 2)])
    check('第二根手指動也不搶', await near(500))
    await send('touchEnd', [])
    await send('touchStart', [pt(800, 400, 3)])
    check('放開後新手指接手', await near(800))
    await send('touchMove', [pt(1179, 400, 3)])
    await page.waitForTimeout(220)
    let s = await catchState(page)
    check('拖到右邊邊：籃子不出界', s.basket.right <= s.w + 0.5, `${s.basket.right}`)
    await send('touchMove', [pt(1, 400, 3)])
    await page.waitForTimeout(220)
    s = await catchState(page)
    check('拖到左邊邊：籃子不出界', s.basket.left >= -0.5, `${s.basket.left}`)
    await send('touchEnd', [])
    // 碰在籃子上不會跳：手指和籃子的相對位置不變
    await send('touchStart', [pt(s.basket.right - 10, s.basket.y + 30, 4)])
    await page.waitForTimeout(220)
    const s2 = await catchState(page)
    check('碰在籃子上：籃子不跳', Math.abs(s2.basket.x - s.basket.x) < 4, `${s.basket.x} → ${s2.basket.x}`)
    await send('touchEnd', [])

    // 旋轉：籃子留在畫面內、沒有橫向捲動、水果還在掉
    await page.setViewportSize(SIZES.port)
    await page.waitForTimeout(400)
    s = await catchState(page)
    check('旋轉成直向：籃子在畫面內', s.basket.left >= -0.5 && s.basket.right <= s.w + 0.5)
    check('旋轉成直向：籃子還在底部', s.basket.y > s.h * 0.6)
    check('旋轉成直向：沒有橫向捲動', await noOverflow(page))
    await page.setViewportSize(SIZES.phone)
    await page.waitForTimeout(400)
    s = await catchState(page)
    check('縮成手機：籃子在畫面內', s.basket.left >= -0.5 && s.basket.right <= s.w + 0.5)
    await page.setViewportSize(SIZES.land)
    await page.waitForTimeout(300)

    // 中途離開
    const before = await catchState(page)
    check('離開前回合還沒結束', !before.ended)
    await page.getByTestId('game-back').click()
    await page.waitForSelector('.pg-grid')
    // Dexie 的 liveQuery 取消訂閱後有自己的一次性 3 秒快取清理計時器，不是玩法留下的，等它走完再比
    await page.waitForTimeout(3300)
    const timers1 = await page.evaluate(() => window.__timers.size)
    check('中途離開：計時器清乾淨', timers1 <= timers0, `${timers0} → ${timers1}`)
    const st = await settings(page)
    check('中途離開：不記錄、不送、不扣', st.playBest?.catch === undefined && (await foodTotal(page)) === food0)
    check('拖曳段沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 速度：真的是越大越快（看水果掉一段要多久），動作減少也能玩
  for (const age of ['3', '6-7']) {
    const { ctx, page } = await freshApp(browser, SIZES.land, { stage: 'adult' })
    await enter(page, 'catch', age)
    const speed = await page.evaluate(
      () =>
        new Promise((res) => {
          const t0 = performance.now()
          const iv = setInterval(() => {
            const el = [...document.querySelectorAll('[data-testid=catch-fruit]')].find((e) => getComputedStyle(e).display !== 'none')
            if (!el) {
              if (performance.now() - t0 > 6000) {
                clearInterval(iv)
                res(0)
              }
              return
            }
            clearInterval(iv)
            const y0 = el.getBoundingClientRect().top
            const t1 = performance.now()
            setTimeout(() => res((el.getBoundingClientRect().top - y0) / ((performance.now() - t1) / 1000)), 700)
          }, 30)
        }),
    )
    seen[age] = speed
    await ctx.close()
  }
  check('6–7 歲掉得比 3 歲快', seen['6-7'] > seen['3'] * 1.4, `${Math.round(seen['3'])} vs ${Math.round(seen['6-7'])} px/s（設定 ${FALL['3']} / ${FALL['6-7']} ms）`)

  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { stage: 'adult', ctxOpts: { reducedMotion: 'reduce' } })
    const send = await touchSender(ctx, page)
    await enter(page, 'catch', '6-7')
    const lag = await playRound(page, send)
    const n = Number(await page.getByTestId('catch-end-num').textContent())
    check('動作減少：接水果照樣玩完', n >= 5, `${n} 顆，${lag}`)
    check('動作減少段沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

// ---------- 翻翻配對 ----------
const cards = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid=memory-card]')].map((el, i) => {
      const r = el.getBoundingClientRect()
      return { i, face: el.dataset.face, state: el.dataset.state, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }),
  )
/**
 * 蓋著的牌真的看不到牌面（比像素，不是比 data-state）：每張蓋著的牌中央截一塊，應該幾乎一模一樣。
 * WebKit 曾經 data-state 全對、畫面上牌面卻全露出來，這條就是防那個。
 * 容許差 4/255：翻過又翻回來的牌重新點陣化時，漸層抖色會差 1/255（量過），牌面露出來則是差上百。
 */
async function downCardsLookSame(page) {
  await page.waitForTimeout(450) // 等翻牌轉場走完
  const list = (await cards(page)).filter((c) => c.state === 'down')
  const shots = []
  for (const c of list) {
    const clip = { x: c.left + Math.floor(c.w * 0.25), y: c.top + Math.floor(c.h * 0.25), width: Math.floor(c.w * 0.5), height: Math.floor(c.h * 0.5) }
    shots.push((await page.screenshot({ clip })).toString('base64'))
  }
  const maxDiff = await page.evaluate(async (b64s) => {
    const read = async (b) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b}`
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const g = cv.getContext('2d', { willReadFrequently: true })
      g.drawImage(img, 0, 0)
      return g.getImageData(0, 0, cv.width, cv.height).data
    }
    const first = await read(b64s[0])
    let max = 0
    for (const b of b64s.slice(1)) {
      const d = await read(b)
      if (d.length !== first.length) return 255
      for (let i = 0; i < d.length; i++) max = Math.max(max, Math.abs(d[i] - first[i]))
    }
    return max
  }, shots)
  return { n: shots.length, maxDiff, same: maxDiff <= 4 }
}
const tapCard = (send, c, id = 1) => tapAll(send, [pt(c.x, c.y, id)])
const waitAllDown = (page) => page.waitForFunction(() => ![...document.querySelectorAll('[data-testid=memory-card]')].some((c) => c.dataset.state === 'up'), null, { timeout: 4000 })
const pairs = (list) => {
  const by = {}
  for (const c of list) (by[c.face] ??= []).push(c)
  return Object.values(by)
}

async function clearBoard(page, send) {
  for (const [a, b] of pairs(await cards(page))) {
    if (a.state === 'matched') continue
    await tapCard(send, a)
    await page.waitForTimeout(30)
    await tapCard(send, b)
    // 配對成功也要等翻牌動作做完才能翻下一張（MEMORY_MATCH_MS）
    await page.waitForTimeout(520)
    await waitAllDown(page)
  }
}

async function testMemory(browser) {
  for (const age of AGES) {
    const { ctx, page, errors } = await freshApp(browser, age === '3' ? SIZES.phone : SIZES.land, { stage: 'adult' })
    const send = await touchSender(ctx, page)
    const food0 = await foodTotal(page)
    await enter(page, 'memory', age)
    await page.waitForSelector('[data-testid=memory-card]')
    let list = await cards(page)
    check(`配對 ${age}：${CARDS[age]} 張`, list.length === CARDS[age])
    check(`配對 ${age}：開始都蓋著`, list.every((c) => c.state === 'down'))
    check(`配對 ${age}：有寵物牌`, list.filter((c) => c.face === 'pet').length === 2)
    check(`配對 ${age}：每種兩張`, pairs(list).every((p) => p.length === 2))
    check(`配對 ${age}：開場有手勢示範`, (await page.getByTestId('play-hand').count()) === 1)

    // 翻錯：動作中第三張不算，等一下翻回去；連續翻錯只說第一次
    const [p1, p2] = pairs(list)
    await tapCard(send, p1[0])
    await page.waitForTimeout(30)
    check(`配對 ${age}：翻一張`, (await cards(page))[p1[0].i].state === 'up')
    check(`配對 ${age}：手勢示範碰了就消失`, (await page.getByTestId('play-hand').count()) === 0)
    await tapCard(send, p2[0])
    await page.waitForTimeout(30)
    list = await cards(page)
    check(`配對 ${age}：翻第二張不一樣`, list[p1[0].i].state === 'up' && list[p2[0].i].state === 'up')
    check(`配對 ${age}：說 miss`, (await said(page, 'memory')).filter((k) => k === 'pet.play.memory.miss').length === 1)
    await tapCard(send, p1[1])
    await page.waitForTimeout(30)
    check(`配對 ${age}：動作中不能翻第三張`, (await cards(page))[p1[1].i].state === 'down')
    await page.waitForTimeout(450)
    await flush(page)
    await shot(page, `memory-${age}-miss`)
    await waitAllDown(page)
    check(`配對 ${age}：翻回去了`, (await cards(page)).every((c) => c.state === 'down'))
    // 這時手勢示範已經消失、全部蓋著：每張看起來要一模一樣
    const look = await downCardsLookSame(page)
    check(`配對 ${age}：蓋著的牌看不到牌面（比像素）`, look.n === CARDS[age] && look.same, `${look.n} 張，最大差 ${look.maxDiff}/255`)
    await tapCard(send, p1[0])
    await page.waitForTimeout(30)
    await tapCard(send, p2[0])
    await page.waitForTimeout(30)
    check(`配對 ${age}：連續翻錯只說第一次`, (await said(page, 'memory')).filter((k) => k === 'pet.play.memory.miss').length === 1)
    await waitAllDown(page)
    // 點同一張兩次不算翻兩張
    await tapCard(send, p1[0])
    await page.waitForTimeout(30)
    await tapCard(send, p1[0])
    await page.waitForTimeout(30)
    check(`配對 ${age}：同一張點兩次不算`, (await cards(page)).filter((c) => c.state === 'up').length === 1)
    // 翻對：留著、亮一下、說 match
    await tapCard(send, p1[1])
    await page.waitForTimeout(30)
    list = await cards(page)
    check(`配對 ${age}：一樣的留著`, list[p1[0].i].state === 'matched' && list[p1[1].i].state === 'matched')
    const end2 = age === '3'
    if (!end2) check(`配對 ${age}：說 match`, (await said(page, 'memory')).includes('pet.play.memory.match'))
    await waitAllDown(page)
    await page.waitForTimeout(450)
    await tapCard(send, p1[0])
    await page.waitForTimeout(30)
    check(`配對 ${age}：配好的不能再翻`, (await cards(page))[p1[0].i].state === 'matched' && (await cards(page)).filter((c) => c.state === 'up').length === 0)
    await flush(page)
    await shot(page, `memory-${age}-mid`)
    check(`配對 ${age}：沒有星等或時間相關字樣`, !/秒|步|分數|★/.test(await page.getByTestId('memory').innerText()))

    // 全部翻完
    await clearBoard(page, send)
    await page.waitForSelector('[data-testid=memory][data-won=true]')
    check(`配對 ${age}：翻完說 done`, (await said(page, 'memory')).includes('pet.play.memory.done'))
    await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
    check(`配對 ${age}：送一份禮物`, (await foodTotal(page)) === food0 + 1)
    await shot(page, `memory-${age}-gift`)
    await closeGift(page)
    await page.waitForTimeout(600)
    await flush(page)
    await shot(page, `memory-${age}-won`)
    check(`配對 ${age}：再玩一次夠大且在畫面內`, await page.getByTestId('play-again').evaluate((el) => {
      const r = el.getBoundingClientRect()
      return r.height >= 56 && r.width >= 56 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth
    }))
    // 再玩一次：重新洗牌，都蓋著，再翻完不再送
    await page.getByTestId('play-again').click()
    await page.waitForFunction(() => document.querySelector('[data-testid=memory]').dataset.won === 'false')
    list = await cards(page)
    check(`配對 ${age}：再玩一次全部蓋著`, list.length === CARDS[age] && list.every((c) => c.state === 'down'))
    await clearBoard(page, send)
    await page.waitForSelector('[data-testid=memory][data-won=true]')
    await page.waitForTimeout(1800)
    check(`配對 ${age}：第二局不再送`, (await page.getByTestId('play-gift').count()) === 0 && (await foodTotal(page)) === food0 + 1)
    check(`配對 ${age}：沒有錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 多指、3D 翻轉、旋轉、離開時正在等翻回去、缺圖
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { stage: 'adult' })
    const send = await touchSender(ctx, page)
    await patchSettings(page, { ageBand: '6-7' })
    await page.evaluate(() => history.replaceState(null, '', '#playground'))
    await page.reload()
    await page.waitForSelector('.pg-grid')
    await page.waitForTimeout(600)
    const timers0 = await page.evaluate(() => window.__timers.size)
    await enter(page, 'memory', null, false)
    await page.waitForSelector('[data-testid=memory][data-band="6-7"] [data-testid=memory-card]')
    let list = await cards(page)
    check('橫向 12 張排 4×3', (await attr(page, 'memory', 'cols')) === '4' && (await attr(page, 'memory', 'rows')) === '3')

    // 三根手指同時：只翻兩張
    await tapAll(send, list.slice(0, 3).map((c, i) => pt(c.x, c.y, i + 1)))
    await page.waitForTimeout(30)
    const upNow = (await cards(page)).filter((c) => c.state !== 'down').length
    check('多指：三根手指同時碰只翻兩張', upNow === 2, `${upNow} 張`)
    await page.waitForTimeout(450)
    await flush(page)
    const tf = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=memory-card]:not([data-state=down]) .pg-mem-inner')
      return c ? getComputedStyle(c).transform : ''
    })
    check('翻牌是 3D（rotateY）', /^matrix3d/.test(tf), tf.slice(0, 40))
    await shot(page, 'memory-6-7-flipped')
    await waitAllDown(page)

    // 旋轉：排法跟著變，卡片都在畫面內，翻到一半的狀態留著
    list = await cards(page)
    const faceOf = pairs(list)[0]
    await tapCard(send, faceOf[0])
    await page.waitForTimeout(30)
    await page.setViewportSize(SIZES.port)
    await page.waitForTimeout(300)
    check('直向 12 張排 3×4', (await attr(page, 'memory', 'cols')) === '3' && (await attr(page, 'memory', 'rows')) === '4')
    list = await cards(page)
    check('旋轉：翻開的牌還是翻開', list[faceOf[0].i].state === 'up')
    check('旋轉：卡片都在畫面內', list.every((c) => c.left >= 0 && c.right <= 820 && c.top >= 0 && c.bottom <= 1180))
    check('旋轉：沒有橫向捲動', await noOverflow(page))
    await page.setViewportSize(SIZES.land)
    await page.waitForTimeout(300)
    list = await cards(page)
    await tapCard(send, list.find((c) => c.state === 'down' && c.face !== list[faceOf[0].i].face))
    await page.waitForTimeout(30)

    // 正在等翻回去時離開：計時器清乾淨
    await page.getByTestId('game-back').click()
    await page.waitForSelector('.pg-grid')
    // Dexie 的 liveQuery 取消訂閱後有自己的一次性 3 秒快取清理計時器，不是玩法留下的，等它走完再比
    await page.waitForTimeout(3300)
    const timers1 = await page.evaluate(() => window.__timers.size)
    check('離開：計時器清乾淨', timers1 <= timers0, `${timers0} → ${timers1}`)
    check('多指段沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 食物圖全部缺：退回 emoji，不破版
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.port, { stage: 'adult' })
    const send = await touchSender(ctx, page)
    await page.route('**/art/food-*.png', (r) => r.abort())
    await enter(page, 'memory', '4-5')
    await page.waitForSelector('[data-testid=memory-card]')
    const list = await cards(page)
    const food = list.find((c) => c.face !== 'pet')
    await tapCard(send, food)
    await page.waitForTimeout(600)
    await flush(page)
    const size = await page.locator('[data-testid=memory-card][data-state=up] .pg-mem-front').boundingBox()
    check('缺圖：牌面還是有東西', (await page.locator('[data-testid=memory-card][data-state=up] .art-emoji-glyph').textContent()).length > 0)
    check('缺圖：卡片大小沒變', !!size && Math.abs(size.width - food.w) < 2)
    await shot(page, 'memory-noart')
    await page.unroute('**/art/food-*.png')
    check('缺圖段沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 動作減少
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.phone, { stage: 'adult', ctxOpts: { reducedMotion: 'reduce' } })
    const send = await touchSender(ctx, page)
    await enter(page, 'memory', '3')
    await page.waitForSelector('[data-testid=memory-card]')
    const dur = await page.evaluate(() => getComputedStyle(document.querySelector('.pg-mem-inner')).transitionDuration)
    check('動作減少：翻牌沒有轉場', parseFloat(dur) < 0.01, dur)
    await clearBoard(page, send)
    await page.waitForSelector('[data-testid=memory][data-won=true]')
    check('動作減少：配對照樣玩完', true)
    check('動作減少段沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

// ---------- 三尺寸 × 三年齡的版面 ----------
async function testLayout(browser) {
  for (const [name, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp, { stage: 'adult' })
    for (const age of AGES) {
      // 泡泡
      await enter(page, 'bubbles', age)
      await page.waitForTimeout(900)
      await flush(page)
      const bs = await page.evaluate(() => [...document.querySelectorAll('[data-bubble]')].map((el) => el.getBoundingClientRect().width))
      check(`版面 ${name} ${age} 泡泡：每顆 ≥ 56px`, bs.length > 0 && bs.every((d) => d >= 56), bs.map(Math.round).join())
      check(`版面 ${name} ${age} 泡泡：沒有橫向捲動`, await noOverflow(page))
      check(`版面 ${name} ${age} 泡泡：回去鍵`, await backOk(page))
      await shot(page, `layout-${name}-${age}-bubbles`)
      // 接水果
      await enter(page, 'catch', age)
      await page.waitForTimeout(400)
      const c = await catchState(page)
      check(`版面 ${name} ${age} 接水果：籃子 ≥ 56px 且在畫面內`, c.basket.w >= 56 && c.basket.left >= -0.5 && c.basket.right <= vp.width + 0.5, `${Math.round(c.basket.w)}px`)
      check(`版面 ${name} ${age} 接水果：沒有橫向捲動`, await noOverflow(page))
      check(`版面 ${name} ${age} 接水果：回去鍵`, await backOk(page))
      await page.waitForTimeout(2600)
      await shot(page, `layout-${name}-${age}-catch`)
      // 配對
      await enter(page, 'memory', age)
      await page.waitForSelector('[data-testid=memory-card]')
      await page.waitForTimeout(200)
      const list = await cards(page)
      check(`版面 ${name} ${age} 配對：${CARDS[age]} 張`, list.length === CARDS[age])
      check(`版面 ${name} ${age} 配對：每張 ≥ 56px`, list.every((k) => k.w >= 56 && k.h >= 56), `${Math.round(list[0].w)}×${Math.round(list[0].h)}`)
      check(`版面 ${name} ${age} 配對：都在畫面內`, list.every((k) => k.left >= 0 && k.right <= vp.width && k.top >= 0 && k.bottom <= vp.height))
      const cover = await page.evaluate(() => {
        const back = document.querySelector('[data-testid=game-back]').getBoundingClientRect()
        const pet = document.querySelector('[data-testid=memory-pet]').getBoundingClientRect()
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
        return [...document.querySelectorAll('[data-testid=memory-card]')].filter((c) => {
          const r = c.getBoundingClientRect()
          return hit(r, back) || hit(r, pet)
        }).length
      })
      check(`版面 ${name} ${age} 配對：回去鍵與寵物不蓋牌`, cover === 0, `${cover} 張被蓋`)
      const used = await page.evaluate(() => {
        const rs = [...document.querySelectorAll('[data-testid=memory-card]')].map((c) => c.getBoundingClientRect())
        const w = Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left))
        const h = Math.max(...rs.map((r) => r.bottom)) - Math.min(...rs.map((r) => r.top))
        return (w * h) / (innerWidth * innerHeight)
      })
      check(`版面 ${name} ${age} 配對：牌桌占滿大部分畫面`, used >= 0.5, `${Math.round(used * 100)}%`)
      check(`版面 ${name} ${age} 配對：沒有橫向捲動`, await noOverflow(page))
      await shot(page, `layout-${name}-${age}-memory`)
    }
    check(`版面 ${name}：沒有錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

const browser = await launch()
try {
  if (on('layout')) await testLayout(browser)
  if (on('bubbles')) await testBubbles(browser)
  if (on('catch')) await testCatch(browser)
  if (on('memory')) await testMemory(browser)
} finally {
  await browser.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
