// 互動框架與節奏 E2E（v4 線 L-B）：拿給我 N 個（拖曳 + 點選替代）、拖曳歸類（拖曳 + 點選再點籃子）、
// 教學示範（第一次才有、不計分）、連擊、開場台詞、Boss 站進度條、站型模板。
// 用法：BASE_URL=http://localhost:5182 node scripts/e2e-interact.mjs
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, idb, launch, makeChecker } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BANK = Object.fromEntries(
  ['number', 'classify', 'pattern'].flatMap((f) => JSON.parse(readFileSync(join(ROOT, `src/learning/content/${f}.json`), 'utf8'))).map((q) => [q.id, q]),
)
const ALL = Object.values(BANK)
const SHOTS = join(ROOT, 'design/screens')
mkdirSync(SHOTS, { recursive: true })
const { state, check } = makeChecker()
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `v4-learn-${name}.png`) })

let sess = 0
async function startPlan(page, ids, { station = 1, states = [], intros = ['tapN', 'dragSort'], doneBefore = 0 } = {}) {
  const sessionId = `e2ei-${++sess}-${Date.now()}`
  await idb(
    page,
    (db, o) =>
      new Promise((res) => {
        const tx = db.transaction(['settings', 'skillState', 'attempts', 'progress'], 'readwrite')
        const st = tx.objectStore('settings')
        st.get('main').onsuccess = (e) => {
          st.put({ ...e.target.result, seenIntros: o.intros, stageDraft: { chapterId: 'huaguoshan', station: o.station, run: 1, sessionId: o.sessionId, plan: o.ids.map((id) => ({ id, review: false, followUp: false })), savedAt: Date.now() } })
        }
        tx.objectStore('skillState').clear()
        for (const s of o.states) tx.objectStore('skillState').put(s)
        tx.objectStore('attempts').clear()
        const pr = tx.objectStore('progress')
        pr.clear()
        if (o.doneBefore > 0) pr.put({ chapterId: 'huaguoshan', run: 1, stations: Array.from({ length: 5 }, (_, i) => ({ done: i < o.doneBefore, independent: 5, total: 5 })), chestClaimed: false, completedRuns: 0, updatedAt: Date.now() })
        tx.oncomplete = () => res(1)
      }),
    { ids, sessionId, station, states, intros, doneBefore },
  )
  await page.evaluate(() => (location.hash = 'map'))
  await page.reload()
  await page.waitForSelector('[data-testid=map]')
  await page.getByTestId(`station-${station}`).click()
  await page.waitForSelector('[data-testid=question]')
  return sessionId
}
const skillRow = (skill, o = {}) => ({ skill, difficulty: 1, recent: [], stationStreak: 0, mastered: {}, updatedAt: Date.now(), total: 50, ...o })
const attempts = (page) => idb(page, (db) => new Promise((r) => (db.transaction('attempts').objectStore('attempts').getAll().onsuccess = (e) => r(e.target.result))))
const settings = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
const qid = (page) => page.locator('[data-testid=question]').getAttribute('data-question-id')
const stage = (page) => page.locator('[data-testid=question]').getAttribute('data-hint-stage')
const pose = (page) => page.locator('.adv-say-pet').getAttribute('data-pose')
async function next(page) {
  const old = await qid(page)
  await page.getByTestId('next-question').click()
  await page.waitForFunction((o) => {
    const el = document.querySelector('[data-testid=question]')
    return !el || el.dataset.questionId !== o
  }, old, { timeout: 10000 })
}
async function leave(page) {
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')
}
/** 滑鼠拖曳（Pointer Events）：from → to 的中心 */
async function drag(page, from, to, { release = true } = {}) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 14, a.y + a.height / 2 - 24, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
  if (release) await page.mouse.up()
}
const pickQ = (pred, n = 0) => ALL.filter((q) => !q.gentle && (q.interaction ?? 'pick') === 'pick' && pred(q))[n]
const give = (n) => ALL.find((q) => q.type === 'give' && Number(q.answer) === n)
const binsQ = (pred, n = 0) => ALL.filter((q) => q.type === 'bins' && pred(q))[n]
async function answerPick(page, wrongFirst = false) {
  const q = BANK[await qid(page)]
  if (wrongFirst) {
    await page.locator(`[data-testid=choice][data-choice-id="${q.choices.find((c) => c.id !== q.answer).id}"]`).click()
    await page.waitForTimeout(120)
  }
  const loc = page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`)
  await loc.click()
  if ((await loc.getAttribute('data-confirm')) === 'true') {
    await page.waitForTimeout(80)
    if ((await loc.getAttribute('data-armed')) === 'true') await loc.click()
  }
  await page.waitForSelector(`[data-testid=choice][data-choice-id="${q.answer}"][data-state=right]`)
}

const browser = await launch()
try {
  const { ctx, page, errors } = await freshApp(browser, { width: 1024, height: 768 })

  // ---------- 站型模板：第 1 站是教學站，第 2 題是「拿給我 N 個」，第一次遇到時阿悟先示範 ----------
  await page.evaluate(() => (location.hash = 'map'))
  await page.waitForSelector('[data-testid=map]')
  await page.getByTestId('station-1').click()
  await page.waitForSelector('[data-testid=question]')
  check('站型：第 1 站標記為教學站', (await page.getByTestId('stage').getAttribute('data-kind')) === 'tutorial')
  check('站開始：阿悟說一句開場話（不另開一頁），題目字幕照舊是題目', (await page.getByTestId('opener').count()) === 1 && (await page.getByTestId('subtitle').innerText()).trim() === BANK[await qid(page)].prompt)
  await page.waitForTimeout(500)
  await shot(page, 'opener')
  const draft = (await settings(page)).stageDraft
  const kinds = draft.plan.map((p) => BANK[p.id].interaction ?? 'pick')
  check('站型：教學站 5 題的互動位置是 [點選, 拿給我, 點選, 點選, 點選]', JSON.stringify(kinds) === JSON.stringify(['pick', 'tapN', 'pick', 'pick', 'pick']), JSON.stringify(kinds))
  check('站型：三種技能維持 2/2/1', ['number', 'classify', 'pattern'].map((s) => draft.plan.filter((p) => BANK[p.id].skill === s).length).sort().join() === '1,2,2')
  await page.waitForFunction(() => !document.querySelector('[data-testid=opener]'), null, { timeout: 6000 })
  check('開場話幾秒後收起來', true)
  await answerPick(page)
  await next(page)

  // ---------- 教學示範（第一次遇到「拿給我」） ----------
  await page.waitForSelector('[data-testid=tutorial]')
  check('第一次遇到拿給我：先教學示範（不是直接出題）', (await page.getByTestId('tutorial').getAttribute('data-kind')) === 'tapN' && (await qid(page)) === 'tutorial-tapN')
  check('教學：阿悟先示範（demo 階段，孩子不能點）', (await page.getByTestId('tutorial').getAttribute('data-phase')) === 'demo' && (await page.getByTestId('give-done').isDisabled()))
  await shot(page, 'tutorial-give')
  await page.waitForSelector('[data-testid=tutorial][data-phase=play]', { timeout: 8000 })
  check('教學：示範完輪到孩子（字幕「換你試試看」）', (await page.getByTestId('subtitle').innerText()).includes('換你'))
  // 用拖曳完成練習
  const obj0 = page.getByTestId('give-obj').first()
  check('拖曳物件設 touch-action: none（手指拖曳才不會被當成捲動）', (await obj0.evaluate((e) => getComputedStyle(e).touchAction)) === 'none')
  await drag(page, obj0, page.getByTestId('give-basket'))
  check('教學：把香蕉拖進籃子（Pointer Events 拖曳）', (await page.getByTestId('give-in').count()) === 1)
  await page.getByTestId('give-done').click()
  await page.waitForSelector('[data-testid=tutorial]', { state: 'detached', timeout: 8000 })
  check('教學結束後才出現真的題目', (await qid(page)).startsWith('number-'))
  check('教學不計分：作答紀錄只有第 1 題的 1 筆', (await attempts(page)).length === 1)
  check('教學只看一次：記在 settings.seenIntros', JSON.stringify((await settings(page)).seenIntros) === JSON.stringify(['tapN']))

  // ---------- 拿給我：拖曳與點選 ----------
  const g = BANK[await qid(page)]
  const n = Number(g.answer)
  const objs = page.getByTestId('give-obj')
  const poolN = await objs.count()
  // 拖到籃子外面：什麼都沒發生
  await drag(page, objs.first(), page.getByTestId('give-done'), { release: true })
  check('拖到籃子外面放開：東西留在桌上（不算錯）', (await page.getByTestId('give-in').count()) === 0 && (await stage(page)) === '0')
  await drag(page, objs.first(), page.getByTestId('give-basket'))
  check('拖進籃子：同步唸數、籃子裡多一個', (await page.getByTestId('give-in').count()) === 1 && (await page.getByTestId('give-count').innerText()) === '1')
  for (let i = 1; i < n; i++) await objs.first().click() // 其餘用點選
  check('點選替代操作：點一下就放進籃子', (await page.getByTestId('give-in').count()) === n && (await page.getByTestId('give-obj').count()) === poolN - n)
  await page.getByTestId('give-done').click()
  await page.waitForSelector('[data-testid=give-basket].ok')
  check('拿給我：數量剛好 → 答對，阿悟歡呼', (await pose(page)) === 'cheer')
  await shot(page, 'give-done')
  await next(page)
  check('拿給我的作答：interaction=tapN、獨立答對', (await attempts(page)).some((a) => a.interaction === 'tapN' && a.firstTryCorrect && a.hintsUsed === 0))
  await leave(page)

  // ---------- 拖曳歸類：拖曳、放錯彈回、點選再點籃子 ----------
  const b2 = binsQ((q) => q.difficulty === 2 && q.params.bins.length === 2 && !q.params.bins[0].swatch)
  await startPlan(page, [b2.id, pickQ((q) => q.skill === 'pattern' && q.difficulty === 1).id, pickQ((q) => q.skill === 'number' && q.difficulty === 1).id, pickQ((q) => q.skill === 'pattern' && q.difficulty === 1, 1).id, pickQ((q) => q.skill === 'number' && q.difficulty === 1, 1).id], { states: [skillRow('classify', { difficulty: 2 }), skillRow('number'), skillRow('pattern')] })
  check('拖曳歸類：顯示要分類的東西和 2 個籃子', (await page.getByTestId('sort-item').count()) === b2.items.length && (await page.getByTestId('sort-bin').count()) === 2)
  await shot(page, 'sort-start')
  const item0 = page.locator('[data-testid=sort-item][data-item="0"]')
  check('拖曳歸類的物件也設 touch-action: none', (await item0.evaluate((e) => getComputedStyle(e).touchAction)) === 'none')
  const target0 = b2.params.targets[0]
  const wrongBin = b2.params.bins.find((b) => b.id !== target0).id
  // 拖到錯的籃子：彈回、不會放進去、進入提示階梯
  await drag(page, item0, page.locator(`[data-testid=sort-bin][data-bin="${wrongBin}"]`))
  await page.waitForTimeout(200)
  check('放錯籃子：東西彈回桌上（沒有放進籃子）', (await page.getByTestId('sort-placed').count()) === 0 && (await page.locator('[data-testid=sort-item][data-item="0"].bounce').count()) === 1)
  check('放錯一次：進入提示階梯 stage 1，阿悟想一想，提示是題庫的 hint', (await stage(page)) === '1' && (await pose(page)) === 'think' && (await page.getByTestId('subtitle').innerText()).trim() === b2.hint)
  await shot(page, 'sort-wrong')
  // 再錯一次：下一個該放的東西與它的籃子發光（第二層）
  await item0.click()
  await page.locator(`[data-testid=sort-bin][data-bin="${wrongBin}"]`).click()
  await page.waitForTimeout(200)
  check('放錯第二次：stage 2，下一個該放的東西與它的籃子發光', (await stage(page)) === '2' && (await page.locator('.sort-item.demo').count()) === 1 && (await page.locator('.sort-bin.demo').count()) === 1)
  // 第 1 個：拖到對的籃子
  await drag(page, item0, page.locator(`[data-testid=sort-bin][data-bin="${target0}"]`))
  await page.waitForTimeout(150)
  check('拖進對的籃子：留在籃子裡', (await page.getByTestId('sort-placed').count()) === 1)
  // 其餘：點選物件（亮起）再點籃子
  const i1 = page.locator('[data-testid=sort-item][data-item="1"]')
  await i1.click()
  check('點選替代操作：點物件會亮起', (await i1.getAttribute('aria-pressed')) === 'true')
  for (let i = 1; i < b2.items.length; i++) {
    if (i > 1) await page.locator(`[data-testid=sort-item][data-item="${i}"]`).click() // 第 2 個剛剛已經點亮
    await page.locator(`[data-testid=sort-bin][data-bin="${b2.params.targets[i]}"]`).click()
    await page.waitForTimeout(80)
  }
  await page.waitForSelector('[data-testid=next-question]')
  check('全部放對 → 答對', (await page.getByTestId('sort-placed').count()) === b2.items.length)
  await next(page)
  const sAt = (await attempts(page)).find((a) => a.questionId === b2.id)
  check('歸類的作答：interaction=dragSort、錯 2 次 → hintsUsed=2、firstTryCorrect=false', sAt.interaction === 'dragSort' && sAt.hintsUsed === 2 && sAt.firstTryCorrect === false, JSON.stringify(sAt))
  await leave(page)

  // ---------- 3 個籃子（難度 3，含顏色分） ----------
  const b3 = binsQ((q) => q.difficulty === 3 && q.params.bins.length === 3)
  await startPlan(page, [b3.id, ...[0, 1, 2, 3].map((i) => pickQ((q) => q.skill === (i % 2 ? 'number' : 'pattern') && q.difficulty === 1, i).id)], { states: [skillRow('classify', { difficulty: 3 }), skillRow('number'), skillRow('pattern')] })
  check('3 個籃子的歸類', (await page.getByTestId('sort-bin').count()) === 3)
  await shot(page, 'sort-3bins')
  await leave(page)
  const bc = binsQ((q) => q.params.bins.some((b) => b.swatch))
  await startPlan(page, [bc.id, ...[0, 1, 2, 3].map((i) => pickQ((q) => q.skill === (i % 2 ? 'number' : 'pattern') && q.difficulty === 1, i).id)], { states: [skillRow('classify', { difficulty: 3 }), skillRow('number'), skillRow('pattern')] })
  check('依顏色歸類：籃子標示顏色', (await page.getByTestId('sort-bin').first().innerText()).includes('色'))
  await shot(page, 'sort-color')
  await leave(page)

  // ---------- 教學示範：拖曳歸類（只看一次） ----------
  await startPlan(page, [b2.id, ...[0, 1, 2, 3].map((i) => pickQ((q) => q.skill === (i % 2 ? 'number' : 'pattern') && q.difficulty === 1, i).id)], { states: [skillRow('classify', { difficulty: 2 }), skillRow('number'), skillRow('pattern')], intros: ['tapN'] })
  check('第一次遇到拖曳歸類：先教學示範', (await page.getByTestId('tutorial').getAttribute('data-kind')) === 'dragSort')
  await page.getByTestId('tutorial-skip').click()
  await page.waitForSelector('[data-testid=tutorial]', { state: 'detached' })
  check('可以跳過教學；跳過後直接出真的題目，不計分', (await qid(page)) === b2.id && (await attempts(page)).length === 0)
  check('跳過也算看過', (await settings(page)).seenIntros.includes('dragSort'))
  await leave(page)

  // ---------- 連擊：只算獨立答對；中斷時什麼都不顯示 ----------
  const pats = [0, 1, 2, 3, 4].map((i) => pickQ((q) => q.skill === 'pattern' && q.difficulty === 1, i).id)
  await startPlan(page, pats, { states: [skillRow('pattern')] })
  const marks = []
  for (let i = 0; i < 5; i++) {
    await answerPick(page)
    marks.push({ glow: (await page.locator('.adv-board.combo-glow').count()) === 1, tag: (await page.getByTestId('combo-tag').count()) === 1 ? (await page.getByTestId('combo-tag').innerText()).trim() : '', pose: await pose(page) })
    if (i === 2) await shot(page, 'combo-3')
    if (i === 4) await shot(page, 'combo-5')
    if (i < 4) await next(page)
  }
  check('連擊：第 1 題沒有；2 連題目區閃光', !marks[0].glow && marks[1].glow && marks[0].tag === '')
  check('連擊：3 連 → 阿悟跳舞、「三連擊！」', marks[2].pose === 'dance' && marks[2].tag === '三連擊！', JSON.stringify(marks[2]))
  check('連擊：5 連 → 阿悟唱歌、全部答對的讚美', marks[4].pose === 'sing' && marks[4].tag.includes('全部'), JSON.stringify(marks[4]))
  await leave(page)
  // 中斷：第 2 題先答錯 → 歸零，什麼都不顯示；之後從 1 重新累計
  await startPlan(page, pats, { states: [skillRow('pattern')] })
  const brk = []
  for (let i = 0; i < 5; i++) {
    await answerPick(page, i === 1)
    brk.push({ glow: (await page.locator('.adv-board.combo-glow').count()) === 1, tag: (await page.getByTestId('combo-tag').count()) === 1, pose: await pose(page) })
    if (i < 4) await next(page)
  }
  check('連擊中斷：答錯後不顯示任何連擊（沒有光、沒有字、阿悟只是 cheer）', !brk[1].glow && !brk[1].tag && brk[1].pose === 'cheer', JSON.stringify(brk[1]))
  check('中斷後重新累計：第 3 題只是第 1 連、不顯示；第 5 題（第 3 連）才跳舞', !brk[2].glow && brk[3].glow && brk[4].tag && brk[4].pose === 'dance', JSON.stringify(brk.slice(2)))
  await leave(page)

  // ---------- Boss 站：沒有失敗，只有進度條 ----------
  const bossPlan = [pickQ((q) => q.skill === 'pattern' && q.difficulty === 1, 5), binsQ((q) => q.difficulty === 2, 3), pickQ((q) => q.skill === 'number' && q.difficulty === 1, 5), give(2), pickQ((q) => q.skill === 'pattern' && q.difficulty === 1, 6)]
  await startPlan(page, bossPlan.map((q) => q.id), { station: 5, doneBefore: 4, states: [skillRow('classify', { difficulty: 2 }), skillRow('number'), skillRow('pattern')] })
  check('Boss 站：data-kind=boss、有進度條、沒有圓點', (await page.getByTestId('stage').getAttribute('data-kind')) === 'boss' && (await page.getByTestId('boss-bar').count()) === 1 && (await page.locator('.adv-dots').count()) === 0)
  check('Boss 站開場話是 Boss 的', ['最後一關！大家都在等我們。', '這一站要全部一起加油！'].includes((await page.getByTestId('opener').innerText()).trim()))
  const w0 = await page.locator('.boss-bar i').evaluate((e) => e.style.width)
  await page.waitForTimeout(800)
  await shot(page, 'boss-start')
  await answerPick(page, true) // 答錯一次也照樣前進
  const w1 = await page.locator('.boss-bar i').evaluate((e) => e.style.width)
  check('Boss 站：答對（即使先錯一次）進度條照樣前進；沒有失敗畫面', w0 === '0%' && w1 === '20%' && (await page.getByText(/失敗|再試一次|重來/).count()) === 0, `${w0}→${w1}`)
  await next(page)
  // 第 2 題：歸類（點選替代）
  const bq = BANK[await qid(page)]
  for (let i = 0; i < bq.items.length; i++) {
    await page.locator(`[data-testid=sort-item][data-item="${i}"]`).click()
    await page.locator(`[data-testid=sort-bin][data-bin="${bq.params.targets[i]}"]`).click()
    await page.waitForTimeout(60)
  }
  await page.waitForSelector('[data-testid=next-question]')
  await next(page)
  await answerPick(page)
  await next(page)
  const gq = BANK[await qid(page)]
  for (let i = 0; i < Number(gq.answer); i++) await page.getByTestId('give-obj').first().click()
  await page.getByTestId('give-done').click()
  await page.waitForSelector('[data-testid=give-basket].ok')
  await next(page)
  await answerPick(page)
  await page.getByTestId('next-question').click()
  await page.waitForSelector('[data-testid=station-result]')
  check('Boss 站結算：阿悟的收尾話與歡慶彩帶', (await page.getByTestId('wrapup').count()) === 1 && (await page.locator('.adv-result-card .adv-confetti').count()) === 1)
  await shot(page, 'boss-result')
  const done5 = await idb(page, (db) => new Promise((r) => (db.transaction('progress').objectStore('progress').get('huaguoshan').onsuccess = (e) => r(e.target.result))))
  check('Boss 站通關：進度 5 站都完成', done5.stations.every((s) => s.done))

  check('頁面沒有 JS 錯誤', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()

  // ---------- 觸控：用手指「點選」完成歸類（沒有拖曳也能玩） ----------
  const t = await freshApp(browser, { width: 820, height: 1180 }, { ctxOpts: { hasTouch: true } })
  await startPlan(t.page, [b2.id, ...[0, 1, 2, 3].map((i) => pickQ((q) => q.skill === (i % 2 ? 'number' : 'pattern') && q.difficulty === 1, i).id)], { states: [skillRow('classify', { difficulty: 2 }), skillRow('number'), skillRow('pattern')] })
  for (let i = 0; i < b2.items.length; i++) {
    await t.page.locator(`[data-testid=sort-item][data-item="${i}"]`).tap()
    await t.page.locator(`[data-testid=sort-bin][data-bin="${b2.params.targets[i]}"]`).tap()
    await t.page.waitForTimeout(80)
  }
  await t.page.waitForSelector('[data-testid=next-question]')
  check('觸控：手指點物件再點籃子，全部放對', (await t.page.getByTestId('sort-placed').count()) === b2.items.length)
  await shot(t.page, 'sort-touch')
  await t.ctx.close()

  // ---------- 手機直向 375×812：新版面不橫向溢出、可點的東西夠大 ----------
  const m = await freshApp(browser, { width: 375, height: 812 }, { ctxOpts: { hasTouch: true, isMobile: true } })
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  const fillers = [0, 1, 2, 3].map((i) => pickQ((q) => q.skill === (i % 2 ? 'number' : 'pattern') && q.difficulty === 1, i).id)
  await startPlan(m.page, [b3.id, ...fillers], { states: [skillRow('classify', { difficulty: 3 }), skillRow('number'), skillRow('pattern')] })
  await m.page.waitForTimeout(700)
  const sizes = await m.page.locator('[data-testid=sort-item], [data-testid=sort-bin]').evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]))
  check('手機：拖曳歸類（3 個籃子）不橫向溢出、物件與籃子 >= 56px', !(await overflow(m.page)) && sizes.every(([w, h]) => w >= 56 && h >= 56), JSON.stringify(sizes.slice(0, 3)))
  await shot(m.page, 'sort-mobile')
  await leave(m.page)
  await startPlan(m.page, [give(4).id, ...fillers], { states: [skillRow('number'), skillRow('pattern')] })
  await m.page.waitForTimeout(700)
  const gs = await m.page.locator('[data-testid=give-obj], [data-testid=give-done]').evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]))
  check('手機：拿給我不橫向溢出、物件與「好了」>= 56px', !(await overflow(m.page)) && gs.every(([w, h]) => w >= 56 && h >= 56), JSON.stringify(gs.slice(0, 2)))
  await shot(m.page, 'give-mobile')
  await leave(m.page)
  const cmpQ = pickQ((q) => q.type === 'compare' && q.difficulty === 3)
  await startPlan(m.page, [cmpQ.id, ...fillers], { states: [skillRow('number', { difficulty: 3 }), skillRow('pattern')] })
  await m.page.locator(`[data-testid=choice][data-choice-id="${cmpQ.choices.find((c) => c.id !== cmpQ.answer).id}"]`).click()
  await m.page.waitForSelector('[data-testid=match-board]')
  await m.page.waitForTimeout(600)
  check('手機：比多少的配對提示（最多 20 個）不橫向溢出', !(await overflow(m.page)))
  await shot(m.page, 'hint-compare-mobile')
  await m.ctx.close()

  console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
} finally {
  await browser.close()
}
process.exit(state.failed ? 1 : 0)
