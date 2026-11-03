// v8.1 線 P E2E：有聲繪本。e2e 預設關、第一次先演序章、各章任意順序的開場、演完進站、自動翻頁、點畫面提前、跳過、
// 語音失敗或沒回報不卡住、切背景暫停、寶箱後的結尾、五章全破的終章、窗外眨眼的星星、書架（重看、鎖、舊存檔）、多孩子、三個物種、
// 字幕不壓角色、只預載下一頁、缺圖降級、減少動態、無 JS 錯誤。
// 用法：BASE_URL=http://localhost:5192 node scripts/e2e-story.mjs   （WebKit：E2E_BROWSER=webkit）
// 語音用假的 speechSynthesis（自動化瀏覽器不載語音包），另有一段打開 gq-voice-pack-test 驗證真的音檔 key。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, idb, launch, makeChecker, patchPet, BASE } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { state, check } = makeChecker()
const LAND = { width: 1180, height: 820 }
const PORT = { width: 820, height: 1180 }
const PHONE = { width: 390, height: 844 }

const CHAPTER_IDS = ['huaguoshan', 'shuiliandong', 'english-island', 'life-town', 'nature-forest']
const stations = (done) => Array.from({ length: 5 }, () => ({ done, independent: done ? 1 : 0, total: done ? 1 : 0 }))
const clearedProg = (chapterId) => ({ chapterId, run: 1, stations: stations(true), chestClaimed: true, completedRuns: 1, updatedAt: 1 })
const readyProg = (chapterId) => ({ chapterId, run: 1, stations: stations(true), chestClaimed: false, completedRuns: 0, updatedAt: 1 })

/** 假的語音：mode 由 localStorage gq-test-speech 決定：ok 照字數結束、silent 開始後永遠不回報、error 立刻回報錯誤 */
const installFakeSpeech = () => {
  const mode = () => {
    try {
      return localStorage.getItem('gq-test-speech') ?? 'ok'
    } catch {
      return 'ok'
    }
  }
  window.__spoken = []
  class U {
    constructor(text) {
      this.text = text
    }
  }
  window.SpeechSynthesisUtterance = U
  let timer
  const synth = {
    getVoices: () => [],
    cancel: () => clearTimeout(timer),
    speak: (u) => {
      window.__spoken.push(u.text)
      const m = mode()
      if (m === 'error') {
        setTimeout(() => u.onerror?.({}), 10)
        return
      }
      setTimeout(() => u.onstart?.({}), 0)
      if (m === 'silent') return
      timer = setTimeout(() => u.onend?.({}), u.text.length * 110)
    },
  }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
}

/** 開好一個孩子、打開故事旗標、裝假語音。seed：{ species, seen, progress: [Progress] } */
async function storyApp(browser, viewport, { flag = true, seed = {}, speech = 'ok', ...opts } = {}) {
  const { ctx, page, errors } = await freshApp(browser, viewport, opts)
  await ctx.addInitScript(installFakeSpeech)
  await page.evaluate(
    ({ flag, speech }) => {
      if (flag) localStorage.setItem('gq-story-test', '1')
      localStorage.setItem('gq-test-speech', speech)
    },
    { flag, speech },
  )
  await applySeed(page, seed)
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  return { ctx, page, errors }
}

async function applySeed(page, { species, seen, progress }) {
  if (species) await patchPet(page, { species })
  if (seen || progress) {
    await idb(
      page,
      (db, o) =>
        new Promise((res) => {
          const tx = db.transaction(['settings', 'progress'], 'readwrite')
          if (o.seen) {
            const st = tx.objectStore('settings')
            st.get('main').onsuccess = (e) => st.put({ ...e.target.result, storySeen: o.seen })
          }
          for (const p of o.progress ?? []) tx.objectStore('progress').put(p)
          tx.oncomplete = () => res(1)
        }),
      { seen, progress },
    )
  }
}

const storySeen = (page) => idb(page, (db) => new Promise((r) => (db.transaction('settings').objectStore('settings').get('main').onsuccess = (e) => r(e.target.result?.storySeen ?? []))))
const toHash = (page, h) => page.evaluate((x) => (location.hash = x), h)
const toMap = async (page) => {
  await toHash(page, 'map')
  await page.getByTestId('map').waitFor()
}
const storyInfo = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid=story]')
    return el ? { story: el.dataset.story, page: el.dataset.page, look: el.dataset.look } : null
  })
const waitPage = (page, key, timeout = 25000) => page.waitForSelector(`[data-testid=story][data-page="${key}"]`, { timeout })
const waitNoStory = (page) => page.waitForFunction(() => !document.querySelector('[data-testid=story]'), null, { timeout: 8000 })
/** 點畫面翻頁（避開右上的跳過），新的一頁有 450ms 防連點 */
const tap = async (page) => {
  await page.waitForTimeout(520)
  const vp = page.viewportSize()
  await page.mouse.click(vp.width / 2, vp.height * 0.3)
}
const inStage = (page) => page.waitForSelector('[data-testid=stage]', { timeout: 10000 })

const browser = await launch()

// ---------- 1. e2e 預設關 ----------
{
  const { ctx, page, errors } = await storyApp(browser, LAND, { flag: false })
  await toMap(page)
  check('預設關：地圖沒有故事入口', (await page.getByTestId('story-shelf-btn').count()) === 0)
  await page.getByTestId('station-1').click()
  await inStage(page)
  check('預設關：直接進站、不演故事', (await page.getByTestId('story').count()) === 0)
  check('預設關：沒有 storySeen', (await storySeen(page)).length === 0)
  check('預設關：無 JS 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- 2. 新孩子第一次：序章 → 開場 → 進站；自動翻頁、點畫面提前 ----------
{
  const { ctx, page, errors } = await storyApp(browser, LAND)
  await toMap(page)
  check('地圖有故事入口（小星圖示）', (await page.getByTestId('story-shelf-btn').locator('img').getAttribute('src'))?.includes('ui-xiaoxing') === true)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.prologue.1')
  check('第一次進第一站：先演序章第 1 頁', (await storyInfo(page))?.story === 'prologue')
  check('底下還在地圖（演完才進站）', (await page.getByTestId('map').count()) === 1 && (await page.getByTestId('stage').count()) === 0)
  check('字幕一字不改', (await page.getByTestId('story-caption').innerText()).trim() === '有一天晚上，一顆小星星從天上掉了下來。')
  check('序章第 1 頁小星是暗的、會掉下來', (await page.getByTestId('story-star').getAttribute('data-look')) === 'dim' && (await page.getByTestId('story-star').getAttribute('data-move')) === 'fall')
  await page.waitForFunction(() => window.__spoken?.includes('有一天晚上，一顆小星星從天上掉了下來。'), null, { timeout: 3000 })
  check('有開口唸旁白', true)
  // 語音唸完自動翻頁（假語音每字 110ms）
  const t0 = Date.now()
  await waitPage(page, 'story.prologue.2', 8000)
  check('語音唸完自動翻到下一頁', Date.now() - t0 < 6000, `${Date.now() - t0}ms`)
  check('翻頁後第 2 頁寵物出場', (await page.getByTestId('story-pet').count()) === 1)
  await page.waitForTimeout(1300)
  const shownArt = await page.locator('.sb-layer').evaluateAll((els) => els.map((e) => [e.dataset.art, getComputedStyle(e).opacity, e.querySelector('img')?.getAttribute('src')]))
  check('翻頁後背景換成第 2 頁的圖、舊的拿掉', shownArt.length === 1 && shownArt[0][0] === 'story-prologue-2' && shownArt[0][1] === '1' && shownArt[0][2].endsWith('story-prologue-2.jpg'), JSON.stringify(shownArt))
  await tap(page)
  await waitPage(page, 'story.huaguoshan.open.1', 3000)
  check('點畫面提前翻頁（序章看完接開場）', (await storyInfo(page))?.story === 'huaguoshan-open')
  check('序章看完就記下，開場還沒', (await storySeen(page)).join() === 'prologue')
  check('開場小星透出章節顏色（還不亮）', (await storyInfo(page))?.look === 'hint')
  await tap(page)
  await waitPage(page, 'story.huaguoshan.open.2', 3000)
  await tap(page)
  await waitNoStory(page)
  await inStage(page)
  check('演完接著進站', (await page.locator('[data-testid=question], [data-testid=tutorial]').count()) >= 1)
  check('序章與開場都記下了', (await storySeen(page)).join() === 'prologue,huaguoshan-open', (await storySeen(page)).join())
  // 第二次進第一站：不再演
  await toMap(page)
  await page.getByTestId('station-1').click()
  await inStage(page)
  check('第二次進第一站不再演', (await page.getByTestId('story').count()) === 0)
  check('無 JS 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- 3. 各章可任意順序、跳過 ----------
{
  const { ctx, page, errors } = await storyApp(browser, LAND)
  await toMap(page)
  await page.getByTestId('subject-english').click()
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.prologue.1')
  check('先玩英文也要先看序章', true)
  await page.getByTestId('story-skip').click()
  await waitNoStory(page)
  await inStage(page)
  check('跳過：直接進站', (await page.getByTestId('stage').count()) === 1)
  check('跳過：這串都算看過（不會再被強迫看）', (await storySeen(page)).join() === 'prologue,english-open', (await storySeen(page)).join())
  await toMap(page)
  await page.getByTestId('subject-life').click()
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.life.open.1')
  check('第二個故事不再有序章，直接演生活小鎮開場', (await storyInfo(page))?.story === 'life-open')
  await page.getByTestId('story-skip').click()
  await inStage(page)
  await toMap(page)
  await page.getByTestId('subject-math').click()
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.huaguoshan.open.1')
  check('回頭玩花果山也演它自己的開場', (await storyInfo(page))?.story === 'huaguoshan-open')
  await page.getByTestId('story-skip').click()
  await inStage(page)
  check('任意順序：無 JS 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- 4. 語音失敗、沒回報、關語音都不會卡住 ----------
{
  const { ctx, page, errors } = await storyApp(browser, LAND, { speech: 'silent', seed: { seen: ['prologue'] } })
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.huaguoshan.open.1')
  const t0 = Date.now()
  await waitPage(page, 'story.huaguoshan.open.2', 20000)
  const dt = Date.now() - t0
  check('語音開始後一直沒回報結束：到上限時間自動翻頁', dt > 5000 && dt < 16000, `${dt}ms`)
  await page.getByTestId('story-skip').click()
  await inStage(page)
  await ctx.close()
  check('語音沒回報：無 JS 錯誤', errors.length === 0, errors.join(' | '))
}
{
  const { ctx, page, errors } = await storyApp(browser, LAND, { speech: 'error', seed: { seen: ['prologue'] } })
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.huaguoshan.open.1')
  const t0 = Date.now()
  await page.waitForTimeout(2500)
  check('語音立刻失敗：字幕不會閃一下就翻走', (await storyInfo(page))?.page === 'story.huaguoshan.open.1')
  await waitPage(page, 'story.huaguoshan.open.2', 12000)
  check('語音立刻失敗：照閱讀時間翻頁', Date.now() - t0 < 9000, `${Date.now() - t0}ms`)
  await ctx.close()
  check('語音失敗：無 JS 錯誤', errors.length === 0, errors.join(' | '))
}
{
  const { ctx, page, errors } = await storyApp(browser, LAND, { seed: { seen: ['prologue'] } })
  await idb(page, (db) => new Promise((r) => {
    const s = db.transaction('settings', 'readwrite').objectStore('settings')
    s.get('main').onsuccess = (e) => (s.put({ ...e.target.result, voiceOn: false }).onsuccess = () => r(1))
  }))
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.huaguoshan.open.1')
  await page.waitForTimeout(1500)
  check('家長關語音：不開口', !(await page.evaluate(() => window.__spoken.some((t) => t.includes('花果山的桃樹')))))
  await waitPage(page, 'story.huaguoshan.open.2', 10000)
  check('家長關語音：照閱讀時間翻頁', true)
  await ctx.close()
  check('關語音：無 JS 錯誤', errors.length === 0, errors.join(' | '))
}

// ---------- 5. 切到背景暫停，回來重唸這一頁 ----------
{
  const { ctx, page, errors } = await storyApp(browser, LAND, { seed: { seen: ['prologue'] } })
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.huaguoshan.open.1')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__fakeHidden === true })
    window.__fakeHidden = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(6000)
  check('切到背景：不翻頁', (await storyInfo(page))?.page === 'story.huaguoshan.open.1')
  const before = await page.evaluate(() => window.__spoken.length)
  await page.evaluate(() => {
    window.__fakeHidden = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await waitPage(page, 'story.huaguoshan.open.2', 10000)
  check('回來：重唸這一頁再翻', (await page.evaluate(() => window.__spoken.length)) > before)
  await ctx.close()
  check('切背景：無 JS 錯誤', errors.length === 0, errors.join(' | '))
}

// ---------- 6. 寶箱開完演結尾；演完回到寶箱畫面；提早按離開也會先演 ----------
{
  const { ctx, page, errors } = await storyApp(browser, LAND, { seed: { seen: ['prologue', 'huaguoshan-open'], progress: [readyProg('huaguoshan')] } })
  await toMap(page)
  await page.getByTestId('chest-node').click()
  await page.getByTestId('claim-chest').click()
  await page.getByTestId('chest-rewards').waitFor({ timeout: 5000 })
  check('寶箱剛開：先看獎勵，故事還沒開始', (await page.getByTestId('story').count()) === 0)
  await waitPage(page, 'story.huaguoshan.close.1', 8000)
  check('寶箱開完演這章結尾，小星亮了', (await storyInfo(page))?.look === 'lit')
  await tap(page)
  await waitPage(page, 'story.huaguoshan.close.2', 3000)
  check('結尾第 2 頁更亮', (await storyInfo(page))?.look === 'bright')
  await tap(page)
  await waitNoStory(page)
  check('演完回到寶箱畫面，獎勵還在', (await page.getByTestId('chest-rewards').count()) === 1 && (await page.getByTestId('back-to-map').count()) === 1)
  check('結尾記下了', (await storySeen(page)).includes('huaguoshan-close'))
  await page.getByTestId('back-to-map').click()
  await page.getByTestId('map').waitFor()
  check('沒有重複演', (await page.getByTestId('story').count()) === 0)
  check('寶箱結尾：無 JS 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}
{
  const { ctx, page } = await storyApp(browser, LAND, { seed: { progress: [readyProg('huaguoshan')] } })
  await toMap(page)
  await page.getByTestId('chest-node').click()
  await page.getByTestId('claim-chest').click()
  await page.getByTestId('back-to-map').waitFor({ timeout: 5000 })
  await page.getByTestId('back-to-map').click()
  await waitPage(page, 'story.prologue.1', 3000)
  check('提早按回地圖：故事先演（沒看過序章要先補）', (await storyInfo(page))?.story === 'prologue')
  await page.getByTestId('story-skip').click()
  await waitNoStory(page)
  await page.getByTestId('map').waitFor()
  check('跳過後才回到地圖', (await page.getByTestId('map').count()) === 1 && (await storySeen(page)).join() === 'prologue,huaguoshan-close', (await storySeen(page)).join())
  await ctx.close()
}

// ---------- 7. 五章全破演終章；窗外多一顆眨眼的星星 ----------
{
  const others = CHAPTER_IDS.slice(0, 4).map(clearedProg)
  const { ctx, page, errors } = await storyApp(browser, LAND, { tod: 'night', seed: { seen: ['prologue'], progress: [...others, readyProg('nature-forest')] } })
  check('終章前：夜晚窗外沒有那顆星', (await page.getByTestId('window-star').count()) === 0)
  await toMap(page)
  await page.getByTestId('subject-nature').click()
  await page.getByTestId('chest-node').click()
  await page.getByTestId('claim-chest').click()
  await waitPage(page, 'story.nature.close.1', 8000)
  await tap(page)
  await waitPage(page, 'story.nature.close.2', 3000)
  await tap(page)
  await waitPage(page, 'story.finale.1', 3000)
  check('第五章結尾接終章，小星五色', (await storyInfo(page))?.look === 'five' && (await page.locator('.sb-orbit i').count()) === 5)
  check('終章字幕一字不改', (await page.getByTestId('story-caption').innerText()).trim() === '粉紅、藍色、黃色、橘色、綠色，小星的光全部回來了！')
  await tap(page)
  await waitPage(page, 'story.finale.2', 3000)
  check('終章第 2 頁小星飛回天上', (await page.getByTestId('story-star').getAttribute('data-move')) === 'rise')
  await tap(page)
  await waitNoStory(page)
  check('終章記下了', (await storySeen(page)).includes('finale'))
  await toHash(page, '')
  await page.evaluate(() => (location.hash = '#home'))
  await page.waitForSelector('[data-testid=room]')
  await page.waitForSelector('[data-testid=window-star]')
  check('終章後：夜晚窗外多一顆星（只有一顆）', (await page.getByTestId('window-star').count()) === 1)
  const anim = await page.getByTestId('window-star').evaluate((e) => getComputedStyle(e).animationName)
  check('那顆星會眨眼', anim.includes('blink'), anim)
  check('終章：無 JS 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}
{
  // 白天窗外沒有；第五章寶箱已經開過的孩子不會再演一次終章
  const { ctx, page } = await storyApp(browser, LAND, { tod: 'day', seed: { seen: ['prologue', 'finale'] } })
  await page.waitForTimeout(300)
  check('白天窗外沒有那顆星（夜景才有）', (await page.getByTestId('window-star').count()) === 0)
  await ctx.close()
}

// ---------- 8. 書架：舊存檔、鎖、重看 ----------
{
  const { ctx, page, errors } = await storyApp(browser, LAND, { seed: { progress: [clearedProg('huaguoshan')] } })
  await toMap(page)
  check('舊存檔已通關的章節：地圖上沒有被擋', (await page.getByTestId('map').count()) === 1)
  await page.getByTestId('next-run').click()
  await page.waitForTimeout(300)
  await page.getByTestId('station-1').click()
  await inStage(page)
  check('舊存檔已通關：進第一站不強迫補演開場', (await page.getByTestId('story').count()) === 0)
  check('舊存檔已通關：不演也不記', (await storySeen(page)).length === 0)
  await toMap(page)
  await page.getByTestId('story-shelf-btn').click()
  await page.getByTestId('story-shelf').waitFor()
  const stateOf = (id) => page.getByTestId(`story-book-${id}`).getAttribute('data-state')
  check('書架：12 本', (await page.locator('[data-testid^=story-book-]').count()) === 12)
  check('書架：序章開著', (await stateOf('prologue')) === 'new')
  check('書架：舊存檔通關章節的開場、結尾都解鎖', (await stateOf('huaguoshan-open')) === 'new' && (await stateOf('huaguoshan-close')) === 'new')
  check('書架：沒玩過的章節鎖著', (await stateOf('life-open')) === 'locked' && (await stateOf('life-close')) === 'locked' && (await stateOf('finale')) === 'locked')
  const text = await page.getByTestId('story-shelf').innerText()
  check('書架：沒有倒數、不寫還差幾本', !/還差|倒數|\d+\s*\/\s*\d+|\d+\s*本/.test(text), text.replace(/\n/g, ' '))
  check('鎖著的封面不載圖（剪影）', (await page.getByTestId('story-book-life-open').locator('.ss-cover').count()) === 0)
  await page.getByTestId('story-book-life-open').click({ force: true })
  await page.waitForTimeout(300)
  check('點鎖著的：不演', (await page.getByTestId('story').count()) === 0)
  await page.getByTestId('story-book-huaguoshan-close').click()
  await waitPage(page, 'story.prologue.1', 3000)
  check('書架第一次看任何故事：先補序章', true)
  await tap(page)
  await waitPage(page, 'story.prologue.2', 3000)
  await tap(page)
  await waitPage(page, 'story.huaguoshan.close.1', 3000)
  check('序章之後接點的那本', (await storyInfo(page))?.story === 'huaguoshan-close')
  await tap(page)
  await waitPage(page, 'story.huaguoshan.close.2', 3000)
  await tap(page)
  await waitNoStory(page)
  check('演完回書架', (await page.getByTestId('story-shelf').count()) === 1)
  check('書架：看過的標記更新', (await stateOf('huaguoshan-close')) === 'seen' && (await stateOf('prologue')) === 'seen')
  await page.getByTestId('story-book-huaguoshan-close').click()
  await waitPage(page, 'story.huaguoshan.close.1', 3000)
  check('已看過的可以重看（不再補序章）', (await storyInfo(page))?.story === 'huaguoshan-close')
  await page.getByTestId('story-skip').click()
  await waitNoStory(page)
  await page.getByRole('button', { name: '回地圖' }).click()
  await page.getByTestId('map').waitFor()
  check('書架可以回地圖', true)
  check('書架：無 JS 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}
{
  // 第一站已過、還沒通關的舊存檔：不強迫，開場算解鎖
  const half = { chapterId: 'huaguoshan', run: 1, stations: [{ done: true, independent: 1, total: 1 }, ...stations(false).slice(1)], chestClaimed: false, completedRuns: 0, updatedAt: 1 }
  const { ctx, page } = await storyApp(browser, LAND, { seed: { progress: [half] } })
  await toMap(page)
  await page.getByTestId('station-2').click()
  await inStage(page)
  check('玩到一半的舊存檔：第二站不演', (await page.getByTestId('story').count()) === 0)
  await toHash(page, 'stories')
  await page.getByTestId('story-shelf').waitFor()
  check('玩到一半的舊存檔：開場解鎖、結尾還沒', (await page.getByTestId('story-book-huaguoshan-open').getAttribute('data-state')) === 'new' && (await page.getByTestId('story-book-huaguoshan-close').getAttribute('data-state')) === 'locked')
  await ctx.close()
}

// ---------- 9. 多個孩子各自獨立 ----------
{
  const { ctx, page, errors } = await storyApp(browser, LAND)
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.prologue.1')
  await page.getByTestId('story-skip').click()
  await inStage(page)
  check('第一個孩子看過了', (await storySeen(page)).includes('prologue'))
  await page.evaluate(() => (location.hash = '#home'))
  await page.waitForSelector('[data-testid=pet]')
  // 加第二個孩子（兔兔）
  await page.getByRole('button', { name: /家長入口/ }).click()
  await page.waitForSelector('button.key')
  await page.evaluate(() => {
    for (const d of '1234') [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
  })
  await page.waitForTimeout(200)
  await page.getByRole('tab', { name: '設定', exact: true }).click()
  await page.getByTestId('kid-add').click()
  await page.getByTestId('kid-name').fill('小花')
  await page.getByTestId('child-age-3').click()
  await page.getByTestId('species-rabbit').click()
  await page.getByTestId('kid-add-submit').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=kid-row]').length === 2)
  await page.reload()
  await page.getByTestId('child-picker').waitFor()
  await page.getByTestId('child-card').filter({ hasText: '小花' }).click()
  await page.waitForSelector('[data-testid=room]')
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.prologue.1')
  check('第二個孩子：自己的進度，序章重新演', (await storyInfo(page))?.story === 'prologue')
  await tap(page)
  await waitPage(page, 'story.prologue.2@rabbit', 3000)
  check('第二個孩子（兔兔）：寵物是兔子、字幕叫兔兔', (await page.getByTestId('story-pet').getAttribute('data-species')) === 'rabbit' && (await page.getByTestId('story-caption').innerText()).includes('兔兔說'))
  await page.getByTestId('story-skip').click()
  await inStage(page)
  // 回第一個孩子：沒被第二個孩子影響
  await page.reload()
  await page.getByTestId('child-picker').waitFor()
  await page.getByTestId('child-card').filter({ hasText: '小明' }).click()
  await page.waitForSelector('[data-testid=room]')
  check('第一個孩子的紀錄只有自己的', (await storySeen(page)).join() === 'prologue,huaguoshan-open', (await storySeen(page)).join())
  check('多孩子：無 JS 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- 10. 三個物種：寵物圖、字幕、語音都要對 ----------
for (const [species, name, prefix] of [['monkey', '阿悟', 'pet-'], ['rabbit', '兔兔', 'pet-rabbit-'], ['tiger', '虎虎', 'pet-tiger-']]) {
  const { ctx, page, errors } = await storyApp(browser, LAND, { seed: { species } })
  const suffix = species === 'monkey' ? '' : `@${species}`
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.prologue.1')
  await tap(page)
  await waitPage(page, `story.prologue.2${suffix}`, 3000)
  const art = await page.getByTestId('story-pet').getAttribute('data-art')
  check(`${name}：寵物圖物種正確`, art?.startsWith(prefix) && (species !== 'monkey' || !/rabbit|tiger/.test(art)), art)
  check(`${name}：字幕用自己的名字`, (await page.getByTestId('story-caption').innerText()).trim() === `她叫小星。小星的光不見了，回不了家。${name}說：別怕，我陪你找回來！`)
  await page.waitForFunction((n) => window.__spoken.some((t) => t.includes(`${n}說`)), name, { timeout: 3000 })
  check(`${name}：旁白也唸自己的名字`, true)
  const img = await page.getByTestId('story-pet').locator('img').evaluate((e) => e.getAttribute('src'))
  check(`${name}：實際畫出來的圖是這個物種`, img.includes(`/art/${art}.png`), img)
  await page.getByTestId('story-skip').click()
  await inStage(page)
  check(`${name}：無 JS 錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}
{
  const { ctx, page } = await storyApp(browser, LAND, { stage: 'egg', seed: { species: 'tiger', seen: ['prologue', 'finale'] } })
  await toHash(page, 'stories')
  await page.getByTestId('story-book-prologue').click()
  await waitPage(page, 'story.prologue.1', 3000)
  await tap(page)
  await waitPage(page, 'story.prologue.2@tiger', 3000)
  const art = await page.getByTestId('story-pet').getAttribute('data-art')
  check('還是蛋：畫這個物種的蛋，不畫孵出來的樣子', art?.startsWith('pet-tiger-egg'), art)
  await ctx.close()
}

// ---------- 11. 真的語音包：key 對到音檔（含物種版本） ----------
{
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public/voice/manifest.json'), 'utf8'))
  const { ctx, page } = await freshApp(browser, LAND, { welcome: false })
  await page.evaluate(() => {
    localStorage.setItem('gq-story-test', '1')
    localStorage.setItem('gq-voice-pack-test', '1')
  })
  await patchPet(page, { species: 'rabbit' })
  const voiceReqs = []
  page.on('request', (r) => {
    if (r.url().includes('/voice/') && r.url().endsWith('.m4a')) voiceReqs.push(r.url())
  })
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  await page.mouse.click(5, 5)
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.prologue.1')
  await page.waitForTimeout(900)
  const f1 = manifest['story.prologue.1']?.file
  check('語音包：序章第 1 句有檔而且真的去抓了', !!f1 && voiceReqs.some((u) => u.endsWith(f1)), f1)
  await tap(page)
  await waitPage(page, 'story.prologue.2@rabbit', 3000)
  await page.waitForTimeout(900)
  const f2 = manifest['story.prologue.2@rabbit']?.file
  check('語音包：兔兔版有自己的檔、抓的是兔兔版不是阿悟版', !!f2 && voiceReqs.some((u) => u.endsWith(f2)) && !voiceReqs.some((u) => u.endsWith(manifest['story.prologue.2']?.file)), f2)
  await ctx.close()
  const allKeys = Object.keys(manifest).filter((k) => k.startsWith('story.'))
  check('語音包：24 句 + 6 個物種版本都有檔', allKeys.length === 30, String(allKeys.length))
}

// ---------- 12. 版面：三種尺寸，字幕不壓角色、不溢出；只預載下一頁 ----------
for (const [label, vp] of [['iPad 橫', LAND], ['iPad 直', PORT], ['手機', PHONE]]) {
  const { ctx, page, errors } = await storyApp(browser, vp, { speech: 'silent', seed: { seen: ['prologue'] } })
  const arts = new Set()
  page.on('request', (r) => {
    const m = /\/art\/(story-[^/]+)\.jpg/.exec(r.url())
    if (m) arts.add(m[1])
  })
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.huaguoshan.open.1')
  await page.waitForTimeout(900)
  check(`${label}：只載這一頁和下一頁的背景`, [...arts].sort().join() === 'story-huaguoshan-open-1,story-huaguoshan-open-2', [...arts].join())
  const m = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect().toJSON()
    return { cap: r('[data-testid=story-caption]'), pet: r('[data-testid=story-pet]'), star: r('[data-testid=story-star]'), skip: r('[data-testid=story-skip]'), w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }
  })
  check(`${label}：字幕不壓寵物`, m.pet.bottom <= m.cap.top + 1, `${m.pet.bottom} / ${m.cap.top}`)
  check(`${label}：字幕不壓小星`, m.star.bottom <= m.cap.top + 1, `${m.star.bottom} / ${m.cap.top}`)
  check(`${label}：寵物、小星、字幕都在畫面內`, m.cap.bottom <= m.h && m.cap.left >= 0 && m.cap.right <= m.w && m.pet.left >= 0 && m.star.right <= m.w, JSON.stringify(m.cap))
  check(`${label}：跳過按鈕在右上、夠大、不壓字幕`, m.skip.right <= m.w && m.skip.top < m.h * 0.1 && m.skip.height >= 44, JSON.stringify(m.skip))
  check(`${label}：沒有捲動溢出`, m.sw <= m.w + 2 && m.sh <= m.h + 2)
  const fs = await page.getByTestId('story-caption').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
  check(`${label}：字幕字夠大`, fs >= 19, String(fs))
  await page.getByTestId('story-skip').click()
  await inStage(page)
  await toHash(page, 'stories')
  await page.getByTestId('story-shelf').waitFor()
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)
  check(`${label}：書架沒有橫向溢出`, !over)
  await toMap(page)
  const entry = await page.getByTestId('story-shelf-btn').boundingBox()
  check(`${label}：地圖的故事入口在畫面內、夠大`, entry && entry.x >= 0 && entry.x + entry.width <= vp.width && entry.height >= 44, JSON.stringify(entry))
  const mapOver = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)
  check(`${label}：地圖加了入口沒有橫向溢出`, !mapOver)
  check(`${label}：無 JS 錯誤`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- 13. 缺圖不破版 ----------
{
  const { ctx, page, errors } = await storyApp(browser, LAND, { seed: { seen: ['prologue'] } })
  await page.route('**/art/story-*.jpg', (r) => r.abort())
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.huaguoshan.open.1')
  await page.waitForSelector('.sb-layer[data-missing=true][data-ready=true]', { timeout: 3000 })
  const bg = await page.locator('.sb-layer').last().evaluate((e) => getComputedStyle(e).backgroundImage)
  check('缺圖：退回底色漸層', bg.includes('gradient'), bg)
  check('缺圖：不留破圖', (await page.locator('.sb-layer img').count()) === 0)
  await tap(page)
  await waitPage(page, 'story.huaguoshan.open.2', 3000)
  check('缺圖：照樣翻頁', true)
  await tap(page)
  await waitNoStory(page)
  await inStage(page)
  await toHash(page, 'stories')
  await page.getByTestId('story-shelf').waitFor()
  await page.waitForTimeout(400)
  check('缺圖：書架封面退回底色', (await page.locator('.ss-cover').count()) === 0)
  check('缺圖：無 JS 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---------- 14. 減少動態 ----------
{
  const { ctx, page, errors } = await storyApp(browser, LAND, { ctxOpts: { reducedMotion: 'reduce' }, seed: { seen: ['prologue'] } })
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.huaguoshan.open.1')
  await page.waitForTimeout(300)
  const r = await page.evaluate(() => ({
    kb: getComputedStyle(document.querySelector('.sb-kb')).animationName,
    fx: getComputedStyle(document.querySelector('.sb-fx')).display,
    float: getComputedStyle(document.querySelector('.sb-star-float')).animationName,
    bob: getComputedStyle(document.querySelector('.sb-pet-bob')).animationName,
  }))
  check('減少動態：Ken Burns、環境動態、漂浮都關了', r.kb === 'none' && r.fx === 'none' && r.float === 'none' && r.bob === 'none', JSON.stringify(r))
  await tap(page)
  await waitPage(page, 'story.huaguoshan.open.2', 3000)
  check('減少動態：照樣能翻頁', true)
  check('減少動態：無 JS 錯誤', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// 動畫：一般情況下 Ken Burns 與環境動態真的在跑
{
  const { ctx, page } = await storyApp(browser, LAND, { seed: { seen: ['prologue'] } })
  await toMap(page)
  await page.getByTestId('station-1').click()
  await waitPage(page, 'story.huaguoshan.open.1')
  await page.waitForTimeout(1000)
  const t1 = await page.locator('.sb-kb').first().evaluate((e) => getComputedStyle(e).transform)
  await page.waitForTimeout(800)
  const t2 = await page.locator('.sb-kb').first().evaluate((e) => getComputedStyle(e).transform)
  check('Ken Burns 真的在動', t1 !== t2 && t1 !== 'none', `${t1} → ${t2}`)
  check('環境動態有粒子', (await page.locator('.sb-fx i').count()) >= 8)
  const pos1 = await page.locator('.sb-star-float').evaluate((e) => getComputedStyle(e).transform)
  await page.waitForTimeout(600)
  const pos2 = await page.locator('.sb-star-float').evaluate((e) => getComputedStyle(e).transform)
  check('小星在漂浮', pos1 !== pos2, `${pos1} → ${pos2}`)
  await tap(page)
  await page.waitForTimeout(150)
  check('換頁：新舊兩層背景交叉淡入', (await page.locator('.sb-layer').count()) === 2)
  await page.waitForTimeout(1500)
  check('換頁：淡入完舊的拿掉', (await page.locator('.sb-layer').count()) === 1)
  await ctx.close()
}

await browser.close()
console.log(`\n${state.failed ? `失敗 ${state.failed} 項` : '全部通過'}（BASE ${BASE}）`)
process.exit(state.failed ? 1 : 0)
