// 匯出所有會唸出來的句子：key → 文字（JSON）。之後用來批次生成預錄音檔（Voicebox），
// 音檔以 key 命名，執行時 say(key, text) 先找檔、沒有才退回 Web Speech。
// 用法：node scripts/export-speech-lines.mjs [--out 檔案路徑]   （沒給 --out 就印到 stdout）
// 句子來源：題庫 JSON（題目、提示、逐個唸的詞）+ src/learning/lines.ts 的固定台詞與數字。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allLines } from '../src/learning/lines.ts'

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '../src/learning/content')
const bank = ['number', 'classify', 'pattern'].flatMap((f) => JSON.parse(readFileSync(join(CONTENT, `${f}.json`), 'utf8')))
const lines = allLines(bank)
const json = `${JSON.stringify(lines, null, 2)}\n`

const out = process.argv.indexOf('--out')
if (out > 0 && process.argv[out + 1]) {
  writeFileSync(process.argv[out + 1], json)
  console.error(`${Object.keys(lines).length} 句 → ${process.argv[out + 1]}`)
} else process.stdout.write(json)
