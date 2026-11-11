// v8 線 M E2E（Playwright）：背景音樂與音效引擎。
//   1) 自動化測試預設（沒設 gq-audio-test）不載入任何音檔，合成音退路照舊
//   2) 設 gq-audio-test=1 後真的載入音樂：場景隨畫面切換（首頁日/夜、地圖、關卡、boss、章末儀式、著色）
//   3) 家長區「背景音樂」開關生效並存檔；「音效」開關也照常
//   4) 語音播放時音樂自動壓低（機器語音與預錄音檔兩條路），結束後放回
//   5) 頁面切到背景暫停、回來恢復
//   6) 全域按鈕音：按按鈕有 tap 音檔，畫布上沒有
//   7) 沒有 JS 錯誤
// 用法：先啟動 dev server（例如 pnpm dev --port 5191 --strictPort），再
//   BASE_URL=http://localhost:5191 node scripts/e2e-audio.mjs        （E2E_BROWSER=webkit 用 Safari 的引擎）
import { BASE, launch, freshApp, makeChecker, idb, pmSetTod, openParentTab, IS_WEBKIT } from './e2e-lib.mjs'

const { state, check } = makeChecker()
const VP = { width: 1024, height: 768 }

const st = (page) => page.evaluate(() => window.__gqAudio())
const waitState = (page, fn, arg, timeout = 8000) => page.waitForFunction(`(${fn.toString()})(window.__gqAudio(), ${JSON.stringify(arg ?? null)})`, null, { timeout }).then(() => true, () => false)
const waitScene = (page, scene) => waitState(page, (s, want) => s.scene === want, scene)
/** 觸碰一下空白處（真的使用者手勢，讓 AudioContext 起來） */
const poke = async (page) => {
  await page.mouse.click(3, 3)
}
const settingsOf = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result))))
const putProgress = (page, doneCount, chestClaimed = false) =>
  idb(
    page,
    (db, o) =>
      new Promise((res) => {
        const tx = db.transaction('progress', 'readwrite')
        tx.objectStore('progress').put({
          chapterId: 'huaguoshan',
          run: 1,
          stations: Array.from({ length: 5 }, (_, i) => ({ done: i < o.n, independent: i < o.n ? 5 : 0, total: 5 })),
          chestClaimed: o.chest,
          completedRuns: 0,
          updatedAt: Date.now(),
        })
        tx.oncomplete = () => res(1)
      }),
    { n: doneCount, chest: chestClaimed },
  )

const FAKE_SPEECH = () => {
  // 假的 speechSynthesis：每句唸 1.5 秒後觸發 onend（驗證唸話期間音樂被壓低、唸完放回）
  window.__spoken = []
  const fake = {
    speaking: false,
    cancel() {},
    getVoices: () => [],
    speak(u) {
      window.__spoken.push(u.text)
      window.setTimeout(() => u.onstart && u.onstart(), 30)
      window.setTimeout(() => u.onend && u.onend(), 1500)
    },
  }
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true })
  window.SpeechSynthesisUtterance = class {
    constructor(t) {
      this.text = t
    }
  }
}

const browser = await launch()

// ---------- 1) 預設：自動化測試不載入音檔 ----------
{
  const { ctx, page, errors } = await freshApp(browser, VP)
  const audioReqs = []
  page.on('request', (r) => {
    if (/\/audio\//.test(r.url())) audioReqs.push(r.url())
  })
  await poke(page)
  await page.waitForTimeout(800)
  // 退回合成音：按「試聽音效」會有振盪器發聲
  await openParentTab(page, '音效/語音')
  const osc0 = await page.evaluate(() => window.__audio.osc)
  await page.getByRole('button', { name: '試聽音效' }).click()
  const osc1 = await page.evaluate(() => window.__audio.osc)
  check('預設：試聽音效退回合成音（2 個振盪器，同 v7）', osc1 - osc0 === 2, `+${osc1 - osc0}`)
  await page.goto(BASE)
  await page.waitForSelector('[data-testid=pet]')
  await page.getByTestId('candy-map').click()
  await page.waitForSelector('[data-testid=station-1]')
  await page.waitForTimeout(600)
  const s = await st(page)
  check('預設（webdriver）：沒有任何 /audio/ 請求', audioReqs.length === 0, audioReqs.join(','))
  check('預設：沒有載入任何音樂或音效，也沒有在播', s.loadedMusic.length === 0 && s.loadedSfx.length === 0 && s.scene === null, JSON.stringify(s))
  check('預設：引擎仍記得想要的場景（map），只是不載檔', s.wantedScene === 'map')
  check('預設：無 console 錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}

// ---------- 2–7) 真的載入音檔 ----------
{
  const { ctx, page, errors } = await freshApp(browser, VP)
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gq-audio-test', '1')
    } catch {
      /* ignore */
    }
  })
  await ctx.addInitScript(FAKE_SPEECH)
  const audioReqs = []
  page.on('request', (r) => {
    if (/\/audio\//.test(r.url())) audioReqs.push(r.url().replace(/^.*\/audio\//, ''))
  })
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await poke(page)

  check('載入音樂後場景是首頁白天（home-day）', await waitScene(page, 'home-day'))
  let s = await st(page)
  check('AudioContext 在跑', s.ctxState === 'running', s.ctxState)
  check('延遲載入：只抓了清單與這一首（加背景預載的音效），沒有其他首音樂', audioReqs.includes('manifest.json') && audioReqs.some((r) => r.startsWith('music-home-day.m4a')) && !audioReqs.some((r) => r.startsWith('music-map')), audioReqs.join(','))
  check('音樂音量預設偏小（< 0.6）', s.musicGain !== null && s.musicGain > 0 && s.musicGain < 0.6, String(s.musicGain))
  check('音樂開關預設開、音效開關預設開', s.musicEnabled && s.sfxEnabled)

  // 預載音效
  check('音效 18 個背景預載完成', await waitState(page, (x) => x.loadedSfx.length === 18, undefined, 10000))

  // 日夜：PM 切到晚上 → 搖籃曲
  await pmSetTod(page, 'night')
  check('晚上：首頁換成搖籃曲（home-night）', await waitScene(page, 'home-night'))
  await pmSetTod(page, 'day')
  check('改回白天：回到 home-day', await waitScene(page, 'home-day'))

  // 地圖 → 一般站 → boss → 儀式
  const started0 = (await st(page)).started
  await page.getByTestId('candy-map').click()
  check('地圖：場景 map', await waitScene(page, 'map'))
  s = await st(page)
  check('換場景會淡入新的一首（started +1）', s.started === started0 + 1, `${started0} → ${s.started}`)
  await page.getByTestId('station-1').click()
  await page.waitForSelector('[data-testid=stage]')
  check('一般關卡：場景 stage', await waitScene(page, 'stage'))
  await page.getByTestId('leave').click()
  await page.getByTestId('leave-go').click()
  await page.waitForSelector('[data-testid=station-1]')
  check('回地圖：場景 map', await waitScene(page, 'map'))

  await putProgress(page, 4)
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await poke(page)
  await page.getByTestId('candy-map').click()
  await page.waitForSelector('[data-testid=station-5]')
  await page.getByTestId('station-5').click()
  await page.waitForSelector('[data-testid=stage][data-kind=boss]')
  check('每章最後一站（boss）：場景 boss', await waitScene(page, 'boss'))

  await putProgress(page, 5)
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await poke(page)
  await page.getByTestId('candy-map').click()
  await page.waitForSelector('[data-testid=chest-node]')
  await page.getByTestId('chest-node').click()
  await page.waitForSelector('[data-testid=ceremony]')
  check('章末儀式：場景 ceremony', await waitScene(page, 'ceremony'))

  // 著色
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await poke(page)
  await page.getByRole('button', { name: /著色本/ }).first().click()
  await page.waitForSelector('[data-testid=page-monkey]').catch(() => {})
  check('著色本：場景 paint', await waitScene(page, 'paint'))
  const tapBefore = (await st(page)).played.tap?.file ?? 0
  await page.getByTestId('page-monkey').getByRole('button').click()
  await page.waitForSelector('[data-testid=paint-board]')
  const tapAfterBtn = (await st(page)).played.tap?.file ?? 0
  check('全域按鈕音：按按鈕播 tap 音檔', tapAfterBtn > tapBefore, `${tapBefore} → ${tapAfterBtn}`)
  check('畫圖（連點 4 下）仍是 paint 場景', (await st(page)).scene === 'paint')
  await page.waitForTimeout(150)
  const box = await page.getByTestId('live-canvas').boundingBox()
  for (let i = 0; i < 4; i++) {
    await page.mouse.click(box.x + box.width / 2 + i * 12, box.y + box.height / 2)
    await page.waitForTimeout(90)
  }
  const tapAfterCanvas = (await st(page)).played.tap?.file ?? 0
  check('畫布上不響 tap', tapAfterCanvas === tapAfterBtn, `${tapAfterBtn} → ${tapAfterCanvas}`)

  // 回首頁 → 家長區：音樂開關與音效開關
  await page.goto(BASE)
  await page.waitForSelector('[data-testid=pet]')
  await poke(page)
  check('回首頁：場景 home-day', await waitScene(page, 'home-day'))
  await openParentTab(page, '音效/語音')
  check('家長區有「背景音樂」開關，預設開', (await page.getByTestId('music-switch').getAttribute('aria-checked')) === 'true')
  check('家長區在家長區時維持目前那首（不切）', (await st(page)).scene === 'home-day')

  // 壓低：語音（機器語音那條路）
  await page.getByRole('button', { name: '試聽語音' }).click()
  check('語音開始：音樂被壓低（ducked）', await waitState(page, (x) => x.ducked === true, undefined, 3000))
  await page.waitForTimeout(500)
  s = await st(page)
  check('壓低後音樂增益 < 平常的一半', s.musicGain !== null && s.musicGain < 0.25 && s.musicGain > 0, String(s.musicGain))
  check('語音唸完（約 1.5 秒）：音樂放回', await waitState(page, (x) => x.ducked === false && x.musicGain > 0.45, undefined, 6000), JSON.stringify(await st(page)))

  // 壓低：預錄音檔那條路（語音包）
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gq-voice-pack-test', '1')
    } catch {
      /* ignore */
    }
  })
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await poke(page)
  await waitScene(page, 'home-day')
  await openParentTab(page, '音效/語音')
  await page.waitForTimeout(800)
  await page.evaluate(() => window.__spoken.splice(0))
  await page.getByRole('button', { name: '試聽語音' }).click()
  const spokeSynth = await page.evaluate(() => window.__spoken.length)
  if (spokeSynth === 0) {
    check('預錄語音播放時音樂被壓低', await waitState(page, (x) => x.ducked === true, undefined, 3000))
    check('預錄語音播完音樂放回', await waitState(page, (x) => x.ducked === false, undefined, 8000))
  } else {
    // 語音包沒有這句或播不出來（退回機器語音）：機器語音那條路已驗證
    check('預錄語音（這句退回機器語音，壓低行為同上）', await waitState(page, (x) => x.ducked === true, undefined, 3000))
  }

  // 音樂開關
  await page.getByTestId('music-switch').click()
  check('關背景音樂：音樂停（scene=null）', await waitState(page, (x) => x.musicEnabled === false && x.scene === null))
  check('關背景音樂：設定存檔 musicOn=false', (await settingsOf(page)).musicOn === false)
  await page.getByTestId('sound-switch').click() // 同時關音效：既有的開關仍然有效
  check('關音效：引擎 sfxEnabled=false、settings.soundOn=false', await waitState(page, (x) => x.sfxEnabled === false, undefined, 4000) && (await settingsOf(page)).soundOn === false)
  const playedOff = JSON.stringify((await st(page)).played)
  await page.getByRole('button', { name: '試聽音效' }).click()
  await page.waitForTimeout(200)
  check('關音效：按「試聽音效」沒有發聲（連 tap 都不響）', JSON.stringify((await st(page)).played) === playedOff, (await st(page)).played.correct ? 'correct played' : '')
  await page.getByTestId('sound-switch').click()
  await page.getByTestId('music-switch').click()
  check('重新開啟背景音樂：回到 home-day', await waitScene(page, 'home-day'))
  check('重新開啟後設定 musicOn=true、soundOn=true', (await settingsOf(page)).musicOn === true && (await settingsOf(page)).soundOn === true)

  // 切到背景暫停、回來恢復
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  check('頁面切到背景：AudioContext 暫停', await waitState(page, (x) => x.ctxState === 'suspended', undefined, 3000))
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  check('回到前景：AudioContext 恢復、音樂還在 home-day', await waitState(page, (x) => x.ctxState === 'running' && x.scene === 'home-day', undefined, 4000), JSON.stringify(await st(page)))

  check('全程無 JS 錯誤', errors.length === 0, errors.join('|'))
  await ctx.close()
}

await browser.close()
console.log(state.failed ? `\n${state.failed} 項失敗${IS_WEBKIT ? '（webkit）' : ''}` : `\n全部通過${IS_WEBKIT ? '（webkit）' : ''}`)
process.exit(state.failed ? 1 : 0)
