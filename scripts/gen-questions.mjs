// 題庫產生器（固定 seed，輸出可重現）。
// 用法：node scripts/gen-questions.mjs
// 輸出：src/learning/content/{number,classify,pattern,measure,space,observe,english,life,nature}.json
// 產出的 JSON 會進版控，供人工審閱；執行期不跑這支程式。
// 物件屬性（種類、顏色）直接讀 src/learning/objects.ts（Node 24 可直接載入 .ts），不另外抄一份。
// 題目是否合理由 src/learning/bank.test.ts 用獨立的解題邏輯驗證（含多屬性檢查）。
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OBJECTS, CATEGORY_NAMES, CATEGORIES, colorWord } from '../src/learning/objects.ts'
import { EN_WORDS, EN_GENTLE_WORDS } from '../src/learning/english.ts'
import * as LN from '../src/learning/lifeNature.ts'
import { INSIDE_PROPS, PROPS, REL_WORD } from '../src/learning/space.ts'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/learning/content')

const OBJ = Object.fromEntries(OBJECTS.map((o) => [o.id, o]))
const IDS = OBJECTS.map((o) => o.id)
const nm = (id) => OBJ[id].name
const un = (id) => OBJ[id].unit
const MULTI = new Set(['decor-ball', 'decor-piano']) // 多色物件：不當顏色題的選項

// ---------- 小工具 ----------
function mulberry32(seed, resumeState = null) {
  let a = resumeState ?? seed >>> 0
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
const SIG_TYPES = new Set(['bigger', 'order', 'where', 'whereIs', 'place', 'recall', 'gone', 'spot', 'flip', 'row'])
function dedupKey(q) {
  // 找不同、生活與自然的點選題：選項組合不同才算不同題（排序題的卡片順序也算）
  const ck = q.type === 'odd' || /^(life|nat)/.test(q.type) ? (q.type.endsWith('Order') ? q.choices.map((c) => c.id) : q.choices.map((c) => c.id).sort()) : null
  return JSON.stringify([q.type, q.prompt, q.items, q.answer, ck, q.params?.n ?? null, q.params?.word ?? null, q.params?.pattern ?? null, q.params?.stem ?? null, q.params?.order ?? null, q.params?.targets ?? null, SIG_TYPES.has(q.type) ? [q.choices, q.params] : null])
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
  // v7.3（試玩審查 B8）：規則真的要靠「顏色 / 種類」才看得出來。如果題幹本身就是「小魚、汽車、小魚、汽車」這種單看形狀就成立的交替
  // （同一個屬性輪流出現的都是同一個物件，正解又剛好是形狀交替的下一個），孩子看到的是形狀、題目卻說「看看顏色」，提示語與題目不符，所以不出這種題。
  if (shown.every((o, k) => k < 2 || o === shown[k - 2]) && shown[L - 2] === rightObj) reject()
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

// ---------- 英文單字 ----------
// 單字與圖檔對應見 src/learning/english.ts。選項一律同一類（物件／顏色／數字），不會拿顏色字當物件圖的干擾項。
// 中文旁白在 prompt（用中文語音唸），英文單字在 params.word（執行期用 en.<word> 的語音，沒有音檔就 Web Speech en-US）。
const EW = Object.fromEntries(EN_WORDS.map((w) => [w.word, w]))
const ofKind = (k) => EN_WORDS.filter((w) => w.kind === k).map((w) => w.word)
const EN_THINGS = ofKind('thing')
const EN_COLORS = ofKind('color')
const EN_NUMS = ofKind('number')
const NUM_WORD = Object.fromEntries(EN_NUMS.map((w) => [Number(EW[w].digit), w]))
const poolOf = (word) => ofKind(EW[word].kind)
const picChoice = (w) => {
  const e = EW[w]
  return e.kind === 'thing' ? { id: w, art: e.art } : e.kind === 'color' ? { id: w, swatch: e.swatch } : { id: w, label: e.digit }
}
const textChoice = (w) => ({ id: w, text: w })
const stemOf = (w) => {
  const e = EW[w]
  return e.kind === 'thing' ? { art: e.art } : e.kind === 'color' ? { swatch: e.swatch } : { digit: e.digit }
}
/** 同一類的 k-1 個干擾單字，答案放第 pos 個 */
function wordChoices(answer, pool, k, ctx, mk) {
  const others = sample(pool.filter((x) => x !== answer), k - 1)
  if (others.length < k - 1) reject()
  const pos = ctx.pos(k)
  const arr = shuffle(others)
  arr.splice(pos, 0, answer)
  ctx.mark(k, pos)
  return arr.map(mk)
}
const findIt = (e) => (e.kind === 'color' ? `${e.zh}的色塊` : e.zh)

const HEAR_PROMPTS = ['仔細聽，哪一個是你聽到的英文？', '聽聽看，這個英文字是哪一個？', '阿悟說英文，你來找找看！']
function hearQ(i, ctx, word, phrase, pool = poolOf(word), k = 3) {
  const e = EW[word]
  let choices
  if (e.kind === 'number') {
    const n = Number(e.digit)
    const pos = ctx.pos(k, numPositions(n, 1, 10, k))
    choices = numChoices(n, 1, 10, pos, ctx, k).map((c) => ({ id: NUM_WORD[Number(c.id)], label: c.id }))
  } else choices = wordChoices(word, pool, k, ctx, picChoice)
  return {
    type: 'hear',
    prompt: variant(HEAR_PROMPTS, phrase),
    items: [],
    choices,
    answer: word,
    hint: `${e.zh}的英文就是剛剛聽到的字。找找看，哪一個是${findIt(e)}？`,
    params: { word, zh: e.zh },
  }
}
const PIC_PROMPTS = ['這個用英文怎麼說？', '看看圖，英文是哪一個字？', '找出這個的英文。']
function pic2enQ(i, ctx, word, phrase) {
  const e = EW[word]
  return {
    type: 'pic2en',
    prompt: variant(PIC_PROMPTS, phrase),
    items: [],
    choices: wordChoices(word, poolOf(word), 3, ctx, textChoice),
    answer: word,
    hint: `這個是${e.zh}。聽聽看${e.zh}的英文怎麼說，再找找看是哪一個字。`,
    params: { word, zh: e.zh, stem: stemOf(word) },
  }
}
const ZH_PROMPTS = [(z) => `${z}，用英文怎麼說？`, (z) => `哪一個是${z}的英文？`, (z) => `找出${z}的英文字。`]
function zh2enQ(i, ctx, word, phrase) {
  const e = EW[word]
  return {
    type: 'zh2en',
    prompt: variant(ZH_PROMPTS, phrase)(e.zh),
    items: [],
    choices: wordChoices(word, poolOf(word), 3, ctx, textChoice),
    answer: word,
    hint: `${e.zh}是這個樣子。聽聽看英文怎麼說，再找找看是哪一個字。`,
    params: { word, zh: e.zh, stem: stemOf(word) },
  }
}
const SPELL_PROMPTS = ['點一個字母，把這個字拼完整。', '少了一個字母，幫忙補上去。', '聽聽看，缺的是哪一個字母？']
const VOWELS = [...'aeiou']
const CONSONANTS = [...'bcdfghjklmnprstwy']
function spellQ(i, ctx, word, blankAt, phrase) {
  const e = EW[word]
  const letter = word[blankAt]
  const pool = VOWELS.includes(letter) ? VOWELS : CONSONANTS
  const others = sample(pool.filter((l) => l !== letter), 2)
  if (others.length < 2) reject()
  const pos = ctx.pos(3)
  const arr = shuffle(others)
  arr.splice(pos, 0, letter)
  ctx.mark(3, pos)
  return {
    type: 'spell',
    prompt: variant(SPELL_PROMPTS, phrase),
    items: [],
    choices: arr.map((l) => ({ id: l, text: l })),
    answer: letter,
    hint: `這個是${e.zh}。聽聽看怎麼唸，一個字母一個字母慢慢看，缺的是哪一個？`,
    params: { word, zh: e.zh, stem: stemOf(word), pattern: word.slice(0, blankAt) + '_' + word.slice(blankAt + 1), blankAt },
  }
}
const wordPhrases = (list, phrases) => shuffle(list.flatMap((w) => Array.from({ length: phrases }, (_, p) => [w, p])))
// 拼字候選的洗牌是模組層級的（不在 cell 裡重新播種），以前會接著「前一個格子」留下的亂數狀態；v7.3 改了 pattern-4 的題目，
// 狀態一變整個英文題庫就會換一批。這裡固定成 v7.2 當時的狀態（1142457928），英文題庫維持原樣，之後前面的格子再怎麼改也不會連動。
rnd = mulberry32(0, 1142457928)
const SPELLABLE = [...EN_THINGS.filter((w) => w.length <= 5), ...['red', 'blue', 'pink', 'green'], ...EN_NUMS.filter((w) => w.length <= 5)]
const spellCands = shuffle(SPELLABLE.flatMap((w) => [...w].map((_, at) => [w, at]))).map(([w, at], k) => [w, at, k % 3])

// 難度 1：除了聽英文選圖（hear），再混入看圖選字（pic2en）和中翻英（zh2en）。後兩種的字卡有喇叭可以先聽（見 EnglishView）。
// 新題接在最後面，原本 40 題的 id 不變。
const english1 = cell('english', 1, [
  { count: 40, cands: wordPhrases(EN_THINGS, 3), build: (i, ctx, [w, p]) => hearQ(i, ctx, w, p) },
  { count: 20, cands: wordPhrases(EN_THINGS, 3), build: (i, ctx, [w, p]) => pic2enQ(i, ctx, w, p) },
  { count: 20, cands: wordPhrases(EN_THINGS, 3), build: (i, ctx, [w, p]) => zh2enQ(i, ctx, w, p) },
])
const english2 = cell('english', 2, [
  { count: 14, cands: wordPhrases(EN_COLORS, 3), build: (i, ctx, [w, p]) => hearQ(i, ctx, w, p) },
  { count: 14, cands: wordPhrases(EN_NUMS, 3), build: (i, ctx, [w, p]) => hearQ(i, ctx, w, p) },
  { count: 16, cands: wordPhrases(EN_THINGS, 3), build: (i, ctx, [w, p]) => pic2enQ(i, ctx, w, p) },
])
const english3 = cell('english', 3, [
  { count: 18, cands: wordPhrases(EN_THINGS, 3), build: (i, ctx, [w, p]) => zh2enQ(i, ctx, w, p) },
  { count: 8, cands: wordPhrases(EN_COLORS, 3), build: (i, ctx, [w, p]) => zh2enQ(i, ctx, w, p) },
  { count: 10, cands: wordPhrases(EN_NUMS, 3), build: (i, ctx, [w, p]) => zh2enQ(i, ctx, w, p) },
  { count: 6, cands: wordPhrases([...EN_COLORS, ...EN_NUMS], 2), build: (i, ctx, [w, p]) => pic2enQ(i, ctx, w, p) },
])
const english4 = cell('english', 4, [{ count: 40, cands: spellCands, build: (i, ctx, [w, at, p]) => spellQ(i, ctx, w, at, p) }])
// 幼幼模式：只出最常見的 10 個字，2 選 1
const english1g = cell(
  'english',
  1,
  [{ count: 30, cands: wordPhrases(EN_GENTLE_WORDS, 3), build: (i, ctx, [w, p]) => hearQ(i, ctx, w, p, EN_GENTLE_WORDS, 2) }],
  { gentle: true },
)

// ---------- 生活與禮儀、自然常識（v6 線 B） ----------
// 內容表見 src/learning/lifeNature.ts。只用「畫得符合題意」的圖（WORLD_ART[name].ok）。
// 每題的 params.fact 記下它考的事實（<類型>:<內容>），單元測試用另一份獨立的對照表重新算正解。
const okArt = (a) => {
  if (!LN.artOk(a)) throw new Error(`素材 ${a} 不能用在題目裡（見 lifeNature.ts 的 WORLD_ART）`)
  return a
}
const artChoice = (a) => ({ id: okArt(a), art: a })
const wordChoice = (id, text, emoji) => ({ id, text, emoji })
/** 答案放第 pos 個，其他選項隨機排；回傳選項陣列 */
function arrange(answer, others, ctx) {
  const k = others.length + 1
  const pos = ctx.pos(k)
  const arr = shuffle(others)
  arr.splice(pos, 0, answer)
  ctx.mark(k, pos)
  return arr
}
const withP = (list, phrases = 3) => shuffle(list.flatMap((x) => Array.from({ length: phrases }, (_, p) => [x, p])))
const textsOf = (choices) => choices.map((c) => c.text)

// ----- 生活 -----
const LP = LN.LIFE_PICS.filter((p) => LN.artOk(p.art))
const LP_GOOD = LP.filter((p) => p.good)
const LP_BAD = LP.filter((p) => !p.good)
const LP_SEE = LP.filter((p) => p.see)
const pairOf = (goodArt) => LN.LIFE_PAIRS.find((x) => x.good === goodArt && LN.artOk(x.bad))

function lifeSeeQ(i, ctx, target, k, phrase) {
  const others = sample(LP.filter((p) => p.art !== target.art).map((p) => p.art), k - 1)
  if (others.length < k - 1) reject()
  const choices = arrange(target.art, others, ctx).map(artChoice)
  return {
    type: 'lifeSee',
    prompt: LN.SEE_ASKS[phrase % 3](target.see),
    items: [],
    choices,
    answer: target.art,
    hint: `看看每一張圖裡，阿悟正在做什麼？找出阿悟${target.see}${target.see.endsWith('的') ? '' : '的'}那一張。`,
    params: { fact: `see:${target.art}` },
  }
}
function lifeRightQ(i, ctx, good, k, phrase) {
  const pr = pairOf(good.art)
  // 「哪一個做法比較好」只用同一情境的正反對比（洗手 vs 髒手、排隊 vs 插隊…）：
  // 拿兩個不同情境來比（遮嘴 vs 髒手）孩子雖然答得出來，但學不到「這個情境該怎麼做」。
  // 沒有成對圖的好習慣由「這樣好不好？」等題型負責。
  if (!pr) reject()
  const others = LP_BAD.filter((b) => b.art !== pr.bad)
  const bads = [LP_BAD.find((b) => b.art === pr.bad), ...sample(others, k - 2)]
  if (bads.length < k - 1 || bads.some((b) => !b)) reject()
  const matched = !!pr && bads.some((b) => b.art === pr.bad)
  const choices = arrange(good.art, bads.map((b) => b.art), ctx).map(artChoice)
  return {
    type: 'lifeRight',
    prompt: matched ? pr.asks[phrase % 3] : LN.RIGHT_ASKS[phrase % 3],
    items: [],
    choices,
    answer: good.art,
    hint: matched ? LN.LIFE_PIC_BY_ART[pr.bad].why : good.why,
    params: { fact: `right:${good.art}` },
  }
}
const OK_CHOICES = (ctx) => {
  const yes = wordChoice('yes', '好', '👍')
  const no = wordChoice('no', '不好', '👎')
  const pos = ctx.pos(2)
  ctx.mark(2, pos)
  return pos === 0 ? [yes, no] : [no, yes]
}
function lifeOkPicQ(i, ctx, pic, v) {
  if (pic.art === 'life-queue') reject() // 只畫了站在一起，單看一張看不出在排隊
  return {
    type: 'lifeOk',
    prompt: `${pic.okay[v % pic.okay.length]}。${LN.OKAY_TAIL}`,
    items: [],
    choices: OK_CHOICES(ctx),
    answer: pic.good ? 'yes' : 'no',
    hint: pic.why,
    params: { stem: { art: okArt(pic.art) }, words: ['好', '不好'], fact: `ok:${pic.art}:${pic.good ? 'yes' : 'no'}` },
  }
}
function lifeOkStoryQ(i, ctx, story, idx) {
  return {
    type: 'lifeOk',
    prompt: `${story.text}。${LN.OKAY_TAIL}`,
    items: [],
    choices: OK_CHOICES(ctx),
    answer: story.good ? 'yes' : 'no',
    hint: story.why,
    params: { stem: { emoji: story.emoji }, words: ['好', '不好'], fact: `story:${idx}:${story.good ? 'yes' : 'no'}` },
  }
}
function lifeSayQ(i, ctx, scene, k, phrase) {
  const ans = LN.SAY_BY_ID[scene.say]
  const others = sample(LN.SAY_WORDS.filter((w) => w.id !== ans.id), k - 1)
  if (others.length < k - 1) reject()
  const choices = arrange(ans, others, ctx).map((w) => wordChoice(w.id, w.text, w.emoji))
  return {
    type: 'lifeSay',
    prompt: `${scene.text}。${LN.SAY_ASKS[phrase % 3]}`,
    items: [],
    choices,
    answer: ans.id,
    hint: scene.hint,
    params: { stem: scene.art ? { art: okArt(scene.art) } : { emoji: scene.emoji }, words: textsOf(choices), fact: `say:${ans.id}` },
  }
}
function lifeLightQ(i, ctx, lq) {
  const choices = arrange(lq.right, [lq.other], ctx).map((c) => wordChoice(c.id, c.text, c.emoji))
  return {
    type: 'lifeLight',
    prompt: lq.prompt,
    items: [],
    choices,
    answer: lq.right.id,
    hint: lq.hint,
    params: { stem: { swatch: lq.swatch }, words: textsOf(choices), fact: `light:${lq.color}:${lq.right.id}` },
  }
}
function lifeLightPicQ(i, ctx, lq) {
  const choices = arrange(lq.right, [lq.other], ctx).map(artChoice)
  const color = lq.prompt.includes('紅燈') ? 'red' : 'green'
  return { type: 'lifeLight', prompt: lq.prompt, items: [], choices, answer: lq.right, hint: lq.hint, params: { fact: `lightpic:${color}:${lq.right}` } }
}
const STEP_FIRST = [(t) => `${t}要先做什麼呢？`, (t) => `${t}，第一步要做什麼呢？`, (t) => `${t}，最先要做哪一件事呢？`]
const STEP_LAST = [(t) => `${t}最後要做什麼呢？`, (t) => `${t}的最後一步是什麼呢？`, (t) => `${t}，最後要做哪一件事呢？`]
const stepChoice = (st) => wordChoice(st.id, st.text, st.emoji)
function lifeStepQ(i, ctx, routine, which, k, phrase) {
  const st = routine.steps
  const ans = which === 'first' ? st[0] : st[st.length - 1]
  const others = sample(st.filter((x) => x.id !== ans.id), k - 1)
  if (others.length < k - 1) reject()
  const choices = arrange(ans, others, ctx).map(stepChoice)
  const title = routine.title === '吃飯' ? '吃飯前' : routine.title
  return {
    type: 'lifeStep',
    prompt: (which === 'first' ? STEP_FIRST : STEP_LAST)[phrase % 3](title),
    items: [],
    choices,
    answer: ans.id,
    hint: `${title}的順序是：${st.map((x) => x.text).join('，再')}。`,
    params: { words: textsOf(choices), fact: `step:${routine.id}:${which}` },
  }
}
/** 在 steps 裡挑 n 張依原順序（不一定連續）的卡片，打散成不是正確順序的樣子 */
function orderCards(steps, n) {
  const idx = shuffle(steps.map((_, k) => k)).slice(0, n).sort((a, b) => a - b)
  const chosen = idx.map((k) => steps[k])
  let cards = shuffle(chosen)
  let guard = 0
  while (cards.every((c, k) => c.id === chosen[k].id) && guard++ < 50) cards = shuffle(chosen)
  if (cards.every((c, k) => c.id === chosen[k].id)) reject()
  return { chosen, cards }
}
const cardChoice = (c) => ({ id: c.id, text: c.text, emoji: c.emoji, ...(c.art ? { art: okArt(c.art) } : {}) })
function lifeOrderQ(i, ctx, routine, n, phrase) {
  if (n > routine.steps.length) reject()
  const { chosen, cards } = orderCards(routine.steps, n)
  const title = routine.title === '吃飯' ? '吃飯前' : routine.title
  const asks = [`請把${title}的步驟，依順序排好。`, `${title}要怎麼做呢？請依順序排好。`, `把${title}的每一步，從第一步開始排好。`]
  return {
    type: 'lifeOrder',
    interaction: 'stepOrder',
    prompt: asks[phrase % 3],
    items: [],
    choices: cards.map(cardChoice),
    answer: 'sorted',
    hint: `${title}的順序是：${chosen.map((x) => x.text).join('，再')}。`,
    params: { order: chosen.map((x) => x.id), words: chosen.map((x) => x.text), fact: `order:${routine.id}:${chosen.map((x) => x.id).join('>')}` },
  }
}
function lifeWhyQ(i, ctx, why, wrongIds) {
  const wrong = wrongIds.map((k) => why.wrong[k])
  const choices = arrange(why.right, wrong, ctx).map((c) => wordChoice(c.text, c.text, c.emoji))
  return {
    type: 'lifeWhy',
    prompt: why.ask,
    items: [],
    choices,
    answer: why.right.text,
    hint: why.hint,
    params: { words: textsOf(choices), fact: `why:${why.id}` },
  }
}

const SEE_CANDS = withP(LP_SEE, 3).map(([p, ph]) => [p, ph])
const RIGHT2 = withP(LP_GOOD, 3)
const RIGHT3 = withP(LP_GOOD, 3)
const SAY_ALL = withP(LN.SAY_SCENES, 3)
// 難度 2 先出有圖的那一個情境（兔子送禮物給阿悟），讓孩子看圖說「謝謝」
const SAY_D2 = [...SAY_ALL].sort((a, b) => (b[0].art ? 1 : 0) - (a[0].art ? 1 : 0))
const SAY_THANKS_SORRY = withP(LN.SAY_SCENES.filter((s) => s.say === 'thanks' || s.say === 'sorry'), 3)
const OK_PICS = withP(LP, 2)
const OK_STORIES = withP(LN.LIFE_STORIES.map((s, idx) => [s, idx]), 1)
// 難度 2 用前五個故事、難度 3 用後五個，兩個難度不重複
const OK_STORIES_A = OK_STORIES.filter(([[, idx]]) => idx < 5)
const OK_STORIES_B = OK_STORIES.filter(([[, idx]]) => idx >= 5)
// 每個「為什麼」先各出一次（同一組干擾項），再換下一組干擾項，所以前面幾題一定涵蓋全部十個
const WHY_CANDS = [[0, 1], [0, 2], [1, 2]].flatMap((pair) => shuffle(LN.WHYS).map((w) => [w, pair]))
const STEP_CANDS = (which) => shuffle(LN.ROUTINES.flatMap((r) => Array.from({ length: 3 }, (_, p) => [r, which, p])))
const ORDER_CANDS = (n) => shuffle(LN.ROUTINES.flatMap((r) => Array.from({ length: 6 }, (_, p) => [r, n, p])))

const life1 = cell('life', 1, [
  { count: 21, cands: SEE_CANDS, build: (i, ctx, [p, ph]) => lifeSeeQ(i, ctx, p, 3, ph) },
  { count: 15, cands: RIGHT2, build: (i, ctx, [g, ph]) => lifeRightQ(i, ctx, g, 2, ph) },
  // 同情境的正反對比只有 15 種（5 組 × 3 種問法）；不足的部分由「找出阿悟在做什麼」補上（難度 1 維持全是圖片選項）
])
const life2 = cell('life', 2, [
  { count: 12, cands: RIGHT3, build: (i, ctx, [g, ph]) => lifeRightQ(i, ctx, g, 3, ph) },
  { count: 14, cands: OK_PICS, build: (i, ctx, [p, v]) => lifeOkPicQ(i, ctx, p, v) },
  { count: 5, cands: OK_STORIES_A, build: (i, ctx, [[s, idx]]) => lifeOkStoryQ(i, ctx, s, idx) },
  { count: 4, cands: LN.LIGHT_QS, build: (i, ctx, lq) => lifeLightQ(i, ctx, lq) },
  { count: 3, cands: LN.LIGHT_PIC_QS, build: (i, ctx, lq) => lifeLightPicQ(i, ctx, lq) },
  { count: 10, cands: SAY_D2, build: (i, ctx, [sc, ph]) => lifeSayQ(i, ctx, sc, 3, ph) },
])
const life3 = cell('life', 3, [
  { count: 14, cands: SAY_ALL, build: (i, ctx, [sc, ph]) => lifeSayQ(i, ctx, sc, 4, ph) },
  { count: 6, cands: STEP_CANDS('first'), build: (i, ctx, [r, w, ph]) => lifeStepQ(i, ctx, r, w, 3, ph) },
  { count: 6, cands: STEP_CANDS('last'), build: (i, ctx, [r, w, ph]) => lifeStepQ(i, ctx, r, w, 3, ph) },
  { count: 8, cands: ORDER_CANDS(3), build: (i, ctx, [r, n, ph]) => lifeOrderQ(i, ctx, r, n, ph) },
  { count: 5, cands: OK_STORIES_B, build: (i, ctx, [[s, idx]]) => lifeOkStoryQ(i, ctx, s, idx) },
])
const life4 = cell('life', 4, [
  { count: 12, cands: ORDER_CANDS(4), build: (i, ctx, [r, n, ph]) => lifeOrderQ(i, ctx, r, n, ph) },
  { count: 4, cands: ORDER_CANDS(5), build: (i, ctx, [r, n, ph]) => lifeOrderQ(i, ctx, r, n, ph) },
  { count: 16, cands: WHY_CANDS, build: (i, ctx, [w, pair]) => lifeWhyQ(i, ctx, w, pair) },
  { count: 6, cands: STEP_CANDS('first'), build: (i, ctx, [r, w, ph]) => lifeStepQ(i, ctx, r, w, 4, ph) },
  { count: 6, cands: STEP_CANDS('last'), build: (i, ctx, [r, w, ph]) => lifeStepQ(i, ctx, r, w, 4, ph) },
  { count: 6, cands: SAY_ALL, build: (i, ctx, [sc, ph]) => lifeSayQ(i, ctx, sc, 4, ph) },
])
// 幼幼模式：只有 2 選 1 的配對、對錯題與簡單的「要說什麼」
const life1g = cell(
  'life',
  1,
  [
    { count: 12, cands: SEE_CANDS, build: (i, ctx, [p, ph]) => lifeSeeQ(i, ctx, p, 2, ph) },
    { count: 14, cands: RIGHT2, build: (i, ctx, [g, ph]) => lifeRightQ(i, ctx, g, 2, ph) },
    { count: 8, cands: SAY_THANKS_SORRY, build: (i, ctx, [sc, ph]) => lifeSayQ(i, ctx, sc, 2, ph) },
  ],
  { gentle: true },
)

// ----- 自然 -----
const NP = { seed: 7 }
const ANIMAL_PICS = LN.ANIMALS.map((a) => a.id)
const ANIMALS_HOME = LN.ANIMALS.filter((a) => a.home)

function natWeatherQ(i, ctx, w, k, phrase) {
  const others = sample(LN.WEATHERS.filter((x) => x.id !== w.id).map((x) => x.art), k - 1)
  if (others.length < k - 1) reject()
  const choices = arrange(w.art, others, ctx).map(artChoice)
  return { type: 'natWeather', prompt: w.asks[phrase % 3], items: [], choices, answer: w.art, hint: w.hint, params: { fact: `weather:${w.id}` } }
}
const WEATHER_PIC_ASKS = ['這是什麼天氣呢？', '看看圖，今天是什麼天氣呢？', '阿悟看到這樣的天空，是什麼天氣呢？']
function natWeatherNameQ(i, ctx, w, k, phrase) {
  const others = sample(LN.WEATHERS.filter((x) => x.id !== w.id), k - 1)
  if (others.length < k - 1) reject()
  const choices = arrange(w, others, ctx).map((x) => wordChoice(x.id, x.name, LN.artEmojiOf(x.art)))
  return {
    type: 'natWeather',
    prompt: WEATHER_PIC_ASKS[phrase % 3],
    items: [],
    choices,
    answer: w.id,
    hint: w.hint,
    params: { stem: { art: okArt(w.art) }, words: textsOf(choices), fact: `weatherName:${w.id}` },
  }
}
function natBringQ(i, ctx, bq, phrase, withArt) {
  const gear = LN.GEAR_BY_ID[bq.gear]
  const others = LN.GEARS.filter((g) => g.id !== gear.id)
  const choices = arrange(gear, others, ctx).map((g) => wordChoice(g.id, g.text, g.emoji))
  return {
    type: 'natBring',
    prompt: bq.prompts[phrase % 3],
    items: [],
    choices,
    answer: gear.id,
    hint: bq.hint,
    params: { stem: withArt ? { art: okArt(bq.art) } : { emoji: bq.emoji }, words: textsOf(choices), fact: `bring:${bq.cond}` },
  }
}
function natHomeQ(i, ctx, animal, k, phrase) {
  const others = sample(LN.HOMES.filter((h) => h.art !== animal.home).map((h) => h.art), k - 1)
  if (others.length < k - 1) reject()
  const asks = [`${animal.name}住在哪裡呢？`, `${animal.name}的家在哪裡呢？`, `找找看，${animal.name}住在哪一個地方？`]
  const choices = arrange(animal.home, others, ctx).map((a) => ({ ...artChoice(a), text: LN.HOME_LABEL[a] }))
  return {
    type: 'natHome',
    prompt: asks[phrase % 3],
    items: [],
    choices,
    answer: animal.home,
    hint: animal.homeHint,
    params: { stem: { art: okArt(animal.id) }, fact: `home:${animal.id}` },
  }
}
function natSeasonPicQ(i, ctx, season, phrase) {
  const others = LN.SEASONS.filter((x) => x.id !== season.id)
  const pickOthers = sample(others, 2)
  const choices = arrange(season, pickOthers, ctx).map((x) => wordChoice(x.id, x.name, x.emoji))
  return {
    type: 'natSeason',
    prompt: LN.SEASON_PIC_ASKS[phrase % 3],
    items: [],
    choices,
    answer: season.id,
    hint: season.picHint,
    params: { stem: { art: okArt(season.art) }, words: textsOf(choices), fact: `seasonPic:${season.id}` },
  }
}
function natSeasonNameQ(i, ctx, season, k, phrase) {
  const others = sample(LN.SEASONS.filter((x) => x.id !== season.id).map((x) => x.art), k - 1)
  if (others.length < k - 1) reject()
  const choices = arrange(season.art, others, ctx).map(artChoice)
  return {
    type: 'natSeason',
    prompt: LN.SEASON_NAME_ASKS[phrase % 3](season.name),
    items: [],
    choices,
    answer: season.art,
    hint: LN.SEASON_FACTS.find((f) => f.season === season.id).hint,
    params: { fact: `seasonName:${season.id}` },
  }
}
function natSeasonFactQ(i, ctx, f, phrase) {
  const choices = arrange(LN.SEASON_BY_ID[f.season], LN.SEASONS.filter((x) => x.id !== f.season), ctx).map((x) => wordChoice(x.id, x.name, x.emoji))
  return { type: 'natSeason', prompt: f.asks[phrase % 3], items: [], choices, answer: f.season, hint: f.hint, params: { words: textsOf(choices), fact: `season:${f.id}` } }
}
function natSnowQ(i, ctx, phrase) {
  const win = LN.SEASON_BY_ID.winter
  const choices = arrange(win, LN.SEASONS.filter((x) => x.id !== 'winter'), ctx).map((x) => wordChoice(x.id, x.name, x.emoji))
  return { type: 'natSeason', prompt: LN.SNOW_ASKS[phrase % 3], items: [], choices, answer: 'winter', hint: LN.SNOW_HINT, params: { words: textsOf(choices), fact: 'snow:winter' } }
}
function natPlantStageQ(i, ctx, st, k, phrase) {
  const others = sample(LN.PLANT_STAGES.filter((x) => x.id !== st.id).map((x) => x.art), k - 1)
  if (others.length < k - 1) reject()
  const choices = arrange(st.art, others, ctx).map(artChoice)
  return { type: 'natPlant', prompt: st.asks[phrase % 3], items: [], choices, answer: st.art, hint: st.hint, params: { fact: `plant:${st.id}` } }
}
function natPlantNeedQ(i, ctx, need, wrongIds) {
  const wrong = wrongIds.map((k) => need.wrong[k])
  const choices = arrange(need.right, wrong, ctx).map((c) => wordChoice(c.text, c.text, c.emoji))
  return { type: 'natPlant', prompt: need.ask, items: [], choices, answer: need.right.text, hint: need.hint, params: { words: textsOf(choices), fact: 'need:plant' } }
}
const ANIMAL_NAME_ASKS = [(n) => `哪一個是${n}呢？`, (n) => `找找看，${n}在哪裡？`, (n) => `阿悟想找${n}，是哪一個呢？`]
function natAnimalNameQ(i, ctx, animal, k, phrase) {
  const others = sample(ANIMAL_PICS.filter((a) => a !== animal.id), k - 1)
  if (others.length < k - 1) reject()
  const choices = arrange(animal.id, others, ctx).map(artChoice)
  return {
    type: 'natAnimal',
    prompt: ANIMAL_NAME_ASKS[phrase % 3](animal.name),
    items: [],
    choices,
    answer: animal.id,
    hint: `看看每一個動物，哪一個是${animal.name}呢？`,
    params: { fact: `name:${animal.id}` },
  }
}
function natAnimalTraitQ(i, ctx, trait, ansId, k, phrase) {
  const others = sample(ANIMAL_PICS.filter((a) => !trait.who.includes(a)), k - 1)
  if (others.length < k - 1) reject()
  const choices = arrange(ansId, others, ctx).map(artChoice)
  return { type: 'natAnimal', prompt: trait.asks[phrase % 3], items: [], choices, answer: ansId, hint: trait.hint, params: { fact: `trait:${trait.id}` } }
}
const BINS_ASKS = ['小動物們要回家了，請把牠們放進自己的家。', '請送小動物回家，看看牠們住在哪裡。', '每一個小動物都有自己的家，請把牠們放進對的地方。']
function natBinsQ(i, ctx, nBins, phrase) {
  const homes = sample(LN.HOMES, nBins)
  const items = []
  for (const h of homes) {
    const pool = ANIMALS_HOME.filter((a) => a.home === h.art)
    const n = Math.min(pool.length, 1 + Math.floor(rnd() * 2))
    items.push(...sample(pool, n))
  }
  if (items.length < nBins || items.length > 5) reject()
  const order = shuffle(items)
  const bins = homes.map((h, k) => ({ id: `b${k + 1}`, label: h.label, art: okArt(h.art) }))
  const targets = order.map((a) => bins[homes.findIndex((h) => h.art === a.home)].id)
  const set = [...order.map((a) => a.id)].sort().join('+') + '|' + homes.map((h) => h.art).sort().join('+')
  if (binSets.has(set)) reject()
  binSets.add(set)
  return {
    type: 'bins',
    interaction: 'dragSort',
    prompt: BINS_ASKS[phrase % 3],
    items: order.map((a) => ({ obj: a.id })),
    choices: [],
    answer: 'sorted',
    hint: bins.map((b, k) => `${order.filter((a) => a.home === homes[k].art).map((a) => a.name).join('和')}住在${b.label}`).join('，') + '。',
    params: { bins, targets, fact: 'bins:home' },
  }
}
const binSets = new Set()
function natOrderQ(i, ctx, kind, phrase) {
  if (kind === 'plant') {
    const stages = LN.PLANT_STAGES
    let cards = shuffle(stages)
    let g = 0
    while (cards.every((c, k) => c.id === stages[k].id) && g++ < 50) cards = shuffle(stages)
    return {
      type: 'natOrder',
      interaction: 'stepOrder',
      prompt: LN.PLANT_ORDER_ASKS[phrase % 3],
      items: [],
      choices: cards.map((c) => ({ id: c.id, text: c.name, emoji: c.emoji, art: okArt(c.art) })),
      answer: 'sorted',
      hint: LN.PLANT_ORDER_HINT,
      params: { order: stages.map((c) => c.id), words: stages.map((c) => c.name), fact: 'order:plant' },
    }
  }
  const seasons = LN.SEASONS
  let cards = shuffle(seasons)
  let g = 0
  while (cards.every((c, k) => c.id === seasons[k].id) && g++ < 50) cards = shuffle(seasons)
  return {
    type: 'natOrder',
    interaction: 'stepOrder',
    prompt: LN.SEASON_ORDER_ASKS[phrase % 3],
    items: [],
    choices: cards.map((c) => ({ id: c.id, text: c.name, emoji: c.emoji, art: okArt(c.art) })),
    answer: 'sorted',
    hint: LN.SEASON_ORDER_HINT,
    params: { order: seasons.map((c) => c.id), words: seasons.map((c) => c.name), fact: 'order:season' },
  }
}

const WEATHER_C = withP(LN.WEATHERS, 3)
const ANIMAL_C = withP(LN.ANIMALS, 3)
const BRING_C = shuffle(LN.BRING_QS.flatMap((b) => Array.from({ length: 6 }, (_, p) => [b, p % 3, p >= 3])))
const HOME_C = withP(ANIMALS_HOME, 3)
const SEASON_C = withP(LN.SEASONS, 3)
const PLANT_C = withP(LN.PLANT_STAGES, 3)
const SFACT_C = withP(LN.SEASON_FACTS, 3)
// 先把每個特徵都用同一種問法排過一輪，再換下一種問法（所以前幾題一定涵蓋所有特徵）；order 決定問法的輪流順序
const TRAIT_C = (order) => order.flatMap((p) => shuffle(LN.TRAITS.flatMap((t) => t.who.map((a) => [t, a, p]))))
const NEED_C = shuffle(LN.PLANT_NEEDS.flatMap((n) => [[0, 1], [0, 2], [1, 2]].map((pair) => [n, pair])))
const ORDER_C = (kind) => Array.from({ length: 12 }, (_, p) => [kind, p])
const BINS_C = (n) => Array.from({ length: 60 }, (_, p) => [n, p])

const nature1 = cell(
  'nature',
  1,
  [
    { count: 12, cands: WEATHER_C, build: (i, ctx, [w, ph]) => natWeatherQ(i, ctx, w, 3, ph) },
    { count: 20, cands: ANIMAL_C, build: (i, ctx, [a, ph]) => natAnimalNameQ(i, ctx, a, 3, ph) },
    // 第 1 章也要有季節、動物的家、植物生長，不要只有找動物（試玩審查 G2）；接在後面，原本題目的 id 不變
    { count: 10, cands: HOME_C, build: (i, ctx, [a, ph]) => natHomeQ(i, ctx, a, 3, ph) },
    { count: 8, cands: SEASON_C, build: (i, ctx, [s, ph]) => natSeasonPicQ(i, ctx, s, ph) },
    { count: 9, cands: PLANT_C, build: (i, ctx, [p, ph]) => natPlantStageQ(i, ctx, p, 3, ph) },
  ],
  NP,
)
const nature2 = cell(
  'nature',
  2,
  [
    { count: 12, cands: BRING_C, build: (i, ctx, [b, ph, art]) => natBringQ(i, ctx, b, ph, art) },
    { count: 14, cands: HOME_C, build: (i, ctx, [a, ph]) => natHomeQ(i, ctx, a, 3, ph) },
    { count: 8, cands: SEASON_C, build: (i, ctx, [s, ph]) => natSeasonPicQ(i, ctx, s, ph) },
    { count: 9, cands: PLANT_C, build: (i, ctx, [p, ph]) => natPlantStageQ(i, ctx, p, 3, ph) },
    { count: 6, cands: WEATHER_C, build: (i, ctx, [w, ph]) => natWeatherNameQ(i, ctx, w, 3, ph) },
  ],
  NP,
)
const nature3 = cell(
  'nature',
  3,
  [
    { count: 8, cands: BINS_C(2), build: (i, ctx, [n, ph]) => natBinsQ(i, ctx, n, ph) },
    { count: 10, cands: SFACT_C, build: (i, ctx, [f, ph]) => natSeasonFactQ(i, ctx, f, ph) },
    { count: 8, cands: SEASON_C, build: (i, ctx, [s, ph]) => natSeasonNameQ(i, ctx, s, 3, ph) },
    { count: 8, cands: ORDER_C('plant'), build: (i, ctx, [k, ph]) => natOrderQ(i, ctx, k, ph) },
    { count: 10, cands: TRAIT_C([0, 1, 2]), build: (i, ctx, [t, a, ph]) => natAnimalTraitQ(i, ctx, t, a, 3, ph) },
  ],
  NP,
)
const nature4 = cell(
  'nature',
  4,
  [
    { count: 8, cands: BINS_C(3), build: (i, ctx, [n, ph]) => natBinsQ(i, ctx, n, ph) },
    { count: 10, cands: ORDER_C('season'), build: (i, ctx, [k, ph]) => natOrderQ(i, ctx, k, ph) },
    { count: 3, cands: [0, 1, 2], build: (i, ctx, ph) => natSnowQ(i, ctx, ph) },
    { count: 8, cands: SFACT_C, build: (i, ctx, [f, ph]) => natSeasonFactQ(i, ctx, f, ph) },
    { count: 6, cands: NEED_C, build: (i, ctx, [n, pair]) => natPlantNeedQ(i, ctx, n, pair) },
    { count: 8, cands: TRAIT_C([1, 2, 0]), build: (i, ctx, [t, a, ph]) => natAnimalTraitQ(i, ctx, t, a, 4, ph) },
  ],
  NP,
)
// 幼幼模式：天氣圖、認動物、動物住哪裡，都是 2 選 1
const nature1g = cell(
  'nature',
  1,
  [
    { count: 10, cands: WEATHER_C, build: (i, ctx, [w, ph]) => natWeatherQ(i, ctx, w, 2, ph) },
    { count: 14, cands: ANIMAL_C, build: (i, ctx, [a, ph]) => natAnimalNameQ(i, ctx, a, 2, ph) },
    { count: 8, cands: HOME_C, build: (i, ctx, [a, ph]) => natHomeQ(i, ctx, a, 2, ph) },
  ],
  { ...NP, gentle: true },
)

// ---------- v6 第 2 章（水簾洞）：比較與排序 ----------
// 同一個物件用 CSS 縮放成不同大小（scale），不需要新素材。
const BIG_WORDS = { size: ['大', '小'], height: ['高', '矮'], length: ['長', '短'] }
const LENGTH_OBJS = ['obj-banana', 'obj-fish', 'decor-car', 'decor-rocket', 'decor-piano']
const HEIGHT_OBJS = ['obj-chick', 'obj-rabbit', 'obj-flower', 'obj-apple', 'obj-peach', 'obj-grape', 'decor-rocket', 'decor-dino', 'decor-piano', 'obj-banana']
const objsFor = (dim) => (dim === 'length' ? LENGTH_OBJS : dim === 'height' ? HEIGHT_OBJS : IDS)
const SCALE_GRID = [0.32, 0.36, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]
/** k 個不同的倍率（由小到大），相鄰兩個的比例至少 minRatio，最大的一定 >= 0.85（畫面上看得出來） */
function scaleSet(k, minRatio) {
  for (let t = 0; t < 4000; t++) {
    const picks = sample(SCALE_GRID, k).sort((a, b) => a - b)
    if (picks[k - 1] < 0.85) continue
    if (picks.every((v, i) => i === 0 || v / picks[i - 1] >= minRatio - 1e-9)) return picks
  }
  reject()
}
const dimPhrase = (dim, ask) => BIG_WORDS[dim][ask === 'max' ? 0 : 1]

function biggerQ(i, ctx, k, minRatio, dim, ask, obj, phrase) {
  const w = dimPhrase(dim, ask)
  const comp = k === 2 ? '比較' : '最'
  const forms = [
    `哪一${un(obj)}${nm(obj)}${comp}${w}？`,
    `找找看，哪一個${comp}${w}？`,
    `請指出${comp}${w}的那一${un(obj)}${nm(obj)}。`,
  ]
  const sorted = scaleSet(k, minRatio) // 由小到大
  const answerScale = ask === 'max' ? sorted[k - 1] : sorted[0]
  const others = shuffle(sorted.filter((v) => v !== answerScale))
  const pos = ctx.pos(k)
  const arr = [...others]
  arr.splice(pos, 0, answerScale)
  ctx.mark(k, pos)
  return {
    type: 'bigger',
    prompt: variant(forms, phrase),
    items: [],
    choices: arr.map((sc, n) => ({ id: `c${n + 1}`, obj, scale: sc, dim })),
    answer: `c${pos + 1}`,
    hint: `它們都是${nm(obj)}，只是有${BIG_WORDS[dim][0]}有${BIG_WORDS[dim][1]}。一個一個比一比，看看哪一${un(obj)}${comp}${w}。`,
    params: { dim, ask },
  }
}

const ORDER_FORMS = {
  size: { asc: ['由小排到大。', '把它們從小排到大，排排隊。', '最小的放最前面，一個一個排好。'], desc: ['由大排到小。', '把它們從大排到小，排排隊。', '最大的放最前面，一個一個排好。'] },
  height: { asc: ['由矮排到高。', '把它們從矮排到高，排排隊。', '最矮的放最前面，一個一個排好。'], desc: ['由高排到矮。', '把它們從高排到矮，排排隊。', '最高的放最前面，一個一個排好。'] },
  length: { asc: ['由短排到長。', '把它們從短排到長，排排隊。', '最短的放最前面，一個一個排好。'], desc: ['由長排到短。', '把它們從長排到短，排排隊。', '最長的放最前面，一個一個排好。'] },
}
function orderQ(i, ctx, n, minRatio, dim, dir, obj, phrase) {
  const sorted = scaleSet(n, minRatio) // 由小到大
  // items 是洗過牌的；order[k] = 第 k 格該放 items 的第幾個
  let perm
  for (let t = 0; t < 50; t++) {
    perm = shuffle([...Array(n).keys()])
    if (perm.some((v, k) => v !== k)) break
  }
  const items = perm.map((rank) => ({ obj, scale: sorted[rank] }))
  const asc = [...Array(n).keys()].map((rank) => perm.indexOf(rank)) // 由小到大的順序
  const order = dir === 'asc' ? asc : [...asc].reverse()
  const [lo, hi] = [BIG_WORDS[dim][1], BIG_WORDS[dim][0]]
  const first = dir === 'asc' ? lo : hi
  return {
    type: 'order',
    interaction: 'dragOrder',
    prompt: variant(ORDER_FORMS[dim][dir], phrase),
    items,
    choices: [],
    answer: 'sorted',
    hint: `先找最${first}的，放在第一格，再找次${first}的放第二格，一個一個排下去。`,
    params: { dim, dir, itemOrder: order },
  }
}

const MEASURE_CANDS = (dims, asks, phrases, objsOverride) =>
  shuffle(
    dims.flatMap((dim) =>
      (objsOverride ?? objsFor(dim)).flatMap((o) => asks.flatMap((ask) => Array.from({ length: phrases }, (_, p) => [dim, ask, o, p]))),
    ),
  )
const MEASURE_ORDER_CANDS = (dims, dirs, phrases) =>
  shuffle(dims.flatMap((dim) => objsFor(dim).flatMap((o) => dirs.flatMap((dir) => Array.from({ length: phrases }, (_, p) => [dim, dir, o, p])))))

const measure1g = cell(
  'measure',
  1,
  [
    { count: 16, cands: MEASURE_CANDS(['size'], ['max', 'min'], 3), build: (i, ctx, [dim, ask, o, p]) => biggerQ(i, ctx, 2, 2.0, dim, ask, o, p) },
    { count: 10, cands: MEASURE_CANDS(['height'], ['max', 'min'], 3), build: (i, ctx, [dim, ask, o, p]) => biggerQ(i, ctx, 2, 2.0, dim, ask, o, p) },
    { count: 10, cands: MEASURE_CANDS(['length'], ['max', 'min'], 3), build: (i, ctx, [dim, ask, o, p]) => biggerQ(i, ctx, 2, 2.0, dim, ask, o, p) },
  ],
  { gentle: true, seed: 11 },
)
const measure1 = cell(
  'measure',
  1,
  [
    { count: 12, cands: MEASURE_CANDS(['size', 'height', 'length'], ['max', 'min'], 3), build: (i, ctx, [dim, ask, o, p]) => biggerQ(i, ctx, 2, 1.7, dim, ask, o, p) },
    { count: 14, cands: MEASURE_CANDS(['size', 'height', 'length'], ['max', 'min'], 3), build: (i, ctx, [dim, ask, o, p]) => biggerQ(i, ctx, 3, 1.4, dim, ask, o, p) },
    { count: 10, cands: MEASURE_ORDER_CANDS(['size'], ['asc', 'desc'], 3), build: (i, ctx, [dim, dir, o, p]) => orderQ(i, ctx, 3, 1.5, dim, dir, o, p) },
  ],
  { seed: 11 },
)
const measure2 = cell(
  'measure',
  2,
  [
    { count: 18, cands: MEASURE_CANDS(['size', 'height', 'length'], ['max', 'min'], 3), build: (i, ctx, [dim, ask, o, p]) => biggerQ(i, ctx, 3, 1.3, dim, ask, o, p) },
    { count: 20, cands: MEASURE_ORDER_CANDS(['size', 'height', 'length'], ['asc', 'desc'], 3), build: (i, ctx, [dim, dir, o, p]) => orderQ(i, ctx, 3, 1.35, dim, dir, o, p) },
  ],
  { seed: 11 },
)
const measure3 = cell(
  'measure',
  3,
  [
    { count: 12, cands: MEASURE_CANDS(['size', 'height', 'length'], ['max', 'min'], 3), build: (i, ctx, [dim, ask, o, p]) => biggerQ(i, ctx, 4, 1.18, dim, ask, o, p) },
    { count: 24, cands: MEASURE_ORDER_CANDS(['size', 'height', 'length'], ['asc', 'desc'], 3), build: (i, ctx, [dim, dir, o, p]) => orderQ(i, ctx, 4, 1.2, dim, dir, o, p) },
  ],
  { seed: 11 },
)
const measure4 = cell(
  'measure',
  4,
  [
    { count: 12, cands: MEASURE_CANDS(['size', 'height', 'length'], ['max', 'min'], 3), build: (i, ctx, [dim, ask, o, p]) => biggerQ(i, ctx, 5, 1.12, dim, ask, o, p) },
    { count: 26, cands: MEASURE_ORDER_CANDS(['size', 'height', 'length'], ['asc', 'desc'], 3), build: (i, ctx, [dim, dir, o, p]) => orderQ(i, ctx, 5, 1.14, dim, dir, o, p) },
  ],
  { seed: 11 },
)

// ---------- v6 第 2 章：空間方位 ----------
// 場景座標與位置判斷見 src/learning/space.ts（畫面、產生器、單元測試共用）。
// 上面／下面只用「懸空」的桌子或箱子：貼地的帳篷、床、沙發的「下面」有地面下方或前方兩種解讀（試玩審查 G7）
const UP_DOWN_PROPS = ['decor-table', 'decor-crate']
const needsFloat = (rels) => rels.some((r) => r === 'above' || r === 'below')
const SPACE_SUBJECTS = ['obj-chick', 'obj-fish', 'obj-rabbit', 'obj-apple', 'obj-banana', 'obj-peach', 'obj-star', 'obj-flower', 'obj-grape', 'obj-shell']
const PROP_NAME = Object.fromEntries(PROPS.map((p) => [p.id, p.name]))
const REL_HINT = {
  above: (p) => `上面，就是在${p}的頭頂上。`,
  below: (p) => `下面，就是在${p}的腳底下。`,
  inside: (p) => `裡面，就是躲在${p}裡頭。`,
  outside: (p) => `外面，就是不在${p}裡頭，站在旁邊。`,
  left: () => '舉起你的左手，左手那一邊就是左邊。',
  right: () => '舉起你的右手，右手那一邊就是右邊。',
  between: () => '中間，就是在兩個東西的正中央。',
}
const WHERE_FORMS = [
  (s, p, w) => `哪一張圖，${nm(s)}在${p}的${w}？`,
  (s, p, w) => `找找看，${nm(s)}在${p}的${w}是哪一張？`,
  (s, p, w) => `${nm(s)}在${p}的${w}，是哪一張圖？`,
]
const sceneChoice = (id, anchor, subject, rel) => ({ id, scene: { anchor, subject, rel } })
/** 小場景選項：k 張圖，每張的位置都不一樣（rels 的前 k 個，目標放第 pos 張） */
function whereQ(i, ctx, k, relPool, anchorPool, phrase, subject) {
  const rels = sample(relPool, k)
  const target = rels[Math.floor(rnd() * rels.length)]
  const anchor = pick(anchorPool.filter((a) => rels.every((r) => r !== 'inside' || INSIDE_PROPS.includes(a)) && (!needsFloat(rels) || UP_DOWN_PROPS.includes(a))))
  if (!anchor) reject()
  // outside 和 left / right 不放在同一題（兩個都在旁邊，分不出來）
  if (rels.includes('outside') && (rels.includes('left') || rels.includes('right'))) reject()
  const pos = ctx.pos(k)
  const others = shuffle(rels.filter((r) => r !== target))
  const arr = [...others]
  arr.splice(pos, 0, target)
  ctx.mark(k, pos)
  const pn = PROP_NAME[anchor]
  return {
    type: 'where',
    prompt: variant(WHERE_FORMS, phrase)(subject, pn, REL_WORD[target]),
    items: [],
    choices: arr.map((r, n) => sceneChoice(`c${n + 1}`, anchor, subject, r)),
    answer: `c${pos + 1}`,
    hint: `${REL_HINT[target](pn)}找找看，哪一張圖裡的${nm(subject)}在${pn}的${REL_WORD[target]}？`,
    params: { rel: target },
  }
}
const WHEREIS_FORMS = [
  (s, p, a, b) => `${nm(s)}在${p}的${REL_WORD[a]}還是${REL_WORD[b]}？`,
  (s, p, a, b) => `看一看，${nm(s)}是在${p}的${REL_WORD[a]}，還是${REL_WORD[b]}？`,
]
const REL_PAIRS = { d2: [['above', 'below'], ['inside', 'outside']], d3: [['left', 'right']] }
function whereIsQ(i, ctx, pairs, anchorPool, phrase, subject) {
  const pair = pick(pairs)
  const anchor = pick(anchorPool.filter((a) => (!pair.includes('inside') || INSIDE_PROPS.includes(a)) && (!needsFloat(pair) || UP_DOWN_PROPS.includes(a))))
  if (!anchor) reject()
  const target = pair[Math.floor(rnd() * 2)]
  const pos = ctx.pos(2)
  const other = pair.find((r) => r !== target)
  const arr = [...[other]]
  arr.splice(pos, 0, target)
  ctx.mark(2, pos)
  const [a, b] = rnd() < 0.5 ? pair : [pair[1], pair[0]]
  const pn = PROP_NAME[anchor]
  return {
    type: 'whereIs',
    prompt: variant(WHEREIS_FORMS, phrase)(subject, pn, a, b),
    items: [],
    choices: arr.map((r) => ({ id: r, text: REL_WORD[r] })),
    answer: target,
    hint: `先找到${pn}，再看${nm(subject)}站在哪裡。${REL_HINT[target](pn)}`,
    params: { scene: { anchor, subject, rel: target } },
  }
}
/** 兩個東西排成一排：誰在誰的左邊還是右邊（難度 4） */
function whereIs2Q(i, ctx, phrase) {
  const [a, b] = sample(IDS, 2)
  const target = rnd() < 0.5 ? 'left' : 'right'
  const pos = ctx.pos(2)
  const arr = [target === 'left' ? 'right' : 'left']
  arr.splice(pos, 0, target)
  ctx.mark(2, pos)
  // 題幹的排列：a 在 b 的 target 邊（left = a 排在 b 前面）
  const items = target === 'left' ? [{ obj: a }, { obj: b }] : [{ obj: b }, { obj: a }]
  const forms = [`${nm(a)}在${nm(b)}的左邊還是右邊？`, `看一看，${nm(a)}是排在${nm(b)}的左邊，還是右邊？`]
  return {
    type: 'whereIs',
    prompt: variant(forms, phrase),
    items,
    choices: arr.map((r) => ({ id: r, text: REL_WORD[r] })),
    answer: target,
    hint: `先找到${nm(b)}，再看${nm(a)}排在哪一邊。${REL_HINT[target]()}`,
  }
}
const ORD = ['', '一', '二', '三', '四']
function rowQ(i, ctx, n, kind, nth, phrase) {
  const objs = sample(IDS, n)
  const idx = kind === 'middle' ? 1 : kind === 'first' ? 0 : kind === 'last' ? n - 1 : nth - 1
  const answer = objs[idx]
  const forms =
    kind === 'middle'
      ? ['在最中間的是哪一個？', '排在最中間的是哪一個？']
      : kind === 'first'
        ? ['排在最左邊的是哪一個？', '最左邊的是哪一個？']
        : kind === 'last'
          ? ['排在最右邊的是哪一個？', '最右邊的是哪一個？']
          : [`從左邊數過來，第${ORD[nth]}個是哪一個？`, `從左邊開始數，第${ORD[nth]}個是誰？`]
  const pos = ctx.pos(n)
  return {
    type: 'row',
    prompt: variant(forms, phrase),
    items: objs.map((obj) => ({ obj })),
    choices: objChoices(answer, objs.filter((o) => o !== answer), pos, ctx),
    answer,
    hint:
      kind === 'middle'
        ? '先數一數有幾個，再找最中間的那一個。'
        : kind === 'nth'
          ? `從最左邊開始，一個一個數：${Array.from({ length: nth }, (_, k) => ORD[k + 1]).join('、')}。數到第${ORD[nth]}個停下來。`
          : `舉起你的${kind === 'first' ? '左' : '右'}手，${kind === 'first' ? '左' : '右'}手那一邊，最旁邊的那一個。`,
    params: { pos: kind, ...(kind === 'nth' ? { nth } : {}) },
  }
}

const PLACE_FORMS = [
  (s, p, w) => `把${nm(s)}放到${p}的${w}。`,
  (s, p, w) => `幫忙把${nm(s)}放在${p}的${w}。`,
  (s, p, w) => `請把${nm(s)}送到${p}的${w}。`,
]
const BETWEEN_FORMS = [(s, a, b) => `把${nm(s)}放到${a}和${b}的中間。`, (s, a, b) => `請把${nm(s)}放在${a}和${b}的中間。`]
const zoneList = (specs) => shuffle(specs).map((z, k) => ({ id: `z${k + 1}`, ...z }))
/** 放到某個位置：單一家具，位置是 rels 的每一個；target 是被問到的那個 */
function placeSingleQ(i, ctx, rels, anchorPool, phrase, subject) {
  const target = pick(rels)
  const anchor = pick(anchorPool.filter((a) => rels.every((r) => r !== 'inside' || INSIDE_PROPS.includes(a)) && (!needsFloat(rels) || UP_DOWN_PROPS.includes(a))))
  if (!anchor) reject()
  const zones = zoneList(rels.map((rel) => ({ rel, of: 0 })))
  const pn = PROP_NAME[anchor]
  return {
    type: 'place',
    interaction: 'place',
    prompt: variant(PLACE_FORMS, phrase)(subject, pn, REL_WORD[target]),
    items: [],
    choices: [],
    answer: 'sorted',
    hint: `${nm(subject)}要放在${pn}的${REL_WORD[target]}。${REL_HINT[target](pn)}`,
    params: { anchors: [anchor], subject, zones, target: zones.find((z) => z.rel === target).id, rel: target, of: 0 },
  }
}
/** 放到某個位置：兩個家具（上面、下面，難度 4 多一個「中間」） */
function placeDoubleQ(i, ctx, withBetween, phrase, subject) {
  const [pa, pb] = sample(UP_DOWN_PROPS, 2)
  const specs = [
    { rel: 'above', of: 0 },
    { rel: 'above', of: 1 },
    { rel: 'below', of: 0 },
    { rel: 'below', of: 1 },
    ...(withBetween ? [{ rel: 'between' }] : []),
  ]
  const zones = zoneList(specs)
  const target = pick(withBetween ? [...specs, { rel: 'between' }, { rel: 'between' }] : specs)
  const tz = zones.find((z) => z.rel === target.rel && z.of === target.of)
  const names = [PROP_NAME[pa], PROP_NAME[pb]]
  const prompt =
    target.rel === 'between'
      ? variant(BETWEEN_FORMS, phrase)(subject, names[0], names[1])
      : variant(PLACE_FORMS, phrase)(subject, names[target.of], REL_WORD[target.rel])
  return {
    type: 'place',
    interaction: 'place',
    prompt,
    items: [],
    choices: [],
    answer: 'sorted',
    hint:
      target.rel === 'between'
        ? `${nm(subject)}要放在${names[0]}和${names[1]}的中間。${REL_HINT.between()}`
        : `${nm(subject)}要放在${names[target.of]}的${REL_WORD[target.rel]}。${REL_HINT[target.rel](names[target.of])}`,
    params: { anchors: [pa, pb], subject, zones, target: tz.id, rel: target.rel, ...(target.of !== undefined ? { of: target.of } : {}) },
  }
}
const SPACE_CANDS = (n) => shuffle(SPACE_SUBJECTS.flatMap((s) => Array.from({ length: n }, (_, p) => [s, p])))
const ALL_PROPS = PROPS.map((p) => p.id)

const space1g = cell(
  'space',
  1,
  [
    { count: 18, cands: SPACE_CANDS(3), build: (i, ctx, [s, p]) => whereQ(i, ctx, 2, ['above', 'below'], ALL_PROPS, p, s) },
    { count: 18, cands: SPACE_CANDS(3), build: (i, ctx, [s, p]) => placeSingleQ(i, ctx, ['above', 'below'], ALL_PROPS, p, s) },
  ],
  { gentle: true, seed: 12 },
)
const space1 = cell(
  'space',
  1,
  [
    { count: 18, cands: SPACE_CANDS(3), build: (i, ctx, [s, p]) => whereQ(i, ctx, 3, ['above', 'below', 'inside'], INSIDE_PROPS, p, s) },
    { count: 18, cands: SPACE_CANDS(3), build: (i, ctx, [s, p]) => placeSingleQ(i, ctx, ['above', 'below', 'inside'], INSIDE_PROPS, p, s) },
  ],
  { seed: 12 },
)
const space2 = cell(
  'space',
  2,
  [
    { count: 14, cands: SPACE_CANDS(2), build: (i, ctx, [s, p]) => whereIsQ(i, ctx, REL_PAIRS.d2, INSIDE_PROPS, p, s) },
    { count: 12, cands: SPACE_CANDS(2), build: (i, ctx, [s, p]) => whereQ(i, ctx, 3, ['above', 'below', 'inside', 'outside'], INSIDE_PROPS, p, s) },
    { count: 14, cands: SPACE_CANDS(2), build: (i, ctx, [s, p]) => placeDoubleQ(i, ctx, false, p, s) },
  ],
  { seed: 12 },
)
const space3 = cell(
  'space',
  3,
  [
    { count: 10, cands: SPACE_CANDS(2), build: (i, ctx, [s, p]) => whereIsQ(i, ctx, REL_PAIRS.d3, ALL_PROPS, p, s) },
    { count: 10, cands: SPACE_CANDS(2), build: (i, ctx, [s, p]) => whereQ(i, ctx, 3, ['above', 'below', 'left', 'right'], ALL_PROPS, p, s) },
    { count: 16, cands: SPACE_CANDS(3), build: (i, ctx, [s, p]) => placeSingleQ(i, ctx, ['above', 'below', 'left', 'right'], ALL_PROPS, p, s) },
  ],
  { seed: 12 },
)
const space4 = cell(
  'space',
  4,
  [
    { count: 6, build: (i, ctx) => rowQ(i, ctx, 3, 'middle', 0, i) },
    { count: 4, build: (i, ctx) => rowQ(i, ctx, 3, 'first', 0, i) },
    { count: 4, build: (i, ctx) => rowQ(i, ctx, 3, 'last', 0, i) },
    { count: 6, build: (i, ctx) => rowQ(i, ctx, 4, 'nth', 2 + (i % 3), i) },
    { count: 8, build: (i, ctx) => whereIs2Q(i, ctx, i) },
    { count: 14, cands: SPACE_CANDS(2), build: (i, ctx, [s, p]) => placeDoubleQ(i, ctx, true, p, s) },
  ],
  { seed: 12 },
)

// ---------- v6 第 2 章：觀察與記憶 ----------
const MEMORY_OBJS = IDS.filter((id) => !MULTI.has(id))
const FLIP_FORMS = ['翻開牌，找出一樣的兩張。', '玩玩記憶翻牌，把一樣的找出來。', '記住牌的樣子，把一樣的兩張找出來。']
function flipQ(i, ctx, cols, rows, phrase) {
  const pairs = (cols * rows) / 2
  const objs = sample(MEMORY_OBJS, pairs)
  const faces = shuffle([...objs, ...objs])
  return {
    type: 'flip',
    interaction: 'flip',
    prompt: variant(FLIP_FORMS, phrase),
    items: faces.map((obj) => ({ obj })),
    choices: [],
    answer: 'matched',
    hint: '先翻開一張，再翻開另一張，記住它們在哪裡。一樣的兩張，就會留下來。',
    params: { cols, rows },
  }
}
const RECALL_FORMS = [
  ['剛剛出現的是哪一個？', '剛剛有哪一個出現過？', '請你想一想，剛剛看到的是哪一個？'],
  ['剛剛有出現過的，是哪一個？', '想一想，剛剛看到了哪一個？', '剛剛出現過的東西，是哪一個？'],
]
function recallQ(i, ctx, shown, k, flash, phrase) {
  const objs = sample(MEMORY_OBJS, shown + k - 1)
  const items = objs.slice(0, shown)
  const answer = items[Math.floor(rnd() * shown)]
  const wrong = objs.slice(shown) // 沒出現過的干擾項
  const pos = ctx.pos(k)
  return {
    type: 'recall',
    prompt: variant(RECALL_FORMS[shown > 1 ? 1 : 0], phrase),
    items: items.map((obj) => ({ obj })),
    choices: objChoices(answer, wrong, pos, ctx),
    answer,
    hint: `再看一次，剛剛出現的有${items.map(nm).join('、')}。找找看，哪一個是剛剛出現過的？`,
    params: { flash },
  }
}
const GONE_FORMS = ['剛剛什麼不見了？', '哪一個不見了？', '少了哪一個？']
function goneQ(i, ctx, n, k, flash, phrase) {
  const objs = sample(MEMORY_OBJS, n + k - 1)
  const items = objs.slice(0, n)
  const goneAt = Math.floor(rnd() * n)
  const answer = items[goneAt]
  const pos = ctx.pos(k)
  return {
    type: 'gone',
    prompt: variant(GONE_FORMS, phrase),
    items: items.map((obj) => ({ obj })),
    choices: objChoices(answer, objs.slice(n), pos, ctx),
    answer,
    hint: `剛剛有${items.map(nm).join('、')}。現在少了哪一個呢？`,
    params: { flash, goneAt },
  }
}
const SPOT_FORMS = {
  color: ['哪一個顏色不一樣？', '找找看，哪一個的顏色不一樣？'],
  gray: ['哪一個變成灰色的？', '找找看，哪一個是灰色的？'],
  flip180: ['哪一個是倒過來的？', '找找看，哪一個頭朝下？'],
  turn90: ['哪一個轉了方向、躺下來了？', '找找看，哪一個轉了方向？'],
  tilt: ['哪一個歪歪的？', '找找看，哪一個歪了一點點？'],
}
function spotQ(i, ctx, k, kind, value, phrase, obj) {
  const variantOf = kind === 'color' ? { hue: value } : kind === 'gray' ? { gray: true } : { rot: value }
  const pos = ctx.pos(k)
  ctx.mark(k, pos)
  const choices = Array.from({ length: k }, (_, n) => ({ id: `c${n + 1}`, obj, ...(n === pos ? { variant: variantOf } : {}) }))
  return {
    type: 'spot',
    prompt: variant(SPOT_FORMS[kind === 'color' ? 'color' : kind === 'gray' ? 'gray' : value === 180 ? 'flip180' : Math.abs(value) === 90 ? 'turn90' : 'tilt'], phrase),
    items: [],
    choices,
    answer: `c${pos + 1}`,
    hint: kind === 'color' || kind === 'gray' ? `大家都是${nm(obj)}，一個一個比一比，找出顏色不一樣的那一個。` : `大家都是${nm(obj)}，一個一個比一比，找出方向不一樣的那一個。`,
    params: {},
  }
}
const SPOT_OBJS = MEMORY_OBJS.filter((id) => !['obj-star', 'obj-shell', 'obj-flower'].includes(id)) // 看得出方向的物件
const spotCands = (kinds, objs = SPOT_OBJS) => shuffle(kinds.flatMap(([kind, value]) => objs.flatMap((o) => [0, 1].map((p) => [kind, value, p, o]))))

const observe1g = cell(
  'observe',
  1,
  [
    { count: 14, build: (i, ctx) => flipQ(i, ctx, 2, 2, i) },
    { count: 12, build: (i, ctx) => recallQ(i, ctx, 1, 2, 3000, i) },
    { count: 10, cands: spotCands([['color', 150], ['color', 200], ['gray', 0]]), build: (i, ctx, [kind, v, p, o]) => spotQ(i, ctx, 3, kind, v, p, o) },
  ],
  { gentle: true, seed: 13 },
)
const observe1 = cell(
  'observe',
  1,
  [
    { count: 12, build: (i, ctx) => flipQ(i, ctx, 2, 2, i) },
    { count: 12, build: (i, ctx) => recallQ(i, ctx, 1, 3, 2400, i) },
    { count: 14, cands: spotCands([['color', 150], ['color', 200], ['gray', 0]]), build: (i, ctx, [kind, v, p, o]) => spotQ(i, ctx, 3, kind, v, p, o) },
  ],
  { seed: 13 },
)
const observe2 = cell(
  'observe',
  2,
  [
    { count: 10, build: (i, ctx) => flipQ(i, ctx, 3, 2, i) },
    { count: 12, build: (i, ctx) => recallQ(i, ctx, 2, 3, 3000, i) },
    { count: 14, cands: spotCands([['rot', 180]]), build: (i, ctx, [kind, v, p, o]) => spotQ(i, ctx, 4, kind, v, p, o) },
  ],
  { seed: 13 },
)
const observe3 = cell(
  'observe',
  3,
  [
    { count: 10, build: (i, ctx) => flipQ(i, ctx, 4, 2, i) },
    { count: 14, build: (i, ctx) => goneQ(i, ctx, 3, 3, 3500, i) },
    { count: 12, cands: spotCands([['color', 60], ['rot', 90], ['rot', -90]]), build: (i, ctx, [kind, v, p, o]) => spotQ(i, ctx, 4 + (i % 2), kind, v, p, o) },
  ],
  { seed: 13 },
)
const observe4 = cell(
  'observe',
  4,
  [
    { count: 12, build: (i, ctx) => flipQ(i, ctx, 4, 3, i) },
    { count: 12, build: (i, ctx) => goneQ(i, ctx, 4, 4, 4000, i) },
    { count: 14, cands: spotCands([['color', 35], ['color', -35], ['rot', 35], ['rot', -35]]), build: (i, ctx, [kind, v, p, o]) => spotQ(i, ctx, 5 + (i % 2), kind, v, p, o) },
  ],
  { seed: 13 },
)

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
dump('measure', [measure1, measure2, measure3, measure4, measure1g])
dump('space', [space1, space2, space3, space4, space1g])
dump('observe', [observe1, observe2, observe3, observe4, observe1g])
dump('english', [english1, english2, english3, english4, english1g])
dump('life', [life1, life2, life3, life4, life1g])
dump('nature', [nature1, nature2, nature3, nature4, nature1g])
