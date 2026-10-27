// 數學第 2 章「水簾洞」與三種新玩法 E2E（v6 線 A）：
//   章節選擇與解鎖（第 1 章通關才開、PM 預覽直接解鎖、切換章節並記住）、玩一站（排序、放到位置、翻牌各一題，
//   含教學示範、答錯提示階梯、拖曳與「點選再點目標」兩種操作）、快閃記憶／找不一樣／空間方位的畫面、
//   家長報告出現三個新技能、每日冒險納入新技能、幼幼模式。
// 用法：先啟動 dev server（pnpm exec vite --port 5182 --strictPort），再 BASE_URL=http://localhost:5182 node scripts/e2e-math2.mjs
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, freshApp, idb, launch, makeChecker, openParentTab } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BANK = Object.fromEntries(
  ['number', 'classify', 'pattern', 'measure', 'space', 'observe'].flatMap((f) => JSON.parse(readFileSync(join(ROOT, `src/learning/content/${f}.json`), 'utf8'))).map((q) => [q.id, q]),
)
const ALL = Object.values(BANK)
const SHOTS = join(ROOT, 'design/screens')
mkdirSync(SHOTS, { recursive: true })
const { state, check } = makeChecker()
const SIZE = { width: 1024, height: 768 }
const shot = async (page, name) => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(SHOTS, `v6-math-e2e-${name}.png`) })
}

// 假的 speechSynthesis：記下唸了什麼（驗證答錯提示的語音與語音開關）
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
const spoken = (page) => page.evaluate(() => window.__spoken.map((s) => s.t))

const dump = (page, store) => idb(page, (db, s) => new Promise((r) => (db.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result))), store)
const settings = async (page) => (await dump(page, 'settings'))[0]
const progressOf = async (page, id) => (await dump(page, 'progress')).find((p) => p.chapterId === id)
const qid = async (page) => {
  await page.waitForSelector('[data-testid=question]')
  return page.locator('[data-testid=question]').getAttribute('data-question-id')
}
const stageOf = (page) => page.locator('[data-testid=question]').getAttribute('data-hint-stage')
const find = (pred, n = 0) => ALL.filter((q) => !q.gentle && pred(q))[n]
const findG = (pred, n = 0) => ALL.filter((q) => q.gentle && pred(q))[n]

async function openMap(page) {
  await page.evaluate(() => (location.hash = 'map'))
  await page.reload()
  await page.waitForSelector('[data-testid=map]')
}
const chapterNow = (page) => page.getByTestId('map').getAttribute('data-chapter')
const isOpen = async (page, id) => (await page.getByTestId(`chapter-${id}`).getAttribute('data-open')) === 'true'

/** 寫入關卡草稿：第 station 站用指定的題目；章節選第 2 章；清掉作答紀錄 */
let sess = 0
async function seed(page, { ids, station = 1, chapterId = 'shuiliandong', intros = ['tapN', 'dragSort', 'dragOrder', 'place', 'flip'], ageBand, doneBefore = station - 1, levels = {} }) {
  const sessionId = `e2em-${++sess}-${Date.now()}`
  await idb(
    page,
    (db, o) =>
      new Promise((res) => {
        const tx = db.transaction(['settings', 'attempts', 'progress', 'skillState'], 'readwrite')
        const st = tx.objectStore('settings')
        st.get('main').onsuccess = (e) => {
          const cur = e.target.result
          st.put({
            ...cur,
            seenIntros: o.intros,
            ...(o.ageBand ? { ageBand: o.ageBand } : { ageBand: undefined }),
            unlockedChapters: ['shuiliandong'],
            stageDraft: { chapterId: o.chapterId, station: o.station, run: 1, sessionId: o.sessionId, plan: o.ids.map((id) => ({ id, review: false, followUp: false })), savedAt: Date.now() },
          })
        }
        tx.objectStore('attempts').clear()
        const sk = tx.objectStore('skillState')
        sk.clear()
        // 站中會依各技能目前的難度換題，所以題目的難度要和技能狀態一致（total 50 = 不是新技能，不走快速通道）
        for (const [skill, difficulty] of Object.entries(o.levels)) sk.put({ skill, difficulty, recent: [], stationStreak: 0, mastered: {}, updatedAt: Date.now(), total: 50 })
        const pr = tx.objectStore('progress')
        pr.clear()
        pr.put({ chapterId: o.chapterId, run: 1, stations: Array.from({ length: 5 }, (_, i) => ({ done: i < o.doneBefore, independent: 5, total: 5 })), chestClaimed: false, completedRuns: 0, updatedAt: Date.now() })
        tx.oncomplete = () => res(1)
      }),
    { ids, sessionId, station, chapterId, intros, ageBand, doneBefore, levels },
  )
  await page.evaluate((c) => localStorage.setItem('gq-chapter-math', c), chapterId)
  await openMap(page)
  await page.getByTestId(`station-${station}`).click()
  await page.waitForSelector('[data-testid=question]')
  return sessionId
}

/** 滑鼠拖曳（Pointer Events）：from → to 的中心 */
async function drag(page, from, to) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 14, a.y + a.height / 2 - 24, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
  await page.mouse.up()
}
const orderItem = (page, i) => page.locator(`[data-testid=order-item][data-item="${i}"]`)
const orderSlot = (page, k) => page.locator(`[data-testid=order-slot][data-slot="${k}"]`)
const zone = (page, id) => page.locator(`[data-testid=place-zone][data-zone="${id}"]`)
const card = (page, i) => page.locator(`[data-testid=flip-card][data-card="${i}"]`)
const choice = (page, id) => page.locator(`[data-testid=choice][data-choice-id="${id}"]`)

/** 排序：tap = 點選物件再點格子；否則拖曳。part 可以只做前幾格 */
async function solveOrder(page, q, { tap = false, from = 0, to = q.params.order.length } = {}) {
  for (let k = from; k < to; k++) {
    const item = orderItem(page, q.params.order[k])
    if (tap) {
      await item.click()
      await orderSlot(page, k).click()
    } else await drag(page, item, orderSlot(page, k))
    await page.waitForSelector(`[data-testid=order-slot][data-slot="${k}"][data-filled=true]`)
  }
}
async function solvePlace(page, q, { tap = false } = {}) {
  const item = page.getByTestId('place-item')
  if (tap) {
    await item.click()
    await zone(page, q.params.target).click()
  } else await drag(page, item, zone(page, q.params.target))
  await page.waitForFunction(() => !document.querySelector('[data-testid=place-item]'))
}
/** 翻牌：把每一對一樣的牌翻開 */
async function solveFlip(page, q, { skipPairs = 0 } = {}) {
  const pairs = new Map()
  q.items.forEach((it, i) => pairs.set(it.obj, [...(pairs.get(it.obj) ?? []), i]))
  let k = 0
  for (const [a, b] of pairs.values()) {
    if (k++ < skipPairs) continue
    if ((await card(page, a).getAttribute('data-state')) === 'matched') continue
    await card(page, a).click()
    await card(page, b).click()
    await page.waitForSelector(`[data-testid=flip-card][data-card="${a}"][data-state=matched]`, { timeout: 4000 })
  }
}
async function solvePick(page, q) {
  const loc = choice(page, q.answer)
  await loc.click()
  // 難度 1 的數字選項：第一次點只唸出數字，再點一次才作答
  if ((await loc.getAttribute('data-confirm')) === 'true') {
    await page.waitForTimeout(80)
    if ((await loc.getAttribute('data-armed')) === 'true') await loc.click()
  }
  await page.waitForSelector(`[data-testid=choice][data-choice-id="${q.answer}"][data-state=right]`)
}
async function solve(page, q, opts = {}) {
  const it = q.interaction ?? 'pick'
  if (it === 'dragOrder') return solveOrder(page, q, opts)
  if (it === 'place') return solvePlace(page, q, opts)
  if (it === 'flip') return solveFlip(page, q, opts)
  if (it === 'tapN' || it === 'dragSort') throw new Error('這支 e2e 不玩第 1 章的互動')
  return solvePick(page, q)
}
async function next(page, last = false) {
  const old = await qid(page)
  await page.getByTestId('next-question').click()
  if (last) return
  await page.waitForFunction((o) => {
    const el = document.querySelector('[data-testid=question]')
    return !el || el.dataset.questionId !== o
  }, old, { timeout: 10000 })
}

/** 教學：等阿悟示範完，自己做一遍（用「點選再點目標」） */
async function doTutorial(page) {
  const kind = await page.getByTestId('tutorial').getAttribute('data-kind')
  await page.waitForSelector('[data-testid=tutorial][data-phase=play]', { timeout: 8000 })
  if (kind === 'dragOrder') {
    // 教學題：三顆蘋果由小排到大，order = [1, 2, 0]
    for (const [k, i] of [1, 2, 0].entries()) {
      await orderItem(page, i).click()
      await orderSlot(page, k).click()
    }
  } else if (kind === 'place') {
    await page.getByTestId('place-item').click()
    await zone(page, 'z1').click()
  } else if (kind === 'flip') {
    // 教學題：[蘋果, 魚, 魚, 蘋果]
    for (const [a, b] of [[0, 3], [1, 2]]) {
      await card(page, a).click()
      await card(page, b).click()
      await page.waitForSelector(`[data-testid=flip-card][data-card="${a}"][data-state=matched]`, { timeout: 4000 })
    }
  }
  await page.waitForFunction(() => !document.querySelector('[data-testid=tutorial]'), null, { timeout: 8000 })
  return kind
}

const browser = await launch()
try {
  const { ctx, page, errors } = await freshApp(browser, SIZE)
  await ctx.addInitScript(SPEECH_STUB)
  await page.reload()
  await page.waitForSelector('[data-testid=room]')

  // ================= 章節選擇與解鎖 =================
  await openMap(page)
  check('數學地圖有章節選擇：第 1 章花果山、第 2 章水簾洞；預設選第 1 章', (await page.locator('.adv-chap').count()) === 2 && (await chapterNow(page)) === 'huaguoshan' && (await page.getByTestId('chapter-huaguoshan').getAttribute('aria-selected')) === 'true')
  check('第 2 章還沒開（花果山沒通關）：標示「還沒開」、aria-disabled', !(await isOpen(page, 'shuiliandong')) && (await page.getByTestId('chapter-shuiliandong').getAttribute('aria-disabled')) === 'true' && (await page.getByTestId('chapter-shuiliandong').innerText()).includes('還沒開'))
  await shot(page, 'chapters-locked')
  await page.getByTestId('chapter-shuiliandong').click({ force: true }) // aria-disabled 的按鈕 Playwright 預設不點，孩子真的會點
  await page.waitForTimeout(150)
  check('點鎖住的第 2 章：不會切過去，有晃動回饋與一句語音', (await chapterNow(page)) === 'huaguoshan' && (await page.getByTestId('chapter-shuiliandong').getAttribute('class')).includes('ux-wobble') && (await spoken(page)).includes('水簾洞還沒開，先通關花果山喔'))
  check('英文科目沒有章節選擇（只有一章）', await (async () => {
    await page.getByTestId('subject-english').click()
    const n = await page.locator('.adv-chap').count()
    await page.getByTestId('subject-math').click()
    return n === 0
  })())

  // PM 預覽直接解鎖
  await page.goto(BASE)
  await page.waitForSelector('[data-testid=room]')
  await openParentTab(page, 'PM 預覽')
  check('PM 預覽有「章節」區塊，顯示水簾洞還沒開放', (await page.getByTestId('pm-chapters').innerText()).includes('還沒開放'))
  await page.locator('[data-pm=unlock-chapters]').click()
  await page.waitForFunction(() => document.querySelector('[data-testid=pm-chapters]')?.textContent?.includes('已開放'))
  check('PM 按「解鎖水簾洞」：寫進設定、顯示已開放', ((await settings(page)).unlockedChapters ?? []).includes('shuiliandong'))
  await page.getByRole('button', { name: '回首頁看看' }).click()
  await openMap(page)
  check('PM 解鎖後：第 2 章可以選，花果山的進度不受影響', (await isOpen(page, 'shuiliandong')) && (await progressOf(page, 'huaguoshan')) === undefined)
  await page.getByTestId('chapter-shuiliandong').click()
  check('切到水簾洞：地圖、站名、章節進度都換了（5 站 + 寶箱）', (await chapterNow(page)) === 'shuiliandong' && (await page.locator('.adv-map-hero').innerText()).includes('第二章・水簾洞') && (await page.locator('.adv-node-label').allInnerTexts()).join().includes('水簾洞口') && (await page.locator('[data-station-state]').count()) === 5 && (await page.getByTestId('chest-node').count()) === 1)
  check('水簾洞第 1 站可以出發，其餘鎖住（站與站之間的鎖照舊）', (await page.locator('[data-station-state=current]').count()) === 1 && (await page.locator('[data-station-state=locked]').count()) === 4)
  check('今日冒險卡片還在（科目的，不分章節）', (await page.getByTestId('daily-card').count()) === 1)
  await shot(page, 'map-ch2')
  // 頁面重新整理：記住選的章節
  await page.reload()
  await page.waitForSelector('[data-testid=map]')
  check('重新整理後還是水簾洞（記住選的章節）', (await chapterNow(page)) === 'shuiliandong')
  await page.getByTestId('chapter-huaguoshan').click()
  check('切回花果山：章節與進度都回到第 1 章', (await chapterNow(page)) === 'huaguoshan' && (await page.locator('.adv-map-hero').innerText()).includes('花果山') && (await page.locator('.adv-node-label').allInnerTexts()).join().includes('山腳小路'))
  // PM 鎖回去：記住的是第 2 章，但鎖住了就退回第 1 章
  await page.getByTestId('chapter-shuiliandong').click()
  await page.goto(BASE)
  await page.waitForSelector('[data-testid=room]')
  await openParentTab(page, 'PM 預覽')
  await page.locator('[data-pm=lock-chapters]').click()
  await page.waitForFunction(() => document.querySelector('[data-testid=pm-chapters]')?.textContent?.includes('還沒開放'))
  await page.getByRole('button', { name: '回首頁看看' }).click()
  await openMap(page)
  check('PM 鎖回去之後：即使記住的是第 2 章，也退回第 1 章，第 2 章又是鎖的', (await chapterNow(page)) === 'huaguoshan' && !(await isOpen(page, 'shuiliandong')) && ((await settings(page)).unlockedChapters ?? []).length === 0)

  // 自然解鎖：花果山 5 站通關
  await idb(page, (db) => new Promise((res) => {
    const tx = db.transaction('progress', 'readwrite')
    tx.objectStore('progress').put({ chapterId: 'huaguoshan', run: 1, stations: Array.from({ length: 5 }, () => ({ done: true, independent: 5, total: 5 })), chestClaimed: false, completedRuns: 0, updatedAt: Date.now() })
    tx.oncomplete = () => res(1)
  }))
  await page.evaluate(() => localStorage.setItem('gq-chapter-math', 'huaguoshan'))
  await openMap(page)
  check('花果山 5 站通關後，水簾洞自動解鎖（不用 PM）；新章節的按鈕會亮', (await isOpen(page, 'shuiliandong')) && (await page.getByTestId('chapter-shuiliandong').getAttribute('class')).includes('new'))

  // 打開花果山的寶箱：多一個「去水簾洞」按鈕，帶孩子去新章節
  await page.getByTestId('chest-node').click()
  await page.waitForSelector('[data-testid=claim-chest]')
  await page.getByTestId('claim-chest').click()
  await page.waitForSelector('[data-testid=to-next-chapter]')
  await page.waitForFunction(() => window.__spoken.some((x) => x.t === '水簾洞開門囉！'), null, { timeout: 5000 })
  check('章末寶箱打開後：說「水簾洞開門囉」，出現「去水簾洞」按鈕', (await page.getByTestId('next-chapter-open').innerText()).includes('水簾洞開門囉') && (await page.getByTestId('to-next-chapter').innerText()).includes('水簾洞') && (await spoken(page)).includes('水簾洞開門囉！'))
  await shot(page, 'ceremony-next')
  await page.getByTestId('to-next-chapter').click()
  await page.waitForSelector('[data-testid=map]')
  check('按「去水簾洞」：回地圖，已經切到第 2 章', (await chapterNow(page)) === 'shuiliandong')

  // ================= 玩一站（自然抽題）：4 題新技能 + 1 題第 1 章 =================
  await page.getByTestId('chapter-shuiliandong').click()
  await idb(page, (db) => new Promise((res) => {
    const tx = db.transaction(['settings', 'skillState'], 'readwrite')
    tx.objectStore('skillState').clear()
    tx.objectStore('settings').get('main').onsuccess = (e) => tx.objectStore('settings').put({ ...e.target.result, seenIntros: ['tapN', 'dragSort'], stageDraft: undefined })
    tx.oncomplete = () => res(1)
  }))
  await openMap(page)
  await page.getByTestId('chapter-shuiliandong').click()
  await page.getByTestId('station-1').click()
  await page.waitForSelector('[data-testid=question]')
  check('水簾洞第 1 站是教學站', (await page.getByTestId('stage').getAttribute('data-kind')) === 'tutorial')
  const draft = (await settings(page)).stageDraft
  check('抽題：草稿記著章節 shuiliandong、第 1 站', draft.chapterId === 'shuiliandong' && draft.station === 1 && draft.plan.length === 5)
  const skills = draft.plan.map((p) => BANK[p.id].skill)
  check('一站 5 題：前 4 題是三個新技能（measure、space、observe 都出現），最後 1 題是第 1 章的技能', new Set(skills.slice(0, 4)).size === 3 && ['measure', 'space', 'observe'].every((s) => skills.slice(0, 4).includes(s)) && ['number', 'classify', 'pattern'].includes(skills[4]), skills.join())
  check('第 2 站要排序的位置真的是排序題（教學站的第 2 題）', (BANK[draft.plan[1].id].interaction ?? 'pick') === 'dragOrder', draft.plan.map((p) => BANK[p.id].interaction ?? 'pick').join())

  // 玩完這一站：遇到排序時先教學；第 1 題故意答錯一次
  const natural = []
  let tutorials = []
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector('[data-testid=question]')
    if (await page.getByTestId('tutorial').count()) tutorials.push(await doTutorial(page))
    const q = BANK[await qid(page)]
    natural.push(q.id)
    if (i === 0 && (q.interaction ?? 'pick') === 'pick') {
      await choice(page, q.choices.find((c) => c.id !== q.answer).id).click()
      await page.waitForTimeout(200)
      check('第 1 題答錯一次：出現提示階梯 1', (await stageOf(page)) === '1')
    }
    await solve(page, q, { tap: i % 2 === 0 })
    if (i === 3) await shot(page, 'natural-q4')
    if (i < 4) await next(page)
    else await next(page, true)
  }
  await page.waitForSelector('[data-testid=station-result]', { timeout: 10000 })
  check('教學：第一次遇到排序時阿悟先示範一次（不計分），而且玩過就不再教', tutorials.join() === 'dragOrder', tutorials.join())
  check('結算：過關、拿到材料（水簾洞第 1 站是花朵）', (await page.locator('.adv-result-card h1').innerText()).includes('第 1 站') && (await page.getByTestId('reward-text').innerText()).includes('花朵'))
  const attempts1 = await dump(page, 'attempts')
  check('作答紀錄 5 筆（教學不計），都帶互動方式', attempts1.length === 5 && attempts1.every((a) => ['pick', 'dragOrder', 'place', 'flip'].includes(a.interaction)) && attempts1.some((a) => a.interaction === 'dragOrder'))
  check('進度寫在水簾洞：第 1 站過關、花果山不受影響', (await progressOf(page, 'shuiliandong')).stations[0].done === true && (await progressOf(page, 'huaguoshan')).stations.every((s) => s.done))
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=map]')
  check('回地圖還是水簾洞，章節進度 1/5，第 2 站亮起', (await chapterNow(page)) === 'shuiliandong' && (await page.locator('.adv-map-hero').innerText()).includes('已通關 1 / 5') && (await page.locator('[data-station-state=current]').count()) === 1)

  // ================= 玩一站（排序、空間、翻牌各一題，含教學與答錯提示） =================
  const order = find((q) => q.type === 'order' && q.difficulty === 2 && q.params.dim === 'size')
  const placeQ = find((q) => q.type === 'place' && q.difficulty === 3 && q.params.rel === 'left')
  const flipQ = find((q) => q.type === 'flip' && q.difficulty === 1)
  const bigger = find((q) => q.type === 'bigger' && q.difficulty === 2 && q.params.dim === 'length')
  const where = find((q) => q.type === 'where' && q.difficulty === 3)
  await seed(page, { ids: [order.id, placeQ.id, flipQ.id, bigger.id, where.id], intros: ['tapN', 'dragSort'], station: 2, levels: { measure: 2, space: 3, observe: 1 } })
  check('第 2 站（普通站）從排序題開始，題目字幕是題目的話', (await qid(page)) === 'tutorial-dragOrder' && (await page.getByTestId('stage').getAttribute('data-kind')) === 'normal')

  // --- 排序 ---
  check('排序教學：阿悟先示範（孩子不能點），標示「阿悟教你」', (await page.getByTestId('tutorial').getAttribute('data-phase')) === 'demo' && (await orderSlot(page, 0).isDisabled()) && (await page.locator('.tutorial-tag').innerText()).includes('阿悟教你'))
  await page.waitForSelector('[data-testid=order-slot][data-slot="0"][data-filled=true]', { timeout: 4000 })
  check('教學示範：阿悟把最小的放進第一格', (await page.locator('[data-testid=order-slot][data-slot="0"]').getAttribute('data-filled')) === 'true')
  await shot(page, 'tutorial-order')
  await doTutorial(page)
  check('教學做完：不寫作答紀錄、記下看過排序教學', (await dump(page, 'attempts')).length === 0 && ((await settings(page)).seenIntros ?? []).includes('dragOrder'))
  check('教學結束換真正的排序題（有「由小排到大」的箭頭與編號格子，3 個東西）', (await qid(page)) === order.id && (await page.locator('.ord-arrow').innerText()).includes('小') && (await orderSlot(page, 0).count()) === 1 && (await page.locator('[data-testid=order-item]').count()) === 3)
  await shot(page, 'order')
  // 放錯：把第 2 小的放進第 1 格
  const wrongItem = order.params.order[1]
  await drag(page, orderItem(page, wrongItem), orderSlot(page, 0))
  await page.waitForTimeout(150)
  check('排序放錯一次（拖曳）：東西彈回去、進入提示階梯 1，並唸出提示', (await stageOf(page)) === '1' && (await orderItem(page, wrongItem).count()) === 1 && (await orderSlot(page, 0).getAttribute('data-filled')) === null && (await spoken(page)).includes(order.hint))
  check('放錯時語音：「這一格不是它喔，再想一想。」', (await spoken(page)).includes('這一格不是它喔，再想一想。'))
  await orderItem(page, wrongItem).click()
  await orderSlot(page, 0).click()
  await page.waitForTimeout(150)
  check('再放錯一次（點選再點格子）：提示階梯 2，下一個該放的東西與格子發光', (await stageOf(page)) === '2' && (await page.locator('.ord-item.demo').count()) === 1 && (await page.locator('.ord-slot.demo').count()) === 1 && (await page.locator('.ord-item.demo').getAttribute('data-item')) === String(order.params.order[0]))
  await shot(page, 'order-hint')
  await solveOrder(page, order, { tap: true, from: 0, to: 1 })
  await solveOrder(page, order, { tap: false, from: 1 })
  check('排序全部放對：答對（點選與拖曳都能用），出現「下一題」', (await page.getByTestId('next-question').count()) === 1 && (await page.locator('[data-testid=order-slot][data-filled=true]').count()) === 3)
  await next(page)

  // --- 放到位置（空間） ---
  check('放到位置教學：先示範（亮起來的圈圈、東西自己飛過去）', (await qid(page)) === 'tutorial-place' && (await page.getByTestId('tutorial').getAttribute('data-kind')) === 'place')
  await page.waitForFunction(() => document.querySelector('[data-testid=sc-subject]'), null, { timeout: 4000 })
  await shot(page, 'tutorial-place')
  await doTutorial(page)
  check('放到位置真正的題目：場景裡有家具、發亮的圈圈（難度 3：上下左右 4 個）和一個可以拿的東西', (await qid(page)) === placeQ.id && (await page.locator('[data-testid=place-zone]').count()) === 4 && (await page.getByTestId('place-item').count()) === 1 && (await page.locator('.plc-scene .sc-prop').count()) === 1, `${await qid(page)} zones=${await page.locator('[data-testid=place-zone]').count()} items=${await page.getByTestId('place-item').count()}`)
  await shot(page, 'place')
  const wrongZone = placeQ.params.zones.find((z) => z.id !== placeQ.params.target).id
  await drag(page, page.getByTestId('place-item'), zone(page, wrongZone))
  await page.waitForTimeout(150)
  check('放錯位置（拖曳）：東西彈回去、提示階梯 1', (await stageOf(page)) === '1' && (await page.getByTestId('place-item').count()) === 1 && (await spoken(page)).includes(placeQ.hint) && (await spoken(page)).includes('不是這裡喔，再試試看。'))
  await page.getByTestId('place-item').click()
  await zone(page, wrongZone).click()
  await page.waitForTimeout(150)
  check('再放錯一次（點選再點位置）：提示階梯 2，正確的位置發光', (await stageOf(page)) === '2' && (await zone(page, placeQ.params.target).getAttribute('class')).includes('demo'))
  await shot(page, 'place-hint')
  await solvePlace(page, placeQ, { tap: true })
  check('點選東西再點正確位置：放好了，東西站在那個位置、出現「下一題」', (await page.getByTestId('next-question').count()) === 1 && (await page.getByTestId('sc-subject').count()) === 1)
  await next(page)

  // --- 翻牌（觀察與記憶） ---
  check('翻牌教學：先示範翻兩張一樣的', (await qid(page)) === 'tutorial-flip' && (await page.getByTestId('tutorial').getAttribute('data-kind')) === 'flip')
  await page.waitForSelector('[data-testid=flip-card][data-state=up]', { timeout: 4000 })
  await doTutorial(page)
  check('翻牌真正的題目：2×2 共 4 張牌，全部蓋著', (await qid(page)) === flipQ.id && (await page.locator('[data-testid=flip-card]').count()) === 4 && (await page.locator('[data-testid=flip-card][data-state=down]').count()) === 4)
  await shot(page, 'flip')
  // 配對成功一對（記住位置）
  const faces = flipQ.items.map((i) => i.obj)
  const a0 = 0
  const mate = faces.findIndex((f, i) => f === faces[a0] && i !== a0)
  await card(page, a0).click()
  await card(page, mate).click()
  await page.waitForSelector(`[data-testid=flip-card][data-card="${a0}"][data-state=matched]`, { timeout: 3000 })
  check('翻到一樣的兩張：留在原地（matched），語音說一樣', (await card(page, mate).getAttribute('data-state')) === 'matched' && (await spoken(page)).some((t) => ['一樣！找到了！', '配對成功！', '哇，一樣的！'].includes(t)))
  // 翻錯兩次（2 對的牌，2 次翻錯算一次答錯）：先剩下的兩對各翻一張
  // 剩下兩張一樣的，無法再翻錯；所以重新開始這題來測翻錯
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')
  const flipQ2 = find((q) => q.type === 'flip' && q.difficulty === 1, 1)
  await seed(page, { ids: [flipQ2.id, flipQ2.id, flipQ2.id, flipQ2.id, flipQ2.id], station: 1, levels: { observe: 1 } })
  const f2 = flipQ2.items.map((i) => i.obj)
  const mis = [0, f2.findIndex((f) => f !== f2[0])]
  await card(page, mis[0]).click()
  await card(page, mis[1]).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=flip-card][data-state=up]').length === 0, null, { timeout: 3000 })
  check('翻到不一樣的兩張：過一下蓋回去，還不算答錯（翻牌本來就會翻錯）', (await stageOf(page)) === '0' && (await page.locator('[data-testid=flip-card][data-state=down]').count()) === 4)
  await card(page, mis[0]).click()
  await card(page, mis[1]).click()
  await page.waitForFunction(() => document.querySelector('[data-testid=question]')?.dataset.peek === 'true', null, { timeout: 3000 })
  check('翻錯第 2 次：算一次答錯，提示階梯 1，所有牌亮一下讓孩子記住', (await stageOf(page)) === '1' && (await page.locator('[data-testid=flip-card][data-state=up]').count()) === 4 && (await spoken(page)).includes(flipQ2.hint))
  await shot(page, 'flip-peek')
  await page.waitForFunction(() => document.querySelector('[data-testid=question]')?.dataset.peek !== 'true', null, { timeout: 4000 })
  await card(page, mis[0]).click()
  await card(page, mis[1]).click()
  await page.waitForTimeout(1100)
  await card(page, mis[0]).click()
  await card(page, mis[1]).click()
  await page.waitForFunction(() => document.querySelector('[data-testid=question]')?.dataset.peek === 'true', null, { timeout: 3000 })
  check('再翻錯 2 次：提示階梯 2，一對一樣的牌一直發光', (await stageOf(page)) === '2')
  await page.waitForFunction(() => document.querySelector('[data-testid=question]')?.dataset.peek !== 'true', null, { timeout: 4000 })
  check('提示階梯 2：蓋著的那一對一樣的牌在發光', (await page.locator('.flp-card.hint').count()) >= 2)
  await solveFlip(page, flipQ2)
  await page.waitForSelector('[data-testid=next-question]')
  const [fa] = await dump(page, 'attempts')
  check('全部配對完：答對；作答紀錄是 flip、不是獨立答對、用過 2 次提示', fa?.interaction === 'flip' && fa.firstTryCorrect === false && fa.hintsUsed === 2, JSON.stringify(fa))

  // --- 完整的一站（排序、放位置、翻牌、比大小、位置圖）並結算 ---
  await seed(page, { ids: [order.id, placeQ.id, flipQ.id, bigger.id, where.id], station: 2, levels: { measure: 2, space: 3, observe: 1 } })
  const wrongTypes = []
  for (let i = 0; i < 5; i++) {
    const q = BANK[await qid(page)]
    if (i === 3) {
      // 比大小答錯一次：提示時每張卡出現虛線框，標出最大的
      await choice(page, q.choices.find((c) => c.id !== q.answer).id).click()
      await page.waitForTimeout(150)
      check('比大小（長短）答錯：提示階梯 1，每張卡出現虛線框比長短', (await stageOf(page)) === '1' && (await page.locator('.mz-ghost').count()) === q.choices.length && (await spoken(page)).includes(q.hint))
      await shot(page, 'bigger-hint')
      wrongTypes.push('bigger')
    }
    if (i === 4) {
      await choice(page, q.choices.find((c) => c.id !== q.answer).id).click()
      await page.waitForTimeout(150)
      check('看圖找位置答錯：提示階梯 1，每張圖下面標出位置的字', (await stageOf(page)) === '1' && (await page.locator('.sc-word').count()) === q.choices.length)
      await shot(page, 'where-hint')
      wrongTypes.push('where')
    }
    await solve(page, q, { tap: i === 1 })
    if (i < 4) await next(page)
    else await next(page, true)
  }
  await page.waitForSelector('[data-testid=station-result]', { timeout: 10000 })
  const att = (await dump(page, 'attempts')).sort((x, y) => x.at - y.at)
  check('一站完成：5 筆紀錄，互動方式依序是 dragOrder、place、flip、pick、pick；答錯過的是「不是獨立答對」', att.length === 5 && att.map((a) => a.interaction).join() === 'dragOrder,place,flip,pick,pick' && att.filter((a) => !a.firstTryCorrect).length === 2 && att.filter((a) => a.firstTryCorrect && a.hintsUsed === 0).length === 3, att.map((a) => `${a.interaction}:${a.firstTryCorrect}`).join())
  check('結算畫面：本站 5 題中 3 題自己想出來', (await page.getByTestId('result-credit').innerText()).includes('3'))
  await page.getByTestId('back-to-map').click()

  // ================= 家長報告 =================
  await page.goto(BASE)
  await page.waitForSelector('[data-testid=room]')
  await openParentTab(page, '學習報告')
  await page.waitForSelector('[data-testid=learning-report]')
  const math = page.getByTestId('report-subject-math')
  const rows = []
  for (const s of ['measure', 'space', 'observe']) rows.push(await math.locator(`[data-skill=${s}]`).count())
  check('家長報告（數學）列出三個新技能：比較與排序、空間方位、觀察與記憶，和原本三個技能', (await math.locator('[data-skill]').count()) === 6 && rows.every((n) => n === 1) && (await math.innerText()).includes('比較與排序') && (await math.innerText()).includes('空間方位') && (await math.innerText()).includes('觀察與記憶'))
  const counts = {}
  for (const s of ['measure', 'space', 'observe']) counts[s] = Number((await page.getByTestId(`count-${s}`).innerText()).match(/^(\d+)/)[1])
  const attAll = await dump(page, 'attempts')
  check('新技能的作答題數和資料庫一致（報告是真的，不是寫死的）', ['measure', 'space', 'observe'].every((s) => counts[s] === attAll.filter((a) => a.skill === s && Date.now() - a.at < 7 * 86400000).length) && counts.measure === 2 && counts.space === 2 && counts.observe === 1, JSON.stringify(counts))
  check('報告裡每個新技能都有目前難度的白話描述', (await math.locator('[data-skill=measure] .lt-level').innerText()).includes('目前難度') && (await math.locator('[data-skill=space] .lt-level').innerText()).includes('目前難度'))
  await shot(page, 'report')

  // ================= 快閃記憶、什麼不見了、找不一樣、排隊位置、看場景選文字 =================
  const recall = find((q) => q.type === 'recall' && q.difficulty === 2)
  const gone = find((q) => q.type === 'gone' && q.difficulty === 3)
  const spot = find((q) => q.type === 'spot' && q.difficulty === 3 && q.choices.length === 5)
  const row = find((q) => q.type === 'row' && q.params.pos === 'nth')
  const whereIs = find((q) => q.type === 'whereIs' && q.difficulty === 3)
  await seed(page, { ids: Array(5).fill(recall.id), station: 1, doneBefore: 0, levels: { observe: 2 } })
  // recall：東西亮著時選項藏起來；亮完蓋住，選項出現
  check('快閃記憶：東西亮著的時候選項先藏起來（靠記憶，不是對照）', (await page.locator('[data-testid=question] .qv-choices').getAttribute('data-hidden')) === 'true' && (await page.getByTestId('recall-stem').getAttribute('data-covered')) === null)
  await shot(page, 'recall-show')
  await page.waitForSelector('[data-testid=recall-stem][data-covered=true]', { timeout: 6000 })
  check('東西蓋起來之後，選項出現，有「再看一下」按鈕', (await page.locator('[data-testid=question] .qv-choices').getAttribute('data-hidden')) === null && (await page.getByTestId('flash-again').count()) === 1 && (await choice(page, recall.choices[0].id).isVisible()))
  await shot(page, 'recall-covered')
  await page.getByTestId('flash-again').click()
  await page.waitForTimeout(120)
  check('按「再看一下」：東西再亮一次，選項又藏起來', (await page.getByTestId('recall-stem').getAttribute('data-covered')) === null && (await page.locator('[data-testid=question] .qv-choices').getAttribute('data-hidden')) === 'true')
  await page.waitForSelector('[data-testid=recall-stem][data-covered=true]', { timeout: 6000 })
  await choice(page, recall.choices.find((c) => c.id !== recall.answer).id).click()
  await page.waitForTimeout(150)
  check('快閃記憶答錯：提示階梯 1，東西再亮出來給孩子看', (await stageOf(page)) === '1' && (await page.getByTestId('recall-stem').getAttribute('data-covered')) === null && (await page.locator('[data-testid=recall-stem] .rw-cell').count()) === recall.items.length)
  await solvePick(page, recall)
  // gone
  await seed(page, { ids: Array(5).fill(gone.id), station: 1, doneBefore: 0, levels: { observe: 3 } })
  await page.waitForSelector('[data-testid=gone-stem]')
  check('什麼不見了：先看一排東西（3 個）', (await page.getByTestId('gone-stem').getAttribute('data-phase')) === 'show' && (await page.locator('[data-testid=gone-stem] .rw-cell').count()) === 3 && (await page.locator('[data-testid=question] .qv-choices').getAttribute('data-hidden')) === 'true')
  await page.waitForSelector('[data-testid=gone-stem][data-phase=cover]', { timeout: 8000 })
  await page.waitForSelector('[data-testid=gone-stem][data-phase=after]', { timeout: 4000 })
  check('蓋起來再顯示：少了一個（問號格子），這時選項才出現', (await page.locator('[data-testid=gone-stem] .rw-cell.hole').count()) === 1 && (await page.locator('[data-testid=question] .qv-choices').getAttribute('data-hidden')) === null)
  await shot(page, 'gone-after')
  await solvePick(page, gone)
  // spot
  await seed(page, { ids: Array(5).fill(spot.id), station: 1, doneBefore: 0, levels: { observe: 3 } })
  check('找不一樣：5 張卡，其中一張的顏色或方向不同', (await page.locator('[data-testid=choice]').count()) === 5)
  await shot(page, 'spot')
  await choice(page, spot.choices.find((c) => c.id !== spot.answer).id).click()
  await page.waitForTimeout(150)
  check('找不一樣答錯：提示階梯 1（卡片一張一張亮起來比一比）', (await stageOf(page)) === '1' && (await page.locator('.sp-choices.scan').count()) === 1)
  await solvePick(page, spot)
  // row
  await seed(page, { ids: Array(5).fill(row.id), station: 1, doneBefore: 0, levels: { space: 4 } })
  check('排隊的位置：題幹一排東西，選項是排隊的那幾個', (await page.locator('[data-testid=row-stem] .rw-cell').count()) === row.items.length && (await page.locator('[data-testid=choice]').count()) === row.items.length)
  await choice(page, row.choices.find((c) => c.id !== row.answer).id).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=row-stem] .pile-num').length > 0, null, { timeout: 4000 })
  check('排隊位置答錯：一個一個數出數字', (await stageOf(page)) === '1')
  await solvePick(page, row)
  // whereIs
  await seed(page, { ids: Array(5).fill(whereIs.id), station: 1, doneBefore: 0, levels: { space: 3 } })
  const chips = await page.locator('[data-testid=choice]').allInnerTexts()
  check('看場景選文字：兩個選項是「左邊」「右邊」（難度 3 才有左右），有場景圖', chips.join('').includes('左邊') && chips.join('').includes('右邊') && (await page.getByTestId('whereis-scene').count()) === 1)
  await shot(page, 'whereis')
  await solvePick(page, whereIs)

  // ================= 每日冒險納入新技能 =================
  await page.goto(BASE)
  await page.waitForSelector('[data-testid=room]')
  await openMap(page)
  await page.getByTestId('chapter-huaguoshan').click()
  await page.waitForFunction(() => !!window.__debug, null, { timeout: 5000 })
  const dailySkills = new Set()
  const dailyKinds = new Set()
  const perDay = []
  for (let d = 0; d < 6; d++) {
    await page.getByTestId('daily-go').click()
    await page.waitForSelector('[data-testid=question]')
    const plan = (await settings(page)).stageDraft.plan.map((p) => BANK[p.id])
    for (const q of plan) {
      dailySkills.add(q.skill)
      dailyKinds.add(q.interaction ?? 'pick')
    }
    perDay.push([...new Set(plan.map((q) => q.skill))].sort().join('+'))
    // 看一下這一天的第一題能不能正常顯示（不管哪種題型），再離開
    check(`每日冒險第 ${d + 1} 天：5 題、${plan.length === 5 ? '五個不同技能' : ''}`, plan.length === 5 && new Set(plan.map((q) => q.skill)).size === 5)
    await page.getByTestId('leave').click()
    await page.getByTestId('leave-go').click()
    await page.waitForSelector('[data-testid=map]')
    await page.evaluate(() => window.__debug.advanceDays(1))
    await page.waitForFunction(() => document.querySelector('[data-testid=daily-card]')?.dataset.done === '0')
  }
  check('連續 6 天的每日冒險：新技能（比較與排序、空間方位、觀察與記憶）都出現過，第 1 章技能也都在', ['measure', 'space', 'observe', 'number', 'classify', 'pattern'].every((s) => dailySkills.has(s)), [...dailySkills].join())
  check('每日冒險每天組合不同（缺的技能每天輪流）', new Set(perDay).size >= 3, perDay.join(' | '))
  check('每日冒險出現新的互動（排序、放到位置或翻牌）', ['dragOrder', 'place', 'flip'].some((k) => dailyKinds.has(k)), [...dailyKinds].join())

  // ================= 幼幼模式（3 歲） =================
  const gSpot = findG((q) => q.type === 'spot')
  const gBigger = findG((q) => q.type === 'bigger')
  const gPlace = findG((q) => q.type === 'place')
  await seed(page, { ids: [gSpot.id, gBigger.id, gPlace.id, gSpot.id, gBigger.id], station: 1, doneBefore: 0, ageBand: '3', levels: { observe: 1, measure: 1, space: 1 } })
  check('幼幼：找不一樣一張都不縮（3 張，不然分不出誰不一樣）', (await page.locator('[data-testid=choice]').count()) === 3)
  await solvePick(page, gSpot)
  await next(page)
  check('幼幼：比大小縮成 2 選 1', (await page.locator('[data-testid=choice]').count()) === 2)
  await solvePick(page, gBigger)
  await next(page)
  check('幼幼：放到位置只有上、下 2 個位置', (await page.locator('[data-testid=place-zone]').count()) === 2)
  const wz = gPlace.params.zones.find((z) => z.id !== gPlace.params.target).id
  await page.getByTestId('place-item').click()
  await zone(page, wz).click()
  await page.waitForTimeout(150)
  check('幼幼：放錯一次就直接示範（提示階梯 2，正確位置發光）', (await stageOf(page)) === '2' && (await zone(page, gPlace.params.target).getAttribute('class')).includes('demo'))
  await solvePlace(page, gPlace, { tap: true })

  // ================= 語音開關 =================
  await idb(page, (db) => new Promise((res) => {
    const tx = db.transaction('settings', 'readwrite')
    tx.objectStore('settings').get('main').onsuccess = (e) => tx.objectStore('settings').put({ ...e.target.result, voiceOn: false })
    tx.oncomplete = () => res(1)
  }))
  const quiet = find((q) => q.type === 'place' && q.difficulty === 1)
  await seed(page, { ids: Array(5).fill(quiet.id), station: 1, doneBefore: 0, levels: { space: 1 } })
  await page.evaluate(() => (window.__spoken.length = 0))
  const qz = quiet.params.zones.find((z) => z.id !== quiet.params.target).id
  await page.getByTestId('place-item').click()
  await zone(page, qz).click()
  await page.waitForTimeout(400)
  check('語音開關關掉：放錯位置也不會出聲（只有字幕）', (await stageOf(page)) === '1' && (await spoken(page)).length === 0)

  check('整段流程沒有頁面錯誤或 console 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
} finally {
  await browser.close()
}

console.log(state.failed === 0 ? '\n全部通過' : `\n${state.failed} 項失敗`)
process.exit(state.failed === 0 ? 0 : 1)
