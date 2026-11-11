// v8.4 線 Y E2E：快樂小街的超市、果汁攤。v8.5 加上新玩具（用 playCount 設定玩完幾次；每個都測「沒有」和「有」）：
//   超市：玩完 1 次貨架和清單多四種新商品；玩完 3 次多切換按鈕可以當老闆（拖過掃描器、收硬幣、6–7 歲找錢）。
//   果汁攤：玩完 1 次多草莓和橘子；玩完 3 次倒好之後可以加吸管、小雨傘、冰塊，有加客人更開心。
// 三種尺寸 × 三個年齡檔、不橫向溢出、觸控目標、寵物不擋操作；
// 超市：清單依年齡（2/3/4 種）、3 歲點了就飛進車、4 歲以上要拖、放外面飛回、兩指同時放、打勾、
//       拿錯的結帳時問（放回 / 留下）、收銀台一個一個嗶、價錢（點點 / 數字）算對、投不夠就等、投多找零算對、
//       買的東西不進背包也不扣星星、禮物只送一次、再買一次換下一張清單；
// 果汁攤：客人固定順序、點單種類依年齡、拖 / 點水果進果汁機、按下去轉、倒進杯子、拖給客人或點客人、
//         做錯會喝但表情好笑再點一次、6–7 歲泡泡 4 秒收起來點客人再出現、一回 3 位、禮物、再一回接著輪。
// 用法：先啟動 dev server（pnpm exec vite --port 5202 --strictPort），再
//   BASE_URL=http://localhost:5202 node scripts/e2e-town-y.mjs       （或 pnpm e2e:town-y；E2E_BROWSER=webkit 改用 WebKit）
//   想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-town-y.mjs（不要放 repo 裡）
import { mkdirSync } from 'node:fs'
import { freshApp, getPet, idb, IS_WEBKIT, launch, makeChecker, touchSender } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const SHOT_DIR = process.env.SHOT_DIR
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
const browserTag = IS_WEBKIT ? 'webkit' : 'chromium'
const shot = async (page, name) => {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}-${browserTag}.png` })
}
const TOUCH = { ctxOpts: { hasTouch: true } }
/** 超市 6–7 歲的單價（跟 domain/market.ts 對照：這裡另外寫一份，畫面算錯就抓得到） */
const PRICE = { carrot: 1, cookie: 2, banana: 2, apple: 3, grape: 4, milk: 3, peach: 4, riceball: 3, watermelon: 5, cake: 5, balloon: 2, ball: 4, toothbrush: 2, soap: 3 }
/** v8.5 玩完 1 次之後貨架上多出來的新商品（不是食物） */
const GOODS = ['balloon', 'ball', 'toothbrush', 'soap']
const osc = (page) => page.evaluate(() => window.__audio.osc)
const settings = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))

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
/** 設年齡後直接進玩法（用 replaceState 再 reload：不觸發 hashchange，WebKit 不會報 lazy import 被打斷）。plays = 這個地方玩完幾次（v8.5：決定有幾個新玩具） */
const enter = async (page, game, age, plays = 0) => {
  await patchSettings(page, { ageBand: age, ...(plays ? { playCount: { [game]: plays } } : {}) })
  await page.evaluate((g) => history.replaceState(null, '', `#game/${g}`), game)
  await page.reload()
  await page.waitForSelector(`[data-testid=${game}][data-band="${age}"]`)
  await sleep(page, 300)
}
const data = (page, game, name) => page.evaluate(([g, n]) => document.querySelector(`[data-testid=${g}]`)?.dataset[n] ?? null, [game, name])
const said = async (page, game) => ((await data(page, game, 'said')) ?? '').split(' ').filter(Boolean).map((x) => x.replace(`pet.play.${game}.`, ''))
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
      if (r.width && (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)) bad.push(el.dataset.testid ?? el.className)
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
          if (p.width && q.width && p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1) out.push(`${x.dataset.testid ?? x.className}×${y.dataset.testid ?? y.className}`)
        }
      return out
    },
    [a, b],
  )
/** 每個元素的中心點，最上面的就是它自己（沒有被寵物或別的東西蓋住） */
const covered = (page, sel) =>
  page.evaluate((sel) => {
    const out = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (!r.width) continue
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!el.contains(top)) out.push(`${el.dataset.testid}←${top?.dataset?.testid ?? top?.className}`)
    }
    return out
  }, sel)
const inventory = (page) => idb(page, (db) => new Promise((r) => (db.transaction('inventory').objectStore('inventory').getAll().onsuccess = (e) => r(Object.fromEntries(e.target.result.map((x) => [x.id, x.qty]))))))
const ledgerCount = (page) => idb(page, (db) => new Promise((r) => (db.transaction('ledger').objectStore('ledger').count().onsuccess = (e) => r(e.target.result))))
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)
const realErrors = (errors) => errors.filter((e) => !(/validateDOMNesting/.test(e) && /GameShell/.test(e)))
const closeGift = async (page) => {
  await page.waitForTimeout(550) // 禮物剛跳出來的 0.5 秒不接受點擊
  await page.getByTestId('play-gift').tap()
}

// ======================= 超市 =======================
const parseList = (s) => s.split(',').map((x) => ({ id: x.split(':')[0], qty: Number(x.split(':')[1]) }))
const cartCount = async (page) => Number(await page.getByTestId('mkt-cart').getAttribute('data-count'))

/** 把一個東西放進購物車：3 歲點，其他拖 */
async function putInCart(page, send, id, band) {
  const from = await centerOf(page, `[data-testid=mkt-food-${id}]`)
  if (band === '3') return fingerTap(send, from)
  const cart = await centerOf(page, '[data-testid=mkt-cart]')
  await fingerDrag(send, from, cart)
}

async function testMarket(b, name, vp, band) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `超市[${name}/${band}]`
  await enter(page, 'market', band)
  const inv0 = await inventory(page)
  const led0 = await ledgerCount(page)
  const pet0 = await getPet(page)
  const list = parseList(await data(page, 'market', 'list'))
  const kinds = { 3: 2, '4-5': 3, '6-7': 4 }[band]
  check(`${tag} 清單 ${kinds} 種`, list.length === kinds && (await page.getByTestId('mkt-line').count()) === kinds, JSON.stringify(list))
  check(`${tag} 清單只有圖（沒有字）`, (await page.getByTestId('mkt-list').innerText()).trim() === '')
  const units = list.reduce((s, l) => s + l.qty, 0)
  check(`${tag} 同一種要 2 個時畫 2 個圖`, (await page.locator('.mkt-line-pic').count()) === units)
  check(`${tag} 貨架 ${band === '3' ? 8 : 10} 種`, (await page.locator('[data-testid^=mkt-food-]').count()) === (band === '3' ? 8 : 10))
  check(`${tag}（沒有新玩具）貨架和清單都沒有新商品、沒有切換按鈕`, (await page.locator(GOODS.map((g) => `[data-testid=mkt-food-${g}]`).join(', ')).count()) === 0 && !list.some((l) => GOODS.includes(l.id)) && (await page.getByTestId('mkt-mode').count()) === 0)
  const tags = await page.locator('[data-testid=mkt-shelf] [data-testid=mkt-tag]').count()
  check(`${tag} 價錢牌：3 歲沒有、其他每樣都有`, band === '3' ? tags === 0 : tags === (await page.locator('[data-testid^=mkt-food-]').count()))
  if (band === '6-7') {
    const shown = await page.locator('[data-testid=mkt-food-cake] [data-testid=mkt-tag]').innerText()
    check(`${tag} 貨架上的價錢是數字`, shown.trim() === String(PRICE.cake), shown)
  }
  check(`${tag} 不橫向溢出`, await noOverflowX(page))
  check(`${tag} 觸控目標 ≥ 56`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join())
  const inside = await allInside(page, '[data-testid=mkt-list], [data-testid^=mkt-food-], [data-testid=mkt-cart], [data-testid=mkt-register], [data-testid=mkt-pet]')
  check(`${tag} 都在畫面內`, inside.length === 0, inside.join())
  const clash = await overlaps(page, '[data-testid=mkt-pet], [data-testid=mkt-list]', '[data-testid=mkt-shelf], [data-testid=mkt-cart], [data-testid=mkt-register], [data-testid=game-back]')
  check(`${tag} 寵物、清單不擋貨架購物車收銀台回去鍵`, clash.length === 0, clash.join())
  const hidden = await covered(page, '[data-testid^=mkt-food-], [data-testid=mkt-register]')
  check(`${tag} 貨架與收銀台都點得到`, hidden.length === 0, hidden.join())
  check(`${tag} 第一次有手勢示範`, (await page.getByTestId('gesture-hint').count()) === 1)
  await shot(page, `market-1-shop-${name}-${band}`)

  // 點一下：3 歲直接飛進車裡；4 歲以上不會進去，手勢再示範
  const first = list[0].id
  await fingerTap(send, await centerOf(page, `[data-testid=mkt-food-${first}]`))
  await sleep(page, 120)
  if (band === '3') {
    check(`${tag} 3 歲點一下就放進購物車`, (await cartCount(page)) === 1)
    check(`${tag} 3 歲點的有飛過去`, (await page.getByTestId('ys-flyer').count()) >= 1)
  } else {
    check(`${tag} 4 歲以上點一下不會放進去`, (await cartCount(page)) === 0)
    check(`${tag} 點一下會再示範怎麼拖`, (await page.getByTestId('gesture-hint').count()) === 1)
    // 拖進去
    await putInCart(page, send, first, band)
    await sleep(page, 120)
    check(`${tag} 拖進購物車`, (await cartCount(page)) === 1)
  }
  check(`${tag} 放了之後示範消失`, (await page.getByTestId('gesture-hint').count()) === 0)
  check(`${tag} 第一次放進去寵物說 add`, (await said(page, 'market')).includes('add'))

  // 放在外面：飛回去，不算
  const away = await centerOf(page, '[data-testid=mkt-list]')
  await fingerDrag(send, await centerOf(page, `[data-testid=mkt-food-${first}]`), away)
  await sleep(page, 60)
  check(`${tag} 放在購物車外不算`, (await cartCount(page)) === 1)
  check(`${tag} 放外面的會飛回去`, (await page.locator('[data-testid=ys-ghost][data-back]').count()) === 1)
  await sleep(page, 450)
  check(`${tag} 飛回去後消失`, (await page.getByTestId('ys-ghost').count()) === 0)
  // 拖到一半被系統打斷：不留鬼影、不算
  await fingerDrag(send, await centerOf(page, `[data-testid=mkt-food-${first}]`), await centerOf(page, '[data-testid=mkt-cart]'), { end: 'touchCancel' })
  await sleep(page, 80)
  check(`${tag} 拖到一半被打斷：沒有鬼影也沒放進去`, (await page.getByTestId('ys-ghost').count()) === 0 && (await cartCount(page)) === 1)

  // 清單上剩下的（兩根手指同時放兩個）
  const rest = list.flatMap((l) => Array(l.qty).fill(l.id)).slice(1)
  if (band !== '3' && rest.length >= 2) {
    const [a, c] = rest.splice(0, 2)
    const pa = await centerOf(page, `[data-testid=mkt-food-${a}]`)
    const pc = await centerOf(page, `[data-testid=mkt-food-${c}]`)
    const cart = await centerOf(page, '[data-testid=mkt-cart]')
    const t1 = { x: cart.x - cart.box.width * 0.2, y: cart.y }
    const t2 = { x: cart.x + cart.box.width * 0.2, y: cart.y }
    await send('touchStart', [pt(pa, 0), pt(pc, 1)])
    for (let i = 1; i <= 6; i++) await send('touchMove', [pt({ x: pa.x + ((t1.x - pa.x) * i) / 6, y: pa.y + ((t1.y - pa.y) * i) / 6 }, 0), pt({ x: pc.x + ((t2.x - pc.x) * i) / 6, y: pc.y + ((t2.y - pc.y) * i) / 6 }, 1)])
    await send('touchEnd', [])
    await sleep(page, 120)
    check(`${tag} 兩根手指同時放兩個`, (await cartCount(page)) === 3, String(await cartCount(page)))
  }
  for (const id of rest) {
    await putInCart(page, send, id, band)
    await sleep(page, 80)
  }
  const doneLines = await page.locator('[data-testid=mkt-line][data-done="1"]').count()
  check(`${tag} 清單全部打勾`, doneLines === kinds && (await cartCount(page)) === units, `${doneLines}/${kinds}`)
  check(`${tag} 買齊了收銀台發亮`, (await page.getByTestId('mkt-register').getAttribute('data-ready')) === '1')

  // 拿一個清單外的（放得下才放；6–7 歲總價會超過 20 時購物車不收）
  const onShelf = await page.locator('[data-testid^=mkt-food-]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('mkt-food-', '')))
  const extra = onShelf.filter((f) => !list.some((l) => l.id === f)).sort((x, y) => PRICE[x] - PRICE[y])[0]
  const listTotal = list.reduce((s, l) => s + PRICE[l.id] * l.qty, 0)
  const fits = band === '6-7' ? listTotal + PRICE[extra] <= 20 && units < 6 : units < (band === '4-5' ? 5 : 6)
  await putInCart(page, send, extra, band)
  await sleep(page, 120)
  check(`${tag} 清單外的也能放（放得下時）`, (await cartCount(page)) === units + (fits ? 1 : 0), `fits=${fits}`)
  if (band === '4-5') {
    // 4–5 歲最多 5 個：再放不進去，東西飛回去
    while ((await cartCount(page)) < 5) await putInCart(page, send, extra, band)
    await putInCart(page, send, extra, band)
    await sleep(page, 80)
    check(`${tag} 購物車滿了（5 個）再放會飛回去`, (await cartCount(page)) === 5 && (await page.locator('[data-testid=ys-ghost][data-back]').count()) === 1)
    await sleep(page, 400)
  }
  const cartNow = (await data(page, 'market', 'cart')).split(',')
  await shot(page, `market-2-cart-${name}-${band}`)

  // 結帳
  await page.getByTestId('mkt-register').tap()
  const hasExtra = cartNow.length > units
  if (hasExtra) {
    await page.waitForSelector('[data-testid=mkt-extra]')
    check(`${tag} 結帳時寵物問「這個也想要嗎」`, (await said(page, 'market')).includes('extra'))
    check(`${tag} 只列出清單外的`, (await page.getByTestId('mkt-extra-item').count()) === cartNow.length - units)
    check(`${tag} 問的時候觸控目標 ≥ 56`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join())
    check(`${tag} 問的時候不溢出`, (await allInside(page, '[data-testid=mkt-extra-back], [data-testid=mkt-extra-keep]')).length === 0)
    await shot(page, `market-3-extra-${name}-${band}`)
    // 6–7 歲放回去、其他留下（兩個都測到）
    await page.getByTestId(band === '6-7' ? 'mkt-extra-back' : 'mkt-extra-keep').tap()
  }
  const bought = band === '6-7' && hasExtra ? cartNow.slice(0, units) : cartNow
  await page.waitForSelector('[data-testid=mkt-counter]')
  check(`${tag} 收銀台上是要買的東西`, (await page.getByTestId('mkt-belt-item').count()) === bought.length, `${await page.getByTestId('mkt-belt-item').count()} vs ${bought.length}`)
  // 一個一個嗶過去
  const seen = new Set()
  for (let i = 0; i < 60; i++) {
    seen.add(await page.locator('[data-testid=mkt-belt-item][data-scanned="1"]').count())
    if ((await data(page, 'market', 'phase')) === 'pay') break
    await sleep(page, 90)
  }
  check(`${tag} 一個一個嗶過去`, [...seen].length >= Math.min(3, bought.length), [...seen].join())
  await page.waitForSelector('[data-testid=market][data-phase=pay]')
  check(`${tag} 嗶完寵物說要付錢`, (await said(page, 'market')).includes('pay'))
  const bill = Number(await data(page, 'market', 'bill'))
  const expectBill = band === '3' ? 1 : band === '4-5' ? bought.length : bought.reduce((s, id) => s + PRICE[id], 0)
  check(`${tag} 價錢算對`, bill === expectBill, `${bill} vs ${expectBill}`)
  if (band === '4-5') {
    check(`${tag} 4–5 歲價錢是點點`, (await page.getByTestId('mkt-bill-dot').count()) === bill && bill >= 1 && bill <= 5)
    check(`${tag} 4–5 歲只有 1 元硬幣`, (await page.locator('[data-testid^=mkt-coin-]').count()) === 1 && (await page.getByTestId('mkt-coin-1').count()) === 1)
  }
  if (band === '6-7') {
    check(`${tag} 6–7 歲價錢是數字（5–20）`, (await page.getByTestId('mkt-bill-num').innerText()).trim() === String(bill) && bill >= 5 && bill <= 20)
    check(`${tag} 6–7 歲有 1、5、10 元`, (await page.locator('[data-testid^=mkt-coin-]').count()) === 3)
  }
  check(`${tag} 付錢時觸控目標 ≥ 56`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join())
  const insidePay = await allInside(page, '[data-testid^=mkt-coin-], [data-testid=mkt-slot], [data-testid=mkt-display], [data-testid=mkt-belt]')
  check(`${tag} 付錢時都在畫面內`, insidePay.length === 0, insidePay.join())
  check(`${tag} 付錢時寵物不擋硬幣`, (await overlaps(page, '[data-testid=mkt-pet]', '[data-testid^=mkt-coin-], [data-testid=mkt-slot]')).length === 0)
  check(`${tag} 付錢時不溢出`, await noOverflowX(page))
  await shot(page, `market-4-pay-${name}-${band}`)

  const coin = (c) => page.getByTestId(`mkt-coin-${c}`).tap({ force: true })
  let paidCoins = []
  if (band === '3') {
    await coin(10)
    paidCoins = [10]
  } else if (band === '4-5') {
    for (let i = 0; i < bill - 1; i++) await coin(1)
    paidCoins = Array(bill - 1).fill(1)
    // 投不夠就等著：不催、不倒數
    const before = (await said(page, 'market')).length
    await sleep(page, 2500)
    check(`${tag} 投不夠就等著（不催）`, (await data(page, 'market', 'phase')) === 'pay' && (await said(page, 'market')).length === before)
    check(`${tag} 投一枚點點亮一個`, (await page.locator('[data-testid=mkt-bill-dot][data-on="1"]').count()) === bill - 1)
    await coin(1)
    paidCoins.push(1)
  } else {
    // 6–7 歲：一直投 10 元到夠（多的找零）
    while (paidCoins.reduce((a, c) => a + c, 0) < bill) {
      await coin(10)
      paidCoins.push(10)
      if (paidCoins.reduce((a, c) => a + c, 0) < bill) {
        await sleep(page, 200)
        check(`${tag} 投不夠還在等`, (await data(page, 'market', 'phase')) === 'pay')
        check(`${tag} 付了多少寫對`, Number(await data(page, 'market', 'paid')) === 10)
      }
    }
  }
  const paid = paidCoins.reduce((a, c) => a + c, 0)
  check(`${tag} 投了幾枚就顯示幾枚`, (await page.getByTestId('mkt-paid-coin').count()) === paidCoins.length)
  const change = band === '3' ? 0 : paid - bill
  if (change > 0) {
    await page.waitForSelector('[data-testid=mkt-change]')
    const back = await page.getByTestId('mkt-change-coin').evaluateAll((els) => els.map((e) => Number(e.innerText.trim() || e.querySelector('img')?.getAttribute('src')?.match(/coin-(\d+)/)?.[1])))
    check(`${tag} 找零算對（${paid} − ${bill} = ${change}）`, Number(await data(page, 'market', 'change')) === change && back.reduce((a, c) => a + c, 0) === change, back.join('+'))
    check(`${tag} 找零時寵物說 change`, (await said(page, 'market')).includes('change'))
    check(`${tag} 找零的硬幣在畫面內`, (await allInside(page, '[data-testid=mkt-change-coin]')).length === 0)
    await shot(page, `market-5-change-${name}-${band}`)
  } else check(`${tag} 沒多付就不找`, (await page.getByTestId('mkt-change').count()) === 0 && Number(await data(page, 'market', 'change')) === 0)
  await page.waitForSelector('[data-testid=market][data-phase=done]', { timeout: 5000 })
  check(`${tag} 買好了寵物說 done`, (await said(page, 'market')).at(-1) === 'done')
  check(`${tag} 不能再投`, (await page.locator('[data-testid^=mkt-coin-]').count()) === 0)
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  check(`${tag} 第一次買完有禮物`, true)
  await shot(page, `market-6-done-${name}-${band}`)
  const inv1 = await inventory(page)
  check(`${tag} 買的東西不進背包（只多禮物 1 個）`, sum(inv1) === sum(inv0) + 1 && Object.entries(inv0).every(([k, v]) => (inv1[k] ?? 0) >= v), `${sum(inv0)}→${sum(inv1)}`)
  check(`${tag} 不扣星星（流水帳沒變）`, (await ledgerCount(page)) === led0)
  const pet1 = await getPet(page)
  check(`${tag} 寵物狀態沒變`, pet1.hunger === pet0.hunger && pet1.feedCount === pet0.feedCount)
  check(`${tag} 玩完第 1 次，卡上有新玩具（新商品）`, (await page.getByTestId('play-toy').getAttribute('data-toy')) === 'goods')
  check(`${tag} 卡還沒收下，貨架還是原本的`, (await page.getByTestId('play-market').getAttribute('data-toys')) === '0')
  await closeGift(page)

  // 再買一次：換下一張清單，同一天不再送。v8.5：收下新玩具後，這一張清單和貨架多了新商品
  await page.getByTestId('play-again').tap()
  await page.waitForSelector('[data-testid=market][data-phase=shop][data-round="1"]')
  check(`${tag} 再買一次換下一張清單`, (await data(page, 'market', 'list')) !== list.map((l) => `${l.id}:${l.qty}`).join(','), await data(page, 'market', 'list'))
  check(`${tag} 再買一次購物車是空的`, (await cartCount(page)) === 0)
  const list2 = parseList(await data(page, 'market', 'list'))
  const shelf2 = await page.locator('[data-testid^=mkt-food-]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('mkt-food-', '')))
  check(`${tag} 新商品：貨架多四種（共 ${band === '3' ? 12 : 14} 種），排在食物後面`, shelf2.length === (band === '3' ? 12 : 14) && shelf2.slice(-4).join() === GOODS.join(), shelf2.join())
  check(`${tag} 新商品：清單上剛好一樣（最後一行），種類數不變`, list2.length === kinds && list2.filter((l) => GOODS.includes(l.id)).length === 1 && GOODS.includes(list2.at(-1).id), JSON.stringify(list2))
  // 新商品的圖還沒生好時畫的是 emoji（算文字）：把那四個 emoji 去掉之後不能有別的字
  const listText = (await page.getByTestId('mkt-list').innerText()).replace(/\u{1F388}|\u{26BD}|\u{1FAA5}|\u{1F9FC}|\u{FE0F}|\s/gu, '')
  check(`${tag} 新商品：清單上畫得出來（只有圖）`, (await page.locator(`[data-testid=mkt-line][data-id=${list2.at(-1).id}] .mkt-line-pic`).count()) === 1 && listText === '', listText)
  check(`${tag} 新商品：觸控目標 ≥ 56、都在畫面內、不溢出`, (await smallTargets(page)).length === 0 && (await allInside(page, '[data-testid^=mkt-food-], [data-testid=mkt-list], [data-testid=mkt-cart], [data-testid=mkt-register]')).length === 0 && (await noOverflowX(page)), (await smallTargets(page)).join())
  check(`${tag} 新商品：貨架不被寵物或清單擋住、每樣都點得到`, (await overlaps(page, '[data-testid=mkt-pet], [data-testid=mkt-list]', '[data-testid=mkt-shelf], [data-testid=mkt-cart], [data-testid=mkt-register], [data-testid=game-back]')).length === 0 && (await covered(page, '[data-testid^=mkt-food-], [data-testid=mkt-register]')).length === 0)
  if (band === '6-7') check(`${tag} 新商品：有價錢`, (await page.locator('[data-testid=mkt-food-ball] [data-testid=mkt-tag]').innerText()).trim() === String(PRICE.ball))
  check(`${tag} 只有第一個新玩具時沒有切換按鈕`, (await page.getByTestId('mkt-mode').count()) === 0)
  await shot(page, `market-7-goods-${name}-${band}`)
  // 這次只買那樣新商品
  await putInCart(page, send, list2.at(-1).id, band)
  await sleep(page, 100)
  check(`${tag} 新商品放得進購物車、清單那一行打勾`, (await cartCount(page)) === 1 && (await page.locator(`[data-testid=mkt-line][data-id=${list2.at(-1).id}][data-done="1"]`).count()) === 1)
  await page.getByTestId('mkt-register').tap()
  await page.waitForSelector('[data-testid=market][data-phase=pay]', { timeout: 8000 })
  const bill2 = Number(await data(page, 'market', 'bill'))
  check(`${tag} 新商品的價錢算對`, bill2 === (band === '6-7' ? PRICE[list2.at(-1).id] : 1), String(bill2))
  // 6–7 歲這次剛好付（5 → 1 → …），不找錢
  if (band === '6-7') {
    for (const c of [10, 5, 1]) while (Number(await data(page, 'market', 'paid')) + c <= bill2) await coin(c)
  } else for (let i = 0; i < bill2; i++) await coin(1)
  await page.waitForSelector('[data-testid=market][data-phase=done]', { timeout: 5000 })
  check(`${tag} 第二次剛好付不找錢`, Number(await data(page, 'market', 'change')) === 0 && Number(await data(page, 'market', 'paid')) === (band === '3' ? 1 : bill2))
  await sleep(page, 2000)
  check(`${tag} 同一天第二次不再送禮物`, (await page.getByTestId('play-gift').count()) === 0)
  const inv2 = await inventory(page)
  check(`${tag} 新商品不進背包`, sum(inv2) === sum(inv0) + 1 && !GOODS.some((g) => g in inv2))
  check(`${tag} 沒有錯誤`, realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()
}

/** v8.5 當老闆（玩完 3 次）：切換按鈕、把東西拖過掃描器、收寵物的硬幣、6–7 歲找錢 */
async function testMarketBoss(b, name, vp, band) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `老闆[${name}/${band}]`
  await enter(page, 'market', band, 3)
  const inv0 = await inventory(page)
  const led0 = await ledgerCount(page)
  check(`${tag} 一進來是自己買，有切換按鈕`, (await data(page, 'market', 'mode')) === 'shop' && (await page.getByTestId('mkt-mode').count()) === 1)
  check(`${tag} 切換按鈕 ≥ 56、在畫面內、沒有字`, (await smallTargets(page)).length === 0 && (await allInside(page, '[data-testid=mkt-mode]')).length === 0 && (await page.getByTestId('mkt-mode').innerText()).trim() === '', (await smallTargets(page)).join())
  const clash = await overlaps(page, '[data-testid=mkt-mode]', '[data-testid=mkt-list], [data-testid=mkt-shelf], [data-testid=mkt-cart], [data-testid=mkt-register], [data-testid=game-back], [data-testid=mkt-pet]')
  check(`${tag} 切換按鈕不擋清單貨架購物車收銀台回去鍵`, clash.length === 0, clash.join())
  check(`${tag} 自己買的畫面照舊：貨架點得到、不溢出`, (await covered(page, '[data-testid^=mkt-food-], [data-testid=mkt-register]')).length === 0 && (await noOverflowX(page)))
  await shot(page, `boss-1-shop-${name}-${band}`)

  await page.getByTestId('mkt-mode').tap()
  await page.waitForSelector('[data-testid=market][data-mode=boss][data-phase=scan]')
  await sleep(page, 500)
  check(`${tag} 換成當老闆，寵物說要買這些`, (await said(page, 'market')).includes('boss.want'))
  const order = (await data(page, 'market', 'order')).split(',')
  const n = order.length
  const kinds = { 3: 2, '4-5': 3, '6-7': 4 }[band]
  check(`${tag} 東西已經在櫃台上（${n} 個）`, n >= kinds && n <= 6 && (await page.getByTestId('mkt-boss-item').count()) === n && Number(await data(page, 'market', 'scanned')) === 0, order.join())
  check(`${tag} 觸控目標 ≥ 56、都在畫面內、不溢出`, (await smallTargets(page)).length === 0 && (await allInside(page, '[data-testid=mkt-boss-item], [data-testid=mkt-scan], [data-testid=mkt-bag], [data-testid=mkt-slot], [data-testid=mkt-pet], [data-testid=mkt-mode]')).length === 0 && (await noOverflowX(page)), (await smallTargets(page)).join())
  const clash2 = await overlaps(page, '[data-testid=mkt-pet], [data-testid=mkt-mode], [data-testid=game-back]', '[data-testid=mkt-belt], [data-testid=mkt-slot], [data-testid=mkt-display]')
  check(`${tag} 寵物、切換按鈕、回去鍵不擋櫃台`, clash2.length === 0, clash2.join())
  check(`${tag} 東西都點得到`, (await covered(page, '[data-testid=mkt-boss-item]')).length === 0)
  check(`${tag} 有手勢示範（拖過掃描器）`, (await page.getByTestId('gesture-hint').count()) === 1)
  await shot(page, `boss-2-scan-${name}-${band}`)

  const itemAt = (i) => centerOf(page, `[data-testid=mkt-boss-item] >> nth=${i}`)
  const scannedN = async () => Number(await data(page, 'market', 'scanned'))
  // 點一下：3 歲自己滑過去；4 歲以上不算，手勢再示範
  await fingerTap(send, await itemAt(0))
  await sleep(page, 150)
  if (band === '3') check(`${tag} 3 歲點一下就刷過去`, (await scannedN()) === 1 && (await page.getByTestId('mkt-boss-item').count()) === n - 1)
  else check(`${tag} 4 歲以上點一下不算、再示範一次`, (await scannedN()) === 0 && (await page.getByTestId('gesture-hint').count()) === 1)
  // 拖到一半、還沒過掃描器就放開：不算，飛回去
  const scanBox = (await centerOf(page, '[data-testid=mkt-scan]')).box
  const it0 = await itemAt(0)
  const before0 = await scannedN()
  if (it0.x - 70 > 0 && scanBox.x - (it0.x - 70) > 60) {
    await fingerDrag(send, it0, { x: it0.x - 70, y: it0.y - 10 })
    await sleep(page, 60)
    check(`${tag} 沒拖過掃描器不算、會飛回去`, (await scannedN()) === before0 && (await page.locator('[data-testid=ys-ghost][data-back]').count()) === 1)
    await sleep(page, 450)
  }
  // 一樣一樣拖過掃描器：每個嗶一聲，價錢跟著加
  const bag = await centerOf(page, '[data-testid=mkt-bag]')
  let sumPrice = 0
  let beeps = 0
  for (let k = before0; k < n; k++) {
    const id = await page.locator('[data-testid=mkt-boss-item]').first().getAttribute('data-id')
    const o0 = await osc(page)
    // 第一個放在掃描器上、其他放進袋子那一側
    await fingerDrag(send, await itemAt(0), k === before0 ? { x: scanBox.x + scanBox.width / 2, y: scanBox.y + scanBox.height / 2 } : bag)
    await sleep(page, 120)
    sumPrice += PRICE[id]
    if ((await osc(page)) > o0) beeps++
    if ((await scannedN()) !== k + 1) break
    if (band === '4-5') check(`${tag} 刷第 ${k + 1} 個：多一個點點`, (await page.getByTestId('mkt-bill-dot').count()) === k + 1)
    if (band === '6-7') check(`${tag} 刷第 ${k + 1} 個（${id}）：數字加到 ${sumPrice}`, (await page.getByTestId('mkt-bill-num').innerText()).trim() === String(sumPrice))
  }
  check(`${tag} 每一樣都拖得過掃描器`, (await scannedN()) === n && (await page.getByTestId('mkt-boss-item').count()) === 0 && (await page.getByTestId('mkt-belt-item').count()) === n)
  check(`${tag} 每刷一個嗶一聲`, beeps === n - before0, `${beeps}/${n - before0}`)
  if (band === '6-7') {
    const total = order.reduce((s, id) => s + PRICE[id], 0)
    check(`${tag} 6–7 歲價錢是數字，加對`, (await page.getByTestId('mkt-bill-num').innerText()).trim() === String(total) && Number(await data(page, 'market', 'bill')) === total && total >= 5 && total <= 20, `${await page.getByTestId('mkt-bill-num').innerText()} vs ${total}`)
  }
  if (band === '3') check(`${tag} 3 歲沒有價錢`, (await page.locator('[data-testid=mkt-belt-item] [data-testid=mkt-tag]').count()) === 0)

  // 寵物給錢
  await page.waitForSelector('[data-testid=market][data-phase=pay]', { timeout: 4000 })
  check(`${tag} 刷完寵物說給你錢`, (await said(page, 'market')).includes('boss.pay'))
  const bill = Number(await data(page, 'market', 'bill'))
  const need = Number(await data(page, 'market', 'need'))
  const offer = await page.getByTestId('mkt-give-coin').evaluateAll((els) => els.map((e) => Number(e.dataset.value)))
  const offerSum = offer.reduce((a, c) => a + c, 0)
  if (band === '3') check(`${tag} 3 歲寵物給一枚`, offer.length === 1 && need === 1)
  if (band === '4-5') check(`${tag} 4–5 歲寵物拿出比點點多兩枚 1 元，收 ${bill} 枚就夠`, offer.length === bill + 2 && offer.every((c) => c === 1) && need === bill && bill === n && bill <= 5, offer.join())
  if (band === '6-7') check(`${tag} 6–7 歲寵物多給（${offerSum} > ${bill}，5 的倍數）`, offerSum > bill && offerSum % 5 === 0 && offerSum - bill <= 5 && need === offer.length, offer.join('+'))
  check(`${tag} 硬幣 ≥ 56、在畫面內、不被寵物擋住`, (await smallTargets(page)).length === 0 && (await allInside(page, '[data-testid=mkt-give-coin], [data-testid=mkt-hand]')).length === 0 && (await overlaps(page, '[data-testid=mkt-pet], [data-testid=game-back], [data-testid=mkt-mode]', '[data-testid=mkt-give-coin]')).length === 0 && (await covered(page, '[data-testid=mkt-give-coin]')).length === 0, (await smallTargets(page)).join())
  check(`${tag} 收錢時不溢出、有手勢示範`, (await noOverflowX(page)) && (await page.getByTestId('gesture-hint').count()) === 1)
  await shot(page, `boss-3-pay-${name}-${band}`)
  const takeOne = () => page.locator('[data-testid=mkt-give-coin][data-taken="0"]').first().tap({ force: true })
  for (let i = 0; i < need - 1; i++) await takeOne()
  if (need > 1) {
    // 還沒收夠就等著：不催、不倒數
    const before = (await said(page, 'market')).length
    await sleep(page, 1500)
    check(`${tag} 還沒收夠就等著（不催）`, (await data(page, 'market', 'phase')) === 'pay' && (await said(page, 'market')).length === before)
    check(`${tag} 收一枚就多一枚`, (await page.getByTestId('mkt-paid-coin').count()) === need - 1)
    if (band === '4-5') check(`${tag} 收一枚點點亮一個`, (await page.locator('[data-testid=mkt-bill-dot][data-on="1"]').count()) === need - 1)
  }
  await takeOne()
  const got = Number(await data(page, 'market', 'got'))
  check(`${tag} 收到的錢算對`, got === (band === '6-7' ? offerSum : need), String(got))

  if (band === '6-7') {
    const change = offerSum - bill
    await page.waitForSelector('[data-testid=mkt-opts]')
    check(`${tag} 寵物說要找錢`, (await data(page, 'market', 'phase')) === 'change' && Number(await data(page, 'market', 'change')) === change)
    await page.waitForFunction(() => (document.querySelector('[data-testid=market]')?.dataset.said ?? '').includes('boss.change'), null, { timeout: 3000 }).catch(() => null)
    check(`${tag} 寵物說了 change`, (await said(page, 'market')).includes('boss.change'))
    const opts = await page.getByTestId('mkt-opt').evaluateAll((els) => els.map((e) => Number(e.dataset.amount)))
    check(`${tag} 三個選項都不一樣、有對的（${change}）`, opts.length === 3 && new Set(opts).size === 3 && opts.includes(change) && opts.every((a) => a > 0), opts.join())
    check(`${tag} 選項只有硬幣（沒有字）、≥ 56、在畫面內`, (await page.getByTestId('mkt-opts').innerText()).replace(/[\d\s]/g, '') === '' && (await smallTargets(page)).length === 0 && (await allInside(page, '[data-testid=mkt-opt]')).length === 0 && (await noOverflowX(page)), (await smallTargets(page)).join())
    check(`${tag} 選項不被寵物或切換按鈕擋住`, (await overlaps(page, '[data-testid=mkt-pet], [data-testid=mkt-mode]', '[data-testid=mkt-opt]')).length === 0 && (await covered(page, '[data-testid=mkt-opt]')).length === 0)
    await shot(page, `boss-4-change-${name}-${band}`)
    // 先選錯：寵物搖頭，可以再選
    const wrong = opts.find((a) => a !== change)
    const w0 = Number((await page.getByTestId('mkt-pet').getAttribute('data-wiggles')) ?? 0)
    await page.locator(`[data-testid=mkt-opt][data-amount="${wrong}"]`).tap()
    await sleep(page, 200)
    check(`${tag} 選錯：寵物搖頭、還能再選、沒有扣東西`, Number((await page.getByTestId('mkt-pet').getAttribute('data-wiggles')) ?? 0) === w0 + 1 && (await data(page, 'market', 'phase')) === 'change' && (await page.getByTestId('mkt-opt').count()) === 3 && (await data(page, 'market', 'given')) === '')
    await page.locator(`[data-testid=mkt-opt][data-amount="${change}"]`).tap()
    await sleep(page, 150)
    check(`${tag} 選對：找回 ${change} 元`, Number(await data(page, 'market', 'given')) === change && (await page.getByTestId('mkt-change').count()) === 1)
  } else check(`${tag} ${band} 歲不用找錢`, Number(await data(page, 'market', 'change')) === 0 && (await page.getByTestId('mkt-opts').count()) === 0)

  await page.waitForSelector('[data-testid=market][data-phase=done]', { timeout: 5000 })
  check(`${tag} 做完寵物說謝謝老闆`, (await said(page, 'market')).at(-1) === 'boss.thanks')
  check(`${tag} 做完不能再收錢`, (await page.getByTestId('mkt-give-coin').count()) === 0)
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  check(`${tag} 當老闆玩完也有結尾（今天第一次有禮物）`, true)
  await shot(page, `boss-5-done-${name}-${band}`)
  await closeGift(page)
  check(`${tag} 一回合只算玩完一次`, (await settings(page)).playCount?.market === 4, String((await settings(page)).playCount?.market))
  check(`${tag} 當老闆不扣星星、東西不進背包（只多禮物 1 個）`, (await ledgerCount(page)) === led0 && sum(await inventory(page)) === sum(inv0) + 1)

  // 再玩一次：換一批東西；再切回去是自己買
  await page.getByTestId('play-again').tap()
  await page.waitForSelector('[data-testid=market][data-mode=boss][data-phase=scan][data-round="1"]')
  check(`${tag} 再玩一次：寵物買的不一樣、從頭開始`, (await data(page, 'market', 'order')) !== order.join(',') && Number(await data(page, 'market', 'scanned')) === 0 && (await said(page, 'market')).at(-1) === 'boss.want')
  await page.getByTestId('mkt-mode').tap()
  await page.waitForSelector('[data-testid=market][data-mode=shop][data-phase=shop]')
  check(`${tag} 再按切換按鈕回到自己買`, (await page.locator('[data-testid^=mkt-food-]').count()) === (band === '3' ? 12 : 14) && (await cartCount(page)) === 0)
  await sleep(page, 1800)
  check(`${tag} 切換不會多算一次`, (await settings(page)).playCount?.market === 4)
  check(`${tag} 沒有錯誤`, realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()
}

/** v8.5 當老闆的邊界：減少動態走得完、做到一半切換或離開不出錯、不多算次數 */
async function testMarketBossEdge(b) {
  const r = await freshApp(b, SIZES.port, TOUCH)
  await r.page.emulateMedia({ reducedMotion: 'reduce' })
  const send = await touchSender(r.ctx, r.page)
  await enter(r.page, 'market', '3', 3)
  await r.page.getByTestId('mkt-mode').tap()
  await r.page.waitForSelector('[data-testid=market][data-mode=boss]')
  const n = (await data(r.page, 'market', 'order')).split(',').length
  for (let i = 0; i < n; i++) {
    await fingerTap(send, await centerOf(r.page, '[data-testid=mkt-boss-item]'))
    await sleep(r.page, 80)
  }
  check('老闆（減少動態）：點了不飛、直接刷過去', (await r.page.getByTestId('ys-flyer').count()) === 0 && Number(await data(r.page, 'market', 'scanned')) === n)
  await r.page.waitForSelector('[data-testid=market][data-phase=pay]', { timeout: 4000 })
  await r.page.getByTestId('mkt-give-coin').first().tap({ force: true })
  await r.page.waitForSelector('[data-testid=market][data-phase=done]', { timeout: 4000 })
  check('老闆（減少動態）：走得完', true)
  check('老闆（減少動態）：沒有錯誤', realErrors(r.errors).length === 0, realErrors(r.errors).join(' | '))
  await send.detach()
  await r.ctx.close()

  // 刷到一半切回自己買、再切回來、再離開：不出錯、不算玩完
  const m = await freshApp(b, SIZES.land, TOUCH)
  const send2 = await touchSender(m.ctx, m.page)
  await enter(m.page, 'market', '4-5', 3)
  await m.page.getByTestId('mkt-mode').tap()
  await m.page.waitForSelector('[data-testid=market][data-mode=boss]')
  await fingerDrag(send2, await centerOf(m.page, '[data-testid=mkt-boss-item]'), await centerOf(m.page, '[data-testid=mkt-bag]'))
  await sleep(m.page, 100)
  check('老闆：刷了一個', Number(await data(m.page, 'market', 'scanned')) === 1)
  await m.page.getByTestId('mkt-mode').tap()
  await m.page.waitForSelector('[data-testid=market][data-mode=shop]')
  await m.page.getByTestId('mkt-mode').tap()
  await m.page.waitForSelector('[data-testid=market][data-mode=boss]')
  check('老闆：切走再切回來從頭開始', Number(await data(m.page, 'market', 'scanned')) === 0)
  await fingerDrag(send2, await centerOf(m.page, '[data-testid=mkt-boss-item]'), await centerOf(m.page, '[data-testid=mkt-bag]'))
  await m.page.getByTestId('game-back').tap()
  await sleep(m.page, 1800)
  check('老闆：做到一半離開不算玩完', (await settings(m.page)).playCount?.market === 3)
  check('老闆（邊界）：沒有錯誤', realErrors(m.errors).length === 0, realErrors(m.errors).join(' | '))
  await send2.detach()
  await m.ctx.close()
}

/** 超市：拿錯的全部放回去會回到貨架；空車結帳不會進去；減少動態走得完 */
async function testMarketEdge(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const send = await touchSender(ctx, page)
  await enter(page, 'market', '4-5')
  await page.getByTestId('mkt-register').tap()
  await sleep(page, 200)
  check('超市：空車按收銀台不會結帳', (await data(page, 'market', 'phase')) === 'shop')
  check('超市：空車按收銀台會示範', (await page.getByTestId('gesture-hint').count()) === 1)
  const list = parseList(await data(page, 'market', 'list'))
  const extra = Object.keys(PRICE).find((f) => !list.some((l) => l.id === f))
  await putInCart(page, send, extra, '4-5')
  await sleep(page, 100)
  await page.getByTestId('mkt-register').tap()
  await page.waitForSelector('[data-testid=mkt-extra]')
  await page.getByTestId('mkt-extra-back').tap()
  await sleep(page, 150)
  check('超市：只拿了清單外的、全部放回 → 回到貨架', (await data(page, 'market', 'phase')) === 'shop' && (await cartCount(page)) === 0)
  check('超市（邊界）：沒有錯誤', realErrors(errors).length === 0, realErrors(errors).join(' | '))
  // 中途離開：計時器清乾淨、不出錯
  for (const l of list) for (let i = 0; i < l.qty; i++) await putInCart(page, send, l.id, '4-5')
  await page.getByTestId('mkt-register').tap()
  await sleep(page, 700)
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=town]', { timeout: 5000 }).catch(() => null)
  await sleep(page, 1500)
  check('超市：嗶到一半離開不出錯', realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()

  // 減少動態：一樣走得完
  const r = await freshApp(b, SIZES.port, TOUCH)
  await r.page.emulateMedia({ reducedMotion: 'reduce' })
  const send2 = await touchSender(r.ctx, r.page)
  await enter(r.page, 'market', '3')
  for (const l of parseList(await data(r.page, 'market', 'list'))) await putInCart(r.page, send2, l.id, '3')
  check('超市（減少動態）：點了不飛（直接進車）', (await r.page.getByTestId('ys-flyer').count()) === 0 && (await cartCount(r.page)) >= 2)
  await r.page.getByTestId('mkt-register').tap()
  await r.page.waitForSelector('[data-testid=market][data-phase=pay]', { timeout: 5000 })
  await r.page.getByTestId('mkt-coin-5').tap({ force: true })
  await r.page.waitForSelector('[data-testid=market][data-phase=done]', { timeout: 5000 })
  check('超市（減少動態）：走得完', true)
  check('超市（減少動態）：沒有錯誤', realErrors(r.errors).length === 0, realErrors(r.errors).join(' | '))
  await send2.detach()
  await r.ctx.close()
}

// ======================= 果汁攤 =======================
const JUICE_FRUITS = ['banana', 'apple', 'grape', 'peach', 'watermelon']
/** v8.5 玩完 1 次之後多出來的水果 */
const NEW_FRUITS = ['strawberry', 'orange']
const jphase = (page) => data(page, 'juice', 'phase')
const waitPhase = (page, p, timeout = 6000) => page.waitForSelector(`[data-testid=juice][data-phase=${p}]`, { timeout })
const blenderCount = async (page) => Number(await page.getByTestId('juice-blender').getAttribute('data-count'))

/** 照單把水果放進果汁機：第一個用拖的，其他用點的 */
async function fillBlender(page, send, fruits) {
  for (const [i, f] of fruits.entries()) {
    const from = await centerOf(page, `[data-testid=juice-fruit-${f}]`)
    if (i === 0) await fingerDrag(send, from, await centerOf(page, '[data-testid=juice-blender]'))
    else await fingerTap(send, from)
    await sleep(page, 60)
  }
}
/** 打果汁 → 等倒好 */
async function blendAndPour(page) {
  await page.getByTestId('juice-blender').tap({ force: true })
  await waitPhase(page, 'ready')
}

async function testJuice(b, name, vp, band) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `果汁[${name}/${band}]`
  await enter(page, 'juice', band)
  const inv0 = await inventory(page)
  check(`${tag} 第一位客人是小熊`, (await data(page, 'juice', 'who')) === 'bear' && (await page.getByTestId('juice-customer').getAttribute('data-who')) === 'bear')
  await waitPhase(page, 'make')
  const order = (await data(page, 'juice', 'order')).split(',')
  const nKinds = order.length
  check(`${tag} 點單種類依年齡`, band === '3' ? nKinds === 1 : band === '4-5' ? nKinds === 2 : nKinds === 2 || nKinds === 3, order.join())
  check(`${tag} 泡泡裡是水果圖`, (await page.getByTestId('juice-order-fruit').count()) === nKinds && (await page.getByTestId('juice-bubble').innerText()).trim() === '')
  check(`${tag} 泡泡出現`, (await page.getByTestId('juice-bubble').getAttribute('data-shown')) === '1')
  check(`${tag}（沒有新玩具）水果盤 5 種，沒有草莓和橘子`, (await page.locator('[data-testid^=juice-fruit-]').count()) === 5 && (await page.locator('[data-testid=juice-fruit-strawberry], [data-testid=juice-fruit-orange]').count()) === 0 && !order.some((f) => NEW_FRUITS.includes(f)))
  check(`${tag} 第一次有手勢示範`, (await page.getByTestId('gesture-hint').count()) === 1)
  check(`${tag} 不橫向溢出`, await noOverflowX(page))
  check(`${tag} 觸控目標 ≥ 56`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join())
  const inside = await allInside(page, '[data-testid^=juice-fruit-], [data-testid=juice-blender], [data-testid=juice-cup], [data-testid=juice-customer], [data-testid=juice-bubble], [data-testid=juice-pet]')
  check(`${tag} 都在畫面內`, inside.length === 0, inside.join())
  const clash = await overlaps(page, '[data-testid=juice-pet], [data-testid=juice-customer]', '[data-testid=juice-tray], [data-testid=juice-blender], [data-testid=juice-cup], [data-testid=game-back]')
  check(`${tag} 寵物、客人不擋櫃台和回去鍵`, clash.length === 0, clash.join())
  check(`${tag} 寵物不擋客人`, (await overlaps(page, '[data-testid=juice-pet]', '[data-testid=juice-customer], [data-testid=juice-bubble]')).length === 0)
  const hidden = await covered(page, '[data-testid^=juice-fruit-], [data-testid=juice-blender]')
  check(`${tag} 水果和果汁機都點得到`, hidden.length === 0, hidden.join())
  await shot(page, `juice-1-order-${name}-${band}`)

  // 空的果汁機按下去：不會轉
  await page.getByTestId('juice-blender').tap({ force: true })
  await sleep(page, 150)
  check(`${tag} 空的果汁機按了不會轉`, (await jphase(page)) === 'make')

  // 第一位：故意做錯（拿一個不在單子上的）→ 會喝、表情好笑、再點一次
  const wrong = JUICE_FRUITS.find((f) => !order.includes(f))
  await fillBlender(page, send, [wrong])
  check(`${tag} 拖進果汁機`, (await blenderCount(page)) === 1)
  check(`${tag} 放了之後拖的示範消失`, (await page.locator('[data-testid=gesture-hint]').count()) <= 1)
  await page.getByTestId('juice-blender').tap({ force: true })
  await sleep(page, 100)
  check(`${tag} 按下去在轉`, (await jphase(page)) === 'blend' && (await page.getByTestId('juice-blender').getAttribute('data-spinning')) === '1')
  check(`${tag} 轉的時候寵物說 blend`, (await said(page, 'juice')).includes('blend'))
  await waitPhase(page, 'ready')
  check(`${tag} 倒進杯子`, (await page.getByTestId('juice-cup').getAttribute('data-full')) === '1' && (await blenderCount(page)) === 0)
  const cupColor = await page.locator('[data-testid=juice-cup] .jc-cup-juice').evaluate((e) => getComputedStyle(e).backgroundColor)
  check(`${tag} 杯子裡有果汁的顏色`, /rgb/.test(cupColor) && cupColor !== 'rgba(0, 0, 0, 0)', cupColor)
  check(`${tag}（沒有新玩具）倒好之後沒有裝飾盤，水果盤還在`, (await page.getByTestId('juice-decos').count()) === 0 && (await page.getByTestId('juice-tray').count()) === 1 && !(await said(page, 'juice')).includes('deco'))
  await shot(page, `juice-2-ready-${name}-${band}`)
  await page.getByTestId('juice-customer').tap({ force: true }) // 點客人也能拿給他
  await waitPhase(page, 'funny')
  check(`${tag} 做錯也會喝，表情好笑`, (await page.getByTestId('juice-funny').count()) === 1 && (await page.getByTestId('juice-customer').getAttribute('data-mood')) === 'funny')
  check(`${tag} 做錯寵物說 funny`, (await said(page, 'juice')).includes('funny'))
  await shot(page, `juice-3-funny-${name}-${band}`)
  await waitPhase(page, 'make')
  check(`${tag} 同一位客人再點一次`, (await data(page, 'juice', 'guest')) === '0' && (await data(page, 'juice', 'served')) === '0')

  // 做對：拖杯子給客人
  await fillBlender(page, send, order)
  await blendAndPour(page)
  await fingerDrag(send, await centerOf(page, '[data-testid=juice-cup]'), await centerOf(page, '[data-testid=juice-customer]'))
  await waitPhase(page, 'yum')
  check(`${tag} 做對了客人開心`, (await page.getByTestId('juice-hearts').count()) === 1)
  check(`${tag} 做對寵物說 yum`, (await said(page, 'juice')).includes('yum'))
  await waitPhase(page, 'arrive')
  check(`${tag} 第二位是小雞`, (await data(page, 'juice', 'who')) === 'chick' && (await data(page, 'juice', 'served')) === '1')

  // 果汁機最多 4 塊
  await waitPhase(page, 'make')
  const order2 = (await data(page, 'juice', 'order')).split(',')
  check(`${tag} 下一位點的不一樣`, order2.join() !== order.join())
  for (let i = 0; i < 5; i++) await fingerTap(send, await centerOf(page, `[data-testid=juice-fruit-${order2[0]}]`))
  await sleep(page, 80)
  check(`${tag} 果汁機最多 4 塊`, (await blenderCount(page)) === 4)
  // 同一種放很多塊：只要種類一樣就對
  await page.getByTestId('juice-blender').tap({ force: true })
  await waitPhase(page, 'ready')
  await fingerTap(send, await centerOf(page, '[data-testid=juice-cup]')) // 點杯子也能拿給客人
  await waitPhase(page, order2.length === 1 ? 'yum' : 'funny')
  check(`${tag} 只放一種：${order2.length === 1 ? '對' : '不對'}`, true)
  await waitPhase(page, order2.length === 1 ? 'arrive' : 'make')
  await waitPhase(page, 'make')
  if (order2.length > 1) {
    await fillBlender(page, send, order2)
    await blendAndPour(page)
    await fingerTap(send, await centerOf(page, '[data-testid=juice-cup]'))
    await waitPhase(page, 'arrive')
    await waitPhase(page, 'make')
  }
  check(`${tag} 第三位是小牛`, (await data(page, 'juice', 'who')) === 'cow')
  const order3 = (await data(page, 'juice', 'order')).split(',')
  await fillBlender(page, send, order3)
  await blendAndPour(page)
  await fingerTap(send, await centerOf(page, '[data-testid=juice-cup]'))
  await waitPhase(page, 'done', 8000)
  check(`${tag} 3 位都喝到了寵物說 done`, (await said(page, 'juice')).at(-1) === 'done' && (await data(page, 'juice', 'served')) === '3')
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  check(`${tag} 第一次做完有禮物`, true)
  await shot(page, `juice-4-done-${name}-${band}`)
  const inv1 = await inventory(page)
  check(`${tag} 果汁不進背包（只多禮物 1 個）`, sum(inv1) === sum(inv0) + 1)
  check(`${tag} 玩完第 1 次，卡上有新玩具（草莓和橘子）`, (await page.getByTestId('play-toy').getAttribute('data-toy')) === 'fruits')
  check(`${tag} 卡還沒收下，水果盤還是 5 種`, (await page.locator('[data-testid^=juice-fruit-]').count()) === 5)
  await closeGift(page)
  await page.getByTestId('play-again').tap()
  await page.waitForSelector('[data-testid=juice][data-round="1"]')
  check(`${tag} 再一回客人接著輪（小兔子）`, (await data(page, 'juice', 'who')) === 'rabbit')

  // v8.5：收下新玩具的下一回，水果盤多草莓和橘子，這一回一定有客人點到
  await waitPhase(page, 'make')
  check(`${tag} 新水果：水果盤 7 種（草莓、橘子排在後面）`, (await page.locator('[data-testid^=juice-fruit-]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('juice-fruit-', '')).join())) === [...JUICE_FRUITS, ...NEW_FRUITS].join())
  check(`${tag} 新水果：觸控目標 ≥ 56、都在畫面內、不溢出`, (await smallTargets(page)).length === 0 && (await allInside(page, '[data-testid^=juice-fruit-], [data-testid=juice-blender], [data-testid=juice-cup], [data-testid=juice-customer], [data-testid=juice-pet]')).length === 0 && (await noOverflowX(page)), (await smallTargets(page)).join())
  check(`${tag} 新水果：寵物、客人不擋櫃台，水果都點得到`, (await overlaps(page, '[data-testid=juice-pet], [data-testid=juice-customer]', '[data-testid=juice-tray], [data-testid=juice-blender], [data-testid=juice-cup], [data-testid=game-back]')).length === 0 && (await covered(page, '[data-testid^=juice-fruit-], [data-testid=juice-blender]')).length === 0)
  await shot(page, `juice-5-fruits7-${name}-${band}`)
  const orders = []
  for (let g = 0; g < 3; g++) {
    await waitPhase(page, 'make')
    const o = (await data(page, 'juice', 'order')).split(',')
    orders.push(o)
    check(`${tag} 新水果：第 ${g + 1} 位點的種類數跟原本一樣`, band === '3' ? o.length === 1 : band === '4-5' ? o.length === 2 : o.length === 2 || o.length === 3, o.join())
    await fillBlender(page, send, o)
    await blendAndPour(page)
    if (o.some((f) => NEW_FRUITS.includes(f))) {
      const c = await page.locator('[data-testid=juice-cup] .jc-cup-juice').evaluate((e) => getComputedStyle(e).backgroundColor)
      check(`${tag} 新水果打出來有顏色（${o.join('+')}）`, /rgb/.test(c) && c !== 'rgba(0, 0, 0, 0)', c)
      check(`${tag} 新水果的點單泡泡畫得出來`, (await page.getByTestId('juice-order-fruit').count()) === o.length)
      await shot(page, `juice-6-newfruit-${name}-${band}`)
    }
    check(`${tag} 只有第一個新玩具時，倒好之後沒有裝飾盤`, (await page.getByTestId('juice-decos').count()) === 0)
    await fingerTap(send, await centerOf(page, '[data-testid=juice-cup]'))
    await waitPhase(page, 'yum')
    check(`${tag} 新水果做對了客人開心（沒有裝飾就是原本的開心）`, (await page.getByTestId('juice-customer').getAttribute('data-fancy')) === '0' && (await page.getByTestId('juice-star').count()) === 0)
    await waitPhase(page, g < 2 ? 'arrive' : 'done', 8000)
  }
  check(`${tag} 新水果：這一回有客人點草莓或橘子`, orders.some((o) => o.some((f) => NEW_FRUITS.includes(f))), orders.map((o) => o.join('+')).join(' / '))
  await sleep(page, 2000)
  check(`${tag} 第 2 次沒有卡，只有星星和歡呼（不擋操作）`, (await page.getByTestId('play-gift').count()) === 0 && (await settings(page)).playCount?.juice === 2)
  check(`${tag} 沒有錯誤`, realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()
}

/** v8.5 裝飾（玩完 3 次）：倒好之後水果盤換成吸管、小雨傘、冰塊，拖或點到杯子上；有加客人更開心，不加也可以 */
async function testJuiceDeco(b, name, vp, band) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `裝飾[${name}/${band}]`
  await enter(page, 'juice', band, 3)
  await waitPhase(page, 'make')
  check(`${tag} 一進來就有兩個新玩具：水果盤 7 種`, (await page.getByTestId('play-juice').getAttribute('data-toys')) === '2' && (await page.locator('[data-testid^=juice-fruit-]').count()) === 7)
  check(`${tag} 還沒倒好時沒有裝飾盤`, (await page.getByTestId('juice-decos').count()) === 0)
  const order = (await data(page, 'juice', 'order')).split(',')
  await fillBlender(page, send, order)
  await blendAndPour(page)
  await sleep(page, 350)
  check(`${tag} 倒好之後水果盤換成裝飾盤（吸管、小雨傘、冰塊）`, (await page.getByTestId('juice-tray').count()) === 0 && (await page.locator('[data-testid^=juice-deco-]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('juice-deco-', '')).join())) === 'straw,umbrella,ice')
  check(`${tag} 第一次寵物說要不要加吸管`, (await said(page, 'juice')).filter((x) => x === 'deco').length === 1)
  check(`${tag} 裝飾盤只有圖、≥ 56、在畫面內、不溢出`, (await page.getByTestId('juice-decos').innerText()).trim() === '' && (await smallTargets(page)).length === 0 && (await allInside(page, '[data-testid^=juice-deco-], [data-testid=juice-decos], [data-testid=juice-cup], [data-testid=juice-blender]')).length === 0 && (await noOverflowX(page)), (await smallTargets(page)).join())
  check(`${tag} 寵物、客人不擋裝飾盤，裝飾都點得到`, (await overlaps(page, '[data-testid=juice-pet], [data-testid=juice-customer]', '[data-testid=juice-decos], [data-testid=juice-cup]')).length === 0 && (await covered(page, '[data-testid^=juice-deco-]')).length === 0)
  await shot(page, `deco-1-tray-${name}-${band}`)
  const decoOn = async () => ((await page.getByTestId('juice-cup').getAttribute('data-deco')) ?? '').split(',').filter(Boolean)
  const cup = await centerOf(page, '[data-testid=juice-cup]')
  // 吸管用拖的
  await fingerDrag(send, await centerOf(page, '[data-testid=juice-deco-straw]'), cup)
  await sleep(page, 100)
  check(`${tag} 吸管拖到杯子上`, (await decoOn()).join() === 'straw' && (await page.locator('[data-testid=juice-cup] [data-testid=juice-cup-deco][data-id=straw]').count()) === 1)
  // 小雨傘拖到外面：不算、飛回去
  await fingerDrag(send, await centerOf(page, '[data-testid=juice-deco-umbrella]'), await centerOf(page, '[data-testid=juice-pet]'))
  await sleep(page, 60)
  check(`${tag} 裝飾放在杯子外不算、會飛回去`, (await decoOn()).join() === 'straw' && (await page.locator('[data-testid=ys-ghost][data-back]').count()) === 1)
  await sleep(page, 450)
  // 冰塊用點的；再點一次不會多一個
  await fingerTap(send, await centerOf(page, '[data-testid=juice-deco-ice]'))
  await sleep(page, 100)
  await fingerTap(send, await centerOf(page, '[data-testid=juice-deco-ice]'))
  await sleep(page, 100)
  check(`${tag} 冰塊點一下就加上去，同一種只能加一個`, (await decoOn()).join() === 'straw,ice' && (await page.getByTestId('juice-deco-ice').getAttribute('data-used')) === '1')
  await fingerTap(send, await centerOf(page, '[data-testid=juice-deco-umbrella]'))
  await sleep(page, 500)
  check(`${tag} 三種都能加`, (await decoOn()).length === 3 && (await page.locator('[data-testid=juice-cup] [data-testid=juice-cup-deco]').count()) === 3)
  check(`${tag} 杯子上的裝飾不擋手指`, (await page.locator('[data-testid=juice-cup] [data-testid=juice-cup-deco]').first().evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none')
  check(`${tag} 加了裝飾還在等孩子拿給客人（不催）`, (await jphase(page)) === 'ready')
  await shot(page, `deco-2-cup-${name}-${band}`)
  // 拖給客人：更開心
  await fingerDrag(send, await centerOf(page, '[data-testid=juice-cup]'), await centerOf(page, '[data-testid=juice-customer]'))
  await waitPhase(page, 'yum')
  check(`${tag} 有裝飾：客人更開心（多一圈星星）`, (await page.getByTestId('juice-customer').getAttribute('data-fancy')) === '1' && (await page.getByTestId('juice-star').count()) === 5 && (await page.getByTestId('juice-hearts').getAttribute('data-more')) === '1')
  await sleep(page, 350)
  await shot(page, `deco-3-fancy-${name}-${band}`)
  check(`${tag} 給出去之後杯子上的裝飾清掉`, (await decoOn()).length === 0)

  // 第二位：不加裝飾直接給，也可以
  await waitPhase(page, 'arrive')
  await waitPhase(page, 'make')
  check(`${tag} 下一位來了，水果盤回來`, (await page.getByTestId('juice-tray').count()) === 1 && (await page.getByTestId('juice-decos').count()) === 0)
  await fillBlender(page, send, (await data(page, 'juice', 'order')).split(','))
  await blendAndPour(page)
  await fingerTap(send, await centerOf(page, '[data-testid=juice-cup]'))
  await waitPhase(page, 'yum')
  check(`${tag} 不加裝飾也可以直接給，客人照樣開心`, (await page.getByTestId('juice-customer').getAttribute('data-fancy')) === '0' && (await page.getByTestId('juice-hearts').count()) === 1 && (await page.getByTestId('juice-star').count()) === 0 && (await data(page, 'juice', 'served')) === '2')

  // 第三位：做錯又加了裝飾 → 還是好笑的表情（裝飾不會讓做錯變對），再做一次
  await waitPhase(page, 'arrive')
  await waitPhase(page, 'make')
  const order3 = (await data(page, 'juice', 'order')).split(',')
  const wrong = [...JUICE_FRUITS, ...NEW_FRUITS].find((f) => !order3.includes(f))
  await fillBlender(page, send, [wrong])
  await blendAndPour(page)
  await fingerTap(send, await centerOf(page, '[data-testid=juice-deco-straw]'))
  await sleep(page, 100)
  await fingerTap(send, await centerOf(page, '[data-testid=juice-cup]'))
  await waitPhase(page, 'funny')
  check(`${tag} 做錯加了裝飾還是好笑的表情`, (await page.getByTestId('juice-funny').count()) === 1 && (await page.getByTestId('juice-star').count()) === 0)
  await waitPhase(page, 'make')
  check(`${tag} 再做一次：水果盤回來、杯子是空的`, (await page.getByTestId('juice-tray').count()) === 1 && (await decoOn()).length === 0 && (await page.getByTestId('juice-cup').getAttribute('data-full')) === '0')
  await fillBlender(page, send, order3)
  await blendAndPour(page)
  check(`${tag} 「要不要加吸管」只說第一次`, (await said(page, 'juice')).filter((x) => x === 'deco').length === 1)
  await fingerTap(send, await centerOf(page, '[data-testid=juice-deco-umbrella]'))
  await sleep(page, 100)
  await fingerTap(send, await centerOf(page, '[data-testid=juice-customer]'))
  await waitPhase(page, 'done', 8000)
  check(`${tag} 3 位都喝到了`, (await data(page, 'juice', 'served')) === '3' && (await said(page, 'juice')).at(-1) === 'done')
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  await closeGift(page)
  check(`${tag} 一回合只算玩完一次`, (await settings(page)).playCount?.juice === 4, String((await settings(page)).playCount?.juice))
  check(`${tag} 沒有錯誤`, realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await send.detach()
  await ctx.close()
}

/** v8.5 裝飾：減少動態照樣能加、能給 */
async function testJuiceDecoReduced(b) {
  const m = await freshApp(b, SIZES.phone, TOUCH)
  await m.page.emulateMedia({ reducedMotion: 'reduce' })
  const send = await touchSender(m.ctx, m.page)
  await enter(m.page, 'juice', '3', 3)
  await waitPhase(m.page, 'make')
  await fillBlender(m.page, send, (await data(m.page, 'juice', 'order')).split(','))
  await blendAndPour(m.page)
  await fingerTap(send, await centerOf(m.page, '[data-testid=juice-deco-ice]'))
  await sleep(m.page, 100)
  check('裝飾（減少動態）：點了不飛、直接加上去', (await m.page.getByTestId('ys-flyer').count()) === 0 && (await m.page.getByTestId('juice-cup').getAttribute('data-deco')) === 'ice')
  await fingerTap(send, await centerOf(m.page, '[data-testid=juice-cup]'))
  await waitPhase(m.page, 'yum')
  check('裝飾（減少動態）：客人更開心', (await m.page.getByTestId('juice-customer').getAttribute('data-fancy')) === '1')
  await m.page.getByTestId('game-back').tap()
  await sleep(m.page, 1200)
  check('裝飾（減少動態）：沒有錯誤', realErrors(m.errors).length === 0, realErrors(m.errors).join(' | '))
  await send.detach()
  await m.ctx.close()
}

/** 6–7 歲：泡泡看 4 秒收起來，點客人再出現（不扣分）；peek 只說一次 */
async function testJuicePeek(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  await enter(page, 'juice', '6-7')
  await waitPhase(page, 'make')
  check('果汁 6–7：一開始看得到泡泡', (await page.getByTestId('juice-bubble').getAttribute('data-shown')) === '1')
  await sleep(page, 3000)
  check('果汁 6–7：3 秒時還在', (await page.getByTestId('juice-bubble').getAttribute('data-shown')) === '1')
  await page.waitForSelector('[data-testid=juice-bubble][data-shown="0"]', { timeout: 2500 })
  check('果汁 6–7：4 秒後收起來', true)
  check('果汁 6–7：收起來時寵物說 peek', (await said(page, 'juice')).includes('peek'))
  await shot(page, 'juice-5-peek-hidden-land-6-7')
  await page.getByTestId('juice-customer').tap({ force: true })
  await sleep(page, 100)
  check('果汁 6–7：點客人泡泡再出現', (await page.getByTestId('juice-bubble').getAttribute('data-shown')) === '1')
  await page.waitForSelector('[data-testid=juice-bubble][data-shown="0"]', { timeout: 5000 })
  check('果汁 6–7：再看 4 秒又收起來', true)
  check('果汁 6–7：peek 只說一次', (await said(page, 'juice')).filter((x) => x === 'peek').length === 1)
  check('果汁 6–7：看幾次都不扣分', (await data(page, 'juice', 'served')) === '0' && (await jphase(page)) === 'make')
  check('果汁 6–7：沒有錯誤', realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await ctx.close()

  // 3 歲：泡泡一直在
  const r = await freshApp(b, SIZES.phone, TOUCH)
  await enter(r.page, 'juice', '3')
  await waitPhase(r.page, 'make')
  await sleep(r.page, 4600)
  check('果汁 3 歲：泡泡一直在', (await r.page.getByTestId('juice-bubble').getAttribute('data-shown')) === '1')
  check('果汁 3 歲：不說 peek', !(await said(r.page, 'juice')).includes('peek'))
  await r.ctx.close()

  // 減少動態：一樣走得完
  const m = await freshApp(b, SIZES.port, TOUCH)
  await m.page.emulateMedia({ reducedMotion: 'reduce' })
  const send = await touchSender(m.ctx, m.page)
  await enter(m.page, 'juice', '4-5')
  for (let i = 0; i < 3; i++) {
    await waitPhase(m.page, 'make')
    await fillBlender(m.page, send, (await data(m.page, 'juice', 'order')).split(','))
    await blendAndPour(m.page)
    await fingerTap(send, await centerOf(m.page, '[data-testid=juice-cup]'))
    await m.page.waitForFunction(() => ['arrive', 'make', 'done'].includes(document.querySelector('[data-testid=juice]')?.dataset.phase) && document.querySelector('[data-testid=juice]')?.dataset.served !== undefined, null, { timeout: 6000 })
    await waitPhase(m.page, i < 2 ? 'make' : 'done', 6000)
  }
  check('果汁（減少動態）：走得完', (await data(m.page, 'juice', 'served')) === '3')
  // 打到一半離開：不出錯
  await m.page.getByTestId('game-back').tap()
  await sleep(m.page, 1500)
  check('果汁（減少動態）：沒有錯誤', realErrors(m.errors).length === 0, realErrors(m.errors).join(' | '))
  await send.detach()
  await m.ctx.close()
}

/** 小街到兩個地方、回去鍵回小街 */
async function testTownNav(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  await page.evaluate(() => (location.hash = 'town'))
  await page.waitForSelector('[data-testid=game-market]', { timeout: 5000 })
  await page.getByTestId('game-market').tap()
  await page.waitForSelector('[data-testid=market]')
  check('小街：點超市進得去', true)
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=game-juice]')
  check('超市回去鍵回小街', true)
  await page.getByTestId('game-juice').tap()
  await page.waitForSelector('[data-testid=juice]')
  check('小街：點果汁攤進得去', true)
  await page.getByTestId('game-back').tap()
  await page.waitForSelector('[data-testid=game-market]')
  check('果汁攤回去鍵回小街', true)
  check('小街：沒有錯誤', realErrors(errors).length === 0, realErrors(errors).join(' | '))
  await ctx.close()
}

const b = await launch()
// E2E_ONLY=market 只跑某一段（改程式時省時間）
const only = process.env.E2E_ONLY
const run = async (name, fn) => {
  if (!only || only === name) await fn()
}
try {
  await run('nav', () => testTownNav(b))
  await run('market', () => testMarket(b, 'land', SIZES.land, '6-7'))
  await run('market', () => testMarket(b, 'port', SIZES.port, '4-5'))
  await run('market', () => testMarket(b, 'phone', SIZES.phone, '3'))
  await run('market-edge', () => testMarketEdge(b))
  await run('boss', () => testMarketBoss(b, 'land', SIZES.land, '6-7'))
  await run('boss', () => testMarketBoss(b, 'port', SIZES.port, '4-5'))
  await run('boss', () => testMarketBoss(b, 'phone', SIZES.phone, '3'))
  await run('boss', () => testMarketBoss(b, 'phone', SIZES.phone, '6-7'))
  await run('boss-edge', () => testMarketBossEdge(b))
  await run('juice', () => testJuice(b, 'land', SIZES.land, '4-5'))
  await run('juice', () => testJuice(b, 'port', SIZES.port, '6-7'))
  await run('juice', () => testJuice(b, 'phone', SIZES.phone, '3'))
  await run('deco', () => testJuiceDeco(b, 'land', SIZES.land, '4-5'))
  await run('deco', () => testJuiceDeco(b, 'port', SIZES.port, '6-7'))
  await run('deco', () => testJuiceDeco(b, 'phone', SIZES.phone, '3'))
  await run('deco-edge', () => testJuiceDecoReduced(b))
  await run('juice-peek', () => testJuicePeek(b))
} finally {
  await b.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
