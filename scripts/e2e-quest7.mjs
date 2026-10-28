// v7 線 B「冒險與學習循環」E2E（Playwright）：答對星光、站末食物結算、章末寶箱、6–7 歲快速分級、挑戰站、圖鑑分頁與熟悉度、新地圖與直向節點全可見。
// 用法：BASE_URL=http://localhost:5191 node scripts/e2e-quest7.mjs
// 截圖存到 design/reviews/v7-quest-shots/（iPad 橫向 1180x820、直向 820x1180）。
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, idb, launch, makeChecker } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT = join(ROOT, 'src/learning/content')
const SHOTS = join(ROOT, 'design/reviews/v7-quest-shots')
mkdirSync(SHOTS, { recursive: true })
const BANK = Object.fromEntries(
  ['number', 'classify', 'pattern', 'measure', 'space', 'observe', 'english', 'life', 'nature'].flatMap((f) => JSON.parse(readFileSync(join(CONTENT, `${f}.json`), 'utf8'))).map((q) => [q.id, q]),
)
const { state, check } = makeChecker()
const LAND = { width: 1180, height: 820 }
const PORT = { width: 820, height: 1180 }
const shot = (page, name, tag) => page.screenshot({ path: join(SHOTS, `${tag}-${name}.png`) })

const dumpTable = (page, t) => idb(page, (db, t) => new Promise((r) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => r(e.target.result))), t)
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
const foodTotal = async (page) => (await dumpTable(page, 'inventory')).filter((i) => !i.id.startsWith('decor') && !i.id.startsWith('art') && !/^(wall|floor|theme)/.test(i.id)).reduce((a, b) => a + (['carrot', 'cookie', 'banana', 'apple', 'grape', 'milk', 'peach', 'riceball', 'watermelon', 'cake'].includes(b.id) ? b.qty : 0), 0)
const go = async (page, hash) => {
  await page.evaluate((h) => (location.hash = h), hash)
  await page.waitForTimeout(250)
}

/** 答一題選擇題（全部對）：回傳題目 */
async function solvePick(page, { wrongFirst = false } = {}) {
  await page.waitForSelector('[data-testid=question]')
  const qid = await page.locator('[data-testid=question]').getAttribute('data-question-id')
  const q = BANK[qid]
  if (wrongFirst) {
    const wrong = q.choices.find((c) => c.id !== q.answer)
    await page.locator(`[data-testid=choice][data-choice-id="${wrong.id}"]`).click()
    await page.waitForTimeout(150)
  }
  await page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`).click()
  return q
}
/** 按「下一題」並等換題；按不到（已經自動換題，機器忙時會發生）也沒關係。最後一題等結算畫面 */
async function nextQ(page, oldId) {
  await page.getByTestId('next-question').click({ timeout: 2500 }).catch(() => {})
  await page.waitForFunction((old) => {
    const el = document.querySelector('[data-testid=question]')
    return !el || el.dataset.questionId !== old
  }, oldId, { timeout: 10000 })
}

const browser = await launch()
try {
  // ================= 橫向：英文 → 星光、站末食物、章末寶箱 =================
  {
    const { ctx, page, errors } = await freshApp(browser, LAND)
    await go(page, 'map')
    await page.getByTestId('subject-english').click()
    await page.waitForSelector('[data-testid=station-1]')
    await shot(page, 'map-english', 'land')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.adv-scene')).backgroundImage.includes('scene-map'), null, { timeout: 5000 }).catch(() => {})
    const mapArt = await page.locator('.adv-scene').evaluate((el) => getComputedStyle(el).backgroundImage)
    check('英文地圖用自己的圖（scene-map-english）', mapArt.includes('scene-map-english'), mapArt.slice(0, 80))
    for (const sid of ['life', 'nature']) {
      await page.getByTestId(`subject-${sid}`).click()
      await page.waitForFunction((f) => getComputedStyle(document.querySelector('.adv-scene')).backgroundImage.includes(f), `scene-map-${sid}`, { timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(300)
      await shot(page, `map-${sid}`, 'land')
    }
    await page.getByTestId('subject-english').click()
    await page.getByTestId('station-1').click()
    const foodBefore = await foodTotal(page)
    const types = []
    let sparkSeen = 0
    let dotPopped = false
    for (let i = 0; i < 5; i++) {
      await page.waitForSelector('[data-testid=question]')
      const qid = await page.locator('[data-testid=question]').getAttribute('data-question-id')
      types.push(BANK[qid].type)
      if (i === 0) await page.waitForTimeout(400)
      const q = BANK[qid]
      await page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`).click()
      if (i === 0 || i === 1) {
        // 星光 3–5 顆，從卡片飛向頂端進度點
        const n = await page.waitForFunction(() => document.querySelectorAll('.q7-spark').length || 0, null, { timeout: 2000, polling: 30 }).then((h) => h.jsonValue()).catch(() => 0)
        sparkSeen = Math.max(sparkSeen, n)
        if (i === 0) { await page.waitForTimeout(250); await shot(page, 'sparks', 'land') }
        dotPopped ||= await page.waitForFunction(() => !!document.querySelector('.adv-dot.q7-pop'), null, { timeout: 2500, polling: 40 }).then(() => true).catch(() => false)
      }
      if (i === 0) await page.waitForSelector('[data-testid=next-question]')
      await nextQ(page, qid)
    }
    check('答對時有 3–5 顆星光飛起', sparkSeen >= 3 && sparkSeen <= 5, `n=${sparkSeen}`)
    check('頂端進度點彈一下', dotPopped)
    check('英文難度 1：一站不再全是聽英文（至少 2 種題型、同型 <= 2）', new Set(types).size >= 2 && Math.max(...Object.values(types.reduce((a, t) => ({ ...a, [t]: (a[t] ?? 0) + 1 }), {}))) <= 2, types.join(','))
    await page.waitForSelector('[data-testid=station-result]')
    await page.waitForTimeout(2600)
    const foods = await page.locator('[data-testid=result-food-item]').count()
    check('站末結算：先出現阿悟撿到的食物（全部獨立答對 = 2 個）', foods === 2, `n=${foods}`)
    const foodText = await page.getByTestId('food-text').innerText()
    check('結算顯示實際得到的食物名字與阿悟說的話', /阿悟撿到/.test(foodText) && /送給你/.test(await page.getByTestId('food-line').innerText()), foodText)
    const after = await foodTotal(page)
    check('背包裡的食物數量增加 2（直接進背包）', after - foodBefore === 2, `${foodBefore} -> ${after}`)
    const s = (await dumpTable(page, 'settings'))[0]
    check('站點掉落不再排進 pendingGifts', (s.pendingGifts ?? []).length === 0, JSON.stringify(s.pendingGifts))
    // 圖示動畫結束後停在固定位置：不消失、不壓字
    const layout = await page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect()
      const icons = [...document.querySelectorAll('[data-testid=result-food-item], .q7-mat')]
      const line = box(document.querySelector('[data-testid=food-line]'))
      const text = box(document.querySelector('[data-testid=reward-text]'))
      return {
        visible: icons.every((e) => Number(getComputedStyle(e).opacity) === 1 && e.getBoundingClientRect().width > 20),
        overlap: icons.some((e) => { const r = box(e); return r.bottom > line.top && r.top < line.bottom && r.right > line.left && r.left < line.right }) || icons.some((e) => { const r = box(e); return r.bottom > text.top + 2 && r.top < text.bottom - 2 && r.right > text.left && r.left < text.right }),
        n: icons.length,
      }
    })
    check('圖示停在畫面上（不消失）、沒壓到文字', layout.visible && !layout.overlap && layout.n >= 4, JSON.stringify(layout))
    await page.waitForTimeout(1800)
    const still = await page.locator('[data-testid=result-food-item]').count()
    check('幾秒後食物圖示還在原位', still === 2)
    await shot(page, 'station-result', 'land')

    // 玩完英文第一章：直接把前 4 站標成通關（資料層），第 5 站走完整流程後看寶箱
    await page.getByTestId('back-to-map').click()
    for (let st = 2; st <= 5; st++) {
      await page.getByTestId(`station-${st}`).click()
      for (let i = 0; i < 5; i++) {
        const q = await solvePick(page)
        await page.waitForSelector('[data-testid=next-question]')
        await nextQ(page, q.id)
      }
      await page.waitForSelector('[data-testid=station-result]')
      if (st < 5) await page.getByTestId('back-to-map').click()
    }
    await page.getByTestId('open-chest').click()
    await page.waitForSelector('[data-testid=ceremony]')
    await shot(page, 'chest-closed', 'land')
    await page.getByTestId('claim-chest').click()
    await page.waitForTimeout(450)
    check('章末寶箱：打開前先搖晃閃光', (await page.getByTestId('chest-wrap').getAttribute('data-shaking')) === 'true')
    await shot(page, 'chest-shaking', 'land')
    await page.waitForSelector('[data-testid=ceremony-title]')
    check('章末寶箱標題「英文小島通關！」', (await page.getByTestId('ceremony-title').innerText()).includes('英文小島通關'))
    await page.waitForTimeout(900)
    const rewardBox = await page.locator('.adv-cere-rewards').boundingBox()
    check('寶箱獎勵圖示放大（>= 100px）', rewardBox && rewardBox.height >= 100, JSON.stringify(rewardBox))
    const cere = await page.locator('[data-testid=ceremony]').boundingBox()
    const titleBox = await page.getByTestId('ceremony-title').boundingBox()
    check('寶箱畫面垂直置中，不是只用上半部', titleBox.y > cere.y + 150 && rewardBox.y + rewardBox.height > cere.height * 0.5, `title.y=${Math.round(titleBox.y)} rewards.bottom=${Math.round(rewardBox.y + rewardBox.height)}`)
    await shot(page, 'chest-open', 'land')
    check('沒有錯誤', errors.length === 0, errors.join(' | ').slice(0, 200))
    await ctx.close()
  }

  // ================= 橫向：6–7 歲快速分級、挑戰站、圖鑑 =================
  {
    const { ctx, page, errors } = await freshApp(browser, LAND)
    await patchSettings(page, { ageBand: '6-7' })
    await page.reload()
    await go(page, 'map')
    await page.waitForSelector('[data-testid=placement]', { timeout: 8000 })
    check('6–7 歲第一次進數學冒險：先出現快速分級', true)
    await shot(page, 'placement-ask', 'land')
    await page.getByTestId('placement-start').click()
    for (let i = 0; i < 3; i++) {
      await page.waitForSelector('[data-testid=placement-q] [data-testid=question]')
      const qid = await page.locator('[data-testid=placement-q] [data-testid=question]').getAttribute('data-question-id')
      const q = BANK[qid]
      if (i === 0) await shot(page, 'placement-q', 'land')
      check(`快速分級第 ${i + 1} 題是難度 3 的題`, q.difficulty === 3)
      await page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`).click()
      await page.waitForTimeout(1300)
    }
    await page.waitForSelector('[data-testid=placement-done]')
    const st = await dumpTable(page, 'skillState')
    check('全對 → 數學技能從難度 3 起跳', ['number', 'classify', 'pattern', 'measure', 'space', 'observe'].every((k) => st.find((r) => r.skill === k)?.difficulty === 3), JSON.stringify(st.map((r) => [r.skill, r.difficulty])))
    await page.getByTestId('placement-go').click()
    check('分級做完不再出現', (await page.getByTestId('placement').count()) === 0)
    await page.reload()
    await go(page, 'map')
    await page.waitForSelector('[data-testid=map]')
    await page.waitForTimeout(600)
    check('重新整理後不再問', (await page.getByTestId('placement').count()) === 0)
    check('6–7 歲可以直接選水簾洞（不必先打完花果山）', (await page.getByTestId('chapter-shuiliandong').getAttribute('data-open')) === 'true')
    check('挑戰站入口對 6–7 歲顯示', (await page.getByTestId('challenge-go').count()) === 1)
    await shot(page, 'map-math', 'land')

    // 挑戰站（英文，全選擇題）
    await page.getByTestId('subject-english').click()
    await page.getByTestId('challenge-go').click()
    await page.waitForSelector('[data-testid=stage][data-challenge=true]')
    check('挑戰站有連對計數', (await page.getByTestId('chain').getAttribute('data-chain')) === '0')
    let sawHint = false
    for (let i = 0; i < 8; i++) {
      const q = await solvePick(page, { wrongFirst: i === 1 })
      if (i === 1) {
        sawHint = (await page.locator('[data-testid=question]').getAttribute('data-hint-stage')) !== '0'
        check('答錯不給提示、連對歸零', !sawHint)
      }
      if (i === 0) {
        await page.waitForTimeout(200)
        check('答對後連對 = 1', (await page.getByTestId('chain').getAttribute('data-chain')) === '1')
        await shot(page, 'challenge', 'land')
      }
      await page.waitForSelector('[data-testid=next-question]')
      await nextQ(page, q.id)
    }
    await page.waitForSelector('[data-testid=station-result]')
    await page.waitForTimeout(2000)
    const credit = await page.getByTestId('result-credit').innerText()
    check('挑戰結算顯示最高連對（第 2 題之後連續 6 題）', /最高連對 6/.test(credit), credit)
    check('連對 >= 5 拿到章節徽章', (await page.getByTestId('challenge-badge').count()) === 1)
    await shot(page, 'challenge-result', 'land')
    await page.getByTestId('back-to-map').click()
    await page.waitForSelector('[data-testid=challenge-best]')
    check('地圖上的挑戰站顯示最高連對', (await page.getByTestId('challenge-best').innerText()).includes('6'))

    // 圖鑑：分頁、英文朋友、熟悉度
    await go(page, 'friends')
    await page.waitForSelector('[data-testid=friends-grid]')
    await page.getByTestId('friend-tab-english').click()
    const enKnown = await page.locator('[data-testid=friend][data-friend^="en:"][data-known=true]').count()
    check('圖鑑看得到英文朋友（答過的英文單字）', enKnown >= 3, `n=${enKnown}`)
    await shot(page, 'friends-english', 'land')
    // 把蘋果的答對次數灌到 10 次、香蕉 3 次（直接寫作歸紀錄），看金框與銀框
    const answeredBy = (obj, n) => Object.values(BANK).filter((q) => (q.interaction ?? 'pick') === 'pick' && !q.gentle && q.choices.find((c) => c.id === q.answer)?.obj === obj).slice(0, n)
    const fake = [...answeredBy('obj-apple', 10), ...answeredBy('obj-banana', 3)]
    check('題庫夠灌熟悉度', fake.length === 13, `n=${fake.length}`)
    await idb(page, (db, items) => new Promise((r) => {
      const s = db.transaction('attempts', 'readwrite').objectStore('attempts')
      items.forEach((it, i) => s.put({ id: `fake:${it.id}`, at: 1000 + i, questionId: it.id, skill: it.skill, difficulty: it.difficulty, firstTryCorrect: true, hintsUsed: 0, durationMs: 1, sessionId: `fake${i}` }))
      s.transaction.oncomplete = () => r(1)
    }), fake.map((q) => ({ id: q.id, skill: q.skill, difficulty: q.difficulty })))
    await page.reload()
    await go(page, 'friends')
    await page.getByTestId('friend-tab-food').click()
    const lvA = Number(await page.locator('[data-testid=friend][data-friend="obj-apple"]').getAttribute('data-level'))
    const lvB = Number(await page.locator('[data-testid=friend][data-friend="obj-banana"]').getAttribute('data-level'))
    check('熟悉度：答對 10 次 = 超級好朋友（金框）、答對 3 次 = 好朋友（銀框）', lvA === 3 && lvB === 2, `apple=${lvA} banana=${lvB}`)
    await shot(page, 'friends-levels', 'land')
    await page.locator('[data-testid=friend][data-friend="obj-apple"]').click()
    await page.waitForSelector('[data-testid=friend-view]')
    check('點朋友看得到熟悉度說明', (await page.getByTestId('friend-level').innerText()).includes('答對'))
    await shot(page, 'friend-view', 'land')
    await page.keyboard.press('Escape')
    check('圖鑑有章節徽章', (await page.locator('[data-testid=chapter-badges] .q7-badge').count()) === 1)
    check('沒有錯誤', errors.length === 0, errors.join(' | ').slice(0, 200))
    await ctx.close()
  }

  // ================= 直向：三張新地圖，所有節點都看得到 =================
  {
    const { ctx, page, errors } = await freshApp(browser, PORT)
    await go(page, 'map')
    for (const [sid, ch, file] of [
      ['english', 'english-island', 'scene-map-english'],
      ['life', 'life-town', 'scene-map-life'],
      ['nature', 'nature-forest', 'scene-map-nature'],
      ['math', 'huaguoshan', 'scene-map-huaguoshan'],
    ]) {
      await page.getByTestId(`subject-${sid}`).click()
      await page.waitForSelector(`[data-testid=map][data-chapter=${ch}]`)
      await page.waitForFunction((f) => getComputedStyle(document.querySelector('.adv-scene')).backgroundImage.includes(f), file, { timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(200)
      const bg = await page.locator('.adv-scene').evaluate((el) => getComputedStyle(el).backgroundImage)
      const vis = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const sc = document.querySelector('.adv-scroll')
        const out = [...document.querySelectorAll('.adv-node-btn')].map((b) => {
          const r = b.getBoundingClientRect()
          return r.left >= 0 && r.right <= vw && r.width >= 40
        })
        return { all: out.every(Boolean), n: out.length, scrollW: sc.scrollWidth, clientW: sc.clientWidth }
      })
      check(`直向 ${sid}：用自己的地圖（${file}）`, bg.includes(file), bg.slice(-60))
      check(`直向 ${sid}：6 個節點全部在畫面內、不需要橫向捲動`, vis.all && vis.n === 6 && vis.scrollW <= vis.clientW + 1, JSON.stringify(vis))
      await shot(page, `map-${sid}`, 'port')
    }
    await page.getByTestId('subject-math').click()
    await page.getByTestId('chapter-shuiliandong').click().catch(() => {})
    await patchSettings(page, { unlockedChapters: ['shuiliandong'] })
    await page.reload()
    await go(page, 'map')
    await page.getByTestId('subject-math').click()
    await page.getByTestId('chapter-shuiliandong').click()
    await page.waitForTimeout(400)
    const v2 = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth
      return [...document.querySelectorAll('.adv-node-btn')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= vw })
    })
    check('直向 水簾洞：節點全部可見', v2)
    await shot(page, 'map-shuiliandong', 'port')
    // 直向的關卡與結算
    await page.getByTestId('subject-english').click()
    await page.getByTestId('station-1').click()
    await page.waitForSelector('[data-testid=question]')
    await shot(page, 'stage', 'port')
    for (let i = 0; i < 5; i++) {
      const q = await solvePick(page)
      await page.waitForSelector('[data-testid=next-question]')
      if (i === 0) await page.waitForTimeout(300)
      await nextQ(page, q.id)
    }
    await page.waitForSelector('[data-testid=station-result]')
    await page.waitForTimeout(2800)
    await shot(page, 'station-result', 'port')
    const fit = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 4)
    check('直向結算畫面一屏放得下', fit)
    check('沒有錯誤', errors.length === 0, errors.join(' | ').slice(0, 200))
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
