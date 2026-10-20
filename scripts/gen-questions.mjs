// 題庫產生器（固定 seed，輸出可重現）。
// 用法：node scripts/gen-questions.mjs
// 輸出：src/learning/content/{number,classify,pattern}.json
// 產出的 JSON 會進版控，供人工審閱；執行期不跑這支程式。
// 題目是否合理由 src/learning/bank.test.ts 用獨立的解題邏輯驗證。
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/learning/content')
const PER_CELL = 14

const OBJ = {
  'obj-banana': { name: '香蕉', unit: '根', category: 'fruit', color: '黃' },
  'obj-peach': { name: '桃子', unit: '顆', category: 'fruit', color: '粉' },
  'obj-apple': { name: '蘋果', unit: '顆', category: 'fruit', color: '紅' },
  'obj-grape': { name: '葡萄', unit: '串', category: 'fruit', color: '紫' },
  'obj-fish': { name: '小魚', unit: '條', category: 'animal', color: '藍' },
  'obj-chick': { name: '小雞', unit: '隻', category: 'animal', color: '黃' },
  'obj-rabbit': { name: '小兔', unit: '隻', category: 'animal', color: '白' },
  'obj-flower': { name: '花', unit: '朵', category: 'nature', color: '粉' },
  'obj-shell': { name: '貝殼', unit: '個', category: 'nature', color: '粉橘' },
  'obj-star': { name: '星星', unit: '顆', category: 'nature', color: '黃' },
}
const IDS = Object.keys(OBJ)
const CAT_NAME = { fruit: '水果', animal: '動物', nature: '大自然' }
const CAT_HINT = {
  fruit: '水果是甜甜的，可以吃的食物喔。',
  animal: '動物會動，有的會游，有的會跑。',
  nature: '花、貝殼和星星，都是大自然裡的東西。',
}

// ---------- 小工具 ----------
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let rnd = mulberry32(1)
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const sample = (arr, n) => shuffle(arr).slice(0, n)
const num = (n) => ({ id: String(n), label: String(n) })

/** 每格重新固定 seed，改一格不會影響其他格 */
function cell(skill, difficulty, build) {
  rnd = mulberry32(skill.length * 1000 + difficulty * 97)
  const out = []
  const seen = new Set()
  let guard = 0
  while (out.length < PER_CELL) {
    if (++guard > 5000) throw new Error(`${skill}-${difficulty} 產不出足夠不重複的題目`)
    const q = build(out.length)
    const sig = JSON.stringify([q.type, q.prompt, q.items, q.choices.map((c) => c.id).sort()])
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push({
      id: `${skill}-${difficulty}-${String(out.length + 1).padStart(2, '0')}`,
      skill,
      difficulty,
      ...q,
      version: 1,
    })
  }
  return out
}

// ---------- 數感 ----------
function countQ(n, obj, choiceNums) {
  const o = OBJ[obj]
  return {
    type: 'count',
    prompt: `數一數，有幾${o.unit}${o.name}？`,
    items: [{ obj, count: n }],
    choices: choiceNums.map(num),
    answer: String(n),
    hint: '跟阿悟一起，一個一個慢慢數。數到最後一個，就是答案囉。',
  }
}
function choiceNumbers(n, lo, hi, k = 3) {
  const pool = []
  for (let v = Math.max(lo, n - 3); v <= Math.min(hi, n + 3); v++) if (v !== n) pool.push(v)
  return [n, ...sample(pool, k - 1)].sort((a, b) => a - b)
}
function compareQ(a, b, obj) {
  const o = OBJ[obj]
  const [left, right] = rnd() < 0.5 ? [a, b] : [b, a]
  return {
    type: 'compare',
    prompt: `哪一堆的${o.name}比較多？`,
    items: [],
    choices: [
      { id: 'A', obj, count: left },
      { id: 'B', obj, count: right },
    ],
    answer: left > right ? 'A' : 'B',
    hint: '先數數看左邊有幾個，再數數右邊有幾個，數字比較大的那一堆就是比較多喔。',
  }
}
function diffQ(a, b, obj) {
  const o = OBJ[obj]
  const [big, small] = [Math.max(a, b), Math.min(a, b)]
  const d = big - small
  return {
    type: 'diff',
    prompt: `左邊比右邊多幾${o.unit}${o.name}？`,
    items: [
      { obj, count: big },
      { obj, count: small },
    ],
    choices: [1, 2, 3, 4].map(num),
    answer: String(d),
    hint: '先數左邊，再數右邊。左邊多出來的，就是答案。',
  }
}

const numberCells = {
  1: cell('number', 1, (i) => {
    const seq = [1, 2, 3, 4, 5, 3, 2, 4, 5, 1, 3, 5, 2, 4]
    const n = seq[i % seq.length] ?? 3
    return countQ(n, IDS[(i * 3 + 1) % IDS.length], choiceNumbers(n, 1, 6))
  }),
  2: cell('number', 2, (i) => {
    if (i < 8) {
      const n = 6 + (i % 5)
      return countQ(n, IDS[(i * 3 + 2) % IDS.length], choiceNumbers(n, 5, 11))
    }
    const small = 3 + Math.floor(rnd() * 5)
    const big = small + 1 + Math.floor(rnd() * 3)
    return compareQ(small, Math.min(big, 10), pick(IDS))
  }),
  3: cell('number', 3, (i) => {
    if (i < 6) {
      const n = 11 + ((i * 3) % 10)
      return countQ(n, IDS[(i * 3 + 4) % IDS.length], choiceNumbers(n, 10, 20))
    }
    if (i < 10) {
      const small = 8 + Math.floor(rnd() * 10)
      const d = 1 + Math.floor(rnd() * 3)
      return compareQ(small, small + d, pick(IDS))
    }
    const small = 8 + Math.floor(rnd() * 10)
    return diffQ(small, small + 1 + Math.floor(rnd() * 3), pick(IDS))
  }),
}

// ---------- 分類 ----------
const byCat = (c) => IDS.filter((id) => OBJ[id].category === c)
const CATS = ['fruit', 'animal', 'nature']

function kindQ(target, choiceIds) {
  return {
    type: 'kind',
    prompt: `哪一個是${CAT_NAME[target]}？`,
    items: [],
    choices: choiceIds.map((obj) => ({ id: obj, obj })),
    answer: choiceIds.find((id) => OBJ[id].category === target),
    hint: CAT_HINT[target],
  }
}
function colorQ(color, choiceIds) {
  return {
    type: 'color',
    prompt: `哪一個是${color}色的？`,
    items: [],
    choices: choiceIds.map((obj) => ({ id: obj, obj })),
    answer: choiceIds.find((id) => OBJ[id].color === color),
    hint: `看看顏色，找出${color}色的那一個。`,
  }
}
// 顏色題只用顏色分得清楚的物件（貝殼是粉橘色，容易和粉色混淆，不放）
const COLOR_IDS = IDS.filter((id) => id !== 'obj-shell')
const COLORS = ['黃', '粉', '紅', '紫', '藍', '白']

const classifyCells = {
  1: cell('classify', 1, (i) => {
    const target = CATS[i % 3]
    const other = pick(CATS.filter((c) => c !== target))
    const a = pick(byCat(target))
    const b = pick(byCat(other))
    return kindQ(target, shuffle([a, b]))
  }),
  2: cell('classify', 2, (i) => {
    if (i < 8) {
      const color = COLORS[i % COLORS.length]
      const target = pick(COLOR_IDS.filter((id) => OBJ[id].color === color))
      // 另外兩個選項的顏色要彼此不同、也和目標不同
      const others = sample(COLORS.filter((c) => c !== color), 2).map((c) => pick(COLOR_IDS.filter((id) => OBJ[id].color === c)))
      return colorQ(color, shuffle([target, ...others]))
    }
    const target = CATS[i % 3]
    const ids = CATS.map((c) => pick(byCat(c)))
    return kindQ(target, shuffle(ids))
  }),
  3: cell('classify', 3, () => {
    const majority = pick(CATS.filter((c) => byCat(c).length >= 3))
    const triple = byCat(majority).length === 3 ? byCat(majority) : sample(byCat(majority), 3)
    const odd = pick(IDS.filter((id) => OBJ[id].category !== majority))
    return {
      type: 'odd',
      prompt: '哪一個跟別的不一樣？',
      items: [],
      choices: shuffle([...triple, odd]).map((obj) => ({ id: obj, obj })),
      answer: odd,
      hint: `看看它們是水果、動物，還是大自然的東西？有一個和其他三個不是同一類喔。`,
    }
  }),
}

// ---------- 規律 ----------
function seqQ(type, shape, abc, L, blankAt) {
  // shape: 'AB' | 'AAB' | 'ABB' | 'ABC'；abc: [A,B,C] 物件 id
  const unit = [...shape].map((ch) => abc['ABC'.indexOf(ch)])
  const at = (i) => unit[i % unit.length]
  const items = []
  for (let i = 0; i < L; i++) items.push({ obj: i === blankAt ? null : at(i) })
  let answer
  if (type === 'next') {
    items.push({ obj: null })
    answer = at(L)
  } else {
    answer = at(blankAt)
  }
  return {
    type,
    prompt: type === 'next' ? '接下來是哪一個？' : '問號的地方是哪一個？',
    items,
    choices: shuffle(abc).map((obj) => ({ id: obj, obj })),
    answer,
    hint:
      type === 'next'
        ? '從頭開始看，一個一個唸出來，找找看是哪幾個一直重複出現。'
        : '看看前後的順序，有一組一直重複出現，問號就是缺的那一個。',
  }
}
const three = () => sample(IDS, 3)

const patternCells = {
  1: cell('pattern', 1, (i) => seqQ('next', 'AB', three(), [4, 5, 6][i % 3], -1)),
  2: cell('pattern', 2, (i) => seqQ('next', i % 2 === 0 ? 'AAB' : 'ABB', three(), [5, 6, 7][Math.floor(i / 2) % 3], -1)),
  3: cell('pattern', 3, (i) => {
    if (i < 7) return seqQ('next', 'ABC', three(), [4, 5, 7, 8][i % 4], -1)
    const L = 7 + (i % 2)
    return seqQ('missing', 'ABC', three(), L, [2, 3, 4, 5][(i - 7) % 4])
  }),
}

// ---------- 輸出 ----------
/** 每題一個區塊、items/choices 每個元素一行，方便人工審閱與 diff */
function toReadableJson(questions) {
  const one = (v) => JSON.stringify(v)
  const list = (arr) => (arr.length ? `[\n${arr.map((x) => '      ' + one(x)).join(',\n')}\n    ]` : '[]')
  const blocks = questions.map((q) =>
    [
      '  {',
      `    "id": ${one(q.id)}, "skill": ${one(q.skill)}, "difficulty": ${q.difficulty}, "type": ${one(q.type)}, "version": ${q.version},`,
      `    "prompt": ${one(q.prompt)},`,
      `    "items": ${list(q.items)},`,
      `    "choices": ${list(q.choices)},`,
      `    "answer": ${one(q.answer)},`,
      `    "hint": ${one(q.hint)}`,
      '  }',
    ].join('\n'),
  )
  return `[\n${blocks.join(',\n')}\n]\n`
}

const dump = (name, cells) => {
  const all = Object.values(cells).flat()
  writeFileSync(join(OUT, `${name}.json`), toReadableJson(all))
  console.log(`${name}.json  ${all.length} 題`)
}
dump('number', numberCells)
dump('classify', classifyCells)
dump('pattern', patternCells)
