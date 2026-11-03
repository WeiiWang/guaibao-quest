// v8.1 線 P 截圖：BASE_URL=... node scripts/shots-story.mjs <輸出資料夾> <story id,逗號分隔> [物種] [land,port,phone]；STORY_FINALE=1 = 夜晚、已看過終章（順便拍窗外的星星）
import { freshApp, idb, launch, patchPet } from './e2e-lib.mjs'
import { mkdirSync } from 'node:fs'

const out = process.argv[2]
const ids = (process.argv[3] ?? 'prologue').split(',')
const species = process.argv[4] ?? 'monkey'
const sizes = (process.argv[5] ?? 'land,port,phone').split(',')
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
mkdirSync(out, { recursive: true })
const browser = await launch()
for (const size of sizes) {
  const { ctx, page, errors } = await freshApp(browser, SIZES[size], { stage: 'baby', tod: process.env.STORY_FINALE ? 'night' : 'day' })
  await page.evaluate(() => {
    localStorage.setItem('gq-story-test', '1')
  })
  await patchPet(page, { species })
  // 全部解鎖：直接在 storySeen 放滿，從書架點
  await idb(page, (db, extra) => new Promise((r) => {
    const s = db.transaction('settings', 'readwrite').objectStore('settings')
    s.get('main').onsuccess = (e) => (s.put({ ...e.target.result, storySeen: ['prologue', 'huaguoshan-open', 'huaguoshan-close', 'shuiliandong-open', 'shuiliandong-close', 'english-open', 'english-close', 'life-open', 'life-close', 'nature-open', 'nature-close', ...extra] }).onsuccess = () => r(1))
  }), process.env.STORY_FINALE ? ['finale'] : [])
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await page.evaluate(() => (location.hash = 'stories'))
  await page.getByTestId('story-shelf').waitFor()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${size}-shelf.png` })
  for (const id of ids) {
    await page.getByTestId(`story-book-${id}`).click()
    await page.getByTestId('story').waitFor()
    await page.waitForTimeout(id === 'prologue' ? 3800 : 2400)
    await page.screenshot({ path: `${out}/${size}-${id}-1.png` })
    await page.waitForTimeout(600)
    await page.mouse.click(SIZES[size].width / 2, 200)
    await page.waitForTimeout(id === 'finale' ? 4500 : 2600)
    await page.screenshot({ path: `${out}/${size}-${id}-2.png` })
    await page.getByTestId('story-skip').click()
    await page.waitForFunction(() => !document.querySelector('[data-testid=story]'))
  }
  await page.evaluate(() => (location.hash = 'map'))
  await page.getByTestId('map').waitFor()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/${size}-map.png` })
  await page.evaluate(() => (location.hash = 'home'))
  await page.waitForSelector('[data-testid=room]')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${size}-home.png` })
  console.log(size, errors.join(' | ') || 'no errors')
  await ctx.close()
}
await browser.close()
