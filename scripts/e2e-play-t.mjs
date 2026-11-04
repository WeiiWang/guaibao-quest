// v8.3 線 T E2E：洗澎澎與學我說話。
// 洗澎澎：三種尺寸走完三步（手指 50px 寬）、禮物、再洗一次、小鴨、多指、手勢提示、離開後計時器清乾淨。
// 學我說話：預設關、家長開關、說完台詞才開麥克風、音量 → 收音 → 變高音播回 → 再聽、不給獎勵、離開後 track 與 recorder 都停、被拒絕/不支援的畫面。
// Chromium 用假麥克風（--use-fake-device-for-media-stream + 自己產生的 WAV）。
// WebKit 沒有假裝置：真的 getUserMedia 會被拒，正好測被拒的畫面；完整流程改用 Web Audio 做的假串流 + WebKit 真的 MediaRecorder（mp4）。
// 用法：先啟動 dev server（pnpm dev --port 5210 --strictPort），再
//   BASE_URL=http://localhost:5210 node scripts/e2e-play-t.mjs       （或 pnpm e2e:play-t；E2E_BROWSER=webkit 改用 WebKit）
//   想存截圖：SHOT_DIR=<資料夾> node scripts/e2e-play-t.mjs（不要放 repo 裡）
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BASE, freshApp, idb, IS_WEBKIT, launch, makeChecker, openParentTab, patchPet, touchSender } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SIZES = { land: { width: 1180, height: 820 }, port: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } }
const SHOT_DIR = process.env.SHOT_DIR
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })
const shot = async (page, name) => {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${IS_WEBKIT ? 'wk-' : ''}${name}.png` })
}

/** 一段會循環的假麥克風：靜音 2.5 秒 → 像說話的聲音 1.2 秒 → 靜音 2 秒 */
function makeWav(path) {
  const rate = 48000
  const parts = [[2.5, 0], [1.2, 0.5], [2, 0]]
  const total = parts.reduce((n, [s]) => n + Math.round(s * rate), 0)
  const buf = Buffer.alloc(44 + total * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + total * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(total * 2, 40)
  let i = 0
  for (const [s, amp] of parts) {
    const n = Math.round(s * rate)
    for (let k = 0; k < n; k++, i++) {
      const t = k / rate
      const v = amp * (0.6 * Math.sin(2 * Math.PI * 220 * t) + 0.4 * Math.sin(2 * Math.PI * 660 * t))
      buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
    }
  }
  writeFileSync(path, buf)
}

const touchOpts = (vp) => ({ ctxOpts: vp.width < 500 ? { hasTouch: true, isMobile: true } : { hasTouch: true } })
const noOverflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const goHash = async (page, hash, sel) => {
  await page.evaluate((h) => (location.hash = h), hash)
  await page.waitForSelector(sel)
}
const timers = (page) => page.evaluate(() => window.__timers.size)
const allInv = (page) => idb(page, (db) => new Promise((r) => (db.transaction('inventory').objectStore('inventory').getAll().onsuccess = (e) => r(e.target.result))))
const settings = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
const setTalkOn = (page, on) =>
  idb(
    page,
    (db, on) =>
      new Promise((r) => {
        const s = db.transaction('settings', 'readwrite').objectStore('settings')
        s.get('main').onsuccess = (e) => (s.put({ ...e.target.result, talkOn: on }).onsuccess = () => r(1))
      }),
    on,
  )
const finger = (x, y, id = 1) => ({ x, y, id, radiusX: 25, radiusY: 25, force: 0.5 })
const boxOf = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }
}
const stepOf = (page) => page.getByTestId('bath').getAttribute('data-step')
const count = (page, id) => page.locator(`[data-testid=${id}]`).count()

/** 拿起工具在寵物身上來回抹，直到進下一步；回傳抹了幾筆 */
async function scrub(page, send, step) {
  const tool = await boxOf(page, `[data-testid=bath-tool-${step}]`)
  const pet = await boxOf(page, '[data-testid=bath-pet]')
  await send('touchStart', [finger(tool.cx, tool.cy)])
  let strokes = 0
  for (let round = 0; round < 6 && (await stepOf(page)) === step; round++) {
    for (let r = 0.1; r <= 1.05 && (await stepOf(page)) === step; r += 0.14) {
      const y = pet.y + pet.height * r
      for (const f of [0.05, 0.28, 0.5, 0.72, 0.95]) await send('touchMove', [finger(pet.x + pet.width * (r * 10 % 2 < 1 ? f : 1 - f), y)])
      strokes++
    }
  }
  await send('touchEnd', [])
  return strokes
}

/** 洗澎澎：完整走一次 */
async function testBath(b, tag, vp) {
  const { ctx, page, errors } = await freshApp(b, vp, { ...touchOpts(vp), noFavorite: true })
  const send = await touchSender(ctx, page)
  await goHash(page, 'playground', '[data-testid=playground-grid]')
  await page.waitForTimeout(400)
  const t0 = await timers(page)
  const before = await allInv(page)
  await goHash(page, 'game/bath', '[data-testid=bath]')
  await page.waitForTimeout(300)

  check(`[${tag}] 洗澎澎：寵物是孩子自己的`, (await page.locator('[data-testid=bath-pet] [data-testid=companion]').count()) === 1)
  check(`[${tag}] 洗澎澎：沒有橫向捲動`, await noOverflowX(page))
  check(`[${tag}] 洗澎澎：從抹泡泡開始`, (await stepOf(page)) === 'soap')
  for (const id of ['bath-tool-soap', 'bath-tool-rinse', 'bath-tool-dry', 'bath-duck', 'game-back']) {
    const box = await boxOf(page, `[data-testid=${id}]`)
    check(`[${tag}] ${id} 夠大（≥56）且在畫面內`, box.width >= 56 && box.height >= 56 && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1, `${Math.round(box.width)}x${Math.round(box.height)} @${Math.round(box.x)},${Math.round(box.y)}`)
  }
  // 工具、小鴨與寵物不互相蓋住
  const pet = await boxOf(page, '[data-testid=bath-pet]')
  const toolBox = await boxOf(page, '[data-testid=bath-tray]')
  const overlap = (a, c) => a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height
  check(`[${tag}] 工具托盤不蓋寵物`, !overlap(pet, toolBox))
  await page.waitForSelector('[data-testid=bath-hint]', { timeout: 3000 })
  check(`[${tag}] 一開始有手勢提示`, true)
  await page.waitForTimeout(900)
  await shot(page, `bath-${tag}-1-start`)

  // 只有現在這一步的工具拿得起來
  const rinseTool = await boxOf(page, '[data-testid=bath-tool-rinse]')
  await send('touchStart', [finger(rinseTool.cx, rinseTool.cy)])
  await send('touchMove', [finger(pet.cx, pet.cy)])
  await send('touchEnd', [])
  check(`[${tag}] 還沒輪到的工具拿不起來`, (await count(page, 'bath-foam')) === 0 && (await stepOf(page)) === 'soap')

  // 一點點：抹了還不到就不會跳下一步
  const sponge = await boxOf(page, '[data-testid=bath-tool-soap]')
  await send('touchStart', [finger(sponge.cx, sponge.cy)])
  check(`[${tag}] 拿著工具時提示收起來`, (await page.waitForFunction(() => !document.querySelector('[data-testid=bath-hint]'), null, { timeout: 2000 }).then(() => true, () => false)))
  await send('touchMove', [finger(pet.cx, pet.cy)])
  await send('touchMove', [finger(pet.cx + 20, pet.cy)])
  await page.waitForTimeout(80)
  const foam1 = await count(page, 'bath-foam')
  const held = await page.locator('[data-testid=bath-tool-soap]').boundingBox()
  check(`[${tag}] 抹過的地方長出泡泡`, foam1 > 0, String(foam1))
  check(`[${tag}] 海綿跟著手指`, Math.abs(held.x + held.width / 2 - (pet.cx + 20)) < 8, `${Math.round(held.x + held.width / 2)} vs ${Math.round(pet.cx + 20)}`)
  check(`[${tag}] 還沒抹到一定面積不進下一步`, (await stepOf(page)) === 'soap')
  await send('touchEnd', [])
  await page.waitForTimeout(350)
  const back = await page.locator('[data-testid=bath-tool-soap]').boundingBox()
  check(`[${tag}] 放開海綿回到托盤`, Math.abs(back.x - sponge.x) < 12 && Math.abs(back.y - sponge.y) < 12, `${Math.round(back.x)},${Math.round(back.y)} vs ${Math.round(sponge.x)},${Math.round(sponge.y)}`)

  // 手指直接抹寵物也可以（工具飛過來）
  await send('touchStart', [finger(pet.cx - pet.width * 0.25, pet.y + pet.height * 0.3)])
  await send('touchMove', [finger(pet.cx - pet.width * 0.05, pet.y + pet.height * 0.3)])
  await page.waitForTimeout(80)
  const foam2 = await count(page, 'bath-foam')
  check(`[${tag}] 手指直接抹寵物也長泡泡`, foam2 > foam1, `${foam1} → ${foam2}`)
  await send('touchEnd', [])

  // 第一步：抹到約 7 成
  await scrub(page, send, 'soap')
  check(`[${tag}] 抹夠了進沖水`, (await stepOf(page)) === 'rinse')
  await page.waitForTimeout(150)
  check(`[${tag}] 泡泡約 7 成以上`, (await count(page, 'bath-foam')) >= 40, String(await count(page, 'bath-foam')))
  await shot(page, `bath-${tag}-2-foam`)

  // 第二步：拿著蓮蓬頭有水柱，泡泡變少
  const shower = await boxOf(page, '[data-testid=bath-tool-rinse]')
  const foamBefore = await count(page, 'bath-foam')
  await send('touchStart', [finger(shower.cx, shower.cy)])
  await send('touchMove', [finger(pet.x + pet.width * 0.3, pet.y + pet.height * 0.1)])
  await page.waitForSelector('[data-testid=bath-water]', { timeout: 2000 })
  await send('touchMove', [finger(pet.x + pet.width * 0.4, pet.y + pet.height * 0.1)])
  await page.waitForTimeout(120)
  await shot(page, `bath-${tag}-3-rinse`)
  const foamMid = await count(page, 'bath-foam')
  check(`[${tag}] 水柱沖掉泡泡`, foamMid < foamBefore, `${foamBefore} → ${foamMid}`)
  check(`[${tag}] 沖過的地方濕濕的`, (await count(page, 'bath-drop')) > 0)
  await send('touchEnd', [])
  check(`[${tag}] 放開蓮蓬頭水就停`, await page.waitForFunction(() => !document.querySelector('[data-testid=bath-water]'), null, { timeout: 1500 }).then(() => true, () => false))
  await scrub(page, send, 'rinse')
  check(`[${tag}] 沖完進擦乾`, (await stepOf(page)) === 'dry')
  await page.waitForTimeout(600)
  check(`[${tag}] 泡泡都沖走了`, (await count(page, 'bath-foam')) === 0)
  check(`[${tag}] 全身水珠`, (await count(page, 'bath-drop')) > 20, String(await count(page, 'bath-drop')))
  await shot(page, `bath-${tag}-4-dry`)

  // 第三步：擦乾
  await scrub(page, send, 'dry')
  check(`[${tag}] 擦乾後完成`, (await stepOf(page)) === 'done')
  check(`[${tag}] 水珠沒了`, (await count(page, 'bath-drop')) === 0)
  check(`[${tag}] 亮晶晶`, (await count(page, 'bath-sparkles')) === 1)
  check(`[${tag}] 寵物開心跳`, (await page.locator('[data-testid=bath-pet] [data-testid=companion]').getAttribute('data-pose')) === 'cheer')
  await page.waitForTimeout(400)
  await shot(page, `bath-${tag}-5-done`)

  // 禮物：等寵物說完
  await page.waitForSelector('[data-testid=play-gift]', { timeout: 4000 })
  await page.waitForTimeout(500)
  await shot(page, `bath-${tag}-6-gift`)
  const after = await allInv(page)
  const total = (l) => l.reduce((n, x) => n + x.qty, 0)
  check(`[${tag}] 背包多一個食物`, total(after) === total(before) + 1, `${total(before)} → ${total(after)}`)
  check(`[${tag}] 今天記了洗澎澎`, (await settings(page)).playDaily?.done.includes('bath'))
  const giftImg = await page.locator('[data-testid=play-gift] img.art').last().getAttribute('src').catch(() => '')
  check(`[${tag}] 禮物顯示食物的圖`, /food-/.test(giftImg ?? ''), giftImg ?? '')
  await page.waitForTimeout(550) // 禮物剛跳出來的 0.5 秒不接受點擊
  await page.getByTestId('play-gift').click()

  // 再洗一次：可以再玩、今天不再送
  check(`[${tag}] 再洗一次的按鈕夠大`, (await boxOf(page, '[data-testid=bath-again]')).width >= 56)
  await page.getByTestId('bath-again').click()
  await page.waitForFunction(() => document.querySelector('[data-testid=bath]')?.dataset.step === 'soap')
  check(`[${tag}] 再洗一次從頭開始，泡泡清掉`, (await count(page, 'bath-foam')) === 0)
  await scrub(page, send, 'soap')
  await scrub(page, send, 'rinse')
  await scrub(page, send, 'dry')
  check(`[${tag}] 第二次也洗得完`, (await stepOf(page)) === 'done')
  await page.waitForTimeout(2800)
  check(`[${tag}] 同一天不重複送`, (await count(page, 'play-gift')) === 0 && total(await allInv(page)) === total(after))
  check(`[${tag}] 沒有橫向捲動（結束時）`, await noOverflowX(page))

  // 離開：計時器清乾淨、回遊樂場
  await page.getByTestId('game-back').click()
  await page.waitForSelector('[data-testid=playground-grid]')
  await page.waitForTimeout(500)
  const t1 = await timers(page)
  check(`[${tag}] 離開後計時器清乾淨`, t1 <= t0, `${t0} → ${t1}`)
  check(`[${tag}] 洗澎澎：沒有錯誤`, errors.length === 0, errors.join(' | '))
  await send.detach()
  await ctx.close()
}

/** 小鴨、多指、一直沒動作時提示再出現、中途離開 */
async function testBathExtras(b) {
  const vp = SIZES.land
  const { ctx, page, errors } = await freshApp(b, vp, touchOpts(vp))
  const send = await touchSender(ctx, page)
  await goHash(page, 'game/bath', '[data-testid=bath]')
  await page.waitForTimeout(200)
  const duck = await boxOf(page, '[data-testid=bath-duck]')
  const quacks = () => page.getByTestId('bath-duck').getAttribute('data-quacks')

  // 點了會叫（合成音）
  const osc0 = await page.evaluate(() => window.__audio.osc)
  await send('touchStart', [finger(duck.cx, duck.cy)])
  await send('touchEnd', [])
  await page.waitForTimeout(100)
  check('小鴨：點了會叫', (await quacks()) === '1' && (await page.evaluate(() => window.__audio.osc)) > osc0, `${await quacks()}`)

  // 拖到別的地方、拖的時候不叫
  await send('touchStart', [finger(duck.cx, duck.cy)])
  await send('touchMove', [finger(duck.cx + 60, duck.cy - 40)])
  await send('touchMove', [finger(300, 300)])
  await send('touchEnd', [])
  await page.waitForTimeout(80)
  const moved = await boxOf(page, '[data-testid=bath-duck]')
  check('小鴨：可以隨便拖', Math.abs(moved.cx - 300) < 8 && Math.abs(moved.cy - 300) < 8, `${Math.round(moved.cx)},${Math.round(moved.cy)}`)
  check('小鴨：拖的時候不叫', (await quacks()) === '1')

  // 拖到畫面外會留在畫面裡
  await send('touchStart', [finger(moved.cx, moved.cy)])
  await send('touchMove', [finger(-200, 2000)])
  await send('touchEnd', [])
  await page.waitForTimeout(80)
  const clamp = await boxOf(page, '[data-testid=bath-duck]')
  check('小鴨：拖不出畫面', clamp.cx >= 0 && clamp.cy <= vp.height, `${Math.round(clamp.cx)},${Math.round(clamp.cy)}`)

  // 兩隻手：一手拿海綿抹、一手拖小鴨
  const pet = await boxOf(page, '[data-testid=bath-pet]')
  const sponge = await boxOf(page, '[data-testid=bath-tool-soap]')
  await send('touchStart', [finger(sponge.cx, sponge.cy, 1)])
  await send('touchStart', [finger(sponge.cx, sponge.cy, 1), finger(clamp.cx, clamp.cy, 2)])
  await send('touchMove', [finger(pet.cx, pet.cy, 1), finger(200, 500, 2)])
  await send('touchMove', [finger(pet.cx + 30, pet.cy, 1), finger(220, 520, 2)])
  await page.waitForTimeout(80)
  const both = await boxOf(page, '[data-testid=bath-duck]')
  check('多指：抹泡泡的同時可以拖小鴨', (await count(page, 'bath-foam')) > 0 && Math.abs(both.cx - 220) < 8, `泡泡 ${await count(page, 'bath-foam')}，小鴨 ${Math.round(both.cx)}`)
  await send('touchEnd', [])

  // 一直沒動作：提示會回來；不扣東西、進度還在
  await page.waitForFunction(() => !document.querySelector('[data-testid=bath-hint]'), null, { timeout: 1000 }).catch(() => {})
  const foam = await count(page, 'bath-foam')
  check('沒動作：提示再出現', await page.waitForSelector('[data-testid=bath-hint]', { timeout: 8000 }).then(() => true, () => false))
  check('沒動作：泡泡還在（不扣東西）', (await count(page, 'bath-foam')) === foam)
  check('提示不擋手指', (await page.getByTestId('bath-hint').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none')

  // 中途離開不會送禮物，也不會壞
  await page.getByTestId('game-back').click()
  await page.waitForSelector('[data-testid=playground-grid]')
  check('中途離開不送禮物', !(await settings(page)).playDaily?.done.includes('bath'))

  // 洗好馬上離開：禮物不會少
  await goHash(page, 'game/bath', '[data-testid=bath]')
  await page.waitForTimeout(200)
  await scrub(page, send, 'soap')
  await scrub(page, send, 'rinse')
  await scrub(page, send, 'dry')
  await page.getByTestId('game-back').click()
  await page.waitForSelector('[data-testid=playground-grid]')
  await page.waitForTimeout(200)
  check('洗好馬上離開：禮物照送', !!(await settings(page)).playDaily?.done.includes('bath'))

  check('洗澎澎其他：沒有錯誤', errors.length === 0, errors.join(' | '))
  await send.detach()
  await ctx.close()

  // 每一步用台詞帶：換步驟時說一次（語音包可能還沒錄，用假清單與假播放）
  {
    const a = await freshApp(b, vp, touchOpts(vp))
    const manifest = await (await a.page.request.get(`${BASE}/voice/manifest.json`)).json()
    const LINES = { 'pet.play.bath.intro': ['我要洗澎澎！幫我抹泡泡！', 'pet.place.album'], 'pet.play.bath.rinse': ['好舒服！現在沖沖水！', 'pet.place.gallery'], 'pet.play.bath.dry': ['幫我擦乾乾！', 'pet.place.friends'], 'pet.play.bath.done': ['我變得香香的了！', 'pet.place.art'] }
    for (const [key, [text, from]] of Object.entries(LINES)) manifest[key] = { ...manifest[from], text }
    await a.ctx.route('**/voice/manifest.json', (r) => r.fulfill({ json: manifest }))
    await a.ctx.addInitScript(() => {
      localStorage.setItem('gq-place-test', '1')
      localStorage.setItem('gq-voice-pack-test', '1')
      window.__plays = []
      HTMLMediaElement.prototype.play = function () {
        window.__plays.push(this.src)
        return Promise.resolve()
      }
    })
    await a.page.reload()
    await a.page.waitForSelector('[data-testid=pet]')
    const s = await touchSender(a.ctx, a.page)
    await goHash(a.page, 'game/bath', '[data-testid=bath]')
    await a.page.waitForTimeout(800)
    const times = async (from) => (await a.page.evaluate(() => window.__plays)).filter((u) => u.includes(manifest[from].file)).length
    check('台詞：一進來說抹泡泡', (await times('pet.place.album')) === 1)
    await scrub(a.page, s, 'soap')
    check('台詞：抹完說沖水', (await times('pet.place.gallery')) === 1)
    await scrub(a.page, s, 'rinse')
    check('台詞：沖完說擦乾', (await times('pet.place.friends')) === 1)
    await scrub(a.page, s, 'dry')
    check('台詞：擦乾說香香的', (await times('pet.place.art')) === 1)
    check('台詞：沒有報錯', a.errors.length === 0, a.errors.join(' | '))
    await s.detach()
    await a.ctx.close()
  }

  // 3 歲比較容易、6–7 歲要抹比較多
  const strokesOf = async (band) => {
    const a = await freshApp(b, vp, touchOpts(vp))
    await idb(
      a.page,
      (db, band) =>
        new Promise((r) => {
          const s = db.transaction('settings', 'readwrite').objectStore('settings')
          s.get('main').onsuccess = (e) => (s.put({ ...e.target.result, ageBand: band }).onsuccess = () => r(1))
        }),
      band,
    )
    await a.page.reload()
    await a.page.waitForSelector('[data-testid=pet]')
    const s = await touchSender(a.ctx, a.page)
    await goHash(a.page, 'game/bath', '[data-testid=bath]')
    await a.page.waitForTimeout(400)
    await scrub(a.page, s, 'soap')
    await a.page.waitForTimeout(100)
    const n = await count(a.page, 'bath-foam')
    await s.detach()
    await a.ctx.close()
    return n
  }
  const f3 = await strokesOf('3')
  const f7 = await strokesOf('6-7')
  check('年齡：3 歲抹比較少就能進下一步', f3 < f7, `3 歲 ${f3} 格、6–7 歲 ${f7} 格`)

  // prefers-reduced-motion
  const r = await freshApp(b, vp, { ...touchOpts(vp), ctxOpts: { hasTouch: true, reducedMotion: 'reduce' } })
  await goHash(r.page, 'game/bath', '[data-testid=bath]')
  await r.page.waitForSelector('[data-testid=bath-hint]', { timeout: 3000 })
  const anim = await r.page.getByTestId('bath-hint').evaluate((el) => getComputedStyle(el).animationName)
  check('減少動態：手勢不滑動', anim === 'none', anim)
  await r.ctx.close()
}

// ---------- 學我說話 ----------

/** 追蹤麥克風與 recorder；stubbed = 用 Web Audio 做的假串流（WebKit 沒有假裝置） */
const installMic = (ctx, { synth = false, delayMs = 0, deny = null, noRecorder = false } = {}) =>
  ctx.addInitScript(
    ({ synth, delayMs, deny, noRecorder }) => {
      localStorage.setItem('gq-place-test', '1')
      const mic = (window.__mic = { calls: [], streams: [], recorders: [], played: [] })
      // 播回的那一段：速度（音調）與截出來的長度
      const st = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (...a) {
        if (this.playbackRate.value !== 1) mic.played.push({ rate: this.playbackRate.value, offset: a[1], duration: a[2] })
        return st.apply(this, a)
      }
      const md = navigator.mediaDevices
      if (noRecorder) {
        delete window.MediaRecorder
        window.MediaRecorder = undefined
      } else if (window.MediaRecorder) {
        const R = window.MediaRecorder
        window.MediaRecorder = class extends R {
          constructor(...a) {
            super(...a)
            mic.recorders.push(this)
          }
        }
      }
      if (!md?.getUserMedia) return
      const real = md.getUserMedia.bind(md)
      const synthStream = async () => {
        const AC = window.AudioContext || window.webkitAudioContext
        const c = new AC()
        await c.resume()
        const d = c.createMediaStreamDestination()
        const g = c.createGain()
        const o = c.createOscillator()
        o.frequency.value = 300
        o.type = 'sawtooth'
        g.gain.value = 0
        o.connect(g).connect(d)
        o.start()
        mic.loud = (v) => (g.gain.value = v)
        return d.stream
      }
      md.getUserMedia = async (c) => {
        mic.calls.push(performance.now())
        if (delayMs) await new Promise((res) => setTimeout(res, delayMs))
        if (deny) throw new DOMException('測試', deny)
        const s = synth ? await synthStream() : await real(c)
        mic.streams.push(s)
        return s
      }
    },
    { synth, delayMs, deny, noRecorder },
  )
const micState = (page) =>
  page.evaluate(() => {
    const m = window.__mic
    return {
      calls: m.calls.length,
      streams: m.streams.length,
      liveTracks: m.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState !== 'ended').length,
      recorders: m.recorders.length,
      liveRecorders: m.recorders.filter((r) => r.state !== 'inactive').length,
    }
  })
const phase = (page) => page.getByTestId('talk').getAttribute('data-phase')
const waitPhase = (page, p, timeout = 15000) =>
  page.waitForFunction((p) => document.querySelector('[data-testid=talk]')?.dataset.phase === p, p, { timeout }).then(
    () => true,
    () => false,
  )
const enterHub = async (page) => {
  await goHash(page, 'playground', '[data-testid=playground-grid]')
  await page.waitForTimeout(400)
}

/** 讓「學我說話」開著、從遊樂場那格走進去（有手勢，AudioContext 才起得來） */
async function enterTalk(page) {
  await setTalkOn(page, true)
  await page.reload()
  await page.waitForSelector('[data-testid=pet], [data-testid=playground-grid]')
  await enterHub(page)
  await page.getByTestId('game-talk').click()
  await page.waitForSelector('[data-testid=talk]')
}

/** 假裝孩子說一句（假串流才需要；Chromium 的假裝置自己會循環） */
const speakOnce = async (page, synth) => {
  if (!synth) return
  await page.evaluate(() => window.__mic.loud(0.5))
  await page.waitForTimeout(900)
  await page.evaluate(() => window.__mic.loud(0))
}

/** 家長開關、預設關 */
async function testTalkParent(b) {
  const vp = SIZES.land
  const { ctx, page, errors } = await freshApp(b, vp, {})
  await installMic(ctx)
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')

  await enterHub(page)
  check('預設關：遊樂場沒有學我說話', (await count(page, 'game-talk')) === 0)
  check('預設關：其他玩法都在', (await count(page, 'game-bath')) === 1)

  // 網址直接進來：家長沒開就不碰麥克風
  await goHash(page, 'game/talk', '[data-testid=talk]')
  check('沒開時直接進來：友善畫面', await waitPhase(page, 'blocked', 3000))
  check('沒開時直接進來：完全不碰麥克風', (await micState(page)).calls === 0)
  check('沒開時直接進來：有回去鍵', (await count(page, 'game-back')) === 1)
  await shot(page, 'talk-off')

  await page.evaluate(() => (location.hash = ''))
  await page.waitForSelector('[data-testid=pet]')
  await openParentTab(page, '設定')
  const sw = page.getByTestId('talk-switch')
  await sw.scrollIntoViewIfNeeded()
  check('家長區：開關預設關', (await sw.getAttribute('aria-checked')) === 'false')
  const row = page.locator('.lt-switch-row', { has: sw })
  const text = await row.innerText()
  check('家長區：標籤寫明使用麥克風', text.includes('學我說話（使用麥克風）'))
  check('家長區：說明寫了只在記憶體、不存不傳', /記憶體/.test(text) && /不存不傳/.test(text), text)
  await shot(page, 'talk-parent')
  await sw.click()
  await page.waitForFunction(() => document.querySelector('[data-testid=talk-switch]')?.getAttribute('aria-checked') === 'true')
  check('家長區：打開寫進設定', (await settings(page)).talkOn === true)
  await page.getByRole('tab', { name: '關於與隱私', exact: true }).click()
  const pv = await page.getByTestId('privacy-talk').innerText()
  check('隱私頁：寫了學我說話的事實', /預設關閉/.test(pv) && /記憶體/.test(pv) && /不存檔/.test(pv) && /不上傳/.test(pv), pv)

  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await enterHub(page)
  check('打開後：遊樂場出現這一格', (await count(page, 'game-talk')) === 1)
  check('家長區與遊樂場：沒有錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/** 完整流程：說完台詞才開麥克風 → 聽 → 收 → 高音播回（嘴巴動）→ 再聽；沒有獎勵；離開收乾淨 */
async function testTalkFlow(b, tag, vp, { synth }) {
  const { ctx, page, errors } = await freshApp(b, vp, touchOpts(vp))
  await installMic(ctx, { synth })
  const requests = []
  page.on('request', (r) => {
    if (r.method() !== 'GET' || !r.url().startsWith(BASE)) requests.push(`${r.method()} ${r.url()}`)
  })
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await enterHub(page)
  const t0 = await timers(page)
  const invBefore = await allInv(page)
  await enterTalk(page)
  check(`[${tag}] 學我說話：沒有橫向捲動`, await noOverflowX(page))
  check(`[${tag}] 學我說話：寵物在場`, (await page.locator('[data-testid=talk] [data-testid=companion]').count()) >= 1)

  check(`[${tag}] 開始聽`, await waitPhase(page, 'listening'), await phase(page))
  await page.waitForTimeout(300)
  await shot(page, `talk-${tag}-1-listen`)
  const m1 = await micState(page)
  check(`[${tag}] 要了一次麥克風`, m1.calls === 1 && m1.liveTracks >= 1, JSON.stringify(m1))
  check(`[${tag}] 聽的時候顯示音波`, await page.getByTestId('talk-wave').evaluate((el) => el.classList.contains('on')))
  for (const [i, sel] of ['[data-testid=game-back]', '[data-testid=talk-wave]', '[data-testid=talk] .pg-talk-pet'].entries()) {
    const box = await boxOf(page, sel)
    check(`[${tag}] 版面 ${i}：在畫面內`, box.x >= -1 && box.y >= -1 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1, `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`)
  }

  // 第一句
  const noise0 = await page.evaluate(() => window.__audio.noise)
  const say = speakOnce(page, synth)
  check(`[${tag}] 聽到聲音開始收`, await waitPhase(page, 'hearing'), await phase(page))
  const lvl = await page.waitForFunction(() => Number(document.querySelector('[data-testid=talk]')?.style.getPropertyValue('--lvl')) > 0.2, null, { timeout: 2000 }).then(() => true, () => false)
  check(`[${tag}] 音波跟著音量動`, lvl)
  await page.waitForTimeout(100)
  await shot(page, `talk-${tag}-2-hearing`)
  await say
  // 播回：嘴巴一開一合
  check(`[${tag}] 靜音後播回`, await waitPhase(page, 'playing'), await phase(page))
  const mouth = await page.evaluate(
    () =>
      new Promise((res) => {
        const seen = { open: 0, closed: 0, opacity: new Set() }
        const root = document.querySelector('[data-testid=talk]')
        const t0 = performance.now()
        const f = () => {
          if (root.dataset.phase !== 'playing' || performance.now() - t0 > 1500) return res({ open: seen.open, closed: seen.closed })
          if (root.classList.contains('mouth-open')) seen.open++
          else seen.closed++
          requestAnimationFrame(f)
        }
        f()
      }),
  )
  check(`[${tag}] 嘴巴會動（兩個姿勢交替）`, mouth.open > 0 && mouth.closed > 0, JSON.stringify(mouth))
  check(`[${tag}] 真的播了一段聲音`, (await page.evaluate(() => window.__audio.noise)) > noise0)
  check(`[${tag}] 張嘴的姿勢是 sing`, (await page.locator('.pg-talk-pose.open [data-testid=companion]').getAttribute('data-pose')) === 'sing')
  check(`[${tag}] 播完回去聽`, await page.waitForFunction(() => document.querySelector('[data-testid=talk]')?.dataset.rounds === '1', null, { timeout: 5000 }).then(() => true, () => false))
  check(`[${tag}] 學完一句繼續聽`, await waitPhase(page, 'listening'), await phase(page))
  const played = await page.evaluate(() => window.__mic.played)
  check(`[${tag}] 猴子的聲音提高到 1.45 倍`, played[0]?.rate === 1.45 || Math.abs((played[0]?.rate ?? 0) - 1.45) < 0.001, JSON.stringify(played[0]))
  check(`[${tag}] 只播說話那段（靜音切掉）`, played[0]?.duration >= 0.6 && played[0]?.duration <= 1.8, JSON.stringify(played[0]))
  check(`[${tag}] 重新開了一個 recorder`, (await micState(page)).recorders >= 2)
  check(`[${tag}] 舊的 recorder 不留著`, (await micState(page)).liveRecorders === 1, JSON.stringify(await micState(page)))

  // 第二句
  const say2 = speakOnce(page, synth)
  check(`[${tag}] 第二句也學得到`, await page.waitForFunction(() => document.querySelector('[data-testid=talk]')?.dataset.rounds === '2', null, { timeout: 20000 }).then(() => true, () => false), await page.getByTestId('talk').getAttribute('data-rounds'))
  await say2
  await shot(page, `talk-${tag}-3-round2`)

  // 不給獎勵
  check(`[${tag}] 沒有禮物`, (await count(page, 'play-gift')) === 0)
  const s = await settings(page)
  check(`[${tag}] 今天的紀錄沒有 talk`, !s.playDaily?.done?.includes('talk'))
  const total = (l) => l.reduce((n, x) => n + x.qty, 0)
  check(`[${tag}] 背包沒變`, total(await allInv(page)) === total(invBefore))
  check(`[${tag}] 沒有上傳任何東西`, requests.length === 0, requests.slice(0, 3).join(' '))
  check(`[${tag}] 沒有橫向捲動（玩完）`, await noOverflowX(page))

  // 離開：什麼都不留
  await page.getByTestId('game-back').click()
  await page.waitForSelector('[data-testid=playground-grid]')
  await page.waitForTimeout(500)
  const m2 = await micState(page)
  check(`[${tag}] 離開後麥克風 track 全停`, m2.liveTracks === 0, JSON.stringify(m2))
  check(`[${tag}] 離開後 recorder 全停`, m2.liveRecorders === 0, JSON.stringify(m2))
  const t1 = await timers(page)
  check(`[${tag}] 離開後計時器清乾淨`, t1 <= t0, `${t0} → ${t1}`)
  check(`[${tag}] 學我說話：沒有錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/** 被拒絕、不支援：友善畫面，三種尺寸都不破版 */
async function testTalkBlocked(b, tag, vp) {
  // WebKit 真的 getUserMedia 會被拒，直接測真的；Chromium 有假裝置所以用 stub
  const { ctx, page, errors } = await freshApp(b, vp, touchOpts(vp))
  await installMic(ctx, IS_WEBKIT ? {} : { deny: 'NotAllowedError' })
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await enterTalk(page)
  check(`[${tag}] 被拒絕：友善畫面`, await waitPhase(page, 'blocked'), await phase(page))
  check(`[${tag}] 被拒絕：標成 denied`, (await page.getByTestId('talk').getAttribute('data-block')) === 'denied')
  const note = await page.getByTestId('talk-note').innerText()
  check(`[${tag}] 被拒絕：給家長一行字`, /家長區/.test(note) && /系統設定/.test(note) && /麥克風/.test(note), note)
  check(`[${tag}] 被拒絕：寵物還在`, (await page.locator('.pg-talk-pose.closed [data-testid=companion]').getAttribute('data-pose')) === 'shy')
  check(`[${tag}] 被拒絕：沒有橫向捲動`, await noOverflowX(page))
  const noteBox = await boxOf(page, '[data-testid=talk-note]')
  check(`[${tag}] 被拒絕：字在畫面內`, noteBox.x >= 0 && noteBox.x + noteBox.width <= vp.width + 1 && noteBox.y + noteBox.height <= vp.height + 1, `${Math.round(noteBox.y + noteBox.height)} / ${vp.height}`)
  await page.waitForTimeout(300)
  await shot(page, `talk-${tag}-denied`)
  await page.getByTestId('game-back').click()
  await page.waitForSelector('[data-testid=playground-grid]')
  check(`[${tag}] 被拒絕：回去鍵可以走`, true)
  check(`[${tag}] 被拒絕：沒有報錯`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function testTalkEdge(b) {
  const vp = SIZES.land
  // 不支援：沒有 MediaRecorder
  {
    const { ctx, page, errors } = await freshApp(b, vp, {})
    await installMic(ctx, { noRecorder: true })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await enterTalk(page)
    check('不支援：友善畫面', await waitPhase(page, 'blocked'))
    check('不支援：標成 unsupported', (await page.getByTestId('talk').getAttribute('data-block')) === 'unsupported')
    check('不支援：不要權限', (await micState(page)).calls === 0)
    check('不支援：沒有報錯', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 權限視窗還沒按就離開：拿到也馬上還回去
  {
    const { ctx, page, errors } = await freshApp(b, vp, {})
    await installMic(ctx, { synth: true, delayMs: 1200 })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await enterTalk(page)
    await page.waitForFunction(() => window.__mic.calls.length === 1, null, { timeout: 5000 })
    await page.getByTestId('game-back').click()
    await page.waitForSelector('[data-testid=playground-grid]')
    await page.waitForFunction(() => window.__mic.streams.length === 1, null, { timeout: 4000 })
    await page.waitForTimeout(100)
    const m = await micState(page)
    check('權限還沒回就離開：track 馬上停', m.liveTracks === 0 && m.recorders === 0, JSON.stringify(m))
    check('權限還沒回就離開：沒有報錯', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 台詞說完才開麥克風（語音包的這兩句可能還沒錄：用假清單與假播放）
  {
    const { ctx, page, errors } = await freshApp(b, vp, {})
    await installMic(ctx, { synth: true })
    const manifest = await (await page.request.get(`${BASE}/voice/manifest.json`)).json()
    const anyFile = manifest['pet.place.album'].file
    const voice = manifest['pet.place.album'].voice
    manifest['pet.play.talk.intro'] = { file: anyFile, text: '跟我說話，我會學你喔！', voice }
    manifest['pet.play.talk.again'] = { file: manifest['pet.place.gallery'].file, text: '再跟我說一句！', voice }
    await ctx.route('**/voice/manifest.json', (r) => r.fulfill({ json: manifest }))
    await ctx.addInitScript(() => {
      localStorage.setItem('gq-voice-pack-test', '1')
      window.__plays = []
      HTMLMediaElement.prototype.play = function () {
        const src = this.src
        window.__plays.push({ src, at: performance.now() })
        // 換了下一句就不會有上一句的 ended（走進遊樂場的招呼語也共用這個播放器）
        setTimeout(() => this.src === src && this.dispatchEvent(new Event('ended')), 800)
        return Promise.resolve()
      }
    })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await enterTalk(page)
    check('台詞：開始聽', await waitPhase(page, 'listening'), await phase(page))
    const r = await page.evaluate(() => ({ plays: window.__plays, call: window.__mic.calls[0] }))
    const intro = r.plays.filter((p) => p.src.includes(anyFile))
    check('台詞：開場只說一次', intro.length === 1, String(intro.length))
    check('台詞：說完（0.8 秒）才要麥克風', intro.length === 1 && r.call - intro[0].at >= 700, `${Math.round(r.call - (intro[0]?.at ?? 0))}ms`)

    // 第一句學完邀孩子再說：這段時間不聽（不開 recorder）
    await speakOnce(page, true)
    await page.waitForFunction(() => document.querySelector('[data-testid=talk]')?.dataset.rounds === '1', null, { timeout: 8000 })
    check('台詞：學完第一句說「再跟我說一句」', await waitPhase(page, 'speaking', 3000), await phase(page))
    const during = await micState(page)
    check('台詞：說話時不錄音', during.liveRecorders === 0, JSON.stringify(during))
    check('台詞：說完才繼續聽', await waitPhase(page, 'listening', 3000), await phase(page))
    const again = (await page.evaluate(() => window.__plays)).filter((p) => p.src.includes(manifest['pet.play.talk.again'].file))
    check('台詞：再說一句只播一次', again.length === 1, String(again.length))

    // 一直沒聲音：過一陣子再邀一次，不催
    const more = await page.waitForFunction((f) => window.__plays.filter((p) => p.src.includes(f)).length >= 2, manifest['pet.play.talk.again'].file, { timeout: 18000 }).then(() => true, () => false)
    check('沒聲音：約 14 秒後再邀一次', more)
    check('台詞：沒有報錯', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 不同物種聲音高低不同
  {
    const { ctx, page, errors } = await freshApp(b, vp, {})
    await installMic(ctx, { synth: true })
    await patchPet(page, { species: 'rabbit' })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await enterTalk(page)
    await waitPhase(page, 'listening')
    await speakOnce(page, true)
    await page.waitForFunction(() => window.__mic.played.length >= 1, null, { timeout: 8000 })
    const rate = (await page.evaluate(() => window.__mic.played))[0].rate
    check('物種：兔兔的聲音比猴子高', rate > 1.45, String(rate))
    check('物種：沒有報錯', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 切到背景：麥克風關掉，回來再開
  {
    const { ctx, page, errors } = await freshApp(b, vp, {})
    await installMic(ctx, { synth: true })
    await ctx.addInitScript(() => {
      window.__hidden = false
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden })
    })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await enterTalk(page)
    await waitPhase(page, 'listening')
    await page.evaluate(() => {
      window.__hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(200)
    const hiddenState = await micState(page)
    check('背景：track 與 recorder 都停', hiddenState.liveTracks === 0 && hiddenState.liveRecorders === 0, JSON.stringify(hiddenState))
    await page.evaluate(() => {
      window.__hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    check('回來：繼續聽', await waitPhase(page, 'listening', 4000))
    await page.waitForTimeout(100)
    const back = await micState(page)
    check('回來：要了新的麥克風', back.calls === 2 && back.liveTracks >= 1, JSON.stringify(back))
    check('背景：沒有報錯', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 系統把麥克風收走（電話打斷）：再要一次
  {
    const { ctx, page, errors } = await freshApp(b, vp, {})
    await installMic(ctx, { synth: true })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await enterTalk(page)
    await waitPhase(page, 'listening')
    await page.evaluate(() => {
      const t = window.__mic.streams[0].getTracks()[0]
      t.dispatchEvent(new Event('ended'))
    })
    check('被打斷：重新要麥克風後繼續聽', await page.waitForFunction(() => window.__mic.calls.length === 2, null, { timeout: 3000 }).then(() => true, () => false))
    check('被打斷：回到聽', await waitPhase(page, 'listening', 4000))
    check('被打斷：沒有報錯', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'gq-play-t-'))
const wav = join(tmp, 'voice.wav')
makeWav(wav)
const browser = await launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] })
try {
  for (const [tag, vp] of Object.entries(SIZES)) await testBath(browser, tag, vp)
  await testBathExtras(browser)
  await testTalkParent(browser)
  for (const [tag, vp] of Object.entries(SIZES)) {
    await testTalkFlow(browser, tag, vp, { synth: IS_WEBKIT })
    await testTalkBlocked(browser, tag, vp)
  }
  await testTalkEdge(browser)
} finally {
  await browser.close()
  rmSync(tmp, { recursive: true, force: true })
}
console.log(`${IS_WEBKIT ? 'WebKit' : 'Chromium'}：${state.failed === 0 ? '全部通過' : `${state.failed} 項失敗`}`)
process.exit(state.failed === 0 ? 0 : 1)
