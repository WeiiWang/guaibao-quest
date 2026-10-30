// v7.5 線 L E2E：新建孩子選寵物（猴子阿悟、兔子兔兔、老虎虎虎）。
//   - onboarding 多一步「想養哪一隻寵物？」：三顆大圖（各物種幼體 happy 圖，缺圖退回 emoji，不能顯示成猴子），點了唸名字
//   - 選兔兔 → 首頁、進度蛋、帽子、冒險陪伴、相簿、貼紙盤、工坊食譜頭像、空狀態都用兔兔的圖與名字
//   - 新物種的圖「存在 / 不存在」兩種情況都測（route 模擬）：不存在時退回猴子同一個姿勢，不能出現破圖
//   - 選虎虎抽查；舊孩子（沒有 species）一切照舊是阿悟；已經貼在作品上的猴子貼紙不變樣
//   - 語音：寵物台詞依物種挑 @rabbit 音檔，舊孩子照舊播原 key 的檔
// 觸控一律用接觸半徑 25px 的手指（WebKit 沒有 CDP，改用 locator.tap()）。1180×820、820×1180、390×844 三種尺寸。
// 用法：先啟動 dev server（pnpm dev --port 5205 --strictPort），再
//   BASE_URL=http://localhost:5205 node scripts/e2e-pets75.mjs          （或 pnpm e2e:pets75；E2E_BROWSER=webkit 改用 WebKit）
//   想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-pets75.mjs（不要放 repo 裡）
//   PET_ART_DIR=<資料夾>：「圖存在」時用這個資料夾裡的 pet-rabbit-*.png / pet-tiger-*.png（例如替身圖或剛生好的圖）；
//   沒給時：public/art 已經有的新物種圖照常載入，還沒有的用猴子同一張的檔案內容代替（大小比例跟真圖接近）
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, freshApp, idb, IPAD_CTX, IS_WEBKIT, launch, makeChecker, patchPet, pressPin, stripWelcome, touchSender } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const LAND = { width: 1180, height: 820 }
const PORT = { width: 820, height: 1180 }
const PHONE = { width: 390, height: 844 }
const ART_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/art')
const PET_ART_DIR = process.env.PET_ART_DIR
const SHOT_DIR = process.env.SHOT_DIR
const B = IS_WEBKIT ? 'webkit' : 'chromium'
const shot = async (page, name) => SHOT_DIR && page.screenshot({ path: `${SHOT_DIR}/pets75-${B}-${name}.png` })

/** 新物種的寵物圖：mode = 'art'（存在）或 'missing'（還沒生成，回 404） */
async function routePetArt(ctx, mode) {
  await ctx.route(/\/art\/pet-(rabbit|tiger)-[a-z0-9-]+\.png(\?.*)?$/, (route) => {
    const name = route.request().url().match(/art\/(pet-(?:rabbit|tiger)-[a-z0-9-]+)\.png/)?.[1]
    if (mode === 'missing') return route.fulfill({ status: 404, body: '' })
    const own = PET_ART_DIR && join(PET_ART_DIR, `${name}.png`)
    if (own && existsSync(own)) return route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(own) })
    if (existsSync(join(ART_DIR, `${name}.png`))) return route.fallback()
    const monkey = join(ART_DIR, `${name.replace(/^pet-(rabbit|tiger)-/, 'pet-')}.png`)
    return existsSync(monkey) ? route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(monkey) }) : route.fulfill({ status: 404, body: '' })
  })
}

const dump = (page, table) => idb(page, (db, t) => new Promise((r) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => r(e.target.result))), table)
const petOf = async (page) => (await dump(page, 'pets'))[0]
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
const putRow = (page, store, row) =>
  idb(page, (db, a) => new Promise((r) => (db.transaction(a.store, 'readwrite').objectStore(a.store).put(a.row).onsuccess = () => r(1))), { store, row })

/** 接近真機的手指：接觸半徑 25px（寬 50px）。WebKit 沒有 CDP，按鈕改用 locator.tap() */
const finger = { radiusX: 25, radiusY: 25, force: 0.5, id: 0 }
async function fingerTap(page, send, loc) {
  await loc.scrollIntoViewIfNeeded()
  if (IS_WEBKIT) return loc.tap()
  const b = await loc.boundingBox()
  await send('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, ...finger }])
  await page.waitForTimeout(60)
  await send('touchEnd', [])
}
const spyVoice = (ctx) =>
  ctx.addInitScript(() => {
    window.__said = []
    const ss = window.speechSynthesis
    if (ss) {
      ss.speak = (u) => window.__said.push(u.text)
      ss.cancel = () => {}
    }
    const pl = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (...a) {
      window.__said.push(`audio:${this.src}`)
      return pl.apply(this, a)
    }
  })
const said = (page) => page.evaluate(() => window.__said ?? [])
/** 有唸這一句：機器語音唸了、或記成「還沒錄」（WebKit 測試環境沒有 speechSynthesis）、或播了它的預錄音檔 */
const spoke = (page, text, file) =>
  page.evaluate(
    ([t, f]) => (window.__said ?? []).includes(t) || (window.__gqVoiceMiss ?? []).some((m) => m.text === t) || (!!f && (window.__said ?? []).some((s) => s.endsWith(f))),
    [text, file],
  )
const goHash = async (page, hash, sel) => {
  await page.evaluate((h) => (location.hash = h), hash)
  await page.waitForSelector(sel, { timeout: 8000 })
}
const goHome = async (page) => {
  await page.evaluate(() => history.replaceState(null, '', location.pathname))
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
}

/** 等圖都載完（或確定失敗），再看有沒有破圖：每張 img 都載得出來（寬 > 0），也沒有「圖名色塊」的 fallback */
async function noBrokenArt(page, scope = 'body') {
  await page.waitForTimeout(700)
  return page.evaluate(async (scope) => {
    const root = document.querySelector(scope) ?? document.body
    const imgs = [...root.querySelectorAll('img.art')]
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r), setTimeout(r, 2000))))))
    const bad = imgs.filter((i) => i.naturalWidth === 0).map((i) => i.getAttribute('src'))
    const blocks = [...root.querySelectorAll('.art-fallback')].map((e) => e.textContent)
    return { ok: bad.length === 0 && blocks.length === 0, bad, blocks, n: imgs.length }
  }, scope)
}
const srcOf = (page, sel) => page.evaluate((sel) => document.querySelector(sel)?.getAttribute('src') ?? null, sel)
/** 這張圖是不是某個物種的（mode=missing 時應該退回猴子的同一張） */
const isArt = (src, name) => !!src && src.endsWith(`/art/${name}.png`)
const want = (mode, species, monkeyName) => (mode === 'art' ? monkeyName.replace(/^pet-/, `pet-${species}-`) : monkeyName)

/** 全新安裝：PIN、名字、年齡（之後再設定）→ 選寵物 → 蛋 → 開始冒險。回傳 page 停在首頁 */
async function newKid(vp, species, mode, tag, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, ...IPAD_CTX })
  if (IS_WEBKIT) {
    await ctx.addInitScript(() => {
      for (const k of ['setPointerCapture', 'releasePointerCapture']) {
        const f = Element.prototype[k]
        Element.prototype[k] = function (id) {
          try {
            return f.call(this, id)
          } catch {
            /* 合成的觸控指標 */
          }
        }
      }
    })
  }
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gq-pet-tod', 'day')
      localStorage.setItem('gq-pet-tod-set', '1')
    } catch {
      /* ignore */
    }
  })
  await routePetArt(ctx, mode)
  await spyVoice(ctx)
  if (opts.voicePack) await opts.voicePack(ctx)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  const send = await touchSender(ctx, page)
  await page.goto(BASE)
  await page.waitForSelector('button.key')
  await pressPin(page, '1234')
  await pressPin(page, '1234')
  await page.getByPlaceholder('小朋友的名字').fill('小花')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByTestId('onboard-age-skip').click()
  await page.waitForSelector('[data-testid=onboard-species]')
  await page.waitForTimeout(500)
  // 三顆大圖：猴子一定有圖；新物種有圖用圖、沒圖退回自己的 emoji（不能顯示猴子）
  const pick = await page.evaluate(() =>
    ['monkey', 'rabbit', 'tiger'].map((s) => {
      const b = document.querySelector(`[data-testid=species-${s}]`)
      const r = b?.getBoundingClientRect()
      const img = b?.querySelector('img.art')
      return { s, src: img?.getAttribute('src') ?? null, emoji: b?.querySelector('.art-emoji-glyph')?.textContent ?? null, name: b?.querySelector('.l75-pick-name')?.textContent, checked: b?.getAttribute('aria-checked'), w: r?.width ?? 0, h: r?.height ?? 0, artH: b?.querySelector('.l75-pick-art')?.getBoundingClientRect().height ?? 0, inView: !!r && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }
    }),
  )
  check(`[${tag}] 選寵物：三顆（阿悟、兔兔、虎虎），預設是阿悟`, pick.map((p) => p.name).join() === '阿悟,兔兔,虎虎' && pick[0].checked === 'true' && pick[1].checked === 'false', JSON.stringify(pick.map((p) => [p.name, p.checked])))
  check(`[${tag}] 選寵物：大圖（鈕 ≥ 96×120px、圖 ≥ 70px 高），都在畫面內`, pick.every((p) => p.w >= 96 && p.h >= 120 && p.artH >= 70 && p.inView), JSON.stringify(pick.map((p) => [Math.round(p.w), Math.round(p.h), Math.round(p.artH), p.inView])))
  check(`[${tag}] 選寵物：阿悟用 pet-baby-happy 圖`, isArt(pick[0].src, 'pet-baby-happy'), pick[0].src)
  if (mode === 'art') check(`[${tag}] 選寵物（圖存在）：兔兔、虎虎用自己的幼體 happy 圖`, isArt(pick[1].src, 'pet-rabbit-baby-happy') && isArt(pick[2].src, 'pet-tiger-baby-happy'), JSON.stringify(pick.map((p) => p.src)))
  else check(`[${tag}] 選寵物（圖還沒生）：兔兔 🐰、虎虎 🐯，不會顯示成猴子`, !pick[1].src && pick[1].emoji === '🐰' && !pick[2].src && pick[2].emoji === '🐯', JSON.stringify(pick.map((p) => [p.src, p.emoji])))
  await fingerTap(page, send, page.getByTestId(`species-${species}`))
  await page.waitForTimeout(200)
  const name = { monkey: '阿悟', rabbit: '兔兔', tiger: '虎虎' }[species]
  check(`[${tag}] 手指點「${name}」：選起來，並唸「${name}」`, (await page.getByTestId(`species-${species}`).getAttribute('aria-checked')) === 'true' && (await spoke(page, name, `/voice/name-${species}.m4a`)), JSON.stringify((await said(page)).slice(-3)))
  await shot(page, `${tag}-onboard-pick`)
  await fingerTap(page, send, page.getByTestId('onboard-species-next'))
  await page.waitForSelector('.egg-step')
  // 缺圖時：兔兔的蛋還在探測時先等它（不閃猴子），探測回來不存在才換成猴子的蛋 → 等圖片定下來再讀
  const eggWant = `/art/${species === 'monkey' ? 'pet-egg' : want(mode, species, 'pet-egg')}.png`
  await page.waitForFunction((w) => document.querySelector('.egg-step img.pet-img')?.getAttribute('src')?.endsWith(w), eggWant, { timeout: 3000 }).catch(() => {})
  const egg =await page.evaluate(() => ({ text: document.querySelector('.egg-step .lead')?.textContent ?? '', src: document.querySelector('.egg-step img.pet-img')?.getAttribute('src') ?? null }))
  check(`[${tag}] 確認頁：「這是${name}的蛋！」，蛋是${name}的（缺圖退回猴子的蛋）`, egg.text.includes(`這是${name}的蛋！`) && isArt(egg.src, species === 'monkey' ? 'pet-egg' : want(mode, species, 'pet-egg')), JSON.stringify(egg))
  await page.getByRole('button', { name: '開始冒險' }).click()
  await page.waitForSelector('[data-testid=room]')
  await stripWelcome(page)
  const pet = await petOf(page)
  check(`[${tag}] 建立後：Pet.species = ${species}、名字 ${name}`, pet.species === (species === 'monkey' ? undefined : species) && pet.name === name, JSON.stringify({ species: pet.species, name: pet.name }))
  return { ctx, page, errors, send }
}

/** 兔兔（或虎虎）的孩子：首頁、帽子、冒險陪伴、相簿、貼紙盤、工坊食譜、空狀態 */
async function tourSpecies(vp, species, mode, tag) {
  const name = { rabbit: '兔兔', tiger: '虎虎' }[species]
  const { ctx, page, errors, send } = await newKid(vp, species, mode, tag)
  // ---- 首頁：幼體（孵化過了）----
  await patchPet(page, { stage: 'baby', feedCount: 20, hunger: 90, hungerUpdatedAt: Date.now() })
  await goHome(page)
  await page.waitForTimeout(600)
  const home = await page.evaluate(() => ({
    sp: document.querySelector('[data-testid=pet] .pet-sprite')?.dataset.species,
    src: document.querySelector('[data-testid=pet] img.pet-img')?.getAttribute('src') ?? null,
    face: document.querySelector('.avatar-img')?.getAttribute('src') ?? null,
    ring: document.querySelector('[data-testid=progress-egg] img')?.getAttribute('src') ?? null,
  }))
  check(`[${tag}] 首頁：寵物是${name}的幼體圖（缺圖退回猴子同一個姿勢）`, home.sp === species && /\/art\/pet-(rabbit-|tiger-)?baby-[a-z]+\.png$/.test(home.src ?? '') && (mode === 'art' ? home.src.includes(`pet-${species}-baby-`) : !/rabbit|tiger/.test(home.src)), JSON.stringify(home))
  check(`[${tag}] 首頁：左上頭像、長大進度環也是${name}`, mode === 'art' ? home.face?.includes(`pet-${species}-baby-`) && home.ring?.includes(`pet-${species}-baby-happy`) : !!home.face && !/rabbit|tiger/.test(home.face) && isArt(home.ring, 'pet-baby-happy'), JSON.stringify(home))
  const broken = await noBrokenArt(page)
  check(`[${tag}] 首頁：沒有破圖`, broken.ok, JSON.stringify(broken))
  await shot(page, `${tag}-home`)

  // ---- 帽子：戴皇冠，帽子在寵物圖的頭頂、不飛出畫面 ----
  await putRow(page, 'inventory', { id: 'hat-crown', itemId: 'hat-crown', qty: 1 })
  await patchPet(page, { hat: 'hat-crown' })
  await goHome(page)
  // 第一頂帽子會跳一張新的回憶卡（卡上也是戴帽子的${name}）：先看一下再按「好」
  const pop = await page.waitForSelector('[data-testid=memory-pop]', { timeout: 5000 }).catch(() => null)
  if (pop) {
    await page.waitForTimeout(500)
    const popArt = await page.evaluate(() => document.querySelector('[data-testid=memory-pop] .pet-sprite')?.dataset.art ?? null)
    check(`[${tag}] 第一頂帽子的回憶卡：畫的是戴帽子的${name}`, popArt === want(mode, species, 'pet-baby-happy') && (await page.locator('[data-testid=memory-pop] [data-testid=pet-hat]').count()) === 1, popArt)
    await shot(page, `${tag}-hat-card`)
    await fingerTap(page, send, page.getByTestId('memory-close'))
    await page.waitForTimeout(400)
  }
  await page.waitForSelector('[data-testid=pet] [data-testid=pet-hat]')
  await page.waitForTimeout(700)
  const hat = await page.evaluate(() => {
    const h = document.querySelector('[data-testid=pet] [data-testid=pet-hat]')
    const img = document.querySelector('[data-testid=pet] .wd-art img.pet-img')
    const hr = h.getBoundingClientRect()
    const ir = img.getBoundingClientRect()
    return { art: h.dataset.art, src: img.getAttribute('src'), hx: hr.left + hr.width / 2, hTop: hr.top, hBottom: hr.bottom, il: ir.left, ir: ir.right, it: ir.top, ih: ir.height, vw: innerWidth, vh: innerHeight }
  })
  const hatOk = !!hat.art && hat.src.endsWith(`/art/${hat.art}.png`) && hat.hx > hat.il && hat.hx < hat.ir && hat.hBottom > hat.it && hat.hBottom < hat.it + hat.ih * 0.5 && hat.hTop >= 0
  check(`[${tag}] 帽子：戴在${name}（實際顯示的那張圖 ${hat.art}）的頭頂，在圖片上半部、不飛出畫面`, hatOk, JSON.stringify(hat))
  if (mode === 'art') check(`[${tag}] 帽子：依${name}的圖查錨點（還沒量過用預設的頭頂中央）`, hat.art.startsWith(`pet-${species}-baby-`), hat.art)
  else check(`[${tag}] 帽子（圖還沒生）：退回猴子的圖，就用猴子的錨點`, /^pet-baby-/.test(hat.art), hat.art)
  await shot(page, `${tag}-hat`)
  await patchPet(page, { hat: undefined })
  // 帽子收回去、歡迎禮物的香蕉吃掉（後面要看「我的東西」食物分頁的空狀態）
  await idb(page, (db) => new Promise((r) => { const tx = db.transaction('inventory', 'readwrite'); tx.objectStore('inventory').delete('hat-crown'); tx.objectStore('inventory').delete('banana'); tx.oncomplete = () => r(1) }))

  // ---- 冒險陪伴（地圖）----
  await goHash(page, 'map', '[data-testid=companion]')
  await page.waitForTimeout(500)
  const comp = await page.evaluate(() => {
    const c = document.querySelector('[data-testid=companion]')
    return { sp: c?.dataset.species, src: c?.querySelector('img')?.getAttribute('src') ?? null, label: c?.getAttribute('aria-label') }
  })
  check(`[${tag}] 冒險地圖的陪伴是${name}`, comp.sp === species && (mode === 'art' ? comp.src?.includes(`pet-${species}-baby-`) : /\/art\/pet-baby-/.test(comp.src ?? '')) && comp.label?.startsWith(name), JSON.stringify(comp))
  check(`[${tag}] 地圖：沒有破圖`, (await noBrokenArt(page)).ok)
  await shot(page, `${tag}-map`)

  // ---- 成長相簿：孵化那張是${name} ----
  await goHome(page)
  await goHash(page, 'album', '[data-testid=album-card]')
  await page.waitForTimeout(500)
  const album = await page.evaluate(() => ({
    head: document.querySelector('.screen-header, header')?.textContent ?? '',
    body: document.body.textContent,
    src: document.querySelector('[data-testid=album-card][data-card=hatch] img.pet-img')?.getAttribute('src') ?? null,
    sp: document.querySelector('[data-testid=album-card][data-card=hatch] .pet-sprite')?.dataset.species,
    cap: document.querySelector('[data-testid=album-card][data-card=hatch] [data-testid=album-caption]')?.textContent,
    hatCard: document.querySelector('[data-testid=album-card][data-kind=hat] .pet-sprite')?.dataset.art ?? null,
  }))
  const card = (await dump(page, 'settings'))[0].album?.find((c) => c.id === 'hatch')
  check(`[${tag}] 相簿：孵化卡存的是${name}的圖（${card?.art}），卡上畫的也是${name}`, card?.art === `pet-${species}-baby-cheer` && album.sp === species && isArt(album.src, want(mode, species, 'pet-baby-cheer')), JSON.stringify({ art: card?.art, ...album, body: undefined, head: undefined }))
  check(`[${tag}] 相簿：第一頂帽子那張也是${name}戴著帽子`, !!album.hatCard && album.hatCard === want(mode, species, 'pet-baby-happy'), album.hatCard)
  check(`[${tag}] 相簿：文字用${name}（「${name}孵出來了！」「${name}的 N 張回憶卡」「聽${name}說」）`, album.cap === `${name}孵出來了！` && album.body.includes(`${name}的 `) && album.body.includes(`聽${name}說`) && !album.body.includes('阿悟'), album.cap)
  check(`[${tag}] 相簿：沒有破圖`, (await noBrokenArt(page)).ok)
  await shot(page, `${tag}-album`)
  // 新卡都當作看過了（首頁不再跳回憶卡，不會蓋住後面要點的東西）
  const st = (await dump(page, 'settings'))[0]
  await patchSettings(page, { album: (st.album ?? []).map(({ fresh, ...c }) => (void fresh, c)) })

  // ---- 貼紙盤：寵物貼紙是${name}；舊作品上的猴子貼紙不變 ----
  await putRow(page, 'coloring', { pageId: 'free-2', fills: {}, strokes: [], stickers: [{ id: 'old-awu', art: 'pet-adult-happy', x: 120, y: 120, scale: 1, rot: 0 }], updatedAt: Date.now() })
  await goHome(page)
  await page.getByRole('button', { name: /著色本/ }).first().click()
  await page.waitForSelector('[data-testid=free-1]')
  await page.getByTestId('free-1').click()
  await page.waitForSelector('[data-testid=paint-board]')
  await page.getByTestId('tool-sticker').click()
  await page.waitForSelector('[data-testid=sticker-tray]')
  await page.waitForTimeout(500)
  const tray = await page.evaluate(() => [...document.querySelectorAll('[data-testid=sticker-tray] button')].map((b) => ({ id: b.dataset.testid, label: b.getAttribute('aria-label'), src: b.querySelector('img')?.getAttribute('src') ?? null, emoji: b.querySelector('.art-emoji-glyph')?.textContent ?? null })))
  const petSticker = tray.find((t) => t.id === `add-sticker-pet-${species}-adult-happy`)
  check(`[${tag}] 貼紙盤：第一張寵物貼紙換成${name}（標籤「貼上${name}」），沒有猴子貼紙`, !!petSticker && petSticker.label?.startsWith(`貼上${name}`) && !tray.some((t) => t.id === 'add-sticker-pet-adult-happy'), JSON.stringify(tray.slice(0, 3)))
  check(`[${tag}] 貼紙盤：${name}貼紙的圖（缺圖退回猴子同一張，不破圖）`, isArt(petSticker?.src, want(mode, species, 'pet-adult-happy')), petSticker?.src)
  await shot(page, `${tag}-stickers`)
  await fingerTap(page, send, page.getByTestId(`add-sticker-pet-${species}-adult-happy`))
  await page.waitForTimeout(400)
  const placed = await page.evaluate(() => [...document.querySelectorAll('[data-testid=sticker]')].map((s) => ({ art: s.dataset.art, src: s.querySelector('img')?.getAttribute('src') ?? null })))
  check(`[${tag}] 手指點${name}貼紙：貼上去的是${name}（作品存 pet-${species}-adult-happy）`, placed.length === 1 && placed[0].art === `pet-${species}-adult-happy` && isArt(placed[0].src, want(mode, species, 'pet-adult-happy')), JSON.stringify(placed))
  check(`[${tag}] 畫板：沒有破圖`, (await noBrokenArt(page, '[data-testid=paint-board]')).ok)
  // 舊作品（free-2）上的猴子貼紙：存的 art id 照舊
  await page.goto(`${BASE}`)
  await page.waitForSelector('[data-testid=pet]')
  await page.getByRole('button', { name: /著色本/ }).first().click()
  await page.getByTestId('free-2').click()
  await page.waitForSelector('[data-testid=sticker] img', { timeout: 5000 }).catch(() => {}) // 圖探測完才會換成 img（WebKit 較慢）
  const old = await page.evaluate(() => [...document.querySelectorAll('[data-testid=sticker]')].map((s) => ({ art: s.dataset.art, src: s.querySelector('img')?.getAttribute('src') ?? null })))
  check(`[${tag}] 舊作品上的阿悟貼紙不因為換了物種變樣（還是 pet-adult-happy）`, old.length === 1 && old[0].art === 'pet-adult-happy' && isArt(old[0].src, 'pet-adult-happy'), JSON.stringify(old))

  // ---- 工坊：小願望食譜的頭像 ----
  await patchSettings(page, { play: { wishDone: [], wishActive: 'w-ball', wishSaid: 'w-ball' } })
  await goHome(page)
  // 點房間裡的願望泡泡 → 工坊，最上面亮出食譜
  await page.waitForSelector('[data-testid=wish-bubble]', { timeout: 8000 })
  await fingerTap(page, send, page.getByTestId('wish-bubble'))
  await page.waitForSelector('[data-testid=wish-recipe]', { timeout: 8000 })
  await page.waitForTimeout(500)
  const recipe = await page.evaluate(() => ({ src: document.querySelector('[data-testid=wish-recipe] .k74-awu')?.getAttribute('src') ?? null, label: document.querySelector('[data-testid=wish-recipe]')?.getAttribute('aria-label') }))
  check(`[${tag}] 工坊食譜：頭像是${name}（缺圖退回猴子同一張）、「${name}的小願望」`, isArt(recipe.src, want(mode, species, 'pet-baby-think')) && recipe.label?.startsWith(`${name}的小願望`), JSON.stringify(recipe))
  check(`[${tag}] 工坊：沒有破圖`, (await noBrokenArt(page, '[data-testid=wish-recipe]')).ok)
  await shot(page, `${tag}-workshop`)

  // ---- 空狀態：「我的東西」食物空、畫廊空 ----
  await goHome(page)
  await page.getByRole('button', { name: /背包/ }).click()
  await page.waitForSelector('[data-testid=bag-empty-food]')
  await page.waitForSelector('[data-testid=bag-empty-food] .pet-sprite', { timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(300)
  const empty = await page.evaluate(() => ({ src: document.querySelector('[data-testid=bag-empty-food] .j74-empty-pet img')?.getAttribute('src') ?? null, sp: document.querySelector('[data-testid=bag-empty-food] .pet-sprite')?.dataset.species }))
  check(`[${tag}] 「我的東西」空狀態：${name}在想`, empty.sp === species && isArt(empty.src, want(mode, species, 'pet-baby-think')), JSON.stringify(empty))
  await goHome(page)
  await page.evaluate(() => (location.hash = 'gallery'))
  await page.waitForSelector('[data-testid=gallery-empty]')
  await page.waitForTimeout(500)
  const gal = await page.evaluate(() => {
    const e = document.querySelector('[data-testid=gallery-empty] .i74-empty-pet')
    return { src: e?.querySelector('img')?.getAttribute('src') ?? null, emoji: e?.querySelector('.art-emoji-glyph')?.textContent ?? null }
  })
  check(`[${tag}] 畫廊空狀態：${name}（缺圖退回猴子同一張）`, isArt(gal.src, want(mode, species, 'pet-baby-happy')), JSON.stringify(gal))
  check(`[${tag}] 無 JS 錯誤`, errors.length === 0, errors.join(' | '))
  await send.detach()
  await ctx.close()
}

const browser = await launch()
try {
  // ======== 兔兔：圖存在 / 不存在 × 三種尺寸（不存在只測橫向，退回邏輯跟尺寸無關）========
  await tourSpecies(LAND, 'rabbit', 'art', 'rabbit-land-art')
  await tourSpecies(LAND, 'rabbit', 'missing', 'rabbit-land-missing')
  await tourSpecies(PORT, 'rabbit', 'art', 'rabbit-port-art')
  await tourSpecies(PHONE, 'rabbit', 'art', 'rabbit-phone-art')

  // ======== 虎虎抽查：成體、首頁與冒險陪伴 ========
  {
    const tag = 'tiger-land-art'
    const { ctx, page, errors } = await newKid(LAND, 'tiger', 'art', tag)
    await patchPet(page, { stage: 'adult', feedCount: 80, hunger: 90, hungerUpdatedAt: Date.now() })
    await goHome(page)
    await page.waitForTimeout(500)
    const src = await srcOf(page, '[data-testid=pet] img.pet-img')
    check(`[${tag}] 首頁：虎虎的成體圖`, !!src && src.includes('/art/pet-tiger-adult-'), src)
    await goHash(page, 'map', '[data-testid=companion]')
    await page.waitForTimeout(400)
    const c = await page.evaluate(() => ({ sp: document.querySelector('[data-testid=companion]')?.dataset.species, src: document.querySelector('[data-testid=companion] img')?.getAttribute('src') }))
    check(`[${tag}] 冒險陪伴是虎虎`, c.sp === 'tiger' && c.src?.includes('/art/pet-tiger-adult-'), JSON.stringify(c))
    await shot(page, `${tag}-map`)
    check(`[${tag}] 無 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ======== 舊孩子：沒有 species 的存檔一切照舊是阿悟 ========
  for (const [tag, vp] of [['old-land', LAND], ['old-phone', PHONE]]) {
    const { ctx, page, errors } = await freshApp(browser, vp, { stage: 'baby' })
    await routePetArt(ctx, 'art')
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await page.waitForTimeout(500)
    const pet = await petOf(page)
    check(`[${tag}] 舊存檔沒有 species 欄位、名字是阿悟`, !('species' in pet) && pet.name === '阿悟')
    const src = await srcOf(page, '[data-testid=pet] img.pet-img')
    check(`[${tag}] 首頁：阿悟（pet-baby-*，原檔名）`, /\/art\/pet-baby-[a-z]+\.png$/.test(src ?? ''), src)
    await goHash(page, 'map', '[data-testid=companion]')
    await page.waitForTimeout(400)
    const c = await page.evaluate(() => ({ sp: document.querySelector('[data-testid=companion]')?.dataset.species, src: document.querySelector('[data-testid=companion] img')?.getAttribute('src') }))
    check(`[${tag}] 冒險陪伴：阿悟`, c.sp === 'monkey' && /\/art\/pet-baby-/.test(c.src ?? ''), JSON.stringify(c))
    await goHome(page)
    await goHash(page, 'album', '[data-testid=album-card]')
    check(`[${tag}] 相簿：「阿悟孵出來了！」`, (await page.locator('[data-testid=album-caption]').first().innerText()) === '阿悟孵出來了！')
    await goHome(page)
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.getByTestId('free-1').click()
    await page.getByTestId('tool-sticker').click()
    await page.waitForSelector('[data-testid=add-sticker-pet-adult-happy]')
    check(`[${tag}] 貼紙盤：照舊是阿悟貼紙`, (await page.getByTestId('add-sticker-pet-adult-happy').getAttribute('aria-label')).startsWith('貼上阿悟') && (await page.locator('[data-testid^=add-sticker-pet-rabbit], [data-testid^=add-sticker-pet-tiger]').count()) === 0)
    await shot(page, `${tag}-stickers`)
    check(`[${tag}] 無 JS 錯誤`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ======== 語音：寵物台詞依物種挑音檔；舊孩子照舊播原 key 的檔 ========
  {
    const LINE = '還沒有畫畫喔，我們去畫一張吧'
    const voicePack = async (ctx) => {
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('gq-voice-pack-test', '1')
        } catch {
          /* ignore */
        }
      })
      await ctx.route('**/voice/manifest.json', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            'pet.gallery.empty': { file: 'awu-gallery.m4a', text: LINE },
            'pet.gallery.empty@rabbit': { file: 'rabbit-gallery.m4a', text: LINE },
            'species.name.rabbit': { file: 'name-rabbit.m4a', text: '兔兔' },
          }),
        }),
      )
      await ctx.route('**/voice/*.m4a', (route) => route.fulfill({ status: 404, body: '' }))
    }
    const r = await newKid(LAND, 'rabbit', 'art', 'voice-rabbit', { voicePack })
    check('[voice-rabbit] 選寵物點兔兔：播「兔兔」的錄音（species.name.rabbit）', (await said(r.page)).some((s) => s.endsWith('/voice/name-rabbit.m4a')), JSON.stringify((await said(r.page)).slice(0, 4)))
    await r.page.evaluate(() => (window.__said = []))
    await r.page.evaluate(() => (location.hash = 'gallery'))
    await r.page.waitForSelector('[data-testid=gallery-empty]')
    await r.page.waitForTimeout(400)
    const s1 = await said(r.page)
    check('[voice-rabbit] 兔兔的孩子：畫廊空狀態播 pet.gallery.empty@rabbit 的音檔', s1.some((s) => s.endsWith('/voice/rabbit-gallery.m4a')) && !s1.some((s) => s.endsWith('/voice/awu-gallery.m4a')), JSON.stringify(s1))
    await r.ctx.close()

    const o = await freshApp(browser, LAND, { stage: 'baby' })
    await spyVoice(o.ctx)
    await voicePack(o.ctx)
    await o.page.reload()
    await o.page.waitForSelector('[data-testid=pet]')
    await o.page.waitForTimeout(300)
    await o.page.evaluate(() => (window.__said = []))
    await o.page.evaluate(() => (location.hash = 'gallery'))
    await o.page.waitForSelector('[data-testid=gallery-empty]')
    await o.page.waitForTimeout(400)
    const s2 = await said(o.page)
    check('[voice-old] 舊孩子（阿悟）：照舊播原 key 的音檔', s2.some((s) => s.endsWith('/voice/awu-gallery.m4a')) && !s2.some((s) => s.endsWith('/voice/rabbit-gallery.m4a')), JSON.stringify(s2))
    await o.ctx.close()
  }

  // ======== 家長區：新增孩子可以選寵物；改名 / 年齡沒有換寵物 ========
  {
    const { ctx, page, errors } = await freshApp(browser, LAND, { stage: 'baby' })
    await page.getByRole('button', { name: /家長入口/ }).click()
    await page.waitForSelector('button.key')
    await pressPin(page, '1234')
    await page.getByRole('tab', { name: '設定', exact: true }).click()
    await page.waitForSelector('[data-testid=children-card]')
    await page.getByTestId('kid-edit').first().click()
    check('[parent] 改名 / 年齡：沒有換寵物的選項', (await page.getByTestId('species-picker').count()) === 0)
    await page.getByRole('button', { name: '取消' }).click()
    await page.getByTestId('kid-add').click()
    check('[parent] 新增孩子：有選寵物（沒有取名字的欄位）', (await page.getByTestId('species-picker').count()) === 1 && (await page.getByTestId('kid-pet').count()) === 0)
    await shot(page, 'parent-add-child')
    check('[parent] 無 JS 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ======== 帽子：兔兔的圖探測說有、畫面上卻載入失敗（離線、快取被清）→ 退回猴子的同一張，帽子也用猴子的錨點 ========
  {
    const { ctx, page, errors } = await freshApp(browser, LAND)
    await page.goto(`${BASE}#hatpreview/crown/rabbit`)
    await page.waitForSelector('[data-pose=adult-happy] [data-testid=pet-hat][data-art=pet-rabbit-adult-happy]')
    await page.evaluate(() => document.querySelector('[data-pose=adult-happy] .pet-img').dispatchEvent(new Event('error')))
    await page.waitForFunction(() => document.querySelector('[data-pose=adult-happy] .pet-img')?.getAttribute('src')?.endsWith('/art/pet-adult-happy.png'), null, { timeout: 3000 }).catch(() => {})
    const r = await page.evaluate(() => {
      const li = (p) => document.querySelector(`[data-pose=${p}]`)
      return {
        img: li('adult-happy').querySelector('.pet-img')?.getAttribute('src'),
        hat: li('adult-happy').querySelector('[data-testid=pet-hat]')?.dataset.art,
        other: li('adult-idle').querySelector('[data-testid=pet-hat]')?.dataset.art,
      }
    })
    check('[hat-fallback] 載入失敗的兔兔圖改用猴子的同一張', !!r.img?.endsWith('/art/pet-adult-happy.png'), r.img)
    check('[hat-fallback] 帽子跟著用猴子那張的錨點', r.hat === 'pet-adult-happy', r.hat)
    check('[hat-fallback] 其他姿勢不受影響', r.other === 'pet-rabbit-adult-idle', r.other)
    check('[hat-fallback] 無 JS 錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}

console.log(state.failed === 0 ? '\n全部通過' : `\n有 ${state.failed} 項失敗`)
process.exit(state.failed === 0 ? 0 : 1)
