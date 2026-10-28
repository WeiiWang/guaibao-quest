// 學習正確性與節奏 E2E（v4 線 L-A）：動態提示、數數唸數、拿給我 N 個、年齡設定影響起始難度、
// 幼幼模式、站內救援與升級後重抽、離開關卡確認與進度保留。
// 做法：直接把「這一站的題目清單」寫進 settings.stageDraft，再從地圖進站，就能指定題型，不必等亂數。
// 用法：BASE_URL=http://localhost:5182 node scripts/e2e-learning.mjs
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, idb, launch, makeChecker, openParentTab } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BANK = Object.fromEntries(
  ['number', 'classify', 'pattern'].flatMap((f) => JSON.parse(readFileSync(join(ROOT, `src/learning/content/${f}.json`), 'utf8'))).map((q) => [q.id, q]),
)
const ALL = Object.values(BANK)
const SHOTS = join(ROOT, 'design/screens')
mkdirSync(SHOTS, { recursive: true })
const { state, check } = makeChecker()

const find = (pred, n = 0) => ALL.filter((q) => !q.gentle && pred(q))[n]
const findG = (pred, n = 0) => ALL.filter((q) => q.gentle && pred(q))[n]

const SPEECH_STUB = () => {
  window.__spoken = []
  const fake = {
    speaking: false,
    speak(u) {
      window.__spoken.push(u.text)
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

let sess = 0
/** 把這一站的題目清單寫進 settings.stageDraft（可同時改年齡與技能狀態），再從地圖進站 */
async function startPlan(page, ids, { age, states = [], clearAttempts = false, fresh = false } = {}) {
  const sessionId = `e2e-${++sess}-${Date.now()}`
  await idb(
    page,
    (db, o) =>
      new Promise((res) => {
        const tx = db.transaction(['settings', 'skillState', 'attempts', 'progress'], 'readwrite')
        const st = tx.objectStore('settings')
        st.get('main').onsuccess = (e) => {
          const cur = e.target.result
          const next = { ...cur, stageDraft: { chapterId: 'huaguoshan', station: 1, run: 1, sessionId: o.sessionId, plan: o.ids.map((id) => ({ id, review: false, followUp: false })), savedAt: Date.now() } }
          if (o.age) next.ageBand = o.age
          next.seenIntros = o.fresh ? [] : ['tapN', 'dragSort']
          st.put(next)
        }
        tx.objectStore('skillState').clear()
        tx.objectStore('progress').clear()
        for (const s of o.states) tx.objectStore('skillState').put(s)
        if (o.clearAttempts) tx.objectStore('attempts').clear()
        tx.oncomplete = () => res(1)
      }),
    { ids, sessionId, age, states, clearAttempts, fresh },
  )
  // 直接改 IndexedDB 不會通知畫面的 liveQuery，所以重新載入再進地圖
  await page.evaluate(() => (location.hash = 'map'))
  await page.reload()
  await page.waitForSelector('[data-testid=map]')
  await page.getByTestId('station-1').click()
  await page.waitForSelector('[data-testid=question]')
  return sessionId
}
const skillRow = (skill, o = {}) => ({ skill, difficulty: 1, recent: [], stationStreak: 0, mastered: {}, updatedAt: Date.now(), total: 50, ...o })
const qid = async (page) => {
  await page.waitForSelector('[data-testid=question]')
  if (await clearTutorial(page)) await page.waitForSelector('[data-testid=question]')
  return page.locator('[data-testid=question]').getAttribute('data-question-id')
}
const stage = (page) => page.locator('[data-testid=question]').getAttribute('data-hint-stage')
const sub = async (page) => (await page.getByTestId('subtitle').innerText()).trim()
const attempts = (page) => idb(page, (db) => new Promise((r) => (db.transaction('attempts').objectStore('attempts').getAll().onsuccess = (e) => r(e.target.result))))
async function leaveStage(page) {
  if ((await page.getByTestId('leave').count()) === 0) return
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')
}
/** 點選項；難度 1 數字要點兩次 */
async function clickChoice(page, id) {
  const loc = page.locator(`[data-testid=choice][data-choice-id="${id}"]`)
  await loc.click()
  if ((await loc.getAttribute('data-confirm')) === 'true') {
    await page.waitForTimeout(80)
    if ((await loc.getAttribute('data-armed')) === 'true') await loc.click()
  }
}
const wrongId = (q) => q.choices.find((c) => c.id !== q.answer).id
async function answerRight(page) {
  const q = BANK[await qid(page)]
  await clickChoice(page, q.answer)
  await page.waitForSelector(`[data-testid=choice][data-choice-id="${q.answer}"][data-state=right]`)
  await next(page)
}
async function answerWrongThenRight(page) {
  const q = BANK[await qid(page)]
  await clickChoice(page, wrongId(q))
  await page.waitForTimeout(150)
  await clickChoice(page, q.answer)
  await page.waitForSelector(`[data-testid=choice][data-choice-id="${q.answer}"][data-state=right]`)
  await next(page)
}
/** 按「下一題」，等到換成下一題（或結算畫面）。換題前會先在背景調整剩下的題，所以不是立刻換 */
async function next(page) {
  const old = await qid(page)
  await page.getByTestId('next-question').click()
  await page.waitForFunction((o) => {
    const el = document.querySelector('[data-testid=question]')
    return !el || el.dataset.questionId !== o
  }, old, { timeout: 10000 })
}
/** 第一次遇到新互動時阿悟會先示範：等輪到孩子，照做一次（點選替代操作），等教學結束 */
async function clearTutorial(page) {
  if ((await page.getByTestId('tutorial').count()) === 0) return false
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
  return true
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `v4-learn-${name}.png`) })

const browser = await launch()
try {
  const { ctx, page, errors } = await freshApp(browser, { width: 1024, height: 768 })
  await ctx.addInitScript(SPEECH_STUB)
  await page.reload()
  await page.waitForSelector('[data-testid=room]')

  // ---------- 動態提示：找不同（指出另外三個屬於哪一類，並把三個亮起來） ----------
  const odd = find((q) => q.type === 'odd')
  await startPlan(page, [odd.id, find((q) => q.type === 'color').id, find((q) => q.skill === 'pattern' && q.difficulty === 1).id, find((q) => q.type === 'compare').id, find((q) => q.type === 'count' && q.difficulty === 2).id], { states: ['number', 'classify', 'pattern'].map((s) => skillRow(s, { difficulty: s === 'pattern' ? 1 : 2 })), clearAttempts: true })
  // 這一站的第一題是 odd（classify 難度 3 的題）
  check('進站：用指定的題目清單（找不同）', (await qid(page)) === odd.id)
  await clearSpoken(page)
  await clickChoice(page, wrongId(odd))
  await page.waitForTimeout(300)
  check('找不同：答錯 → 提示指出三個同類（例如「都是水果」）', (await sub(page)) === odd.hint && odd.hint.includes(odd.params.groupName))
  check('找不同：三個同類的選項亮起來（hint-same ×3）', (await page.locator('.choice.hint-same').count()) === 3)
  check('找不同：用唸的（語音唸提示）', (await spoken(page)).includes(odd.hint))
  await shot(page, 'hint-odd')
  await clickChoice(page, odd.answer)
  await next(page)

  // ---------- 動態提示：顏色（色票 + 熟悉的參照物） ----------
  const color = BANK[await qid(page)]
  check('顏色題出現', color.type === 'color')
  await clickChoice(page, wrongId(color))
  await page.waitForTimeout(250)
  check('顏色：提示用熟悉的參照物（「像…」）', (await sub(page)).includes('像'), await sub(page))
  check('顏色：畫面出現色票', (await page.getByTestId('hint-swatch').count()) === 1)
  await shot(page, 'hint-color')
  await clickChoice(page, color.answer)
  await next(page)

  // ---------- 動態提示：規律（框出重複單位、逐個唸物件名） ----------
  const pat = BANK[await qid(page)]
  await clearSpoken(page)
  await clickChoice(page, wrongId(pat))
  await page.waitForTimeout(400)
  check('規律：框出重複的核心單位（前 2 格藍框、接著的 2 格紫框）', (await page.locator('.seq-cell.core-a').count()) === pat.params.core && (await page.locator('.seq-cell.core-b').count()) === pat.params.core)
  await page.waitForFunction((n) => window.__spoken.filter((t) => t).length >= n, 4, { timeout: 8000 })
  const said = await spoken(page)
  const names = pat.params.words.filter(Boolean)
  const idxs = names.map((w, i) => said.indexOf(w, i ? 0 : 0))
  check('規律：逐個唸出物件名（依序、含空格）', names.slice(0, 3).every((w) => said.includes(w)) && said.indexOf(names[0]) < said.indexOf(names[1]), JSON.stringify(said.slice(0, 6)) + idxs)
  await shot(page, 'hint-pattern')
  await clickChoice(page, pat.answer)
  await next(page)

  // ---------- 動態提示：比多少（配對連線動畫，多出來的亮起） ----------
  const cmp = BANK[await qid(page)]
  check('比多少題出現', cmp.type === 'compare')
  await clickChoice(page, cmp.choices.find((c) => c.id !== cmp.answer).id)
  await page.waitForTimeout(250)
  check('比多少：出現配對板', (await page.getByTestId('match-board').count()) === 1)
  const [ca, cb] = cmp.choices.map((c) => c.count)
  await page.waitForFunction(() => document.querySelector('[data-testid=match-board].done'), null, { timeout: 8000 })
  const extras = await page.locator('.match-col.extra').count()
  check('比多少：配完後多出來的格子亮起（數量 = 兩堆的差）', extras === Math.abs(ca - cb), `extras=${extras} diff=${Math.abs(ca - cb)}`)
  check('比多少：題目用顏色區分兩堆（沒有「左邊／右邊」）', !/左邊|右邊/.test(cmp.prompt) && cmp.prompt.includes('藍色'))
  await shot(page, 'hint-compare')
  // 2 選 1 答錯一次後：不會直接揭曉答案（沒有 answer 發光），孩子自己點剩下的那個
  check('2 選 1 答錯一次：不直接揭曉（沒有 stage 2）', (await stage(page)) === '1' && (await page.locator('[data-testid=choice][data-state=answer]').count()) === 0)
  await clickChoice(page, cmp.answer)
  await next(page)

  // ---------- 數數提示：亮一個唸一個，最後強調總數 ----------
  const cnt = BANK[await qid(page)]
  check('數數題出現', cnt.type === 'count')
  await clearSpoken(page)
  await clickChoice(page, wrongId(cnt))
  const n = Number(cnt.answer)
  await page.waitForFunction(() => document.querySelector('[data-testid=count-total]'), null, { timeout: 15000 })
  const said2 = await spoken(page)
  const zh = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  const order = Array.from({ length: n }, (_, i) => zh[i + 1])
  check('數數：亮起一個就唸一個（一、二、三…依序）', order.every((w, i) => said2.indexOf(w) >= 0 && (i === 0 || said2.indexOf(w) > said2.indexOf(order[i - 1]))), JSON.stringify(said2))
  await page.waitForFunction(() => window.__spoken.some((t) => t.startsWith('一共有')), null, { timeout: 5000 })
  check('數數：最後強調總數（「一共有 N 個」）', (await spoken(page)).includes(`一共有${zh[n]}個`))
  check('數數：畫面也顯示「一共 N 個」', (await page.getByTestId('count-total').innerText()).includes(String(n)))
  await shot(page, 'hint-count')
  await clickChoice(page, cnt.answer)
  await page.waitForSelector('[data-testid=station-result]')
  const ats = await attempts(page)
  const sessAts = ats.filter((a) => a.sessionId.startsWith('e2e-1-'))
  check('這一站的 5 筆作答都帶互動方式（pick）', sessAts.length === 5 && sessAts.every((a) => a.interaction === 'pick'))
  await page.getByTestId('back-to-map').click()

  // ---------- 數字選項（難度 1）：卡片右上角有小喇叭，點喇叭唸數字、點卡片直接作答（v7 取消兩段式） ----------
  const c1 = find((q) => q.type === 'count' && q.difficulty === 1)
  await startPlan(page, [c1.id, ...ALL.filter((q) => q.skill === 'classify' && q.difficulty === 1 && !q.gentle).slice(0, 4).map((q) => q.id)], { states: [], clearAttempts: true })
  await clearSpoken(page)
  const target = page.locator(`[data-testid=choice][data-choice-id="${c1.answer}"]`)
  const speaker = page.locator(`[data-testid=num-speak][data-choice-id="${c1.answer}"]`)
  const sb = await speaker.boundingBox()
  check('數字卡右上角有小喇叭（>= 56px）', !!sb && sb.width >= 56 && sb.height >= 56, JSON.stringify(sb))
  await speaker.click()
  await page.waitForTimeout(150)
  check('點喇叭：唸出數字，不會作答', (await target.getAttribute('data-state')) === 'idle' && (await spoken(page)).includes(['', '一', '二', '三', '四', '五'][Number(c1.answer)]))
  await target.click()
  await page.waitForSelector('[data-testid=question][data-hint-stage="0"] [data-state=right]')
  check('數字選項：點卡片直接作答，答對（不再點兩下）', true)
  await next(page)
  check('分類難度 1 是 3 選 1', (await page.locator('[data-testid=choice]').count()) === 3)
  // 3 選 1：答錯第一次要有提示（不會因為只剩選項而直接揭曉）
  const k1 = BANK[await qid(page)]
  await clickChoice(page, wrongId(k1))
  await page.waitForTimeout(200)
  check('3 選 1：答錯一次 → 給提示（stage 1），不直接揭曉答案', (await stage(page)) === '1' && (await page.locator('[data-state=answer]').count()) === 0)
  await leaveStage(page)

  // ---------- 拿給我 N 個 ----------
  const give = find((q) => q.type === 'give' && Number(q.answer) === 3)
  await startPlan(page, [give.id, find((q) => q.type === 'give' && Number(q.answer) === 2).id, find((q) => q.type === 'count' && q.difficulty === 1).id, find((q) => q.type === 'give' && Number(q.answer) === 1).id, find((q) => q.type === 'count' && q.difficulty === 1, 1).id], { clearAttempts: true })
  check('拿給我：題目出現桌上的物件與籃子', (await page.getByTestId('give-obj').count()) === give.params.pool && (await page.getByTestId('give-basket').count()) === 1)
  await shot(page, 'give-start')
  await page.waitForTimeout(700) // 等題目唸完
  await clearSpoken(page)
  await page.getByTestId('give-obj').first().click()
  await page.getByTestId('give-obj').first().click()
  check('拿給我：點一下放進籃子，同步唸數', (await page.getByTestId('give-in').count()) === 2 && (await spoken(page)).slice(-2).join() === '一,二')
  await page.getByTestId('give-in').last().click()
  check('拿給我：點籃子裡的東西可以放回去', (await page.getByTestId('give-in').count()) === 1)
  await page.getByTestId('give-obj').first().click()
  await page.getByTestId('give-done').click() // 只有 2 個，要 3 個
  await page.waitForTimeout(250)
  check('拿給我：數量不對 → 提示「再拿一個」，進入提示階梯（stage 1）', (await page.getByTestId('give-msg').innerText()).includes('再拿一個') && (await stage(page)) === '1' && (await sub(page)) === give.hint)
  check('拿給我：答錯後出現一對一的格子', (await page.locator('.give-want').count()) === 1)
  await shot(page, 'give-hint')
  await page.getByTestId('give-obj').first().click()
  await page.getByTestId('give-obj').first().click() // 多拿到 4 個
  await page.getByTestId('give-done').click()
  await page.waitForTimeout(250)
  // v7（試玩審查 B6）：阿悟示範開始時把舊的「放回去一個」訊息清掉，不要和示範同時出現
  check('拿給我：多拿了，第二次錯（stage 2）阿悟示範拿到剛好，示範開始時舊的錯誤訊息已清掉', (await page.getByTestId('give-msg').innerText()).trim() === '' && (await stage(page)) === '2')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=give-in]').length === 3, null, { timeout: 8000 })
  await page.getByTestId('give-done').click()
  await page.waitForSelector('[data-testid=give-basket].ok')
  await next(page)
  const gAt = (await attempts(page)).find((a) => a.questionId === give.id && a.sessionId.startsWith('e2e-'))
  check('拿給我：作答紀錄 interaction=tapN、答錯 2 次 → firstTryCorrect=false、hintsUsed=2', gAt && gAt.interaction === 'tapN' && gAt.firstTryCorrect === false && gAt.hintsUsed === 2, JSON.stringify(gAt))
  // 第 2 題：一次拿對
  const g2 = BANK[await qid(page)]
  for (let i = 0; i < Number(g2.answer); i++) await page.getByTestId('give-obj').first().click()
  await page.getByTestId('give-done').click()
  await page.waitForSelector('[data-testid=give-basket].ok')
  await next(page)
  const g2At = (await attempts(page)).find((a) => a.questionId === g2.id)
  check('拿給我：一次拿對 → 獨立答對', g2At.firstTryCorrect === true && g2At.hintsUsed === 0)
  await leaveStage(page)

  // ---------- 站內：升級後剩下的同技能題改用新難度重抽 ----------
  const n1 = ALL.filter((q) => q.skill === 'number' && q.difficulty === 1 && !q.gentle && q.type === 'count')
  const promo = [n1[0], find((q) => q.skill === 'classify' && q.difficulty === 1), n1[1], find((q) => q.skill === 'pattern' && q.difficulty === 1), n1[2]].map((q) => q.id)
  await startPlan(page, promo, { states: [skillRow('number', { recent: [true, true, true, true], total: 50 }), skillRow('classify'), skillRow('pattern')], clearAttempts: true })
  await answerRight(page) // number 第 5 題獨立答對 → 升到難度 2
  await page.waitForSelector('[data-testid=question]')
  await answerRight(page)
  const third = BANK[await qid(page)]
  check('升級後：剩下的 number 題改用難度 2 重抽', third.skill === 'number' && third.difficulty === 2, third.id)
  await leaveStage(page)

  // ---------- 站內救援：同技能連續 2 題第一次就答錯 → 下一題降 1 級（不改狀態） ----------
  const n2 = ALL.filter((q) => q.skill === 'number' && q.difficulty === 2 && !q.gentle && q.type === 'count')
  const resc = [n2[0], n2[1], find((q) => q.skill === 'classify' && q.difficulty === 2 && q.type !== 'bins'), n2[2], find((q) => q.skill === 'pattern' && q.difficulty === 2)].map((q) => q.id)
  await startPlan(page, resc, { states: ['number', 'classify', 'pattern'].map((s) => skillRow(s, { difficulty: 2 })), clearAttempts: true })
  await answerWrongThenRight(page)
  await answerWrongThenRight(page)
  await page.waitForSelector('[data-testid=question]')
  await answerRight(page) // classify
  const rescue = BANK[await qid(page)]
  check('站內救援：number 連續 2 題第一次就錯 → 下一題從難度 1 抽', rescue.skill === 'number' && rescue.difficulty === 1, rescue.id)
  const stNum = await idb(page, (db) => new Promise((r) => (db.transaction('skillState').objectStore('skillState').get('number').onsuccess = (e) => r(e.target.result))))
  check('站內救援：不改技能狀態（難度仍是 2）', stNum.difficulty === 2, JSON.stringify(stNum.recent))
  await leaveStage(page)

  // ---------- 離開關卡：確認 + 保留進度 ----------
  const keep = ALL.filter((q) => q.skill === 'classify' && q.difficulty === 3 && q.type === 'odd').slice(0, 5)
  const keepIds = keep.map((q) => q.id)
  const sid = await startPlan(page, keepIds, { states: [skillRow('classify', { difficulty: 3 })], clearAttempts: true })
  await answerRight(page)
  await answerRight(page)
  const third2 = BANK[await qid(page)]
  const orderBefore = await page.locator('[data-testid=choice]').evaluateAll((els) => els.map((e) => e.getAttribute('data-choice-id')))
  await page.getByRole('button', { name: '離開關卡' }).click()
  check('離開關卡：先出現確認視窗（不會直接離開）', (await page.getByTestId('leave-dialog').count()) === 1 && (await page.getByTestId('stage').count()) === 1)
  await shot(page, 'leave-confirm')
  await page.getByTestId('leave-stay').click()
  check('按「繼續玩」：回到題目，進度還在', (await page.getByTestId('leave-dialog').count()) === 0 && (await qid(page)) === third2.id)
  await page.getByRole('button', { name: '離開關卡' }).click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')
  const kept = (await attempts(page)).filter((a) => a.sessionId === sid)
  check('離開後：已答的 2 題作答紀錄都保留', kept.length === 2 && kept.every((a) => keepIds.slice(0, 2).includes(a.questionId)))
  await page.getByTestId('station-1').click()
  await page.waitForSelector('[data-testid=question]')
  check('回到同一站：從第 3 題接著玩（不重答、題目不變）', (await qid(page)) === third2.id)
  const orderAfter = await page.locator('[data-testid=choice]').evaluateAll((els) => els.map((e) => e.getAttribute('data-choice-id')))
  check('回到同一站：選項順序和離開前一樣', JSON.stringify(orderBefore) === JSON.stringify(orderAfter))
  check('回到同一站：前 2 題的進度點是完成的', (await page.locator('.adv-dot.done').count()) === 2)
  for (let i = 0; i < 3; i++) await answerRight(page)
  await page.waitForSelector('[data-testid=station-result]')
  const after = await idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
  check('完成這一站後：保留的進度清掉', after.stageDraft === undefined || after.stageDraft === null)
  check('完成這一站：5 題都記到同一個 session', (await attempts(page)).filter((a) => a.sessionId === sid).length === 5)
  await page.getByTestId('back-to-map').click()

  check('頁面沒有 JS 錯誤（一般模式）', errors.length === 0, errors.slice(0, 2).join(' | '))

  // ---------- 年齡設定（家長「設定」分頁）影響起始難度 ----------
  const age = await freshApp(browser, { width: 1024, height: 768 })
  await openParentTab(age.page, '設定')
  check('設定分頁有三檔年齡：3 歲、4–5 歲、6–7 歲，預設都沒選', (await age.page.locator('[role=radio][data-testid^=age-]').count()) === 3 && (await age.page.locator('[role=radio][data-testid^=age-][aria-checked=true]').count()) === 0)
  await age.page.getByTestId('age-6-7').click()
  await age.page.waitForTimeout(300)
  check('選 6–7 歲：存進設定、按鈕亮起', (await age.page.getByTestId('age-6-7').getAttribute('aria-checked')) === 'true')
  const s67 = await idb(age.page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
  check('年齡存在 settings.ageBand（optional 欄位，沒升資料庫版本）', s67.ageBand === '6-7')
  await shot(age.page, 'age-setting')
  await age.page.getByRole('button', { name: /離開|回|返回/ }).first().click().catch(() => {})
  await age.page.evaluate(() => (location.hash = 'map'))
  await age.page.waitForSelector('[data-testid=map]')
  // v7：6–7 歲第一次進數學冒險會先問 3 題快速分級；這裡略過，維持照年齡預設從難度 2 開始
  await age.page.waitForSelector('[data-testid=placement]')
  check('6–7 歲第一次進數學冒險：先問快速分級（可以略過）', true)
  await age.page.getByTestId('placement-skip').click()
  await age.page.waitForSelector('[data-testid=placement]', { state: 'detached' })
  await age.page.getByTestId('station-1').click()
  await age.page.waitForSelector('[data-testid=question]')
  const diffs = []
  for (let i = 0; i < 5; i++) {
    const id = await qid(age.page)
    diffs.push(BANK[id].difficulty)
    const q = BANK[id]
    if (q.type === 'give') {
      for (let k = 0; k < Number(q.answer); k++) await age.page.getByTestId('give-obj').first().click()
      await age.page.getByTestId('give-done').click()
      await age.page.waitForSelector('[data-testid=give-basket].ok')
      await next(age.page)
    } else await answerRight(age.page)
  }
  check('6–7 歲：第一站每一題都是難度 2（不是從難度 1 開始）', diffs.every((d) => d === 2), JSON.stringify(diffs))
  await age.page.waitForSelector('[data-testid=station-result]')
  await shot(age.page, 'result-67')
  await age.ctx.close()

  // ---------- 幼幼模式（3 歲） ----------
  const g = await freshApp(browser, { width: 1024, height: 768 })
  await g.ctx.addInitScript(SPEECH_STUB)
  await g.page.reload()
  await g.page.waitForSelector('[data-testid=room]')
  await openParentTab(g.page, '設定')
  await g.page.getByTestId('age-3').click()
  await g.page.waitForTimeout(300)
  await g.page.evaluate(() => (location.hash = 'map'))
  await g.page.waitForSelector('[data-testid=map]')
  await g.page.getByTestId('station-1').click()
  await g.page.waitForSelector('[data-testid=question]')
  check('幼幼模式：關卡標記 data-gentle', (await g.page.getByTestId('stage').getAttribute('data-gentle')) === 'true')
  const seenQ = []
  let gentleOk = true
  for (let i = 0; i < 5; i++) {
    const id = await qid(g.page)
    const q = BANK[id]
    seenQ.push(id)
    if (q.type === 'give') {
      gentleOk = gentleOk && Number(q.answer) <= 3
      for (let k = 0; k < Number(q.answer); k++) await g.page.getByTestId('give-obj').first().click()
      await g.page.getByTestId('give-done').click()
      await g.page.waitForSelector('[data-testid=give-basket].ok')
      await next(g.page)
      continue
    }
    const nChoices = await g.page.locator('[data-testid=choice]').count()
    gentleOk = gentleOk && nChoices === 2 && q.difficulty === 1
    if (q.skill === 'number') gentleOk = gentleOk && Number(q.answer) <= 3
    if (q.skill === 'pattern') gentleOk = gentleOk && q.params.core === 2 && q.items.length === 7
    if (q.skill === 'classify') gentleOk = gentleOk && !!q.gentle
    if (i === 0) {
      await shot(g.page, 'gentle-q')
      // 第一次答錯就給提示動畫和語音，並直接示範答案
      await clearSpoken(g.page)
      await clickChoice(g.page, wrongId(q))
      await g.page.waitForTimeout(300)
      check('幼幼：第一次答錯就給提示並直接示範答案（stage 2、答案發光）', (await stage(g.page)) === '2' && (await g.page.locator('[data-testid=choice][data-state=answer]').count()) === 1)
      check('幼幼：語氣鼓勵（「沒關係」）', (await sub(g.page)).includes('答案在這裡') && (await spoken(g.page)).some((t) => /沒關係|不要緊|陪你/.test(t)), JSON.stringify(await spoken(g.page)))
      await shot(g.page, 'gentle-hint')
      await clickChoice(g.page, q.answer)
      await g.page.waitForSelector('[data-testid=question] [data-state=right]')
      await next(g.page)
      continue
    }
    await answerRight(g.page)
  }
  check('幼幼：每題 2 選 1、數感只有 1–3 個、規律只有 AB 展示 3 輪、分類只用常見物件', gentleOk, seenQ.join())
  await g.page.waitForSelector('[data-testid=station-result]')
  const gAts = await attempts(g.page)
  check('幼幼：第一次答錯的題 hintsUsed=1（不是 2）、firstTryCorrect=false', gAts.some((a) => a.firstTryCorrect === false && a.hintsUsed === 1))
  await g.ctx.close()

  // ---------- 幼幼模式：快閃辨識 ----------
  const f = await freshApp(browser, { width: 1024, height: 768 })
  const flash = findG((q) => q.params?.flash)
  await openParentTab(f.page, '設定')
  await f.page.getByTestId('age-3').click()
  await f.page.waitForTimeout(250)
  await startPlan(f.page, [flash.id, ...ALL.filter((q) => q.gentle && q.skill === 'classify').slice(0, 4).map((q) => q.id)], { clearAttempts: true })
  check('快閃：一開始看得到物件', (await f.page.locator('.qv-stem .pile').count()) === 1)
  await f.page.waitForSelector('[data-testid=flash-again]', { timeout: 6000 })
  check('快閃：幾秒後蓋起來，出現「再看一下」', (await f.page.locator('.qv-stem .pile').count()) === 0)
  await shot(f.page, 'flash-covered')
  await f.page.getByTestId('flash-again').click()
  await f.page.waitForTimeout(150)
  check('快閃：按「再看一下」又亮一次', (await f.page.locator('.qv-stem .pile').count()) === 1)
  await f.ctx.close()

  console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
} finally {
  await browser.close()
}
process.exit(state.failed ? 1 : 0)
