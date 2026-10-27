// 題庫產生器（固定 seed，輸出可重現）。
// 用法：node scripts/gen-questions.mjs
// 輸出：src/learning/content/{number,classify,pattern}.json
// 產出的 JSON 會進版控，供人工審閱；執行期不跑這支程式。
// 物件屬性（種類、顏色）直接讀 src/learning/objects.ts（Node 24 可直接載入 .ts），不另外抄一份。
// 題目是否合理由 src/learning/bank.test.ts 用獨立的解題邏輯驗證（含多屬性檢查）。
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OBJECTS, CATEGORY_NAMES, CATEGORIES, colorWord } from '../src/learning/objects.ts'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/learning/content')

const OBJ = Object.fromEntries(OBJECTS.map((o) => [o.id, o]))
const IDS = OBJECTS.map((o) => o.id)
const nm = (id) => OBJ[id].name
const un = (id) => OBJ[id].unit
const MULTI = new Set(['decor-ball', 'decor-piano']) // 多色物件：不當顏色題的選項

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
const NUMZH = ['零', '一', '兩', '三', '四', '五', '六', '七', '八', '九', '十']
/** 數量用語：2 唸「兩」 */
const qty = (n) => NUMZH[n] ?? String(n)
/** 數字（數序題的唸法）：2 唸「二」 */
const digitZh = (n) => ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n]
const num = (n) => ({ id: String(n), label: String(n) })

class Reject extends Error {}
const reject = () => {
  throw new Reject()
}

/** 題幹 + 答案 去重。找不同（odd）的題幹就是那四個物件，所以選項也算進去 */
function dedupKey(q) {
  return JSON.stringify([q.type, q.prompt, q.items, q.answer, q.type === 'odd' ? q.choices.map((c) => c.id).sort() : null, q.params?.n ?? null])
}

/**
 * 每格重新固定 seed，改一格不會影響其他格。
 * segments：[{ count, cands?, build(i, ctx, cand) }]，依序產生。build 回傳題目本體（不含 id），
 * 不合格就 reject()。cands 是候選清單（逐個試、用完再循環），保證「題幹 + 答案」不重複。
 * ctx.pos(k, allowed) 回傳「答案放第幾個」，逐題挑目前最少的位置，整格的答案位置會很平均。
 */
function cell(skill, difficulty, segments, { gentle = false, seed = 0 } = {}) {
  rnd = mulberry32(skill.length * 1000 + difficulty * 97 + seed + (gentle ? 5000 : 0))
  const out = []
  const seen = new Set()
  const counts = {}
  const ctx = {
    pos(k, allowed = null) {
      const c = (counts[k] ??= Array(k).fill(0))
      const ok = (allowed ?? [...Array(k).keys()]).filter((p) => p >= 0 && p < k)
      if (!ok.length) reject()
      const least = Math.min(...ok.map((p) => c[p]))
      return pick(ok.filter((p) => c[p] === least))
    },
    mark(k, p) {
      ;(counts[k] ??= Array(k).fill(0))[p]++
    },
  }
  for (const seg of segments) {
    let made = 0
    let guard = 0
    while (made < seg.count) {
      if (++guard > 20000) throw new Error(`${skill}-${difficulty}${gentle ? 'g' : ''} 產不出足夠不重複的題目（${made}/${seg.count}）`)
      const snapshot = JSON.stringify(counts)
      const restore = () => {
        for (const k of Object.keys(counts)) delete counts[k]
        Object.assign(counts, JSON.parse(snapshot))
      }
      let q
      try {
        q = seg.build(out.length, ctx, seg.cands ? seg.cands[(guard - 1) % seg.cands.length] : undefined)
      } catch (e) {
        if (e instanceof Reject) {
          restore()
          continue
        }
        throw e
      }
      const key = dedupKey(q)
      if (seen.has(key)) {
        restore()
        continue
      }
      seen.add(key)
      const n = String(out.length + 1).padStart(2, '0')
      out.push({
        id: `${skill}-${difficulty}-${gentle ? 'g' : ''}${n}`,
        skill,
        difficulty,
        ...q,
        ...(gentle ? { gentle: true } : {}),
        version: 2,
      })
      made++
    }
  }
  return out
}

/** 把答案放在第 pos 個，其他選項隨機排 */
function objChoices(answer, others, pos, ctx) {
  const arr = shuffle(others)
  arr.splice(pos, 0, answer)
  ctx.mark(arr.length, pos)
  return arr.map((obj) => ({ id: obj, obj }))
}

/** 數字選項：由小到大 k 個，答案在第 pos 個；至少一個與答案差 1 */
function numChoices(n, lo, hi, pos, ctx, k = 3) {
  const lowN = pos
  const upN = k - 1 - pos
  const lowPool = []
  for (let v = Math.max(lo, n - 3); v < n; v++) lowPool.push(v)
  const upPool = []
  for (let v = n + 1; v <= Math.min(hi, n + 3); v++) upPool.push(v)
  if (lowPool.length < lowN || upPool.length < upN) reject()
  const low = sample(lowPool, lowN)
  const up = sample(upPool, upN)
  if (lowN && !low.includes(n - 1) && !(upN && up.includes(n + 1))) low[0] = n - 1
  if (!lowN && upN && !up.includes(n + 1)) up[0] = n + 1
  if (new Set(low).size !== low.length || new Set(up).size !== up.length) reject()
  ctx.mark(k, pos)
  return [...low, n, ...up].sort((a, b) => a - b).map(num)
}
/** 這個答案能放哪幾個位置 */
function numPositions(n, lo, hi, k = 3) {
  const below = n - lo
  const above = hi - n
  const out = []
  for (let p = 0; p < k; p++) if (p <= below && k - 1 - p <= above) out.push(p)
  return out
}

const variant = (arr, i) => arr[i % arr.length]

// ---------- 數感 ----------
const COUNT_PROMPTS = [
  (o) => `數一數，有幾${un(o)}${nm(o)}？`,
  (o) => `幫我數數看，有幾${un(o)}${nm(o)}呢？`,
  (o) => `這裡有幾${un(o)}${nm(o)}？`,
]
function countQ(i, ctx, n, obj, lo, hi, extra = {}) {
  const pos = ctx.pos(3, numPositions(n, lo, hi))
  return {
    type: 'count',
    prompt: variant(COUNT_PROMPTS, i)(obj),
    items: [{ obj, count: n }],
    choices: numChoices(n, lo, hi, pos, ctx),
    answer: String(n),
    hint: '跟阿悟一起數，一個一個點，最後一個就是一共有幾個。',
    ...extra,
  }
}
const GIVE_PROMPTS = [
  (n, o) => `請拿${qty(n)}${un(o)}${nm(o)}給阿悟。`,
  (n, o) => `阿悟想要${qty(n)}${un(o)}${nm(o)}，你幫他拿過來好嗎？`,
  (n, o) => `幫我拿${qty(n)}${un(o)}${nm(o)}，放進籃子裡。`,
]
function giveQ(i, n, obj, pool) {
  return {
    type: 'give',
    interaction: 'tapN',
    prompt: variant(GIVE_PROMPTS, i)(n, obj),
    items: [],
    choices: [],
    answer: String(n),
    hint: `我們一起數數看，要拿${qty(n)}${un(obj)}${nm(obj)}喔，拿到剛好就按「好了」。`,
    params: { n, pool, obj },
  }
}
const COMPARE_PROMPTS = [
  (o) => `藍色那一堆和橘色那一堆，哪一堆的${nm(o)}比較多？`,
  (o) => `找找看，哪一堆的${nm(o)}比較多？`,
]
function compareQ(i, ctx, a, b, obj) {
  const big = Math.max(a, b)
  const bigFirst = ctx.pos(2) === 0 // 答案放第 1 個還是第 2 個
  const [left, right] = bigFirst ? [big, Math.min(a, b)] : [Math.min(a, b), big]
  ctx.mark(2, bigFirst ? 0 : 1)
  return {
    type: 'compare',
    prompt: variant(COMPARE_PROMPTS, i)(obj),
    items: [],
    choices: [
      { id: 'A', obj, count: left, tone: 'blue' },
      { id: 'B', obj, count: right, tone: 'orange' },
    ],
    answer: left > right ? 'A' : 'B',
    hint: '一個配一個，多出來的那一堆，就是比較多的。',
  }
}
const DIFF_PROMPTS = [(o) => `藍色那一堆，比橘色那一堆多幾${un(o)}${nm(o)}？`, (o) => `藍色的比橘色的多幾${un(o)}${nm(o)}？`]
function diffQ(i, ctx, small, d, obj) {
  const pos = ctx.pos(3, numPositions(d, 1, 4))
  return {
    type: 'diff',
    prompt: variant(DIFF_PROMPTS, i)(obj),
    items: [
      { obj, count: small + d, tone: 'blue' },
      { obj, count: small, tone: 'orange' },
    ],
    choices: numChoices(d, 1, 4, pos, ctx),
    answer: String(d),
    hint: '一個配一個，多出來的那幾個，就是答案。',
  }
}
const ADD_PROMPTS = [
  (a, b, o) => `盤子裡有${qty(a)}${un(o)}${nm(o)}，再放${qty(b)}${un(o)}，一共有幾${un(o)}${nm(o)}？`,
  (a, b, o) => `有${qty(a)}${un(o)}${nm(o)}，又來了${qty(b)}${un(o)}，現在一共有幾${un(o)}？`,
]
function addQ(i, ctx, a, b, obj) {
  const n = a + b
  const pos = ctx.pos(3, numPositions(n, 2, 10))
  return {
    type: 'add',
    prompt: variant(ADD_PROMPTS, i)(a, b, obj),
    items: [
      { obj, count: a, tone: 'blue' },
      { obj, count: b, tone: 'orange' },
    ],
    choices: numChoices(n, 2, 10, pos, ctx),
    answer: String(n),
    hint: `一起數：先數${qty(a)}${un(obj)}，再接著數${qty(b)}${un(obj)}，數到最後就是一共有幾${un(obj)}。`,
  }
}
const SEQNUM_PROMPTS = ['空格裡是哪一個數字？', '缺的是哪一個數字？']
function seqnumQ(i, ctx, start, len, blank, dir) {
  const vals = Array.from({ length: len }, (_, k) => start + dir * k)
  const n = vals[blank]
  const pos = ctx.pos(3, numPositions(n, 1, 10))
  return {
    type: 'seqnum',
    prompt: variant(SEQNUM_PROMPTS, i),
    items: vals.map((v, k) => ({ obj: null, label: k === blank ? null : String(v) })),
    choices: numChoices(n, 1, 10, pos, ctx),
    answer: String(n),
    hint: `一個一個唸：${vals.map((v, k) => (k === blank ? '空格' : digitZh(v))).join('、')}。空格的數字是哪一個呢？`,
    params: { words: vals.map((v, k) => (k === blank ? '' : digitZh(v))) },
  }
}


/** 候選清單：把 (數量, 物件) 輪流排開，數量分布平均、物件不重複太快 */
function countCands(ns, objs = IDS) {
  const o = shuffle(objs)
  const out = []
  for (let k = 0; k < ns.length * o.length; k++) out.push([ns[(k + Math.floor(k / o.length)) % ns.length], o[k % o.length]])
  return out
}

const number1 = cell('number', 1, [
  { count: 22, cands: countCands([1, 2, 3, 4, 5]), build: (i, ctx, [n, o]) => countQ(i, ctx, n, o, 1, 5) },
  { count: 14, cands: countCands([1, 2, 3, 4, 5]), build: (i, _c, [n, o]) => giveQ(i, n, o, Math.min(8, n + 3 + (i % 2))) },
])
const number2 = cell('number', 2, [
  { count: 16, cands: countCands([6, 7, 8, 9, 10]), build: (i, ctx, [n, o]) => countQ(i, ctx, n, o, 5, 11) },
  {
    count: 10,
    build: (i, ctx) => {
      // 比例 <= 0.67（3 對 6 這種），4 對 5 留到難度 3
      const big = 5 + Math.floor(rnd() * 6)
      const small = 2 + Math.floor(rnd() * 6)
      if (small / big > 0.67) reject()
      return compareQ(i, ctx, small, big, pick(IDS))
    },
  },
  { count: 10, cands: countCands([6, 7, 8, 9, 10]), build: (i, _c, [n, o]) => giveQ(i, n, o, Math.min(14, n + 3)) },
])
const number3 = cell('number', 3, [
  { count: 12, cands: countCands([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]), build: (i, ctx, [n, o]) => countQ(i, ctx, n, o, 10, 20) },
  {
    count: 10,
    build: (i, ctx) => {
      const small = 8 + Math.floor(rnd() * 11)
      return compareQ(i, ctx, small, Math.min(20, small + 1 + Math.floor(rnd() * 3)), pick(IDS))
    },
  },
  {
    count: 14,
    cands: countCands([1, 2, 3]),
    build: (i, ctx, [d, o]) => diffQ(i, ctx, 6 + Math.floor(rnd() * 9), d, o),
  },
])
const number4 = cell('number', 4, [
  {
    count: 20,
    build: (i, ctx) => {
      const a = 1 + Math.floor(rnd() * 5)
      const b = 1 + Math.floor(rnd() * 5)
      if (a + b > 10 || a + b < 3) reject()
      return addQ(i, ctx, a, b, pick(IDS))
    },
  },
  {
    count: 16,
    build: (i, ctx) => {
      const dir = rnd() < 0.25 ? -1 : 1
      const len = 4 + Math.floor(rnd() * 2)
      const start = dir === 1 ? 1 + Math.floor(rnd() * (10 - len + 1)) : len + Math.floor(rnd() * (10 - len + 1))
      if (start > 10 || (dir === -1 && start - len + 1 < 1)) reject()
      return seqnumQ(i, ctx, start, len, 1 + Math.floor(rnd() * (len - 1)), dir)
    },
  },
])
// 幼幼模式：只出 1–3 個、2 選 1；一半是快閃辨識
const number1g = cell(
  'number',
  1,
  [
    {
      count: 24,
      cands: countCands([1, 2, 3]),
      build: (i, ctx, [n, obj]) => {
        const pos = ctx.pos(2, numPositions(n, 1, 4, 2))
        const q = countQ(i, ctx, n, obj, 1, 4)
        // countQ 已經多記了一次 3 選 1 的位置；這裡的選項改成 2 個
        const other = n === 1 ? 2 : n === 3 ? 2 : [1, 3][Math.floor(rnd() * 2)]
        const nums = [n, other].sort((a, b) => a - b)
        if (nums.indexOf(n) !== pos) reject()
        q.choices = nums.map(num)
        if (i % 2 === 1) {
          q.prompt = `看一下，有幾${un(obj)}${nm(obj)}？`
          q.params = { flash: 1800 }
          q.hint = '再看一次，跟阿悟一起數，一個一個點。'
        }
        return q
      },
    },
  ],
  { gentle: true },
)

// ---------- 分類 ----------
const catOf = (id) => OBJ[id].category
const byCat = (c) => IDS.filter((id) => catOf(id) === c)
const CLASSIFIABLE = IDS.filter((id) => catOf(id))
const conflict = (ids) => ids.some((a) => (OBJ[a].confusableWith ?? []).some((c) => ids.some((b) => b !== a && catOf(b) === c)))
const REF = {
  黃: '像太陽，像小鴨',
  粉: '像棉花糖，像櫻花',
  紅: '像消防車，像草莓',
  紫: '像茄子，像薰衣草',
  藍: '像天空，像大海',
  白: '像雲朵，像牛奶',
  綠: '像青蛙，像小草',
}
const SWATCH = { 黃: '#ffd84d', 粉: '#ffb3c7', 紅: '#ef5350', 紫: '#a874d8', 藍: '#5aa9f0', 白: '#f4f4f4', 綠: '#5cc98a' }
const CAT_DESC = {
  fruit: '長在樹上或藤上，甜甜的，可以吃',
  animal: '是活的，會動，會吃東西',
  vehicle: '可以載著我們去好遠的地方',
  toy: '是小朋友拿來玩的',
}
const hasColor = (id, c) => OBJ[id].color === c || (OBJ[id].alsoColors ?? []).includes(c)
const sameColorish = (a, b) => hasColor(b, OBJ[a].color) || (OBJ[a].alsoColors ?? []).some((x) => hasColor(b, x))

const KIND_PROMPTS = [(c) => `哪一個是${CATEGORY_NAMES[c]}？`, (c) => `找找看，${CATEGORY_NAMES[c]}是哪一個？`, (c) => `請你指出${CATEGORY_NAMES[c]}。`, (c) => `${CATEGORY_NAMES[c]}在哪裡呢？`, (c) => `你知道哪一個是${CATEGORY_NAMES[c]}嗎？`]
function kindHint(c, shown) {
  const ex = byCat(c).filter((id) => !shown.includes(id)).slice(0, 2).map(nm)
  const lead = ex.length ? `${CATEGORY_NAMES[c]}像${ex.join('、')}，` : `${CATEGORY_NAMES[c]}`
  return `${lead}${CAT_DESC[c]}。找找看，哪一個也是${CATEGORY_NAMES[c]}？`
}
/** 種類題：每個選項種類都不同 */
function kindQ(i, ctx, answer, phraseIdx, pool = CLASSIFIABLE, choiceCount = 3) {
  const t = catOf(answer)
  const others = []
  for (const c of shuffle(CATEGORIES.filter((x) => x !== t))) {
    const cand = pool.filter((id) => catOf(id) === c)
    if (cand.length && others.length < choiceCount - 1) others.push(pick(cand))
  }
  if (others.length < choiceCount - 1) reject()
  if (conflict([answer, ...others])) reject()
  const pos = ctx.pos(choiceCount)
  return {
    type: 'kind',
    prompt: variant(KIND_PROMPTS, phraseIdx)(t),
    items: [],
    choices: objChoices(answer, others, pos, ctx),
    answer,
    hint: kindHint(t, [answer, ...others]),
    params: { groupName: CATEGORY_NAMES[t] },
  }
}
const SAME_PROMPTS = ['哪一個跟這個是同一類？', '找出和這個同一類的。']
/** 找同一類：干擾項不能和範例同色（否則孩子會用顏色選） */
function sameQ(i, ctx, ex, answer, pool = CLASSIFIABLE, choiceCount = 3) {
  const t = catOf(ex)
  const others = []
  for (const c of shuffle(CATEGORIES.filter((x) => x !== t))) {
    const cand = pool.filter((id) => catOf(id) === c && !sameColorish(ex, id))
    if (cand.length && others.length < choiceCount - 1) others.push(pick(cand))
  }
  if (others.length < choiceCount - 1) reject()
  if (conflict([ex, answer, ...others])) reject()
  const pos = ctx.pos(choiceCount)
  return {
    type: 'same',
    prompt: variant(SAME_PROMPTS, i),
    items: [{ obj: ex }],
    choices: objChoices(answer, others, pos, ctx),
    answer,
    hint: `這個是${CATEGORY_NAMES[t]}。找找看，哪一個也是${CATEGORY_NAMES[t]}？`,
    params: { groupName: CATEGORY_NAMES[t] },
  }
}
const COLOR_PROMPTS = [(c) => `哪一個是${colorWord(c)}的？`, (c) => `找找看，${colorWord(c)}的是哪一個？`]
const COLOR_POOL = IDS.filter((id) => !MULTI.has(id) && id !== 'obj-shell')
function colorQ(i, ctx, answer, phraseIdx) {
  const c = OBJ[answer].color
  if (!REF[c]) reject()
  const cand = COLOR_POOL.filter((id) => id !== answer && !hasColor(id, c))
  const o1 = pick(cand)
  const o2 = pick(cand.filter((id) => OBJ[id].color !== OBJ[o1].color))
  if (!o2 || conflict([answer, o1, o2])) reject()
  const pos = ctx.pos(3)
  return {
    type: 'color',
    prompt: variant(COLOR_PROMPTS, phraseIdx)(c),
    items: [],
    choices: objChoices(answer, [o1, o2], pos, ctx),
    answer,
    hint: `${colorWord(c)}，${REF[c]}。找找看，哪一個是${colorWord(c)}的？`,
    params: { colorWord: colorWord(c), swatch: SWATCH[c] },
  }
}
const SAMECOLOR_PROMPTS = ['哪一個跟這個是一樣的顏色？', '找出和這個顏色一樣的。']
/** 找同色：干擾項顏色不同，而且種類不能和範例相同（否則孩子會用種類選） */
function sameColorQ(i, ctx, ex, answer) {
  const c = OBJ[ex].color
  if (!REF[c]) reject()
  const cand = COLOR_POOL.filter((id) => id !== ex && id !== answer && !hasColor(id, c) && (!catOf(ex) || catOf(id) !== catOf(ex)))
  const o1 = pick(cand)
  const o2 = pick(cand.filter((id) => OBJ[id].color !== OBJ[o1].color))
  if (!o2 || conflict([ex, answer, o1, o2])) reject()
  const pos = ctx.pos(3)
  return {
    type: 'same',
    prompt: variant(SAMECOLOR_PROMPTS, i),
    items: [{ obj: ex }],
    choices: objChoices(answer, [o1, o2], pos, ctx),
    answer,
    hint: `這個是${colorWord(c)}，${REF[c]}。找找看，哪一個也是${colorWord(c)}？`,
    params: { colorWord: colorWord(c), swatch: SWATCH[c] },
  }
}
const ODD_PROMPTS = ['哪一個跟別的不一樣？', '找找看，哪一個不是同一類？', '有一個跟其他三個不一樣，是哪一個？']
/** 找不同的顏色檢查（多屬性）：顏色不能 2:2 分群，也不能有另一個「顏色獨一無二」的離群者 */
function colorFamilyOk(ids, answer) {
  const groups = {}
  for (const id of ids) (groups[OBJ[id].color === '粉橘' ? '粉' : OBJ[id].color] ??= []).push(id)
  const sizes = Object.values(groups).map((g) => g.length).sort()
  if (sizes.join() === '2,2') return false
  if (sizes.join() === '1,3') {
    const lone = Object.values(groups).find((g) => g.length === 1)[0]
    if (lone !== answer) return false
  }
  return true
}
function oddQ(i, ctx) {
  const m = pick(CATEGORIES.filter((c) => byCat(c).length >= 3))
  const triple = sample(byCat(m), 3)
  const odd = pick(CLASSIFIABLE.filter((id) => catOf(id) !== m))
  const all = [...triple, odd]
  if (conflict(all) || !colorFamilyOk(all, odd)) reject()
  const pos = ctx.pos(4)
  return {
    type: 'odd',
    prompt: variant(ODD_PROMPTS, i),
    items: [],
    choices: objChoices(odd, triple, pos, ctx),
    answer: odd,
    hint: `${triple.map(nm).join('、')}，都是${CATEGORY_NAMES[m]}。哪一個不是${CATEGORY_NAMES[m]}呢？`,
    params: { same: triple, groupName: CATEGORY_NAMES[m] },
  }
}
const DUAL_PROMPTS = [
  (c, k) => `哪一個是${colorWord(c)}的${CATEGORY_NAMES[k]}？`,
  (c, k) => `找找看，哪一個是${CATEGORY_NAMES[k]}，而且是${colorWord(c)}的？`,
  (c, k) => `${colorWord(c)}、又是${CATEGORY_NAMES[k]}的，是哪一個？`,
  (c, k) => `請選出${colorWord(c)}的${CATEGORY_NAMES[k]}。`,
]
function dualQ(i, ctx, answer, phraseIdx) {
  const c = OBJ[answer].color
  const k = catOf(answer)
  if (!REF[c]) reject()
  const sameCat = CLASSIFIABLE.filter((id) => id !== answer && catOf(id) === k && !hasColor(id, c) && !MULTI.has(id))
  const sameColor = CLASSIFIABLE.filter((id) => id !== answer && catOf(id) !== k && hasColor(id, c) && !MULTI.has(id))
  const other = CLASSIFIABLE.filter((id) => id !== answer && catOf(id) !== k && !hasColor(id, c) && !MULTI.has(id))
  if (!sameCat.length) reject()
  const a = pick(sameCat)
  const b = pick(sameColor.length ? sameColor : other)
  if (conflict([answer, a, b])) reject()
  const pos = ctx.pos(3)
  const choices = objChoices(answer, [a, b], pos, ctx)
  return {
    type: 'dual',
    prompt: variant(DUAL_PROMPTS, phraseIdx)(c, k),
    items: [],
    choices,
    answer,
    hint: `先找${CATEGORY_NAMES[k]}，再看是不是${colorWord(c)}的。亮起來的都是${CATEGORY_NAMES[k]}。`,
    params: { same: choices.filter((x) => catOf(x.id) === k).map((x) => x.id), groupName: CATEGORY_NAMES[k], colorWord: colorWord(c), swatch: SWATCH[c] },
  }
}

// 拖曳歸類：把東西放進對的籃子。每一類要留一個沒用到的物件當籃子上的代表圖；
// 不同籃子的東西顏色不重疊（否則孩子會用顏色分）
const CAT_CAP = { fruit: 3, animal: 2, vehicle: 1, toy: 2 }
const BIN_PROMPTS2 = [(a, b) => `把${a}和${b}分開，放進對的籃子裡。`, (a, b) => `幫忙整理：${a}放一邊，${b}放另一邊。`]
const BIN_PROMPTS3 = [(a, b, c) => `把${a}、${b}、${c}分一分，放進對的籃子裡。`, (a, b, c) => `幫忙整理：${a}、${b}、${c}，各放各的籃子。`]
function colorsOf(ids) {
  return new Set(ids.map((id) => (OBJ[id].color === '粉橘' ? '粉' : OBJ[id].color)))
}
function binsByCategory(i, ctx, nBins, itemTotal) {
  const cats = sample(CATEGORIES, nBins)
  // 每一類放幾個（至少 1、不超過上限），加起來剛好 itemTotal
  const counts = cats.map(() => 1)
  let left = itemTotal - nBins
  let guard = 0
  while (left > 0 && guard++ < 50) {
    const k = Math.floor(rnd() * nBins)
    if (counts[k] < CAT_CAP[cats[k]]) {
      counts[k]++
      left--
    }
  }
  if (left > 0) reject()
  const groups = cats.map((c, k) => sample(byCat(c), counts[k]))
  const all = groups.flat()
  if (conflict(all)) reject()
  // 不同籃子的東西不能同色
  for (let a = 0; a < groups.length; a++)
    for (let b = a + 1; b < groups.length; b++) {
      const ca = colorsOf(groups[a])
      if ([...colorsOf(groups[b])].some((c) => ca.has(c))) reject()
    }
  const bins = cats.map((c, k) => {
    const emblem = byCat(c).find((id) => !all.includes(id))
    if (!emblem) reject()
    return { id: `b${k + 1}`, label: CATEGORY_NAMES[c], obj: emblem }
  })
  const order = shuffle(all.map((id) => id))
  const targets = order.map((id) => bins[cats.indexOf(catOf(id))].id)
  const names = cats.map((c) => CATEGORY_NAMES[c])
  return {
    type: 'bins',
    interaction: 'dragSort',
    prompt: nBins === 2 ? variant(BIN_PROMPTS2, i)(...names) : variant(BIN_PROMPTS3, i)(...names),
    items: order.map((obj) => ({ obj })),
    choices: [],
    answer: 'sorted',
    hint: `${bins.map((b) => `${b.label}像${nm(b.obj)}`).join('，')}。看看每一個是什麼，放進對的籃子。`,
    params: { bins, targets },
  }
}
function binsByColor(i) {
  const cs = sample(Object.keys(REF), 2)
  const pool = (c) => COLOR_POOL.filter((id) => OBJ[id].color === c && !(OBJ[id].alsoColors ?? []).some((x) => cs.includes(x)))
  const a = sample(pool(cs[0]), 2)
  const b = sample(pool(cs[1]), 2)
  if (a.length < 2 || b.length < 2) reject()
  if (conflict([...a, ...b])) reject()
  const bins = cs.map((c, k) => ({ id: `b${k + 1}`, label: colorWord(c), swatch: SWATCH[c] }))
  const order = shuffle([...a, ...b])
  const targets = order.map((id) => bins[cs.indexOf(OBJ[id].color)].id)
  return {
    type: 'bins',
    interaction: 'dragSort',
    prompt: variant(BIN_PROMPTS2, i)(bins[0].label + '的', bins[1].label + '的'),
    items: order.map((obj) => ({ obj })),
    choices: [],
    answer: 'sorted',
    hint: `${bins[0].label}，${REF[cs[0]]}。${bins[1].label}，${REF[cs[1]]}。看看每一個是什麼顏色，放進對的籃子。`,
    params: { bins, targets },
  }
}

const withPhrases = (list, phrases) => shuffle(list.flatMap((id) => Array.from({ length: phrases }, (_, p) => [id, p])))
const orderedPairs = (list, ok) => shuffle(list.flatMap((a) => list.filter((b) => a !== b && ok(a, b)).map((b) => [a, b])))
const GENTLE_OBJ = ['obj-banana', 'obj-apple', 'obj-fish', 'obj-chick'] // 最常見的四個

const classify1 = cell('classify', 1, [
  { count: 12, cands: withPhrases(CLASSIFIABLE, 3), build: (i, ctx, [a, p]) => kindQ(i, ctx, a, p) },
  { count: 24, cands: orderedPairs(CLASSIFIABLE, (a, b) => catOf(a) === catOf(b)), build: (i, ctx, [ex, a]) => sameQ(i, ctx, ex, a) },
])
const classify2 = cell('classify', 2, [
  { count: 12, build: (i, ctx) => binsByCategory(i, ctx, 2, 4) },
  { count: 14, cands: withPhrases(COLOR_POOL.filter((id) => REF[OBJ[id].color]), 2), build: (i, ctx, [a, p]) => colorQ(i, ctx, a, p) },
  {
    count: 10,
    cands: orderedPairs(COLOR_POOL, (a, b) => OBJ[a].color === OBJ[b].color && REF[OBJ[a].color]),
    build: (i, ctx, [ex, a]) => sameColorQ(i, ctx, ex, a),
  },
  { count: 12, cands: withPhrases(CLASSIFIABLE, 3), build: (i, ctx, [a, p]) => kindQ(i, ctx, a, p) },
])
const classify3 = cell('classify', 3, [
  { count: 36, build: (i, ctx) => oddQ(i, ctx) },
  { count: 8, build: (i, ctx) => binsByCategory(i, ctx, 3, 5 + (i % 2)) },
  { count: 4, build: (i) => binsByColor(i) },
])
const classify4 = cell('classify', 4, [
  { count: 36, cands: withPhrases(CLASSIFIABLE.filter((id) => catOf(id) !== 'toy' && REF[OBJ[id].color]), 4), build: (i, ctx, [a, p]) => dualQ(i, ctx, a, p) },
])
const classify1g = cell(
  'classify',
  1,
  [
    {
      count: 20,
      cands: withPhrases(GENTLE_OBJ, 5),
      build: (i, ctx, [a, p]) => {
        const q = kindQ(i, ctx, a, p, GENTLE_OBJ, 2)
        q.hint = `${q.params.groupName}，${CAT_DESC[catOf(a)]}。你看，這個是${nm(a)}，它是${q.params.groupName}喔。`
        return q
      },
    },
    {
      count: 4,
      cands: orderedPairs(GENTLE_OBJ, (a, b) => catOf(a) === catOf(b)),
      build: (i, ctx, [ex, a]) => sameQ(i, ctx, ex, a, GENTLE_OBJ, 2),
    },
  ],
  { gentle: true },
)

// ---------- 規律 ----------
const NEXT_PROMPTS = ['接下來是哪一個？', '下一個是哪一個？']
const MISSING_PROMPTS = ['空格裡是哪一個？', '空格要放哪一個？']
/** shape：'AB' | 'AAB' | 'ABB' | 'ABC'；objs：[A,B,C]；L：顯示幾個；blankAt：空格位置（-1 = 接下去的下一個） */
function seqQ(i, ctx, type, shape, objs, L, blankAt) {
  const unit = [...shape].map((ch) => objs['ABC'.indexOf(ch)])
  const at = (k) => unit[k % unit.length]
  const items = []
  for (let k = 0; k < L; k++) items.push({ obj: k === blankAt ? null : at(k) })
  let answer
  if (type === 'next') {
    items.push({ obj: null })
    answer = at(L)
  } else answer = at(blankAt)
  const coreNames = unit.map(nm)
  const pos = ctx.pos(objs.length)
  const shownNames = items.map((it) => (it.obj ? nm(it.obj) : ''))
  return {
    type,
    prompt: variant(type === 'next' ? NEXT_PROMPTS : MISSING_PROMPTS, i),
    items,
    choices: objChoices(answer, objs.filter((o) => o !== answer), pos, ctx),
    answer,
    hint: `一個一個看：${coreNames.join('、')}，${coreNames.join('、')}。一組一組重複出現，${type === 'next' ? '下一個是誰呢' : '空格是誰呢'}？`,
    params: { core: unit.length, words: shownNames },
  }
}
const triples = () => shuffle(IDS).slice(0, 3)
const pairPlus = () => triples() // [A, B, 干擾]
const pattern1 = cell('pattern', 1, [
  { count: 36, build: (i, ctx) => seqQ(i, ctx, 'next', 'AB', pairPlus(), [4, 5, 6][i % 3], -1) },
])
const pattern2 = cell('pattern', 2, [
  { count: 12, build: (i, ctx) => seqQ(i, ctx, 'next', 'AAB', pairPlus(), [5, 6, 7][i % 3], -1) },
  { count: 12, build: (i, ctx) => seqQ(i, ctx, 'next', 'ABB', pairPlus(), [5, 6, 7][i % 3], -1) },
  { count: 12, build: (i, ctx) => seqQ(i, ctx, 'missing', 'AB', pairPlus(), 6 + (i % 2), [1, 2, 3, 4][i % 4]) },
])
const pattern3 = cell('pattern', 3, [
  { count: 18, build: (i, ctx) => seqQ(i, ctx, 'next', 'ABC', triples(), [7, 8][i % 2], -1) },
  { count: 18, build: (i, ctx) => seqQ(i, ctx, 'missing', 'ABC', triples(), [7, 8][i % 2], [2, 3, 4, 5][i % 4]) },
])
const pattern1g = cell(
  'pattern',
  1,
  [
    {
      count: 24,
      cands: orderedPairs(['obj-banana', 'obj-apple', 'obj-fish', 'obj-chick', 'obj-peach', 'obj-rabbit'], () => true),
      build: (i, ctx, [a, b]) => {
        // 展示 3 輪（6 個）再問下一個；只有 2 個選項（A、B）
        const q = seqQ(i, ctx, 'next', 'AB', [a, b, a], 6, -1)
        q.choices = objChoices(q.answer, [q.answer === a ? b : a], ctx.pos(2), ctx)
        q.hint = `你看，${nm(a)}、${nm(b)}，${nm(a)}、${nm(b)}，${nm(a)}、${nm(b)}。一個接一個，下一個是誰呢？`
        return q
      },
    },
  ],
  { gentle: true },
)

// 屬性規律（顏色或種類輪流出現）與成長規律
const ATTR_COLOR_OBJS = IDS.filter((id) => !MULTI.has(id) && !OBJ[id].alsoColors && REF[OBJ[id].color])
function attrQ(i, ctx, by) {
  const attrOf = (id) => (by === 'color' ? OBJ[id].color : catOf(id))
  const word = (v) => (by === 'color' ? colorWord(v) : CATEGORY_NAMES[v])
  const pool = by === 'color' ? ATTR_COLOR_OBJS : CLASSIFIABLE.filter((id) => !MULTI.has(id))
  const values = [...new Set(pool.map(attrOf))]
  const A = pick(values)
  const B = pick(values.filter((v) => v !== A))
  const L = [4, 5][i % 2]
  const ofA = pool.filter((id) => attrOf(id) === A)
  const ofB = pool.filter((id) => attrOf(id) === B)
  if (!ofA.length || !ofB.length) reject()
  const items = []
  for (let k = 0; k < L; k++) items.push({ obj: pick(k % 2 === 0 ? ofA : ofB) })
  items.push({ obj: null })
  const want = L % 2 === 0 ? A : B
  const rightObj = pick(pool.filter((id) => attrOf(id) === want))
  const wrongA = pick(pool.filter((id) => attrOf(id) !== want && attrOf(id) !== (want === A ? B : A)))
  const wrongB = pick(pool.filter((id) => attrOf(id) === (want === A ? B : A)))
  if (!wrongA || !wrongB) reject()
  const shown = items.map((it) => it.obj).filter(Boolean)
  const all = [rightObj, wrongA, wrongB]
  if (new Set(all).size < 3) reject()
  if (conflict([...shown, ...all])) reject()
  // 多屬性檢查：換成另一個屬性（或物件本身），不能讓別的選項也呈現週期
  const otherAttr = by === 'color' ? catOf : (id) => OBJ[id].color
  for (const alt of [otherAttr, (id) => id]) {
    for (const c of [wrongA, wrongB]) {
      const seq = items.map((it) => (it.obj ? alt(it.obj) : alt(c)))
      if (seq.includes(undefined) || isPeriodic(seq)) reject()
    }
  }
  const pos = ctx.pos(3)
  const words = items.map((it) => (it.obj ? word(attrOf(it.obj)) : ''))
  return {
    type: 'attr',
    prompt: by === 'color' ? '看看顏色，接下來是哪一個？' : '看看種類，接下來是哪一個？',
    items,
    choices: objChoices(rightObj, [wrongA, wrongB], pos, ctx),
    answer: rightObj,
    hint: `看${by === 'color' ? '顏色' : '種類'}：${word(A)}、${word(B)}，${word(A)}、${word(B)}，輪流出現。下一個要${word(want)}的。`,
    params: { core: 2, words, groupName: by === 'color' ? '顏色' : '種類', colorWord: by === 'color' ? word(want) : undefined },
  }
}
function isPeriodic(seq) {
  for (let p = 2; p <= seq.length / 2; p++) if (seq.every((v, i) => i < p || v === seq[i - p])) return true
  return false
}
const GROW_PROMPTS = ['下一格要放幾個？', '接下來是幾個？']
function growQ(i, ctx, start, obj) {
  const vals = [start, start + 1, start + 2]
  const n = start + 3
  const pos = ctx.pos(3, numPositions(n, 2, 9))
  return {
    type: 'grow',
    prompt: variant(GROW_PROMPTS, i),
    items: [...vals.map((c) => ({ obj, count: c })), { obj: null }],
    choices: numChoices(n, 2, 9, pos, ctx),
    answer: String(n),
    hint: `${vals.map((v) => `${qty(v)}${un(obj)}`).join('、')}，每一格都多一${un(obj)}。下一格要放幾${un(obj)}呢？`,
    params: { words: [...vals.map((v) => `${qty(v)}${un(obj)}`), ''] },
  }
}
const pattern4 = cell('pattern', 4, [
  { count: 12, build: (i, ctx) => attrQ(i, ctx, 'color') },
  { count: 12, build: (i, ctx) => attrQ(i, ctx, 'category') },
  { count: 12, cands: countCands([1, 2, 3, 4, 5, 6]), build: (i, ctx, [s, o]) => growQ(i, ctx, s, o) },
])

// ---------- 輸出 ----------
/** 每題一個區塊、items/choices 每個元素一行，方便人工審閱與 diff */
function toReadableJson(questions) {
  const one = (v) => JSON.stringify(v)
  const list = (arr) => (arr.length ? `[\n${arr.map((x) => '      ' + one(x)).join(',\n')}\n    ]` : '[]')
  const blocks = questions.map((q) =>
    [
      '  {',
      `    "id": ${one(q.id)}, "skill": ${one(q.skill)}, "difficulty": ${q.difficulty}, "type": ${one(q.type)}, "version": ${q.version}${q.interaction ? `, "interaction": ${one(q.interaction)}` : ''}${q.gentle ? ', "gentle": true' : ''},`,
      `    "prompt": ${one(q.prompt)},`,
      `    "items": ${list(q.items)},`,
      `    "choices": ${list(q.choices)},`,
      `    "answer": ${one(q.answer)},`,
      `    "hint": ${one(q.hint)}${q.params ? ',' : ''}`,
      ...(q.params ? [`    "params": ${one(q.params)}`] : []),
      '  }',
    ].join('\n'),
  )
  return `[\n${blocks.join(',\n')}\n]\n`
}

const dump = (name, cells) => {
  const all = cells.flat()
  writeFileSync(join(OUT, `${name}.json`), toReadableJson(all))
  const byCell = {}
  for (const q of all) byCell[`d${q.difficulty}${q.gentle ? 'g' : ''}`] = (byCell[`d${q.difficulty}${q.gentle ? 'g' : ''}`] ?? 0) + 1
  console.log(`${name}.json  ${all.length} 題  ${JSON.stringify(byCell)}`)
}
dump('number', [number1, number2, number3, number4, number1g])
dump('classify', [classify1, classify2, classify3, classify4, classify1g])
dump('pattern', [pattern1, pattern2, pattern3, pattern4, pattern1g])
