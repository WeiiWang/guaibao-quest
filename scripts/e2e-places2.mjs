// v8.2 線 S E2E（第二批）：著色本、畫廊、圖鑑、相簿變成世界裡的地方。
// 背景存在、三種尺寸不橫向溢出、寵物不蓋按鈕、畫廊空畫框、圖鑑剪影、相簿翻頁與點開、招呼只說一次。
// 用法：先啟動 dev server（pnpm dev --port 5184 --strictPort），再
//   BASE_URL=http://localhost:5184 node scripts/e2e-places2.mjs       （或 pnpm e2e:places2；E2E_BROWSER=webkit 改用 WebKit）
//   想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-places2.mjs（不要放 repo 裡）
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, freshApp, idb, IS_WEBKIT, launch, makeChecker } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const SHOT_DIR = process.env.SHOT_DIR
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
const shot = async (page, name) => {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}.png` })
}
const here = dirname(fileURLToPath(import.meta.url))
const QUESTIONS = ['number', 'classify', 'pattern', 'measure', 'space', 'observe', 'english', 'life', 'nature'].flatMap((f) => JSON.parse(readFileSync(join(here, `../src/learning/content/${f}.json`), 'utf8')))
const touchOf = (vp) => (vp.width < 500 ? { hasTouch: true, isMobile: true } : {})

const goHash = async (page, hash, sel) => {
  await page.evaluate((h) => (location.hash = h), hash)
  await page.waitForSelector(sel)
  await page.waitForTimeout(350)
}
const openArt = async (page) => {
  await page.getByRole('button', { name: /著色本/ }).first().click()
  await page.waitForSelector('[data-testid=free-card]')
  await page.waitForTimeout(350)
}
const noOverflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
/** 背景：DOM 有這個地方的背景層，圖真的載得到 */
const backdropOk = (page, place) =>
  page.evaluate(async (place) => {
    const el = document.querySelector(`[data-testid=place-backdrop][data-place=${place}] > div`)
    if (!el) return false
    const url = getComputedStyle(el).backgroundImage.replace(/^url\("?|"?\)$/g, '')
    if (!url.includes(`scene-place-${place}.jpg`)) return false
    return (await fetch(url)).ok
  }, place)
/** 寵物有沒有蓋到別的按鈕（捲到最上與最下各看一次）；回傳蓋到的按鈕文字 */
const petCovers = async (page) => {
  const once = () =>
    page.evaluate(() => {
      const pet = document.querySelector('.pm-stander .companion')?.getBoundingClientRect()
      if (!pet) return ['沒有寵物']
      const hit = []
      for (const b of document.querySelectorAll('main button:not(.companion)')) {
        const r = b.getBoundingClientRect()
        if (r.width && r.height && r.left < pet.right && pet.left < r.right && r.top < pet.bottom && pet.top < r.bottom) hit.push(b.innerText || b.getAttribute('aria-label') || b.className)
      }
      return hit
    })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(80)
  const a = await once()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(80)
  const b = await once()
  await page.evaluate(() => window.scrollTo(0, 0))
  return [...a, ...b]
}

const putRows = (page, store, rows) =>
  idb(page, (db, a) => new Promise((r) => { const tx = db.transaction(a.store, 'readwrite'); for (const row of a.rows) tx.objectStore(a.store).put(row); tx.oncomplete = () => r(1) }), { store, rows })
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg=='
const FRAMES = [undefined, 'wood', 'silver', 'gold', 'rainbow', 'star', 'wood', undefined]
const seedWorks = (page, n) =>
  putRows(page, 'coloring', Array.from({ length: n }, (_, i) => ({ pageId: `g:w${i}`, basePageId: ['free-1', 'free-2', 'free-3'][i % 3], fills: {}, strokes: [], stickers: [], png: PNG, frame: FRAMES[i % FRAMES.length], createdAt: 1000 + i, updatedAt: 1000 + i })))
const KINDS = ['hatch', 'grow', 'trick', 'chapter', 'hat', 'milestone', 'wish', 'festival']
const seedAlbum = (page, n) =>
  idb(page, (db, album) => new Promise((r) => { const tx = db.transaction('settings', 'readwrite'); const st = tx.objectStore('settings'); st.get('main').onsuccess = (e) => st.put({ ...e.target.result, album, albumInit: true }); tx.oncomplete = () => r(1) }),
    Array.from({ length: n }, (_, i) => ({ id: i < 2 ? KINDS[i] : `${KINDS[i % 8]}:x${i}`, kind: KINDS[i % 8], caption: `第 ${i + 1} 張回憶，我們一起玩`, art: 'pet-adult-cheer', at: Date.now() - i * 86400000 })))
/** 假裝孩子答過每 step 題（都答對）：認識不少朋友 */
const seedFriends = (page, step) =>
  putRows(page, 'attempts', QUESTIONS.filter((_, i) => i % step === 0).map((q, i) => ({ id: `fake:${q.id}`, at: 1000 + i, questionId: q.id, skill: q.skill, difficulty: q.difficulty, firstTryCorrect: true, hintsUsed: 0, durationMs: 1, sessionId: 'x' })))

async function testArt(b, tag, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, { ctxOpts: touchOf(vp) })
  await openArt(page)
  check(`[${tag}] 著色本：畫室背景`, await backdropOk(page, 'art'))
  check(`[${tag}] 著色本：沒有橫向溢出`, await noOverflowX(page))
  check(`[${tag}] 著色本：空白畫紙、連連看、簡單、挑戰各是一本畫冊`, (await page.locator('.pm-sketch').count()) === 4)
  const slot = await page.getByTestId('free-1').boundingBox()
  check(`[${tag}] 著色本：空白畫紙是大大一張`, slot.width >= 100, `${Math.round(slot.width)}px`)
  // 連連看全部排得下，不用橫滑、不被切
  const strip = await page.evaluate(() => {
    const s = document.querySelector('[data-testid=dots-strip]')
    const right = Math.max(...[...s.children].map((c) => c.getBoundingClientRect().right))
    return { scroll: s.scrollWidth <= s.clientWidth + 1, right, vw: innerWidth, n: s.children.length }
  })
  check(`[${tag}] 著色本：連連看全部排得下（沒有被切）`, strip.scroll && strip.right <= strip.vw && strip.n >= 12, JSON.stringify(strip))
  const cover = await petCovers(page)
  check(`[${tag}] 著色本：寵物沒蓋到按鈕`, cover.length === 0, cover.join(' | '))
  await shot(page, `art-${tag}`)
  check(`[${tag}] 著色本：沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function testGallery(b, tag, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, { ctxOpts: touchOf(vp) })
  await goHash(page, 'gallery', '[data-testid=gallery-empty]')
  check(`[${tag}] 畫廊：牆面背景`, await backdropOk(page, 'gallery'))
  check(`[${tag}] 畫廊空：沒有橫向溢出`, await noOverflowX(page))
  const blanks = await page.getByTestId('gallery-blank-frame').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length)
  check(`[${tag}] 畫廊空：牆上掛幾個空畫框`, blanks >= 4, String(blanks))
  const go = await page.getByTestId('gallery-go-paint').boundingBox()
  check(`[${tag}] 畫廊空：「去畫畫」一屏看得到（≥ 56px）`, go.height >= 56 && go.y + go.height <= vp.height, JSON.stringify(go))
  const empty = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, q: document.querySelector('[data-testid=gallery-empty]').innerText.includes('？') }))
  check(`[${tag}] 畫廊空：一屏放得下、不用捲`, empty.h <= vp.height + 1, String(empty.h))
  let cover = await petCovers(page)
  check(`[${tag}] 畫廊空：寵物沒蓋到按鈕`, cover.length === 0, cover.join(' | '))
  await shot(page, `gallery-empty-${tag}`)
  // 點空畫框 = 去畫畫
  await page.getByTestId('gallery-blank-frame').first().click()
  await page.waitForSelector('[data-testid=free-bg]')
  check(`[${tag}] 點空畫框：進空白畫紙`, (await page.getByTestId('paint-screen').getAttribute('data-page')) === 'free-1')
  // 兩幅作品：其餘位置還是空畫框
  await seedWorks(page, 2)
  await page.evaluate(() => (location.hash = 'gallery'))
  await page.reload()
  await page.waitForSelector('[data-testid=gallery-item]')
  await page.waitForTimeout(300)
  check(`[${tag}] 畫廊 2 幅：2 幅作品 + 4 個空畫框`, (await page.getByTestId('gallery-item').count()) === 2 && (await page.getByTestId('gallery-blank-frame').count()) === 4)
  // 八幅：掛滿，沒有空框；畫框沿用作品選的
  await seedWorks(page, 8)
  await page.reload()
  await page.waitForSelector('[data-testid=gallery-item]')
  await page.waitForTimeout(300)
  check(`[${tag}] 畫廊 8 幅：牆掛滿、沒有空畫框`, (await page.getByTestId('gallery-item').count()) === 8 && (await page.getByTestId('gallery-blank-frame').count()) === 0)
  const fr = await page.locator('.gallery-thumb .gallery-frame').evaluateAll((els) => els.map((e) => e.dataset.frame).sort().join())
  check(`[${tag}] 畫廊：每幅都掛在自己的畫框裡`, fr === ['gold', 'plain', 'plain', 'rainbow', 'silver', 'star', 'wood', 'wood'].join(), fr)
  const lit = await page.locator('.pm-wall-slot').first().evaluate((e) => ({ a: getComputedStyle(e, '::after').content, b: getComputedStyle(e, '::before').content }))
  check(`[${tag}] 畫廊：每幅有投射燈`, lit.a !== 'none' && lit.b !== 'none', JSON.stringify(lit))
  check(`[${tag}] 畫廊：沒有橫向溢出`, await noOverflowX(page))
  cover = await petCovers(page)
  check(`[${tag}] 畫廊：寵物沒蓋到按鈕`, cover.length === 0, cover.join(' | '))
  await shot(page, `gallery-${tag}`)
  await page.locator('.gallery-thumb').first().click()
  check(`[${tag}] 畫廊：點作品看得到大圖`, await page.waitForSelector('[data-testid=gallery-view]', { timeout: 4000 }).then(() => true, () => false))
  check(`[${tag}] 畫廊：沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function testFriends(b, tag, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, { ctxOpts: touchOf(vp) })
  await goHash(page, 'friends', '[data-testid=friends-grid]')
  check(`[${tag}] 圖鑑：樹屋背景`, await backdropOk(page, 'friends'))
  check(`[${tag}] 圖鑑全新：沒有橫向溢出`, await noOverflowX(page))
  const text = await page.getByTestId('friends-grid').innerText()
  check(`[${tag}] 圖鑑全新：沒有問號`, !/[?？]/.test(text), text.slice(0, 40))
  const filter = await page.locator('[data-testid=friend][data-known=false] .friend-img').first().evaluate((el) => getComputedStyle(el).filter)
  check(`[${tag}] 圖鑑全新：還沒認識的是剪影`, /brightness\(0\)/.test(filter), filter)
  const cell = await page.getByTestId('friend').first().boundingBox()
  check(`[${tag}] 圖鑑：大卡片`, cell.width >= (vp.width < 500 ? 150 : 220) && cell.height >= (vp.width < 500 ? 150 : 220), JSON.stringify(cell))
  let cover = await petCovers(page)
  check(`[${tag}] 圖鑑：寵物沒蓋到按鈕`, cover.length === 0, cover.join(' | '))
  await shot(page, `friends-empty-${tag}`)
  await seedFriends(page, 6)
  await page.reload()
  await page.waitForSelector('[data-testid=friends-grid]')
  await page.waitForTimeout(300)
  check(`[${tag}] 圖鑑：進度還在`, /認識 \d+ \/ \d+ 個朋友/.test(await page.getByTestId('friends-progress').innerText()))
  for (const t of ['animal', 'food', 'thing', 'nature', 'life', 'english']) {
    await page.getByTestId(`friend-tab-${t}`).click()
    check(`[${tag}] 圖鑑分頁 ${t}：切得過去、沒有橫向溢出`, (await page.getByTestId('friends-grid').getAttribute('data-tab')) === t && (await noOverflowX(page)))
  }
  await page.getByTestId('friend-tab-food').click()
  await shot(page, `friends-${tag}`)
  const known = page.locator('[data-testid=friend][data-known=true]').first()
  check(`[${tag}] 圖鑑：認識的朋友是彩色、有名字`, (await known.locator('.friend-name').innerText()).trim().length > 0)
  await known.click()
  check(`[${tag}] 圖鑑：點認識的朋友會放大`, await page.waitForSelector('[data-testid=friend-view]', { timeout: 4000 }).then(() => true, () => false))
  await page.getByRole('button', { name: '好', exact: true }).click()
  cover = await petCovers(page)
  check(`[${tag}] 圖鑑（有朋友）：寵物沒蓋到按鈕`, cover.length === 0, cover.join(' | '))
  check(`[${tag}] 圖鑑：沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function testAlbum(b, tag, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, { ctxOpts: touchOf(vp), stage: 'egg' })
  await goHash(page, 'album', '[data-testid=album-empty]')
  check(`[${tag}] 相簿：桌面背景`, await backdropOk(page, 'album'))
  check(`[${tag}] 相簿空：沒有橫向溢出、一屏放得下`, (await noOverflowX(page)) && (await page.evaluate(() => document.documentElement.scrollHeight)) <= vp.height + 1)
  check(`[${tag}] 相簿：俯視桌面，沒有站著的寵物`, (await page.locator('.pm-stander').count()) === 0)
  const go = await page.getByTestId('album-empty-go').boundingBox()
  check(`[${tag}] 相簿空：按鈕在畫面內`, go.y + go.height <= vp.height && go.x + go.width <= vp.width && go.height >= 56, JSON.stringify(go))
  await shot(page, `album-empty-${tag}`)
  // 兩張：一頁一張、大大的
  await seedAlbum(page, 2)
  await page.reload()
  await page.waitForSelector('[data-testid=album-card]')
  await page.waitForTimeout(300)
  const big = await page.getByTestId('album-card').first().boundingBox()
  check(`[${tag}] 相簿 2 張：卡片放大（不是小卡）`, big.width >= (vp.width < 500 ? 130 : 300), `${Math.round(big.width)}px`)
  check(`[${tag}] 相簿 2 張：只有一個跨頁、不用翻頁鈕`, (await page.getByTestId('album-next').count()) === 0)
  await shot(page, `album-few-${tag}`)
  // 多張：翻頁瀏覽
  await seedAlbum(page, 13)
  await page.reload()
  await page.waitForSelector('[data-testid=album-card]')
  await page.waitForTimeout(300)
  check(`[${tag}] 相簿：有書溝、兩頁`, (await page.locator('.pm-book-gutter').count()) === 1 && (await page.locator('.pm-book-spread').first().locator('.pm-book-page').count()) === 2)
  check(`[${tag}] 相簿多張：沒有橫向溢出、頁面不用捲`, (await noOverflowX(page)) && (await page.evaluate(() => document.documentElement.scrollHeight)) <= vp.height + 1)
  const tilts = () => page.locator('[data-testid=album-card]').evaluateAll((els) => els.map((e) => getComputedStyle(e).transform))
  const t1 = await tilts()
  check(`[${tag}] 相簿：相片微傾`, t1.every((t) => t !== 'none') && new Set(t1).size > 1)
  check(`[${tag}] 相簿：相片有紙膠帶`, (await page.locator('[data-testid=album-card]').first().evaluate((e) => getComputedStyle(e, '::before').content)) !== 'none')
  const tags = await page.locator('[data-testid=album-card] .al-tag').allInnerTexts()
  check(`[${tag}] 相簿：標籤全部沒有 emoji`, tags.length === 13 && tags.every((x) => !/\p{Extended_Pictographic}/u.test(x)), tags.join(','))
  const inside = await page.evaluate(() => {
    // 第一個跨頁的相片（含傾斜）都在書裡
    const book = document.querySelector('[data-testid=album-book]').getBoundingClientRect()
    return [...document.querySelector('.pm-book-spread').querySelectorAll('[data-testid=album-card]')].every((c) => {
      const r = c.getBoundingClientRect()
      return r.left >= book.left && r.right <= book.right && r.top >= book.top && r.bottom <= book.bottom
    })
  })
  check(`[${tag}] 相簿：相片沒有超出書`, inside)
  await shot(page, `album-${tag}`)
  await page.getByTestId('album-next').click()
  const scroller = page.getByTestId('album-spreads')
  await page.waitForFunction(() => document.querySelector('[data-testid=album-spreads]').scrollLeft > 50, null, { timeout: 4000 }).catch(() => {})
  check(`[${tag}] 相簿：按下一頁會翻過去`, (await scroller.evaluate((e) => e.scrollLeft)) > 50)
  await page.waitForTimeout(600)
  const left = await scroller.evaluate((e) => [e.scrollLeft, e.clientWidth])
  check(`[${tag}] 相簿：翻完停在整頁上`, Math.abs(left[0] - left[1]) <= 2, left.join('/'))
  await shot(page, `album-2-${tag}`)
  // 第二個跨頁的卡點得開
  const second = page.locator('.pm-book-spread').nth(1).locator('[data-testid=album-card]').first()
  await second.click()
  check(`[${tag}] 相簿：翻頁後的卡片點得開`, await page.waitForSelector('[data-testid=album-view]', { timeout: 4000 }).then(() => true, () => false))
  await shot(page, `album-view-${tag}`)
  await page.getByRole('button', { name: '好', exact: true }).click()
  // 翻到最後一頁，下一頁按鈕停用
  const spreads = await page.locator('.pm-book-spread').count()
  for (let i = 2; i < spreads; i++) {
    await page.getByTestId('album-next').click()
    await page.waitForTimeout(650)
  }
  check(`[${tag}] 相簿：最後一頁不能再翻`, await page.getByTestId('album-next').isDisabled())
  await page.reload()
  await page.waitForSelector('[data-testid=album-card]')
  await page.waitForTimeout(300)
  check(`[${tag}] 相簿：傾斜角度固定（重開一樣）`, JSON.stringify(await tilts()) === JSON.stringify(t1))
  check(`[${tag}] 相簿：沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/** 走進地方的招呼：只播預錄音檔、一次開啟只說一次、不用機器語音 */
async function testGreeting(b) {
  const { ctx, page, errors } = await freshApp(b, SIZES.land, {})
  await ctx.addInitScript(() => {
    localStorage.setItem('gq-place-test', '1')
    localStorage.setItem('gq-voice-pack-test', '1')
    window.__plays = []
    window.__spoken = []
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push(this.src)
      return Promise.resolve()
    }
    const s = window.speechSynthesis
    if (s) s.speak = (u) => window.__spoken.push(u.text)
  })
  await seedWorks(page, 2)
  await seedAlbum(page, 3)
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  const manifest = await (await page.request.get(`${BASE}/voice/manifest.json`)).json()
  const fileOf = (key) => manifest[key]?.file
  const count = async (key) => (await page.evaluate(() => window.__plays)).filter((u) => u.includes(fileOf(key))).length
  const visit = async (hash, sel) => {
    await goHash(page, hash, sel)
    await page.waitForTimeout(700)
    await page.evaluate(() => (location.hash = ''))
    await page.waitForSelector('[data-testid=pet]')
    await page.waitForTimeout(150)
  }
  for (const [key, hash, sel] of [['pet.place.gallery', 'gallery', '[data-testid=gallery-item]'], ['pet.place.friends', 'friends', '[data-testid=friends-grid]'], ['pet.place.album', 'album', '[data-testid=album-card]']]) {
    check(`招呼：${key} 有錄音`, !!fileOf(key))
    await visit(hash, sel)
    check(`招呼：第一次走進去說一次（${key}）`, (await count(key)) === 1, String(await count(key)))
    await visit(hash, sel)
    check(`招呼：再走進去不重複（${key}）`, (await count(key)) === 1, String(await count(key)))
  }
  await openArt(page)
  await page.waitForTimeout(700)
  check('招呼：著色本說一次', (await count('pet.place.art')) === 1, String(await count('pet.place.art')))
  check('招呼：沒有用機器語音', (await page.evaluate(() => window.__spoken)).length === 0, JSON.stringify(await page.evaluate(() => window.__spoken)))
  check('招呼：沒有錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()

  // 空狀態：寵物在邀請畫畫，不接著打招呼（兩句不互相打斷）
  const e = await freshApp(b, SIZES.land, { stage: 'egg' })
  await e.ctx.addInitScript(() => {
    localStorage.setItem('gq-place-test', '1')
    localStorage.setItem('gq-voice-pack-test', '1')
    window.__plays = []
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push(this.src)
      return Promise.resolve()
    }
  })
  await e.page.reload()
  await e.page.waitForSelector('[data-testid=pet]')
  await goHash(e.page, 'gallery', '[data-testid=gallery-empty]')
  await e.page.waitForTimeout(800)
  const plays = await e.page.evaluate(() => window.__plays)
  check('招呼：畫廊空的時候只有邀請那一句', plays.filter((u) => u.includes(fileOf('pet.place.gallery'))).length === 0, JSON.stringify(plays))
  await e.ctx.close()
}

/** 減少動態：寵物不呼吸、翻頁不滑動 */
async function testReducedMotion(b) {
  const { ctx, page } = await freshApp(b, SIZES.land, { ctxOpts: { reducedMotion: 'reduce' } })
  await goHash(page, 'friends', '[data-testid=friends-grid]')
  check('減少動態：寵物沒有動畫', (await page.locator('.pm-stander .companion').evaluate((e) => getComputedStyle(e).animationName)) === 'none')
  await seedAlbum(page, 13)
  await goHash(page, 'album', '[data-testid=album-card]')
  await page.getByTestId('album-next').click()
  await page.waitForTimeout(120)
  const s = await page.getByTestId('album-spreads').evaluate((e) => [e.scrollLeft, e.clientWidth])
  check('減少動態：翻頁直接到位', Math.abs(s[0] - s[1]) <= 2, s.join('/'))
  await ctx.close()
}

const browser = await launch()
try {
  for (const [tag, vp] of Object.entries(SIZES)) {
    await testArt(browser, tag, vp)
    await testGallery(browser, tag, vp)
    await testFriends(browser, tag, vp)
    await testAlbum(browser, tag, vp)
  }
  await testGreeting(browser)
  await testReducedMotion(browser)
} finally {
  await browser.close()
}
console.log(`${IS_WEBKIT ? 'WebKit' : 'Chromium'}：${state.failed === 0 ? '全部通過' : `${state.failed} 項失敗`}`)
process.exit(state.failed === 0 ? 0 : 1)
