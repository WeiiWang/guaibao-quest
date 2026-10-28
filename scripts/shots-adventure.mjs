// 視覺驗收截圖（學習冒險相關畫面）：地圖、答題、結算、章末儀式、工坊、家長學習分頁、時間鎖 → design/screens/
// 用法：先啟動 dev server（pnpm dev --port 5181 --strictPort），再 BASE_URL=http://localhost:5181 node scripts/shots-adventure.mjs
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL ?? 'http://localhost:5181'
const OUT = 'design/screens'
mkdirSync(OUT, { recursive: true })
const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '../src/learning/content')
const BANK = Object.fromEntries(
  ['number', 'classify', 'pattern'].flatMap((f) => JSON.parse(readFileSync(join(CONTENT, `${f}.json`), 'utf8'))).map((q) => [q.id, q]),
)

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const p = join(root, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(p)) return p
  }
}

const SIZES = { land: { width: 1024, height: 768 }, port: { width: 768, height: 1024 }, phone: { width: 375, height: 812 } }

const idb = (page, fn, arg) =>
  page.evaluate(
    ([src, a]) =>
      new Promise((res) => {
        const rq = indexedDB.open('guaibao-quest')
        rq.onsuccess = () => Promise.resolve(new Function('db', 'arg', `return (${src})(db, arg)`)(rq.result, a)).then(res)
      }),
    [fn.toString(), arg],
  )

async function setup(browser, vp, { done = 0, chestClaimed = false } = {}) {
  const ctx = await browser.newContext({ viewport: vp, ...(vp.width < 500 ? { hasTouch: true, isMobile: true } : {}) })
  const page = await ctx.newPage()
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
  await page.getByPlaceholder('小朋友的名字').fill('小寶')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByTestId('onboard-age-skip').click() // v7：onboarding 多一頁「幾歲」；舊測試選「之後再設定」，維持年齡未設定的前提
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '開始冒險' }).click()
  await page.waitForSelector('[data-testid=room]')
  await idb(
    page,
    (db, o) =>
      new Promise((res) => {
        const tx = db.transaction(['pets', 'progress', 'materialLedger'], 'readwrite')
        const ps = tx.objectStore('pets')
        const g = ps.get('pet')
        g.onsuccess = () => ps.put({ ...g.result, stage: 'adult', feedCount: 80, hunger: 90, hungerUpdatedAt: Date.now() })
        tx.objectStore('progress').put({
          chapterId: 'huaguoshan',
          run: 1,
          stations: [0, 1, 2, 3, 4].map((i) => ({ done: i < o.done, independent: i < o.done ? 4 : 0, total: i < o.done ? 5 : 0 })),
          chestClaimed: o.chestClaimed,
          completedRuns: o.chestClaimed ? 1 : 0,
          updatedAt: Date.now(),
        })
        const ml = tx.objectStore('materialLedger')
        ;[['wood', 5], ['stone', 3], ['flower', 2]].forEach(([m, n], i) => ml.put({ id: 'seed' + i, at: Date.now(), material: m, delta: n, kind: 'station', reason: '測試' }))
        tx.oncomplete = () => res(1)
      }),
    { done, chestClaimed },
  )
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  return { ctx, page }
}

const shot = async (page, name, key, wait = 450) => {
  await page.waitForTimeout(wait)
  await page.screenshot({ path: `${OUT}/${name}-${key}.png` })
  console.log('shot', `${name}-${key}`)
}
const toHash = (page, h) => page.evaluate((x) => (location.hash = x), h)

const browser = await chromium.launch({ executablePath: findChrome() })
try {
  for (const [key, vp] of Object.entries(SIZES)) {
    // 地圖：剛開始 / 通關 2 站 / 全部通關
    for (const [label, done] of [['start', 0], ['mid', 2], ['all', 5]]) {
      const { ctx, page } = await setup(browser, vp, { done })
      await toHash(page, 'map')
      await page.waitForSelector('[data-testid=map]')
      await shot(page, `map-${label}`, key, 700)
      await ctx.close()
    }

    // 答題：連續拍每一題（題型不同），第 2 題先點錯一次看提示，最後拍結算
    {
      const { ctx, page } = await setup(browser, vp)
      await toHash(page, 'map')
      await page.waitForSelector('[data-testid=map]')
      await page.getByTestId('station-1').click()
      for (let i = 0; i < 5; i++) {
        await page.waitForSelector('[data-testid=question]')
        const qid = await page.locator('[data-testid=question]').getAttribute('data-question-id')
        const q = BANK[qid]
        await shot(page, `q${i + 1}-${q.type}`, key, 500)
        if (i === 1) {
          const wrong = q.choices.find((c) => c.id !== q.answer)
          await page.locator(`[data-testid=choice][data-choice-id="${wrong.id}"]`).click()
          await shot(page, 'q-hint', key, 400)
        }
        await page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`).click()
        if (i === 0) await shot(page, 'q-right', key, 300)
        await page.getByTestId('next-question').click()
      }
      await page.waitForSelector('[data-testid=station-result]')
      await shot(page, 'result-pop', key, 900)
      await shot(page, 'result-fly', key, 1100)
      await shot(page, 'result-done', key, 1800)
      await ctx.close()
    }

    // 章末儀式（通關 5 站後打開寶箱）
    {
      const { ctx, page } = await setup(browser, vp, { done: 5 })
      await toHash(page, 'map')
      await page.getByTestId('chest-node').click()
      await page.waitForSelector('[data-testid=ceremony]')
      await shot(page, 'ceremony-closed', key)
      await page.getByTestId('claim-chest').click()
      await shot(page, 'ceremony-open', key, 900)
      await ctx.close()
    }

    // 工坊
    {
      const { ctx, page } = await setup(browser, vp, { done: 2 })
      await toHash(page, 'workshop')
      await page.waitForSelector('[data-testid=workshop]')
      await shot(page, 'workshop', key)
      await ctx.close()
    }

    // 家長新分頁
    {
      const { ctx, page } = await setup(browser, vp, { done: 2 })
      await page.getByRole('button', { name: /家長入口/ }).click()
      await page.waitForSelector('button.key')
      await page.evaluate(async () => {
        for (const d of '1234') [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
        await new Promise((r) => setTimeout(r, 300))
      })
      await page.waitForSelector('.tabs')
      for (const t of ['學習報告', '遊玩時間', '音效/語音', '訂閱方案']) {
        await page.getByRole('tab', { name: t }).click()
        await shot(page, `parent-${t === '學習報告' ? 'report' : t === '遊玩時間' ? 'time' : t === '音效/語音' ? 'audio' : 'sub'}`, key)
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
