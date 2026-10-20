// 依 public/art/decor-<name>.png 的實際尺寸，更新 src/art/items.ts 裡 DECOR_BOX 的 aspect（寬/高）。
// 用法：node scripts/fit-decor-box.mjs         → 只列出會改的項目
//       node scripts/fit-decor-box.mjs --write  → 寫回 items.ts
// h（佔房間高度的比例）是設計決定，不會被改；缺圖的項目維持原值。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const FILE = 'src/art/items.ts'
const write = process.argv.includes('--write')
let src = readFileSync(FILE, 'utf8')
const missing = []
let changed = 0
src = src.replace(/^(\s+)(\w+): \{ h: ([\d.]+), aspect: ([^}]+?) \},$/gm, (line, indent, name, h, aspect) => {
  const f = `public/art/decor-${name}.png`
  if (!existsSync(f)) {
    missing.push(name)
    return line
  }
  const buf = readFileSync(f)
  const w = buf.readUInt32BE(16)
  const ht = buf.readUInt32BE(20)
  const next = `${w} / ${ht}`
  if (next === aspect.trim()) return line
  changed++
  console.log(`${name}: aspect ${aspect.trim()} -> ${next}  (${(w / ht).toFixed(3)})`)
  return `${indent}${name}: { h: ${h}, aspect: ${next} },`
})
console.log(changed ? `${changed} 項需要更新${write ? '（已寫入）' : '（加 --write 寫入）'}` : '全部符合實際圖片')
if (missing.length) console.log(`還沒有圖：${missing.join(', ')}`)
if (write && changed) writeFileSync(FILE, src)
