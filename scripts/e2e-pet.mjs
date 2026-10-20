// 阿悟「活起來」E2E（Playwright，SPEC-v3 A）：餵食動畫、便便、連點反應、日夜睡覺、PM 觸發、自主行為排程、減少動態。
// 用法：先啟動 dev server（例如 pnpm dev --port 5182 --strictPort），再
//   BASE_URL=http://localhost:5182 node scripts/e2e-pet.mjs
// 需要 Chromium：預設找 ~/Library/Caches/ms-playwright 內已安裝的，或用 CHROME_PATH 指定。
// 想順便存關鍵影格截圖：SHOT_DIR=/path/to/dir node scripts/e2e-pet.mjs
import { launch, freshApp, sample, pmTrigger, pmSetTod, openParentTab, center, drag, getPet, patchPet, idb, makeChecker } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const SHOT_DIR = process.env.SHOT_DIR
const shot = async (page, name) => {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/v3-pet-${name}.png` })
}

const has = (rows, pred) => rows.some(pred)
const firstIdx = (rows, pred) => rows.findIndex(pred)
const VP = { width: 1024, height: 768 }
const audio = (page) => page.evaluate(() => window.__audio)
const petAttr = (page, a) => page.locator('[data-testid=pet]').getAttribute(a)
const feedBanana = async (page, sampleMs = 3400) => {
  const a = await center(page, '[data-dock-item=banana]')
  const p = await center(page, '[data-testid=pet]')
  const s = sample(page, sampleMs, 40)
  await page.waitForTimeout(80)
  await drag(page, a, p)
  return s
}
const clickPet = async (page, n, gap = 90) => {
  const p = await center(page, '[data-testid=pet]')
  for (let i = 0; i < n; i++) {
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(gap)
  }
}

const browser = await launch()
try {
  // ---------- 1) 吃東西動畫完整流程 ----------
  {
    const { ctx, page, errors } = await freshApp(browser, VP, { rand: 0.9 })
    const before = await getPet(page)
    const rows = await feedBanana(page)
    const eatStart = firstIdx(rows, (r) => r.phase === 'fly')
    const eatEnd = rows.length - 1 - [...rows].reverse().findIndex((r) => r.phase !== null)
    check('餵食：食物飛到嘴邊（fly）', eatStart >= 0)
    const bitesSeen = [...new Set(rows.filter((r) => r.phase === 'chew').map((r) => r.bites))]
    check('餵食：咀嚼 3 口，每口食物縮小（bites 1→2→3）', bitesSeen.join() === '1,2,3', bitesSeen.join())
    check('餵食：每一口都噴碎屑', has(rows, (r) => r.crumbs))
    check('餵食：吞下去（gulp）後冒出愛心', has(rows, (r) => r.phase === 'gulp') && has(rows, (r) => r.hearts))
    const order = (p) => firstIdx(rows, p)
    check(
      '餵食：階段順序 eating 姿勢 → 咀嚼 → 吞下 → 回到閒置',
      order((r) => r.pose === 'eating') < order((r) => r.anim === 'chew') && order((r) => r.anim === 'chew') < order((r) => r.anim === 'gulp') && rows.at(-1).pose === 'idle',
    )
    const dur = rows[eatEnd].t - rows[eatStart].t
    check('餵食：整段約 1.5–2.5 秒', dur >= 1400 && dur <= 2700, `${dur}ms`)
    check('餵食：沒打嗝時沒有泡泡', !has(rows, (r) => r.bubble))
    check('餵食：結束後食物與特效清乾淨', !rows.at(-1).crumbs && !rows.at(-1).hearts && rows.at(-1).phase === null)
    const after = await getPet(page)
    check('餵食：feedCount +1、數量 5→4', after.feedCount === before.feedCount + 1 && (await page.locator('[data-dock-item=banana] .dock-sub').innerText()) === 'x4')
    const au = await audio(page)
    // 啊嗯 2 + 嚼×3 (各 1) + 咕嚕 2 = 7 個振盪器；嚼 3 次各有一段雜訊
    check('餵食：音效依序合成（啊嗯/嚼嚼嚼/咕嚕）', au.osc >= 7 && au.noise >= 3, JSON.stringify(au))
    check('餵食：頁面沒有錯誤', errors.length === 0, errors.join(' | '))

    // 家長關掉音效 → 同樣的餵食不發聲
    await idb(page, (db) => new Promise((r) => {
      const s = db.transaction('settings', 'readwrite').objectStore('settings')
      s.get('main').onsuccess = (e) => { s.put({ ...e.target.result, soundOn: false }).onsuccess = () => r(1) }
    }))
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await feedBanana(page, 2600)
    const au2 = await audio(page)
    check('家長音效開關關閉：餵食動畫照演但完全靜音', au2.osc === 0 && au2.noise === 0, JSON.stringify(au2))
    await ctx.close()
  }

  // ---------- 2) 打嗝（約 1/4 機率；固定亂數驗證內容）、餵食後排定大便 ----------
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.1 })
    const rows = await feedBanana(page, 3600)
    check('打嗝：泡泡「嗝～」', has(rows, (r) => r.bubble === '嗝～'))
    check('打嗝：切到害羞 shy 姿勢', has(rows, (r) => r.pose === 'shy'))
    const eatStart = firstIdx(rows, (r) => r.phase === 'fly')
    const lastActive = rows.length - 1 - [...rows].reverse().findIndex((r) => r.pose !== 'idle' || r.bubble)
    check('打嗝：含打嗝整段仍 ≤ 2.5 秒左右', rows[lastActive].t - rows[eatStart].t <= 2700, `${rows[lastActive].t - rows[eatStart].t}ms`)
    const au = await audio(page)
    check('打嗝：多一段「嗝」音效', au.osc >= 9, JSON.stringify(au))
    const pet = await getPet(page)
    check('吃完後排定了一次延遲大便（20–90 秒後）', pet.poopDue?.length === 1 && pet.poopDue[0] - Date.now() > 15000 && pet.poopDue[0] - Date.now() < 95000, JSON.stringify(pet.poopDue))
    await ctx.close()
  }

  // ---------- 3) 便便：PM 觸發 → 出現 → 重新整理還在 → 點擊清除 → 重新整理已消失 ----------
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9 })
    await pmTrigger(page, 'poop')
    const rows = await sample(page, 2600, 50)
    check('大便：先切 shy、蹲下', has(rows, (r) => r.pose === 'shy' && r.anim === 'squat'))
    check('大便：便便出現在房間', rows.at(-1).poops === 1)
    await shot(page, 'poop')
    check('大便：存進資料庫', (await getPet(page)).poops?.length === 1)
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await page.waitForTimeout(600)
    check('重新整理後便便還在', (await page.locator('[data-testid=poop]').count()) === 1)
    const poopId = await page.locator('[data-testid=poop]').getAttribute('data-poop-id')
    // 點便便 → 泡泡包起來 → 啵 → 消失 → 星星閃光；阿悟說謝謝
    const before = await audio(page)
    const sampler = sample(page, 2200, 40)
    await page.locator('[data-testid=poop]').click()
    await page.waitForTimeout(250)
    check('清除：點一下先用泡泡包起來', (await page.locator('[data-testid=poop].popping').count()) === 1)
    await shot(page, 'poop-bubble')
    const clear = await sampler
    check('清除：阿悟 laugh 並說「謝謝你！」', has(clear, (r) => r.pose === 'laugh') && has(clear, (r) => r.bubble === '謝謝你！'))
    check('清除：便便消失、閃光星星出現過', clear.at(-1).poops === 0 && has(clear, (r) => r.burst))
    const after = await audio(page)
    check('清除：有「啵」的音效', after.osc > before.osc)
    const pet = await getPet(page)
    check('清除：資料庫也清掉了（不給星星）', !pet.poops?.some((p) => p.id === poopId) && pet.poops?.length === 0)
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await page.waitForTimeout(600)
    check('重新整理後便便仍是 0', (await page.locator('[data-testid=poop]').count()) === 0)
    check('清除便便沒有給星星', (await page.evaluate(() => document.querySelector('.chip-num')?.textContent)) === '0')

    // 上限 3 坨
    await patchPet(page, { poops: [0.2, 0.5, 0.8].map((x, i) => ({ id: `t${i}`, x, at: Date.now() })) })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await pmTrigger(page, 'poop')
    await page.waitForTimeout(2500)
    check('便便最多同時 3 坨', (await page.locator('[data-testid=poop]').count()) === 3 && (await getPet(page)).poops.length === 3)
    await ctx.close()
  }

  // ---------- 4) 便便：離線補發、吃完後自然發生、家長開關 ----------
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.1 })
    // 離線期間到期：打開時直接長出來，不演蹲下的動畫
    await patchPet(page, { poopDue: [Date.now() - 5 * 60 * 1000] })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    const rows = await sample(page, 2200, 50)
    check('離線期間到期的便便：重新打開時補上', rows.at(-1).poops === 1)
    check('離線補上的便便不演蹲下（沒有 shy）', !has(rows, (r) => r.pose === 'shy'))
    await patchPet(page, { poops: [], poopDue: [] })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')

    // 吃完東西 → 排定 → 時間到自然長出來（把到期時間改成 2.5 秒後）
    await feedBanana(page, 500)
    await page.waitForTimeout(2300)
    await patchPet(page, { poopDue: [Date.now() + 2500] })
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    const nat = await sample(page, 6000, 60)
    check('吃完後自然大便：先 shy 蹲下再出現便便', has(nat, (r) => r.pose === 'shy') && nat.at(-1).poops === 1)
    check('自然大便：便便出現時「噗」有發聲', (await audio(page)).osc > 0)
    await shot(page, 'poop-natural')

    // 家長關掉「寵物會大便」：吃了也不會排便便
    await patchPet(page, { poops: [], poopDue: [], feedStreak: undefined })
    await openParentTab(page, '設定')
    const sw = page.getByTestId('poop-switch')
    check('設定頁有「寵物會大便」開關，預設開', (await sw.getAttribute('aria-checked')) === 'true')
    await sw.click()
    await page.waitForTimeout(300)
    check('開關關閉後寫進設定', (await sw.getAttribute('aria-checked')) === 'false')
    await page.getByRole('button', { name: '回到小孩模式' }).click()
    await page.waitForSelector('[data-testid=pet]')
    await feedBanana(page, 500)
    await page.waitForTimeout(2300)
    check('關閉開關後：吃東西不再排大便', ((await getPet(page)).poopDue ?? []).length === 0)
    await ctx.close()
  }

  // ---------- 5) 互動：點一下、連點 3 次搔癢、連點 6 次頭暈、長按摸摸頭 ----------
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9 })
    let s = sample(page, 1200, 40)
    await clickPet(page, 1)
    let rows = await s
    check('點一下：說「嘻嘻」', has(rows, (r) => r.bubble === '嘻嘻'))
    await page.waitForTimeout(1500)

    s = sample(page, 2400, 40)
    await clickPet(page, 3, 120)
    rows = await s
    check('連點 3 次：搔癢大笑（laugh + 哈哈哈）', has(rows, (r) => r.pose === 'laugh') && has(rows, (r) => r.bubble === '哈哈哈！'))
    await shot(page, 'laugh')
    await page.waitForTimeout(2200)

    s = sample(page, 5200, 50)
    await clickPet(page, 6, 110)
    rows = await s
    check('連點 6 次：轉圈 → dizzy', has(rows, (r) => r.anim === 'spin') && has(rows, (r) => r.pose === 'dizzy'))
    check('頭暈：頭上繞小星星、說「不要再轉了啦～」', has(rows, (r) => r.orbit) && has(rows, (r) => r.bubble === '不要再轉了啦～'))
    const dizzyRows = rows.filter((r) => r.pose === 'dizzy')
    const dizzyMs = dizzyRows.at(-1).t - dizzyRows[0].t
    check('頭暈約 2.5–3 秒後恢復', dizzyMs >= 2000 && dizzyMs <= 3400 && rows.at(-1).pose === 'idle' && !rows.at(-1).orbit, `${dizzyMs}ms`)
    await shot(page, 'dizzy')

    // 長按 1 秒：摸摸頭
    const p = await center(page, '[data-testid=pet]')
    await page.mouse.move(p.x, p.y)
    s = sample(page, 2800, 50)
    await page.mouse.down()
    await page.waitForTimeout(1250)
    await page.mouse.up()
    rows = await s
    check('長按 1 秒：摸摸頭、冒愛心、說「好舒服～」', has(rows, (r) => r.bubble === '好舒服～') && has(rows, (r) => r.hearts))
    check('長按放開後不會再多觸發一次「嘻嘻」', !has(rows, (r) => r.bubble === '嘻嘻'))
    await ctx.close()
  }

  // ---------- 6) 日夜作息：晚上睡覺 ----------
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9 })
    check('白天：醒著、背景是 day', (await petAttr(page, 'data-asleep')) === null && (await page.locator('.room-backdrop.tod-day').count()) === 1)
    await pmSetTod(page, 'dusk')
    check('傍晚：背景 dusk、還醒著', (await page.locator('.room-backdrop.tod-dusk').count()) === 1 && (await petAttr(page, 'data-asleep')) === null)
    await pmSetTod(page, 'night')
    await page.waitForTimeout(500)
    check('晚上：背景 night、阿悟睡著、頭上冒 Zzz', (await page.locator('.room-backdrop.tod-night').count()) === 1 && (await petAttr(page, 'data-asleep')) === 'true' && (await page.getByTestId('pet-zzz').count()) === 1)
    check('晚上：換成 sleep 姿勢', (await petAttr(page, 'data-pose')) === 'sleep')
    await shot(page, 'sleep')

    // 點醒：揉眼睛醒來 10 秒、說「好睏喔…」，然後再睡
    const s = sample(page, 1500, 50)
    await clickPet(page, 1)
    const rows = await s
    check('點睡著的阿悟：說「好睏喔…」並醒來', has(rows, (r) => r.bubble === '好睏喔…') && rows.at(-1).asleep === null)
    await shot(page, 'wake')
    await page.waitForTimeout(8000)
    check('醒來約 10 秒內維持醒著', (await petAttr(page, 'data-asleep')) === null)
    await page.waitForFunction(() => document.querySelector('[data-testid=pet]').dataset.asleep === 'true', null, { timeout: 5000 }).then(
      () => check('10 秒後自己再睡著', true),
      () => check('10 秒後自己再睡著', false),
    )

    // 睡著時仍可餵食，吃完繼續睡
    const feed = await feedBanana(page, 3000)
    check('睡著時餵食：動畫照演', has(feed, (r) => r.phase === 'fly') && has(feed, (r) => r.bites === 3))
    check('睡著時餵食：吃完繼續睡', feed.at(-1).asleep === 'true' && feed.at(-1).zzz)
    // 切回跟隨真實時間 / 白天 → 起床
    await pmSetTod(page, 'day')
    check('切回白天：醒來、Zzz 消失', (await petAttr(page, 'data-asleep')) === null && (await page.getByTestId('pet-zzz').count()) === 0)
    // PM：睡覺 / 醒來
    await pmTrigger(page, 'sleep')
    await page.waitForTimeout(500)
    check('PM「睡覺」：白天也會睡', (await petAttr(page, 'data-asleep')) === 'true')
    await pmTrigger(page, 'wake')
    await page.waitForTimeout(700)
    check('PM「醒來」：醒來並說「好睏喔…」', (await petAttr(page, 'data-asleep')) === null)
    await ctx.close()
  }

  // ---------- 7) PM 觸發各種自主行為 ----------
  {
    const { ctx, page, errors } = await freshApp(browser, VP, { rand: 0.9 })
    const run = async (cmd, ms = 3300) => {
      await pmTrigger(page, cmd)
      return sample(page, ms, 60)
    }
    let rows = await run('sing')
    check('唱歌：sing 姿勢 + 音符飄出 + 旋律', has(rows, (r) => r.pose === 'sing') && has(rows, (r) => r.notes) && (await audio(page)).osc >= 6)
    await shot(page, 'sing')
    rows = await run('dance')
    check('跳舞：dance 姿勢 + 背景閃小星星', has(rows, (r) => r.pose === 'dance') && has(rows, (r) => r.sparkles))
    rows = await run('walk', 3600)
    const lefts = rows.map((r) => r.left)
    check('散步：位置真的移動（走路時上下晃）', Math.max(...lefts) - Math.min(...lefts) > 40 && has(rows, (r) => r.anim === 'walk'), `${Math.min(...lefts)}→${Math.max(...lefts)}`)
    await shot(page, 'walk')
    rows = await run('sneeze', 2600)
    check('打噴嚏：dizzy → happy、「哈啾！」+ 小雲', has(rows, (r) => r.pose === 'dizzy') && has(rows, (r) => r.bubble === '哈啾！') && has(rows, (r) => r.cloud))
    rows = await run('wave', 3600)
    check('揮手：泡泡用小孩的名字「小明！」', has(rows, (r) => r.bubble === '小明！'))
    await shot(page, 'wave')
    rows = await run('yawn', 2400)
    check('打哈欠：泡泡「哈～」', has(rows, (r) => r.bubble === '哈～'))
    rows = await run('gaze', 3600)
    check('發呆看窗外：頭上冒想像泡泡（圖）', has(rows, (r) => r.bubbleIcon))
    await shot(page, 'gaze')
    rows = await run('pinchNose', 2400)
    check('捏鼻子：shy +「臭臭～」', has(rows, (r) => r.pose === 'shy') && has(rows, (r) => r.bubble === '臭臭～'))
    // 飢餓時摸肚子，泡泡是想吃的食物
    await idb(page, (db) => new Promise((r) => {
      const s = db.transaction('pets', 'readwrite').objectStore('pets')
      s.get('pet').onsuccess = (e) => { s.put({ ...e.target.result, hunger: 5, hungerUpdatedAt: Date.now() }).onsuccess = () => r(1) }
    }))
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    rows = await run('rubTummy', 3200)
    check('飢餓：摸肚子 + 想吃的食物泡泡', has(rows, (r) => r.anim === 'tummy') && has(rows, (r) => r.bubbleIcon))
    await shot(page, 'tummy')
    check('PM 觸發期間頁面沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---------- 8) 蛋階段：食物被吸收 ----------
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.1, stage: 'egg' })
    const rows = await feedBanana(page, 2600)
    check('蛋：食物被吸收（absorb）、蛋發光晃動', has(rows, (r) => r.phase === 'absorb') && has(rows, (r) => r.anim === 'wiggle'))
    check('蛋：沒有咀嚼、沒有打嗝泡泡', !has(rows, (r) => r.phase === 'chew') && !has(rows, (r) => r.bubble))
    check('蛋：冒愛心', has(rows, (r) => r.hearts))
    await shot(page, 'egg')
    check('蛋不會大便', ((await getPet(page)).poopDue ?? []).length === 0)
    await ctx.close()
  }

  // ---------- 9) 減少動態效果：身體動作停掉、特效淡入淡出，行為照常發生 ----------
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9, ctxOpts: { reducedMotion: 'reduce' } })
    await pmTrigger(page, 'sing')
    const rows = await sample(page, 1500, 60)
    check('減少動態：行為照常發生（sing 姿勢 + 音符）', has(rows, (r) => r.pose === 'sing') && has(rows, (r) => r.notes))
    const css = await page.evaluate(() => ({
      sprite: getComputedStyle(document.querySelector('[data-testid=pet] .pet-sprite')).animationName,
      note: getComputedStyle(document.querySelector('.pf-notes i')).animationName,
      slot: document.querySelector('[data-testid=pet-slot]').style.transition,
    }))
    check('減少動態：身體動畫停掉、音符改淡入淡出', css.sprite === 'none' && css.note === 'pf-fade', JSON.stringify(css))
    check('減少動態：走路不做位移動畫', css.slot === 'none')
    await pmTrigger(page, 'sneeze')
    const r2 = await sample(page, 1600, 60)
    check('減少動態：泡泡仍然顯示', has(r2, (r) => r.bubble === '哈啾！'))
    await ctx.close()
  }

  // ---------- 10) 自主行為排程（PM 加速）：閒置會自己動；佈置中、頁面隱藏時不動 ----------
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: undefined, fast: true })
    const active = (r) => r.pose !== 'idle' || r.anim || r.bubble || r.notes || r.sparkles
    let rows = await sample(page, 9000, 100)
    check('閒置一陣子後，阿悟會自己做點事', has(rows, active))
    await shot(page, 'idle-behavior')

    // 佈置模式：不觸發
    await page.getByRole('button', { name: /佈置/ }).click()
    await page.waitForTimeout(3500) // 讓正在演的收尾
    rows = await sample(page, 8000, 100)
    check('佈置模式中不會自主行動', !has(rows, active))
    await page.getByRole('button', { name: /完成/ }).click()

    // 頁面隱藏：不觸發；恢復後又會動
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(3500)
    rows = await sample(page, 8000, 100)
    check('頁面隱藏時暫停排程', !has(rows, active))
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    rows = await sample(page, 10000, 100)
    check('頁面回到前景後恢復排程', has(rows, active))
    await ctx.close()
  }

  // ---------- 11) 拖飼料時不會被自主行為干擾 ----------
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9, fast: true })
    await page.waitForTimeout(600)
    const a = await center(page, '[data-dock-item=banana]')
    await drag(page, a, { x: 900, y: 200 }, { hold: true })
    await page.waitForTimeout(6000) // 拖著不放，排程一直被擋住
    const rows = await sample(page, 200, 50)
    const act = rows.some((r) => r.anim || r.bubble || r.notes || r.sparkles)
    check('拖曳飼料中不會觸發自主行為', !act)
    await page.mouse.up()
    await ctx.close()
  }

  // ---------- 12) 玩具球 + 床：追球、睡在床上 ----------
  {
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.9, decor: ['decor-ball', 'decor-bed'] })
    await page.getByRole('button', { name: /佈置/ }).click()
    const pet = await center(page, '[data-testid=pet]')
    const ball = await center(page, '[data-dock-item=decor-ball]')
    await drag(page, ball, { x: pet.x + 230, y: 440 }, { settle: 400 })
    await page.getByRole('button', { name: /完成/ }).click()
    const rows = await sample(page, 7000, 80)
    check('把球放到阿悟附近：阿悟跑去追球', has(rows, (r) => r.anim === 'walk'))
    check('追球：彈跳、球跟著動', has(rows, (r) => r.anim === 'bounce'))
    await shot(page, 'ball')

    // 擺床，晚上睡在床上
    await page.getByRole('button', { name: /佈置/ }).click()
    const bed = await center(page, '[data-dock-item=decor-bed]')
    await drag(page, bed, { x: 330, y: 470 }, { settle: 500 })
    await page.getByRole('button', { name: /完成/ }).click()
    await pmSetTod(page, 'night')
    await page.waitForTimeout(1500)
    const geo = await page.evaluate(() => {
      const b = document.querySelector('[data-placed=decor-bed]').getBoundingClientRect()
      const p = document.querySelector('[data-testid=pet-slot]').getBoundingClientRect()
      return { bedX: b.left + b.width / 2, petX: p.left + p.width / 2, asleep: document.querySelector('[data-testid=pet]').dataset.asleep }
    })
    check('晚上有床：阿悟睡在床上（水平位置對齊床）', geo.asleep === 'true' && Math.abs(geo.bedX - geo.petX) < 20, JSON.stringify(geo))
    await shot(page, 'sleep-bed')
    await ctx.close()
  }

  // ---------- 13) 小螢幕（375 寬）：動畫不會把版面撐破 ----------
  {
    const { ctx, page } = await freshApp(browser, { width: 375, height: 812 }, { rand: 0.9, ctxOpts: { hasTouch: true, isMobile: true } })
    await pmTrigger(page, 'sing')
    await page.waitForTimeout(800)
    await shot(page, 'mobile-sing')
    await pmTrigger(page, 'poop')
    await page.waitForTimeout(2400)
    await shot(page, 'mobile-poop')
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('375 寬：唱歌/便便時首頁沒有橫向溢出', ov <= 0, String(ov))
    const pooPetOverlap = await page.evaluate(() => {
      const a = document.querySelector('[data-testid=poop]').getBoundingClientRect()
      const b = document.querySelector('[data-testid=pet]').getBoundingClientRect()
      return !(a.right <= b.left || a.left >= b.right)
    })
    check('375 寬：便便不會疊在阿悟身上', !pooPetOverlap)
    const pooVisible = await page.evaluate(() => {
      const a = document.querySelector('[data-testid=poop]').getBoundingClientRect()
      const s = document.querySelector('[data-testid=room-scroller]').getBoundingClientRect()
      return a.left >= s.left && a.right <= s.right
    })
    check('375 寬：便便出現在看得到的範圍內（不會跑到畫面外）', pooVisible)
    await ctx.close()
  }

  // ---------- 13b) 散步遇到家具會停在前面 ----------
  {
    // 亂數固定 0.99：散步目標會挑在可視範圍的最右邊，中間擋著木箱
    const { ctx, page } = await freshApp(browser, VP, { rand: 0.99, decor: ['decor-crate'] })
    await page.getByRole('button', { name: /佈置/ }).click()
    const pet = await center(page, '[data-testid=pet]')
    const crate = await center(page, '[data-dock-item=decor-crate]')
    const sc = await page.getByTestId('room-scroller').boundingBox()
    await drag(page, crate, { x: pet.x + 250, y: sc.y + sc.height - 60 }, { settle: 400 })
    await page.getByRole('button', { name: /完成/ }).click()
    await pmTrigger(page, 'walk')
    await page.waitForTimeout(4500)
    const g = await page.evaluate(() => {
      const c = document.querySelector('[data-placed=decor-crate]').getBoundingClientRect()
      const p = document.querySelector('[data-testid=pet-slot]').getBoundingClientRect()
      return { crateLeft: c.left, petRight: p.right, petLeft: p.left }
    })
    check('散步遇到家具：停在家具前面，不會穿過去', g.petRight <= g.crateLeft + 2 && g.petLeft > pet.x - 100, JSON.stringify(g))
    await shot(page, 'walk-blocked')
    await ctx.close()
  }

  // ---------- 13c) 缺圖時退回 happy/idle 圖與 emoji，不壞版 ----------
  {
    const { ctx, page, errors } = await freshApp(browser, VP, { rand: 0.9 })
    await ctx.route(/\/art\/(pet-(adult|baby)-(sing|dance|laugh|dizzy|sleep|shy)|poop)\.png/, (r) => r.abort())
    await page.reload()
    await page.waitForSelector('[data-testid=pet]')
    await pmTrigger(page, 'sing')
    await page.waitForTimeout(900)
    const src = () => page.locator('[data-testid=pet] img.pet-img').getAttribute('src')
    check('缺 sing 圖：退回 happy 圖，動作與音符照演', (await src())?.includes('pet-adult-happy') === true && (await page.getByTestId('fx-notes').count()) === 1, String(await src()))
    await page.waitForTimeout(3000)
    await pmTrigger(page, 'sleep')
    await page.waitForTimeout(700)
    check('缺 sleep 圖：退回 sleepy 圖，Zzz 照冒', (await src())?.includes('pet-adult-sleepy') === true && (await page.getByTestId('pet-zzz').count()) === 1, String(await src()))
    await pmTrigger(page, 'wake')
    await pmTrigger(page, 'poop')
    await page.waitForTimeout(2300)
    check('缺 poop 圖：顯示 emoji 備援', (await page.locator('[data-testid=poop] .art-emoji').count()) === 1 && (await page.locator('[data-testid=poop] .art-emoji-glyph').innerText()) === '💩')
    check('缺圖時頁面沒有錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---------- 14) 離開首頁（元件卸載）時，計時器與監聽清乾淨、不丟錯 ----------
  {
    const { ctx, page, errors } = await freshApp(browser, VP, { rand: 0.9, fast: true })
    const timers = () => page.evaluate(() => window.__timers.size)
    const leave = async () => {
      await page.locator('.candy.peach').click() // 商店
      await page.waitForSelector('h1:has-text("商店")')
      await page.waitForTimeout(3400) // 等 toast 之類的短計時器自己結束
    }
    await leave()
    const base = await timers()
    await page.getByRole('button', { name: '回首頁' }).click()
    await page.waitForSelector('[data-testid=pet]')
    // 讓阿悟忙起來：唱歌中途、長按中途、拖飼料中途，再離開
    await pmTrigger(page, 'sing')
    await page.waitForTimeout(900)
    const p = await center(page, '[data-testid=pet]')
    await page.mouse.move(p.x, p.y)
    await page.mouse.down() // 長按計時器開始
    await page.locator('.candy.peach').click({ force: true })
    await page.waitForSelector('h1:has-text("商店")')
    await page.mouse.up()
    await page.waitForTimeout(3400)
    const after = await timers()
    check('卸載後：阿悟的場景/排程/長按計時器都清乾淨', after <= base, `${base} → ${after}`)
    check('卸載過程沒有頁面錯誤', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(state.failed ? `\n${state.failed} 項失敗` : '\n全部通過')
process.exit(state.failed ? 1 : 0)
