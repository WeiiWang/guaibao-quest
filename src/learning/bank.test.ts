import { describe, expect, it } from 'vitest'
import { QUESTIONS, getQuestion, isGentleOk, questionsFor } from './bank'
import { CATEGORY_NAMES, COLOR_WORDS, getObject, mustObject, OBJECTS, type LearnObject } from './objects'
import { DIFFICULTIES, SKILLS, type Question } from './types'

type ObjOf = (id: string | undefined) => LearnObject

const defaultObj: ObjOf = (id) => mustObject(id as string)

/** 顏色家族：粉橘和粉看起來很像，視為同一種 */
const fam = (c: string) => (c === '粉橘' ? '粉' : c)
const hasColor = (o: LearnObject, c: string) => fam(o.color) === fam(c) || (o.alsoColors ?? []).some((x) => fam(x) === fam(c))
const COLOR_BY_LEN = Object.entries(COLOR_WORDS).sort((a, b) => b[1].length - a[1].length)
/** 從題目文字找出顏色（「粉紅色」要先於「紅色」比對） */
const colorIn = (text: string) => COLOR_BY_LEN.find(([, w]) => text.includes(w))?.[0]
const categoryIn = (text: string) => Object.entries(CATEGORY_NAMES).find(([, zh]) => text.includes(zh))?.[0]

/** 一排序列是否「至少兩輪」都呈現固定週期（任一週期 p，2 <= p <= 長度/2） */
function periodic(seq: string[]): boolean {
  for (let p = 2; p <= seq.length / 2; p++) if (seq.every((v, i) => i < p || v === seq[i - p])) return true
  return false
}

/** 把每個選項填進空格，哪些選項會讓序列「依某個屬性」呈現固定週期 */
function fits(q: Question, attr: (o: LearnObject) => string | undefined, obj: ObjOf): string[] {
  const blank = q.items.findIndex((i) => i.obj === null)
  return q.choices
    .filter((c) => {
      const seq = q.items.map((it, i) => (i === blank ? attr(obj(c.obj)) : it.obj ? attr(obj(it.obj)) : undefined))
      return !seq.includes(undefined) && periodic(seq as string[])
    })
    .map((c) => c.id)
}

/** 獨立的解題邏輯：不看 answer 欄位，從題幹算出正解，再和題庫的 answer 比對 */
export function solve(q: Question, obj: ObjOf = defaultObj): string[] {
  switch (q.type) {
    case 'count':
      return [String(q.items[0].count)]
    case 'give':
      return [String(q.params?.n)]
    case 'compare': {
      const [a, b] = q.choices
      return [(a.count as number) > (b.count as number) ? a.id : b.id]
    }
    case 'diff':
      return [String((q.items[0].count as number) - (q.items[1].count as number))]
    case 'add':
      return [String(q.items.reduce((n, it) => n + (it.count as number), 0))]
    case 'seqnum': {
      const labels = q.items.map((i) => (i.label == null ? null : Number(i.label)))
      const blank = labels.indexOf(null)
      const known = labels.map((v, i) => [v, i] as const).filter(([v]) => v !== null) as [number, number][]
      const step = (known[1][0] - known[0][0]) / (known[1][1] - known[0][1])
      expect(Math.abs(step), q.id).toBe(1)
      const want = known[0][0] + step * (blank - known[0][1])
      return q.choices.filter((c) => Number(c.label) === want).map((c) => c.id)
    }
    case 'grow': {
      const counts = q.items.filter((i) => i.obj !== null).map((i) => i.count as number)
      const step = counts[1] - counts[0]
      expect(counts.every((v, i) => v === counts[0] + step * i), q.id).toBe(true)
      return q.choices.filter((c) => Number(c.label) === counts[counts.length - 1] + step).map((c) => c.id)
    }
    case 'kind': {
      const target = categoryIn(q.prompt)
      return q.choices.filter((c) => obj(c.obj).category === target).map((c) => c.id)
    }
    case 'same': {
      const ex = obj(q.items[0].obj as string)
      if (q.prompt.includes('顏色')) return q.choices.filter((c) => fam(obj(c.obj).color) === fam(ex.color)).map((c) => c.id)
      return q.choices.filter((c) => obj(c.obj).category === ex.category).map((c) => c.id)
    }
    case 'color': {
      const color = colorIn(q.prompt) as string
      return q.choices.filter((c) => fam(obj(c.obj).color) === fam(color)).map((c) => c.id)
    }
    case 'dual': {
      const color = colorIn(q.prompt) as string
      const cat = categoryIn(q.prompt)
      return q.choices.filter((c) => obj(c.obj).category === cat && fam(obj(c.obj).color) === fam(color)).map((c) => c.id)
    }
    case 'odd': {
      const cats = q.choices.map((c) => obj(c.obj).category)
      return q.choices.filter((_, i) => cats[i] !== undefined && cats.filter((x) => x === cats[i]).length === 1).map((c) => c.id)
    }
    case 'attr': {
      const by = q.prompt.includes('顏色') ? 'color' : 'category'
      return fits(q, (o) => (by === 'color' ? fam(o.color) : o.category), obj)
    }
    case 'next':
    case 'missing': {
      // 把每個選項填進空格，只有一個能讓整個序列呈現固定週期（物件本身）
      const blank = q.items.findIndex((i) => i.obj === null)
      return q.choices
        .filter((c) => {
          const seq = q.items.map((it, i) => (i === blank ? c.id : (it.obj as string)))
          return periodic(seq)
        })
        .map((c) => c.id)
    }
    case 'bins': {
      // 每個東西依籃子的標籤（種類名或顏色）算出該放哪個籃子，必須和題庫的 targets 一致，而且恰好一個籃子對得上
      const bins = q.params!.bins!
      const ok = q.items.every((it, i) => {
        const o = obj(it.obj as string)
        const hit = bins.filter((b) => (b.swatch ? colorIn(b.label) === fam(o.color) : b.label === (o.category ? CATEGORY_NAMES[o.category] : '')))
        return hit.length === 1 && hit[0].id === q.params!.targets![i]
      })
      return ok ? ['sorted'] : []
    }
  }
}

/**
 * 多屬性檢查：回傳「孩子可能用別的屬性選到另一個答案」的問題清單（空 = 沒問題）。
 * 一個題目除了題目問的屬性（種類或顏色）只能有一個答案，用另一個屬性（顏色或種類）也不能讓別的選項顯得更合理。
 * 例如：桃子、貝殼、花、星星找不同類，答案是桃子，但三個粉色一個黃色，孩子用顏色會選星星。
 */
export function ambiguities(q: Question, obj: ObjOf = defaultObj): string[] {
  const out: string[] = []
  const objs = [...q.choices.map((c) => c.obj), ...q.items.map((i) => i.obj)].filter(Boolean) as string[]
  const all = objs.map(obj)
  const isCls = ['kind', 'same', 'odd', 'dual', 'color', 'attr', 'bins'].includes(q.type)
  // 孩子可能歸到另一類的物件（恐龍是玩具、也像動物），不能和那一類同時出現
  if (isCls)
    for (const a of all)
      for (const c of a.confusableWith ?? []) if (all.some((b) => b.id !== a.id && b.category === c)) out.push(`${a.name} 可能被當成${CATEGORY_NAMES[c]}`)
  const ch = q.choices.map((c) => ({ id: c.id, o: c.obj ? obj(c.obj) : undefined }))
  const others = ch.filter((c) => c.id !== q.answer)
  switch (q.type) {
    case 'odd': {
      const groups: Record<string, string[]> = {}
      for (const c of ch) (groups[fam(c.o!.color)] ??= []).push(c.id)
      const sizes = Object.values(groups).map((g) => g.length).sort().join()
      if (sizes === '2,2') out.push('顏色 2:2 分群')
      if (sizes === '1,3') {
        const lone = Object.values(groups).find((g) => g.length === 1)![0]
        if (lone !== q.answer) out.push(`用顏色會選到 ${lone}（顏色唯一的離群者）`)
      }
      break
    }
    case 'same': {
      const ex = obj(q.items[0].obj as string)
      if (q.prompt.includes('顏色')) {
        // 找同色：不能有別的選項和範例同種類
        for (const c of others) if (ex.category && c.o!.category === ex.category) out.push(`${c.id} 和範例同種類`)
        for (const c of others) if (hasColor(c.o!, ex.color)) out.push(`${c.id} 也帶有${ex.color}色`)
      } else {
        // 找同類：不能有別的選項和範例同顏色
        for (const c of others) if (hasColor(c.o!, ex.color) || (ex.alsoColors ?? []).some((x) => hasColor(c.o!, x))) out.push(`${c.id} 和範例同顏色`)
      }
      break
    }
    case 'color': {
      const color = colorIn(q.prompt) as string
      for (const c of others) if (hasColor(c.o!, color)) out.push(`${c.id} 也帶有${color}色`)
      for (const c of ch) if (c.o!.color === '彩虹') out.push('多色物件不當顏色題選項')
      break
    }
    case 'dual': {
      const color = colorIn(q.prompt) as string
      const cat = categoryIn(q.prompt)
      for (const c of others) if (c.o!.category === cat && hasColor(c.o!, color)) out.push(`${c.id} 也是${color}色的${cat}`)
      break
    }
    case 'bins': {
      const bins = q.params!.bins!
      const used = new Set(q.items.map((i) => i.obj))
      // 籃子上的代表圖不能是要分類的東西；每個籃子都要有東西；不同籃子的東西不同色（不然孩子會用顏色分）
      for (const b of bins) if (b.obj && used.has(b.obj)) out.push(`籃子代表圖 ${b.obj} 也在要分類的東西裡`)
      for (const b of bins) if (!q.params!.targets!.includes(b.id)) out.push(`籃子 ${b.id} 是空的`)
      if (!bins.some((b) => b.swatch)) {
        const byBin: Record<string, Set<string>> = {}
        q.items.forEach((it, i) => (byBin[q.params!.targets![i]] ??= new Set()).add(fam(obj(it.obj as string).color)))
        const bs = Object.values(byBin)
        for (let a = 0; a < bs.length; a++) for (let b = a + 1; b < bs.length; b++) if ([...bs[a]].some((c) => bs[b].has(c))) out.push('不同籃子的東西同色')
      }
      break
    }
    case 'attr': {
      // 題目問顏色就檢查種類與物件本身，反之亦然：這些屬性不能讓別的選項也呈現週期
      const by = q.prompt.includes('顏色') ? 'color' : 'category'
      const other = fits(q, (o) => (by === 'color' ? o.category : fam(o.color)), obj)
      for (const id of other) if (id !== q.answer) out.push(`${id} 在另一個屬性上也成立`)
      for (const id of fits(q, (o) => o.id, obj)) if (id !== q.answer) out.push(`${id} 在物件本身上也成立`)
      break
    }
    default:
  }
  return out
}

const cellOf = (q: Question) => `${q.skill}-${q.difficulty}${q.gentle ? 'g' : ''}`
const standard = QUESTIONS.filter((q) => !q.gentle)
const gentle = QUESTIONS.filter((q) => q.gentle)

describe('題庫完整性', () => {
  it('三技能 × 四難度，每格 >= 36 題；幼幼專用題每技能 >= 16 題', () => {
    for (const s of SKILLS) for (const d of DIFFICULTIES) expect(questionsFor(s, d).length, `${s}-${d}`).toBeGreaterThanOrEqual(36)
    for (const s of SKILLS) expect(gentle.filter((q) => q.skill === s).length, `${s} gentle`).toBeGreaterThanOrEqual(16)
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(432)
  })
  it('id 不重複、可由 id 取回', () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length)
    expect(getQuestion(QUESTIONS[0].id)).toBe(QUESTIONS[0])
    expect(getQuestion('nope')).toBeUndefined()
  })
  it('欄位齊全、答案在選項內、選項 id 不重複、引用的物件存在', () => {
    for (const q of QUESTIONS) {
      const tag = q.id
      expect(q.prompt.length, tag).toBeGreaterThan(3)
      expect(q.hint.length, tag).toBeGreaterThan(3)
      expect(q.version, tag).toBeGreaterThanOrEqual(1)
      expect(q.id.startsWith(`${q.skill}-${q.difficulty}-`), tag).toBe(true)
      if (q.type === 'bins') expect(q.items.length, tag).toBeGreaterThan(0)
      const ids = q.choices.map((c) => c.id)
      expect(new Set(ids).size, tag).toBe(ids.length)
      if (q.interaction === 'tapN' || q.interaction === 'dragSort') expect(q.choices.length, tag).toBe(0)
      else {
        expect(q.choices.length, tag).toBeGreaterThanOrEqual(2)
        expect(ids, tag).toContain(q.answer)
      }
      for (const c of q.choices) if (c.obj) expect(getObject(c.obj), `${tag} ${c.obj}`).toBeDefined()
      for (const it of q.items) if (it.obj) expect(getObject(it.obj), `${tag} ${it.obj}`).toBeDefined()
    }
  })
  it('每題恰好一個正解，且與獨立解題邏輯一致', () => {
    for (const q of QUESTIONS) {
      if (q.interaction === 'tapN' || q.interaction === 'dragSort') {
        expect(solve(q), q.id).toEqual([q.answer])
      } else expect(solve(q), q.id).toEqual([q.answer])
    }
  })
  it('多屬性檢查：顏色和種類都只有一個合理答案（沒有第二個說得通的選擇）', () => {
    const bad = QUESTIONS.map((q) => [q.id, ambiguities(q)] as const).filter(([, a]) => a.length)
    expect(bad, JSON.stringify(bad)).toEqual([])
  })
  it('多屬性檢查抓得到舊題庫的 classify-3-14（桃子、貝殼、花、星星找不同類）', () => {
    // 舊版物件表：花、貝殼、星星是「大自然」。三個粉色系、一個黃色，孩子用顏色會選星星
    const old: Record<string, LearnObject> = {
      'obj-peach': { id: 'obj-peach', name: '桃子', unit: '顆', category: 'fruit', color: '粉' },
      'obj-shell': { id: 'obj-shell', name: '貝殼', unit: '個', category: 'toy', color: '粉橘' },
      'obj-flower': { id: 'obj-flower', name: '花', unit: '朵', category: 'toy', color: '粉' },
      'obj-star': { id: 'obj-star', name: '星星', unit: '顆', category: 'toy', color: '黃' },
    }
    const oldQ: Question = {
      id: 'classify-3-14',
      skill: 'classify',
      difficulty: 3,
      type: 'odd',
      prompt: '哪一個跟別的不一樣？',
      items: [],
      choices: ['obj-peach', 'obj-shell', 'obj-flower', 'obj-star'].map((id) => ({ id, obj: id })),
      answer: 'obj-peach',
      hint: 'x',
      version: 1,
    }
    expect(solve(oldQ, (id) => old[id as string])).toEqual(['obj-peach']) // 光看種類，答案確實唯一
    expect(ambiguities(oldQ, (id) => old[id as string]).join('；')).toContain('obj-star')
  })
  it('第三類別用交通工具與玩具，物件屬性齊全；花、貝殼、星星沒有種類', () => {
    expect(OBJECTS.map((o) => o.id).sort()).toEqual(
      [
        'decor-ball', 'decor-car', 'decor-dino', 'decor-piano', 'decor-rocket',
        'obj-apple', 'obj-banana', 'obj-chick', 'obj-fish', 'obj-flower', 'obj-grape', 'obj-peach', 'obj-rabbit', 'obj-shell', 'obj-star',
      ].sort(),
    )
    expect(OBJECTS.filter((o) => !o.category).map((o) => o.id).sort()).toEqual(['obj-flower', 'obj-shell', 'obj-star'])
    expect(OBJECTS.filter((o) => o.category === 'vehicle').map((o) => o.id).sort()).toEqual(['decor-car', 'decor-rocket'])
    expect(OBJECTS.filter((o) => o.category === 'toy').map((o) => o.id).sort()).toEqual(['decor-ball', 'decor-dino', 'decor-piano'])
    expect(JSON.stringify(QUESTIONS)).not.toContain('大自然')
  })
  it('用字：粉紅色（不是粉色）、空格（不是問號）、小兔子、比多少不用左邊右邊', () => {
    const text = QUESTIONS.map((q) => `${q.prompt} ${q.hint}`).join('\n')
    expect(text).not.toMatch(/粉色|問號|小兔[^子]|左邊|右邊/)
    expect(QUESTIONS.some((q) => q.prompt.includes('粉紅色'))).toBe(true)
  })
  it('題幹 + 答案不重複（找不同的題幹就是那四個物件）；同一格每種題型至少 2 種句型', () => {
    const key = (q: Question) =>
      JSON.stringify([q.type, q.prompt, q.items, q.answer, q.type === 'odd' ? q.choices.map((c) => c.id).sort() : null, q.params?.n ?? null])
    for (const cellId of new Set(QUESTIONS.map(cellOf))) {
      const qs = QUESTIONS.filter((q) => cellOf(q) === cellId)
      expect(new Set(qs.map(key)).size, cellId).toBe(qs.length)
      for (const type of new Set(qs.map((q) => q.type))) {
        const mine = qs.filter((q) => q.type === type)
        if (mine.length >= 8) expect(new Set(mine.map((q) => q.prompt.replace(/[一二兩三四五六七八九十\d]+/g, '#').replace(new RegExp(OBJECTS.map((o) => o.name).join('|'), 'g'), '○'))).size, `${cellId} ${type}`).toBeGreaterThanOrEqual(2)
      }
    }
  })
  it('每格用到 >= 6 種不同物件（不是一直同一批）', () => {
    for (const cellId of new Set(standard.map(cellOf))) {
      const used = new Set(standard.filter((q) => cellOf(q) === cellId).flatMap((q) => [...q.choices.map((c) => c.obj), ...q.items.map((i) => i.obj), q.params?.obj]).filter(Boolean))
      expect(used.size, cellId).toBeGreaterThanOrEqual(6)
    }
  })
})

describe('答案位置平均', () => {
  it('每格每種選項數：答案落在各個位置的比例都不偏（沒有「永遠點右邊」）', () => {
    for (const cellId of new Set(QUESTIONS.map(cellOf))) {
      const qs = QUESTIONS.filter((q) => cellOf(q) === cellId && q.choices.length >= 2)
      for (const k of [2, 3, 4]) {
        const mine = qs.filter((q) => q.choices.length === k)
        if (mine.length < 12) continue
        const pos = Array(k).fill(0)
        for (const q of mine) pos[q.choices.findIndex((c) => c.id === q.answer)]++
        // 每個位置至少佔 1/k 的六成（數字選項因為「最小的數答案不可能在最後」會受限，容忍度放寬）
        const floor = Math.floor((mine.length / k) * 0.6)
        expect(Math.min(...pos), `${cellId} k=${k} ${pos}`).toBeGreaterThanOrEqual(floor)
        expect(Math.max(...pos), `${cellId} k=${k} ${pos}`).toBeLessThanOrEqual(Math.ceil((mine.length / k) * 1.5))
      }
    }
  })
  it('數字選項一律由小到大；難度 1 的數數題選項不會出現 6（畫面上最多 5 個）', () => {
    for (const q of QUESTIONS) {
      const nums = q.choices.filter((c) => c.label !== undefined).map((c) => Number(c.label))
      if (nums.length) expect(nums, q.id).toEqual([...nums].sort((a, b) => a - b))
    }
    for (const q of questionsFor('number', 1).filter((x) => x.type === 'count')) expect(Math.max(...q.choices.map((c) => Number(c.label))), q.id).toBeLessThanOrEqual(5)
  })
})

describe('各難度符合規格範圍', () => {
  const of = (s: (typeof SKILLS)[number], d: (typeof DIFFICULTIES)[number]) => questionsFor(s, d)
  it('數感 1：數 1–5、拿 1–5；2：數 6–10、比較（比例 <= 0.67）、拿 6–10；3：11–20、比較、多幾個；4：10 以內加法與數序', () => {
    for (const q of of('number', 1)) {
      expect(['count', 'give']).toContain(q.type)
      expect(Number(q.answer)).toBeGreaterThanOrEqual(1)
      expect(Number(q.answer)).toBeLessThanOrEqual(5)
    }
    expect(of('number', 1).some((q) => q.type === 'give')).toBe(true)
    for (const q of of('number', 2)) {
      if (q.type === 'count' || q.type === 'give') {
        expect(Number(q.answer)).toBeGreaterThanOrEqual(6)
        expect(Number(q.answer)).toBeLessThanOrEqual(10)
      } else {
        expect(q.type).toBe('compare')
        const [a, b] = q.choices.map((c) => c.count as number)
        expect(Math.min(a, b) / Math.max(a, b), q.id).toBeLessThanOrEqual(0.67)
      }
    }
    for (const q of of('number', 3)) {
      if (q.type === 'count') {
        expect(Number(q.answer)).toBeGreaterThanOrEqual(11)
        expect(Number(q.answer)).toBeLessThanOrEqual(20)
      } else if (q.type === 'compare') {
        const [a, b] = q.choices.map((c) => c.count as number)
        expect(Math.abs(a - b)).toBeLessThanOrEqual(3)
        expect(Math.max(a, b)).toBeLessThanOrEqual(20)
      } else {
        expect(q.type).toBe('diff')
        expect(Number(q.answer)).toBeLessThanOrEqual(3)
        expect(Number(q.answer)).toBeGreaterThanOrEqual(1)
      }
    }
    const d3diff = of('number', 3).filter((q) => q.type === 'diff')
    for (const a of [1, 2, 3]) expect(d3diff.filter((q) => q.answer === String(a)).length, `diff 答案 ${a}`).toBeGreaterThanOrEqual(3)
    for (const q of of('number', 4)) {
      expect(['add', 'seqnum']).toContain(q.type)
      if (q.type === 'add') expect(Number(q.answer)).toBeLessThanOrEqual(10)
    }
    expect(of('number', 4).some((q) => q.type === 'add')).toBe(true)
    expect(of('number', 4).some((q) => q.type === 'seqnum')).toBe(true)
  })
  it('分類 1：3 選 1 的種類/同一類；2：顏色、同色、種類；3：找不同類；4：雙屬性', () => {
    for (const q of of('classify', 1)) {
      expect(['kind', 'same']).toContain(q.type)
      expect(q.choices).toHaveLength(3)
      expect(q.interaction ?? 'pick').toBe('pick')
    }
    for (const q of of('classify', 2).filter((x) => x.type !== 'bins')) {
      expect(['color', 'kind', 'same']).toContain(q.type)
      expect(q.choices).toHaveLength(3)
    }
    expect(of('classify', 2).some((q) => q.type === 'color')).toBe(true)
    for (const q of of('classify', 3).filter((x) => x.type !== 'bins')) {
      expect(q.type).toBe('odd')
      expect(q.choices).toHaveLength(4)
    }
    // 拖曳歸類：難度 2 有 2 個籃子、難度 3 有 2–3 個籃子，都是 dragSort 互動
    for (const q of of('classify', 2).filter((x) => x.type === 'bins')) expect(q.params!.bins).toHaveLength(2)
    for (const q of of('classify', 3).filter((x) => x.type === 'bins')) expect([2, 3]).toContain(q.params!.bins!.length)
    for (const d of [2, 3] as const) {
      const bins = of('classify', d).filter((x) => x.type === 'bins')
      expect(bins.length, `d${d} bins`).toBeGreaterThanOrEqual(8)
      for (const q of bins) {
        expect(q.interaction).toBe('dragSort')
        expect(q.items.length).toBeGreaterThanOrEqual(4)
        expect(q.items.length).toBeLessThanOrEqual(6)
      }
    }
    expect(of('classify', 3).some((x) => x.type === 'bins' && x.params!.bins!.some((b) => b.swatch))).toBe(true)
    for (const q of of('classify', 4)) expect(q.type).toBe('dual')
    // 找不同類：三個同類物件，各類別都出現過（不是永遠同一類）
    const majors = new Set(of('classify', 3).map((q) => q.params?.groupName))
    expect(majors.size).toBeGreaterThanOrEqual(3)
  })
  it('規律 1：AB；2：AAB/ABB 與 AB 補中間；3：ABC 展示 >= 2 輪、補中間；4：屬性與成長', () => {
    for (const q of of('pattern', 1)) {
      expect(q.type).toBe('next')
      expect(q.params?.core).toBe(2)
    }
    expect(of('pattern', 2).some((q) => q.type === 'missing')).toBe(true)
    for (const q of of('pattern', 3)) {
      expect(q.items.length).toBeGreaterThanOrEqual(7)
      expect(q.params?.core).toBe(3)
    }
    for (const q of of('pattern', 3).filter((x) => x.type === 'missing')) {
      const blank = q.items.findIndex((i) => i.obj === null)
      expect(blank).toBeGreaterThan(0)
      expect(blank).toBeLessThan(q.items.length - 1)
    }
    expect(new Set(of('pattern', 4).map((q) => q.type))).toEqual(new Set(['attr', 'grow']))
  })
  it('核心與提示用字：每個題幹格都有對應的字（空格是空字串）', () => {
    for (const q of QUESTIONS.filter((x) => x.params?.words)) expect(q.params!.words, q.id).toHaveLength(q.items.length)
  })
})

describe('幼幼模式（3 歲）的題', () => {
  it('幼幼專用題一律 2 選 1、難度 1、答案物件限定常見的那幾個（分類）', () => {
    for (const q of gentle) {
      expect(q.difficulty).toBe(1)
      expect(q.choices, q.id).toHaveLength(2)
    }
    const common = new Set(['obj-banana', 'obj-apple', 'obj-fish', 'obj-chick'])
    for (const q of gentle.filter((x) => x.skill === 'classify'))
      for (const c of [...q.choices, ...q.items]) expect(common.has(c.obj as string), q.id).toBe(true)
  })
  it('數感只出 1–3 個，一半是快閃辨識；規律只出 AB 且展示 3 輪', () => {
    const num = gentle.filter((q) => q.skill === 'number')
    for (const q of num) expect(Number(q.answer)).toBeLessThanOrEqual(3)
    expect(num.filter((q) => q.params?.flash).length).toBeGreaterThanOrEqual(8)
    for (const q of gentle.filter((x) => x.skill === 'pattern')) {
      expect(q.params?.core).toBe(2)
      expect(q.items.length).toBe(7) // 3 輪（6 個）+ 問題格
    }
  })
  it('幼幼模式的題庫：難度 1 夠用（一般題只取 1–3 個的數數與拿取）；一般模式不會抽到幼幼專用題', () => {
    for (const s of SKILLS) expect(questionsFor(s, 1, QUESTIONS, true).length, s).toBeGreaterThanOrEqual(16)
    for (const s of SKILLS) for (const d of DIFFICULTIES) expect(questionsFor(s, d).some((q) => q.gentle)).toBe(false)
    expect(QUESTIONS.filter(isGentleOk).every((q) => q.gentle || (q.skill === 'number' && Number(q.answer) <= 3))).toBe(true)
  })
})

describe('同一格內沒有重複的題面', () => {
  it('題幹 + 選項不重複', () => {
    for (const cellId of new Set(QUESTIONS.map(cellOf))) {
      const sigs = QUESTIONS.filter((q) => cellOf(q) === cellId).map((q) => JSON.stringify([q.prompt, q.items, q.choices.map((c) => `${c.id}:${c.count ?? ''}`).sort()]))
      expect(new Set(sigs).size, cellId).toBe(sigs.length)
    }
  })
})
