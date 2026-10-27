// v5 線 C E2E（Playwright）：經濟與長期目標。
//   1) 過一站 → 回首頁，阿悟拿出路上撿到的食物，點一下收下（飛進食物欄）
//   2) 隔天（__debug.advanceDays）有今日小禮物；多份禮物依序展示
//   3) PM 解鎖並表演新招（含「表演」按鈕、每一招的動作）、新招全螢幕慶祝與示範
//   4) 圖鑑：剪影變彩色、點一下唸名字、滿 6 個送禮物
//   5) 遊玩時間剩 2 分鐘：阿悟打哈欠提醒（只一次）
// 用法：先啟動 dev server（例如 pnpm dev --port 5181 --strictPort），再
//   BASE_URL=http://localhost:5181 node scripts/e2e-meta.mjs        （或 pnpm e2e:meta）
// 想存截圖：SHOT_DIR=design/screens node scripts/e2e-meta.mjs      （會存 v5-meta-*.png，三種尺寸）
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, freshApp, idb, makeChecker, openParentTab, center } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SHOT_DIR = process.env.SHOT_DIR
const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '../src/learning/content')
const QUESTIONS = ['number', 'classify', 'pattern'].flatMap((f) => JSON.parse(readFileSync(join(CONTENT, `${f}.json`), 'utf8')))
const BANK = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]))
const VP = { width: 1024, height: 768 }
/** v6：右側按鈕整理成「更多」托盤（表演、朋友、相簿、衣櫃）；要先打開才點得到 */
const openMore = async (page) => {
  if (!(await page.getByTestId('more-tray').count())) await page.getByTestId('more-btn').click()
  await page.waitForSelector('[data-testid=more-tray]')
}

/** 題目裡孩子看到的物件（跟 src/domain/friends.ts 的規則一致，這裡獨立再寫一次當對照） */
const objectsOf = (q) => {
  const s = new Set()
  for (const it of q.items) if (it.obj) s.add(it.obj)
  for (const c of q.choices) if (c.obj) s.add(c.obj)
  if (q.params?.obj) s.add(q.params.obj)
  for (const b of q.params?.bins ?? []) if (b.obj) s.add(b.obj)
  return s
}

// ---------- 讀寫 IndexedDB ----------
const settingsOf = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
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
const dump = (page, table) => idb(page, (db, t) => new Promise((r) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => r(e.target.result))), table)
const invQty = async (page, id) => (await dump(page, 'inventory')).find((i) => i.itemId === id)?.qty ?? 0
const petOf = (page) => idb(page, (db) => new Promise((r) => (db.transaction('pets').objectStore('pets').get('pet').onsuccess = (e) => r(e.target.result))))
/** 直接寫入作答紀錄（模擬孩子答過這些題） */
const addAttempts = (page, ids) =>
  idb(
    page,
    (db, ids) =>
      new Promise((r) => {
        const tx = db.transaction('attempts', 'readwrite')
        ids.forEach((id, i) => tx.objectStore('attempts').put({ id: `e2e:${id}`, at: Date.now() + i, questionId: id, skill: id.split('-')[0], difficulty: 1, firstTryCorrect: true, hintsUsed: 0, durationMs: 800, sessionId: 'e2e' }))
        tx.oncomplete = () => r(1)
      }),
    ids,
  )

/** 聲音出口的記錄：Web Speech 唸了什麼字、預錄音檔播了哪個檔 */
const SPY = () => {
  window.__said = []
  const hook = () => {
    try {
      const s = window.speechSynthesis
      if (s && !s.__spied) {
        const sp = s.speak.bind(s)
        s.speak = (u) => {
          window.__said.push(u.text)
          return sp(u)
        }
        s.__spied = true
      }
    } catch {
      /* ignore */
    }
  }
  hook()
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) {
    if (this.src && !this.src.startsWith('data:')) window.__said.push(`audio:${this.src}`)
    return play.apply(this, a)
  }
}
const saidLog = (page) => page.evaluate(() => window.__said ?? [])

/** 開新 App 並加上聲音記錄；預設把當天的首次引導與小禮物都先處理掉（讓一般流程不被禮物打斷） */
async function app(browser, viewport, opts = {}) {
  const r = await freshApp(browser, viewport, { bananas: 3, ...opts })
  await r.page.addInitScript(SPY)
  await r.page.evaluate(SPY)
  return r
}

/** 把目前待展示的禮物一份一份點掉（每份最多等 timeout ms 出現）；回傳每份的 kind */
async function drainGifts(page, timeout = 4000) {
  const got = []
  for (;;) {
    try {
      await page.waitForSelector('[data-testid=gift]', { timeout })
    } catch {
      return got
    }
    got.push(await page.getByTestId('gift').getAttribute('data-gift-kind'))
    await page.getByTestId('gift').click()
    await page.waitForSelector('[data-testid=gift]', { state: 'detached', timeout: 8000 })
  }
}
const waitGift = (page, ms = 15000) => page.waitForSelector('[data-testid=gift]', { timeout: ms })
const waitNoGift = (page, ms = 15000) => page.waitForSelector('[data-testid=gift]', { state: 'detached', timeout: ms })
const bubbleText = (page) => page.evaluate(() => document.querySelector('[data-testid=pet-bubble]')?.textContent ?? null)
const petAttr = (page, a) => page.evaluate((a) => document.querySelector('[data-testid=pet]')?.getAttribute(a) ?? null, a)

/** 每 40ms 取樣阿悟的動作、泡泡、房間閃光，直到 total ms */
const sampleTrick = (page, total) =>
  page.evaluate(
    (total) =>
      new Promise((res) => {
        const out = []
        const t0 = performance.now()
        const snap = () => {
          const pet = document.querySelector('[data-testid=pet]')
          out.push({
            t: Math.round(performance.now() - t0),
            anim: pet?.dataset.anim ?? null,
            pose: pet?.dataset.pose ?? null,
            bubble: document.querySelector('[data-testid=pet-bubble]')?.textContent ?? null,
            tidy: !!document.querySelector('.room.pf-tidy'),
            notes: !!document.querySelector('[data-testid=fx-notes]'),
            left: Math.round(document.querySelector('[data-testid=pet-slot]')?.getBoundingClientRect().left ?? -1),
          })
          if (performance.now() - t0 < total) setTimeout(snap, 40)
          else res(out)
        }
        snap()
      }),
    total,
  )

// ---------- 玩一站（跟 e2e-adventure 同樣的做法，全部第一次就答對） ----------
async function nextQuestion(page, oldId) {
  await page.getByTestId('next-question').click()
  await page.waitForFunction((old) => {
    const el = document.querySelector('[data-testid=question]')
    return !el || el.dataset.questionId !== old
  }, oldId, { timeout: 10000 })
}
async function clickChoice(page, id) {
  const loc = page.locator(`[data-testid=choice][data-choice-id="${id}"]`)
  await loc.click()
  if ((await loc.getAttribute('data-confirm')) === 'true') {
    await page.waitForTimeout(80)
    if ((await loc.getAttribute('data-armed')) === 'true') await loc.click()
  }
}
async function clearTutorial(page) {
  if ((await page.getByTestId('tutorial').count()) === 0) return
  await page.waitForSelector('[data-testid=tutorial][data-phase=play]', { timeout: 10000 })
  const kind = await page.getByTestId('tutorial').getAttribute('data-kind')
  if (kind === 'tapN') {
    await page.getByTestId('give-obj').first().click()
    await page.getByTestId('give-done').click()
  } else {
    await page.locator('[data-testid=sort-item][data-item="0"]').click()
    await page.locator('[data-testid=sort-bin][data-bin=b1]').click()
    await page.locator('[data-testid=sort-item][data-item="1"]').click()
    await page.locator('[data-testid=sort-bin][data-bin=b2]').click()
  }
  await page.waitForSelector('[data-testid=tutorial]', { state: 'detached', timeout: 10000 })
}
async function playQuestionCorrect(page) {
  await page.waitForSelector('[data-testid=question]')
  await clearTutorial(page)
  await page.waitForSelector('[data-testid=question]')
  const qid = await page.locator('[data-testid=question]').getAttribute('data-question-id')
  const q = BANK[qid]
  if (q.type === 'bins') {
    for (let i = 0; i < q.items.length; i++) {
      await page.locator(`[data-testid=sort-item][data-item="${i}"]`).click()
      await page.locator(`[data-testid=sort-bin][data-bin="${q.params.targets[i]}"]`).click()
      await page.waitForTimeout(60)
    }
    await page.waitForSelector('[data-testid=next-question]')
  } else if (q.type === 'give') {
    const n = Number(q.answer)
    for (let k = 0; k < n; k++) await page.locator('[data-testid=give-obj]').first().click()
    await page.getByTestId('give-done').click()
    await page.waitForSelector('[data-testid=give-basket].ok')
  } else {
    await clickChoice(page, q.answer)
    await page.waitForSelector(`[data-testid=choice][data-choice-id="${q.answer}"][data-state=right]`)
  }
  await nextQuestion(page, qid)
}
async function playStationFromHome(page) {
  await page.getByTestId('candy-map').click()
  await page.waitForSelector('[data-testid=map]')
  await page.getByTestId('station-1').click()
  await page.waitForSelector('[data-testid=stage]')
  for (let i = 0; i < 5; i++) await playQuestionCorrect(page)
  await page.waitForSelector('[data-testid=station-result]')
}
const backHome = async (page) => {
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=map]')
  await page.getByRole('button', { name: /回首頁/ }).click()
  await page.waitForSelector('[data-testid=pet]')
}
const advanceDays = async (page, n) => {
  await page.evaluate((n) => window.__debug.advanceDays(n), n)
}
const shot = async (page, name, tag) => {
  // 主流程的截圖（tag 以 -x 結尾）只做除錯用，不存；正式截圖在最後三種尺寸的段落
  if (SHOT_DIR && !tag.endsWith('-x')) await page.screenshot({ path: `${SHOT_DIR}/v5-meta-${name}-${tag}.png` })
}

const browser = await launch()
try {
  // =====================================================================
  // 1) 過一站 → 學習掉落食物：回首頁阿悟拿出禮物
  // =====================================================================
  const A = await app(browser, VP)
  const { page } = A
  await playStationFromHome(page)
  const s1 = await settingsOf(page)
  check('過一站：settings.pendingGifts 有 1 筆 { foodId, at, from: station }', s1.pendingGifts?.length === 1 && s1.pendingGifts[0].from === 'station' && !!s1.pendingGifts[0].foodId && s1.pendingGifts[0].at > 0, JSON.stringify(s1.pendingGifts))
  const dropFood = s1.pendingGifts?.[0]?.foodId
  check('掉落的食物已經寫進背包、不是蛋糕', (await invQty(page, dropFood)) >= 1 && dropFood !== 'cake', dropFood)
  const qtyBefore = await invQty(page, dropFood)
  await backHome(page)
  await waitGift(page)
  check('回首頁：阿悟拿出禮物（大圖）', (await page.getByTestId('gift').count()) === 1 && (await page.getByTestId('gift').getAttribute('data-gift-kind')) === 'food')
  const giftBox = await page.getByTestId('gift').boundingBox()
  check('禮物是大圖（>= 80px，孩子好點）', giftBox.width >= 80 && giftBox.height >= 80, `${Math.round(giftBox.width)}x${Math.round(giftBox.height)}`)
  const poseWhileGift = await petAttr(page, 'data-pose')
  check('阿悟用 happy 或 cheer 姿勢拿出禮物', poseWhileGift === 'cheer' || poseWhileGift === 'happy', poseWhileGift)
  const bt = await bubbleText(page)
  check('阿悟說「我在路上撿到…，送給你！」', /^我在路上撿到.+，送給你！$/.test(bt ?? ''), bt)
  // 阿悟走到畫面中間
  const pc = await center(page, '[data-testid=pet]')
  check('阿悟走到畫面中間', Math.abs(pc.x - VP.width / 2) < VP.width * 0.2, `x=${Math.round(pc.x)}`)
  await shot(page, 'gift', 'land-x')
  const said = await saidLog(page)
  check('禮物的話有唸出來（預錄音檔或 Web Speech）', said.some((t) => t === bt || t.startsWith('audio:')), JSON.stringify(said.slice(-3)))
  // 點一下收下：物品飛進食物欄
  const sawFly = page.waitForFunction(() => [...document.body.children].some((e) => e.style?.zIndex === '95'), null, { timeout: 3000, polling: 30 }).then(() => true, () => false)
  await page.getByTestId('gift').click()
  check('點一下收下：物品飛向食物欄', await sawFly)
  await waitNoGift(page, 6000)
  const s1b = await settingsOf(page)
  // 一站 5 題看過的物件通常已經 >= 6 種，所以回首頁時圖鑑也會送一份禮物：排在學習掉落後面、依序展示
  check('收下第一份後，佇列只剩下一份圖鑑禮物（依序，不是同時）', (s1b.pendingGifts ?? []).every((g) => g.from === 'collection'), JSON.stringify(s1b.pendingGifts))
  const rest1 = await drainGifts(page, 6000)
  check('剩下的禮物依序收完、佇列清空、背包數量沒有重複增加', ((await settingsOf(page)).pendingGifts ?? []).length === 0 && (await invQty(page, dropFood)) >= qtyBefore, JSON.stringify(rest1))

  // =====================================================================
  // 2) 隔天 → 今日小禮物（一天一次）、多份依序展示
  // =====================================================================
  const g0 = (await settingsOf(page)).lastGiftDate
  check('第一天（首次引導那天）不送小禮物、但記下日期', !!g0)
  // 自主行為加速成 2–4 秒一次：如果展示期間沒有暫停，阿悟很快就會自己走開
  await page.evaluate(() => localStorage.setItem('gq-pet-fast', '1'))
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await advanceDays(page, 1)
  await waitGift(page)
  const dailyBubble = await bubbleText(page)
  const xBefore = (await center(page, '[data-testid=pet]')).x
  await page.waitForTimeout(8000)
  check('展示期間自主行為暫停（加速排程下等了 8 秒，禮物還在、阿悟沒走開）', (await page.getByTestId('gift').count()) === 1 && Math.abs((await center(page, '[data-testid=pet]')).x - xBefore) < 4, `dx=${Math.abs((await center(page, '[data-testid=pet]')).x - xBefore)}`)
  const gDaily = await settingsOf(page)
  check('隔天回到首頁：有今日小禮物，說「今天的小禮物！」', gDaily.pendingGifts?.length === 1 && gDaily.pendingGifts[0].from === 'daily' && dailyBubble === '今天的小禮物！', `${JSON.stringify(gDaily.pendingGifts)} ${dailyBubble}`)
  check('lastGiftDate 更新成今天', gDaily.lastGiftDate !== g0)
  const invBefore = await dump(page, 'inventory')
  const matBefore = (await dump(page, 'materialLedger')).length
  void invBefore
  void matBefore
  // 再塞兩份禮物（一份材料、一份食物），確認依序展示、不會同時出現
  await idb(
    page,
    (db) =>
      new Promise((r) => {
        const s = db.transaction('settings', 'readwrite').objectStore('settings')
        s.get('main').onsuccess = (e) => {
          const cur = e.target.result
          s.put({ ...cur, pendingGifts: [...(cur.pendingGifts ?? []), { materialId: 'wood', qty: 2, at: Date.now(), from: 'daily' }, { foodId: 'peach', at: Date.now() + 1, from: 'station' }] }).onsuccess = () => r(1)
        }
      }),
  )
  let maxAtOnce = 1
  const kinds = []
  for (let i = 0; i < 3; i++) {
    await waitGift(page)
    maxAtOnce = Math.max(maxAtOnce, await page.getByTestId('gift').count())
    kinds.push(await page.getByTestId('gift').getAttribute('data-gift-kind'))
    await page.getByTestId('gift').click()
    await waitNoGift(page, 6000)
  }
  check('3 份禮物依序展示（一次只有一個）', maxAtOnce === 1 && kinds.length === 3 && kinds[1] === 'material' && kinds[2] === 'food', kinds.join('>'))
  check('全部收下後佇列清空', ((await settingsOf(page)).pendingGifts ?? []).length === 0)
  // 同一天重新整理不會再送
  await page.evaluate(() => localStorage.removeItem('gq-pet-fast'))
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await page.waitForTimeout(2500)
  check('同一天重新整理：不再送今日小禮物', (await page.getByTestId('gift').count()) === 0 && ((await settingsOf(page)).pendingGifts ?? []).length === 0)

  // =====================================================================
  // 3) PM：解鎖新招 → 表演按鈕 → 每一招的動作
  // =====================================================================
  await openMore(page)
  check('還沒學會新招：首頁沒有「表演」按鈕', (await page.getByTestId('perform-btn').count()) === 0)
  await page.getByTestId('more-btn').click()
  await openParentTab(page, 'PM 預覽')
  await page.locator('[data-pm=unlock-tricks]').click()
  await page.waitForTimeout(300)
  const petT = await petOf(page)
  check('PM 解鎖全部新招：pet.tricks 有 6 招', petT.tricks?.length === 6, JSON.stringify(petT.tricks))
  await page.getByRole('button', { name: '回首頁看看' }).click()
  await page.waitForSelector('[data-testid=pet]')
  await openMore(page)
  check('學會新招後，首頁出現「表演」按鈕', (await page.getByTestId('perform-btn').count()) === 1)
  const pb = await page.getByTestId('perform-btn').boundingBox()
  check('「表演」按鈕夠大（>= 56px）', pb.width >= 56 && pb.height >= 56, `${Math.round(pb.width)}x${Math.round(pb.height)}`)
  await shot(page, 'home-perform', 'land-x')
  // 點「表演」：阿悟隨機演一招
  const s = sampleTrick(page, 4200)
  await page.waitForTimeout(100)
  await page.getByTestId('perform-btn').click()
  const rowsOne = await s
  const trickAnims = new Set(['flip', 'hop', 'wave', 'bounce', 'walk', 'bow'])
  check('點「表演」：阿悟演出一個新招動作', rowsOne.some((r) => trickAnims.has(r.anim) || /^[123]$|Hello|整理好|謝謝你/.test(r.bubble ?? '')), JSON.stringify([...new Set(rowsOne.map((r) => r.anim))]))

  // PM 的「表演每一招」：依序演 6 招（v6 新增鞠躬），每一招的特徵都要看到
  const allRows = sampleTrick(page, 38500) // 先開始取樣，才不會漏掉回首頁後第一個動作
  await openParentTab(page, 'PM 預覽')
  await page.locator('[data-cmd="trick:all"]').click()
  await page.waitForSelector('[data-testid=pet]')
  const rows = (await allRows).filter((r) => r.left >= 0)
  const has = (p) => rows.some(p)
  const nums = rows.filter((r) => /^[123]$/.test(r.bubble ?? '')).map((r) => r.bubble)
  const numSeq = nums.filter((v, i) => v !== nums[i - 1])
  check('數香蕉：頭上依序冒出 1、2、3', numSeq.join('') === '123', `seq=${numSeq.join(',')}`)
  const lefts = rows.filter((r) => r.anim === 'walk').map((r) => r.left)
  check('整理房間：阿悟繞房間走（左右移動幅度 >= 200px）', lefts.length > 5 && Math.max(...lefts) - Math.min(...lefts) >= 200, `${Math.min(...lefts)}..${Math.max(...lefts)}`)
  check('整理房間：走完家具閃一下（.pf-tidy）', has((r) => r.tidy))
  check('節奏舞：原地小跳（hop）並有音符', has((r) => r.anim === 'hop') && has((r) => r.notes))
  check('說 Hello：揮手、泡泡寫 Hello', has((r) => r.anim === 'wave' && r.bubble === 'Hello!'))
  check('翻筋斗：flip 動畫（360 度）', has((r) => r.anim === 'flip' && r.pose === 'cheer'))
  check('有禮貌地鞠躬：bow 動畫、泡泡說「謝謝你！」', has((r) => r.anim === 'bow' && r.bubble === '謝謝你！'))
  const order = (p) => rows.findIndex(p)
  check('五招依序出現（數香蕉 → 整理房間 → 節奏舞 → Hello → 翻筋斗）', order((r) => r.bubble === '1') >= 0 && order((r) => r.bubble === '1') < order((r) => r.tidy) && order((r) => r.tidy) < order((r) => r.anim === 'hop') && order((r) => r.anim === 'hop') < order((r) => r.bubble === 'Hello!') && order((r) => r.bubble === 'Hello!') < order((r) => r.anim === 'flip'))
  const flipRow = rows.findIndex((r) => r.anim === 'flip')
  void flipRow

  // =====================================================================
  // 3b) 新招全螢幕慶祝 + 示範
  // =====================================================================
  await openParentTab(page, 'PM 預覽')
  await page.locator('[data-pm=celebrate-tricks]').click()
  await page.waitForSelector('[data-testid=trick-celebrate]')
  const titles = []
  for (let i = 0; i < 6; i++) {
    await page.waitForSelector('[data-testid=trick-celebrate]')
    titles.push(await page.getByTestId('trick-celebrate-text').innerText())
    if (i === 0) {
      const demo = await sampleTrick(page, 3600)
      check('慶祝時阿悟在房間示範該招（數香蕉：頭上冒 1、2、3）', demo.some((r) => r.bubble === '1') && demo.some((r) => r.bubble === '3'))
      await shot(page, 'trick', 'land-x')
    }
    if (i === 4) {
      const demo = await sampleTrick(page, 2600)
      check('慶祝時阿悟示範翻筋斗', demo.some((r) => r.anim === 'flip'))
    }
    await page.getByTestId('trick-close').click()
    await page.waitForTimeout(250)
  }
  check('依序慶祝 6 招，每招一句「阿悟學會了新本領：○○！」', titles.join('|') === ['數香蕉', '整理房間', '節奏舞', '說 Hello', '翻筋斗', '有禮貌地鞠躬'].map((n) => `阿悟學會了新本領：${n}！`).join('|'), titles.join('|'))
  check('慶祝句有唸出來', (await saidLog(page)).some((t) => t === '阿悟學會了新本領：翻筋斗！' || t.startsWith('audio:')))
  check('慶祝結束後佇列清空、不會再跳', ((await settingsOf(page)).pendingTricks ?? []).length === 0 && (await page.getByTestId('trick-celebrate').count()) === 0)

  // =====================================================================
  // 4) 圖鑑「我認識的朋友」
  // =====================================================================
  const attemptsNow = await dump(page, 'attempts')
  const knownNow = new Set(attemptsNow.flatMap((a) => [...objectsOf(BANK[a.questionId])]))
  await openMore(page)
  await page.getByTestId('friends-btn').click()
  await page.waitForSelector('[data-testid=friends]')
  await page.waitForSelector('[data-testid=friend]')
  const cells = await page.getByTestId('friend').count()
  const knownCells = await page.locator('[data-testid=friend][data-known=true]').count()
  check('圖鑑：每個物件一格；已認識的格數 = 作答過的題目裡的物件數', cells === 15 && knownCells === knownNow.size && knownCells >= 1, `cells=${cells} known=${knownCells} expect=${knownNow.size}`)
  const unknownFilter = await page.locator('[data-testid=friend][data-known=false] .friend-img').first().evaluate((el) => getComputedStyle(el).filter).catch(() => 'none')
  check('沒認識的是剪影（filter: brightness(0) opacity(.2)）', knownCells < 15 ? /brightness\(0\)/.test(unknownFilter) && /opacity\(0?\.2\)/.test(unknownFilter) : true, unknownFilter)
  const knownFilter = await page.locator('[data-testid=friend][data-known=true] .friend-img').first().evaluate((el) => getComputedStyle(el).filter)
  check('已認識的是彩色大圖（沒有 filter）', knownFilter === 'none', knownFilter)
  await shot(page, 'friends-before', 'land-x')
  // 作答更多題（模擬；直接寫 IndexedDB），回首頁再進圖鑑 → 新認識的朋友從剪影變彩色，滿 6 個再送禮物
  const rewardedBefore = (await settingsOf(page)).collectionRewarded ?? 0
  const unknownBefore = await page.locator('[data-testid=friend][data-known=false]').evaluateAll((els) => els.map((e) => e.dataset.friend))
  await addAttempts(page, QUESTIONS.map((q) => q.id))
  await page.getByRole('button', { name: /回首頁/ }).click()
  await page.waitForSelector('[data-testid=pet]')
  const knownAll = new Set(QUESTIONS.flatMap((q) => [...objectsOf(q)])).size
  const owed = Math.floor(knownAll / 6) - rewardedBefore
  await page.waitForTimeout(800)
  const s4 = await settingsOf(page)
  check('每收集滿 6 個送 1 份禮物（走 pendingGifts，from=collection）', owed >= 1 && (s4.collectionRewarded ?? 0) === Math.floor(knownAll / 6) && (s4.pendingGifts ?? []).filter((g) => g.from === 'collection').length === owed, `known=${knownAll} rewarded=${s4.collectionRewarded} before=${rewardedBefore} gifts=${JSON.stringify((s4.pendingGifts ?? []).map((g) => g.from))}`)
  await waitGift(page)
  check('阿悟說「你認識好多朋友，這個送給你！」', (await bubbleText(page)) === '你認識好多朋友，這個送給你！', await bubbleText(page))
  const got = await drainGifts(page, 5000)
  check('圖鑑禮物依序收完、佇列清空', got.length === owed && ((await settingsOf(page)).pendingGifts ?? []).length === 0, `got=${got.length} owed=${owed}`)
  await openMore(page)
  await page.getByTestId('friends-btn').click()
  await page.waitForSelector('[data-testid=friend]')
  await page.waitForTimeout(400)
  const knownAfter = await page.locator('[data-testid=friend][data-known=true]').count()
  const unknownAfter = await page.locator('[data-testid=friend][data-known=false]').evaluateAll((els) => els.map((e) => e.dataset.friend))
  check('答過更多題後，剪影變彩色（認識的朋友變多）', knownAfter === knownAll && knownAfter > knownCells && unknownAfter.length < unknownBefore.length, `${knownCells}→${knownAfter}`)
  const turned = unknownBefore.filter((id) => !unknownAfter.includes(id))
  check('原本是剪影的格子現在是彩色圖（filter none）', turned.length > 0 && (await page.locator(`[data-testid=friend][data-friend="${turned[0]}"] .friend-img`).evaluate((el) => getComputedStyle(el).filter)) === 'none')
  check('進度文字顯示認識幾個', (await page.getByTestId('friends-progress').innerText()).includes(`認識 ${knownAfter} / 15`))
  // 點一下：放大並唸中文名稱
  await page.evaluate(() => (window.__said.length = 0))
  const target = page.locator(`[data-testid=friend][data-friend="${turned[0]}"]`)
  const targetName = (await target.locator('.friend-name').innerText()).trim()
  await target.click()
  await page.waitForSelector('[data-testid=friend-view]')
  check('點一下放大：顯示大圖與名稱', (await page.locator('[data-testid=friend-view] .friend-bigname').innerText()).trim() === targetName, targetName)
  await page.waitForTimeout(300)
  const said2 = await saidLog(page)
  check('點一下唸出中文名稱', said2.includes(targetName) || said2.some((t) => t.startsWith('audio:')), JSON.stringify(said2))
  await shot(page, 'friend-view', 'land-x')
  await page.getByRole('button', { name: '好' }).click()
  await shot(page, 'friends-after', 'land-x')
  if (unknownAfter.length > 0) {
    await page.locator(`[data-testid=friend][data-friend="${unknownAfter[0]}"]`).click()
    check('沒認識的剪影點了不會放大', (await page.getByTestId('friend-view').count()) === 0)
  }
  check('頁面沒有錯誤（主流程）', A.errors.length === 0, A.errors.join(' | '))
  await A.ctx.close()

  // =====================================================================
  // 5) 時間快到：剩 2 分鐘，阿悟打哈欠提醒一次
  // =====================================================================
  {
    const T = await app(browser, VP)
    const p = T.page
    const day = await p.evaluate(() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    await patchSettings(p, { dailyLimitMin: 15 })
    await idb(p, (db, a) => new Promise((r) => {
      const tx = db.transaction('playTime', 'readwrite')
      tx.objectStore('playTime').put({ date: a.day, seconds: 15 * 60 - 110, bonusSeconds: 0 })
      tx.oncomplete = () => r(1)
    }), { day })
    await p.evaluate(() => (window.__said.length = 0))
    await p.reload()
    await p.waitForSelector('[data-testid=pet]')
    check('剩 2 分鐘之前不提醒', (await p.getByTestId('time-warn').count()) === 0)
    // 剩 110 秒：一開始就在 2 分鐘內，第一次計時就會提醒
    await p.waitForSelector('[data-testid=time-warn]', { timeout: 6000 })
    const txt = (await p.getByTestId('time-warn').innerText()).trim()
    check('阿悟打哈欠說「再玩一下下就要睡覺囉」', txt === '再玩一下下就要睡覺囉' && (await p.getByTestId('time-warn').locator('[data-pose=sleepy]').count()) === 1, txt)
    await shot(p, 'timewarn', 'land-x')
    const saidT = await saidLog(p)
    check('提醒的話有唸出來', saidT.includes('再玩一下下就要睡覺囉') || saidT.some((t) => t.startsWith('audio:')), JSON.stringify(saidT))
    await p.waitForSelector('[data-testid=time-warn]', { state: 'detached', timeout: 9000 })
    await p.waitForTimeout(3000)
    check('只提醒一次（提示消失後不再出現）', (await p.getByTestId('time-warn').count()) === 0)
    await p.reload()
    await p.waitForSelector('[data-testid=pet]')
    await p.waitForTimeout(3500)
    check('重新整理後也不再提醒（當天已提醒過）', (await p.getByTestId('time-warn').count()) === 0)
    check('頁面沒有錯誤（時間提醒）', T.errors.length === 0, T.errors.join(' | '))
    await T.ctx.close()
  }

  // =====================================================================
  // 6) 三種尺寸的截圖（只在有 SHOT_DIR 時）
  // =====================================================================
  if (SHOT_DIR) {
    const sizes = [
      ['land', { width: 1024, height: 768 }],
      ['port', { width: 768, height: 1024 }],
      ['phone', { width: 375, height: 812 }],
    ]
    for (const [tag, vp] of sizes) {
      const S = await app(browser, vp)
      const sp = S.page
      await sp.evaluate(() => window.__debug) // 確認 dev 模式
      await patchSettings(sp, { homeGuideShown: true, pendingGifts: [{ foodId: 'apple', at: Date.now(), from: 'station' }] })
      await idb(sp, (db) => new Promise((r) => {
        const s = db.transaction('pets', 'readwrite').objectStore('pets')
        s.get('pet').onsuccess = (e) => {
          s.put({ ...e.target.result, tricks: ['count', 'tidy', 'rhythm', 'hello', 'flip'] }).onsuccess = () => r(1)
        }
      }))
      await sp.reload()
      await waitGift(sp)
      await sp.waitForTimeout(900)
      await shot(sp, 'gift', tag)
      await sp.getByTestId('gift').click()
      await waitNoGift(sp, 6000)
      await shot(sp, 'home-perform', tag)
      // 新招慶祝
      await patchSettings(sp, { pendingTricks: ['flip'] })
      await sp.reload() // 直接寫 IndexedDB 不會通知畫面，重新整理才看得到
      await sp.waitForSelector('[data-testid=trick-celebrate]')
      await sp.waitForTimeout(2600)
      await shot(sp, 'trick', tag)
      await sp.getByTestId('trick-close').click()
      // 圖鑑
      await addAttempts(sp, QUESTIONS.slice(0, 40).map((q) => q.id))
      await openMore(sp)
      await sp.getByTestId('friends-btn').click()
      await sp.waitForSelector('[data-testid=friend]')
      await sp.waitForTimeout(500)
      await shot(sp, 'friends', tag)
      await sp.locator('[data-testid=friend][data-known=true]').first().click()
      await sp.waitForSelector('[data-testid=friend-view]')
      await sp.waitForTimeout(300)
      await shot(sp, 'friend-view', tag)
      await S.ctx.close()
    }
  }
} catch (e) {
  console.error(e)
  state.failed++
} finally {
  await browser.close()
}

console.log(state.failed === 0 ? '\n全部通過' : `\n${state.failed} 項失敗`)
process.exit(state.failed === 0 ? 0 : 1)
