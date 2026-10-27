// v4 線 U（操作與回饋）E2E：每一項 UX 修正都有斷言，並存三種尺寸的截圖到 design/screens/v4-ux-*.png。
// 用法：先啟動 dev server（例如 pnpm dev --port 5181 --strictPort），再
//   BASE_URL=http://localhost:5181 node scripts/e2e-ux.mjs      （或 pnpm e2e:ux）
// 需要 Chromium：預設找 ~/Library/Caches/ms-playwright 內已安裝的，或用 CHROME_PATH 指定。
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, idb, launch, makeChecker } from './e2e-lib.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../design/screens')
mkdirSync(OUT, { recursive: true })
const { state, check } = makeChecker()

const SIZES = {
  land: { width: 1024, height: 768 },
  port: { width: 768, height: 1024 },
  phone: { width: 375, height: 812 },
}
const shot = async (page, name, size) => {
  await page.waitForTimeout(600) // 等進場動畫跑完，截圖才不會是半透明
  await page.screenshot({ path: join(OUT, `v4-ux-${name}-${size}.png`) })
}

// ---------- 小工具 ----------
const dump = (page, table) =>
  idb(page, (db, t) => new Promise((res) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => res(e.target.result))), table)

const balance = async (page) => (await dump(page, 'ledger')).reduce((s, e) => s + e.delta, 0)
const qtyOf = async (page, id) => (await dump(page, 'inventory')).find((v) => v.itemId === id)?.qty ?? 0

/** 直接寫進 IndexedDB（寫完要 reload 畫面才看得到） */
const putRows = (page, table, rows) =>
  idb(
    page,
    (db, a) =>
      new Promise((res) => {
        const tx = db.transaction(a.table, 'readwrite')
        for (const r of a.rows) tx.objectStore(a.table).put(r)
        tx.oncomplete = () => res(1)
      }),
    { table, rows },
  )
const giveStars = (page, n) => putRows(page, 'ledger', [{ id: `t-${Math.random()}`, at: Date.now(), delta: n, reason: '測試', kind: 'bonus' }])
const patchSettings = (page, patch) =>
  idb(
    page,
    (db, p) =>
      new Promise((res) => {
        const s = db.transaction('settings', 'readwrite').objectStore('settings')
        s.get('main').onsuccess = (e) => (s.put({ ...e.target.result, ...p }).onsuccess = () => res(1))
      }),
    patch,
  )

/** 記錄語音：window.__spoken = 唸過的句子；WebAudio 發聲次數在 window.__audio.osc（e2e-lib 已掛） */
const spySpeech = (ctx) =>
  ctx.addInitScript(() => {
    window.__spoken = []
    try {
      const orig = window.speechSynthesis.speak.bind(window.speechSynthesis)
      window.speechSynthesis.speak = (u) => {
        window.__spoken.push(u.text)
        return orig(u)
      }
    } catch {
      /* 沒有 speechSynthesis 就沒有語音可記 */
    }
  })

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- 第 1 項：鎖定畫面按鈕 ----------
async function lockScreen(browser) {
  for (const [size, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await patchSettings(page, { dailyLimitMin: 15 })
    await putRows(page, 'playTime', [{ date: today(), seconds: 99999, bonusSeconds: 0 }])
    await page.reload()
    await page.waitForSelector('[data-testid=lock-screen]', { timeout: 10000 })
    const tasks = await page.getByTestId('lock-tasks').boundingBox()
    const col = await page.getByTestId('lock-coloring').boundingBox()
    check(
      `[${size}] 鎖定畫面：「今日任務」「著色本」是大膠囊（高 ≥72、寬 ≥150），不是小圓`,
      tasks.height >= 72 && col.height >= 72 && tasks.width >= 150 && col.width >= 150,
      `${Math.round(tasks.width)}x${Math.round(tasks.height)} / ${Math.round(col.width)}x${Math.round(col.height)}`,
    )
    const oneLine = await page.evaluate(() => [...document.querySelectorAll('.lock-go span:not(.art-emoji):not(.art-emoji-glyph)')].every((s) => s.getBoundingClientRect().height < 36))
    check(`[${size}] 鎖定畫面：按鈕文字不斷行`, oneLine)
    check(`[${size}] 鎖定畫面：沒有水平溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`[${size}] 鎖定畫面沒有首頁的圓形鎖頭 class`, (await page.locator('.lock-screen .parent-lock').count()) === 0)
    await shot(page, 'lock', size)
    check(`[${size}] 鎖定畫面無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  const { ctx, page } = await freshApp(browser, SIZES.land)
  const b = await page.locator('.parent-lock').boundingBox()
  check('首頁家長鎖頭維持圓形（58×58）', Math.abs(b.width - 58) < 1 && Math.abs(b.height - 58) < 1, `${b.width}x${b.height}`)
  await ctx.close()
}

const SECTIONS = { lockScreen }
void SECTIONS
void balance
void qtyOf
void giveStars
void spySpeech

const only = process.argv[2]
const browser = await launch()
try {
  for (const [name, fn] of Object.entries(SECTIONS)) {
    if (only && only !== name) continue
    console.log(`\n# ${name}`)
    await fn(browser)
  }
} finally {
  await browser.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
