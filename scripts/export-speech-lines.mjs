// 匯出所有會唸出來的句子：key → 文字（JSON）。之後用來批次生成預錄音檔（Voicebox），
// 音檔以 key 命名，執行時 say(key, text) 先找檔、沒有才退回 Web Speech。
//
// 句子分兩種語言，各自一份清單（英文要用英文聲音另外生成）：
//   中文（zh-TW）：題庫 JSON（題目、提示、逐個唸的詞；英文科目的中文旁白也在這裡）+ src/learning/lines.ts 的固定台詞與數字
//   英文（en-US）：src/learning/english.ts 的英文單字，key 是 en.<word>，文字就是單字本身
//
// 用法：
//   node scripts/export-speech-lines.mjs                       中文清單印到 stdout（和以前一樣）
//   node scripts/export-speech-lines.mjs --lang en              英文清單印到 stdout
//   node scripts/export-speech-lines.mjs --lang all             {"zh-TW": {...}, "en-US": {...}}
//   node scripts/export-speech-lines.mjs --out lines.json       中文清單寫到 lines.json，英文清單寫到 lines.en.json
//   node scripts/export-speech-lines.mjs --out lines.json --out-en en.json   英文清單指定路徑
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allLines } from '../src/learning/lines.ts'
import { englishLines, EN_LANG } from '../src/learning/english.ts'

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '../src/learning/content')
const bank = ['number', 'classify', 'pattern', 'measure', 'space', 'observe', 'english'].flatMap((f) => JSON.parse(readFileSync(join(CONTENT, `${f}.json`), 'utf8')))
const zh = allLines(bank)
const en = englishLines()
const fmt = (o) => `${JSON.stringify(o, null, 2)}\n`

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const out = arg('--out')
if (out) {
  const outEn = arg('--out-en') ?? out.replace(/(\.json)?$/, '.en.json')
  writeFileSync(out, fmt(zh))
  writeFileSync(outEn, fmt(en))
  console.error(`中文 ${Object.keys(zh).length} 句 → ${out}；英文（${EN_LANG}）${Object.keys(en).length} 句 → ${outEn}`)
} else {
  const lang = arg('--lang') ?? 'zh'
  if (lang === 'en') process.stdout.write(fmt(en))
  else if (lang === 'all') process.stdout.write(fmt({ 'zh-TW': zh, [EN_LANG]: en }))
  else process.stdout.write(fmt(zh))
}
