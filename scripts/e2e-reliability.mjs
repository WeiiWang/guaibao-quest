// v8 線 R E2E：備份還原、更新不打斷、安裝引導、離線內容包（真的斷網）、分塊載入、關於與隱私。
// 一定要跑在 production build + preview 上（service worker 只在 production 註冊），網址結尾要有斜線：
//   BASE_PATH=/guaibao-quest/ pnpm build
//   BASE_PATH=/guaibao-quest/ pnpm exec vite preview --port 5191 --strictPort
//   BASE_URL=http://localhost:5191/guaibao-quest/ pnpm e2e:reliability          （E2E_BROWSER=webkit 用 WebKit）
// E2E_ONLY=backup,update,install,pack,lazy,about 只跑其中幾段；E2E_SHOTS=<資料夾> 存新畫面的截圖。
// 更新測試會暫時改寫 dist/sw.js（模擬部署新版），結束時還原。
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, makeChecker, freshApp, pressPin, openParentTab, idb, IPAD_CTX, IS_WEBKIT, BASE } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const ROOT = BASE.endsWith('/') ? BASE : `${BASE}/`
const LAND = { width: 1180, height: 820 }
const PORT = { width: 820, height: 1180 }
const PHONE = { width: 390, height: 844 }
const VIEWPORTS = { land: LAND, port: PORT, phone: PHONE }
const ONLY = process.env.E2E_ONLY?.split(',')
const want = (s) => !ONLY || ONLY.includes(s)
const SHOTS = process.env.E2E_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const TMP = mkdtempSync(join(tmpdir(), 'gq-reliability-'))
const DIST = join(import.meta.dirname, '..', 'dist')
const SW = join(DIST, 'sw.js')

if (!existsSync(SW)) {
  console.log('FAIL  找不到 dist/sw.js：這個測試要先 pnpm build，並用 vite preview 跑')
  process.exit(1)
}

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${IS_WEBKIT ? 'webkit-' : ''}${name}.png`), fullPage: true })
}

/** 任意資料庫的整張表（名冊、某個孩子） */
const getAll = (page, dbName, table) =>
  page.evaluate(
    ([dbName, table]) =>
      new Promise((res, rej) => {
        const rq = indexedDB.open(dbName)
        rq.onerror = () => rej(rq.error)
        rq.onsuccess = () => {
          const db = rq.result
          const q = db.transaction(table).objectStore(table).getAll()
          q.onsuccess = () => {
            db.close()
            res(q.result)
          }
        }
      }),
    [dbName, table],
  )

const dbNames = (page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
const children = (page) => getAll(page, 'guaibao-registry', 'children')
const waitController = (page) => page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 })

/** 新增第二個孩子（從首頁開始，停在家長區設定頁） */
async function addSecondChild(page, name = '小花') {
  await openParentTab(page, '設定')
  await page.getByTestId('kid-add').click()
  await page.getByTestId('kid-name').fill(name)
  await page.getByTestId('child-age-3').click()
  await page.getByTestId('species-rabbit').click()
  await page.getByTestId('kid-add-submit').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=kid-row]').length === 2)
}

const exitParent = async (page) => {
  await page.getByRole('button', { name: '回到小孩模式' }).click()
  await page.waitForSelector('[data-testid=room]')
}

const pick = async (page, name) => {
  await page.getByTestId('child-picker').waitFor()
  await page.getByTestId('child-card').filter({ hasText: name }).click()
  await page.waitForSelector('[data-testid=room]')
}

const browser = await launch()
const originalSw = readFileSync(SW)

try {
  // ================= 分塊載入 =================
  if (want('lazy')) {
    const assets = readdirSync(join(DIST, 'assets'))
    const sw = originalSw.toString()
    const notPrecached = assets.filter((f) => !sw.includes(`assets/${f}`))
    check('分塊：dist/assets 每個檔案都在 SW 的 precache 裡（離線讀得到 chunk）', notPrecached.length === 0, notPrecached.join(','))
    check('分塊：全部 CSS 一包', assets.filter((f) => f.endsWith('.css')).length === 1)
    // 啟動一定要載的 JS = index.html 裡的 script 加 modulepreload（共用的 chunk 也算，不能只看 index-*.js）
    const initial = [...readFileSync(join(DIST, 'index.html'), 'utf8').matchAll(/assets\/([^"]+\.js)"/g)].map((m) => m[1])
    const initialSize = initial.reduce((n, f) => n + readFileSync(join(DIST, 'assets', f)).length, 0)
    check('分塊：啟動要載的 JS 合計 < 700KB（分塊前 1715KB）', initialSize < 700 * 1024, `${Math.round(initialSize / 1024)}KB，${initial.length} 個檔`)
    check('分塊：題庫獨立成一塊', assets.some((f) => f.startsWith('bankData-')))

    // 等 chunk 時顯示品牌載入畫面（擋掉 SW 才攔得到網路）
    const { ctx, page, errors } = await freshApp(browser, LAND, { ctxOpts: { serviceWorkers: 'block' } })
    await page.route('**/assets/Album-*.js', async (r) => {
      await new Promise((res) => setTimeout(res, 900))
      await r.continue()
    })
    await page.evaluate(() => {
      location.hash = '#album'
    })
    await page.getByTestId('loading').waitFor({ timeout: 700 })
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=loading]')).backgroundImage + getComputedStyle(document.querySelector('[data-testid=loading]')).backgroundColor)
    check('分塊：chunk 還沒到時顯示品牌載入畫面，不是白的', !/^none(rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\))$/.test(bg), bg.slice(0, 60))
    await page.getByTestId('loading').waitFor({ state: 'detached', timeout: 10000 })
    check('分塊：chunk 到了就接著顯示畫面，沒有錯誤畫面', (await page.getByTestId('error-screen').count()) === 0)
    await page.evaluate(() => {
      location.hash = ''
    })
    await page.waitForSelector('[data-testid=room]')

    // chunk 真的載不到（換版後舊檔不見、斷線）：不白屏
    await page.route('**/assets/Friends-*.js', (r) => r.abort())
    await page.evaluate(() => {
      location.hash = '#friends'
    })
    await page.getByTestId('error-screen').waitFor({ timeout: 15000 })
    check('分塊：chunk 載不到 → 重試、自動重新整理一次後顯示錯誤畫面，不白屏', true)
    await page.getByTestId('error-home').click()
    await page.waitForSelector('[data-testid=room]')
    check('分塊：錯誤畫面按回首頁可以回去', true)
    const realErrors = errors.filter((e) => !/Friends|dynamically imported|Importing a module|error loading|ChunkLoadError|The above error occurred|Failed to load/i.test(e))
    check('分塊：除了故意擋掉的 chunk，沒有其他錯誤', realErrors.length === 0, realErrors.join(' | ').slice(0, 200))
    await ctx.close()
  }

  // ================= 備份與還原 =================
  if (want('backup')) {
    const { ctx, page, errors } = await freshApp(browser, LAND)
    await addSecondChild(page, '小花')
    const kids = await children(page)
    const second = kids.find((k) => k.name === '小花')
    // 留下可以比對的進度
    await idb(page, (db) => new Promise((r) => {
      const s = db.transaction('ledger', 'readwrite').objectStore('ledger')
      s.put({ id: 'e2e-backup', at: 1000, delta: 37, kind: 'bonus', reason: '備份測試' }).onsuccess = () => r(1)
    }))
    const tabCounts = await getAll(page, 'guaibao-quest', 'ledger')

    await page.getByRole('tab', { name: '備份與離線', exact: true }).click()
    await page.getByTestId('data-tab').waitFor()
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(vp)
      await page.waitForTimeout(150)
      check(`備份：[${name}] 資料頁沒有橫向溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      await shot(page, `data-${name}`)
    }
    await page.setViewportSize(LAND)
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup-download').click()])
    const backupPath = join(TMP, dl.suggestedFilename())
    await dl.saveAs(backupPath)
    check('備份：檔名是 guaibao-backup-<日期>.json，不含孩子的名字', /^guaibao-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename())
    const file = JSON.parse(readFileSync(backupPath, 'utf8'))
    check('備份：格式與版本', file.format === 'guaibao-quest-backup' && file.formatVersion === 1 && file.schemaVersion === 3)
    check('備份：兩個孩子都在', file.registry.children.length === 2 && !!file.data[second.id])
    const allTables = ['children', 'templates', 'instances', 'ledger', 'pets', 'shopItems', 'inventory', 'coloring', 'settings', 'placements', 'attempts', 'materialLedger', 'progress', 'skillState', 'playTime']
    check('備份：所有 Dexie 表都有', allTables.every((t) => Array.isArray(file.data[kids[0].id][t])), Object.keys(file.data[kids[0].id]).join(','))
    check('備份：有 PIN（才能在別台裝置用同一組 PIN）', file.registry.meta.some((m) => m.key === 'pinHash'))
    check('備份：第一個孩子的進度在檔案裡', file.data[kids[0].id].ledger.some((l) => l.id === 'e2e-backup'))
    check('備份：畫面記下上次備份時間', /上次備份/.test(await page.getByTestId('backup-last').innerText()))

    // ---- 壞檔案 ----
    const tryBad = async (name, text, re) => {
      const p = join(TMP, name)
      writeFileSync(p, text)
      await page.getByTestId('restore-file').setInputFiles(p)
      await page.getByTestId('restore-error').waitFor()
      const msg = await page.getByTestId('restore-error').innerText()
      check(`還原：${name} 被擋下來，有說明`, re.test(msg), msg)
      await page.getByRole('button', { name: '知道了' }).click()
    }
    await tryBad('not-json.json', 'hello', /讀不出來/)
    await tryBad('other.json', '{"a":1}', /不是乖寶任務的備份檔/)
    await tryBad('newer.json', JSON.stringify({ ...file, schemaVersion: 99 }), /較新版本/)
    await tryBad('broken.json', JSON.stringify({ ...file, data: {} }), /不完整/)
    check('還原：壞檔案沒有動到資料', (await children(page)).length === 2 && (await getAll(page, 'guaibao-quest', 'ledger')).length === tabCounts.length)

    // ---- 備份之後資料變了：改名、加第三個孩子的資料 ----
    await idb(page, (db) => new Promise((r) => {
      const s = db.transaction('ledger', 'readwrite').objectStore('ledger')
      s.delete('e2e-backup').onsuccess = () => r(1)
    }))
    await page.getByTestId('restore-file').setInputFiles(backupPath)
    await page.getByTestId('restore-summary').waitFor()
    const summary = await page.getByTestId('restore-summary').innerText()
    check('還原：先顯示內容（孩子名字）與「會取代」的警告', /小明/.test(summary) && /小花/.test(summary) && /取代/.test(summary), summary.slice(0, 80))
    await page.waitForTimeout(500) // 等對話框動畫
    if (SHOTS) {
      for (const [name, vp] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(vp)
        await page.waitForTimeout(150)
        await page.screenshot({ path: join(SHOTS, `${IS_WEBKIT ? 'webkit-' : ''}restore-summary-${name}.png`) })
      }
      await page.setViewportSize(LAND)
    }
    await page.getByTestId('restore-continue').click()
    await pressPin(page, '9999')
    await page.waitForTimeout(150)
    check('還原：第二次確認要輸入 PIN，輸錯不還原', (await getAll(page, 'guaibao-quest', 'ledger')).every((l) => l.id !== 'e2e-backup') && (await page.getByRole('dialog').count()) === 1)
    await pressPin(page, '1234')
    await page.waitForEvent('load', { timeout: 20000 }).catch(() => undefined)
    await page.getByTestId('child-picker').waitFor()
    await page.getByTestId('child-card').filter({ hasText: '小明' }).click()
    await page.waitForSelector('[data-testid=room]')
    const after = await children(page)
    check('還原：重新載入後兩個孩子都在', after.length === 2 && after.map((k) => k.name).join() === '小明,小花')
    const ledger = await getAll(page, after[0].dbName, 'ledger')
    check('還原：被刪掉的進度回來了', ledger.some((l) => l.id === 'e2e-backup' && l.delta === 37))
    const names = await dbNames(page)
    check('還原：舊資料庫啟動時刪掉（沒有孤兒）', !names.includes(second.dbName), names.join(','))
    check('還原：家長 PIN 還能用', await (async () => {
      await page.getByRole('button', { name: /家長入口/ }).click()
      await page.waitForSelector('button.key')
      await pressPin(page, '1234')
      return (await page.getByTestId('parent-tabs').count()) === 1
    })())
    await page.getByRole('button', { name: '回到小孩模式' }).click()
    await page.waitForSelector('[data-testid=room]')
    check('還原：沒有錯誤', errors.length === 0, errors.join(' | ').slice(0, 200))
    await ctx.close()

    // ---- 另一台裝置（全新 context）：在第一個畫面就能還原 ----
    const ctx2 = await browser.newContext({ viewport: LAND, ...IPAD_CTX })
    const page2 = await ctx2.newPage()
    await page2.goto(ROOT)
    await page2.waitForSelector('button.key')
    await page2.waitForTimeout(800) // 等進場動畫
    await shot(page2, 'onboard-restore-land')
    await page2.getByTestId('restore-file').setInputFiles(backupPath)
    await page2.getByTestId('restore-summary').waitFor()
    await page2.getByTestId('restore-continue').click() // 全新裝置沒有 PIN 可驗
    await page2.getByTestId('child-picker').waitFor({ timeout: 20000 })
    await page2.getByTestId('child-card').filter({ hasText: '小明' }).click()
    await page2.waitForSelector('[data-testid=room]')
    const kids2 = await children(page2)
    const l2 = await getAll(page2, kids2[0].dbName, 'ledger')
    check('跨裝置：全新裝置從第一個畫面還原，孩子與進度都在', kids2.length === 2 && l2.some((l) => l.id === 'e2e-backup'))
    await page2.getByRole('button', { name: /家長入口/ }).click()
    await page2.waitForSelector('button.key')
    await pressPin(page2, '1234')
    check('跨裝置：用原本的 PIN 進得了家長區', (await page2.getByTestId('parent-tabs').count()) === 1)
    await ctx2.close()
  }

  // ================= 更新不打斷 =================
  if (want('update')) {
    let bump = 0
    const deployNewVersion = () => writeFileSync(SW, `${originalSw}\n// e2e bump ${++bump}\n`)
    const regState = (page) =>
      page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration()
        return { waiting: !!r?.waiting, installing: !!r?.installing, active: !!r?.active }
      })
    const checkForUpdate = async (page) => {
      await page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration()
        await r.update()
      })
      await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting, null, { timeout: 30000, polling: 200 })
    }
    try {
      const { ctx, page, errors } = await freshApp(browser, LAND)
      await waitController(page)
      await addSecondChild(page, '小花')
      await exitParent(page)
      await idb(page, (db) => new Promise((r) => {
        const s = db.transaction('progress', 'readwrite').objectStore('progress')
        s.put({ chapterId: 'huaguoshan', run: 1, stations: [{ done: true, independent: 4, total: 5 }, ...Array.from({ length: 4 }, () => ({ done: false, independent: 0, total: 0 }))], chestClaimed: false, completedRuns: 0, updatedAt: Date.now() }).onsuccess = () => r(1)
      }))
      await page.reload()
      await pick(page, '小明')
      await page.getByTestId('candy-map').click()
      await page.waitForSelector('[data-testid=station-1]')
      await page.getByTestId('station-1').click({ force: true })
      await page.waitForSelector('[data-testid=stage]')
      await page.evaluate(() => (window.__mark = 'same-page'))
      let navs = 0
      page.on('framenavigated', (f) => {
        if (f === page.mainFrame()) navs++
      })

      deployNewVersion()
      await checkForUpdate(page)
      await page.waitForTimeout(1500)
      check('更新：新版本裝好時孩子在關卡中 → 沒有重新整理', (await page.evaluate(() => window.__mark)) === 'same-page' && (await page.getByTestId('stage').count()) === 1 && navs === 0)
      check('更新：新版本在等待，沒有接手', (await regState(page)).waiting)
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await page.waitForTimeout(300)
      check('更新：關卡中從背景回來也不套用', (await page.evaluate(() => window.__mark)) === 'same-page')

      // 離開關卡到地圖：還不是首頁
      await page.getByTestId('leave').click()
      await page.getByTestId('leave-go').click()
      await page.waitForSelector('[data-testid=map]')
      await page.waitForTimeout(500)
      check('更新：回到地圖還不套用', (await page.evaluate(() => window.__mark)) === 'same-page')

      // 開場畫面的旗標打開：確認套用後的重新整理不會再看到開場
      await page.evaluate(() => localStorage.setItem('gq-title-test', '1'))
      await page.locator('.back').first().click()
      await page.waitForFunction(() => !window.__mark, null, { timeout: 15000 })
      await page.waitForSelector('[data-testid=room]', { timeout: 15000 })
      check('更新：回到首頁 → 套用（頁面重新載入）', true)
      check('更新：重新載入後直接回到同一個孩子的首頁，沒有開場、沒有選孩子', (await page.getByTestId('title').count()) === 0 && (await page.getByTestId('child-picker').count()) === 0 && /小明/.test(await page.locator('.hello-name').innerText()))
      check('更新：狀態列顏色換回米色（開場被跳過時）', (await page.evaluate(() => document.querySelector('meta[name=theme-color]')?.content)) === '#f3e3c3')
      check('更新：新版本已經接手', !(await regState(page)).waiting)
      check('更新：沒有重新載入第二次', navs === 1, `navs=${navs}`)

      // 家長區：顯示版本與「已下載好」；離開家長區回首頁才套用
      await page.evaluate(() => sessionStorage.removeItem('gq-update-tried'))
      deployNewVersion()
      await checkForUpdate(page)
      await openParentTab(page, '關於與隱私')
      await page.getByTestId('about-tab').waitFor()
      const version = await page.getByTestId('app-version').innerText()
      check('更新：家長區顯示目前版本（短 commit + 日期）', /^[0-9a-f]{6,}\s\(\d{4}-\d{2}-\d{2}\)$/.test(version), version)
      await page.getByTestId('update-ready').waitFor()
      check('更新：家長區告訴家長新版本好了', true)
      await page.evaluate(() => (window.__mark = 'parent'))
      await page.waitForTimeout(500)
      check('更新：在家長區不套用', (await page.evaluate(() => window.__mark)) === 'parent')
      await page.getByRole('button', { name: '回到小孩模式' }).click()
      await page.waitForFunction(() => !window.__mark, null, { timeout: 15000 })
      await page.waitForSelector('[data-testid=room]', { timeout: 15000 })
      check('更新：離開家長區回到首頁 → 套用', !(await regState(page)).waiting)

      // 冷啟動：新版本已經在等，開場畫面時就換上（孩子還沒開始玩），而且只重整一次
      await page.evaluate(() => sessionStorage.removeItem('gq-update-tried'))
      deployNewVersion()
      await checkForUpdate(page)
      const before = navs
      await page.reload()
      await page.getByTestId('title').waitFor({ timeout: 15000 })
      await page.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration())?.waiting, null, { timeout: 15000, polling: 200 })
      await page.waitForTimeout(800)
      await page.getByTestId('title').waitFor({ timeout: 15000 })
      check('更新：冷啟動 → 開場時換上新版本，開場畫面還在', true)
      check('更新：冷啟動沒有一直重新整理（最多 2 次導覽）', navs - before <= 2, `導覽 ${navs - before} 次`)
      check('更新：沒有錯誤', errors.length === 0, errors.join(' | ').slice(0, 200))
      await ctx.close()
    } finally {
      writeFileSync(SW, originalSw)
    }
  }

  // ================= 安裝引導與啟動畫面 =================
  if (want('install')) {
    const { ctx, page } = await freshApp(browser, LAND)
    await page.evaluate(() => localStorage.setItem('gq-install-hint-test', '1'))
    await page.getByRole('button', { name: /家長入口/ }).click()
    await page.waitForSelector('button.key')
    await pressPin(page, '1234')
    await page.getByTestId('install-hint').waitFor()
    check('安裝：沒安裝時家長區顯示提示', true)
    await shot(page, 'install-hint-land')
    await page.getByTestId('install-hint-show').click()
    await page.getByTestId('install-guide').waitFor()
    await page.waitForTimeout(400)
    check('安裝：按「看怎麼做」跳到圖解，提示收起來', (await page.getByTestId('install-hint').count()) === 0)
    check('安裝：圖解有 3 張自己畫的 SVG，沒有外部圖', (await page.locator('[data-testid=install-guide] svg').count()) === 3)
    check('安裝：說明主畫面版與 Safari 資料分開', /分開/.test(await page.getByTestId('install-storage-note').innerText()))
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(vp)
      await page.getByTestId('install-guide').scrollIntoViewIfNeeded()
      await page.waitForTimeout(200)
      check(`安裝：[${name}] 沒有橫向溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${IS_WEBKIT ? 'webkit-' : ''}install-guide-${name}.png`) })
    }
    await page.setViewportSize(LAND)
    await page.getByRole('button', { name: '回到小孩模式' }).click()
    await page.waitForSelector('[data-testid=room]')
    await page.getByRole('button', { name: /家長入口/ }).click()
    await page.waitForSelector('button.key')
    await pressPin(page, '1234')
    await page.getByTestId('parent-tabs').waitFor()
    check('安裝：提示只出現一次', (await page.getByTestId('install-hint').count()) === 0)

    // apple-touch-startup-image：每個 media 都有對應的圖，大小正確
    const links = await page.evaluate(() => [...document.querySelectorAll('link[rel=apple-touch-startup-image]')].map((l) => ({ href: l.href, media: l.media })))
    check('啟動圖：iPad 橫直共 18 張', links.length === 18)
    const bad = []
    for (const l of links) {
      const m = /\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: (\w+)\)/.exec(l.media)
      const size = await page.evaluate((src) => new Promise((res) => {
        const im = new Image()
        im.onload = () => res([im.naturalWidth, im.naturalHeight])
        im.onerror = () => res(null)
        im.src = src
      }), l.href)
      const [w, h, r, o] = [Number(m?.[1]), Number(m?.[2]), Number(m?.[3]), m?.[4]]
      const expect = o === 'portrait' ? [w * r, h * r] : [h * r, w * r]
      if (!size || size[0] !== expect[0] || size[1] !== expect[1] || !l.href.includes('/guaibao-quest/startup/')) bad.push(`${l.href} ${size}`)
    }
    check('啟動圖：每張都載得到、像素跟 media 查詢完全一樣（差一點 iOS 就不用）、路徑含 base', bad.length === 0, bad.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // ================= 關於與隱私 =================
  if (want('about')) {
    const { ctx, page } = await freshApp(browser, LAND)
    await openParentTab(page, '關於與隱私')
    await page.getByTestId('about-tab').waitFor()
    const text = await page.getByTestId('privacy').innerText()
    check('隱私：標明未經法律審查', /未經法律審查/.test(text))
    check('隱私：寫了資料存在這台裝置、不收集、不連第三方', /這台裝置/.test(text) && /不會把孩子的資料傳/.test(text) && /不連第三方/.test(text))
    check('隱私：寫了 GitHub Pages 主機的例外（照實寫）', /GitHub/.test(text))
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(vp)
      await page.waitForTimeout(150)
      check(`隱私：[${name}] 沒有橫向溢出`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      await shot(page, `about-${name}`)
    }
    await page.setViewportSize(LAND)
    await ctx.close()
    // 事實核對：玩一圈，看有沒有對外請求
    const { ctx: c2, page: p2 } = await freshApp(browser, LAND)
    const external = []
    p2.on('request', (r) => {
      const u = new URL(r.url())
      if (!['http:', 'https:'].includes(u.protocol)) return
      if (u.origin !== new URL(ROOT).origin) external.push(r.url())
    })
    await p2.reload()
    await p2.waitForSelector('[data-testid=room]')
    await p2.getByTestId('candy-map').click()
    await p2.waitForSelector('[data-testid=map]')
    await p2.locator('.back').first().click()
    await p2.waitForSelector('[data-testid=room]')
    await openParentTab(p2, '學習報告')
    await p2.waitForTimeout(500)
    check('隱私：實際玩一圈沒有任何對外（第三方）請求', external.length === 0, external.slice(0, 3).join(' '))
    await c2.close()
  }

  // ================= 離線內容包 =================
  if (want('pack')) {
    const manifest = JSON.parse(readFileSync(join(DIST, 'offline-pack.json'), 'utf8'))
    const files = manifest.groups.flatMap((g) => g.files.map(([path, size]) => ({ cache: g.cache, path, size })))
    const count = (re) => files.filter((f) => re.test(f.path)).length
    const onDisk = (d, re) => readdirSync(join(import.meta.dirname, '..', 'public', d), { recursive: true }).filter((f) => re.test(String(f))).length
    check('內容包：清單涵蓋全部語音', count(/^voice\/.*\.m4a$/) === onDisk('voice', /\.m4a$/) && count(/^voice\/.*\.m4a$/) > 3000, String(count(/^voice\/.*\.m4a$/)))
    check('內容包：清單涵蓋全部圖（含 coloring 子資料夾）', count(/^art\//) === onDisk('art', /\.(png|jpg)$/) && files.some((f) => f.path.startsWith('art/coloring/')), String(count(/^art\//)))
    check('內容包：清單涵蓋全部音樂與音效，網址含 ?v=', count(/^audio\/.*\.m4a\?v=/) === onDisk('audio', /\.m4a$/), String(count(/^audio\/.*\.m4a\?v=/)))
    check('內容包：兩份語音音訊清單也在內（離線才找得到檔案）', files.some((f) => f.path === 'voice/manifest.json' && f.cache === 'voice-manifest') && files.some((f) => f.path === 'audio/manifest.json' && f.cache === 'audio-manifest'))
    check('內容包：SW 的 maxEntries 比檔案數大（不然讀過就被清掉）', /maxEntries:8e3|maxEntries:8000/.test(originalSw.toString()) && count(/^voice\/.*\.m4a$/) < 8000)
    check('內容包：SW 的語音路由支援 Range（Safari 的 <audio> 必要）', /RangeRequestsPlugin/.test(originalSw.toString()))

    const { ctx, page, errors } = await freshApp(browser, LAND)
    await waitController(page)
    check('內容包：SW 第一次安裝就接管頁面', true)

    // 對照組：沒下載之前，斷網讀不到（證明後面的「讀得到」不是假的）
    const sampleVoice = files.find((f) => f.cache === 'voice').path
    const fetchStatus = (path, opts) => page.evaluate(async ([u, o]) => {
      try {
        const r = await fetch(u, o)
        await r.arrayBuffer()
        return r.status
      } catch {
        return 'fail'
      }
    }, [ROOT + path, opts ?? {}])
    await ctx.setOffline(true)
    check('對照組：還沒下載時，斷網讀不到語音', (await fetchStatus(sampleVoice)) === 'fail')
    await ctx.setOffline(false)

    await openParentTab(page, '備份與離線')
    await page.getByTestId('pack-start').waitFor({ timeout: 30000 })
    const sizeText = await page.getByTestId('pack-size').innerText()
    check('內容包：下載前顯示大小（MB）與檔案數', new RegExp(`${files.length} 個檔案`).test(sizeText) && /\d+ MB/.test(sizeText), sizeText)
    check('內容包：下載前顯示可用空間（navigator.storage.estimate）', (await page.getByTestId('pack-free').count()) === 1)
    await shot(page, 'pack-ready-land')

    // 併發：同時進行的請求不超過 4 個
    let live = 0
    let peak = 0
    let firstRun = 0
    const track = (r, d) => {
      if (r.url().includes('gqpack')) live += d
    }
    page.on('request', (r) => {
      if (r.url().includes('gqpack')) firstRun++
      track(r, 1)
      peak = Math.max(peak, live)
    })
    page.on('requestfinished', (r) => track(r, -1))
    page.on('requestfailed', (r) => track(r, -1))

    await page.getByTestId('pack-start').click()
    await page.getByTestId('pack-pause').waitFor()
    const done = () => page.getByTestId('pack-progress').getAttribute('data-done').then(Number)
    const base0 = await done()
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=pack-progress]')?.dataset.done) > n + 200, base0, { timeout: 120000 })
    await shot(page, 'pack-running-land')
    await page.getByTestId('pack-pause').click()
    await page.waitForSelector('[data-testid=pack-card][data-phase=paused]', { timeout: 20000 })
    const pausedAt = await done()
    check('內容包：有進度數字，暫停後停下來', pausedAt > base0 && pausedAt < files.length, `${pausedAt}/${files.length}`)
    check('內容包：同時最多 4 個請求', peak <= 4 && peak >= 2, `peak=${peak}`)

    // 中斷：直接重新載入頁面（等同關掉 App）
    await page.reload()
    await page.waitForSelector('[data-testid=room]')
    await openParentTab(page, '備份與離線')
    await page.waitForSelector('[data-testid=pack-card][data-phase=paused]', { timeout: 30000 })
    const resumedAt = await done()
    check('內容包：重新開 App 後進度還在（續傳）', resumedAt >= pausedAt, `${resumedAt} >= ${pausedAt}`)
    await shot(page, 'pack-paused-land')
    live = 0
    firstRun = 0
    await page.getByTestId('pack-start').click()
    // 下載到一半斷線：暫停、說明原因；網路回來自動接著下載
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=pack-progress]')?.dataset.done) > n + 40, resumedAt, { timeout: 120000 })
    await ctx.setOffline(true)
    await page.getByTestId('pack-problem').waitFor({ timeout: 60000 })
    check('內容包：下載到一半斷線 → 暫停並說明，已下載的還在', /連線中斷/.test(await page.getByTestId('pack-problem').innerText()) && (await page.getByTestId('pack-card').getAttribute('data-phase')) === 'paused', await page.getByTestId('pack-problem').innerText())
    await shot(page, 'pack-offline-land')
    const brokenAt = await done()
    await ctx.setOffline(false)
    // WebKit 的模擬斷網不一定發 online 事件：補發一次（真實裝置是系統發的）
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=pack-progress]')?.dataset.done) > n, brokenAt, { timeout: 60000 })
    check('內容包：網路回來自動接著下載', true)
    await page.waitForSelector('[data-testid=pack-card][data-phase=done]', { timeout: 590000 })
    check('內容包：全部下載完成', (await done()) === files.length, `${await done()}/${files.length}`)
    errors.length = 0 // 下載途中故意斷線時，還沒下載到的圖載不出來是預期的；下載完之後才不能有錯
    // 斷線時失敗的那幾個會重試（每個最多 3 次，連續 12 個就暫停），所以留一點餘裕
    check('內容包：續傳只下載還缺的（沒有重頭來）', firstRun <= files.length - resumedAt + 60, `第二次 ${firstRun} 個，還缺 ${files.length - resumedAt} 個`)
    await shot(page, 'pack-done-land')

    // 寫進 SW 用的同一個 Cache、同一個網址
    const cacheCheck = await page.evaluate(async (fs) => {
      const missing = []
      const byCache = new Map()
      for (const f of fs) {
        if (!byCache.has(f.cache)) byCache.set(f.cache, new Set((await (await caches.open(f.cache)).keys()).map((r) => r.url)))
        if (!byCache.get(f.cache).has(new URL(f.url, location.href).href)) missing.push(f.url)
      }
      const leftovers = [...byCache.values()].flatMap((s) => [...s]).filter((u) => u.includes('gqpack'))
      return { missing, leftovers, names: await caches.keys() }
    }, files.map((f) => ({ cache: f.cache, url: ROOT + f.path })))
    check('內容包：每個檔案都在 SW 的 Cache 裡（名稱、網址都對）', cacheCheck.missing.length === 0, cacheCheck.missing.slice(0, 3).join(' '))
    check('內容包：Cache 裡沒有 gqpack 的網址（SW 路由有放行）', cacheCheck.leftovers.length === 0, cacheCheck.leftovers.slice(0, 2).join(' '))

    // ---------- 真的斷網 ----------
    await ctx.setOffline(true)
    const negative = await fetchStatus('art/__not-in-cache__.png')
    check('斷網：不在快取裡的檔案讀不到（確認真的斷網了）', negative === 'fail', String(negative))

    // 每一個檔案都從 SW 讀得到
    const unreadable = await page.evaluate(async ({ root, paths }) => {
      const bad = []
      let i = 0
      const lane = async () => {
        while (i < paths.length) {
          const p = paths[i++]
          try {
            const r = await fetch(root + p)
            if (r.status !== 200) bad.push(`${p}:${r.status}`)
            else await r.arrayBuffer()
          } catch {
            bad.push(`${p}:fail`)
          }
        }
      }
      await Promise.all([lane(), lane(), lane(), lane()])
      return bad
    }, { root: ROOT, paths: files.map((f) => f.path) })
    check(`斷網：${files.length} 個檔案全部讀得到（經過 SW，含 ?v=）`, unreadable.length === 0, unreadable.slice(0, 3).join(' '))

    // Safari 的 <audio> 用 Range：要回 206
    const range = await page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { Range: 'bytes=0-99' } })
      return { status: r.status, len: (await r.arrayBuffer()).byteLength, cr: r.headers.get('content-range') }
    }, ROOT + sampleVoice)
    check('斷網：語音的 Range 請求回 206（Safari 才播得出來）', range.status === 206 && range.len === 100, JSON.stringify(range))

    // 真的用 <audio> 載入（語音走的路徑）
    const playable = await page.evaluate((u) => new Promise((res) => {
      const a = new Audio()
      a.preload = 'auto'
      a.onloadedmetadata = () => res({ ok: true, d: a.duration })
      a.onerror = () => res({ ok: false, e: a.error?.code })
      a.src = u
      a.load()
      setTimeout(() => res({ ok: false, e: 'timeout' }), 10000)
    }), ROOT + sampleVoice)
    check('斷網：<audio> 載得起語音（m4a）', playable.ok && playable.d > 0, JSON.stringify(playable))

    // 圖：真的畫出來
    const art = files.find((f) => f.path === 'art/title-keyart.jpg').path
    const imgOk = await page.evaluate((u) => new Promise((res) => {
      const im = new Image()
      im.onload = () => res(im.naturalWidth)
      im.onerror = () => res(0)
      im.src = u
    }), ROOT + art)
    check('斷網：圖載得出來', imgOk > 0, String(imgOk))

    // 整個 App 重新載入：離線冷啟動、chunk、題庫都在
    await page.evaluate(() => localStorage.setItem('gq-voice-pack-test', '1'))
    await page.reload()
    await page.waitForSelector('[data-testid=room]', { timeout: 30000 })
    check('斷網：冷啟動進得了首頁', true)
    const brokenArt = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 800))
      return [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src)
    })
    check('斷網：首頁沒有破圖', brokenArt.length === 0, brokenArt.slice(0, 3).join(' '))
    const chunks = readdirSync(join(DIST, 'assets')).map((f) => `assets/${f}`)
    const badChunks = await page.evaluate(async ({ root, paths }) => {
      const bad = []
      for (const p of paths) {
        try {
          if (!(await fetch(root + p)).ok) bad.push(p)
        } catch {
          bad.push(p)
        }
      }
      return bad
    }, { root: ROOT, paths: chunks })
    check(`斷網：${chunks.length} 個 chunk 與 CSS 全部讀得到`, badChunks.length === 0, badChunks.join(' '))
    await page.getByTestId('candy-map').click()
    await page.waitForSelector('[data-testid=map]', { timeout: 15000 })
    await page.getByTestId('station-1').click({ force: true })
    await page.waitForSelector('[data-testid=stage]', { timeout: 15000 })
    await page.waitForTimeout(300)
    check('斷網：關卡進得去（題庫與關卡 chunk 都在）', (await page.locator('[data-testid=stage]').count()) === 1)
    await shot(page, 'offline-stage-land')
    await page.getByTestId('leave').click()
    await page.getByTestId('leave-go').click()
    await page.waitForSelector('[data-testid=map]')
    await page.locator('.back').first().click()
    await page.waitForSelector('[data-testid=room]')
    for (const h of ['workshop', 'friends', 'album']) {
      await page.evaluate((x) => {
        location.hash = `#${x}`
      }, h)
      await page.waitForTimeout(600)
      check(`斷網：#${h} 沒有錯誤畫面`, (await page.getByTestId('error-screen').count()) === 0)
    }
    await page.evaluate(() => {
      location.hash = ''
    })
    await page.waitForSelector('[data-testid=room]')
    await openParentTab(page, '備份與離線')
    await page.waitForSelector('[data-testid=pack-card][data-phase=done]', { timeout: 30000 })
    check('斷網：家長區還是顯示已全部下載', /已全部下載/.test(await page.getByTestId('pack-progress').innerText()))
    await ctx.setOffline(false)
    // 對照組故意在斷網時讀快取裡沒有的檔案（WebKit 會把 SW 的 no-response 印成 console error）；下載途中斷線的 fetch 失敗也是故意的
    const realErrors = errors.filter((e) => !/Failed to fetch|Load failed|NetworkError|network|no-response|Fetch API cannot load/i.test(e))
    check('內容包：沒有其他錯誤', realErrors.length === 0, realErrors.join(' | ').slice(0, 200))
    await ctx.close()
  }
} finally {
  writeFileSync(SW, originalSw)
  await browser.close()
}

console.log(state.failed === 0 ? '\n全部通過' : `\n${state.failed} 項失敗`)
process.exit(state.failed === 0 ? 0 : 1)
