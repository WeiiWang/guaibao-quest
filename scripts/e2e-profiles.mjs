// v5 線 A（各自檔案與寵物）E2E：舊玩家升級、新增孩子、選孩子畫面、各自資料互不影響、換人確認、刪除要 PIN。
// 截圖存到 design/screens/v5-profiles-*.png（三種尺寸）。
// 用法：先啟動 dev server（例如 pnpm dev --port 5183 --strictPort），再
//   BASE_URL=http://localhost:5183 node scripts/e2e-profiles.mjs      （或 pnpm e2e:profiles）
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { center, drag, freshApp, launch, makeChecker, openParentTab, pressPin } from './e2e-lib.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../design/screens')
mkdirSync(OUT, { recursive: true })
const { state, check } = makeChecker()

const SIZES = {
  land: { width: 1024, height: 768 },
  port: { width: 768, height: 1024 },
  phone: { width: 375, height: 812 },
}
/** 三種尺寸各截一張，截完回到橫向 */
async function shots(page, name) {
  for (const [key, vp] of Object.entries(SIZES)) {
    await page.setViewportSize(vp)
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(OUT, `v5-profiles-${name}-${key}.png`) })
  }
  await page.setViewportSize(SIZES.land)
  await page.waitForTimeout(300)
}

// ---------- IndexedDB 小工具（任意資料庫名稱） ----------
const idbOf = (page, dbName, fn, arg) =>
  page.evaluate(
    ([name, src, arg]) =>
      new Promise((res, rej) => {
        const rq = indexedDB.open(name)
        rq.onerror = () => rej(rq.error)
        rq.onsuccess = async () => {
          try {
            const out = await new Function('return ' + src)()(rq.result, arg)
            rq.result.close()
            res(out)
          } catch (e) {
            rej(e)
          }
        }
      }),
    [dbName, fn.toString(), arg],
  )
const getAll = (page, dbName, table) =>
  idbOf(page, dbName, (db, t) => new Promise((res) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => res(e.target.result))), table)
const registryChildren = (page) => getAll(page, 'guaibao-registry', 'children')
const registryMeta = async (page, key) => (await getAll(page, 'guaibao-registry', 'meta')).find((m) => m.key === key)?.value
const dbNames = (page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
const putRows = (page, dbName, table, rows) =>
  idbOf(
    page,
    dbName,
    (db, a) =>
      new Promise((res) => {
        const tx = db.transaction(a.table, 'readwrite')
        for (const r of a.rows) tx.objectStore(a.table).put(r)
        tx.oncomplete = () => res(1)
      }),
    { table, rows },
  )
const petOf = async (page, dbName) => (await getAll(page, dbName, 'pets'))[0]
const stars = async (page, dbName) => (await getAll(page, dbName, 'ledger')).reduce((s, e) => s + e.delta, 0)

const helloName = (page) => page.locator('.hello-name').innerText()
const chipNum = (page) => page.locator('.chip-num').first().innerText()
const pickChild = async (page, name) => {
  await page.getByTestId('child-picker').waitFor()
  await page.getByTestId('child-card').filter({ hasText: name }).click()
  await page.waitForSelector('[data-testid=room]')
}

const browser = await launch()
try {
  const { ctx, page, errors } = await freshApp(browser, SIZES.land, { stage: 'baby' })
  await page.setViewportSize(SIZES.land)

  // ---------- 1. 舊玩家升級 ----------
  // 模擬 v5 之前的玩家：有進度，但沒有 registry。freshApp 做完後把 registry 刪掉，再重新整理。
  await putRows(page, 'guaibao-quest', 'ledger', [{ id: 'old-1', at: Date.now(), delta: 12, reason: '舊玩家的星星', kind: 'bonus' }])
  await idbOf(
    page,
    'guaibao-quest',
    (db) =>
      new Promise((res) => {
        const tx = db.transaction('settings', 'readwrite')
        const st = tx.objectStore('settings')
        st.get('main').onsuccess = (e) => st.put({ ...e.target.result, ageBand: '6-7' })
        tx.oncomplete = () => res(1)
      }),
  )
  const settingsBefore = (await getAll(page, 'guaibao-quest', 'settings'))[0]
  await page.evaluate(
    () =>
      new Promise((res) => {
        const rq = indexedDB.deleteDatabase('guaibao-registry')
        rq.onsuccess = rq.onerror = rq.onblocked = () => res(1)
      }),
  )
  check('（前置）registry 已刪掉，模擬舊玩家', !(await dbNames(page)).includes('guaibao-registry') || (await registryChildren(page)).length === 0)
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  check('舊玩家升級：直接進首頁（沒有 onboarding、沒有選孩子畫面）', (await page.getByTestId('child-picker').count()) === 0 && (await page.locator('button.key').count()) === 0)
  check('舊玩家升級：名字沿用', (await helloName(page)) === '小明')
  check('舊玩家升級：星星沒動', (await chipNum(page)) === '12', await chipNum(page))
  let kids = await registryChildren(page)
  check('舊玩家升級：registry 建立了 1 個孩子，用 guaibao-quest', kids.length === 1 && kids[0].dbName === 'guaibao-quest' && kids[0].name === '小明', JSON.stringify(kids))
  check('舊玩家升級：年齡從舊 settings 帶過來', kids[0].ageBand === '6-7')
  check('舊玩家升級：共用 PIN 從舊 settings 帶過來', (await registryMeta(page, 'pinHash')) === settingsBefore.pinHash)
  const settingsAfter = (await getAll(page, 'guaibao-quest', 'settings'))[0]
  check('舊資料庫的 settings.pinHash 與名字保留不動', settingsAfter.pinHash === settingsBefore.pinHash && settingsAfter.childName === '小明')
  const xiaoMing = kids[0]

  // ---------- 2. 新增第二個孩子 ----------
  await openParentTab(page, '設定')
  await page.getByTestId('kid-row').first().waitFor()
  check('家長設定有「孩子們」區塊，只有 1 個孩子時不能刪', (await page.getByTestId('kid-row').count()) === 1 && (await page.getByTestId('kid-delete').first().isDisabled()))
  await page.getByTestId('kid-add').click()
  await page.getByTestId('kid-name').fill('小花')
  await page.getByTestId('child-age-3').click()
  await page.getByTestId('kid-pet').fill('小猴')
  await shots(page, 'add-child')
  await page.getByTestId('kid-add-submit').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=kid-row]').length === 2)
  kids = await registryChildren(page)
  const xiaoHua = kids.find((k) => k.name === '小花')
  check('新增孩子：registry 有 2 個，第二個用 guaibao-quest-<id>', kids.length === 2 && xiaoHua?.dbName === `guaibao-quest-${xiaoHua?.id}`, JSON.stringify(kids))
  check('新增孩子：年齡存在 registry 與她自己的資料庫', xiaoHua.ageBand === '3' && (await getAll(page, xiaoHua.dbName, 'settings'))[0]?.ageBand === '3')
  check('新增孩子：寵物名字、是一顆蛋', (await petOf(page, xiaoHua.dbName))?.name === '小猴' && (await petOf(page, xiaoHua.dbName))?.stage === 'egg')
  check('新增孩子：沒有再設 PIN，她的資料庫沿用共用 PIN', (await getAll(page, xiaoHua.dbName, 'settings'))[0]?.pinHash === settingsBefore.pinHash)
  await shots(page, 'children-settings')

  // 年齡：v7 起只剩名冊的「改名/年齡」入口（沒有「孩子的年齡」卡片了）；改目前的孩子（小明）→ registry 與資料庫同步
  await page.locator(`[data-child-id="${xiaoMing.id}"] [data-testid=kid-edit]`).click()
  await page.getByTestId('child-age-4-5').click()
  await page.getByTestId('kid-edit-submit').click()
  await page.waitForTimeout(400)
  check('改目前孩子的年齡：registry 與資料庫同步', (await registryChildren(page)).find((k) => k.id === xiaoMing.id).ageBand === '4-5' && (await getAll(page, 'guaibao-quest', 'settings'))[0].ageBand === '4-5')
  // 改名/年齡（對別的孩子）
  await page.locator(`[data-child-id="${xiaoHua.id}"] [data-testid=kid-edit]`).click()
  await page.getByTestId('child-age-4-5').click()
  await page.getByTestId('kid-edit-submit').click()
  await page.waitForTimeout(400)
  check('改別的孩子的年齡：寫進她的資料庫', (await getAll(page, xiaoHua.dbName, 'settings'))[0]?.ageBand === '4-5' && (await registryChildren(page)).find((k) => k.id === xiaoHua.id).ageBand === '4-5')

  // ---------- 3. 選孩子畫面 ----------
  await putRows(page, xiaoHua.dbName, 'pets', [{ ...(await petOf(page, xiaoHua.dbName)), stage: 'baby', feedCount: 20, hunger: 90, hungerUpdatedAt: Date.now() }])
  await putRows(page, xiaoHua.dbName, 'inventory', [{ id: 'banana', itemId: 'banana', qty: 3 }])
  await putRows(page, xiaoHua.dbName, 'ledger', [{ id: 'hua-1', at: Date.now(), delta: 5, reason: '小花的星星', kind: 'bonus' }])
  await page.reload()
  await page.getByTestId('child-picker').waitFor()
  check('2 個孩子：開啟先顯示選孩子畫面（2 張卡片）', (await page.getByTestId('child-card').count()) === 2)
  check('選孩子畫面：沒有直接進首頁', (await page.getByTestId('room').count()) === 0)
  check('選孩子畫面：卡片有名字', (await page.locator('.picker-name').allInnerTexts()).join() === '小明,小花')
  await page.waitForSelector('.picker-face img')
  check('選孩子畫面：頭像是阿悟的圖', (await page.locator('.picker-face img').count()) >= 1)
  await shots(page, 'picker')

  // ---------- 4. 兩個孩子各自餵食與星星 ----------
  const mingPet0 = await petOf(page, 'guaibao-quest')
  const mingBanana0 = (await getAll(page, 'guaibao-quest', 'inventory')).find((i) => i.itemId === 'banana').qty
  await pickChild(page, '小花')
  check('點小花：進她的首頁', (await helloName(page)) === '小花')
  check('小花的星星 25（自己的 5 + v7 歡迎禮物 20）', (await chipNum(page)) === '25', await chipNum(page))
  await page.waitForTimeout(800)
  const a = await center(page, '[data-dock-item=banana]')
  const p = await center(page, '[data-testid=pet]')
  await drag(page, a, p)
  await page.waitForTimeout(1500)
  const huaPet = await petOf(page, xiaoHua.dbName)
  check('小花餵食：她的 feedCount +1', huaPet.feedCount === 21, `feedCount=${huaPet.feedCount}`)
  check('小花餵食：她的香蕉 3 → 2', (await getAll(page, xiaoHua.dbName, 'inventory')).find((i) => i.itemId === 'banana').qty === 2)
  const mingPet1 = await petOf(page, 'guaibao-quest')
  check('小花餵食不影響小明的阿悟與香蕉', mingPet1.feedCount === mingPet0.feedCount && (await getAll(page, 'guaibao-quest', 'inventory')).find((i) => i.itemId === 'banana').qty === mingBanana0)
  check('小花餵食不影響小明的星星', (await stars(page, 'guaibao-quest')) === 12 && (await stars(page, xiaoHua.dbName)) === 25)

  // ---------- 5. 換人確認 ----------
  await page.getByTestId('switch-person').click()
  await page.getByTestId('switch-confirm').waitFor()
  check('點左上頭像：阿悟問「要換人玩嗎？」', (await page.getByTestId('switch-confirm').innerText()).includes('要換人玩嗎？'))
  await shots(page, 'switch-confirm')
  await page.getByTestId('switch-no').click()
  await page.waitForTimeout(300)
  check('按「不要」：留在小花首頁', (await page.getByTestId('switch-confirm').count()) === 0 && (await helloName(page)) === '小花')
  await page.getByTestId('switch-person').click()
  await page.getByTestId('switch-yes').click()
  await page.getByTestId('child-picker').waitFor()
  check('按「要」：回選孩子畫面，不需要 PIN', (await page.locator('button.key').count()) === 0)
  await pickChild(page, '小明')
  check('換成小明：名字、星星、阿悟都是他自己的', (await helloName(page)) === '小明' && (await chipNum(page)) === '12')
  // 小明那邊的餵食
  await page.waitForTimeout(800)
  const a2 = await center(page, '[data-dock-item=banana]')
  const p2 = await center(page, '[data-testid=pet]')
  await drag(page, a2, p2)
  await page.waitForTimeout(1500)
  check('小明餵食：他的 feedCount +1，小花不變', (await petOf(page, 'guaibao-quest')).feedCount === mingPet0.feedCount + 1 && (await petOf(page, xiaoHua.dbName)).feedCount === 21)

  // ---------- 6. 遊玩時間各自計 ----------
  const pt = async (name) => (await getAll(page, name, 'playTime')).reduce((s, r) => s + r.seconds, 0)
  const huaBefore = await pt(xiaoHua.dbName)
  const mingBefore = await pt('guaibao-quest')
  await page.waitForTimeout(6500) // 讓 PlayTimeWatcher 寫入（每 5 秒）
  const huaAfter = await pt(xiaoHua.dbName)
  const mingAfter = await pt('guaibao-quest')
  check('遊玩時間各自計：小花離開時，她玩的秒數寫進她自己的資料庫', huaBefore >= 1, `小花 ${huaBefore}s`)
  check('遊玩時間各自計：換成小明後，小明增加、小花不再增加', mingAfter > mingBefore && huaAfter === huaBefore, `小明 ${mingBefore}→${mingAfter}s，小花 ${huaBefore}→${huaAfter}s`)

  // ---------- 7. 重設只重設目前的孩子 ----------
  await openParentTab(page, '設定')
  const mingSettings0 = (await getAll(page, 'guaibao-quest', 'settings'))[0]
  await page.getByRole('button', { name: '重設這個孩子的資料' }).first().click()
  await page.waitForSelector('button.key')
  await pressPin(page, '1234')
  await page.waitForTimeout(600)
  check('重設後：registry 與其他孩子還在', (await registryChildren(page)).length === 2 && (await petOf(page, xiaoHua.dbName)).feedCount === 21)
  check('重設後：不再問 PIN，直接是簡化 onboarding（名字已預填）', (await page.locator('button.key').count()) === 0 && (await page.getByPlaceholder('小朋友的名字').inputValue()) === '小明')
  await shots(page, 'reset-onboarding')
  await page.getByRole('button', { name: '下一步' }).click() // 名冊已有年齡，不再問「幾歲」
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '開始冒險' }).click()
  await page.waitForSelector('[data-testid=room]')
  const mingSettings1 = (await getAll(page, 'guaibao-quest', 'settings'))[0]
  check('簡化 onboarding 完成：沿用共用 PIN、年齡', mingSettings1.pinHash === mingSettings0.pinHash && mingSettings1.ageBand === '4-5')
  check('重設後星星歸零、PIN 1234 仍有效', (await stars(page, 'guaibao-quest')) === 0)
  await openParentTab(page, '學習報告') // 能用同一組 PIN 進家長區
  check('重設後共用 PIN 仍可進家長區', (await page.getByRole('tab', { name: '學習報告', exact: true }).getAttribute('aria-selected')) === 'true')

  // ---------- 8. 刪除孩子要 PIN ----------
  await page.reload()
  await pickChild(page, '小明')
  await openParentTab(page, '設定')
  await page.locator(`[data-child-id="${xiaoHua.id}"] [data-testid=kid-delete]`).click()
  await page.getByTestId('kid-delete-warning').waitFor()
  check('刪除前警告：阿悟和進度都會刪掉', (await page.getByTestId('kid-delete-warning').innerText()).includes('阿悟和進度都會刪掉'))
  await pressPin(page, '0000')
  check('刪除：PIN 錯誤不會刪', (await registryChildren(page)).length === 2 && (await dbNames(page)).includes(xiaoHua.dbName))
  check('刪除：PIN 錯誤有提示', (await page.locator('.modal').innerText()).includes('PIN 不正確'))
  await pressPin(page, '1234')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=kid-row]').length === 1)
  check('刪除：PIN 正確後 registry 只剩小明', (await registryChildren(page)).length === 1)
  await page.waitForTimeout(500)
  check('刪除：小花的資料庫真的刪掉了', !(await dbNames(page)).includes(xiaoHua.dbName), (await dbNames(page)).join())
  check('刪除：最後一個孩子的刪除鈕停用', await page.getByTestId('kid-delete').first().isDisabled())
  await page.reload()
  await page.waitForSelector('[data-testid=room]')
  check('只剩 1 個孩子：開啟直接進首頁', (await helloName(page)) === '小明' && (await page.getByTestId('child-picker').count()) === 0)
  check('只剩 1 個孩子：頭像不是按鈕（不能換人）', (await page.getByTestId('switch-person').count()) === 0)

  // ---------- 9. 刪掉「目前正在玩」的孩子 ----------
  await openParentTab(page, '設定')
  await page.getByTestId('kid-add').click()
  await page.getByTestId('kid-name').fill('小弟')
  await page.getByTestId('kid-add-submit').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=kid-row]').length === 2)
  const xiaoDi = (await registryChildren(page)).find((k) => k.name === '小弟')
  await page.reload()
  await pickChild(page, '小弟')
  await openParentTab(page, '設定')
  await page.locator(`[data-child-id="${xiaoDi.id}"] [data-testid=kid-delete]`).click()
  await pressPin(page, '1234')
  await page.waitForSelector('[data-testid=room]')
  await page.waitForTimeout(800)
  check('刪除目前正在玩的孩子：自動回到剩下的小明', (await helloName(page)) === '小明')
  check('刪除目前正在玩的孩子：資料庫刪掉、沒有錯誤', !(await dbNames(page)).includes(xiaoDi.dbName) && (await registryChildren(page)).length === 1)

  check('全程沒有頁面錯誤或 console error', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
} finally {
  await browser.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
