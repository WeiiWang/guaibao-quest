// 產生 src/art/coloring/region-counts.json：每張點陣著色頁的可填色區塊數（著色本卡片的難度星等用）。
// 區塊表只有 TS 實作（Web Worker 裡算），所以借 dev server 的模組來算：
//   先 pnpm dev，再 BASE_URL=http://localhost:5180 node scripts/gen-region-counts.mjs
// 線稿或區塊門檻改了就要重跑。
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './e2e-lib.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5180'
const browser = await launch()
const page = await browser.newPage()
await page.goto(BASE)
const counts = await page.evaluate(async () => {
  const defs = await import('/src/art/coloring/rasterDefs.ts')
  const m = await import('/src/art/coloring/rasterArt.ts')
  const out = {}
  for (const d of defs.AVAILABLE_RASTER) out[d.id] = (await m.getRasterArt(d.id)).map.regions.length
  return out
})
await browser.close()
const file = join(dirname(fileURLToPath(import.meta.url)), '../src/art/coloring/region-counts.json')
writeFileSync(file, JSON.stringify(counts, null, 1) + '\n')
console.log(counts)
