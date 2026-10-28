// 英文單字科目、科目切換、每日冒險 E2E（v5 線 B）：
//   科目分頁（數學 / 英文）各自的進度；玩一站英文（語音：中文題目 → 英文單字、答錯提示）；四種題型的畫面；
//   每日冒險（5 題、材料、今日徽章只有每天第一次、同一天重玩換新題、隔天題目改變）；英文章末寶箱；家長報告含英文。
// 用法：先啟動 dev server（pnpm exec vite --port 5182 --strictPort），再 BASE_URL=http://localhost:5182 node scripts/e2e-english.mjs
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, freshApp, idb, launch, makeChecker, openParentTab } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BANK = Object.fromEntries(
  ['number', 'classify', 'pattern', 'english'].flatMap((f) => JSON.parse(readFileSync(join(ROOT, `src/learning/content/${f}.json`), 'utf8'))).map((q) => [q.id, q]),
)
const SHOTS = join(ROOT, 'design/screens')
mkdirSync(SHOTS, { recursive: true })
const { state, check } = makeChecker()
const SIZES = { land: { width: 1024, height: 768 }, port: { width: 768, height: 1024 }, phone: { width: 375, height: 812 } }

// 假的 speechSynthesis：記下唸了什麼與語言；每句 40ms 後觸發 onend（連續唸才會接著唸英文）
const SPEECH_STUB = () => {
  window.__spoken = []
  const fake = {
    speaking: false,
    speak(u) {
      window.__spoken.push({ t: u.text, lang: u.lang })
      window.setTimeout(() => u.onend && u.onend(), 40)
    },
    cancel() {},
    getVoices: () => [],
  }
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true })
  window.SpeechSynthesisUtterance = class {
    constructor(t) {
      this.text = t
    }
  }
}
const spoken = (page) => page.evaluate(() => window.__spoken.slice())
const clearSpoken = (page) => page.evaluate(() => (window.__spoken.length = 0))
// 等進場動畫（淡入）結束再截圖，不然畫面是半透明的
const shot = async (page, name, size) => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(SHOTS, `v5-learn-${name}-${size}.png`) })
}

const dump = (page, store) => idb(page, (db, s) => new Promise((r) => (db.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result))), store)
const progressOf = async (page, id) => (await dump(page, 'progress')).find((p) => p.chapterId === id)
const qid = async (page) => {
  await page.waitForSelector('[data-testid=question]')
  return page.locator('[data-testid=question]').getAttribute('data-question-id')
}
const hintStage = (page) => page.locator('[data-testid=question]').getAttribute('data-hint-stage')
const sub = async (page) => (await page.getByTestId('subtitle').innerText()).trim()
const wrongId = (q) => q.choices.find((c) => c.id !== q.answer).id
const click = (page, id) => page.locator(`[data-testid=choice][data-choice-id="${id}"]`).click()
async function answerRight(page, q) {
  await click(page, q.answer)
  await page.waitForSelector(`[data-testid=choice][data-choice-id="${q.answer}"][data-state=right]`)
}
async function next(page) {
  const old = await qid(page)
  await page.getByTestId('next-question').click()
  await page.waitForFunction((o) => {
    const el = document.querySelector('[data-testid=question]')
    return !el || el.dataset.questionId !== o
  }, old, { timeout: 10000 })
}
/** 玩完一站 / 一次每日冒險（5 題）。wrongAt：這幾題先答錯一次。回傳這次的題目 id */
async function playAll(page, { wrongAt = [] } = {}) {
  const seen = []
  for (let i = 0; i < 5; i++) {
    const q = BANK[await qid(page)]
    seen.push(q.id)
    if (wrongAt.includes(i)) {
      await click(page, wrongId(q))
      await page.waitForTimeout(150)
    }
    await answerRight(page, q)
    if (i < 4) await next(page)
    else await page.getByTestId('next-question').click()
  }
  await page.waitForSelector('[data-testid=station-result]', { timeout: 10000 })
  return seen
}
const openMap = async (page) => {
  await page.evaluate(() => (location.hash = 'map'))
  await page.reload()
  await page.waitForSelector('[data-testid=map]')
}
const setEnglishDifficulty = async (page, difficulty) => {
  await idb(
    page,
    (db, d) =>
      new Promise((res) => {
        const tx = db.transaction(['skillState', 'settings'], 'readwrite')
        tx.objectStore('skillState').put({ skill: 'english', difficulty: d, recent: [], stationStreak: 0, mastered: {}, updatedAt: Date.now(), total: 50 })
        tx.objectStore('settings').get('main').onsuccess = (e) => tx.objectStore('settings').put({ ...e.target.result, stageDraft: undefined })
        tx.oncomplete = () => res(1)
      }),
    difficulty,
  )
}

const browser = await launch()
try {
  const { ctx, page, errors } = await freshApp(browser, SIZES.land)
  await ctx.addInitScript(SPEECH_STUB)
  await page.reload()
  await page.waitForSelector('[data-testid=room]')

  // ---------- 科目分頁 ----------
  await openMap(page)
  check('地圖上方有科目分頁：數學、英文（大圖示加文字；v6 之後還有生活、自然）', (await page.getByTestId('subject-math').innerText()).includes('數學') && (await page.getByTestId('subject-english').innerText()).includes('英文') && (await page.locator('.adv-subject-glyph').count()) === 4)
  check('預設是數學（花果山）', (await page.getByTestId('subject-math').getAttribute('aria-selected')) === 'true' && (await page.getByTestId('map').getAttribute('data-subject')) === 'math' && (await page.locator('.adv-map-hero').innerText()).includes('花果山'))
  check('數學地圖有今日冒險卡片（還沒玩）', (await page.getByTestId('daily-card').getAttribute('data-done')) === '0' && (await page.getByTestId('daily-go').innerText()).includes('出發'))
  await page.getByTestId('subject-english').click()
  check('切到英文：英文小島 5 站、寶箱，站名和數學不同', (await page.getByTestId('map').getAttribute('data-subject')) === 'english' && (await page.locator('.adv-map-hero').innerText()).includes('英文小島') && (await page.locator('.adv-node-label').allInnerTexts()).join().includes('白沙灘') && (await page.getByTestId('chest-node').count()) === 1)
  check('英文第 1 站可以出發，其餘鎖住；數學的進度不受影響', (await page.locator('[data-station-state=current]').count()) === 1 && (await page.locator('[data-station-state=locked]').count()) === 4)
  await shot(page, 'map-english', 'land')

  // ---------- 玩一站英文（第 1 站，難度 1：聽英文選圖） ----------
  await clearSpoken(page)
  // v7：英文難度 1 一站會混入看圖選字與中翻英（題型隨機），這一段要測「聽英文選圖」，所以先存一份 5 題都是 hear 的進度（和離開關卡後接著玩是同一個機制）
  await idb(
    page,
    (db, ids) =>
      new Promise((res) => {
        const tx = db.transaction('settings', 'readwrite')
        tx.objectStore('settings').get('main').onsuccess = (e) =>
          tx.objectStore('settings').put({ ...e.target.result, stageDraft: { chapterId: 'english-island', station: 1, run: 1, sessionId: 'e2e-hear', plan: ids.map((id) => ({ id, review: false, followUp: false })), savedAt: Date.now() } })
        tx.oncomplete = () => res(1)
      }),
    Object.values(BANK).filter((x) => x.skill === 'english' && x.difficulty === 1 && x.type === 'hear' && !x.gentle).slice(0, 5).map((x) => x.id),
  )
  await page.getByTestId('station-1').click()
  await page.waitForSelector('[data-testid=question]')
  check('英文站：用英文畫面（題幹有喇叭與單字），章節是英文小島', (await page.getByTestId('stage').getAttribute('data-subject')) === 'english' && (await page.getByTestId('en-speak').count()) === 1)
  let q = BANK[await qid(page)]
  check('英文第 1 站出的是「聽英文選圖」，3 選 1，題幹顯示英文單字', q.skill === 'english' && q.type === 'hear' && (await page.locator('[data-testid=choice]').count()) === 3 && (await page.getByTestId('en-word').innerText()) === q.params.word)
  // 站一開始阿悟會先說一句開場話，再唸題目
  await page.waitForFunction((w) => window.__spoken.some((s) => s.t === w), q.params.word, { timeout: 9000 })
  let said = await spoken(page)
  const at = said.findIndex((s) => s.t === q.prompt)
  check('語音：先用中文唸題目（zh-TW），接著用英文唸單字（en-US）', at >= 0 && said[at].lang === 'zh-TW' && said[at + 1]?.t === q.params.word && said[at + 1].lang === 'en-US', JSON.stringify(said))
  await shot(page, 'english-hear', 'land')
  // 答錯 → 提示（中文提示 → 英文單字）
  await clearSpoken(page)
  await click(page, wrongId(q))
  await page.waitForFunction(() => window.__spoken.length >= 2, null, { timeout: 5000 })
  said = await spoken(page)
  check('答錯：提示（字幕是這題的提示），先唸中文提示再唸一次英文單字', (await hintStage(page)) === '1' && (await sub(page)) === q.hint && said[0].t === q.hint && said[1].t === q.params.word && said[1].lang === 'en-US', JSON.stringify(said))
  check('答錯的選項變灰、不能再點', (await page.locator(`[data-testid=choice][data-choice-id="${wrongId(q)}"]`).getAttribute('data-state')) === 'wrong')
  await shot(page, 'english-hint', 'land')
  await clearSpoken(page)
  await page.getByTestId('en-speak').click()
  check('喇叭鈕：再聽一次英文單字（en-US）', (await spoken(page)).at(-1)?.t === q.params.word && (await spoken(page)).at(-1)?.lang === 'en-US')
  await answerRight(page, q)
  check('答對：字幕變成稱讚', (await page.locator('.adv-bubble.ok').count()) === 1)
  await next(page)
  // 其餘 4 題：全部自己答對（第 3 題先錯一次）
  const stationIds = [q.id]
  for (let i = 1; i < 5; i++) {
    const qq = BANK[await qid(page)]
    stationIds.push(qq.id)
    if (i === 2) {
      await click(page, wrongId(qq))
      await page.waitForTimeout(150)
    }
    await answerRight(page, qq)
    if (i < 4) await next(page)
    else await page.getByTestId('next-question').click()
  }
  await page.waitForSelector('[data-testid=station-result]', { timeout: 10000 })
  check('英文站結算：第 1 站過關、英文小島', (await page.locator('.adv-result-card h1').innerText()).includes('第 1 站') && (await page.locator('.adv-result-card .adv-sub').first().innerText()).includes('英文小島'))
  check('5 題都是英文題，題目不重複', stationIds.every((id) => BANK[id].skill === 'english') && new Set(stationIds).size === 5)
  const attempts1 = await dump(page, 'attempts')
  check('作答紀錄：5 筆英文，答錯過的 2 題不算獨立答對', attempts1.length === 5 && attempts1.every((a) => a.skill === 'english') && attempts1.filter((a) => a.firstTryCorrect && a.hintsUsed === 0).length === 3)
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=map]')

  // ---------- 每個科目各自的進度 ----------
  check('回到地圖還是英文（記得最後選的科目）', (await page.getByTestId('map').getAttribute('data-subject')) === 'english')
  check('英文：已通關 1 / 5 站', (await page.locator('.adv-map-hero').innerText()).includes('已通關 1 / 5'))
  await page.getByTestId('subject-math').click()
  check('數學：還是已通關 0 / 5 站（互相獨立）', (await page.locator('.adv-map-hero').innerText()).includes('已通關 0 / 5') && (await page.locator('[data-station-state=current]').count()) === 1)
  const progs = await dump(page, 'progress')
  check('資料庫：英文與數學各自一列進度', progs.find((p) => p.chapterId === 'english-island').stations.filter((s) => s.done).length === 1 && !progs.find((p) => p.chapterId === 'huaguoshan'))
  await shot(page, 'map-math', 'land')
  await page.getByTestId('subject-english').click()

  // ---------- 四種題型的畫面（改英文難度後直接玩第 2 站） ----------
  await setEnglishDifficulty(page, 2)
  await openMap(page)
  await page.getByTestId('station-2').click()
  await page.waitForSelector('[data-testid=question]')
  const seenTypes = new Set()
  let pic = null
  for (let i = 0; i < 5; i++) {
    const qq = BANK[await qid(page)]
    seenTypes.add(qq.type)
    if (qq.type === 'pic2en' && !pic) {
      pic = qq
      check('看圖選英文單字：題幹是圖（或色塊、數字），選項是英文單字卡', (await page.getByTestId('en-pic').count()) === 1 && (await page.locator('.choice-word').allInnerTexts()).sort().join() === qq.choices.map((c) => c.text).sort().join())
      await click(page, wrongId(qq))
      await page.waitForTimeout(200)
      check('看圖選單字答錯：提示時出現喇叭鈕可以聽英文', (await page.getByTestId('en-speak').count()) === 1)
      await shot(page, 'english-pic2en', 'land')
    }
    await answerRight(page, qq)
    if (i < 4) await next(page)
    else await page.getByTestId('next-question').click()
  }
  await page.waitForSelector('[data-testid=station-result]', { timeout: 10000 })
  check('難度 2 出顏色／數字的聽英文選圖，或看圖選單字', [...seenTypes].every((t) => t === 'hear' || t === 'pic2en'), [...seenTypes].join())
  await page.getByTestId('back-to-map').click()

  await setEnglishDifficulty(page, 3)
  await openMap(page)
  await page.getByTestId('station-3').click()
  await page.waitForSelector('[data-testid=question]')
  q = BANK[await qid(page)]
  const zhq = q.type === 'zh2en' ? q : null
  if (zhq) {
    check('聽中文選英文：題幹是中文字，3 張英文單字卡', (await page.getByTestId('en-zh').innerText()) === zhq.params.zh && (await page.getByTestId('en-pic').count()) === 0)
    await clearSpoken(page)
    await click(page, wrongId(zhq))
    await page.waitForTimeout(300)
    check('聽中文選英文答錯：提示時才顯示圖，並唸英文單字', (await page.getByTestId('en-pic').count()) === 1 && (await spoken(page)).some((s) => s.t === zhq.params.word && s.lang === 'en-US'))
    await shot(page, 'english-zh2en', 'land')
  }
  check('難度 3 的題型是聽中文選單字（或顏色數字看圖選單字）', q.difficulty === 3 && ['zh2en', 'pic2en'].includes(q.type))
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')

  await setEnglishDifficulty(page, 4)
  await openMap(page)
  await page.getByTestId('station-3').click()
  await page.waitForSelector('[data-testid=question]')
  q = BANK[await qid(page)]
  check('難度 4 是拼字：圖加上缺一個字母的單字，字母卡 3 選 1', q.type === 'spell' && (await page.getByTestId('spell-word').getAttribute('data-pattern')) === q.params.pattern && (await page.locator('.en-letter.blank').count()) === 1 && (await page.locator('[data-testid=choice]').count()) === 3)
  await page.waitForFunction(() => window.__spoken.length >= 1, null, { timeout: 9000 })
  await clearSpoken(page)
  await click(page, wrongId(q))
  await page.waitForTimeout(250)
  check('拼字答錯：提示並唸出完整的英文單字', (await hintStage(page)) === '1' && (await spoken(page)).some((s) => s.t === q.params.word && s.lang === 'en-US'))
  await shot(page, 'english-spell', 'land')
  await answerRight(page, q)
  check('拼字答對：缺的位置補上字母', (await page.locator('.en-letter.blank.filled').innerText()) === q.answer)
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')
  await setEnglishDifficulty(page, 1)

  // ---------- 每日冒險（英文） ----------
  await openMap(page)
  const card = page.getByTestId('daily-card')
  check('英文地圖有今日冒險大卡片（還沒玩、沒有徽章）', (await card.getAttribute('data-done')) === '0' && (await card.getAttribute('data-badge')) === 'false' && (await page.getByTestId('daily-medal').count()) === 0)
  await shot(page, 'daily-card', 'land')
  const matBefore = (await dump(page, 'materialLedger')).reduce((n, e) => n + e.delta, 0)
  await page.getByTestId('daily-go').click()
  await page.waitForSelector('[data-testid=question]')
  check('每日冒險：用關卡畫面，5 題英文題', (await page.getByTestId('stage').getAttribute('data-daily')) === 'true' && (await page.getByTestId('stage').getAttribute('data-subject')) === 'english')
  const day1a = await playAll(page, { wrongAt: [1] })
  check('每日冒險 5 題不重複，都是英文', new Set(day1a).size === 5 && day1a.every((id) => BANK[id].skill === 'english'))
  check('結算：今日冒險完成、拿到材料', (await page.locator('.adv-result-card h1').innerText()).includes('今日冒險') && (await page.getByTestId('reward-text').innerText()).includes('獲得'))
  check('第一次完成：今日徽章', (await page.getByTestId('daily-badge').count()) === 1)
  await shot(page, 'daily-result', 'land')
  const matAfter = (await dump(page, 'materialLedger')).reduce((n, e) => n + e.delta, 0)
  check('材料入帳（2–4 個），帳上標示是今日冒險', matAfter - matBefore >= 2 && matAfter - matBefore <= 4 && (await dump(page, 'materialLedger')).some((e) => e.id.startsWith('daily:') && e.reason.includes('今日冒險')))
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=map]')
  check('回地圖：今日冒險顯示完成、徽章亮起、按鈕變「再玩一次」', (await card.getAttribute('data-done')) === '1' && (await card.getAttribute('data-badge')) === 'true' && (await page.getByTestId('daily-medal').count()) === 1 && (await page.getByTestId('daily-go').innerText()).includes('再玩一次'))
  check('章節進度沒被每日冒險動到（還是前面玩過的 2 站）', (await progressOf(page, 'english-island')).stations.filter((s) => s.done).length === 2)
  await shot(page, 'daily-card-done', 'land')

  // 同一天重玩：題目換新、有材料、沒有第二個徽章
  await page.getByTestId('daily-go').click()
  await page.waitForSelector('[data-testid=question]')
  const day1b = await playAll(page)
  check('同一天重玩：題面和剛剛不同', day1b.every((id) => !day1a.includes(id)), day1b.join())
  check('重玩沒有第二個徽章', (await page.getByTestId('daily-badge').count()) === 0)
  check('重玩還是有材料', (await page.getByTestId('reward-text').innerText()).includes('獲得'))
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=map]')
  check('資料庫：今天 2 次完成、只有 1 個英文徽章', (await progressOf(page, 'daily:english')).daily.badges.length === 1 && Object.values((await progressOf(page, 'daily:english')).daily.days)[0].done === 2)

  // 數學的每日冒險是另一份
  await page.getByTestId('subject-math').click()
  await page.waitForSelector('[data-testid=daily-card]')
  check('數學的今日冒險還沒玩（各科目各自一份）', (await card.getAttribute('data-done')) === '0' && (await card.getAttribute('data-badge')) === 'false')

  // ---------- 隔天：題目改變、又有一個徽章 ----------
  await page.getByTestId('subject-english').click()
  await page.waitForFunction(() => document.querySelector('[data-testid=daily-card]')?.dataset.done === '2', null, { timeout: 5000 })
  await page.waitForFunction(() => !!window.__debug, null, { timeout: 5000 })
  await page.evaluate(() => window.__debug.advanceDays(1))
  await page.waitForFunction(() => document.querySelector('[data-testid=daily-card]')?.dataset.done === '0', null, { timeout: 5000 })
  check('隔天（__debug 推進一天）：地圖上今日冒險自動重置成還沒玩，不用重新整理', (await card.getAttribute('data-badge')) === 'false' && (await page.getByTestId('daily-go').innerText()).includes('出發'))
  await page.getByTestId('daily-go').click()
  await page.waitForSelector('[data-testid=question]')
  const day2 = await playAll(page)
  check('隔天的題目和昨天（兩次）都不同', day2.every((id) => !day1a.includes(id) && !day1b.includes(id)), day2.join())
  check('隔天又拿到一個今日徽章（沒有連續天數的條件）', (await page.getByTestId('daily-badge').count()) === 1)
  await page.getByTestId('back-to-map').click()
  check('資料庫：累計 2 個徽章，日期不同', (await progressOf(page, 'daily:english')).daily.badges.length === 2 && new Set((await progressOf(page, 'daily:english')).daily.badges.map((b) => b.date)).size === 2)
  // 漏掉幾天也沒有任何損失
  await page.evaluate(() => window.__debug.advanceDays(3))
  await page.waitForFunction(() => document.querySelector('[data-testid=daily-card]')?.dataset.done === '0', null, { timeout: 5000 })
  check('隔了好幾天沒玩：徽章還在、沒有任何倒數或懲罰文字', (await progressOf(page, 'daily:english')).daily.badges.length === 2 && !/倒數|連續|斷掉|失去/.test(await page.locator('main').innerText()))

  // ---------- 英文章末寶箱 ----------
  await idb(
    page,
    (db) =>
      new Promise((res) => {
        const tx = db.transaction('progress', 'readwrite')
        tx.objectStore('progress').put({ chapterId: 'english-island', run: 1, stations: Array.from({ length: 5 }, () => ({ done: true, independent: 5, total: 5 })), chestClaimed: false, completedRuns: 0, updatedAt: Date.now() })
        tx.oncomplete = () => res(1)
      }),
  )
  await openMap(page)
  check('英文 5 站通關：寶箱可以開（數學的寶箱仍鎖著）', (await page.getByTestId('chest-node').getAttribute('aria-label')) === '打開寶箱')
  await page.getByTestId('chest-node').click()
  await page.waitForSelector('[data-testid=ceremony]')
  check('英文寶箱儀式：標題是英文小島', (await page.locator('.adv-ceremony h1').innerText()).includes('英文小島'))
  await page.getByTestId('claim-chest').click()
  await page.waitForSelector('[data-testid=chest-rewards]')
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=run-complete]')
  check('寶箱打開後只有英文這一輪完成', (await progressOf(page, 'english-island')).chestClaimed === true)
  await page.getByTestId('subject-math').click()
  check('數學地圖沒有「這一輪完成」', (await page.getByTestId('run-complete').count()) === 0)

  // ---------- 家長報告含英文 ----------
  await page.goto(BASE)
  await page.waitForSelector('[data-testid=room]')
  await openParentTab(page, '學習報告')
  await page.waitForSelector('[data-testid=learning-report]')
  check('家長報告：英文單字有自己的一列（題數、無提示答對率、難度說明）', (await page.locator('[data-skill=english]').count()) === 1 && (await page.getByTestId('count-english').innerText()).includes('題') && (await page.locator('[data-skill=english] .lt-level').innerText()).includes('目前難度'))
  const engAttempts = (await dump(page, 'attempts')).filter((a) => a.skill === 'english')
  check('報告的英文題數 = 資料庫英文作答筆數', Number((await page.getByTestId('count-english').innerText()).match(/^(\d+) 題/)[1]) === engAttempts.length, `${engAttempts.length}`)
  check('報告依科目分組（數學、英文）', (await page.getByTestId('report-subject-math').locator('[data-skill]').count()) === 6 && (await page.getByTestId('report-subject-english').locator('[data-skill]').count()) === 1)
  check('報告：今日徽章 2 個', (await page.getByTestId('report-badges').innerText()) === '2')
  await shot(page, 'report', 'land')

  check('沒有 console 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()

  // ---------- 三種尺寸截圖 ----------
  for (const [size, vp] of Object.entries(SIZES)) {
    if (size === 'land') continue
    const g = await freshApp(browser, vp, { ctxOpts: vp.width < 500 ? { hasTouch: true, isMobile: true } : {} })
    await g.ctx.addInitScript(SPEECH_STUB)
    await g.page.reload()
    await g.page.waitForSelector('[data-testid=room]')
    await openMap(g.page)
    await g.page.getByTestId('subject-english').click()
    await g.page.waitForTimeout(400)
    await shot(g.page, 'map-english', size)
    await g.page.getByTestId('daily-card').scrollIntoViewIfNeeded()
    await g.page.waitForTimeout(200)
    await shot(g.page, 'daily-card', size)
    await g.page.getByTestId('station-1').click()
    await g.page.waitForSelector('[data-testid=question]')
    await g.page.waitForTimeout(500)
    await shot(g.page, 'english-hear', size)
    await setEnglishDifficulty(g.page, 4)
    await openMap(g.page)
    await g.page.getByTestId('station-1').click()
    await g.page.waitForSelector('[data-testid=question]')
    await g.page.waitForTimeout(500)
    await shot(g.page, 'english-spell', size)
    check(`${size}：英文畫面沒有橫向捲動`, await g.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    check(`${size}：沒有 console 錯誤`, g.errors.length === 0, g.errors.join(' | '))
    await g.ctx.close()
  }
} finally {
  await browser.close()
}

console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
