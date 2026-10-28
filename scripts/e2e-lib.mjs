// e2e 共用工具（Playwright）：找 Chromium、建立全新 App、讀寫 IndexedDB、透過 PM 分頁觸發寵物行為。
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const BASE = process.env.BASE_URL ?? 'http://localhost:5182'

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(root)) return undefined
  for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const p = join(root, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(p)) return p
  }
  return undefined
}

export const launch = () => chromium.launch({ executablePath: findChrome() })

export function makeChecker() {
  const state = { failed: 0 }
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`)
    if (!ok) state.failed++
  }
  return { state, check }
}

/**
 * 全新的 App（含 onboarding）。
 * opts.rand：固定 Math.random 的回傳值（測打嗝/大便機率用）。
 * opts.tod：預先指定日夜（'day' | 'dusk' | 'night'），預設 'day'，讓測試不受真實時間影響。
 * opts.stage：寵物階段（預設 adult）。
 * opts.fast：自主行為加速（2–4 秒）。
 */
export async function freshApp(browser, viewport, opts = {}) {
  // welcome: true = 保留 v7 的歡迎禮物（20 顆星星 + 1 根香蕉 + 禮物袋）；預設拿掉，讓舊測試維持「新孩子 0 星星、沒有禮物」的前提
  const { rand, tod = 'day', stage = 'adult', fast = false, bananas = 5, ctxOpts = {}, decor = [], welcome = false } = opts
  const ctx = await browser.newContext({ viewport, ...ctxOpts })
  await ctx.addInitScript(
    ({ rand, tod, fast }) => {
      try {
        if (tod && tod !== 'auto' && !localStorage.getItem('gq-pet-tod-set')) {
          localStorage.setItem('gq-pet-tod', tod)
          localStorage.setItem('gq-pet-tod-set', '1')
        }
        if (fast) localStorage.setItem('gq-pet-fast', '1')
      } catch {
        /* ignore */
      }
      if (typeof rand === 'number') Math.random = () => rand
      // 計算 WebAudio 發聲次數（驗證音效與音效開關）
      window.__audio = { osc: 0, noise: 0 }
      // 追蹤尚未觸發 / 尚未清掉的計時器，驗證元件卸載時有清乾淨
      const live = new Set()
      window.__timers = live
      const st = window.setTimeout.bind(window)
      const ct = window.clearTimeout.bind(window)
      const si = window.setInterval.bind(window)
      const ci = window.clearInterval.bind(window)
      window.setTimeout = (fn, ms, ...a) => {
        const id = st((...x) => {
          live.delete(id)
          return typeof fn === 'function' ? fn(...x) : undefined
        }, ms, ...a)
        live.add(id)
        return id
      }
      window.clearTimeout = (id) => {
        live.delete(id)
        return ct(id)
      }
      window.setInterval = (fn, ms, ...a) => {
        const id = si(fn, ms, ...a)
        live.add(id)
        return id
      }
      window.clearInterval = (id) => {
        live.delete(id)
        return ci(id)
      }
      const AC = window.AudioContext || window.webkitAudioContext
      if (AC) {
        const co = AC.prototype.createOscillator
        AC.prototype.createOscillator = function (...a) {
          window.__audio.osc++
          return co.apply(this, a)
        }
        const cb = AC.prototype.createBufferSource
        AC.prototype.createBufferSource = function (...a) {
          window.__audio.noise++
          return cb.apply(this, a)
        }
      }
    },
    { rand, tod, fast },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    // 美術圖還沒生成完時會有 404，屬預期，不算錯
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  await page.goto(BASE)
  await page.waitForSelector('button.key')
  await pressPin(page, '1234')
  await pressPin(page, '1234')
  await page.getByPlaceholder('小朋友的名字').fill('小明')
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByTestId('onboard-age-skip').click() // v7：onboarding 多一頁「幾歲」；舊測試選「之後再設定」，維持年齡未設定的前提
  await page.getByRole('button', { name: '下一步' }).click()
  await page.getByRole('button', { name: '開始冒險' }).click()
  await page.waitForSelector('[data-testid=room]')
  await idb(
    page,
    (db, o) =>
      new Promise((res) => {
        const tx = db.transaction(['pets', 'inventory', 'ledger', 'settings'], 'readwrite')
        const pets = tx.objectStore('pets')
        const inv = tx.objectStore('inventory')
        if (!o.welcome) {
          const led = tx.objectStore('ledger')
          led.getAll().onsuccess = (e) => e.target.result.filter((l) => l.reason === '歡迎禮物').forEach((l) => led.delete(l.id))
          const st = tx.objectStore('settings')
          st.get('main').onsuccess = (e) => st.put({ ...e.target.result, pendingGifts: [] })
        }
        pets.get('pet').onsuccess = (e) => {
          const pet = e.target.result
          pets.put({ ...pet, stage: o.stage, feedCount: o.feed, hunger: 90, hungerUpdatedAt: Date.now() })
        }
        inv.put({ id: 'banana', itemId: 'banana', qty: o.bananas })
        for (const id of o.decor) inv.put({ id, itemId: id, qty: 1 })
        tx.oncomplete = () => res(1)
      }),
    { stage, feed: stage === 'adult' ? 80 : stage === 'baby' ? 20 : 0, bananas, decor, welcome },
  )
  await page.reload()
  await page.waitForSelector('[data-testid=pet]')
  return { ctx, page, errors }
}

export async function pressPin(page, pin) {
  await page.evaluate((p) => {
    for (const d of p) [...document.querySelectorAll('button.key')].find((b) => b.textContent === d).click()
  }, pin)
  // 等待放在 node 端（頁面端的 setTimeout 會被假時鐘卡住）
  await page.waitForTimeout(200)
}

/** 在頁面內操作 IndexedDB：fn(db, arg) 收到已開啟的 db，要回傳可序列化的值（fn 會被序列化，不能用外部變數） */
export function idb(page, fn, arg) {
  return page.evaluate(
    ([src, arg]) =>
      new Promise((res, rej) => {
        const rq = indexedDB.open('guaibao-quest')
        rq.onerror = () => rej(rq.error)
        rq.onsuccess = async () => {
          try {
            res(await new Function('return ' + src)()(rq.result, arg))
          } catch (e) {
            rej(e)
          }
        }
      }),
    [fn.toString(), arg],
  )
}

export const getPet = (page) =>
  idb(page, (db) => new Promise((r) => (db.transaction('pets').objectStore('pets').get('pet').onsuccess = (e) => r(e.target.result))))

/** 直接改寫 Pet（不經 Dexie；改完要 reload 才會被畫面看到） */
export const patchPet = (page, patch) =>
  idb(
    page,
    (db, patch) =>
      new Promise((r) => {
        const s = db.transaction('pets', 'readwrite').objectStore('pets')
        s.get('pet').onsuccess = (e) => {
          s.put({ ...e.target.result, ...patch }).onsuccess = () => r(1)
        }
      }),
    patch,
  )

/** 進家長區（PIN 1234）並切到指定分頁 */
export async function openParentTab(page, tabName) {
  await page.getByRole('button', { name: /家長入口/ }).click()
  await page.waitForSelector('button.key')
  await pressPin(page, '1234')
  await page.getByRole('tab', { name: tabName, exact: true }).click()
}

/** 透過 PM 預覽觸發寵物行為（按下後會自動回首頁） */
export async function pmTrigger(page, cmd) {
  await openParentTab(page, 'PM 預覽')
  await page.locator(`[data-cmd=${cmd}]`).click()
  await page.waitForSelector('[data-testid=pet]')
}

/** PM 切日夜（停留在 PM 分頁），再回首頁 */
export async function pmSetTod(page, mode) {
  await openParentTab(page, 'PM 預覽')
  await page.locator(`[data-tod=${mode}]`).click()
  await page.getByRole('button', { name: '回首頁看看' }).click()
  await page.waitForSelector('[data-testid=pet]')
}

/** 每 step ms 取樣一次寵物狀態，直到 total ms */
export function sample(page, total = 3000, step = 40) {
  return page.evaluate(
    ([total, step]) =>
      new Promise((res) => {
        const out = []
        const t0 = performance.now()
        const snap = () => {
          const pet = document.querySelector('[data-testid=pet]')
          const food = document.querySelector('[data-testid=pet-food]')
          out.push({
            t: Math.round(performance.now() - t0),
            pose: pet?.dataset.pose ?? null,
            anim: pet?.dataset.anim ?? null,
            asleep: pet?.dataset.asleep ?? null,
            phase: food?.dataset.phase ?? null,
            bites: food ? Number(food.dataset.bites) : null,
            crumbs: !!document.querySelector('[data-testid=pet-crumbs]'),
            hearts: !!document.querySelector('[data-testid=fx-hearts]'),
            notes: !!document.querySelector('[data-testid=fx-notes]'),
            sparkles: !!document.querySelector('[data-testid=fx-sparkles]'),
            cloud: !!document.querySelector('[data-testid=fx-cloud]'),
            orbit: !!document.querySelector('[data-testid=fx-orbit]'),
            zzz: !!document.querySelector('[data-testid=pet-zzz]'),
            burst: !!document.querySelector('[data-testid=poop-burst]'),
            bubble: document.querySelector('[data-testid=pet-bubble]')?.textContent ?? null,
            bubbleIcon: !!document.querySelector('[data-testid=pet-bubble] img, [data-testid=pet-bubble] .art-emoji'),
            poops: document.querySelectorAll('[data-testid=poop]').length,
            left: Math.round(document.querySelector('[data-testid=pet-slot]')?.getBoundingClientRect().left ?? -1),
          })
          if (performance.now() - t0 < total) setTimeout(snap, step)
          else res(out)
        }
        snap()
      }),
    [total, step],
  )
}

export const center = async (page, sel) => {
  await page.locator(sel).first().scrollIntoViewIfNeeded()
  const b = await page.locator(sel).first().boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}

/** 拖曳（滑鼠）：from → to，放開後等 settle ms */
export const drag = async (page, from, to, { hold = false, settle = 0 } = {}) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 10, from.y - 40, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 10 })
  if (hold) return
  await page.mouse.up()
  if (settle) await page.waitForTimeout(settle)
}

/** v7：拿掉新孩子的歡迎禮物（20 顆星星流水帳 + 禮物袋佇列），讓自己 onboarding 的舊測試維持「新孩子 0 星星」的前提。要 reload 才會被畫面看到 */
export const stripWelcome = (page) =>
  idb(
    page,
    (db) =>
      new Promise((res) => {
        const tx = db.transaction(['ledger', 'settings'], 'readwrite')
        const led = tx.objectStore('ledger')
        led.getAll().onsuccess = (e) => e.target.result.filter((l) => l.reason === '歡迎禮物').forEach((l) => led.delete(l.id))
        const st = tx.objectStore('settings')
        st.get('main').onsuccess = (e) => st.put({ ...e.target.result, pendingGifts: [] })
        tx.oncomplete = () => res(1)
      }),
  )
