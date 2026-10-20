// 素材覆蓋稽核：走過各畫面，列出還在用「色塊 fallback」或「emoji fallback」的位置（素材齊全時應為 0）。
// 用法：先啟動 dev server，再 BASE_URL=http://localhost:5181 node scripts/audit-art.mjs
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL ?? 'http://localhost:5181'
const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '../src/learning/content')
const BANK = Object.fromEntries(['number', 'classify', 'pattern'].flatMap((f) => JSON.parse(readFileSync(join(CONTENT, `${f}.json`), 'utf8'))).map((q) => [q.id, q]))
function findChrome() {
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const p = join(root, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(p)) return p
  }
}
const idb = (page, fn, arg) =>
  page.evaluate(([src, a]) => new Promise((res) => { const rq = indexedDB.open('guaibao-quest'); rq.onsuccess = () => Promise.resolve(new Function('db', 'arg', `return (${src})(db, arg)`)(rq.result, a)).then(res) }), [fn.toString(), arg])

const browser = await chromium.launch({ executablePath: findChrome() })
const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } })
const page = await ctx.newPage()
let bad = 0
const scan = async (label) => {
  await page.waitForTimeout(500)
  const { out: hits, imgs } = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('.art-fallback').forEach((e) => out.push(`色塊 "${e.textContent.trim()}"`))
    document.querySelectorAll('.art-emoji-glyph').forEach((e) => { if (e.textContent) out.push(`emoji ${e.textContent}`) })
    document.querySelectorAll('.avatar-emoji').forEach((e) => out.push(`emoji ${e.textContent}`))
    let imgs = 0
    document.querySelectorAll('img.art').forEach((i) => { imgs++; if (i.complete && i.naturalWidth === 0) out.push(`破圖 ${i.getAttribute('src')}`) })
    return { out, imgs }
  })
  bad += hits.length
  console.log(`${hits.length ? 'MISS' : 'ok  '} ${label}（${imgs} 張真圖）${hits.length ? '\n   ' + [...new Set(hits)].join('\n   ') : ''}`)
}
await page.goto(BASE)
await page.waitForSelector('button.key')
const press = (pin) => page.evaluate(async (p) => { for (const d of p) [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click(); await new Promise((r) => setTimeout(r, 200)) }, pin)
await press('1234'); await press('1234')
await page.getByPlaceholder('小朋友的名字').fill('小明')
await page.getByRole('button', { name: '下一步' }).click()
await page.getByRole('button', { name: '下一步' }).click()
await scan('Onboarding（蛋）')
await page.getByRole('button', { name: '開始冒險' }).click()
await page.waitForSelector('[data-testid=room]')
const DECOR = ['decor-clock', 'decor-ball', 'decor-plant', 'decor-crate', 'decor-poster', 'decor-curtain', 'decor-rug', 'decor-shelf', 'decor-frame', 'decor-bed']
const seed = (stage, feed) => idb(page, (db, o) => new Promise((res) => {
  const tx = db.transaction(['inventory', 'pets', 'progress', 'placements'], 'readwrite')
  const inv = tx.objectStore('inventory')
  inv.put({ id: 'banana', itemId: 'banana', qty: 3 }); inv.put({ id: 'peach', itemId: 'peach', qty: 1 })
  for (const id of o.decor) inv.put({ id, itemId: id, qty: 1 })
  inv.put({ id: 'coloring-monkey', itemId: 'coloring-monkey', qty: 1 })
  const ps = tx.objectStore('pets'); const g = ps.get('pet')
  g.onsuccess = () => ps.put({ ...g.result, stage: o.stage, feedCount: o.feed, hunger: 90, hungerUpdatedAt: Date.now() })
  tx.objectStore('progress').put({ chapterId: 'huaguoshan', run: 1, stations: [0, 1, 2, 3, 4].map((i) => ({ done: i < 5, independent: 4, total: 5 })), chestClaimed: false, completedRuns: 0, updatedAt: Date.now() })
  const pl = tx.objectStore('placements')
  o.decor.slice(0, 5).forEach((id, i) => pl.put({ itemId: id, x: 0.2 + i * 0.1, y: id.match(/clock|poster|frame|curtain/) ? 0.25 : 0.85, z: 0, flipped: false, placedAt: Date.now() }))
  tx.oncomplete = () => res(1)
}), { stage, feed, decor: DECOR })
const nav = async (label) => { await page.locator('.candy, .mini-candy').filter({ hasText: label }).first().click() }
const back = async () => { for (let i = 0; i < 3 && !(await page.locator('[data-testid=room]').count()); i++) { await page.locator('button.back, button[aria-label=離開關卡]').first().click(); await page.waitForTimeout(200) } }

for (const [stage, feed] of [['egg', 0], ['egg', 19], ['baby', 30], ['adult', 80]]) {
  await seed(stage, feed)
  await page.reload(); await page.waitForSelector('[data-testid=pet]')
  await scan(`首頁（${stage} ${feed}）`)
}
await page.getByRole('button', { name: /佈置/ }).click(); await scan('佈置模式（道具列）')
await page.getByRole('button', { name: /完成/ }).click()
for (const [btn, label] of [['今日任務', '任務'], ['商店', '商店'], ['背包', '背包'], ['著色本', '著色本'], ['工坊', '工坊']]) { await nav(btn); await scan(label); if (label === '商店') { await page.getByRole('tab', { name: '著色頁' }).click(); await scan('商店-著色頁') } await back() }
await nav('冒險地圖'); await scan('地圖（5 站通關）')
await page.getByTestId('chest-node').click(); await page.waitForSelector('[data-testid=ceremony]'); await scan('章末儀式（寶箱）')
await page.getByTestId('claim-chest').click(); await scan('章末儀式（開箱後）')
// 清掉進度重打一站：逐題掃學習物件
await idb(page, (db) => new Promise((res) => { const tx = db.transaction('progress', 'readwrite'); tx.objectStore('progress').put({ chapterId: 'huaguoshan', run: 1, stations: [0, 1, 2, 3, 4].map(() => ({ done: false, independent: 0, total: 0 })), chestClaimed: false, completedRuns: 0, updatedAt: Date.now() }); tx.oncomplete = () => res(1) }))
await page.evaluate(() => (location.hash = 'map')); await page.reload(); await page.waitForSelector('[data-testid=map]')
await page.getByTestId('station-1').click()
for (let i = 0; i < 5; i++) {
  await page.waitForSelector('[data-testid=question]')
  const q = BANK[await page.locator('[data-testid=question]').getAttribute('data-question-id')]
  await scan(`答題 ${i + 1}（${q.type}）`)
  await page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`).click()
  await page.getByTestId('next-question').click()
}
await page.waitForSelector('[data-testid=station-result]'); await scan('結算')
// 慶祝（孵化）
await page.evaluate(() => (location.hash = '')); await page.reload(); await page.waitForSelector('[data-testid=pet]')
await seed('egg', 19); await page.reload(); await page.waitForSelector('[data-testid=pet]')
await page.locator('[data-dock-item=banana]').click(); await page.waitForSelector('.celebrate'); await scan('慶祝（孵化前）')
await page.waitForSelector('.celebrate-btn'); await scan('慶祝（孵化後）')
await page.locator('.celebrate-btn').click()
// 鎖定畫面
await idb(page, (db) => new Promise((res) => { const tx = db.transaction(['settings', 'playTime'], 'readwrite'); const s = tx.objectStore('settings'); const g = s.get('main'); g.onsuccess = () => s.put({ ...g.result, dailyLimitMin: 15 }); const d = new Date(); const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; tx.objectStore('playTime').put({ date, seconds: 99999, bonusSeconds: 0 }); tx.oncomplete = () => res(1) }))
await page.reload(); await page.waitForSelector('[data-testid=lock-screen]', { timeout: 8000 }).catch(() => {})
await scan('鎖定畫面')
await browser.close()
console.log(bad ? `\n${bad} 處仍是 fallback` : '\n全部都是真圖')
