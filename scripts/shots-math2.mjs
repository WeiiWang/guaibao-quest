// 數學第 2 章（水簾洞）三種尺寸截圖 → design/screens/v6-math-<畫面>-<land|port|phone>.png
// 用法：先啟動 dev server（pnpm exec vite --port 5182 --strictPort），再 BASE_URL=http://localhost:5182 node scripts/shots-math2.mjs
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshApp, idb, launch } from './e2e-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ALL = ['number', 'classify', 'pattern', 'measure', 'space', 'observe'].flatMap((f) => JSON.parse(readFileSync(join(ROOT, `src/learning/content/${f}.json`), 'utf8')))
const SHOTS = join(ROOT, 'design/screens')
mkdirSync(SHOTS, { recursive: true })
const SIZES = { land: { width: 1024, height: 768 }, port: { width: 768, height: 1024 }, phone: { width: 375, height: 812 } }
const find = (pred, n = 0) => ALL.filter((q) => !q.gentle && pred(q))[n]

/** 每個畫面：要出的題（或 map）、技能難度、截圖前的動作 */
const SCREENS = [
  { name: 'map-ch1', map: 'huaguoshan' },
  { name: 'map-ch2', map: 'shuiliandong' },
  { name: 'bigger-size', q: find((q) => q.type === 'bigger' && q.params.dim === 'size' && q.difficulty === 2), levels: { measure: 2 } },
  { name: 'bigger-length', q: find((q) => q.type === 'bigger' && q.params.dim === 'length' && q.difficulty === 2), levels: { measure: 2 } },
  { name: 'bigger-height', q: find((q) => q.type === 'bigger' && q.params.dim === 'height' && q.difficulty === 3), levels: { measure: 3 } },
  { name: 'order-size', q: find((q) => q.type === 'order' && q.params.dim === 'size' && q.difficulty === 3), levels: { measure: 3 } },
  { name: 'order-length', q: find((q) => q.type === 'order' && q.params.dim === 'length' && q.difficulty === 4), levels: { measure: 4 } },
  { name: 'where', q: find((q) => q.type === 'where' && q.difficulty === 3), levels: { space: 3 } },
  { name: 'whereis', q: find((q) => q.type === 'whereIs' && q.difficulty === 2), levels: { space: 2 } },
  { name: 'row', q: find((q) => q.type === 'row'), levels: { space: 4 } },
  { name: 'place', q: find((q) => q.type === 'place' && q.difficulty === 3), levels: { space: 3 } },
  { name: 'place-two', q: find((q) => q.type === 'place' && q.difficulty === 4 && q.params.rel === 'between'), levels: { space: 4 } },
  { name: 'recall', q: find((q) => q.type === 'recall' && q.difficulty === 2), levels: { observe: 2 }, wait: 4200 },
  { name: 'gone', q: find((q) => q.type === 'gone' && q.difficulty === 4), levels: { observe: 4 }, wait: 5400 },
  { name: 'spot', q: find((q) => q.type === 'spot' && q.difficulty === 4 && q.choices.length === 6), levels: { observe: 4 } },
  { name: 'flip-small', q: find((q) => q.type === 'flip' && q.difficulty === 1), levels: { observe: 1 } },
  { name: 'flip-big', q: find((q) => q.type === 'flip' && q.difficulty === 4), levels: { observe: 4 } },
  { name: 'tutorial-order', q: find((q) => q.type === 'order' && q.difficulty === 1), levels: { measure: 1 }, intros: [], wait: 1900 },
]

const browser = await launch()
try {
  for (const [size, viewport] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await freshApp(browser, viewport)
    let n = 0
    for (const sc of SCREENS) {
      const sessionId = `shots-${++n}-${Date.now()}`
      await idb(
        page,
        (db, o) =>
          new Promise((res) => {
            const tx = db.transaction(['settings', 'attempts', 'progress', 'skillState'], 'readwrite')
            const st = tx.objectStore('settings')
            st.get('main').onsuccess = (e) => {
              st.put({
                ...e.target.result,
                seenIntros: o.intros,
                unlockedChapters: ['shuiliandong'],
                stageDraft: o.ids ? { chapterId: 'shuiliandong', station: 1, run: 1, sessionId: o.sessionId, plan: o.ids.map((id) => ({ id, review: false, followUp: false })), savedAt: Date.now() } : undefined,
              })
            }
            tx.objectStore('attempts').clear()
            const sk = tx.objectStore('skillState')
            sk.clear()
            for (const [skill, difficulty] of Object.entries(o.levels)) sk.put({ skill, difficulty, recent: [], stationStreak: 0, mastered: {}, updatedAt: Date.now(), total: 50 })
            const pr = tx.objectStore('progress')
            pr.clear()
            tx.oncomplete = () => res(1)
          }),
        { ids: sc.q ? Array(5).fill(sc.q.id) : null, sessionId, levels: sc.levels ?? {}, intros: sc.intros ?? ['tapN', 'dragSort', 'dragOrder', 'place', 'flip'] },
      )
      await page.evaluate((c) => {
        localStorage.setItem('gq-chapter-math', c)
        location.hash = 'map'
      }, sc.map ?? 'shuiliandong')
      await page.reload()
      await page.waitForSelector('[data-testid=map]')
      if (!sc.map) {
        await page.getByTestId('station-1').click()
        await page.waitForSelector('[data-testid=question]')
      }
      await page.waitForTimeout(sc.wait ?? 900)
      await page.screenshot({ path: join(SHOTS, `v6-math-${sc.name}-${size}.png`) })
    }
    // 章節鎖：全新的孩子看到的地圖（第 2 章還沒開）
    await idb(page, (db) => new Promise((res) => {
      const tx = db.transaction(['settings', 'progress'], 'readwrite')
      tx.objectStore('progress').clear()
      tx.objectStore('settings').get('main').onsuccess = (e) => tx.objectStore('settings').put({ ...e.target.result, unlockedChapters: [], stageDraft: undefined })
      tx.oncomplete = () => res(1)
    }))
    await page.evaluate(() => {
      localStorage.setItem('gq-chapter-math', 'huaguoshan')
      location.hash = 'map'
    })
    await page.reload()
    await page.waitForSelector('[data-testid=map]')
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(SHOTS, `v6-math-chapters-locked-${size}.png`) })
    if (errors.length) console.log(size, '錯誤：', errors)
    await ctx.close()
    console.log(`${size} 完成`)
  }
} finally {
  await browser.close()
}
