// 生活與禮儀、自然常識兩個科目 E2E（v6 線 B）：
//   科目分頁（四個科目）；生活：指定題目玩一站（說謝謝對不起要唸出來、好不好的提示說明為什麼、紅綠燈、步驟排序、為什麼），
//   再玩一站自然抽的題（答錯提示）；自然：指定題目玩一站（天氣要帶什麼、動物住哪裡、拖曳「動物的家」、排序「植物生長」、什麼季節下雪）；
//   兩科的每日冒險與徽章、缺圖時的備援（emoji + 文字）、家長報告出現兩科、章末寶箱；三種尺寸截圖。
// 做法：直接把「這一站的題目清單」寫進 settings.stageDraft，再從地圖進站，就能指定題型。
// 用法：先啟動 dev server（pnpm exec vite --port 5183 --strictPort），再 BASE_URL=http://localhost:5183 node scripts/e2e-life.mjs
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, center, drag, freshApp, idb, launch, makeChecker, openParentTab } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BANK = Object.fromEntries(
  ['number', 'classify', 'pattern', 'english', 'life', 'nature'].flatMap((f) => JSON.parse(readFileSync(join(ROOT, `src/learning/content/${f}.json`), 'utf8'))).map((q) => [q.id, q]),
)
const ALL = Object.values(BANK)
const SHOTS = join(ROOT, 'design/screens')
mkdirSync(SHOTS, { recursive: true })
const { state, check } = makeChecker()
const SIZES = { land: { width: 1024, height: 768 }, port: { width: 768, height: 1024 }, phone: { width: 375, height: 812 } }

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
const clearSpoken = (page) => page.evaluate(() => (window.__spoken.length = 0))
const shot = async (page, name, size) => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(SHOTS, `v6-life-${name}-${size}.png`) })
}
const dump = (page, store) => idb(page, (db, s) => new Promise((r) => (db.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result))), store)
const progressOf = async (page, id) => (await dump(page, 'progress')).find((p) => p.chapterId === id)

/** 找一題：pred 條件、第 n 個 */
const pickQ = (pred, n = 0) => {
  const q = ALL.filter(pred)[n]
  if (!q) throw new Error('找不到符合條件的題目')
  return q
}
const filler = (skill, from = 0) => ALL.filter((q) => q.skill === skill && q.difficulty === 1 && !q.gentle).slice(from, from + 4).map((q) => q.id)

let sess = 0
/** 把這一站的題目清單寫進 settings.stageDraft（可同時改年齡、技能難度），再從地圖進站 */
async function pin(page, subject, chapterId, station, ids, { age, skills = {} } = {}) {
  const sessionId = `e2e-life-${++sess}-${Date.now()}`
  await idb(
    page,
    (db, o) =>
      new Promise((res) => {
        const tx = db.transaction(['settings', 'skillState'], 'readwrite')
        const st = tx.objectStore('settings')
        st.get('main').onsuccess = (e) => {
          const next = { ...e.target.result, stageDraft: { chapterId: o.chapterId, station: o.station, run: 1, sessionId: o.sessionId, plan: o.ids.map((id) => ({ id, review: false, followUp: false })), savedAt: Date.now() } }
          if (o.age) next.ageBand = o.age
          next.seenIntros = ['tapN', 'dragSort']
          st.put(next)
        }
        for (const [skill, difficulty] of Object.entries(o.skills)) {
          tx.objectStore('skillState').put({ skill, difficulty, recent: [], stationStreak: 0, mastered: {}, updatedAt: Date.now(), total: 50 })
        }
        tx.oncomplete = () => res(1)
      }),
    { chapterId, station, sessionId, ids, age, skills },
  )
  await page.evaluate(() => (location.hash = 'map'))
  await page.reload()
  await page.waitForSelector('[data-testid=map]')
  await page.getByTestId(`subject-${subject}`).click()
  await page.getByTestId(`station-${station}`).click()
  await page.waitForSelector('[data-testid=question]')
  return sessionId
}
/** 把技能難度設回指定值（並清掉站內草稿） */
async function resetSkills(page, skills) {
  await idb(
    page,
    (db, o) =>
      new Promise((res) => {
        const tx = db.transaction(['skillState', 'settings'], 'readwrite')
        for (const [skill, difficulty] of Object.entries(o)) tx.objectStore('skillState').put({ skill, difficulty, recent: [], stationStreak: 0, mastered: {}, updatedAt: Date.now(), total: 50 })
        tx.objectStore('settings').get('main').onsuccess = (e) => tx.objectStore('settings').put({ ...e.target.result, stageDraft: undefined })
        tx.oncomplete = () => res(1)
      }),
    skills,
  )
}
const qid = async (page) => {
  await page.waitForSelector('[data-testid=question]')
  return page.locator('[data-testid=question]').getAttribute('data-question-id')
}
const hintStage = (page) => page.locator('[data-testid=question]').getAttribute('data-hint-stage')
const sub = async (page) => (await page.getByTestId('subtitle').innerText()).trim()
const wrongId = (q) => q.choices.find((c) => c.id !== q.answer).id
const choice = (page, id) => page.locator(`[data-testid=choice][data-choice-id="${id}"]`)
/** 點選項；v7.3 起文字選項點一下就作答（喇叭鈕才唸字），這裡保留相容的二次點擊 */
async function clickChoice(page, id) {
  const loc = choice(page, id)
  await loc.click()
  await page.waitForTimeout(60)
  if ((await loc.getAttribute('data-armed')) === 'true') await loc.click()
}
const card = (page, id) => page.locator(`[data-testid=order-card][data-card="${id}"]`)

/** 解開目前這一題（依互動方式） */
async function solveCurrent(page, q, { wrongFirst = false } = {}) {
  if (q.interaction === 'dragSort') {
    for (let i = 0; i < q.items.length; i++) await drag(page, await center(page, `[data-testid=sort-item][data-item="${i}"]`), await center(page, `[data-testid=sort-bin][data-bin="${q.params.targets[i]}"]`), { settle: 120 })
    await page.waitForSelector('.adv-bubble.ok')
  } else if (q.interaction === 'stepOrder') {
    const order = q.params.order
    for (let i = 0; i < order.length; i++) await drag(page, await center(page, `[data-testid=order-card][data-card="${order[i]}"]`), await center(page, `[data-testid=order-slot][data-slot="${i}"]`), { settle: 120 })
    await page.waitForSelector('.adv-bubble.ok')
  } else {
    if (wrongFirst) {
      await clickChoice(page, wrongId(q))
      await page.waitForTimeout(150)
    }
    await clickChoice(page, q.answer)
    await page.waitForSelector(`[data-testid=choice][data-choice-id="${q.answer}"][data-state=right]`)
  }
}
async function next(page) {
  const old = await qid(page)
  await page.getByTestId('next-question').click()
  await page.waitForFunction((o) => {
    const el = document.querySelector('[data-testid=question]')
    return !el || el.dataset.questionId !== o
  }, old, { timeout: 10000 })
}
/** 玩完一站（5 題）。wrongAt：這幾題先答錯一次。回傳題目 id */
async function playAll(page, { wrongAt = [] } = {}) {
  const seen = []
  for (let i = 0; i < 5; i++) {
    const q = BANK[await qid(page)]
    seen.push(q.id)
    await solveCurrent(page, q, { wrongFirst: wrongAt.includes(i) })
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
const hscroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

const browser = await launch()
try {
  const { ctx, page, errors } = await freshApp(browser, SIZES.land)
  await ctx.addInitScript(SPEECH_STUB)
  await page.reload()
  await page.waitForSelector('[data-testid=room]')

  // ---------- 科目分頁 ----------
  await openMap(page)
  const tabs = await page.locator('.adv-subject').allInnerTexts()
  check('地圖上方有四個科目分頁：數學、英文、生活、自然（圖示加文字）', tabs.length === 4 && ['數學', '英文', '生活', '自然'].every((n, i) => tabs[i].includes(n)) && (await page.locator('.adv-subject-glyph').count()) === 4, tabs.join('|'))
  await page.getByTestId('subject-life').click()
  check('切到生活：生活小鎮 5 站、寶箱；站名和別的科目不同；只有第 1 站可以出發', (await page.getByTestId('map').getAttribute('data-subject')) === 'life' && (await page.locator('.adv-map-hero').innerText()).includes('生活小鎮') && (await page.locator('.adv-node-label').allInnerTexts()).join().includes('洗手台') && (await page.getByTestId('chest-node').count()) === 1 && (await page.locator('[data-station-state=current]').count()) === 1 && (await page.locator('[data-station-state=locked]').count()) === 4)
  await page.getByTestId('subject-nature').click()
  check('切到自然：自然森林 5 站、寶箱', (await page.getByTestId('map').getAttribute('data-subject')) === 'nature' && (await page.locator('.adv-map-hero').innerText()).includes('自然森林') && (await page.locator('.adv-node-label').allInnerTexts()).join().includes('小花園') && (await page.getByTestId('chest-node').count()) === 1)
  check('每個科目都有今日冒險卡片（還沒玩）', (await page.getByTestId('daily-card').getAttribute('data-done')) === '0')
  check('四個分頁在版面內，頁面不會橫向捲動', await hscroll(page))
  await shot(page, 'map-nature', 'land')
  await page.getByTestId('subject-life').click()
  await shot(page, 'map-life', 'land')

  // ---------- 生活：指定題目玩一站（第 1 站；技能難度 3，五題都是難度 3，才不會被站中調整換掉） ----------
  const d = (skill, n) => ALL.filter((q) => q.skill === skill && q.difficulty === n && !q.gentle)
  const qSay = pickQ((q) => q.skill === 'life' && q.type === 'lifeSay' && q.difficulty === 3 && q.answer === 'sorry' && !q.gentle)
  const qStep = pickQ((q) => q.skill === 'life' && q.type === 'lifeStep' && q.difficulty === 3)
  const qStory = pickQ((q) => q.skill === 'life' && q.type === 'lifeOk' && q.difficulty === 3)
  const qOrder3 = pickQ((q) => q.skill === 'life' && q.type === 'lifeOrder' && q.difficulty === 3)
  const qStep2 = pickQ((q) => q.skill === 'life' && q.type === 'lifeStep' && q.difficulty === 3, 3)
  await pin(page, 'life', 'life-town', 1, [qSay.id, qStep.id, qStory.id, qOrder3.id, qStep2.id], { skills: { life: 3 } })
  check('生活站：章節是生活小鎮、科目是生活', (await page.getByTestId('stage').getAttribute('data-subject')) === 'life' && (await qid(page)) === qSay.id)

  // 1. 這時候要說什麼：文字選項附圖示，喇叭鈕唸字、點卡片直接作答
  const choices = page.locator('[data-testid=choice]')
  check('「要說什麼」：4 個選項（謝謝、對不起、請、不客氣），每個都有圖示和文字', (await choices.count()) === 4 && (await page.locator('.lw-icon').count()) === 4 && (await page.locator('.lw-text').allInnerTexts()).sort().join() === ['不客氣', '對不起', '謝謝', '請'].sort().join())
  const wrongW = qSay.choices.find((c) => c.id !== qSay.answer)
  // v7.3（G2）：文字選項比照數字題——卡片右上角有小喇叭（>= 56px），點喇叭只唸字、不作答；點卡片就直接作答（沒有兩段式）
  const speakers = await page.getByTestId('word-speak').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))
  check('每張文字卡右上角都有小喇叭，>= 56px', speakers.length === 4 && speakers.every(([w, h]) => w >= 56 && h >= 56), JSON.stringify(speakers))
  await clearSpoken(page)
  await page.locator(`[data-testid=word-speak][data-choice-id="${wrongW.id}"]`).click()
  await page.waitForTimeout(150)
  check('點喇叭：唸出這個字，不作答（卡片還是 idle、沒有提示）', (await spoken(page)).at(-1) === wrongW.text && (await choice(page, wrongW.id).getAttribute('data-state')) === 'idle' && (await hintStage(page)) === '0' && (await choice(page, wrongW.id).getAttribute('data-armed')) === null)
  await shot(page, 'say-speaker', 'land')
  await clearSpoken(page)
  await choice(page, wrongW.id).click()
  await page.waitForTimeout(250)
  check('點卡片一下就作答：答錯，提示說明為什麼', (await hintStage(page)) === '1' && (await sub(page)) === qSay.hint && (await spoken(page)).includes(qSay.hint), `${await sub(page)}`)
  await shot(page, 'say-hint', 'land')
  await clickChoice(page, qSay.answer)
  await page.waitForSelector('.adv-bubble.ok')
  await next(page)

  // 2. 步驟「要先做什麼」
  await solveCurrent(page, qStep)
  await next(page)

  // 3. 文字情境的好不好（沒有圖的情境用大 emoji 當題幹）
  check('「好不好」文字情境：題幹是一個大 emoji，問句是「阿悟這樣好不好呢？」', (await page.locator('[data-testid=lw-stem].lw-emoji').count()) === 1 && (await page.getByTestId('subtitle').innerText()).endsWith('阿悟這樣好不好呢？'))
  await solveCurrent(page, qStory)
  await next(page)

  // 4. 步驟排序（3 張）：放錯彈回去、提示；再依序拖進格子
  check('排序題：格子數 = 卡片數，卡片打散（不是一開始就排好）', (await page.getByTestId('order-slot').count()) === 3 && (await page.getByTestId('order-card').count()) === 3)
  const firstWrong = qOrder3.params.order[1]
  await clearSpoken(page)
  await drag(page, await center(page, `[data-testid=order-card][data-card="${firstWrong}"]`), await center(page, '[data-testid=order-slot][data-slot="0"]'), { settle: 150 })
  check('把第 2 步放進第 1 格：彈回去、提示（hint stage 1）、唸「這個還不是喔」', (await hintStage(page)) === '1' && (await page.locator('[data-testid=order-card].bounce').count()) === 1 && (await page.getByTestId('order-placed').count()) === 0 && (await spoken(page)).includes('這個還不是喔，再想想看。'))
  await shot(page, 'order-wrong', 'land')
  await solveCurrent(page, qOrder3)
  check('依序放對：3 格都有卡片、題目答對', (await page.getByTestId('order-placed').count()) === 3)
  await shot(page, 'order-done', 'land')
  await next(page)

  // 5. 最後一題
  await solveCurrent(page, qStep2)
  await page.getByTestId('next-question').click()
  await page.waitForSelector('[data-testid=station-result]', { timeout: 10000 })
  check('生活站結算：第 1 站過關、生活小鎮', (await page.locator('.adv-result-card h1').innerText()).includes('第 1 站') && (await page.locator('.adv-result-card .adv-sub').first().innerText()).includes('生活小鎮'))
  let attempts = (await dump(page, 'attempts')).filter((a) => a.skill === 'life')
  check('作答紀錄：5 筆生活，答錯過的 2 題不算獨立答對；排序題有記錄互動方式', attempts.length === 5 && attempts.filter((a) => a.firstTryCorrect && a.hintsUsed === 0).length === 3 && attempts.some((a) => a.interaction === 'stepOrder'), `${attempts.length}`)
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=map]')

  // 另外幾種題型（難度 2、4）：只看第一題的畫面，不用玩完
  const qOk = pickQ((q) => q.skill === 'life' && q.params?.fact === 'ok:life-dirty-hands:no')
  await pin(page, 'life', 'life-town', 2, [qOk.id, ...d('life', qOk.difficulty).filter((q) => q.id !== qOk.id).slice(0, 4).map((q) => q.id)], { skills: { life: qOk.difficulty } })
  check('「好不好」題：題幹是圖（手髒髒的阿悟），問句溫和（阿悟這樣好不好呢？），兩個選項（好、不好）', (await page.locator('[data-testid=lw-stem][data-art=life-dirty-hands]').count()) === 1 && (await page.getByTestId('subtitle').innerText()).endsWith('阿悟這樣好不好呢？') && (await choices.allInnerTexts()).map((t) => t.replace(/[^好不]/g, '')).sort().join() === '不好,好')
  await clearSpoken(page)
  await clickChoice(page, 'yes')
  await page.waitForTimeout(250)
  check('答「好」（不對）：提示是「手髒髒會有細菌跑進肚子，先洗手再吃喔。」，沒有責備的字眼', (await sub(page)) === '手髒髒會有細菌跑進肚子，先洗手再吃喔。' && !/壞|笨|不乖/.test(await sub(page)) && (await spoken(page)).includes('手髒髒會有細菌跑進肚子，先洗手再吃喔。'))
  await shot(page, 'ok-hint', 'land')
  await clickChoice(page, 'no')
  await page.waitForSelector('.adv-bubble.ok')
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')

  const qLight = pickQ((q) => q.params?.fact === 'light:red:stop')
  await pin(page, 'life', 'life-town', 2, [qLight.id, ...d('life', 2).filter((q) => q.id !== qLight.id).slice(0, 4).map((q) => q.id)], { skills: { life: 2 } })
  check('紅綠燈題：題幹是紅色的燈，選項是停下來等／往前走（附圖示）', (await page.locator('[data-testid=lw-stem].lw-lamp').count()) === 1 && (await page.locator('.lw-icon').count()) === 2)
  await shot(page, 'light', 'land')
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')

  const qWhy = pickQ((q) => q.type === 'lifeWhy' && q.params.fact === 'why:wash')
  await pin(page, 'life', 'life-town', 2, [qWhy.id, ...d('life', 4).filter((q) => q.id !== qWhy.id).slice(0, 4).map((q) => q.id)], { skills: { life: 4 } })
  check('為什麼題：3 個文字理由，每個附圖示', (await choices.count()) === 3 && (await page.locator('.lw-icon').count()) === 3)
  await shot(page, 'why', 'land')
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')
  await resetSkills(page, { life: 1, nature: 1 })
  await openMap(page)
  await page.getByTestId('subject-life').click()

  // ---------- 生活：第 2 站（系統抽題，難度 1：認圖與對的做法）；答錯的提示 ----------
  await page.getByTestId('station-2').click()
  await page.waitForSelector('[data-testid=question]')
  const q2 = BANK[await qid(page)]
  check('生活第 2 站由系統抽題：都是生活科，這一站有排序位置（難度 1 沒有排序題就退回點選）', q2.skill === 'life' && (await page.getByTestId('stage').getAttribute('data-subject')) === 'life')
  check('難度 1 的題是圖片選項（情境圖），點一下就作答', ['lifeSee', 'lifeRight'].includes(q2.type) && (await page.locator('[data-testid=choice] img.art, [data-testid=choice] .art-emoji, [data-testid=choice] .art-fallback').count()) >= 2)
  await shot(page, 'life-pics', 'land')
  await clearSpoken(page)
  await clickChoice(page, wrongId(q2))
  await page.waitForTimeout(250)
  check('答錯：提示就是這題的提示（說明原因），並唸出來；答錯的圖變灰', (await hintStage(page)) === '1' && (await sub(page)) === q2.hint && (await spoken(page)).includes(q2.hint) && (await choice(page, wrongId(q2)).getAttribute('data-state')) === 'wrong')
  await shot(page, 'life-pics-hint', 'land')
  await solveCurrent(page, q2)
  await next(page)
  for (let i = 1; i < 5; i++) {
    const qq = BANK[await qid(page)]
    await solveCurrent(page, qq)
    if (i < 4) await next(page)
    else await page.getByTestId('next-question').click()
  }
  await page.waitForSelector('[data-testid=station-result]', { timeout: 10000 })
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=map]')
  check('生活：已通關 2 / 5 站', (await page.locator('.adv-map-hero').innerText()).includes('已通關 2 / 5'))

  // ---------- 自然：指定題目玩一站（第 1 站；技能難度 3，五題都是難度 3） ----------
  const qBins2 = pickQ((q) => q.skill === 'nature' && q.type === 'bins' && q.difficulty === 3 && q.items.length >= 3)
  const qPlant = pickQ((q) => q.type === 'natOrder' && q.params.fact === 'order:plant')
  const qSeasonName = pickQ((q) => q.skill === 'nature' && q.type === 'natSeason' && q.difficulty === 3 && q.params.fact.startsWith('seasonName:'))
  const qTrait = pickQ((q) => q.skill === 'nature' && q.type === 'natAnimal' && q.difficulty === 3)
  const qSeasonFact = pickQ((q) => q.skill === 'nature' && q.type === 'natSeason' && q.difficulty === 3 && q.params.fact.startsWith('season:'))
  await pin(page, 'nature', 'nature-forest', 1, [qBins2.id, qSeasonName.id, qPlant.id, qTrait.id, qSeasonFact.id], { skills: { nature: 3 } })
  check('自然站：科目是自然', (await page.getByTestId('stage').getAttribute('data-subject')) === 'nature' && (await qid(page)) === qBins2.id)
  // 1. 動物的家（拖曳歸類）
  check('「動物的家」：籃子是大海／森林／農場（籃子上有場景圖），動物是要分類的東西', (await page.getByTestId('sort-bin').count()) === qBins2.params.bins.length && (await page.locator('.sort-bin-scene').count()) === qBins2.params.bins.length && (await page.getByTestId('sort-item').count()) === qBins2.items.length && (await page.locator('.sort-bin-head b').allInnerTexts()).every((t) => ['大海', '森林', '農場'].includes(t)))
  await shot(page, 'bins', 'land')
  const wrongBin = qBins2.params.bins.find((b) => b.id !== qBins2.params.targets[0]).id
  await drag(page, await center(page, '[data-testid=sort-item][data-item="0"]'), await center(page, `[data-testid=sort-bin][data-bin="${wrongBin}"]`), { settle: 150 })
  check('把第一隻動物拖進錯的家：彈回去、提示', (await page.getByTestId('sort-placed').count()) === 0 && (await hintStage(page)) === '1' && (await page.locator('.sort-item.bounce').count()) === 1)
  check('提示說明每個動物住哪裡', (await sub(page)) === qBins2.hint && /住在/.test(await sub(page)))
  for (let i = 0; i < qBins2.items.length; i++) {
    await drag(page, await center(page, `[data-testid=sort-item][data-item="${i}"]`), await center(page, `[data-testid=sort-bin][data-bin="${qBins2.params.targets[i]}"]`), { settle: 150 })
    check(`拖第 ${i + 1} 隻動物進牠的家：留在籃子裡（共 ${i + 1} 隻）`, (await page.getByTestId('sort-placed').count()) === i + 1)
  }
  await page.waitForSelector('.adv-bubble.ok')
  check('全部放對：答對', (await page.locator('.adv-bubble.ok').count()) === 1)
  await shot(page, 'bins-done', 'land')
  await next(page)
  // 2. 看圖選季節
  check('「哪一張是春天」類的題：選項是三張季節圖', (await page.locator('[data-testid=choice] .art, [data-testid=choice] .art-emoji, [data-testid=choice] .art-fallback').count()) === 3)
  await solveCurrent(page, qSeasonName)
  await next(page)
  // 3. 植物生長（排序）：用點的
  check('「植物生長」排序：3 張卡片（種子、發芽、開花，有圖）、3 個格子', (await page.getByTestId('order-slot').count()) === 3 && (await page.getByTestId('order-card').count()) === 3 && (await page.locator('.sto-card .sto-text').allInnerTexts()).sort().join() === ['發芽', '種子', '開花'].sort().join())
  await shot(page, 'plant-order', 'land')
  const wrongCard = qPlant.params.order[2]
  await card(page, wrongCard).click()
  await page.waitForTimeout(150)
  check('點「開花」放進第 1 格：不對，彈回去、提示', (await hintStage(page)) === '1' && (await page.getByTestId('order-placed').count()) === 0)
  await card(page, wrongCard).click()
  await page.waitForTimeout(150)
  check('再放錯一次：下一張該放的卡片和第 1 格發光（第二次提示）', (await hintStage(page)) === '2' && (await page.locator('.sto-card.demo').count()) === 1 && (await page.locator('.sto-slot.demo').count()) === 1)
  for (const id of qPlant.params.order) {
    await card(page, id).click()
    await page.waitForTimeout(120)
  }
  await page.waitForSelector('.adv-bubble.ok')
  check('依序點「種子、發芽、開花」：三格都填滿、答對', (await page.getByTestId('order-placed').count()) === 3)
  await shot(page, 'plant-done', 'land')
  await next(page)
  // 4. 動物特徵
  await solveCurrent(page, qTrait)
  await next(page)
  // 5. 什麼季節
  check('「什麼季節」特徵題：4 個季節選項，每個附圖示', (await page.getByTestId('choice').count()) === 4 && (await page.locator('.lw-icon').count()) === 4)
  await solveCurrent(page, qSeasonFact)
  await page.getByTestId('next-question').click()
  await page.waitForSelector('[data-testid=station-result]', { timeout: 10000 })
  check('自然站結算：第 1 站過關、自然森林', (await page.locator('.adv-result-card h1').innerText()).includes('第 1 站') && (await page.locator('.adv-result-card .adv-sub').first().innerText()).includes('自然森林'))
  attempts = (await dump(page, 'attempts')).filter((a) => a.skill === 'nature')
  check('作答紀錄：5 筆自然，拖曳歸類與排序也有記錄；答錯過的 2 題不算獨立答對', attempts.length === 5 && attempts.some((a) => a.interaction === 'dragSort') && attempts.some((a) => a.interaction === 'stepOrder') && attempts.filter((a) => a.firstTryCorrect && a.hintsUsed === 0).length === 3)
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=map]')

  // 其他自然題型（難度 2、4）：只看第一題的畫面
  const qBring = pickQ((q) => q.type === 'natBring' && q.answer === 'umbrella')
  await pin(page, 'nature', 'nature-forest', 2, [qBring.id, ...d('nature', 2).filter((q) => q.id !== qBring.id).slice(0, 4).map((q) => q.id)], { skills: { nature: 2 } })
  check('自然第 2 站：科目是自然', (await page.getByTestId('stage').getAttribute('data-subject')) === 'nature')
  check('「下雨要帶什麼」：題幹是天氣圖，3 個選項是雨傘、太陽眼鏡、外套（附圖示、沒有專屬素材也有 emoji）', (await page.locator('[data-testid=lw-stem]').count()) === 1 && (await page.locator('.lw-text').allInnerTexts()).sort().join() === ['外套', '太陽眼鏡', '雨傘'].sort().join() && (await page.locator('.lw-icon').count()) === 3)
  await shot(page, 'bring', 'land')
  await clickChoice(page, 'shades')
  await page.waitForTimeout(250)
  check('答錯（太陽眼鏡）：提示說明為什麼要帶雨傘', (await hintStage(page)) === '1' && (await sub(page)).includes('雨傘'))
  await clickChoice(page, 'umbrella')
  await page.waitForSelector('.adv-bubble.ok')
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')

  const qHome = pickQ((q) => q.type === 'natHome' && q.params.fact === 'home:obj-octopus')
  await pin(page, 'nature', 'nature-forest', 2, [qHome.id, ...d('nature', 2).filter((q) => q.id !== qHome.id).slice(0, 4).map((q) => q.id)], { skills: { nature: 2 } })
  check('「章魚住在哪裡」：題幹是章魚，選項是大海、森林、農場三張場景圖（附文字）', (await page.locator('[data-testid=lw-stem][data-art=obj-octopus]').count()) === 1 && (await page.locator('.lw-caption').allInnerTexts()).sort().join() === ['大海', '森林', '農場'].sort().join())
  await shot(page, 'home-pick', 'land')
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')

  const qSnow = pickQ((q) => q.params?.fact === 'snow:winter')
  await pin(page, 'nature', 'nature-forest', 2, [qSnow.id, ...d('nature', 4).filter((q) => q.id !== qSnow.id).slice(0, 4).map((q) => q.id)], { skills: { nature: 4 } })
  check('「什麼季節會下雪」：問的是「很冷很冷的地方」，4 個季節選項（春夏秋冬附圖示）', /很冷/.test(await sub(page)) && (await choices.count()) === 4 && (await page.locator('.lw-icon').count()) === 4)
  const nonWinter = qSnow.choices.find((c) => c.id !== 'winter').id
  await clickChoice(page, nonWinter)
  await page.waitForTimeout(250)
  check('答錯：提示說明冬天最冷、很冷的地方才下雪、台灣平地不太下雪', (await sub(page)).includes('平地'))
  await clickChoice(page, 'winter')
  await page.waitForSelector('.adv-bubble.ok')
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=map]')
  await resetSkills(page, { life: 1, nature: 1 })
  await openMap(page)
  await page.getByTestId('subject-nature').click()

  // ---------- 自然第 2 站（系統抽題，難度 1） ----------
  await page.getByTestId('station-2').click()
  await page.waitForSelector('[data-testid=question]')
  const n2 = BANK[await qid(page)]
  check('自然第 2 站由系統抽題：都是自然科，難度 1 是天氣、動物、動物的家、季節、植物生長（v7）', n2.skill === 'nature' && ['natWeather', 'natAnimal', 'natHome', 'natSeason', 'natPlant'].includes(n2.type))
  await shot(page, 'nature-pics', 'land')
  await clickChoice(page, wrongId(n2))
  await page.waitForTimeout(250)
  check('自然答錯：提示就是這題的提示', (await hintStage(page)) === '1' && (await sub(page)) === n2.hint)
  await solveCurrent(page, n2)
  await next(page)
  for (let i = 1; i < 5; i++) {
    const qq = BANK[await qid(page)]
    await solveCurrent(page, qq)
    if (i < 4) await next(page)
    else await page.getByTestId('next-question').click()
  }
  await page.waitForSelector('[data-testid=station-result]', { timeout: 10000 })
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=map]')

  // ---------- 各科進度互相獨立 ----------
  check('回地圖還是自然（記得最後選的科目），已通關 2 / 5', (await page.getByTestId('map').getAttribute('data-subject')) === 'nature' && (await page.locator('.adv-map-hero').innerText()).includes('已通關 2 / 5'))
  await page.getByTestId('subject-math').click()
  check('數學：還是已通關 0 / 5（互相獨立）', (await page.locator('.adv-map-hero').innerText()).includes('已通關 0 / 5'))
  await page.getByTestId('subject-english').click()
  check('英文：還是已通關 0 / 5', (await page.locator('.adv-map-hero').innerText()).includes('已通關 0 / 5'))
  const progs = await dump(page, 'progress')
  check('資料庫：生活與自然各自一列進度（各 2 站），數學與英文沒有', progs.find((p) => p.chapterId === 'life-town').stations.filter((s) => s.done).length === 2 && progs.find((p) => p.chapterId === 'nature-forest').stations.filter((s) => s.done).length === 2 && !progs.find((p) => p.chapterId === 'huaguoshan') && !progs.find((p) => p.chapterId === 'english-island'))
  const skills = await dump(page, 'skillState')
  check('技能難度各自獨立：生活與自然升級了，數學的三個技能與英文都沒有紀錄', skills.filter((s) => ['life', 'nature'].includes(s.skill)).length === 2 && skills.every((s) => ['life', 'nature'].includes(s.skill)))

  // ---------- 每日冒險（生活、自然） ----------
  // 把技能調到有排序、拖曳歸類題的難度，每日冒險的 5 個位置就會出現這些互動
  await idb(
    page,
    (db) =>
      new Promise((res) => {
        const tx = db.transaction(['skillState', 'settings'], 'readwrite')
        tx.objectStore('skillState').put({ skill: 'life', difficulty: 4, recent: [], stationStreak: 0, mastered: {}, updatedAt: Date.now(), total: 50 })
        tx.objectStore('skillState').put({ skill: 'nature', difficulty: 3, recent: [], stationStreak: 0, mastered: {}, updatedAt: Date.now(), total: 50 })
        tx.objectStore('settings').get('main').onsuccess = (e) => tx.objectStore('settings').put({ ...e.target.result, stageDraft: undefined })
        tx.oncomplete = () => res(1)
      }),
  )
  for (const [subject, name] of [['life', '生活'], ['nature', '自然']]) {
    await openMap(page)
    await page.getByTestId(`subject-${subject}`).click()
    const dc = page.getByTestId('daily-card')
    check(`${name}地圖有今日冒險卡片（還沒玩、沒有徽章）`, (await dc.getAttribute('data-done')) === '0' && (await dc.getAttribute('data-badge')) === 'false')
    await page.getByTestId('daily-go').click()
    await page.waitForSelector('[data-testid=question]')
    check(`${name}每日冒險：用關卡畫面，科目是${name}`, (await page.getByTestId('stage').getAttribute('data-daily')) === 'true' && (await page.getByTestId('stage').getAttribute('data-subject')) === subject)
    const ids = await playAll(page, { wrongAt: [1] })
    const kinds = new Set(ids.map((id) => BANK[id].interaction ?? 'pick'))
    check(`${name}每日冒險：5 題不重複、都是${name}題`, new Set(ids).size === 5 && ids.every((id) => BANK[id].skill === subject), ids.join())
    check(`${name}每日冒險有排序／拖曳歸類題（技能難度夠高時）`, subject === 'life' ? kinds.has('stepOrder') : kinds.has('dragSort') || kinds.has('stepOrder'), [...kinds].join())
    check(`${name}每日冒險：第一次完成拿到今日徽章、有材料`, (await page.getByTestId('daily-badge').count()) === 1 && (await page.getByTestId('reward-text').innerText()).includes('獲得'))
    await page.getByTestId('back-to-map').click()
    await page.waitForSelector('[data-testid=map]')
    check(`${name}：回地圖今日冒險顯示完成、徽章亮起`, (await dc.getAttribute('data-done')) === '1' && (await dc.getAttribute('data-badge')) === 'true')
  }
  const lifeDaily = await progressOf(page, 'daily:life')
  const natDaily = await progressOf(page, 'daily:nature')
  check('資料庫：生活與自然各自一份每日冒險（各 1 個徽章），不影響章節進度', lifeDaily.daily.badges.length === 1 && natDaily.daily.badges.length === 1 && (await progressOf(page, 'life-town')).stations.filter((s) => s.done).length === 2)

  // ---------- 章末寶箱 ----------
  await idb(
    page,
    (db) =>
      new Promise((res) => {
        const tx = db.transaction('progress', 'readwrite')
        tx.objectStore('progress').put({ chapterId: 'life-town', run: 1, stations: Array.from({ length: 5 }, () => ({ done: true, independent: 5, total: 5 })), chestClaimed: false, completedRuns: 0, updatedAt: Date.now() })
        tx.oncomplete = () => res(1)
      }),
  )
  await openMap(page)
  await page.getByTestId('subject-life').click()
  check('生活 5 站通關：寶箱可以開', (await page.getByTestId('chest-node').getAttribute('aria-label')) === '打開寶箱')
  await page.getByTestId('chest-node').click()
  await page.waitForSelector('[data-testid=ceremony]')
  check('生活寶箱儀式：標題是生活小鎮', (await page.locator('.adv-ceremony h1').innerText()).includes('生活小鎮'))
  await page.getByTestId('claim-chest').click()
  await page.waitForSelector('[data-testid=chest-rewards]')
  await page.getByTestId('back-to-map').click()
  await page.waitForSelector('[data-testid=run-complete]')
  check('寶箱打開後只有生活這一輪完成（自然的沒有）', (await progressOf(page, 'life-town')).chestClaimed === true && !(await progressOf(page, 'nature-forest')).chestClaimed)

  // ---------- 家長報告含兩科 ----------
  await page.goto(BASE)
  await page.waitForSelector('[data-testid=room]')
  await openParentTab(page, '學習報告')
  await page.waitForSelector('[data-testid=learning-report]')
  check('家長報告：生活禮儀、自然常識各有自己的一列（難度說明、題數）', (await page.locator('[data-skill=life]').count()) === 1 && (await page.locator('[data-skill=nature]').count()) === 1 && (await page.locator('[data-skill=life] .lt-level').innerText()).includes('目前難度') && (await page.locator('[data-skill=nature] .lt-level').innerText()).includes('目前難度'))
  const all = await dump(page, 'attempts')
  const lifeN = all.filter((a) => a.skill === 'life').length
  const natN = all.filter((a) => a.skill === 'nature').length
  check('報告的題數 = 資料庫作答筆數（生活、自然）', Number((await page.getByTestId('count-life').innerText()).match(/^(\d+) 題/)[1]) === lifeN && Number((await page.getByTestId('count-nature').innerText()).match(/^(\d+) 題/)[1]) === natN, `${lifeN}/${natN}`)
  check('報告依科目分組：生活、自然各一組，各只有一個技能', (await page.getByTestId('report-subject-life').locator('[data-skill]').count()) === 1 && (await page.getByTestId('report-subject-nature').locator('[data-skill]').count()) === 1 && (await page.getByTestId('report-subject-life').locator('h3').innerText()) === '生活' && (await page.getByTestId('report-subject-nature').locator('h3').innerText()) === '自然')
  check('報告：今日徽章 2 個（生活、自然各一）', (await page.getByTestId('report-badges').innerText()) === '2' && (await page.getByTestId('report-daily').innerText()).includes('生活 1') && (await page.getByTestId('report-daily').innerText()).includes('自然 1'))
  await shot(page, 'report', 'land')
  check('沒有 console 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()

  // ---------- 缺圖時的備援（emoji + 文字，版面不壞） ----------
  {
    const g = await freshApp(browser, SIZES.phone, { ctxOpts: { hasTouch: true, isMobile: true } })
    await g.ctx.route(/\/art\/(life|nat)-[a-z-]+\.png/, (r) => r.abort())
    await g.ctx.route(/\/art\/obj-(cow|bear|octopus)\.png/, (r) => r.abort())
    await g.ctx.addInitScript(SPEECH_STUB)
    const qPic = pickQ((q) => q.type === 'lifeRight' && q.difficulty === 1 && !q.gentle)
    const qHome2 = pickQ((q) => q.type === 'natHome' && q.params.fact === 'home:obj-bear')
    await pin(g.page, 'life', 'life-town', 1, [qPic.id, ...filler('life')])
    await g.page.waitForTimeout(500)
    check('缺圖：生活圖片選項顯示 emoji 備援，沒有破圖', (await g.page.locator('[data-testid=choice] .art-emoji').count()) === 2 && (await g.page.locator('[data-testid=choice] img').count()) === 0)
    check('缺圖：選項仍有文字說明（aria-label 是圖的內容），可以點選作答', (await choice(g.page, qPic.answer).getAttribute('aria-label')).length > 4)
    await shot(g.page, 'fallback-life', 'phone')
    await clickChoice(g.page, qPic.answer)
    await g.page.waitForSelector('.adv-bubble.ok')
    await g.page.getByTestId('leave').click()
    await g.page.getByTestId('leave-go').click()
    await g.page.waitForSelector('[data-testid=map]')
    await pin(g.page, 'nature', 'nature-forest', 1, [qHome2.id, ...filler('nature')])
    await g.page.waitForTimeout(500)
    check('缺圖：自然的題幹圖與場景圖都用 emoji，場景選項還有文字（大海、森林、農場）', (await g.page.locator('[data-testid=question] .art-emoji').count()) >= 4 && (await g.page.locator('.lw-caption').allInnerTexts()).sort().join() === ['大海', '森林', '農場'].sort().join())
    await shot(g.page, 'fallback-nature', 'phone')
    check('缺圖：頁面沒有橫向捲動、沒有 console 錯誤', (await hscroll(g.page)) && g.errors.length === 0, g.errors.join(' | '))
    await g.ctx.close()
  }

  // ---------- 三種尺寸截圖（也檢查沒有橫向捲動、沒有 console 錯誤） ----------
  const qs = {
    pics: pickQ((q) => q.type === 'lifeRight' && q.difficulty === 2 && !q.gentle),
    say: pickQ((q) => q.type === 'lifeSay' && !q.gentle && q.difficulty === 3 && q.choices.length === 4),
    sayArt: pickQ((q) => q.type === 'lifeSay' && !q.gentle && !!q.params.stem.art),
    order: pickQ((q) => q.type === 'lifeOrder' && q.difficulty === 4 && q.choices.length === 5),
    home: pickQ((q) => q.type === 'natHome' && q.params.fact === 'home:obj-cow'),
    bins: pickQ((q) => q.skill === 'nature' && q.type === 'bins' && q.params.bins.length === 3 && q.items.length >= 4),
    plant: pickQ((q) => q.type === 'natOrder' && q.params.fact === 'order:plant'),
    season: pickQ((q) => q.type === 'natSeason' && q.params.fact.startsWith('seasonPic:') && q.params.fact.endsWith('autumn')),
  }
  for (const [size, vp] of Object.entries(SIZES)) {
    const g = await freshApp(browser, vp, { ctxOpts: vp.width < 500 ? { hasTouch: true, isMobile: true } : {} })
    await g.ctx.addInitScript(SPEECH_STUB)
    await g.page.reload()
    await g.page.waitForSelector('[data-testid=room]')
    await openMap(g.page)
    await g.page.getByTestId('subject-life').click()
    await g.page.waitForTimeout(400)
    if (size !== 'land') await shot(g.page, 'map-life', size)
    await g.page.getByTestId('subject-nature').click()
    await g.page.waitForTimeout(400)
    if (size !== 'land') await shot(g.page, 'map-nature', size)
    check(`${size}：地圖四個科目分頁不橫向捲動`, await hscroll(g.page))
    const run = async (subject, chapterId, key, q, after) => {
      await pin(g.page, subject, chapterId, 1, [q.id, ...filler(subject)], { skills: { life: 4, nature: 4 } })
      await g.page.waitForTimeout(500)
      if (after) await after(g.page)
      await shot(g.page, key, size)
      check(`${size}：${key} 沒有橫向捲動`, await hscroll(g.page))
      // 離開這一站，下一題用新的 pin
      await g.page.getByTestId('leave').click()
      await g.page.getByTestId('leave-go').click()
      await g.page.waitForSelector('[data-testid=map]')
    }
    await run('life', 'life-town', 'life-pics', qs.pics)
    await run('life', 'life-town', 'life-say', qs.say, async (p) => {
      await p.locator('[data-testid=choice]').first().click() // 第一次點：打勾
      await p.waitForTimeout(200)
    })
    await run('life', 'life-town', 'life-say-art', qs.sayArt)
    await run('life', 'life-town', 'life-order', qs.order, async (p) => {
      const o = qs.order.params.order
      await card(p, o[1]).click() // 放錯一個：看提示樣子
      await p.waitForTimeout(250)
    })
    await run('nature', 'nature-forest', 'nature-home', qs.home)
    await run('nature', 'nature-forest', 'nature-bins', qs.bins)
    await run('nature', 'nature-forest', 'nature-plant', qs.plant, async (p) => {
      await card(p, qs.plant.params.order[0]).click()
      await p.waitForTimeout(300)
    })
    await run('nature', 'nature-forest', 'nature-season', qs.season)
    check(`${size}：沒有 console 錯誤`, g.errors.length === 0, g.errors.join(' | '))
    await g.ctx.close()
  }
} finally {
  await browser.close()
}

console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
