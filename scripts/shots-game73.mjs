// v7.3 線 G 截圖：吃飽後仍可餵與每日上限、6 次孵化、文字選項的喇叭、英文長單字、compare 題、手機與直向地圖、6–7 歲橫向地圖、首頁右側欄的朋友入口。
// 用法：BASE_URL=http://localhost:5197 node scripts/shots-game73.mjs [only,only...]
// 輸出：design/reviews/v73-game-shots/（已 gitignore，不進版控）
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, idb, launch, patchPet } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'design/reviews/v73-game-shots')
mkdirSync(OUT, { recursive: true })
const CONTENT = join(ROOT, 'src/learning/content')
const BANK = Object.fromEntries(['number', 'classify', 'pattern', 'measure', 'space', 'observe', 'english', 'life', 'nature'].flatMap((f) => JSON.parse(readFileSync(join(CONTENT, `${f}.json`), 'utf8'))).map((q) => [q.id, q]))
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const only = (process.argv[2] ?? '').split(',').filter(Boolean)
const want = (k) => only.length === 0 || only.includes(k)
const CHAPTER = { number: ['math', 'huaguoshan'], english: ['english', 'english-island'], life: ['life', 'life-town'], nature: ['nature', 'nature-forest'], measure: ['math', 'huaguoshan'] }
const patchSettings = (page, patch) => idb(page, (db, patch) => new Promise((r) => { const s = db.transaction('settings', 'readwrite').objectStore('settings'); s.get('main').onsuccess = (e) => { s.put({ ...e.target.result, ...patch }).onsuccess = () => r(1) } }), patch)
const go = async (page, hash) => { await page.evaluate((h) => (location.hash = h), hash); await page.waitForTimeout(300) }

/** 讓關卡第 1 題就是指定的題目（寫一份 stageDraft），回到畫面上拍照 */
async function showQuestion(page, id, { age = '4-5' } = {}) {
  const q = BANK[id]
  const [subj, ch] = CHAPTER[q.skill]
  await idb(page, (db, o) => new Promise((res) => {
    const tx = db.transaction(['settings', 'attempts', 'progress'], 'readwrite')
    const st = tx.objectStore('settings')
    st.get('main').onsuccess = (e) => {
      st.put({ ...e.target.result, seenIntros: ['tapN', 'dragSort', 'dragOrder', 'place', 'flip', 'stepOrder', 'pick'], ageBand: o.age, stageDraft: { chapterId: o.ch, station: 1, run: 1, sessionId: 's' + Date.now(), plan: Array(5).fill(o.id).map((id) => ({ id, review: false, followUp: false })), savedAt: Date.now() } })
    }
    tx.objectStore('attempts').clear()
    tx.objectStore('progress').clear()
    tx.oncomplete = () => res(1)
  }), { id, ch, age })
  await page.evaluate((s) => { localStorage.setItem('gq-subject', s); localStorage.setItem('gq-chapter-' + s, '') }, subj)
  await go(page, 'map')
  await page.reload()
  await page.waitForSelector('[data-testid=map]')
  await page.getByTestId('subject-' + subj).click()
  await page.waitForTimeout(300)
  await page.getByText('先不要').click({ timeout: 800 }).catch(() => {})
  await page.getByTestId('station-1').click()
  await page.waitForSelector('[data-testid=question]', { timeout: 8000 })
  await page.waitForTimeout(1600)
}

const browser = await launch()
try {
  // 題目截圖（三種尺寸）
  const QUESTIONS = [
    ['q-word-life', 'life-2-39'], // 生活：文字選項（謝謝／請／不客氣）
    ['q-word-nature', 'nature-1-43'], // 自然：四季（春天／秋天／冬天）
    ['q-word-why', 'life-4-17'], // 生活：長句選項（一欄）
    ['q-en-long', 'english-1-41'], // 英文：watermelon 長單字（難度 1，有喇叭）
    ['q-en-long2', 'english-3-05'], // 英文：難度 3 的長單字（沒有喇叭）
    ['q-compare', 'number-3-13'], // compare：9 個 vs 12 個
    ['q-compare-big', 'number-3-19'], // compare：20 個 vs 17 個
    ['q-measure-long', 'measure-1-01'], // measure：比較長的小魚
  ]
  if (want('q')) {
    for (const [tag, vp] of Object.entries(SIZES)) {
      const { ctx, page, errors } = await freshApp(browser, vp)
      for (const [name, id] of QUESTIONS) {
        await showQuestion(page, id)
        await page.screenshot({ path: join(OUT, `${name}-${tag}.png`) })
      }
      if (errors.length) console.log(tag, 'errors', errors)
      await ctx.close()
    }
  }
  // 地圖：手機、直向、橫向 6–7 歲
  if (want('map')) {
    for (const [tag, vp] of Object.entries(SIZES)) {
      const { ctx, page } = await freshApp(browser, vp)
      await patchSettings(page, { ageBand: tag === 'land' ? '6-7' : '4-5' })
      await page.reload()
      await go(page, 'map')
      await page.waitForSelector('[data-testid=map]')
      await page.waitForTimeout(900)
      await page.getByText('先不要').click({ timeout: 800 }).catch(() => {})
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(OUT, `map-${tag}${tag === 'land' ? '-67' : ''}.png`) })
      await ctx.close()
    }
  }
  // 首頁：右側欄的朋友入口、吃飽仍可餵、到達每日上限、6 次孵化
  if (want('home')) {
    for (const [tag, vp] of Object.entries(SIZES)) {
      const { ctx, page } = await freshApp(browser, vp, { bananas: 8 })
      await patchSettings(page, { homeGuideShown: true })
      await page.reload()
      await page.waitForSelector('[data-testid=pet]')
      await page.waitForTimeout(700)
      await page.screenshot({ path: join(OUT, `home-friends-${tag}.png`) })
      // 吃飽（100）仍可餵
      await patchPet(page, { hunger: 100, hungerUpdatedAt: Date.now() })
      await page.reload()
      await page.waitForSelector('[data-testid=pet]')
      await page.waitForTimeout(600)
      await page.locator('[data-dock-item=banana]').click()
      await page.waitForTimeout(1900)
      await page.screenshot({ path: join(OUT, `feed-full-${tag}.png`) })
      // 每日上限
      const today = await page.evaluate(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })
      await patchPet(page, { hunger: 100, hungerUpdatedAt: Date.now(), growth: { date: today, n: 12 } })
      await page.reload()
      await page.waitForSelector('[data-testid=pet]')
      await page.waitForTimeout(600)
      await page.locator('[data-dock-item=banana]').click()
      await page.waitForTimeout(700)
      await page.screenshot({ path: join(OUT, `feed-capped-${tag}.png`) })
      await ctx.close()
    }
    // 蛋：6 次孵化（第 1、3、5 次與第 6 次的慶祝）
    const { ctx, page } = await freshApp(browser, SIZES.land, { stage: 'egg', bananas: 8 })
    await patchSettings(page, { homeGuideShown: true })
    for (let n = 1; n <= 6; n++) {
      await patchPet(page, { hunger: 10, hungerUpdatedAt: Date.now() })
      await page.reload()
      await page.waitForSelector('[data-testid=pet]')
      await page.waitForTimeout(500)
      await page.locator('[data-dock-item=banana]').click()
      await page.waitForTimeout(n === 6 ? 2800 : 2300)
      if ([1, 3, 5, 6].includes(n)) await page.screenshot({ path: join(OUT, `egg-feed-${n}-land.png`) })
    }
    await ctx.close()
    // 既有存檔：feedCount 已經 ≥ 6 的蛋 → 進首頁孵化慶祝
    const o = await freshApp(browser, SIZES.land, { stage: 'egg' })
    await patchSettings(o.page, { homeGuideShown: true })
    await patchPet(o.page, { stage: 'egg', feedCount: 9 })
    await o.page.reload()
    await o.page.waitForTimeout(2000)
    await o.page.screenshot({ path: join(OUT, 'egg-legacy-hatch-land.png') })
    await o.ctx.close()
  }
} finally {
  await browser.close()
}
