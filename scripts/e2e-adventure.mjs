// 冒險一站完整流程 E2E（Playwright）：地圖 → 關卡（含答錯拿提示）→ 材料入帳 → 章末寶箱 → 工坊 → 家長學習報告 → 時間鎖。
// 用法：先啟動 dev server（例如 pnpm dev --port 5182 --strictPort），再
//   BASE_URL=http://localhost:5182 node scripts/e2e-adventure.mjs
// 需要 Chromium：預設找 ~/Library/Caches/ms-playwright 內已安裝的，或用 CHROME_PATH 指定。
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL ?? 'http://localhost:5182'
const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '../src/learning/content')
const BANK = Object.fromEntries(
  ['number', 'classify', 'pattern'].flatMap((f) => JSON.parse(readFileSync(join(CONTENT, `${f}.json`), 'utf8'))).map((q) => [q.id, q]),
)

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(root)) return undefined
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const p = join(root, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(p)) return p
  }
  return undefined
}

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`)
  if (!ok) failed++
}

/** 讀 IndexedDB 的整張表 */
const dump = (page, table) =>
  page.evaluate(
    (t) =>
      new Promise((res, rej) => {
        const rq = indexedDB.open('guaibao-quest')
        rq.onerror = () => rej(rq.error)
        rq.onsuccess = () => {
          const g = rq.result.transaction(t).objectStore(t).getAll()
          g.onsuccess = () => res(g.result)
        }
      }),
    table,
  )

async function freshApp(browser, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    // 美術圖還沒生成時會有 404，屬預期，不算錯
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  await page.goto(BASE)
  await page.waitForSelector('button.key')
  const press = async (pin) => {
    await page.evaluate(async (p) => {
      for (const d of p) [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
      await new Promise((r) => setTimeout(r, 200))
    }, pin)
  }
  await press('1234')
  await press('1234')
  await page.getByPlaceholder('小朋友的名字').fill('小明')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '開始冒險' }).click()
  await page.waitForSelector('[data-testid=room]')
  return { ctx, page, errors }
}

const toHash = async (page, hash) => {
  await page.evaluate((h) => (location.hash = h), hash)
}

/** 按「下一題」，並等到換成下一題（或結算畫面）。換題前會先在背景調整剩下的題，所以不是立刻換 */
async function nextQuestion(page, oldId) {
  await page.getByTestId('next-question').click()
  await page.waitForFunction(
    (old) => {
      const el = document.querySelector('[data-testid=question]')
      return !el || el.dataset.questionId !== old
    },
    oldId,
    { timeout: 10000 },
  )
}

/** 點選項。難度 1 的數字選項要點兩次（第一次只唸出數字、打勾，第二次才作答） */
async function clickChoice(page, id) {
  const loc = page.locator(`[data-testid=choice][data-choice-id="${id}"]`)
  await loc.click()
  if ((await loc.getAttribute('data-confirm')) === 'true') {
    await page.waitForTimeout(80)
    if ((await loc.getAttribute('data-armed')) === 'true') await loc.click()
  }
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

/** 拖曳歸類（用「點選物件再點籃子」的替代操作）：wrongTimes 次先放錯籃子，再全部放對 */
async function playSort(page, q, wrongTimes) {
  const info = { qid: q.id, q, taps: 0, sort: true }
  const bins = q.params.bins.map((b) => b.id)
  for (let w = 0; w < wrongTimes; w++) {
    const wrongBin = bins.find((b) => b !== q.params.targets[0])
    await page.locator('[data-testid=sort-item][data-item="0"]').click()
    await page.locator(`[data-testid=sort-bin][data-bin="${wrongBin}"]`).click()
    await page.waitForTimeout(150)
    info.taps++
    if (w === 0) {
      info.stageAfterFirstWrong = await page.locator('[data-testid=question]').getAttribute('data-hint-stage')
      info.hintText = (await page.getByTestId('subtitle').innerText()).trim()
      info.pose = await page.locator('.adv-say-pet').getAttribute('data-pose')
      info.hintBubble = (await page.locator('.adv-bubble.hint').count()) === 1
    }
  }
  if (wrongTimes >= 2) info.answerGlow = (await page.locator('.sort-bin.demo').count()) === 1
  for (let i = 0; i < q.items.length; i++) {
    await page.locator(`[data-testid=sort-item][data-item="${i}"]`).click()
    await page.locator(`[data-testid=sort-bin][data-bin="${q.params.targets[i]}"]`).click()
    await page.waitForTimeout(60)
  }
  await page.waitForSelector('[data-testid=next-question]')
  info.cheer = await page.locator('.adv-say-pet').getAttribute('data-pose')
  await nextQuestion(page, q.id)
  return info
}

/** 拿給我 N 個：先拿 n（或 wrongTimes 次拿錯數量）個，按「好了」 */
async function playGive(page, q, wrongTimes) {
  const n = Number(q.answer)
  const info = { qid: q.id, q, taps: 0, give: true }
  for (let w = 0; w < wrongTimes; w++) {
    const pool = await page.locator('[data-testid=give-obj]').count()
    // 少拿一個（n 為 1 時多拿一個）
    const want = n > 1 ? n - 1 : 2
    const have = await page.locator('[data-testid=give-in]').count()
    for (let k = have; k < want; k++) await page.locator('[data-testid=give-obj]').first().click()
    void pool
    await page.getByTestId('give-done').click()
    await page.waitForTimeout(150)
    info.taps++
    if (w === 0) {
      info.stageAfterFirstWrong = await page.locator('[data-testid=question]').getAttribute('data-hint-stage')
      info.hintText = (await page.getByTestId('subtitle').innerText()).trim()
      info.pose = await page.locator('.adv-say-pet').getAttribute('data-pose')
      info.hintBubble = (await page.locator('.adv-bubble.hint').count()) === 1
    }
  }
  if (wrongTimes >= 2) {
    // 第二次錯：阿悟示範，籃子慢慢補到剛好 n 個
    await page.waitForFunction((k) => document.querySelectorAll('[data-testid=give-in]').length === k, n, { timeout: 8000 })
    info.answerGlow = true
  }
  const have = await page.locator('[data-testid=give-in]').count()
  for (let k = have; k < n; k++) await page.locator('[data-testid=give-obj]').first().click()
  while ((await page.locator('[data-testid=give-in]').count()) > n) await page.locator('[data-testid=give-in]').last().click()
  await page.getByTestId('give-done').click()
  await page.waitForSelector('[data-testid=give-basket].ok')
  info.cheer = await page.locator('.adv-say-pet').getAttribute('data-pose')
  await nextQuestion(page, q.id)
  return info
}

/** 答一題：先點 N 個錯的（N 由 decide(q) 決定），再點正確答案，等它亮起，按「下一題」 */
async function playQuestion(page, decide) {
  await page.waitForSelector('[data-testid=question]')
  await clearTutorial(page)
  await page.waitForSelector('[data-testid=question]')
  const qid = await page.locator('[data-testid=question]').getAttribute('data-question-id')
  const q = BANK[qid]
  if (q.type === 'bins') return playSort(page, q, typeof decide === 'function' ? Math.min(decide(q), 2) : Math.min(decide, 2))
  if (q.type === 'give') return playGive(page, q, typeof decide === 'function' ? Math.min(decide(q), 2) : Math.min(decide, 2))
  const wrong = q.choices.filter((c) => c.id !== q.answer)
  const taps = Math.min(typeof decide === 'function' ? decide(q) : decide, wrong.length)
  const info = { qid, q, taps }
  for (let i = 0; i < taps; i++) {
    await clickChoice(page, wrong[i].id)
    await page.waitForTimeout(120)
    if (i === 0) {
      info.stageAfterFirstWrong = await page.locator('[data-testid=question]').getAttribute('data-hint-stage')
      info.hintText = (await page.getByTestId('subtitle').innerText()).trim()
      info.pose = await page.locator('.adv-say-pet').getAttribute('data-pose')
      info.hintBubble = (await page.locator('.adv-bubble.hint').count()) === 1
    }
  }
  if (taps >= 2) {
    info.answerGlow = (await page.locator('[data-testid=choice][data-state=answer]').count()) === 1
  }
  await clickChoice(page, q.answer)
  await page.waitForSelector(`[data-testid=choice][data-choice-id="${q.answer}"][data-state=right]`)
  info.cheer = await page.locator('.adv-say-pet').getAttribute('data-pose')
  await nextQuestion(page, qid)
  return info
}

async function playStation(page, wrongPlan) {
  const infos = []
  for (let i = 0; i < 5; i++) infos.push(await playQuestion(page, typeof wrongPlan === 'function' ? wrongPlan : wrongPlan[i]))
  await page.waitForSelector('[data-testid=station-result]')
  return infos
}

const browser = await chromium.launch({ executablePath: findChrome() })
try {
  const { ctx, page, errors } = await freshApp(browser, { width: 1024, height: 768 })

  // ---------- 地圖 ----------
  await toHash(page, 'map')
  await page.waitForSelector('[data-testid=map]')
  check('地圖：第 1 站可點、第 2 站與寶箱鎖住', (await page.getByTestId('station-1').isEnabled()) && (await page.getByTestId('station-2').isDisabled()) && (await page.getByTestId('chest-node').isDisabled()))
  check('地圖：後續章節顯示「即將開放」', (await page.getByText('即將開放').count()) === 2)
  check('地圖：沒有任何付費/訂閱字樣出現在兒童端', (await page.getByText(/訂閱|NT\$/).count()) === 0)

  // ---------- 第 1 站：Q2 錯一次、Q4 錯兩次（若選項夠多） ----------
  await page.getByTestId('station-1').click()
  await page.waitForSelector('[data-testid=stage]')
  const q1 = await page.locator('[data-testid=question]').getAttribute('data-question-id')
  check('進站後出現題目、字幕顯示題目文字', (await page.getByTestId('subtitle').innerText()).trim() === BANK[q1].prompt)
  check('有「再聽一次」喇叭按鈕', (await page.getByRole('button', { name: '再聽一次' }).count()) === 1)
  const sizes = await page.locator('[data-testid=choice]').evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]))
  check('選項卡片最小 96px', sizes.every(([w, h]) => w >= 96 && h >= 96), JSON.stringify(sizes))

  // 第一個「選項 >= 3」的題目答錯 1 次（走完整的第一層提示）；第二個答錯 2 次（標出正確答案）；其餘自己答對
  let done1 = 0
  const infos = await playStation(page, (q) => {
    if (q.choices.length >= 3 && done1 < 2) return ++done1
    return 0
  })
  const one = infos.find((i) => i.taps === 1)
  const two = infos.find((i) => i.taps === 2)
  const clean = infos.filter((i) => i.taps === 0)
  check('答錯一次：出現提示（stage 1）、阿悟「想一想」、提示框', !!one && one.stageAfterFirstWrong === '1' && one.pose === 'think' && one.hintBubble)
  check('提示文字就是題庫的 hint', !!one && one.hintText === one.q.hint, one?.hintText)
  check('答對後阿悟歡呼', !!one && one.cheer === 'cheer')
  check('再錯一次（或只剩一個選項）：標出正確答案', !!two && two.answerGlow === true, `taps=${two?.taps}`)

  // 結果畫面 & 資料
  const attempts = await dump(page, 'attempts')
  check('attempts 共 5 筆，同一個 sessionId', attempts.length === 5 && new Set(attempts.map((a) => a.sessionId)).size === 1)
  check('三種技能都出現', new Set(attempts.map((a) => a.skill)).size === 3, [...new Set(attempts.map((a) => a.skill))].join(','))
  const by = (id) => attempts.find((a) => a.questionId === id)
  check('答錯 1 次的題：firstTryCorrect=false、hintsUsed=1（提示後答對不算獨立答對）', !!one && by(one.qid).firstTryCorrect === false && by(one.qid).hintsUsed === 1)
  check('答錯 2 次的題：firstTryCorrect=false、hintsUsed=2', !!two && by(two.qid).firstTryCorrect === false && by(two.qid).hintsUsed === 2)
  check('其餘題：獨立答對（firstTryCorrect、hintsUsed=0）', clean.length === 3 && clean.every((i) => by(i.qid).firstTryCorrect === true && by(i.qid).hintsUsed === 0))
  check('每筆都有 durationMs 與 skill/difficulty', attempts.every((a) => a.durationMs >= 0 && a.skill && a.difficulty >= 1))

  const text = await page.getByTestId('reward-text').innerText()
  check('結果畫面：3 題獨立答對 → 獲得木材 × 3', /木材\s*×\s*3/.test(text), text)
  const ledger1 = await dump(page, 'materialLedger')
  check('材料入帳：1 筆 wood +3，來源為關卡', ledger1.length === 1 && ledger1[0].material === 'wood' && ledger1[0].delta === 3 && ledger1[0].kind === 'station')
  const prog1 = (await dump(page, 'progress'))[0]
  check('progress：第 1 站 done、獨立答對 3/5', prog1.stations[0].done && prog1.stations[0].independent === 3 && prog1.stations[0].total === 5 && !prog1.stations[1].done)

  // ---------- 回地圖 ----------
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=map]')
  check('回地圖：第 1 站已通關、第 2 站解鎖', (await page.locator('[data-station-state=done]').count()) === 1 && (await page.getByTestId('station-2').isEnabled()))

  // ---------- 第 2–5 站（全部自己答對），串到章末 ----------
  for (let s = 2; s <= 5; s++) {
    await page.getByTestId(`station-${s}`).click()
    await page.waitForSelector('[data-testid=stage]')
    await playStation(page, [0, 0, 0, 0, 0])
    if (s < 5) {
      await page.getByTestId('next-station').click()
      await page.waitForSelector('[data-testid=question]')
      // 「下一站」直接進下一站，這裡退回地圖點，確保地圖入口也通
      await page.getByRole('button', { name: '離開關卡' }).click()
      await page.getByTestId('leave-go').click()
      await page.waitForSelector('[data-testid=map]')
    }
  }
  check('第 5 站結束出現「去開寶箱」', (await page.getByTestId('open-chest').count()) === 1)
  await page.getByTestId('open-chest').click()
  await page.waitForSelector('[data-testid=ceremony]')
  await page.getByTestId('claim-chest').click()
  await page.waitForSelector('[data-testid=ceremony-title]')
  check('章末儀式：「今天的冒險完成了！」', (await page.getByTestId('ceremony-title').innerText()).includes('今天的冒險完成了'))
  check('章末儀式：寶箱額外材料 3 種', (await page.locator('[data-testid=chest-rewards] .reward-pop').count()) === 3)

  const ledger2 = await dump(page, 'materialLedger')
  const bal = { wood: 0, stone: 0, flower: 0 }
  for (const e of ledger2) bal[e.material] += e.delta
  // 站 1 木 3；站 2 花 4；站 3 石 4；站 4 木 4；站 5 石 4；寶箱各 2
  check('材料總帳正確（木 9 / 石 10 / 花 6）', bal.wood === 9 && bal.stone === 10 && bal.flower === 6, JSON.stringify(bal))
  check('材料列顯示與帳一致', (await page.locator('[data-materials-chip] [data-material=wood] b').innerText()) === '9')

  // ---------- 工坊 ----------
  await page.getByTestId('to-workshop').click()
  await page.waitForSelector('[data-testid=workshop]')
  const plantBtn = page.locator('[data-testid=craft-decor-plant] [data-testid=craft-btn]')
  await page.waitForFunction(() => document.querySelector('[data-testid=craft-decor-plant] [data-testid=craft-btn]')?.disabled === false)
  check('工坊：材料夠的家具可以做（小盆栽）', await plantBtn.isEnabled())
  const bedBtn = page.locator('[data-testid=craft-decor-bed] [data-testid=craft-btn]')
  await plantBtn.click()
  await page.waitForTimeout(300)
  const inv = await dump(page, 'inventory')
  check('做家具：背包有小盆栽、扣了材料（木 8 / 花 3）', inv.some((i) => i.itemId === 'decor-plant' && i.qty === 1))
  const ledger3 = await dump(page, 'materialLedger')
  const bal3 = { wood: 0, stone: 0, flower: 0 }
  for (const e of ledger3) bal3[e.material] += e.delta
  check('扣料正確', bal3.wood === 8 && bal3.stone === 10 && bal3.flower === 3, JSON.stringify(bal3))
  check('已做過的家具不能重複做', (await page.locator('[data-testid=craft-decor-plant] [data-testid=craft-btn]').count()) === 0)
  check('小床需要的花朵不夠時按鈕不可按', (await bedBtn.isDisabled()) === (bal3.flower < 2 || bal3.wood < 6 || bal3.stone < 2))

  // ---------- 再玩一次 ----------
  await page.getByRole('button', { name: '去冒險地圖' }).click()
  await page.waitForSelector('[data-testid=map]')
  check('寶箱開過後地圖出現「再玩一次」', (await page.getByTestId('next-run').count()) === 1)
  await page.getByTestId('next-run').click()
  await page.waitForTimeout(300)
  check('再玩一次：關卡重置到第 1 站', await page.getByTestId('station-1').isEnabled())
  const firstRunIds = new Set(attempts.map((a) => a.questionId))
  await page.getByTestId('station-1').click()
  await page.waitForSelector('[data-testid=question]')
  const replayIds = []
  for (let i = 0; i < 5; i++) {
    const info = await playQuestion(page, 0)
    replayIds.push(info.qid)
  }
  check('第二輪第 1 站的題面和第一輪不同', replayIds.every((id) => !firstRunIds.has(id)), replayIds.join(','))
  await page.waitForSelector('[data-testid=station-result]')

  // ---------- 家長：學習報告與 attempts 一致 ----------
  await page.goto(BASE)
  await page.getByRole('button', { name: /家長入口/ }).click()
  await page.evaluate(async () => {
    for (const d of '1234') [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
    await new Promise((r) => setTimeout(r, 300))
  })
  await page.getByRole('tab', { name: '學習報告' }).click()
  await page.waitForSelector('[data-testid=learning-report]')
  const all = await dump(page, 'attempts')
  const sessions = new Set(all.map((a) => a.sessionId)).size
  check('報告：練習回合數 = attempts 的 session 數', Number(await page.getByTestId('report-sessions').innerText()) === sessions, `${sessions}`)
  check('報告：作答題數 = attempts 筆數', Number(await page.getByTestId('report-attempts').innerText()) === all.length, `${all.length}`)
  let skillOk = true
  for (const sk of ['number', 'classify', 'pattern']) {
    const mine = all.filter((a) => a.skill === sk)
    const ind = mine.filter((a) => a.firstTryCorrect && a.hintsUsed === 0).length
    const rateText = await page.getByTestId(`rate-${sk}`).innerText()
    const countText = await page.getByTestId(`count-${sk}`).innerText()
    const expRate = mine.length ? `${Math.round((ind / mine.length) * 100)}%` : '尚無作答'
    if (!rateText.includes(expRate) || !countText.startsWith(`${mine.length} 題`) || !countText.includes(`${ind} 題無提示答對`)) skillOk = false
  }
  check('報告：各技能題數與無提示答對率和 attempts 一致', skillOk)

  // 其他新分頁
  await page.getByRole('tab', { name: '遊玩時間' }).click()
  check('遊玩時間分頁：預設 20 分鐘', (await page.locator('[role=radio][aria-checked=true]').innerText()) === '20 分鐘')
  await page.getByRole('radio', { name: '30 分鐘' }).click()
  await page.waitForTimeout(200)
  check('可改成 30 分鐘', (await page.locator('[role=radio][aria-checked=true]').innerText()) === '30 分鐘')
  await page.getByRole('tab', { name: '音效/語音' }).click()
  await page.getByTestId('voice-switch').click()
  await page.waitForTimeout(200)
  check('語音開關可關閉', (await page.getByTestId('voice-switch').getAttribute('aria-checked')) === 'false')
  await page.getByRole('tab', { name: '訂閱方案' }).click()
  check('訂閱樣品頁顯示價格與續訂說明', (await page.getByText('NT$149').count()) > 0 && (await page.getByText('NT$990').count()) > 0 && (await page.getByText('自動續訂').count()) > 0)
  await page.getByTestId('buy-month').click()
  check('按下購買：顯示「Prototype 尚未開放付款」', (await page.getByTestId('subscription-msg').innerText()).includes('Prototype 尚未開放付款'))
  await page.getByRole('button', { name: '知道了' }).click()
  await page.getByRole('tab', { name: '任務管理' }).click()
  check('任務管理：建議每天 1–2 項的提醒', (await page.getByTestId('task-limit-note').innerText()).includes('1–2 項'))

  check('頁面沒有 JS 錯誤', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()

  // ---------- 時間限制：到時間鎖住，家長 PIN 延長 ----------
  {
    const { ctx, page } = await freshApp(browser, { width: 1024, height: 768 })
    await page.evaluate(
      () =>
        new Promise((res) => {
          const rq = indexedDB.open('guaibao-quest')
          rq.onsuccess = () => {
            const d = new Date()
            const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            const tx = rq.result.transaction(['settings', 'playTime'], 'readwrite')
            const st = tx.objectStore('settings')
            const g = st.get('main')
            g.onsuccess = () => {
              st.put({ ...g.result, dailyLimitMin: 15 })
              tx.objectStore('playTime').put({ date, seconds: 15 * 60 - 3, bonusSeconds: 0 })
            }
            tx.oncomplete = () => res(1)
          }
        }),
    )
    await page.reload()
    await toHash(page, 'map')
    await page.waitForSelector('[data-testid=map]')
    await page.waitForSelector('[data-testid=lock-screen]', { timeout: 15000 })
    check('時間到：鎖定畫面「我想睡覺了，明天再一起冒險吧」', (await page.getByText('明天再一起冒險吧').count()) > 0)
    check('鎖定畫面：沒有冒險入口、沒有地圖', (await page.getByTestId('map').count()) === 0)
    const used = (await dump(page, 'playTime'))[0]
    check('前景時間有寫回資料庫', used.seconds >= 15 * 60 - 3)
    await page.getByTestId('lock-extend').click()
    await page.evaluate(async () => {
      for (const d of '9999') [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
      await new Promise((r) => setTimeout(r, 300))
    })
    check('錯誤 PIN 不能延長', (await page.getByTestId('lock-screen').count()) === 1)
    await page.evaluate(async () => {
      for (const d of '1234') [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
      await new Promise((r) => setTimeout(r, 400))
    })
    await page.waitForSelector('[data-testid=lock-screen]', { state: 'detached', timeout: 5000 })
    const pt = (await dump(page, 'playTime'))[0]
    check('正確 PIN：延長 10 分鐘（bonusSeconds=600），畫面解鎖', pt.bonusSeconds === 600 && (await page.getByTestId('map').count()) === 1)
    await ctx.close()
  }

  // ---------- 版面：375 與 768×1024 ----------
  for (const vp of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
    const { ctx, page } = await freshApp(browser, vp, vp.width < 500 ? { hasTouch: true, isMobile: true } : {})
    await toHash(page, 'map')
    await page.waitForSelector('[data-testid=map]')
    const noOverflowMap = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    await page.getByTestId('station-1').click()
    await page.waitForSelector('[data-testid=question]')
    const noOverflowStage = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    const small = await page.locator('[data-testid=choice]').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width < 96 || e.getBoundingClientRect().height < 96).length)
    check(`${vp.width}px：地圖與關卡不橫向溢出、選項 >= 96px`, noOverflowMap && noOverflowStage && small === 0, `map=${noOverflowMap} stage=${noOverflowStage} small=${small}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(failed ? `\n${failed} 項失敗` : '\n全部通過')
process.exit(failed ? 1 : 0)
