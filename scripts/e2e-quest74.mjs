// v7.4 線 H「冒險內容與經濟」E2E（Playwright）：
//   H1 已通關的站可以重玩（地圖「再玩」標示、換新題目、固定一份食物不給材料）、「即將開放」改成溫和的預告
//   H2 3 歲題型池（比多少、顏色、顏色配對、缺一個）的畫面與作答、一站內題型分散
//   H3 句型輪替（同一站不連續同一句）、6–7 歲第 1 站不出「指出水果」、挑戰站從難度 3 起跳
//   H4 站末結算精簡（食物名字與說明句不重複）、英文題答對後「下一題」鈕不壓選項卡
//   H5 每日禮物與站末掉落改固定輪替（不靠亂數）、貼紙禮物順序固定、不重複
// 用法：BASE_URL=http://localhost:5201 node scripts/e2e-quest74.mjs（E2E_BROWSER=webkit 用 Safari 引擎 + iPad 模擬）
// 截圖：SHOTS_DIR=<資料夾> 才會存（不要存進 repo）。觸控用接近真機的手指（radiusX 25）。
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IS_WEBKIT, freshApp, idb, launch, makeChecker, touchSender } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT = join(ROOT, 'src/learning/content')
const BANK = Object.fromEntries(['number', 'classify', 'pattern', 'measure', 'space', 'observe', 'english', 'life', 'nature'].flatMap((f) => JSON.parse(readFileSync(join(CONTENT, `${f}.json`), 'utf8'))).map((q) => [q.id, q]))
const SHOTS = process.env.SHOTS_DIR
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const { state, check } = makeChecker()
let checks = 0
const ck = (name, ok, detail = '') => {
  checks++
  check(name, ok, detail)
}
const shot = (page, name) => (SHOTS ? page.screenshot({ path: join(SHOTS, `${name}.png`) }) : Promise.resolve())

const dump = (page, t) => idb(page, (db, t) => new Promise((r) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => r(e.target.result))), t)
const settingsOf = async (page) => (await dump(page, 'settings'))[0]
const patchSettings = (page, patch) =>
  idb(page, (db, patch) => new Promise((r) => { const s = db.transaction('settings', 'readwrite').objectStore('settings'); s.get('main').onsuccess = (e) => { s.put({ ...e.target.result, ...patch }).onsuccess = () => r(1) } }), patch)
const putRows = (page, store, rows) =>
  idb(page, (db, o) => new Promise((r) => { const tx = db.transaction(o.store, 'readwrite'); for (const row of o.rows) tx.objectStore(o.store).put(row); tx.oncomplete = () => r(1) }), { store, rows })
const foodTotal = async (page) => (await dump(page, 'inventory')).filter((i) => ['carrot', 'cookie', 'banana', 'apple', 'grape', 'milk', 'peach', 'riceball', 'watermelon', 'cake'].includes(i.id)).reduce((a, b) => a + b.qty, 0)
const matBalance = async (page) => (await dump(page, 'materialLedger')).reduce((a, e) => a + e.delta, 0)
const ALL_INTROS = ['tapN', 'dragSort', 'dragOrder', 'place', 'flip', 'stepOrder', 'pick']

/** 真手指（接觸面積 radiusX 25）點一下元素中心；WebKit 用 Playwright 的 tap（touchSender 在 WebKit 只送 pointer 事件，不會產生 click） */
let sendTouch = null
async function tap(page, locator) {
  if (IS_WEBKIT) return locator.tap()
  await locator.scrollIntoViewIfNeeded()
  const b = await locator.boundingBox()
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await sendTouch('touchStart', [{ x, y, id: 1, radiusX: 25, radiusY: 25, force: 0.5 }])
  await sendTouch('touchEnd', [])
}
const newApp = async (browser, vp, opts = {}) => {
  const a = await freshApp(browser, vp, { ctxOpts: { hasTouch: true }, ...opts })
  sendTouch = await touchSender(a.ctx, a.page)
  return a
}

const gotoMap = async (page, subject = 'math') => {
  await page.evaluate((s) => { localStorage.setItem('gq-subject', s); localStorage.setItem('gq-chapter-' + s, '') }, subject)
  await page.evaluate(() => (location.hash = 'map'))
  await page.reload()
  await page.waitForSelector('[data-testid=map]')
  await page.waitForTimeout(250)
}
const draftOf = async (page) => (await settingsOf(page)).stageDraft
/** 寫一份 stageDraft（讓關卡直接是指定的 5 題；resume 時照這份） */
const writeDraft = (page, chapterId, ids, station = 1) =>
  patchSettings(page, { stageDraft: { chapterId, station, run: 1, sessionId: `s${Date.now()}${Math.floor(Math.random() * 1e6)}`, plan: ids.map((id) => ({ id, review: false, followUp: false })), savedAt: Date.now() } })
const progressRow = (done) => ({
  chapterId: 'huaguoshan', run: 1, chestClaimed: false, completedRuns: 0, updatedAt: Date.now(),
  stations: [1, 2, 3, 4, 5].map((i) => ({ done: i <= done, independent: i <= done ? 4 : 0, total: i <= done ? 5 : 0, completedAt: Date.now() })),
})
const pickIds = (skill, type, n, { diff = 1, skip = 0 } = {}) =>
  Object.values(BANK).filter((q) => q.skill === skill && q.difficulty === diff && !q.gentle && q.type === type && (q.interaction ?? 'pick') === 'pick').slice(skip, skip + n).map((q) => q.id)
const THREE_YO_STAGE = ['number', 'classify', 'pattern']

/** 一題一題答對（點選題，真手指）；回傳答過的題目 id */
async function playPicks(page, n = 5, { wrongFirst = false } = {}) {
  const done = []
  for (let i = 0; i < n; i++) {
    await page.waitForSelector('[data-testid=question]', { timeout: 8000 })
    const qid = await page.locator('[data-testid=question]').getAttribute('data-question-id')
    const q = BANK[qid]
    await page.waitForTimeout(i === 0 ? 700 : 350)
    if (wrongFirst && i === 0) {
      const wrong = q.choices.find((c) => c.id !== q.answer)
      await tap(page, page.locator(`[data-testid=choice][data-choice-id="${wrong.id}"]`))
      await page.waitForTimeout(250)
    }
    await tap(page, page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`))
    done.push(qid)
    if (i < n - 1) {
      await page.getByTestId('next-question').click({ timeout: 3000 }).catch(() => {})
      await page.waitForFunction((old) => document.querySelector('[data-testid=question]')?.dataset.questionId !== old, qid, { timeout: 10000 })
    } else await page.getByTestId('next-question').click({ timeout: 3000 }).catch(() => {})
  }
  return done
}
/** 句型 = 最後一個逗號或句號後面那一段（和 src/learning/select.ts 的 promptPattern 一樣） */
const patternOf = (prompt) => {
  const parts = prompt.split(/[，。,]/).map((x) => x.trim()).filter(Boolean)
  return parts[parts.length - 1] ?? prompt
}

const browser = await launch()
try {
  // =====================================================================
  // H5：每日禮物固定輪替、貼紙順序固定（先測，因為最簡單）
  // =====================================================================
  {
    const { page, errors } = await newApp(browser, SIZES.land, { rand: 0.99 }) // Math.random 固定成 0.99：舊版「機率」會一直抽到貼紙
    const FIRST_STICKER = 'obj-star' // GIFT_STICKERS 的第一張（src/domain/gifts.ts；預設開放的 8 張不在清單裡）
    const give = async (seq, stickers = []) => {
      await patchSettings(page, { homeGuideShown: true, lastGiftDate: '2000-01-01', dailyGiftSeq: seq, stickers, pendingGifts: [] })
      await page.evaluate(() => (location.hash = ''))
      await page.reload()
      await page.waitForSelector('[data-testid=pet]')
      await page.waitForFunction(async () => {
        const rq = indexedDB.open('guaibao-quest')
        return await new Promise((res) => { rq.onsuccess = () => { const g = rq.result.transaction('settings').objectStore('settings').get('main'); g.onsuccess = () => res(g.result.lastGiftDate !== '2000-01-01') } })
      }, null, { timeout: 8000 })
      await page.waitForTimeout(300)
      const s = await settingsOf(page)
      return { s, g: (s.pendingGifts ?? [])[0] }
    }
    const kinds = []
    let stickerAt = null
    for (const seq of [0, 1, 2, 3, 4, 5]) {
      const { s, g } = await give(seq)
      const kind = g?.foodId ? 'food' : g?.materialId ? 'material' : g?.stickerId ? 'sticker' : 'none'
      kinds.push(kind)
      if (kind === 'sticker') stickerAt = { g, s }
      if (seq === 0) ck('第 1 份每日禮物是食物（Math.random 固定 0.99 也一樣：不靠機率）', kind === 'food' && !g.foodId.includes('cake'), JSON.stringify(g))
      if (seq === 1) ck('第 2 份是材料（一次 2 個）', kind === 'material' && g.qty === 2, JSON.stringify(g))
      ck(`送完一份，dailyGiftSeq = ${seq + 1}`, s.dailyGiftSeq === seq + 1)
    }
    ck('輪替：食物、材料、食物、貼紙、食物、材料', kinds.join() === 'food,material,food,sticker,food,material', kinds.join())
    ck('貼紙禮物 = 固定順序的第一張，寫進 settings.stickers', stickerAt?.g.stickerId === FIRST_STICKER && stickerAt.s.stickers.includes(FIRST_STICKER), JSON.stringify(stickerAt?.g))
    // 已經有第一張：下一次貼紙是第二張（順序固定、不重複）
    const second = await give(3, [FIRST_STICKER])
    ck('已經擁有第 1 張貼紙：這次送的是第 2 張，不重複', !!second.g?.stickerId && second.g.stickerId !== FIRST_STICKER && second.s.stickers.length === 2, JSON.stringify(second.g))
    // 全部送完：改送食物
    const all = ['obj-star', 'obj-flower', 'obj-rabbit', 'obj-chick', 'obj-fish', 'obj-shell', 'decor-rainbow', 'mat-flower', 'pet-baby-happy', 'pet-adult-cheer']
    const done = await give(3, all)
    ck('貼紙全部送完：這一輪的貼紙位改送食物', !!done.g?.foodId && !done.g.stickerId && done.s.stickers.length === all.length, JSON.stringify(done.g))
    ck('H5 沒有頁面錯誤', errors.length === 0, errors.join('|'))
  }

  // =====================================================================
  // H4 + H5：站末結算（食物不重複說）與固定輪替的食物；H1：重玩
  // =====================================================================
  for (const [tag, vp] of Object.entries({ land: SIZES.land, phone: SIZES.phone })) {
    const { page, errors } = await newApp(browser, vp)
    await patchSettings(page, { homeGuideShown: true, ageBand: '4-5', seenIntros: ALL_INTROS })
    const P1 = pickIds('number', 'count', 5)
    await writeDraft(page, 'huaguoshan', P1)
    await gotoMap(page)
    ck(`[${tag}] 第 1 站出發、其餘鎖住；還沒有任何「再玩」標示`, (await page.locator('[data-station-state=current]').count()) === 1 && (await page.locator('.h74-replay-tag').count()) === 0)
    await tap(page, page.getByTestId('station-1'))
    const foodBefore = await foodTotal(page)
    const answered = await playPicks(page, 5)
    await page.waitForSelector('[data-testid=station-result]')
    await page.waitForTimeout(2600)
    const foodItems = await page.locator('[data-testid=result-food-item]').evaluateAll((els) => els.map((e) => e.dataset.food))
    const foodText = await page.getByTestId('food-text').innerText()
    const lineRows = await page.locator('.q7-food-line-row').allInnerTexts()
    ck(`[${tag}] 5 題都對：2 個食物，且兩個是不同種類（固定輪替，不會「蘋果、蘋果」）`, foodItems.length === 2 && foodItems[0] !== foodItems[1], foodItems.join())
    ck(`[${tag}] 結算說明不重複：食物名字只出現一次、說明句各一句（沒有重複的兩句）`, new Set(lineRows).size === lineRows.length && lineRows.length === 2 && /阿悟撿到/.test(foodText) && !/、.*、/.test(foodText) && new Set(foodText.replace('阿悟撿到', '').split('、').map((s) => s.trim())).size === 2, `${foodText} | ${lineRows.join(' / ')}`)
    const s1 = await settingsOf(page)
    ck(`[${tag}] 食物是今天固定輪替的第 1、2 個（foodDrop = 今天掉 2 個）`, s1.foodDrop?.n === 2, JSON.stringify(s1.foodDrop))
    ck(`[${tag}] 食物進背包 +2`, (await foodTotal(page)) - foodBefore === 2)
    await shot(page, `result-${tag}`)
    const wood = await matBalance(page)
    ck(`[${tag}] 第一次通關給材料（全對 = 4 個）`, wood === 4, `n=${wood}`)
    await page.getByTestId('back-to-map').click()
    await page.waitForSelector('[data-testid=map]')
    await page.waitForTimeout(400)

    // ---- H1：地圖標示與重玩 ----
    ck(`[${tag}] 地圖：已通關的第 1 站有「再玩」標示，第 2 站是目前這站`, (await page.getByTestId('replay-tag-1').count()) === 1 && (await page.getByTestId('replay-tag-1').innerText()).includes('再玩') && (await page.locator('[data-station-state=current]').count()) === 1 && (await page.getByTestId('station-2').getAttribute('aria-disabled')) === 'false')
    ck(`[${tag}] 已通關的站不再是 aria-disabled，label 說明可以再玩一次`, (await page.getByTestId('station-1').getAttribute('aria-disabled')) === 'false' && (await page.getByTestId('station-1').getAttribute('aria-label')).includes('再玩'))
    const tagBox = await page.getByTestId('replay-tag-1').boundingBox()
    ck(`[${tag}] 「再玩」標示完整在畫面內`, tagBox && tagBox.x >= 0 && tagBox.y >= 0 && tagBox.x + tagBox.width <= vp.width, JSON.stringify(tagBox))
    const soon = await page.getByTestId('soon-item').allInnerTexts()
    ck(`[${tag}] 「即將開放」改成溫和的預告：沒有鎖頭、沒有「即將開放」`, soon.length === 2 && soon.every((t) => t.includes('阿悟正在探路')) && (await page.getByText('即將開放').count()) === 0 && (await page.locator('.adv-upcoming .art[src*=lock], .adv-upcoming [data-icon=ui-lock]').count()) === 0, soon.join('|'))
    await shot(page, `map-replay-${tag}`)

    await tap(page, page.getByTestId('station-1'))
    await page.waitForSelector('[data-testid=question]', { timeout: 8000 })
    const mainEl = page.locator('[data-testid=stage]')
    ck(`[${tag}] 點已通關的站：進入重玩（data-replay），不是晃一下`, (await mainEl.getAttribute('data-replay')) === 'true' && (await mainEl.getAttribute('data-station')) === '1')
    const opener = await page.getByTestId('opener').innerText().catch(() => '')
    ck(`[${tag}] 阿悟開場說重玩的話`, /再玩一次|再走一遍/.test(opener), opener)
    const dr = await draftOf(page)
    const ids = dr.plan.map((p) => p.id)
    ck(`[${tag}] 重玩的草稿是 replay:huaguoshan，5 題`, dr.chapterId === 'replay:huaguoshan' && ids.length === 5 && new Set(ids).size === 5, JSON.stringify(dr.chapterId))
    ck(`[${tag}] 重玩的題目避開剛答過的 5 題`, ids.every((id) => !answered.includes(id)), ids.join())
    // 離開，改寫成 5 題點選題（才能用手指逐題答）
    await page.getByTestId('leave').click()
    await page.getByTestId('leave-go').click()
    await page.waitForSelector('[data-testid=map]')
    const P2 = pickIds('classify', 'kind', 5)
    await writeDraft(page, 'replay:huaguoshan', P2)
    await gotoMap(page)
    const foodBefore2 = await foodTotal(page)
    const matBefore2 = await matBalance(page)
    const progBefore = (await dump(page, 'progress')).find((p) => p.chapterId === 'huaguoshan').stations
    await tap(page, page.getByTestId('station-1'))
    await playPicks(page, 5, { wrongFirst: true })
    await page.waitForSelector('[data-testid=station-result]')
    await page.waitForTimeout(2200)
    ck(`[${tag}] 重玩結算：固定 1 個食物（第一題答錯也一樣，不懲罰）、不給材料`, (await page.locator('[data-testid=result-food-item]').count()) === 1 && (await page.getByTestId('result-materials').count()) === 0)
    ck(`[${tag}] 重玩結算標題寫「再玩一次完成了」，只有「回地圖」，沒有「下一站」`, (await page.locator('h1').innerText()).includes('再玩一次完成了') && (await page.getByTestId('back-to-map').count()) === 1 && (await page.getByTestId('next-station').count()) === 0)
    ck(`[${tag}] 背包食物 +1、材料不變、章節進度不變`, (await foodTotal(page)) - foodBefore2 === 1 && (await matBalance(page)) === matBefore2 && JSON.stringify((await dump(page, 'progress')).find((p) => p.chapterId === 'huaguoshan').stations) === JSON.stringify(progBefore))
    const s2 = await settingsOf(page)
    ck(`[${tag}] 重玩的食物接著輪替（今天第 3 個），草稿清掉`, s2.foodDrop?.n === 3 && !s2.stageDraft, JSON.stringify(s2.foodDrop))
    await shot(page, `result-replay-${tag}`)
    await page.getByTestId('back-to-map').click()
    await page.waitForSelector('[data-testid=map]')
    ck(`[${tag}] 回地圖：還是已通關 1 / 5 站、「再玩」標示還在`, (await page.locator('.adv-map-hero').innerText()).includes('已通關 1 / 5') && (await page.getByTestId('replay-tag-1').count()) === 1)
    ck(`[${tag}] H1 沒有頁面錯誤`, errors.length === 0, errors.join('|'))
    await page.context().close()
  }

  // 點到還沒通關的站：照舊晃一下、不進關卡
  {
    const { page } = await newApp(browser, SIZES.land)
    await patchSettings(page, { homeGuideShown: true, ageBand: '4-5' })
    await gotoMap(page)
    await page.getByTestId('station-3').click({ force: true })
    await page.waitForTimeout(300)
    ck('點還沒解鎖的站：留在地圖（不會進重玩）', (await page.getByTestId('map').count()) === 1 && (await page.getByTestId('stage').count()) === 0)
    await page.context().close()
  }

  // =====================================================================
  // H2：3 歲題型池
  // =====================================================================
  {
    const NEW = { compare: 'number-1-g25', color: 'classify-1-g25', colorMatch: Object.values(BANK).find((q) => q.gentle && q.type === 'same' && q.params?.swatch)?.id, missing: 'pattern-1-g25' }
    ck('題庫：3 歲新題型的第 1 題存在（比多少、顏色、顏色配對、缺一個）', Object.values(NEW).every((id) => id && BANK[id]), JSON.stringify(NEW))
    for (const [tag, vp] of Object.entries(SIZES)) {
      const { page, errors } = await newApp(browser, vp)
      await patchSettings(page, { homeGuideShown: true, ageBand: '3', seenIntros: ALL_INTROS })
      for (const [kind, id] of Object.entries(NEW)) {
        const q = BANK[id]
        await writeDraft(page, 'huaguoshan', [id, id, id, id, id])
        await gotoMap(page)
        await page.getByTestId('station-1').click()
        await page.waitForSelector('[data-testid=question]', { timeout: 8000 })
        await page.waitForTimeout(2900) // 幼幼模式：先唸題、選項稍後才出現
        const cards = await page.locator('[data-testid=choice]').count()
        const stem = await page.getByTestId('subtitle').innerText()
        const bounds = await page.evaluate(() => { const o = []; for (const c of document.querySelectorAll('[data-testid=choice]')) { const b = c.getBoundingClientRect(); o.push([b.width, b.height, b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight]) } return o })
        ck(`[${tag}] ${kind}：2 個選項卡、都在畫面內、夠大（>= 56px）`, cards === 2 && bounds.every(([w, h, inside]) => w >= 56 && h >= 56 && inside), JSON.stringify(bounds))
        if (tag === 'land' || tag === 'phone') await shot(page, `h2-${kind}-${tag}`)
        if (kind === 'compare') {
          const piles = await page.evaluate(() => [...document.querySelectorAll('[data-testid=choice]')].map((c) => c.querySelectorAll('.art, .art-emoji, img, svg').length))
          const small = await page.evaluate(() => Math.min(...[...document.querySelectorAll('[data-testid=choice] .art, [data-testid=choice] img')].map((e) => e.getBoundingClientRect().width)))
          ck(`[${tag}] compare：兩堆的物件都看得到（每堆 = 題目說的個數）、圖示 >= 28px`, JSON.stringify(piles.sort()) === JSON.stringify(q.choices.map((c) => c.count).sort()) && small >= 28, `${piles} min=${small}`)
        }
        // 先點錯（幼幼：提示、不扣分），再用手指點對
        const wrong = q.choices.find((c) => c.id !== q.answer)
        await tap(page, page.locator(`[data-testid=choice][data-choice-id="${wrong.id}"]`))
        await page.waitForTimeout(300)
        await tap(page, page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`))
        await page.waitForSelector('[data-testid=next-question]', { timeout: 3000 })
        ck(`[${tag}] ${kind}：點對答案後出現「下一題」，題幹文字有內容`, stem.length > 3)
        await page.getByTestId('leave').click()
        await page.getByTestId('leave-go').click()
        await page.waitForSelector('[data-testid=map]')
      }
      ck(`[${tag}] H2 沒有頁面錯誤`, errors.length === 0, errors.join('|'))
      await page.context().close()
    }
    // 一站內題型分散：同一站同型 <= 2；前 3 站（15 題）題型夠多
    const { page } = await newApp(browser, SIZES.land)
    await patchSettings(page, { homeGuideShown: true, ageBand: '3', seenIntros: ALL_INTROS })
    const allTypes = []
    let maxSame = 0
    for (let k = 0; k < 9; k++) {
      await patchSettings(page, { stageDraft: undefined })
      await putRows(page, 'progress', [progressRow(k % 3)])
      await gotoMap(page)
      await page.getByTestId(`station-${(k % 3) + 1}`).click()
      await page.waitForSelector('[data-testid=question]', { timeout: 8000 })
      const ids = (await draftOf(page)).plan.map((p) => p.id)
      const types = ids.map((id) => BANK[id].type)
      allTypes.push(types)
      maxSame = Math.max(maxSame, ...Object.values(types.reduce((a, t) => ({ ...a, [t]: (a[t] ?? 0) + 1 }), {})))
      ck(`3 歲第 ${(k % 3) + 1} 站（第 ${k + 1} 次）：5 題都是幼幼題庫、只有數感／分類／規律`, ids.every((id) => (BANK[id].gentle || (BANK[id].skill === 'number' && Number(BANK[id].answer) <= 3)) && THREE_YO_STAGE.includes(BANK[id].skill)), types.join())
      await page.getByTestId('leave').click()
      await page.getByTestId('leave-go').click()
      await page.waitForSelector('[data-testid=map]')
    }
    ck('3 歲：同一站同一題型 <= 2 題', maxSame <= 2, `max=${maxSame}`)
    const kinds = new Set(allTypes.flat())
    ck('3 歲：9 站下來至少出現 6 種題型（原本只有 5 種）', kinds.size >= 6, [...kinds].join())
    const nextShare = allTypes.flat().filter((t) => t === 'next').length / allTypes.flat().length
    ck('3 歲：「接下來是哪一個」不再佔 1/3（<= 25%）', nextShare <= 0.25, `${(nextShare * 100).toFixed(0)}%`)
    await page.context().close()
  }

  // =====================================================================
  // H3：句型輪替、6–7 歲第 1 站、挑戰站難度
  // =====================================================================
  {
    const { page, errors } = await newApp(browser, SIZES.land)
    await patchSettings(page, { homeGuideShown: true, ageBand: '4-5', seenIntros: ALL_INTROS })
    let clash = 0
    let pairs = 0
    const prompts = []
    for (let k = 0; k < 8; k++) {
      await patchSettings(page, { stageDraft: undefined })
      await gotoMap(page, 'life')
      await page.getByTestId('station-1').click()
      await page.waitForSelector('[data-testid=question]', { timeout: 8000 })
      const ids = (await draftOf(page)).plan.map((p) => p.id)
      const pats = ids.map((id) => patternOf(BANK[id].prompt))
      prompts.push(...ids.map((id) => BANK[id].prompt))
      for (let i = 1; i < pats.length; i++) {
        pairs++
        if (pats[i] === pats[i - 1]) clash++
      }
      await page.getByTestId('leave').click()
      await page.getByTestId('leave-go').click()
      await page.waitForSelector('[data-testid=map]')
    }
    ck('生活站（8 次開站，40 題）：同一站相鄰兩題的句型都不一樣（不連續說同一句）', pairs === 8 * 4 && clash === 0, `clash=${clash} 例：${prompts.slice(0, 3).join(' / ')}`)
    ck('H3 句型 沒有頁面錯誤', errors.length === 0, errors.join('|'))
    await page.context().close()
  }
  {
    const { page, errors } = await newApp(browser, SIZES.land)
    const now = Date.now()
    await patchSettings(page, { homeGuideShown: true, ageBand: '6-7', seenIntros: ALL_INTROS, placement: { at: now, skipped: true } })
    await putRows(page, 'skillState', ['number', 'classify', 'pattern', 'measure', 'space', 'observe'].map((skill) => ({ skill, difficulty: 2, recent: [], stationStreak: 0, mastered: {}, updatedAt: now, total: 0 })))
    let kinds = 0
    let minDiff = 4
    for (let k = 0; k < 10; k++) {
      await patchSettings(page, { stageDraft: undefined })
      await gotoMap(page)
      await page.getByTestId('station-1').click()
      await page.waitForSelector('[data-testid=question], [data-testid=tutorial]', { timeout: 8000 })
      const ids = (await draftOf(page)).plan.map((p) => p.id)
      kinds += ids.filter((id) => BANK[id].type === 'kind').length
      minDiff = Math.min(minDiff, ...ids.map((id) => BANK[id].difficulty))
      await page.getByTestId('leave').click()
      await page.getByTestId('leave-go').click()
      await page.waitForSelector('[data-testid=map]')
    }
    ck('6–7 歲數學第 1 站（10 次開站）：不出「指出水果／動物」這類種類題（kind）', kinds === 0, `kind=${kinds}`)
    ck('6–7 歲數學第 1 站：題目難度從 2 起（沒有 d1 題）', minDiff >= 2, `min=${minDiff}`)
    // 挑戰站：6–7 歲一開始就看得到；8 題都是難度 3 以上
    await patchSettings(page, { stageDraft: undefined })
    await gotoMap(page)
    await tap(page, page.getByTestId('challenge-go'))
    await page.waitForSelector('[data-testid=question], [data-testid=tutorial]', { timeout: 8000 })
    const dr = await draftOf(page)
    const diffs = dr.plan.map((p) => BANK[p.id].difficulty)
    ck('挑戰站（6–7 歲）：8 題，難度都 >= 3', dr.chapterId === 'challenge:huaguoshan' && diffs.length === 8 && Math.min(...diffs) >= 3, diffs.join())
    ck('H3 6–7 歲 沒有頁面錯誤', errors.length === 0, errors.join('|'))
    await page.context().close()
  }
  {
    // 4–5 歲：挑戰站維持「比目前高 1 級」（不強制 3）
    const { page } = await newApp(browser, SIZES.land)
    await patchSettings(page, { homeGuideShown: true, ageBand: '4-5', seenIntros: ALL_INTROS })
    await putRows(page, 'progress', [{ ...progressRow(5), completedRuns: 1, chestClaimed: true }])
    await gotoMap(page)
    await tap(page, page.getByTestId('challenge-go'))
    await page.waitForSelector('[data-testid=question], [data-testid=tutorial]', { timeout: 8000 })
    const diffs = (await draftOf(page)).plan.map((p) => BANK[p.id].difficulty)
    ck('挑戰站（4–5 歲，從難度 1 開始）：維持比目前高 1 級（<= 2）', diffs.length === 8 && Math.max(...diffs) <= 2, diffs.join())
    await page.context().close()
  }

  // =====================================================================
  // H4：英文題答對後，「下一題」鈕不壓到選項卡
  // =====================================================================
  for (const [tag, vp] of Object.entries(SIZES)) {
    const { page, errors } = await newApp(browser, vp)
    await patchSettings(page, { homeGuideShown: true, ageBand: '4-5', seenIntros: ALL_INTROS })
    let hits = 0
    let outside = 0
    let n = 0
    for (const id of ['english-1-01', 'english-1-30', 'english-2-03', 'english-3-05', 'english-4-02', 'english-2-36']) {
      if (!BANK[id]) continue
      await writeDraft(page, 'english-island', [id, id, id, id, id])
      await gotoMap(page, 'english')
      await page.getByTestId('station-1').click()
      await page.waitForSelector('[data-testid=question]', { timeout: 8000 })
      await page.waitForTimeout(900)
      await tap(page, page.locator(`[data-testid=choice][data-choice-id="${BANK[id].answer}"]`))
      await page.waitForSelector('[data-testid=next-question]', { timeout: 3000 })
      await page.waitForTimeout(350)
      const r = await page.evaluate(() => {
        const nb = document.querySelector('[data-testid=next-question]').getBoundingClientRect()
        const boxes = [...document.querySelectorAll('[data-testid=choice], .q7-cardwrap')].map((c) => c.getBoundingClientRect())
        return { hit: boxes.filter((b) => !(b.right <= nb.left || b.left >= nb.right || b.bottom <= nb.top || b.top >= nb.bottom)).length, inside: nb.bottom <= innerHeight && nb.top >= 0 }
      })
      n++
      hits += r.hit
      if (!r.inside) outside++
      if (id === 'english-1-01') await shot(page, `h4-english-next-${tag}`)
      await page.getByTestId('leave').click()
      await page.getByTestId('leave-go').click()
      await page.waitForSelector('[data-testid=map]')
    }
    ck(`[${tag}] 英文 ${n} 題答對後：「下一題」鈕沒有壓到任何選項卡、完整在畫面內`, n >= 5 && hits === 0 && outside === 0, `hits=${hits} outside=${outside}`)
    ck(`[${tag}] H4 英文 沒有頁面錯誤`, errors.length === 0, errors.join('|'))
    await page.context().close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks} 項檢查，失敗 ${state.failed} 項`)
if (checks === 0) {
  console.log('FAIL  沒有執行任何檢查（0 checks）')
  process.exit(1)
}
process.exit(state.failed ? 1 : 0)
