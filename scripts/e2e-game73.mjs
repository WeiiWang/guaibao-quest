// v7.3 線 G「遊戲性與版面」E2E（Playwright）：
//   G1 吃飽仍可餵、每日成長上限、6 次孵化、既有存檔補孵化 / 長大並播慶祝
//   G2 文字選項的小喇叭（點卡片直接作答） G3 英文長單字（字級、不斷字、喇叭不壓字）
//   G4 compare 小圖示與兩色對比、measure 的卡片底框 G5 手機 / 直向 / 6–7 歲橫向地圖版面 G6 朋友入口在首頁右側欄
// 用法：BASE_URL=http://localhost:5197 node scripts/e2e-game73.mjs（E2E_BROWSER=webkit 用 Safari 引擎 + iPad 模擬）
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, getPet, idb, launch, makeChecker, patchPet } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT = join(ROOT, 'src/learning/content')
const BANK = Object.fromEntries(['number', 'classify', 'pattern', 'measure', 'space', 'observe', 'english', 'life', 'nature'].flatMap((f) => JSON.parse(readFileSync(join(CONTENT, `${f}.json`), 'utf8'))).map((q) => [q.id, q]))
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const { state, check } = makeChecker()
const CHAPTER = { number: ['math', 'huaguoshan'], english: ['english', 'english-island'], life: ['life', 'life-town'], nature: ['nature', 'nature-forest'], measure: ['math', 'huaguoshan'] }

const patchSettings = (page, patch) =>
  idb(page, (db, patch) => new Promise((r) => { const s = db.transaction('settings', 'readwrite').objectStore('settings'); s.get('main').onsuccess = (e) => { s.put({ ...e.target.result, ...patch }).onsuccess = () => r(1) } }), patch)
const dump = (page, t) => idb(page, (db, t) => new Promise((r) => (db.transaction(t).objectStore(t).getAll().onsuccess = (e) => r(e.target.result))), t)
const go = async (page, hash) => { await page.evaluate((h) => (location.hash = h), hash); await page.waitForTimeout(300) }
const qtyOf = async (page, id) => (await dump(page, 'inventory')).find((i) => i.id === id)?.qty ?? 0
const todayStr = (page) => page.evaluate(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })
const hsv = (rgb) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).map(Number).map((v) => v / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: ((h * 60) + 360) % 360, s: mx === 0 ? 0 : d / mx, v: mx }
}

/** 讓關卡第 1 題就是指定的題目（寫一份 stageDraft） */
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
  await page.waitForTimeout(900)
}

const browser = await launch()
try {
  // =====================================================================
  // G6 朋友入口在首頁右側欄
  // =====================================================================
  for (const [tag, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    await patchSettings(page, { homeGuideShown: true })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    const info = await page.evaluate(() => {
      const kids = [...document.querySelectorAll('.side-tools > *')]
      const labels = kids.map((e) => e.textContent.trim())
      const f = document.querySelector('.side-tools [data-testid=friends-btn]')?.getBoundingClientRect()
      const dock = document.querySelector('.dock-row')?.getBoundingClientRect()
      const last = document.querySelector('.side-tools').getBoundingClientRect()
      const arrow = document.querySelector('[data-testid=room-right]')?.getBoundingClientRect()
      const arrowHit = !!arrow && kids.some((k) => { const b = k.getBoundingClientRect(); return !(b.right <= arrow.left || b.left >= arrow.right || b.bottom <= arrow.top || b.top >= arrow.bottom) })
      return { labels, w: f?.width, h: f?.height, right: f?.right, vw: innerWidth, bottom: last.bottom, dockTop: dock?.top ?? 0, overflow: document.documentElement.scrollWidth > innerWidth + 2, arrow: !!arrow, arrowHit }
    })
    check(`[${tag}] 右側欄：工坊、背包、朋友、更多（朋友與工坊、背包並列）`, ['工坊', '背包', '朋友', '更多'].every((n, i) => info.labels[i]?.endsWith(n)) && info.labels.length === 4, info.labels.join('|'))
    check(`[${tag}] 朋友按鈕 >= 56px、在畫面內、右側欄沒壓到食物欄`, info.w >= 56 && info.h >= 56 && info.right <= info.vw && info.bottom < info.dockTop, JSON.stringify(info))
    check(`[${tag}] 首頁不橫向溢出`, !info.overflow)
    check(`[${tag}] 往右看房間的箭頭沒有被右側欄蓋住`, info.arrow && !info.arrowHit, JSON.stringify({ arrow: info.arrow, hit: info.arrowHit }))
    await page.getByTestId('more-btn').click()
    const tray = await page.locator('[data-testid=more-tray] .mini-candy span:last-child').allInnerTexts()
    check(`[${tag}] 「更多」托盤裡沒有朋友了`, !tray.includes('朋友'), tray.join('|'))
    await page.keyboard.press('Escape')
    await page.getByTestId('friends-btn').click()
    check(`[${tag}] 點朋友一下就進圖鑑`, await page.waitForSelector('[data-testid=friends]', { timeout: 4000 }).then(() => true, () => false))
    check(`[${tag}] 無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }

  // =====================================================================
  // G1 餵食：吃飽仍可餵、每日上限、6 次孵化、既有存檔補孵化 / 長大
  // =====================================================================
  {
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { stage: 'egg', bananas: 10 })
    await patchSettings(page, { homeGuideShown: true })
    // 吃飽時也能把蛋餵到孵化：6 次，每次成長 +1（飽足一直在上限）
    for (let n = 1; n <= 6; n++) {
      await patchPet(page, { hunger: 100, hungerUpdatedAt: Date.now() })
      await page.reload()
      await page.waitForSelector('[data-testid=pet]')
      await page.waitForTimeout(450)
      await page.locator('[data-dock-item=banana]').click()
      await page.waitForTimeout(n === 6 ? 900 : 1800)
      const pet = await getPet(page)
      check(`蛋吃飽了仍可餵：第 ${n} 次 feedCount=${n}、飽足仍在上限、食物 ${10 - n} 個`, pet.feedCount === n && Math.round(pet.hunger) === 100 && (await qtyOf(page, 'banana')) === 10 - n, `${pet.feedCount} ${pet.hunger}`)
      if (n === 5) check('第 5 次還是蛋', pet.stage === 'egg')
    }
    const hatched = await getPet(page)
    check('第 6 次孵化成幼體', hatched.stage === 'baby', hatched.stage)
    check('孵化的當下有慶祝畫面', await page.getByText('阿悟孵出來了').waitFor({ timeout: 4000 }).then(() => true, () => false))
    check('孵化的回憶卡寫進相簿（標「新」）', ((await dump(page, 'settings'))[0].album ?? []).some((c) => c.id === 'hatch' && c.fresh), '')
    check('無 console 錯誤（餵食與孵化）', errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  {
    // 每日上限：今天已經長了 11 → 再餵 1 次到 12 → 之後拒絕，食物不扣；隔天歸零
    const { ctx, page } = await freshApp(browser, SIZES.land, { bananas: 6 })
    await patchSettings(page, { homeGuideShown: true })
    await patchPet(page, { hunger: 100, hungerUpdatedAt: Date.now(), growth: { date: await todayStr(page), n: 11 } })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await page.waitForTimeout(500)
    await page.locator('[data-dock-item=banana]').click()
    await page.waitForTimeout(3400) // 吃飽了還吃的那段約 3 秒，拒絕的反應要等它演完
    check('第 12 次還可以餵（成長 11 → 12、食物 6 → 5）', (await getPet(page)).growth?.n === 12 && (await qtyOf(page, 'banana')) === 5)
    await page.locator('[data-dock-item=banana]').click()
    await page.waitForTimeout(500)
    check('第 13 次被拒絕：食物不扣、成長不變', (await qtyOf(page, 'banana')) === 5 && (await getPet(page)).growth?.n === 12)
    check('拒絕時阿悟說「肚子撐撐的，明天再吃好不好？」', ((await page.getByTestId('pet-bubble').innerText().catch(() => '')) || '').includes('肚子撐撐的'))
    await ctx.close()
  }
  {
    // 既有存檔：feedCount 已經 >= 6 的蛋，進首頁正常孵化並播慶祝；幼體 feedCount 66–79 長大成體
    const { ctx, page, errors } = await freshApp(browser, SIZES.land, { stage: 'egg' })
    await patchSettings(page, { homeGuideShown: true })
    await patchPet(page, { stage: 'egg', feedCount: 9 })
    await page.reload()
    check('舊存檔蛋（feedCount 9）：進首頁播孵化慶祝', await page.getByText('阿悟孵出來了').waitFor({ timeout: 6000 }).then(() => true, () => false))
    check('舊存檔蛋：stage 變成 baby、feedCount 不變', (await getPet(page)).stage === 'baby' && (await getPet(page)).feedCount === 9)
    await page.getByRole('button', { name: '太棒了' }).click().catch(() => {})
    await patchPet(page, { stage: 'baby', feedCount: 70 })
    await page.reload()
    check('舊存檔幼體（feedCount 70 >= 66）：進首頁播長大慶祝', await page.getByText(/長大了/).first().waitFor({ timeout: 6000 }).then(() => true, () => false))
    check('舊存檔幼體：stage 變成 adult', (await getPet(page)).stage === 'adult')
    check('無 console 錯誤（補孵化）', errors.length === 0, errors.join('|'))
    await ctx.close()
  }

  // =====================================================================
  // G3 英文長單字 / G2 文字選項喇叭 / G4 compare、measure
  // =====================================================================
  for (const [tag, vp] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, vp)
    // ---- G3 ----
    await showQuestion(page, 'english-1-41') // lamp / star / watermelon，有喇叭的字卡
    const en = await page.evaluate(() => {
      const words = [...document.querySelectorAll('.g73-enword')].map((w) => {
        const r = w.getBoundingClientRect()
        const cs = getComputedStyle(w)
        const card = w.closest('.choice').getBoundingClientRect()
        const sp = w.closest('.q7-cardwrap')?.querySelector('.q7-speak')?.getBoundingClientRect()
        const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
        const hit = sp ? !(r.right <= sp.left || r.left >= sp.right || r.bottom <= sp.top || r.top >= sp.bottom) : false
        return { text: w.textContent, fs: parseFloat(cs.fontSize), oneLine: r.height <= lineH * 1.5, inCard: r.left >= card.left - 1 && r.right <= card.right + 1, hit, sp: sp ? [Math.round(sp.width), Math.round(sp.height)] : null, wb: cs.wordBreak, hy: cs.hyphens }
      })
      const box = document.querySelector('.qv-choices')
      return { words, cols: box.dataset.cols, vw: innerWidth, scrollW: document.documentElement.scrollWidth }
    })
    check(`[${tag}] 英文選項：字級 >= 28px、單字一行、不超出卡片、keep-all / 不斷字`, en.words.length === 3 && en.words.every((w) => w.fs >= 27.9 && w.oneLine && w.inCard && w.wb === 'keep-all' && w.hy === 'none'), JSON.stringify(en.words))
    check(`[${tag}] 英文選項：喇叭 >= 56px 且沒有壓到字`, en.words.every((w) => w.sp && w.sp[0] >= 56 && w.sp[1] >= 56 && !w.hit), JSON.stringify(en.words.map((w) => [w.text, w.sp, w.hit])))
    check(`[${tag}] 英文選項：${tag === 'phone' ? '手機放不下三欄 → 單欄（cols=1）' : '平板 3 欄並排'}`, tag === 'phone' ? en.cols === '1' : en.cols === '3', String(en.cols))
    check(`[${tag}] 英文選項：頁面不橫向溢出`, en.scrollW <= en.vw + 2)
    await page.locator('[data-testid=en-card-speak][data-choice-id=watermelon]').click()
    check(`[${tag}] 點喇叭不會作答`, (await page.locator('[data-testid=choice][data-state=wrong], [data-testid=choice][data-state=right]').count()) === 0)
    // 難度 3 的長單字：沒有喇叭，一樣不斷字
    await showQuestion(page, 'english-3-05')
    const en3 = await page.evaluate(() => [...document.querySelectorAll('.choice-word')].map((w) => ({ fs: parseFloat(getComputedStyle(w).fontSize), oneLine: w.getBoundingClientRect().height <= parseFloat(getComputedStyle(w).fontSize) * 1.8, inCard: w.getBoundingClientRect().right <= w.closest('.choice').getBoundingClientRect().right + 1 })))
    check(`[${tag}] 英文難度 3：長單字字級 >= 28px、一行、在卡片內`, en3.length === 3 && en3.every((w) => w.fs >= 27.9 && w.oneLine && w.inCard), JSON.stringify(en3))

    // ---- G2：生活／自然的文字選項 ----
    for (const id of ['life-2-39', 'nature-1-43', 'life-4-17']) {
      await showQuestion(page, id)
      const q = BANK[id]
      const info = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-testid=choice]')]
        const sp = [...document.querySelectorAll('[data-testid=word-speak]')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })
        const overlaps = cards.map((c) => {
          const w = c.closest('.q7-cardwrap')
          const s = w?.querySelector('[data-testid=word-speak]')?.getBoundingClientRect()
          const t = c.querySelector('.lw-text')?.getBoundingClientRect()
          return s && t ? !(t.right <= s.left || t.left >= s.right || t.bottom <= s.top || t.top >= s.bottom) : true
        })
        const colsN = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left))).size
        return { n: cards.length, sp, overlaps, colsN, armed: document.querySelectorAll('[data-armed]').length }
      })
      check(`[${tag}] ${id}：每張文字卡都有喇叭（>= 56px）、喇叭沒壓到字、沒有「武裝」狀態`, info.n === q.choices.length && info.sp.length === info.n && info.sp.every(([w, h]) => w >= 56 && h >= 56) && info.overlaps.every((o) => !o) && info.armed === 0, JSON.stringify(info))
      if (id === 'life-4-17') check(`[${tag}] ${id}：長句選項一欄（不會變直排字）`, info.colsN === 1, String(info.colsN))
      if (id === 'nature-1-43') {
        // 點卡片一下就作答（答對的那張）
        await page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`).click()
        await page.waitForSelector('.adv-bubble.ok', { timeout: 4000 }).catch(() => {})
        check(`[${tag}] 自然四季：點正確的文字卡一下就答對（不用點兩下）`, (await page.locator(`[data-testid=choice][data-choice-id="${q.answer}"]`).getAttribute('data-state')) === 'right')
      }
    }

    // ---- G4 compare：小圖示 >= 28px、藍橘兩色對比 ----
    await showQuestion(page, 'number-3-13') // 9 個 vs 12 個
    const cmp = await page.evaluate(() => {
      const sizes = [...document.querySelectorAll('.choice-pile .pile-item')].map((e) => e.getBoundingClientRect().width)
      const bg = [...document.querySelectorAll('.choice-pile')].map((e) => getComputedStyle(e).backgroundColor)
      const bd = [...document.querySelectorAll('.choice-pile')].map((e) => getComputedStyle(e).borderTopColor)
      const inCard = [...document.querySelectorAll('.choice-pile')].every((c) => { const r = c.getBoundingClientRect(); return [...c.querySelectorAll('.pile-item')].every((p) => { const b = p.getBoundingClientRect(); return b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom }) })
      return { min: Math.min(...sizes), n: sizes.length, bg, bd, inCard }
    })
    check(`[${tag}] compare：小圖示邊長 >= 28px（最小 ${Math.round(cmp.min)}px，共 ${cmp.n} 個）且都在卡片內`, cmp.n === 21 && cmp.min >= 28 && cmp.inCard, JSON.stringify(cmp))
    const [hb, ho] = cmp.bd.map(hsv)
    check(`[${tag}] compare：兩堆的框色對比明確（藍 vs 橘，色相差 >= 120°）`, Math.abs(hb.h - ho.h) >= 120 && hb.s > 0.4 && ho.s > 0.4, JSON.stringify(cmp.bd))
    await showQuestion(page, 'number-3-19') // 20 個 vs 17 個
    const cmp2 = await page.evaluate(() => ({ min: Math.min(...[...document.querySelectorAll('.choice-pile .pile-item')].map((e) => e.getBoundingClientRect().width)), vw: innerWidth, sw: document.documentElement.scrollWidth, cardsBottom: Math.max(...[...document.querySelectorAll('.choice-pile')].map((e) => e.getBoundingClientRect().bottom)), vh: innerHeight }))
    check(`[${tag}] compare（20 個）：小圖示 >= 28px、頁面不橫向溢出、卡片在畫面內`, cmp2.min >= 28 && cmp2.sw <= cmp2.vw + 2 && cmp2.cardsBottom <= cmp2.vh + 2, JSON.stringify(cmp2))

    // ---- G4 measure：比較長的選項像卡片 ----
    await showQuestion(page, 'measure-1-01')
    const ms = await page.evaluate(() => [...document.querySelectorAll('.dim-length.mz-card')].map((e) => { const cs = getComputedStyle(e); return { bw: parseFloat(cs.borderTopWidth), bc: cs.borderTopColor, bg: cs.backgroundImage.includes('gradient') || cs.backgroundColor !== 'rgb(255, 255, 255)', h: e.getBoundingClientRect().height } }))
    check(`[${tag}] measure 比較長：選項有底框（>= 3px）與淡底色、高度 >= 56px`, ms.length === 2 && ms.every((c) => c.bw >= 3 && c.bc !== 'rgba(0, 0, 0, 0)' && c.bg && c.h >= 56), JSON.stringify(ms))
    check(`[${tag}] 題目頁無 console 錯誤`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }

  // =====================================================================
  // G5 地圖版面
  // =====================================================================
  {
    // 手機：地圖高度 >= 300、第 1 站不被切掉、今日冒險卡是緊湊的一列
    const { ctx, page, errors } = await freshApp(browser, SIZES.phone)
    await go(page, 'map')
    await page.waitForSelector('[data-testid=station-1]')
    await page.waitForTimeout(700)
    const m = await page.evaluate(() => {
      const sc = document.querySelector('.adv-scroll').getBoundingClientRect()
      const n1 = document.querySelector('[data-testid=station-1]').getBoundingClientRect()
      const daily = document.querySelector('.adv-daily').getBoundingClientRect()
      const btn = document.querySelector('[data-testid=daily-go]').getBoundingClientRect()
      return { h: sc.height, l: sc.left, t: sc.top, n1: [n1.left, n1.top, n1.right, n1.bottom], sc: [sc.left, sc.top, sc.right, sc.bottom], dailyH: daily.height, dailyBottom: daily.bottom, btnH: btn.height, vh: innerHeight, hint: !!document.querySelector('.adv-swipe-hint') }
    })
    check('手機地圖：高度 >= 300px', m.h >= 299, String(m.h))
    check('手機地圖：第 1 站完整在地圖框內（左、上、右、下都沒被切）', m.n1[0] >= m.sc[0] && m.n1[1] >= m.sc[1] && m.n1[2] <= m.sc[2] && m.n1[3] <= m.sc[3], JSON.stringify(m))
    check('手機：今日冒險卡是緊湊的一列（<= 110px 高）、按鈕 >= 56px、整張在第一屏內', m.dailyH <= 110 && m.btnH >= 56 && m.dailyBottom <= m.vh, JSON.stringify(m))
    check('手機：地圖比畫面寬時有「左右滑動」提示', m.hint)
    check('手機：頁面不橫向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    await page.getByTestId('station-1').click()
    check('手機：第 1 站點得到（進入關卡）', await page.waitForSelector('[data-testid=stage]', { timeout: 4000 }).then(() => true, () => false))
    check('手機地圖無 console 錯誤', errors.length === 0, errors.join('|'))
    await ctx.close()
  }
  for (const [name, vp] of [['直向 820x1180', SIZES.port], ['直向 1024x1366', { width: 1024, height: 1366 }]]) {
    const { ctx, page } = await freshApp(browser, vp)
    await go(page, 'map')
    await page.waitForSelector('.adv-map')
    await page.waitForTimeout(800)
    const r = await page.evaluate(() => {
      const nav = [...document.querySelectorAll('.adv-chapters, .adv-subjects')].pop().getBoundingClientRect()
      const sc = document.querySelector('.adv-scroll').getBoundingClientRect()
      const daily = document.querySelector('.adv-daily').getBoundingClientRect()
      return { gap: sc.top - nav.bottom, dailyBottom: daily.bottom, vh: innerHeight }
    })
    check(`[${name}] 地圖緊接在分頁下面（靠上，間距 <= 40px，不再置中留白）`, r.gap <= 40, JSON.stringify(r))
    check(`[${name}] 今日冒險卡在畫面內`, r.dailyBottom <= r.vh, JSON.stringify(r))
    await ctx.close()
  }
  {
    // 橫向 6–7 歲（多一列挑戰）：今日冒險卡與挑戰站都在畫面內
    const { ctx, page, errors } = await freshApp(browser, SIZES.land)
    await patchSettings(page, { ageBand: '6-7' })
    await page.reload()
    await go(page, 'map')
    await page.waitForSelector('.adv-map')
    await page.waitForTimeout(900)
    await page.getByText('先不要').click({ timeout: 800 }).catch(() => {})
    await page.waitForTimeout(300)
    const r = await page.evaluate(() => {
      const q = (s) => document.querySelector(s)?.getBoundingClientRect()
      const daily = q('.adv-daily'), ch = q('.q7-challenge'), foot = q('.adv-foot-row'), sc = q('.adv-scroll')
      return { dailyBottom: daily?.bottom, chBottom: ch?.bottom, footBottom: foot?.bottom, scH: sc?.height, vh: innerHeight, docH: document.documentElement.scrollHeight }
    })
    check('橫向 6–7 歲：今日冒險卡完整在畫面內（沒被切）', r.dailyBottom <= r.vh, JSON.stringify(r))
    check('橫向 6–7 歲：挑戰站與章節進度也在畫面內', r.chBottom !== undefined && r.chBottom <= r.vh && r.footBottom <= r.vh, JSON.stringify(r))
    check('橫向 6–7 歲：整頁不需要上下捲動，地圖仍有 >= 340px 高', r.docH <= r.vh + 2 && r.scH >= 340, JSON.stringify(r))
    check('橫向 6–7 歲地圖無 console 錯誤', errors.length === 0, errors.join('|'))
    await ctx.close()
  }
} catch (e) {
  console.error(e)
  state.failed++
} finally {
  await browser.close()
}

console.log(state.failed === 0 ? '\n全部通過' : `\n${state.failed} 項失敗`)
process.exit(state.failed === 0 ? 0 : 1)
