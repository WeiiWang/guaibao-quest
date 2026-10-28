// v7.2 E1：連連看（點點連線）E2E（Playwright）。涵蓋：
//   列表上的連連看一排（依年齡預設難度、每種難度 3 張免費、其餘 20 星）、連線（點擊、拖曳、點錯輕晃、閒置提示）、
//   連完封閉 → 剪影 → 3D 圖、中途離開再進來接續、拿去塗色、直接完成存進畫廊並計入畫框收藏、換星星解鎖、
//   中等 / 字母版、語音（數字、字母）、音效與語音開關、減少動態、版面（標籤不重疊、點在輪廓上、不破版），並截圖到 design/reviews/v72-shots/。
// 用法：先啟動 dev server（pnpm dev --port 5194 --strictPort），再
//   BASE_URL=http://localhost:5194 node scripts/e2e-dots.mjs      （或 pnpm e2e:dots）
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, idb, launch, makeChecker } from './e2e-lib.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../design/reviews/v72-shots')
mkdirSync(OUT, { recursive: true })
const { state, check } = makeChecker()
const VP = { width: 1180, height: 820 }
const SIZES = { land: VP, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }

// 假的 speechSynthesis：記下唸了什麼與語言
const SPEECH_STUB = () => {
  window.__spoken = []
  const fake = {
    speaking: false,
    speak(u) {
      window.__spoken.push({ t: u.text, lang: u.lang })
      window.setTimeout(() => u.onend && u.onend(), 30)
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
const spokenFull = (page) => page.evaluate(() => window.__spoken.slice())
const clearSpoken = (page) => page.evaluate(() => (window.__spoken.length = 0))

const dump = (page, table) =>
  idb(page, (db, t) => new Promise((res) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => res(e.target.result))), table)
const rowOf = async (page, id) => (await dump(page, 'coloring')).find((c) => c.pageId === id)
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
const addStars = (page, n) =>
  idb(page, (db, n) => new Promise((res) => (db.transaction('ledger', 'readwrite').objectStore('ledger').put({ id: `t${Math.random()}`, at: Date.now(), delta: n, reason: '測試', kind: 'bonus' }).onsuccess = () => res(1))), n)

const shot = async (page, name, tag = 'land') => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(OUT, `${tag}-${name}.png`) })
}

const openList = async (page) => {
  await page.getByRole('button', { name: /著色本/ }).first().click()
  await page.waitForSelector('[data-testid=page-monkey]')
}
const openCard = async (page, name) => {
  await page.getByTestId(`dots-${name}`).getByRole('button').click()
  await page.waitForSelector('[data-testid=dots-screen]')
  await page.waitForFunction(() => document.querySelector('[data-testid=dots-screen]')?.getAttribute('data-ready') === '1')
}
const screenAt = (page) => page.getByTestId('dots-screen').getAttribute('data-at').then(Number)
const phaseOf = (page) => page.getByTestId('dots-screen').getAttribute('data-phase')
const dotCenter = async (page, i) => {
  const b = await page.locator(`[data-dot="${i}"] .dt-dot-c`).boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const clickDot = async (page, i) => {
  const c = await dotCenter(page, i)
  await page.mouse.click(c.x, c.y)
}
const clickRange = async (page, from, to) => {
  for (let i = from; i < to; i++) {
    await clickDot(page, i)
    await page.waitForTimeout(40)
  }
}
const revealWait = (page) => page.waitForFunction(() => document.querySelector('[data-testid=dots-screen]')?.getAttribute('data-phase') === 'reveal', null, { timeout: 8000 })

/** 版面檢查：標籤互相不重疊、點的位置貼合輪廓（落在剪影路徑上或附近）、板子沒有橫向破版 */
const layoutCheck = (page) =>
  page.evaluate(() => {
    // SVG 文字的外框是整個字高（含上下留白），縮掉 14% 才接近實際字形
    const nums = [...document.querySelectorAll('.dt-num')].map((t) => {
      const r = t.getBoundingClientRect()
      const k = r.height * 0.14
      return { left: r.left, right: r.right, top: r.top + k, bottom: r.bottom - k }
    })
    let overlaps = 0
    for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) if (nums[i].left < nums[j].right && nums[i].right > nums[j].left && nums[i].top < nums[j].bottom && nums[i].bottom > nums[j].top) overlaps++
    const circles = [...document.querySelectorAll('.dt-dot-c')].map((c) => c.getBoundingClientRect())
    let covered = 0
    for (const n of nums) for (const c of circles) if (n.left < c.right && n.right > c.left && n.top < c.bottom && n.bottom > c.top) covered++
    const board = document.querySelector('[data-testid=dots-board]').getBoundingClientRect()
    const out = nums.filter((n) => n.left < board.left - 1 || n.right > board.right + 1 || n.top < board.top - 1 || n.bottom > board.bottom + 1).length
    const sil = document.querySelector('[data-testid=dots-sil]')
    const svg = document.querySelector('.dt-svg')
    // 點到剪影路徑的距離（用 SVG 的 isPointInStroke / 取樣）
    let maxOff = 0
    const len = sil.getTotalLength()
    const samples = []
    for (let i = 0; i < 400; i++) samples.push(sil.getPointAtLength((len * i) / 400))
    for (const g of document.querySelectorAll('.dt-dot')) {
      const x = Number(g.dataset.x)
      const y = Number(g.dataset.y)
      let best = Infinity
      for (const p of samples) best = Math.min(best, Math.hypot(p.x - x, p.y - y))
      maxOff = Math.max(maxOff, best)
    }
    void svg
    return { overlaps, covered, out, maxOff: Math.round(maxOff * 10) / 10, n: nums.length, scrollX: document.documentElement.scrollWidth > window.innerWidth + 1 }
  })

const browser = await launch()
try {
  // ================= 1) 列表 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP)
    await ctx.addInitScript(SPEECH_STUB)
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)
    check('列表：「空白畫紙」之後有連連看一排', (await page.getByTestId('dots-shelf').count()) === 1)
    const order = await page.evaluate(() => {
      const free = document.querySelector('[data-testid=free-card]')
      const shelf = document.querySelector('[data-testid=dots-shelf]')
      return !!(free.compareDocumentPosition(shelf) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    check('列表：連連看排在空白畫紙之後', order)
    check('列表：年齡沒設定（4–5 歲預設）→ 預設「簡單」', (await page.getByTestId('dots-shelf').getAttribute('data-level')) === 'e')
    check('列表：至少 12 張卡片', (await page.locator('[data-testid=dots-strip] > li').count()) >= 12)
    check('列表：每種難度前 3 張免費、其餘上鎖', (await page.locator('[data-testid^=dots-locked-]').count()) === 9 && (await page.locator('[data-testid^=dots-obj-]').count()) >= 2)
    check('列表：四個難度晶片（簡單、中等、挑戰、字母），都 ≥ 56px 高', await page.evaluate(() => [...document.querySelectorAll('.dt-lv')].length === 4 && [...document.querySelectorAll('.dt-lv')].every((b) => b.getBoundingClientRect().height >= 56)))
    await shot(page, '1-list')

    // 切難度
    await page.getByTestId('dots-level-m').click()
    check('列表：點「中等」切換難度', (await page.getByTestId('dots-shelf').getAttribute('data-level')) === 'm')
    await page.getByTestId('dots-level-a').click()
    check('列表：「字母」晶片切換', (await page.getByTestId('dots-shelf').getAttribute('data-level')) === 'a')
    await page.getByTestId('dots-level-e').click()

    // 年齡 6–7 歲 → 預設中等
    await patchSettings(page, { ageBand: '6-7' })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)
    check('列表：孩子 6–7 歲 → 預設「中等」', (await page.getByTestId('dots-shelf').getAttribute('data-level')) === 'm')
    await patchSettings(page, { ageBand: '3' })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)
    check('列表：孩子 3 歲 → 預設「簡單」', (await page.getByTestId('dots-shelf').getAttribute('data-level')) === 'e')
    await patchSettings(page, { ageBand: '4-5' })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)

    // ================= 2) 簡單版：連線 =================
    await openCard(page, 'obj-star')
    check('連線：簡單版 10 個點，從 0 開始', (await page.getByTestId('dots-screen').getAttribute('data-n')) === '10' && (await screenAt(page)) === 0)
    const sp0 = await spoken(page)
    check('連線：進來唸一句開場提示（從數字一開始）', sp0.some((t) => /從數字一開始/.test(t)), sp0.join('|'))
    const labels0 = await page.locator('.dt-num').evaluateAll((els) => els.map((e) => e.textContent))
    check('連線：標籤是 1–10', labels0.join(',') === '1,2,3,4,5,6,7,8,9,10', labels0.join(','))
    check('連線：第一個點是「下一個」（發亮）', (await page.locator('[data-dot="0"]').getAttribute('data-state')) === 'next')
    const lay = await layoutCheck(page)
    check('版面：標籤不互相重疊、不蓋到點、不出板子', lay.overlaps === 0 && lay.covered === 0 && lay.out === 0, JSON.stringify(lay))
    check('版面：每個點都落在輪廓上（誤差 < 6 單位）', lay.maxOff < 6, String(lay.maxOff))
    // 點的點擊範圍 ≥ 48px（直徑）：離中心 23px 的位置點得到
    const c3 = await dotCenter(page, 0)
    await page.mouse.click(c3.x + 22, c3.y)
    check('觸控：離點中心 22px 也點得到（範圍 ≥ 48px）', (await screenAt(page)) === 1)

    // 點錯：不前進、輕晃、不算錯、沒有扣東西
    await clearSpoken(page)
    await clickDot(page, 6)
    await page.waitForTimeout(80)
    check('點錯：不前進', (await screenAt(page)) === 1)
    check('點錯：那個點輕晃一下', (await page.locator('[data-dot="6"].dt-wobble').count()) === 1)
    check('點錯：不唸、沒有錯誤提示', (await spoken(page)).length === 0 && (await page.locator('.toast').count()) === 0)
    await page.waitForTimeout(700)
    check('點錯：晃完就清掉', (await page.locator('.dt-wobble').count()) === 0)

    // 點對：唸數字（優先用預錄的 num.n，沒有檔案就退回語音），連線出現
    await clearSpoken(page)
    await clickDot(page, 1)
    await page.waitForTimeout(100)
    check('點對：下一個點前進（at=2）', (await screenAt(page)) === 2)
    const sp1 = await spoken(page)
    check('點對：唸「二」', sp1.includes('二'), sp1.join('|'))
    check('點對：已連的線出現', (await page.getByTestId('dots-line').count()) === 1)

    // 拖曳：從上一點拖到下一點
    const from = await dotCenter(page, 1)
    const to2 = await dotCenter(page, 2)
    const to3 = await dotCenter(page, 3)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to2.x, to2.y, { steps: 8 })
    check('拖曳：拖到下一個點就連上', (await screenAt(page)) === 3)
    await page.mouse.move(to3.x, to3.y, { steps: 8 })
    check('拖曳：不放手繼續拖到再下一個', (await screenAt(page)) === 4)
    check('拖曳：手指後面有一條跟著走的線', (await page.locator('.dt-rubber').count()) === 1)
    await page.mouse.up()
    // 拖過去但「跳過」下一個點的話不會連（只有下一個點算）
    const skip = await dotCenter(page, 8)
    await page.mouse.move(to3.x, to3.y)
    await page.mouse.down()
    await page.mouse.move(skip.x, skip.y, { steps: 8 })
    await page.mouse.up()
    check('拖曳：跳過下一個點不會連', (await screenAt(page)) === 4)

    // 閒置：5 秒 → 放大脈動
    check('閒置：剛操作過，沒有脈動', (await page.locator('.dt-board.dt-idle').count()) === 0)
    await page.waitForTimeout(5400)
    check('閒置 5 秒：下一個點放大脈動提示', (await page.locator('.dt-board.dt-idle').count()) === 1)
    await shot(page, '2-halfway')
    await clickDot(page, 4)
    await page.waitForTimeout(100)
    check('連上之後：脈動停止', (await page.locator('.dt-board.dt-idle').count()) === 0)

    // ================= 3) 中途離開再進來 =================
    check('存檔：進度寫在 coloring 表 dots:obj-star:e 的 dotsAt', (await rowOf(page, 'dots:obj-star:e'))?.dotsAt === 5)
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=dots-shelf]')
    await page.waitForFunction(() => /連到/.test(document.querySelector('[data-testid=dots-obj-star] [data-testid=dots-sub]')?.textContent ?? ''), null, { timeout: 4000 }).catch(() => {})
    const subTxt = await page.getByTestId('dots-obj-star').getByTestId('dots-sub').innerText()
    check('列表：卡片顯示「連到 5/10」', /連到 5\/10/.test(subTxt), subTxt)
    await openCard(page, 'obj-star')
    check('中途離開再進來：接著連（at=5）', (await screenAt(page)) === 5)
    check('接續：已連的點與線都在', (await page.locator('[data-dot][data-state=on]').count()) === 5 && (await page.getByTestId('dots-line').count()) === 1)
    const sp2 = await spoken(page)
    void sp2
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)
    await openCard(page, 'obj-star')
    check('重新整理頁面：進度還在（at=5）', (await screenAt(page)) === 5)

    // ================= 4) 連完：封閉 → 剪影 → 3D 圖 =================
    await clickRange(page, 5, 9)
    check('連完前一刻：還是玩的階段', (await phaseOf(page)) === 'play' && (await screenAt(page)) === 9)
    await clearSpoken(page)
    await page.evaluate(() => (window.__audio.osc = 0))
    await clickDot(page, 9)
    await page.waitForFunction(() => document.querySelector('[data-testid=dots-screen]')?.getAttribute('data-phase') === 'close', null, { timeout: 2000 })
    check('連完最後一點：自動接回起點、封閉圖形', (await page.getByTestId('dots-close').count()) === 1)
    await page.waitForFunction(() => document.querySelector('[data-testid=dots-screen]')?.getAttribute('data-phase') === 'solid', null, { timeout: 3000 })
    await page.waitForTimeout(400)
    const silOp = await page.getByTestId('dots-sil').evaluate((e) => getComputedStyle(e).opacity)
    check('封閉後：線條變成實心剪影', Number(silOp) > 0.3, silOp)
    await shot(page, '3-silhouette')
    await revealWait(page)
    await page.waitForTimeout(1100)
    const imgOp = await page.getByTestId('dots-img').evaluate((e) => getComputedStyle(e).opacity)
    check('揭曉：淡入原本的 3D 圖', Number(imgOp) > 0.95, imgOp)
    check('揭曉：有慶祝音效（WebAudio 有發聲）', (await page.evaluate(() => window.__audio.osc)) >= 5)
    const sp3 = await spoken(page)
    check('揭曉：阿悟說一句（含「星星」）', sp3.some((t) => /星星/.test(t) && /連出來/.test(t)), sp3.join('|'))
    check('揭曉：氣泡顯示同一句', /星星/.test(await page.getByTestId('dots-line-text').innerText()))
    check('揭曉：三個按鈕（拿去塗色、完成、再連一次）', (await page.getByTestId('dots-to-paint').count()) === 1 && (await page.getByTestId('dots-finish').count()) === 1 && (await page.getByTestId('dots-again').count()) === 1)
    check('揭曉：按鈕 ≥ 56px 高', await page.evaluate(() => [...document.querySelectorAll('.dt-panel .btn')].every((b) => b.getBoundingClientRect().height >= 56)))
    check('存檔：連完 dotsDone = true、at = 10', await rowOf(page, 'dots:obj-star:e').then((r) => r?.dotsDone === true && r?.dotsAt === 10))
    await shot(page, '4-reveal')

    // ================= 5) 拿去塗色 =================
    await page.getByTestId('dots-to-paint').click()
    await page.waitForSelector('[data-testid=paint-screen]')
    check('拿去塗色：進入著色畫面，頁面是這張連連看', (await page.getByTestId('paint-screen').getAttribute('data-page')) === 'dots:obj-star:e')
    check('拿去塗色：剪影是一個可填色的區塊', (await page.locator('.coloring-svg [data-region]').count()) === 1 && (await page.locator('[data-region=shape]').count()) === 1)
    const sb = await page.locator('[data-region=shape]').boundingBox()
    await page.getByTestId('tool-fill').click()
    const colors = page.locator('[data-testid=palette] .swatch')
    await colors.nth(3).click()
    await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2)
    await page.waitForTimeout(150)
    const fillOf = await page.locator('[data-region=shape]').getAttribute('data-fill')
    check('拿去塗色：點一下剪影就填上顏色', !!fillOf, String(fillOf))
    // 筆刷與貼紙也能用
    await page.getByTestId('tool-brush').click()
    const bb = await page.locator('.pt-board').boundingBox()
    await page.mouse.move(bb.x + bb.width * 0.4, bb.y + bb.height * 0.4)
    await page.mouse.down()
    await page.mouse.move(bb.x + bb.width * 0.6, bb.y + bb.height * 0.55, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(150)
    check('拿去塗色：筆刷可用（存進同一列）', ((await rowOf(page, 'dots:obj-star:e'))?.strokes?.length ?? 0) >= 1)
    check('拿去塗色：畫板存檔沒有蓋掉連線進度', await rowOf(page, 'dots:obj-star:e').then((r) => r?.dotsDone === true && r?.dotsAt === 10))
    await page.getByTestId('tool-fill').click()
    await shot(page, '5-paint')
    // 完成：連連看塗色頁不看完成度（有塗就算）
    await page.getByTestId('finish-btn').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('塗色完成：沒有「再畫一點好嗎」，直接慶祝', (await page.getByTestId('finish-more').count()) === 0)
    check('塗色完成：算一幅，解鎖木框', (await page.getByTestId('frame-unlock').getAttribute('data-frame')) === 'wood')
    let g = await dump(page, 'coloring')
    let works = g.filter((w) => w.pageId.startsWith('g:'))
    check('畫廊：多一幅，basePageId 是連連看頁', works.length === 1 && works[0].basePageId === 'dots:obj-star:e' && works[0].png.startsWith('data:image/'))
    check('畫框收藏：累計 1 幅', (await dump(page, 'settings'))[0].framesDone === 1)
    await page.getByTestId('hang-btn').click()
    await page.waitForSelector('[data-testid=hung-ok]')
    check('塗色完成：可以掛到房間', (await dump(page, 'placements')).some((p) => p.itemId.startsWith('art-')))
    await page.getByRole('button', { name: '回著色本' }).click()
    await page.waitForSelector('[data-testid=dots-shelf]')
    await page.waitForFunction(() => /連好了/.test(document.querySelector('[data-testid=dots-obj-star] [data-testid=dots-sub]')?.textContent ?? ''), null, { timeout: 4000 }).catch(() => {})
    check('列表：塗過的連連看卡片顯示「連好了」', /連好了/.test(await page.getByTestId('dots-obj-star').getByTestId('dots-sub').innerText()))

    // ================= 6) 直接完成（不塗色）→ 畫廊 =================
    await openCard(page, 'obj-fish')
    await clickRange(page, 0, 10)
    await revealWait(page)
    await page.getByTestId('dots-finish').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    g = await dump(page, 'coloring')
    works = g.filter((w) => w.pageId.startsWith('g:'))
    check('直接完成：存進畫廊（第 2 幅），圖是 3D 圖', works.length === 2 && works.some((w) => w.basePageId === 'dots:obj-fish:e'))
    check('直接完成：計入畫框收藏（累計 2）', (await dump(page, 'settings'))[0].framesDone === 2)
    await shot(page, '6-finish')
    await page.getByRole('button', { name: '看我的畫廊' }).click()
    await page.waitForSelector('[data-testid=gallery]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=gallery-item]').length >= 2, null, { timeout: 4000 }).catch(() => {})
    check('畫廊：看得到連連看的作品', (await page.getByTestId('gallery-item').count()) === 2, String(await page.getByTestId('gallery-item').count()))
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=dots-shelf]')

    // 同一張再按完成不重複累計
    await openCard(page, 'obj-fish')
    check('連完的頁面再進來：直接是揭曉畫面', (await phaseOf(page)) === 'reveal')
    await page.getByTestId('dots-finish').click()
    await page.waitForSelector('[data-testid=finish-celebration]')
    check('同一張沒再畫就重複按完成：不重複累計（還是 2）', (await dump(page, 'settings'))[0].framesDone === 2)
    await page.getByRole('button', { name: '回著色本' }).click()
    await page.waitForSelector('[data-testid=dots-shelf]')

    // 再連一次
    await openCard(page, 'obj-fish')
    await page.getByTestId('dots-again').click()
    const rf = await rowOf(page, 'dots:obj-fish:e')
    check('再連一次：從頭開始（at=0）、進度歸零', (await screenAt(page)) === 0 && (await phaseOf(page)) === 'play' && rf?.dotsAt === 0, JSON.stringify([await screenAt(page), await phaseOf(page), rf?.dotsAt]))
    check('再連一次：畫廊裡完成過的作品還在（含重複按完成的那幅）', (await dump(page, 'coloring')).filter((w) => w.pageId.startsWith('g:')).length === 3, String((await dump(page, 'coloring')).filter((w) => w.pageId.startsWith('g:')).length))
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=dots-shelf]')

    // ================= 7) 用星星換 =================
    await page.getByTestId('dots-locked-obj-apple').getByRole('button').click()
    await page.waitForSelector('[data-testid=dots-guide]')
    const spLock = await spoken(page)
    check('上鎖：點鎖頭唸「這張要用20顆星星換喔」', spLock.some((t) => /20顆星星/.test(t)), spLock.slice(-2).join('|'))
    await page.getByTestId('dots-unlock').click()
    await page.waitForTimeout(250)
    check('星星不夠：不開、不扣（還在說明卡）', (await page.getByTestId('dots-guide').count()) === 1 && (await page.getByTestId('dots-screen').count()) === 0)
    await addStars(page, 50)
    await page.waitForTimeout(250)
    const before = (await dump(page, 'ledger')).reduce((s, l) => s + l.delta, 0)
    await page.getByTestId('dots-unlock').click()
    await page.waitForSelector('[data-testid=dots-screen]')
    const after = (await dump(page, 'ledger')).reduce((s, l) => s + l.delta, 0)
    check('用星星換：扣 20 顆、直接進到連線畫面', after === before - 20 && (await page.getByTestId('dots-screen').getAttribute('data-page')) === 'dots:obj-apple:e', `${before}→${after}`)
    check('用星星換：背包有紀錄 coloring-dots:obj-apple:e', (await dump(page, 'inventory')).some((i) => i.itemId === 'coloring-dots:obj-apple:e' && i.qty === 1))
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=dots-shelf]')
    await page.waitForSelector('[data-testid=dots-obj-apple]', { timeout: 4000 }).catch(() => {})
    check('用星星換：回列表那一張已解鎖', (await page.getByTestId('dots-obj-apple').count()) === 1 && (await page.locator('[data-testid^=dots-locked-]').count()) === 8)
    check('用星星換：同一張的其他難度還是鎖著', await (async () => {
      await page.getByTestId('dots-level-m').click()
      return (await page.getByTestId('dots-locked-obj-apple').count()) === 1
    })())
    await page.getByTestId('dots-level-e').click()
    check('頁面沒有錯誤', errors.length === 0, errors.join(' / '))
    await ctx.close()
  }

  // ================= 8) 中等與字母版、語音開關、減少動態 =================
  {
    const { ctx, page, errors } = await freshApp(browser, VP)
    await ctx.addInitScript(SPEECH_STUB)
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)
    await page.getByTestId('dots-level-m').click()
    await openCard(page, 'obj-star')
    check('中等：20 個點', (await page.getByTestId('dots-screen').getAttribute('data-n')) === '20')
    let lay = await layoutCheck(page)
    check('中等：標籤不重疊、不蓋到點', lay.overlaps === 0 && lay.covered === 0 && lay.out === 0, JSON.stringify(lay))
    await clickRange(page, 0, 12)
    await clearSpoken(page)
    await clickDot(page, 12)
    await page.waitForTimeout(100)
    const sp = await spoken(page)
    check('中等：數字 13 唸「十三」（有預錄 num.13）', sp.includes('十三'), sp.join('|'))
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=dots-shelf]')
    check('中等：進度是這一關自己的（簡單版沒被動到）', (await rowOf(page, 'dots:obj-star:e')) === undefined && (await rowOf(page, 'dots:obj-star:m'))?.dotsAt === 13)

    await page.getByTestId('dots-level-h').click()
    await openCard(page, 'obj-star')
    check('挑戰：30 個點', (await page.getByTestId('dots-screen').getAttribute('data-n')) === '30')
    lay = await layoutCheck(page)
    check('挑戰：標籤不重疊、不蓋到點', lay.overlaps === 0 && lay.covered === 0 && lay.out === 0, JSON.stringify(lay))
    await clickRange(page, 0, 20)
    await clearSpoken(page)
    await clickDot(page, 20)
    await page.waitForTimeout(100)
    const sp21 = await spoken(page)
    check('挑戰：21 唸「二十一」（沒有預錄就用語音）', sp21.includes('二十一'), sp21.join('|'))
    await shot(page, '7-hard')
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=dots-shelf]')

    await page.getByTestId('dots-level-a').click()
    await openCard(page, 'obj-star')
    check('字母版：A–Z 共 26 個點', (await page.getByTestId('dots-screen').getAttribute('data-n')) === '26')
    const letters = await page.locator('.dt-num').evaluateAll((els) => els.map((e) => e.textContent))
    check('字母版：標籤是 A…Z', letters.join('') === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', letters.join(''))
    const spA = await spokenFull(page)
    check('字母版：開場唸「從字母 A 開始」', spA.some((s) => /字母 A/.test(s.t)), spA.map((s) => s.t).join('|'))
    lay = await layoutCheck(page)
    check('字母版：標籤不重疊、不蓋到點', lay.overlaps === 0 && lay.covered === 0 && lay.out === 0, JSON.stringify(lay))
    await clearSpoken(page)
    await clickDot(page, 0)
    await page.waitForTimeout(100)
    const spB = await spokenFull(page)
    check('字母版：連上 A 用英文語音唸「A」', spB.some((s) => s.t === 'A' && s.lang === 'en-US'), JSON.stringify(spB))
    await shot(page, '8-letters')

    // 語音關閉：不唸
    await patchSettings(page, { voiceOn: false })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)
    await page.getByTestId('dots-level-a').click()
    await openCard(page, 'obj-star')
    await clearSpoken(page)
    await clickDot(page, 1)
    await page.waitForTimeout(150)
    check('語音關閉：不唸字母', (await spoken(page)).length === 0)
    // 音效關閉
    await patchSettings(page, { soundOn: false })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await openList(page)
    await page.getByTestId('dots-level-a').click()
    await openCard(page, 'obj-star')
    await page.evaluate(() => (window.__audio.osc = 0))
    await clickDot(page, 2)
    await page.waitForTimeout(150)
    check('音效關閉：連點沒有聲音', (await page.evaluate(() => window.__audio.osc)) === 0)
    await patchSettings(page, { voiceOn: true, soundOn: true })
    check('頁面沒有錯誤', errors.length === 0, errors.join(' / '))
    await ctx.close()
  }

  // ================= 9) 減少動態 =================
  {
    const { ctx, page } = await freshApp(browser, VP, { ctxOpts: { reducedMotion: 'reduce' } })
    await openList(page)
    await openCard(page, 'food-banana')
    await clickRange(page, 0, 10)
    const t0 = Date.now()
    await revealWait(page)
    check('減少動態：連完很快就揭曉（沒有長動畫）', Date.now() - t0 < 1500, `${Date.now() - t0}ms`)
    check('減少動態：脈動、輕晃動畫關掉', await page.evaluate(() => ['.dt-glow', '.dt-wobble'].every((s) => !document.querySelector(s) || getComputedStyle(document.querySelector(s)).animationName === 'none')))
    await ctx.close()
  }

  // ================= 10) 三種裝置：版面與截圖 =================
  for (const [tag, vp] of Object.entries(SIZES)) {
    const touch = vp.width < 500 ? { hasTouch: true, isMobile: true } : {}
    const { ctx, page, errors } = await freshApp(browser, vp, { ctxOpts: touch })
    await openList(page)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    check(`[${tag}] 列表：沒有橫向破版`, !overflow)
    const shelfBox = await page.getByTestId('dots-shelf').boundingBox()
    check(`[${tag}] 列表：連連看一排在畫面寬度內`, shelfBox.x >= 0 && shelfBox.x + shelfBox.width <= vp.width + 1, JSON.stringify(shelfBox))
    await page.getByTestId('dots-shelf').scrollIntoViewIfNeeded()
    await shot(page, '1-list', tag)
    await page.getByTestId('dots-level-h').click()
    await openCard(page, 'obj-fish')
    let lay = await layoutCheck(page)
    check(`[${tag}] 挑戰 30 點：標籤不重疊、不蓋到點、不出板子`, lay.overlaps === 0 && lay.covered === 0 && lay.out === 0 && !lay.scrollX, JSON.stringify(lay))
    check(`[${tag}] 挑戰 30 點：點貼合輪廓`, lay.maxOff < 6, String(lay.maxOff))
    // 手機用觸控點：每個點的點擊範圍 ≥ 48px —— 用相鄰點最近距離與「下一個優先」確認可以連
    await page.getByTestId('dots-board').scrollIntoViewIfNeeded()
    for (let i = 0; i < 15; i++) {
      const c = await dotCenter(page, i)
      if (touch.hasTouch) await page.touchscreen.tap(c.x, c.y)
      else await page.mouse.click(c.x, c.y)
      await page.waitForTimeout(30)
    }
    check(`[${tag}] 連到一半（15/30）：${touch.hasTouch ? '觸控' : '滑鼠'}連得上`, (await screenAt(page)) === 15)
    await shot(page, '2-halfway', tag)
    for (let i = 15; i < 30; i++) {
      const c = await dotCenter(page, i)
      if (touch.hasTouch) await page.touchscreen.tap(c.x, c.y)
      else await page.mouse.click(c.x, c.y)
      await page.waitForTimeout(30)
    }
    await revealWait(page)
    await page.waitForTimeout(900)
    check(`[${tag}] 揭曉：3D 圖出現、沒有橫向破版`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
    await shot(page, '4-reveal', tag)
    await page.getByTestId('dots-to-paint').scrollIntoViewIfNeeded()
    await page.getByTestId('dots-to-paint').click()
    await page.waitForSelector('[data-testid=paint-screen]')
    const sb = await page.locator('[data-region=shape]').boundingBox()
    await page.getByTestId('tool-fill').click()
    await page.locator('[data-testid=palette] .swatch').nth(5).click()
    if (touch.hasTouch) await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2)
    else await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2)
    await page.waitForTimeout(200)
    await shot(page, '5-paint', tag)
    // 字母版
    await page.getByRole('button', { name: /著色本/ }).first().click()
    await page.waitForSelector('[data-testid=dots-shelf]')
    await page.getByTestId('dots-level-a').click()
    await openCard(page, 'obj-star')
    lay = await layoutCheck(page)
    check(`[${tag}] 字母版：標籤不重疊、不蓋到點`, lay.overlaps === 0 && lay.covered === 0 && lay.out === 0, JSON.stringify(lay))
    for (let i = 0; i < 9; i++) {
      const c = await dotCenter(page, i)
      if (touch.hasTouch) await page.touchscreen.tap(c.x, c.y)
      else await page.mouse.click(c.x, c.y)
      await page.waitForTimeout(30)
    }
    await shot(page, '8-letters', tag)
    check(`[${tag}] 沒有錯誤`, errors.length === 0, errors.join(' / '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
