// v8.4 線 Z E2E：積木工地（blocks）、拼圖屋（puzzle）。
//   三種尺寸的版面（不橫向溢出、觸控目標 ≥ 56、都在畫面內）；
//   積木：點一下疊高、拖曳對齊格線、拿起中間那塊上面的往下掉、拖回盤子收起來、兩指同時放、寵物爬到最高那塊、
//         太高會縮小、到上限不給放（不疊出畫面）、推倒散一地、再蓋、禮物只送一次、6–7 歲照著蓋（藍圖從畫面讀，不寫死日期）、
//         有 3D 圖時用靜態 filter 換色、動作減少、三種寵物；
//   拼圖：自己畫的排最前面並說 mine、片數依年齡、固定洗牌、太遠不吸／附近吸過去、兩指同時拖兩片、拼完亮一下說 done、禮物、換一張。
// 用法：先啟動 dev server（pnpm exec vite --port 5203 --strictPort），再
//   BASE_URL=http://localhost:5203 node scripts/e2e-town-z.mjs     （或 pnpm e2e:town-z；E2E_BROWSER=webkit 改用 WebKit）
//   SHOTS_DIR=<目錄> 會存截圖（不要放 repo 裡）；ONLY=blocks,puzzle 只跑其中一段。
import { mkdirSync } from 'node:fs'
import { IS_WEBKIT, freshApp, idb, launch, makeChecker, patchPet, touchSender } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const SHOTS = process.env.SHOTS_DIR
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const ONLY = process.env.ONLY?.split(',')
const on = (name) => !ONLY || ONLY.includes(name)
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}${IS_WEBKIT ? '-webkit' : ''}.png` })
}
/** 無頭 WebKit 只在畫一幀時才前進：讀版面前先刷一幀 */
const flush = async (page) => {
  if (IS_WEBKIT) await page.screenshot()
}
const R = 25
const pt = (p, id = 1) => ({ x: p.x, y: p.y, id, radiusX: R, radiusY: R, force: 0.5 })
const TOUCH = { ctxOpts: { hasTouch: true } }
const sleep = (page, ms) => page.waitForTimeout(ms)

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
const foodTotal = (page) =>
  idb(page, (db) => new Promise((r) => (db.transaction('inventory').objectStore('inventory').getAll().onsuccess = (e) => r(e.target.result.reduce((a, i) => a + (i.qty ?? 0), 0)))))

const enter = async (page, game, age) => {
  if (age) await patchSettings(page, { ageBand: age })
  await page.evaluate((g) => history.replaceState(null, '', `#game/${g}`), game)
  await page.reload()
  await page.waitForSelector(`[data-testid=${game}]`)
  if (age) await page.waitForSelector(`[data-testid=${game}][data-band="${age}"]`)
  await sleep(page, 300)
}
const said = (page, game) => page.evaluate((g) => (document.querySelector(`[data-testid=${g}]`)?.dataset.said ?? '').split(' ').filter(Boolean), game)
const attr = (page, sel, name) => page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n), [sel, name])
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1)
const smallTargets = (page) =>
  page.evaluate(() => {
    const out = []
    for (const b of document.querySelectorAll('[data-testid^=play-] button')) {
      const r = b.getBoundingClientRect()
      if (r.width && (r.width < 55.5 || r.height < 55.5)) out.push(`${b.dataset.testid ?? b.className} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    return out
  })
const outside = (page, sel) =>
  page.evaluate((sel) => {
    const bad = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) bad.push(`${el.dataset.testid ?? el.className}@${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`)
    }
    return bad
  }, sel)
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
const centerOf = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}
/** 等積木停下來再量（整座塔縮放 0.4s、掉落 0.24s 還在動時量到的是舊位置） */
const stableCenterOf = async (page, sel) => {
  let prev = await centerOf(page, sel)
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(80)
    const cur = await centerOf(page, sel)
    if (Math.abs(cur.x - prev.x) < 0.5 && Math.abs(cur.y - prev.y) < 0.5) return cur
    prev = cur
  }
  return prev
}
const fingerDrag = async (send, from, to, { steps = 8, id = 1 } = {}) => {
  await send('touchStart', [pt(from, id)])
  for (let i = 1; i <= steps; i++) await send('touchMove', [pt({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, id)])
  await send('touchEnd', [])
}
/** 兩根手指同時拖 */
const twoFingerDrag = async (send, a, b, steps = 8) => {
  await send('touchStart', [pt(a.from, 1), pt(b.from, 2)])
  for (let i = 1; i <= steps; i++) {
    const k = i / steps
    await send('touchMove', [pt({ x: a.from.x + (a.to.x - a.from.x) * k, y: a.from.y + (a.to.y - a.from.y) * k }, 1), pt({ x: b.from.x + (b.to.x - b.from.x) * k, y: b.from.y + (b.to.y - b.from.y) * k }, 2)])
  }
  await send('touchEnd', [])
}
const waitGift = async (page, ms = 4000) => {
  try {
    await page.getByTestId('play-gift').waitFor({ timeout: ms })
    return true
  } catch {
    return false
  }
}
const closeGift = async (page) => {
  const g = page.getByTestId('play-gift')
  if (await g.count()) {
    await sleep(page, 550) // 禮物剛跳出來的 0.5 秒不接受點擊
    await g.click()
  }
}

// ---------- 積木 ----------
const blocks = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-testid=blk-block]')].map((el) => ({ id: Number(el.dataset.id), shape: el.dataset.shape, color: el.dataset.color, x: Number(el.dataset.x), y: Number(el.dataset.y) })))
const SIZE = { cube: [2, 2], long: [4, 1], arch: [4, 2], roof: [4, 2], cyl: [2, 3], half: [4, 2] }
/** 地面第 x 格（積木左邊）放 shape 時手指要放在哪裡：從世界的實際位置換算 */
const columnPoint = async (page, shape, x) => {
  const wr = await page.getByTestId('blk-world').boundingBox()
  const st = await page.getByTestId('blk-stage').boundingBox()
  const cols = Number(await attr(page, '[data-testid=blocks]', 'data-cols'))
  const u = wr.width / cols
  return { x: wr.x + (x + SIZE[shape][0] / 2) * u, y: st.y + st.height * 0.55 }
}
const pick = (page, shape) => centerOf(page, `[data-testid=blk-pick-${shape}]`)

async function testBlocksLayout(b, name, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `積木[${name}]`
  // 3D 積木圖還沒生好：要用色塊畫形狀，版面不破
  await ctx.route('**/art/ui-blk-*.png', (r) => r.fulfill({ status: 404, body: '' }))
  await enter(page, 'blocks', '4-5')
  await flush(page)
  check(`${tag} 沒圖時用色塊畫形狀`, (await page.locator('[data-testid=blk-tray] svg.blk-svg').count()) === 6)
  check(`${tag} 第一次有手勢示範`, (await page.locator('[data-testid=gesture-hint]').count()) === 1)
  check(`${tag} 六種積木、五種顏色`, (await page.locator('[data-testid^=blk-pick-]').count()) === 6 && (await page.locator('[data-testid^=blk-color-]').count()) === 5)
  check(`${tag} 不橫向溢出`, await noOverflow(page))
  check(`${tag} 觸控目標 ≥ 56`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join())
  check(`${tag} 盤子都在畫面內`, (await outside(page, '[data-testid=blk-tray] button, [data-testid=game-back]')).length === 0, (await outside(page, '[data-testid=blk-tray] button')).join())
  check(`${tag} 4–5 歲沒有藍圖`, (await page.getByTestId('blk-plan').count()) === 0)
  await shot(page, `blocks-0-${name}`)

  // 點一下：放在中間，一直點就疊高
  await page.getByTestId('blk-pick-cube').tap()
  await sleep(page, 120)
  check(`${tag} 點一下就放一塊在地面`, JSON.stringify((await blocks(page)).map((x) => x.y)) === '[0]')
  check(`${tag} 放了之後示範消失`, (await page.locator('[data-testid=gesture-hint]').count()) === 0)
  await page.getByTestId('blk-pick-cube').tap()
  await sleep(page, 120)
  let bs = await blocks(page)
  check(`${tag} 再點一下疊在上面`, bs.length === 2 && bs[1].y === 2 && bs[1].x === bs[0].x, JSON.stringify(bs))
  await page.waitForFunction(() => document.querySelector('[data-testid=blocks]').dataset.said?.includes('pet.play.blocks.top'), null, { timeout: 2000 }).catch(() => {})
  check(`${tag} 疊到 4 格高寵物說爬到最上面`, (await said(page, 'blocks')).includes('pet.play.blocks.top'))
  check(`${tag} 寵物站在最高那塊`, (await attr(page, '[data-testid=blk-pet]', 'data-on')) === String(bs[1].id))
  await sleep(page, 700)
  await flush(page)
  {
    const pet = await page.getByTestId('blk-pet').boundingBox()
    const topB = await page.locator(`[data-testid=blk-block][data-id="${bs[1].id}"]`).boundingBox()
    const midX = Math.abs(pet.x + pet.width / 2 - (topB.x + topB.width / 2))
    const gap = topB.y - (pet.y + pet.height)
    check(`${tag} 寵物在塔頂上（不擋積木）`, midX < 3 && gap > -pet.height * 0.15 && gap < 4, `dx ${Math.round(midX)} gap ${Math.round(gap)}`)
  }

  // 拖曳：放開時對齊格線
  {
    const from = await pick(page, 'long')
    const to = await columnPoint(page, 'long', 0)
    // 落點：正下方（水平重疊）最高那塊的上緣；手機地面窄，長條會疊在中間的方塊上
    const wantY = Math.max(0, ...bs.filter((x) => x.x < 4 && 0 < x.x + SIZE[x.shape][0]).map((x) => x.y + SIZE[x.shape][1]))
    await fingerDrag(send, from, { x: to.x + 7, y: to.y })
    await sleep(page, 150)
    bs = await blocks(page)
    const long = bs.find((x) => x.shape === 'long')
    check(`${tag} 拖到地面：對齊格線、落在正下方最高那塊上`, long && long.x === 0 && long.y === wantY, `${JSON.stringify(long)} want y ${wantY}`)
  }
  // 拿起下面那塊：上面那塊往下掉
  {
    const bottom = bs.find((x) => x.shape === 'cube' && x.y === 0)
    const topId = bs.find((x) => x.shape === 'cube' && x.y === 2).id
    const from = await centerOf(page, `[data-testid=blk-block][data-id="${bottom.id}"]`)
    const cols = Number(await attr(page, '[data-testid=blocks]', 'data-cols'))
    const to = await columnPoint(page, 'cube', cols - 2)
    await fingerDrag(send, from, to)
    await sleep(page, 400)
    bs = await blocks(page)
    const moved = bs.find((x) => x.id === bottom.id)
    const fell = bs.find((x) => x.id === topId)
    check(`${tag} 已經放好的可以再拖`, moved && moved.x === cols - 2 && moved.y === 0, JSON.stringify(moved))
    check(`${tag} 拿走下面那塊，上面的往下掉`, fell && fell.y === 0, JSON.stringify(fell))
  }
  // 拖回盤子：收起來
  {
    const n0 = (await blocks(page)).length
    const target = (await blocks(page)).find((x) => x.shape === 'long')
    const from = await stableCenterOf(page, `[data-testid=blk-block][data-id="${target.id}"]`)
    const to = await centerOf(page, '[data-testid=blk-tray]')
    // 寵物站在這塊上面、腳踩進來：手指按下去要拿到積木，不是寵物
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid') ?? 'none', from)
    check(`${tag} 寵物腳下的積木按得到`, hit === 'blk-block', hit)
    await fingerDrag(send, from, to)
    await sleep(page, 450)
    const after = await blocks(page)
    check(`${tag} 拖回盤子就收起來`, after.length === n0 - 1, `${n0}→${after.length} from ${Math.round(from.x)},${Math.round(from.y)} to ${Math.round(to.x)},${Math.round(to.y)} ${JSON.stringify(after)}`)
    check(`${tag} 飛回盤子的影子清掉`, (await page.locator('[data-testid=blk-ghost]').count()) === 0)
  }
  // 兩根手指同時放兩塊
  {
    const n0 = (await blocks(page)).length
    const a = { from: (await pick(page, 'half')), to: await columnPoint(page, 'half', 0) }
    const cols = Number(await attr(page, '[data-testid=blocks]', 'data-cols'))
    const c = { from: (await pick(page, 'cyl')), to: await columnPoint(page, 'cyl', Math.floor(cols / 2) - 1) }
    await twoFingerDrag(send, a, c)
    await sleep(page, 200)
    bs = await blocks(page)
    check(`${tag} 兩指同時拖兩塊都放上去`, bs.length === n0 + 2 && bs.some((x) => x.shape === 'half') && bs.some((x) => x.shape === 'cyl'), JSON.stringify(bs.map((x) => x.shape)))
  }
  check(`${tag} 還沒推倒、才放 6 塊：還沒送禮物`, (await page.getByTestId('play-gift').count()) === 0)
  await shot(page, `blocks-1-build-${name}`)

  // 太高：一直點圓柱，塔會縮小，到上限就不給放；積木和寵物都不會跑出畫面
  {
    const limit = Number(await attr(page, '[data-testid=blocks]', 'data-limit'))
    const food0 = await foodTotal(page)
    // 這次已經放過 5 塊（長條、半圓、圓柱與兩個方塊；拖回盤子的長條也算放過）
    let placedN = 5
    let giftAt = 0
    for (let i = 0; i < Math.ceil(limit / 3) + 3; i++) {
      await page.getByTestId('blk-pick-cyl').tap()
      placedN++
      await sleep(page, 40)
      if (placedN === 8) {
        if (await waitGift(page, 2600)) {
          giftAt = 8
          await closeGift(page)
        }
      } else if (!giftAt && (await page.getByTestId('play-gift').count())) giftAt = placedN
    }
    check(`${tag} 一直蓋不推倒：放到第 8 塊送禮物`, giftAt === 8, `giftAt ${giftAt}`)
    check(`${tag} 禮物進背包一份`, (await foodTotal(page)) === food0 + 1)
    await sleep(page, 700)
    await flush(page)
    const top = Number(await attr(page, '[data-testid=blocks]', 'data-top'))
    const scale = Number(await attr(page, '[data-testid=blocks]', 'data-scale'))
    check(`${tag} 到上限就不給放`, top <= limit && top > limit - 3, `top ${top} limit ${limit}`)
    check(`${tag} 塔太高會縮小（不小於一半）`, scale < 1 && scale >= 0.5, String(scale))
    const out = await outside(page, '[data-testid=blk-block], [data-testid=blk-pet]')
    check(`${tag} 再高也不會疊出畫面`, out.length === 0, out.join())
    const clash = await overlaps(page, '[data-testid=blk-block]', '[data-testid=blk-tray], [data-testid=game-back], [data-testid=blk-crash]')
    check(`${tag} 塔不會蓋到盤子、回去鍵、推倒鍵`, clash.length === 0, clash.join())
    await shot(page, `blocks-2-tall-${name}`)
  }

  // 推倒：散一地、寵物大笑、送禮物（只送一次）
  {
    const n0 = (await blocks(page)).length
    const food0 = await foodTotal(page)
    await page.getByTestId('blk-crash').tap()
    await sleep(page, 80)
    check(`${tag} 推倒：積木都散在地上`, (await blocks(page)).length === 0 && (await page.locator('[data-testid=blk-rubble]').count()) === n0)
    await sleep(page, 400)
    await shot(page, `blocks-3-crash-${name}`)
    await page.waitForFunction(() => document.querySelector('[data-testid=blocks]').dataset.said?.includes('pet.play.blocks.crash'), null, { timeout: 2500 }).catch(() => {})
    check(`${tag} 推倒：寵物說倒下來了`, (await said(page, 'blocks')).includes('pet.play.blocks.crash'))
    check(`${tag} 今天送過了：推倒不再送禮物`, !(await waitGift(page, 4000)) && (await foodTotal(page)) === food0)
    await flush(page)
    const out = await outside(page, '[data-testid=blk-rubble]')
    check(`${tag} 散開的積木都在畫面裡`, out.length === 0, out.join())
    await page.getByTestId('blk-again').tap()
    await sleep(page, 500)
    check(`${tag} 再蓋：地上清空`, (await page.locator('[data-testid=blk-rubble]').count()) === 0 && (await page.getByTestId('blk-again').count()) === 0)
    for (const s of ['cube', 'cube']) await page.getByTestId(`blk-pick-${s}`).tap()
    await sleep(page, 100)
    await page.getByTestId('blk-crash').tap()
    await sleep(page, 200)
    check(`${tag} 推倒可以再來一次`, Number(await attr(page, '[data-testid=blocks]', 'data-crashes')) === 2)
  }
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await send.detach()
  await ctx.close()
}

/** 6–7 歲照著蓋：從畫面讀今天的藍圖（不寫死日期），照著拖出來 */
async function testBlueprint(b, name, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `照著蓋[${name}]`
  await enter(page, 'blocks', '6-7')
  check(`${tag} 6–7 歲有藍圖`, (await page.getByTestId('blk-plan').count()) === 1)
  check(`${tag} 藍圖不擋回去鍵與盤子`, (await overlaps(page, '[data-testid=blk-plan]', '[data-testid=game-back], [data-testid=blk-tray]')).length === 0)
  await page.getByTestId('blk-plan').tap()
  await sleep(page, 100)
  check(`${tag} 點藍圖寵物說照著蓋`, (await said(page, 'blocks')).includes('pet.play.blocks.copy'))
  const plan = JSON.parse(await attr(page, '[data-testid=blk-plan]', 'data-plan'))
  const planId = await attr(page, '[data-testid=blk-plan]', 'data-plan-id')
  check(`${tag} 藍圖 3–5 塊`, plan.length >= 3 && plan.length <= 5, planId)
  // 換個顏色、能平移就往右平移 1 格來蓋：顏色與位置不管
  const cols = Number(await attr(page, '[data-testid=blocks]', 'data-cols'))
  const planW = Math.max(...plan.map((p) => p.x + SIZE[p.shape][0]))
  const shift = cols - planW >= 1 ? 1 : 0
  await page.getByTestId('blk-color-sky').tap()
  for (const [i, p] of plan.entries()) {
    if (i === plan.length - 1) await page.getByTestId('blk-color-sun').tap()
    await fingerDrag(send, await pick(page, p.shape), await columnPoint(page, p.shape, p.x + shift))
    await sleep(page, 120)
  }
  const bs = await blocks(page)
  check(`${tag} 照順序放就疊成藍圖的樣子`, JSON.stringify(bs.map((x) => [x.shape, x.x - shift, x.y])) === JSON.stringify(plan.map((p) => [p.shape, p.x, p.y])), JSON.stringify(bs))
  await page.waitForFunction(() => document.querySelector('[data-testid=blocks]').dataset.said?.includes('pet.play.blocks.match'), null, { timeout: 2000 }).catch(() => {})
  check(`${tag} 蓋得一樣：寵物說一模一樣`, (await said(page, 'blocks')).includes('pet.play.blocks.match'))
  check(`${tag} 放煙火`, (await page.getByTestId('blk-fireworks').count()) === 1)
  check(`${tag} 藍圖打勾`, (await attr(page, '[data-testid=blk-plan]', 'data-matched')) === '1')
  await sleep(page, 300)
  await shot(page, `blocks-4-match-${name}`)
  check(`${tag} 蓋好送禮物`, await waitGift(page, 4000))
  await closeGift(page)
  await page.waitForFunction((id) => document.querySelector('[data-testid=blk-plan]')?.dataset.planId !== id, planId, { timeout: 5000 }).catch(() => {})
  check(`${tag} 煙火放完換下一張藍圖`, (await attr(page, '[data-testid=blk-plan]', 'data-plan-id')) !== planId)
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await send.detach()
  await ctx.close()
}

/** 3D 圖到了：用圖（珊瑚紅）＋靜態 filter 換色；動作減少時推倒照樣散開；三種寵物 */
async function testBlocksArt(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, { ...TOUCH, ctxOpts: { hasTouch: true, reducedMotion: 'reduce' } })
  const tag = '積木[圖與動作減少]'
  await ctx.route('**/art/ui-blk-*.png', (r) => r.fulfill({ path: new URL('../public/art/food-apple.png', import.meta.url).pathname }))
  await patchPet(page, { species: 'tiger' })
  await enter(page, 'blocks', '3')
  check(`${tag} 3 歲沒有藍圖`, (await page.getByTestId('blk-plan').count()) === 0)
  await page.waitForSelector('[data-testid=blk-pick-cube] img.blk-img')
  check(`${tag} 有圖就用圖`, (await page.locator('[data-testid=blk-tray] img.blk-img').count()) === 6)
  await page.getByTestId('blk-color-leaf').tap()
  await page.getByTestId('blk-pick-arch').tap()
  await page.getByTestId('blk-color-grape').tap()
  await page.getByTestId('blk-pick-roof').tap()
  await sleep(page, 100)
  const cls = await page.evaluate(() => [...document.querySelectorAll('[data-testid=blk-block] img')].map((i) => [i.className, getComputedStyle(i).filter]))
  check(`${tag} 換色是靜態 filter`, cls.length === 2 && cls[0][0].includes('blk-c-leaf') && cls[1][0].includes('blk-c-grape') && cls.every(([, f]) => f.includes('hue-rotate')), JSON.stringify(cls))
  const anim = await page.evaluate(() => document.getAnimations().filter((a) => JSON.stringify(a.effect?.getKeyframes?.() ?? []).includes('filter')).length)
  check(`${tag} 沒有 filter 動畫`, anim === 0)
  const src = await page.evaluate(() => document.querySelector('[data-testid=blk-pet] img')?.getAttribute('src') ?? '')
  check(`${tag} 用孩子自己的寵物（老虎）`, src.includes('tiger'), src)
  const food0 = await foodTotal(page)
  await page.getByTestId('blk-crash').tap()
  await sleep(page, 150)
  const r = await page.evaluate(() => [...document.querySelectorAll('[data-testid=blk-rubble]')].map((el) => [el.style.transform, el.getAnimations().length]))
  check(`${tag} 動作減少：推倒直接散開、不演飛的動畫`, r.length === 2 && r.every(([t, n]) => t.includes('rotate') && n === 0), JSON.stringify(r))
  await sleep(page, 400)
  await shot(page, 'blocks-5-art-reduced')
  check(`${tag} 推倒一次就算玩完：送禮物`, await waitGift(page, 5000))
  await closeGift(page)
  await sleep(page, 200)
  check(`${tag} 禮物進背包一份`, (await foodTotal(page)) === food0 + 1)
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- 拼圖 ----------
const pieces = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid=pzl-piece]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { i: Number(el.dataset.piece), locked: el.dataset.locked === '1', t: el.style.transform, x: r.x, y: r.y, w: r.width, h: r.height }
    }),
  )
const slotBox = (page, i) => page.locator(`[data-testid=pzl-slot][data-slot="${i}"]`).boundingBox()
/** 原樣（不歪）的碎片左上角 → 拖的時候手指抓中間：用 transform 裡的 translate 算碎片的未旋轉位置 */
const pieceCenter = async (page, i) => {
  const b = await page.locator(`[data-testid=pzl-piece][data-piece="${i}"]`).boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
/** 把第 i 片拖到它的位置，偏移 (dx, dy) 片 */
const dragTo = async (page, send, i, dx = 0, dy = 0, id = 1) => {
  const from = await pieceCenter(page, i)
  const s = await slotBox(page, i)
  await fingerDrag(send, from, { x: s.x + s.width / 2 + dx * s.width, y: s.y + s.height / 2 + dy * s.height }, { id, steps: 6 })
}
const addArtwork = (page) =>
  page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 600
    c.height = 450
    const g = c.getContext('2d')
    g.fillStyle = '#bfe8ff'
    g.fillRect(0, 0, 600, 450)
    g.fillStyle = '#ff7a6b'
    g.beginPath()
    g.arc(300, 220, 140, 0, 7)
    g.fill()
    const png = c.toDataURL('image/png')
    await new Promise((r) => {
      const o = indexedDB.open('guaibao-quest')
      o.onsuccess = () => {
        const tx = o.result.transaction('coloring', 'readwrite')
        tx.objectStore('coloring').put({ pageId: 'g:e2e-mine', fills: {}, updatedAt: Date.now(), png, createdAt: Date.now() })
        tx.oncomplete = () => r(1)
      }
    })
  })

async function testPuzzle(b, name, vp, age) {
  const { ctx, page, errors } = await freshApp(b, vp, TOUCH)
  const send = await touchSender(ctx, page)
  const tag = `拼圖[${name} ${age}]`
  await addArtwork(page)
  await enter(page, 'puzzle', age)
  await page.waitForSelector('[data-testid=pzl-pic][data-mine]')
  check(`${tag} 自己畫的排最前面`, (await attr(page, '[data-testid=pzl-pic]', 'data-mine')) === '1')
  check(`${tag} 後面接 8 張場景圖`, (await page.locator('[data-testid=pzl-pic]:not([data-mine])').count()) === 8)
  await page.waitForFunction(() => document.querySelector('[data-testid=puzzle]').dataset.said?.includes('pet.play.puzzle.mine'), null, { timeout: 4000 }).catch(() => {})
  check(`${tag} 寵物說這是你畫的`, (await said(page, 'puzzle')).includes('pet.play.puzzle.mine'))
  const SIZES_FOR = { 3: [], '4-5': [6, 9], '6-7': [9, 16] }
  const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=pzl-size-]')].map((e) => Number(e.dataset.testid.slice(9))))
  check(`${tag} 片數選項`, JSON.stringify(opts) === JSON.stringify(SIZES_FOR[age]), JSON.stringify(opts))
  check(`${tag} 選圖：不橫向溢出`, await noOverflow(page))
  check(`${tag} 選圖：觸控目標 ≥ 56`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join())
  await shot(page, `puzzle-0-pick-${name}-${age}`)
  const want = age === '3' ? 4 : SIZES_FOR[age][1]
  if (age !== '3') await page.getByTestId(`pzl-size-${want}`).tap()
  await page.locator('[data-testid=pzl-pic]').first().tap()
  await page.waitForSelector('[data-testid=pzl-piece]')
  await sleep(page, 200)
  await flush(page)
  let ps = await pieces(page)
  check(`${tag} 片數`, ps.length === want, String(ps.length))
  check(`${tag} 一開始都沒拼上`, ps.every((p) => !p.locked))
  check(`${tag} 打散的碎片都在畫面內`, (await outside(page, '[data-testid=pzl-piece], [data-testid=pzl-board]')).length === 0, (await outside(page, '[data-testid=pzl-piece]')).join())
  const onBoard = await overlaps(page, '[data-testid=pzl-piece]', '[data-testid=pzl-board]')
  check(`${tag} 碎片沒有壓在底板上`, onBoard.length === 0, onBoard.join())
  check(`${tag} 碎片不擋回去鍵與寵物`, (await overlaps(page, '[data-testid=pzl-piece], [data-testid=pzl-board]', '[data-testid=game-back], [data-testid=pzl-pet]')).length === 0)
  if (name !== 'phone') check(`${tag} 一片夠大（≥ 56）`, ps.every((p) => p.w >= 55), String(Math.round(ps[0].w)))
  check(`${tag} 底板有淡淡的原圖`, Math.abs(Number(await page.evaluate(() => getComputedStyle(document.querySelector('.pzl-ghostimg')).opacity)) - 0.25) < 0.01)
  check(`${tag} 第一次有手勢示範`, (await page.locator('[data-testid=puzzle] [data-testid=play-hand]').count()) === 1)
  await shot(page, `puzzle-1-play-${name}-${age}`)

  // 太遠：不吸，留在放開的地方
  {
    const s = await slotBox(page, 0)
    await dragTo(page, send, 0, 0, 1.05)
    await sleep(page, 80)
    const p0 = (await pieces(page)).find((p) => p.i === 0)
    check(`${tag} 離太遠不會吸過去`, !p0.locked && Math.abs(p0.y + p0.h / 2 - (s.y + s.height * 1.55)) < p0.h * 0.2, `${Math.round(p0.y)} vs ${Math.round(s.y)}`)
    check(`${tag} 示範在第一次碰之後消失`, (await page.locator('[data-testid=puzzle] [data-testid=play-hand]').count()) === 0)
  }
  // 附近：吸過去，剛好對齊
  {
    await dragTo(page, send, 0, 0.18, -0.15)
    await sleep(page, 300)
    await flush(page)
    const p0 = (await pieces(page)).find((p) => p.i === 0)
    const s = await slotBox(page, 0)
    check(`${tag} 拖到附近就吸過去`, p0.locked && Math.abs(p0.x - s.x) < 1.5 && Math.abs(p0.y - s.y) < 1.5, `${Math.round(p0.x - s.x)},${Math.round(p0.y - s.y)}`)
    check(`${tag} 第一片說拼上去了`, (await said(page, 'puzzle')).filter((k) => k === 'pet.play.puzzle.snap').length === 1)
  }
  // 兩根手指同時拖兩片
  {
    const a = { from: await pieceCenter(page, 1), s: await slotBox(page, 1) }
    const c = { from: await pieceCenter(page, 2), s: await slotBox(page, 2) }
    await twoFingerDrag(send, { from: a.from, to: { x: a.s.x + a.s.width / 2, y: a.s.y + a.s.height / 2 } }, { from: c.from, to: { x: c.s.x + c.s.width / 2, y: c.s.y + c.s.height / 2 } }, 6)
    await sleep(page, 150)
    ps = await pieces(page)
    check(`${tag} 兩指同時拖兩片都拼上`, ps.find((p) => p.i === 1).locked && ps.find((p) => p.i === 2).locked)
  }
  const food0 = await foodTotal(page)
  for (let i = 3; i < want; i++) await dragTo(page, send, i, 0.05, 0.05)
  await sleep(page, 200)
  ps = await pieces(page)
  check(`${tag} 全部拼好`, ps.every((p) => p.locked))
  check(`${tag} 拼完亮一下`, (await attr(page, '[data-testid=puzzle]', 'data-phase')) === 'done' && (await page.getByTestId('pzl-shine').count()) === 1)
  const keys = await said(page, 'puzzle')
  check(`${tag} 寵物說拼好了`, keys.includes('pet.play.puzzle.done'))
  const snaps = keys.filter((k) => k === 'pet.play.puzzle.snap').length
  check(`${tag} 不是每片都說拼上去了`, snaps >= 1 && snaps < want - 1, `${snaps}/${want}`)
  await sleep(page, 400)
  await flush(page)
  check(`${tag} 拼完：換一張與寵物在畫面內、不擋圖`, (await outside(page, '[data-testid=pzl-again], [data-testid=pzl-pet]')).length === 0 && (await overlaps(page, '[data-testid=pzl-again], [data-testid=pzl-pet]', '[data-testid=pzl-board]')).length === 0, (await overlaps(page, '[data-testid=pzl-again], [data-testid=pzl-pet]', '[data-testid=pzl-board]')).join())
  await shot(page, `puzzle-2-done-${name}-${age}`)
  check(`${tag} 拼完送禮物`, await waitGift(page, 4000))
  await closeGift(page)
  await sleep(page, 200)
  check(`${tag} 禮物進背包一份`, (await foodTotal(page)) === food0 + 1)
  await page.getByTestId('pzl-again').tap()
  await page.waitForSelector('[data-testid=pzl-pics]')
  check(`${tag} 換一張回到選圖`, (await attr(page, '[data-testid=puzzle]', 'data-phase')) === 'pick')
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await send.detach()
  await ctx.close()
}

/** 固定洗牌：同一張圖、同一天、同樣片數，重來一次位置一樣；換一張圖就不一樣 */
async function testPuzzleShuffle(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, TOUCH)
  const tag = '拼圖[固定洗牌]'
  await enter(page, 'puzzle', '4-5')
  const layout = async (k) => {
    await page.locator('[data-testid=pzl-pic]').nth(k).tap()
    await page.waitForSelector('[data-testid=pzl-piece]')
    await sleep(page, 150)
    const t = (await pieces(page)).sort((a, c) => a.i - c.i).map((p) => p.t)
    await page.getByTestId('game-back').tap()
    await enter(page, 'puzzle', '4-5')
    return t
  }
  const a = await layout(1)
  const a2 = await layout(1)
  const c = await layout(2)
  check(`${tag} 同一張圖重來一次一樣`, JSON.stringify(a) === JSON.stringify(a2) && a.length === 6)
  check(`${tag} 換一張圖排法不同`, JSON.stringify(a) !== JSON.stringify(c))
  check(`${tag} 沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

const b = await launch()
try {
  if (on('blocks')) {
    for (const [name, vp] of Object.entries(SIZES)) await testBlocksLayout(b, name, vp)
    await testBlueprint(b, 'land', SIZES.land)
    await testBlueprint(b, 'phone', SIZES.phone)
    await testBlocksArt(b)
  }
  if (on('puzzle')) {
    await testPuzzle(b, 'land', SIZES.land, '6-7')
    await testPuzzle(b, 'port', SIZES.port, '4-5')
    await testPuzzle(b, 'phone', SIZES.phone, '3')
    await testPuzzle(b, 'phone', SIZES.phone, '6-7')
    await testPuzzleShuffle(b)
  }
} finally {
  await b.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
