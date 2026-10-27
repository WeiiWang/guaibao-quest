import { describe, expect, it } from 'vitest'
import { QUESTIONS as ALL, getQuestion, isGentleOk, questionsFor } from './bank'
import { chapterCleared, chapterUnlocked, CHAPTERS, getChapter, HUAGUOSHAN, SHUILIANDONG } from './chapter'
import { allLines, questionLines, staticLineList } from './lines'
import { getObject } from './objects'
import { makeRng } from './rng'
import { displayQuestion, planStation, SKILL_OF_INTERACTION } from './select'
import { initialSkillState } from './skills'
import { anchorBoxes, getProp, mustProp, PROPS, REL_WORD, relationsAt, SCENE_H, SCENE_W, SUBJECT, subjectBox, zoneBox } from './space'
import { chaptersOf, resolveStage, skillsOfChapter, SUBJECTS, subjectOfChapter, subjectSkills } from './subject'
import { needsTutorial, tutorialQuestion } from './tutorial'
import { DIFFICULTIES, MATH2_SKILLS, MATH_ALL_SKILLS, MATH_SKILLS, SKILLS, type Choice, type Difficulty, type Question, type SkillId, type SkillState } from './types'
import { buildReport, LEVEL_LABEL } from './report'
import { TRICKS, earnedTricks } from '../domain/tricks'
import { planBehavior, TRICK_BEHAVIOR } from '../pet/plan'
import { makeRng as rng } from './rng'

/** 第 2 章（水簾洞）的三個新技能：比較與排序、空間方位、觀察與記憶 */
const QS = ALL.filter((q) => (MATH2_SKILLS as string[]).includes(q.skill))
const cellOf = (q: Question) => `${q.skill}-${q.difficulty}${q.gentle ? 'g' : ''}`
const CELLS = MATH2_SKILLS.flatMap((s) => [...DIFFICULTIES.map((d) => `${s}-${d}`), `${s}-1g`])
const inCell = (cell: string) => QS.filter((q) => cellOf(q) === cell)

/** 去掉物件名稱（「小魚」含「小」，會干擾找大小的字） */
const NAMES = (getObject('obj-fish') ? ['小魚', '小雞', '小兔子'] : []).concat(['香蕉', '桃子', '蘋果', '葡萄', '花', '貝殼', '星星', '汽車', '火箭', '皮球', '恐龍', '鋼琴'])
const stripNames = (text: string) => NAMES.reduce((t, n) => t.split(n).join('○'), text)
const REL_BY_WORD = Object.fromEntries(Object.entries(REL_WORD).map(([k, v]) => [v, k]))

describe('第 2 章題庫：數量與結構', () => {
  it('三個新技能 × 五格（幼幼、難度 1–4），每格 >= 36 題', () => {
    for (const cell of CELLS) expect(inCell(cell).length, cell).toBeGreaterThanOrEqual(36)
    for (const s of MATH2_SKILLS) {
      for (const d of DIFFICULTIES) expect(questionsFor(s, d).length, `${s}-${d}`).toBeGreaterThanOrEqual(36)
      expect(questionsFor(s, 1, ALL, true).length, `${s} gentle`).toBeGreaterThanOrEqual(36)
    }
  })
  it('id 不重複、前綴對得上技能與難度、可由 id 取回；全部題目 id 不和第 1 章撞', () => {
    expect(new Set(QS.map((q) => q.id)).size).toBe(QS.length)
    for (const q of QS) {
      expect(q.id.startsWith(`${q.skill}-${q.difficulty}-`), q.id).toBe(true)
      expect(getQuestion(q.id)).toBe(q)
    }
    expect(new Set(ALL.map((q) => q.id)).size).toBe(ALL.length)
  })
  it('欄位齊全：提示與題目夠長；選擇題答案在選項內；互動題沒有選項', () => {
    for (const q of QS) {
      expect(q.prompt.length, q.id).toBeGreaterThan(3)
      expect(q.hint.length, q.id).toBeGreaterThan(5)
      expect(q.version, q.id).toBeGreaterThanOrEqual(1)
      const it = q.interaction ?? 'pick'
      if (it === 'pick') {
        expect(q.choices.length, q.id).toBeGreaterThanOrEqual(2)
        expect(q.choices.map((c) => c.id), q.id).toContain(q.answer)
        expect(new Set(q.choices.map((c) => c.id)).size, q.id).toBe(q.choices.length)
      } else {
        expect(q.choices, q.id).toHaveLength(0)
        expect(q.answer, q.id).toBe(it === 'flip' ? 'matched' : 'sorted')
      }
    }
  })
  it('每個題型對應固定的技能與互動', () => {
    const want: Record<string, [SkillId, string]> = {
      bigger: ['measure', 'pick'],
      order: ['measure', 'dragOrder'],
      where: ['space', 'pick'],
      whereIs: ['space', 'pick'],
      row: ['space', 'pick'],
      place: ['space', 'place'],
      recall: ['observe', 'pick'],
      gone: ['observe', 'pick'],
      spot: ['observe', 'pick'],
      flip: ['observe', 'flip'],
    }
    for (const q of QS) expect([q.skill, q.interaction ?? 'pick'], `${q.id} ${q.type}`).toEqual(want[q.type])
    // 三種新互動都有題目，而且和 SKILL_OF_INTERACTION 一致
    for (const [it, skill] of [['dragOrder', 'measure'], ['place', 'space'], ['flip', 'observe']] as const) {
      expect(SKILL_OF_INTERACTION[it]).toBe(skill)
      for (const d of DIFFICULTIES) expect(QS.some((q) => q.interaction === it && q.difficulty === d && !q.gentle), `${it} d${d}`).toBe(true)
    }
  })
  it('題幹 + 選項 + 參數不重複；每格每種題型至少 2 種句型；每格用到 >= 6 種物件（幼幼除外）', () => {
    for (const cell of CELLS) {
      const qs = inCell(cell)
      const sig = qs.map((q) => JSON.stringify([q.type, q.prompt, q.items, q.choices, q.params]))
      expect(new Set(sig).size, cell).toBe(qs.length)
      for (const type of new Set(qs.map((q) => q.type))) {
        const mine = qs.filter((q) => q.type === type)
        if (mine.length >= 8) expect(new Set(mine.map((q) => stripNames(q.prompt))).size, `${cell} ${type}`).toBeGreaterThanOrEqual(2)
      }
    }
    for (const cell of CELLS.filter((c) => !c.endsWith('g'))) {
      const used = new Set(inCell(cell).flatMap((q) => [...q.choices.map((c) => c.obj ?? c.scene?.subject), ...q.items.map((i) => i.obj), q.params?.subject, ...(q.params?.anchors ?? [])]).filter(Boolean))
      expect(used.size, cell).toBeGreaterThanOrEqual(6)
    }
  })
  it('引用的物件與家具都存在；不用「問號」；選項上的字是位置詞', () => {
    for (const q of QS) {
      for (const c of q.choices) {
        if (c.obj) expect(getObject(c.obj), `${q.id} ${c.obj}`).toBeDefined()
        if (c.scene) {
          expect(getObject(c.scene.subject), q.id).toBeDefined()
          expect(getProp(c.scene.anchor), q.id).toBeDefined()
        }
        if (c.text) expect(Object.values(REL_WORD), q.id).toContain(c.text)
      }
      for (const i of q.items) if (i.obj) expect(getObject(i.obj), q.id).toBeDefined()
      if (q.params?.subject) expect(getObject(q.params.subject), q.id).toBeDefined()
      for (const a of q.params?.anchors ?? []) expect(getProp(a), q.id).toBeDefined()
      expect(`${q.prompt}${q.hint}`, q.id).not.toMatch(/問號/)
    }
  })
  it('左右只出現在難度 3 以上（6–7 歲才穩）；難度 1–2 的題目與提示完全沒有左邊、右邊', () => {
    for (const q of QS.filter((x) => x.difficulty <= 2)) expect(`${q.prompt}${q.hint}${JSON.stringify(q.params)}${JSON.stringify(q.choices)}`, q.id).not.toMatch(/左|右|left|right/)
    expect(QS.some((q) => q.difficulty === 3 && q.prompt.includes('左邊'))).toBe(true)
    expect(QS.some((q) => q.difficulty === 3 && q.prompt.includes('右邊'))).toBe(true)
  })
})

describe('比較與排序（measure）', () => {
  const measure = QS.filter((q) => q.skill === 'measure')
  /** 一個選項的「大小」：長短只看橫向，其餘看整體 */
  const sizeOf = (c: Choice) => c.scale as number
  const MIN_RATIO: Record<string, number> = { '1g': 2.0, '1': 1.4, '2': 1.3, '3': 1.18, '4': 1.12 }
  const ratioFloor = (q: Question) => MIN_RATIO[q.gentle ? '1g' : String(q.difficulty)]

  it('比大小：用同一個物件的不同縮放；唯一的最大（小）者就是答案，倍率差夠大', () => {
    for (const q of measure.filter((x) => x.type === 'bigger')) {
      const objs = new Set(q.choices.map((c) => c.obj))
      expect(objs.size, q.id).toBe(1)
      const dim = q.params!.dim!
      expect(q.choices.every((c) => c.dim === dim), q.id).toBe(true)
      const ask = q.params!.ask!
      const sorted = [...q.choices].sort((a, b) => sizeOf(a) - sizeOf(b))
      for (let i = 1; i < sorted.length; i++) expect(sizeOf(sorted[i]) / sizeOf(sorted[i - 1]), `${q.id} 倍率`).toBeGreaterThanOrEqual(ratioFloor(q) - 1e-9)
      const want = ask === 'max' ? sorted[sorted.length - 1] : sorted[0]
      expect(q.answer, q.id).toBe(want.id)
      // 題目的字和參數一致：大小高矮長短 + 最大/最小
      const text = stripNames(q.prompt)
      const [big, small] = { size: ['大', '小'], height: ['高', '矮'], length: ['長', '短'] }[dim]
      expect(text, q.id).toContain(ask === 'max' ? big : small)
      expect(text, q.id).not.toContain(ask === 'max' ? small : big)
      for (const c of q.choices) expect(sizeOf(c)).toBeGreaterThan(0.3)
    }
  })
  it('選項數隨難度：幼幼 2 個；難度 1 是 2–3 個；2 是 3 個；3 是 4 個；4 是 5 個', () => {
    const want: Record<string, number[]> = { '1g': [2], '1': [2, 3], '2': [3], '3': [4], '4': [5] }
    for (const q of measure.filter((x) => x.type === 'bigger')) expect(want[q.gentle ? '1g' : String(q.difficulty)], q.id).toContain(q.choices.length)
  })
  it('排序：items 是洗過牌的；order 是 0..n-1 的排列，照這個順序放，倍率嚴格遞增（遞減），方向和題目一致', () => {
    const orders = measure.filter((x) => x.type === 'order')
    expect(orders.length).toBeGreaterThanOrEqual(20)
    for (const q of orders) {
      const n = q.items.length
      const order = q.params!.itemOrder!
      expect([...order].sort((a, b) => a - b), q.id).toEqual([...Array(n).keys()])
      const scales = order.map((i) => q.items[i].scale as number)
      const asc = scales.every((v, k) => k === 0 || v > scales[k - 1])
      const desc = scales.every((v, k) => k === 0 || v < scales[k - 1])
      expect(asc || desc, q.id).toBe(true)
      expect(asc ? 'asc' : 'desc', q.id).toBe(q.params!.dir)
      // 題目的字
      const text = stripNames(q.prompt)
      const up = /排到大|排到高|排到長|最小的放最前|最矮的放最前|最短的放最前/.test(text)
      const down = /排到小|排到矮|排到短|最大的放最前|最高的放最前|最長的放最前/.test(text)
      expect(up !== down, q.id).toBe(true)
      expect(up ? 'asc' : 'desc', q.id).toBe(q.params!.dir)
      // 洗過牌：不是一開始就排好
      expect(order.some((v, k) => v !== k) || q.params!.dir === 'desc' || n === 0, q.id).toBe(true)
      expect(new Set(q.items.map((i) => i.obj)).size, q.id).toBe(1)
      // 倍率差
      const sorted = [...scales].sort((a, b) => a - b)
      for (let i = 1; i < n; i++) expect(sorted[i] / sorted[i - 1], `${q.id} 倍率`).toBeGreaterThanOrEqual(ratioFloor(q) - 1e-9)
    }
  })
  it('排序的個數隨難度：難度 1 是 3 個、2 是 3 個、3 是 4 個、4 是 5 個（3–5 個）；幼幼沒有排序', () => {
    const want: Record<number, number> = { 1: 3, 2: 3, 3: 4, 4: 5 }
    for (const q of measure.filter((x) => x.type === 'order')) {
      expect(q.gentle, q.id).toBeFalsy()
      expect(q.items.length, q.id).toBe(want[q.difficulty])
    }
    expect(measure.filter((x) => x.type === 'order' && x.difficulty === 1).length).toBeGreaterThanOrEqual(8)
  })
  it('三種比較方向（大小、高矮、長短）和兩個提問方向（大 / 小）每格都有', () => {
    for (const d of DIFFICULTIES) {
      const qs = measure.filter((x) => x.difficulty === d && !x.gentle)
      expect(new Set(qs.map((q) => q.params!.dim)), `d${d}`).toEqual(new Set(['size', 'height', 'length']))
    }
    const bigger = measure.filter((x) => x.type === 'bigger')
    expect(new Set(bigger.map((q) => q.params!.ask))).toEqual(new Set(['max', 'min']))
  })
})

describe('空間方位（space）', () => {
  const space = QS.filter((q) => q.skill === 'space')
  const relOf = (text: string): string[] => Object.entries(REL_WORD).filter(([, w]) => text.includes(w)).map(([k]) => k)

  it('哪一張圖（where）：恰好一張圖的位置和題目說的一樣；每張圖的位置都不同；用同一個家具與東西', () => {
    for (const q of space.filter((x) => x.type === 'where')) {
      const anchors = new Set(q.choices.map((c) => c.scene!.anchor))
      const subjects = new Set(q.choices.map((c) => c.scene!.subject))
      expect(anchors.size, q.id).toBe(1)
      expect(subjects.size, q.id).toBe(1)
      const asked = relOf(q.prompt)
      expect(asked, q.id).toHaveLength(1)
      const hit = q.choices.filter((c) => c.scene!.rel === asked[0])
      expect(hit.map((c) => c.id), q.id).toEqual([q.answer])
      expect(new Set(q.choices.map((c) => c.scene!.rel)).size, q.id).toBe(q.choices.length)
      const [prop] = [...anchors].map(mustProp)
      expect(q.prompt, q.id).toContain(prop.name)
      expect(q.prompt, q.id).toContain(getObject([...subjects][0])!.name)
      // 裡面只畫得出來的家具（箱子探頭、帳篷入口）；外面和左右不放在同一題
      if (q.choices.some((c) => c.scene!.rel === 'inside')) expect(prop.inside, q.id).toBeDefined()
      const rels = q.choices.map((c) => c.scene!.rel)
      if (rels.includes('outside')) expect(rels.includes('left') || rels.includes('right'), q.id).toBe(false)
    }
  })
  it('看場景選文字（whereIs）：場景裡的位置就是答案；兩個選項是題目裡的兩個詞', () => {
    for (const q of space.filter((x) => x.type === 'whereIs')) {
      const words = relOf(q.prompt)
      expect(words, q.id).toHaveLength(2)
      expect(q.choices.map((c) => c.id).sort(), q.id).toEqual([...words].sort())
      for (const c of q.choices) expect(c.text, q.id).toBe(REL_WORD[c.id as keyof typeof REL_WORD])
      if (q.params?.scene) {
        expect(q.params.scene.rel, q.id).toBe(q.answer)
        expect(q.prompt, q.id).toContain(mustProp(q.params.scene.anchor).name)
      } else {
        // 兩個東西排成一排：題目的第一個東西在第二個的左邊（排在前面）還是右邊
        expect(q.items, q.id).toHaveLength(2)
        const [first, second] = q.items.map((i) => getObject(i.obj as string)!.name)
        const m = q.prompt.match(/^(?:看一看，)?(.+?)(?:是排在|在)(.+?)的左邊/)!
        expect(m, q.id).not.toBeNull()
        expect([m[1], m[2]].sort(), q.id).toEqual([first, second].sort())
        // 題目的第一個東西排在前面（左邊）→ 答案是左邊，否則是右邊
        expect(q.answer, q.id).toBe(m[1] === first ? 'left' : 'right')
      }
    }
  })
  it('排隊的位置（row）：從 items 算出最中間、最左、最右、第幾個，和答案一致；選項就是排隊的那幾個', () => {
    const rows = space.filter((x) => x.type === 'row')
    expect(rows.length).toBeGreaterThanOrEqual(16)
    for (const q of rows) {
      const objs = q.items.map((i) => i.obj as string)
      expect(new Set(objs).size, q.id).toBe(objs.length)
      expect([...q.choices.map((c) => c.id)].sort(), q.id).toEqual([...objs].sort())
      let idx: number
      if (q.prompt.includes('最中間')) idx = (objs.length - 1) / 2
      else if (q.prompt.includes('最左邊')) idx = 0
      else if (q.prompt.includes('最右邊')) idx = objs.length - 1
      else idx = '一二三四'.indexOf(q.prompt.match(/第([一二三四])個/)![1])
      expect(Number.isInteger(idx), q.id).toBe(true)
      expect(objs[idx], q.id).toBe(q.answer)
    }
  })
  it('放到某個位置（place）：用座標重算，被問的位置只有一個答案；位置都在畫布裡、彼此不重疊', () => {
    const places = space.filter((x) => x.type === 'place')
    expect(places.length).toBeGreaterThanOrEqual(60)
    for (const q of places) {
      const p = q.params!
      const props = p.anchors!.map(mustProp)
      const boxes = anchorBoxes(p.anchors!)
      expect(boxes.length, q.id).toBe(p.anchors!.length)
      const zones = p.zones!
      expect(new Set(zones.map((z) => z.id)).size, q.id).toBe(zones.length)
      expect(new Set(zones.map((z) => `${z.rel}:${z.of ?? '-'}`)).size, q.id).toBe(zones.length)
      // 題目問的是哪個位置
      const asked = relOf(q.prompt)
      expect(asked, q.id).toEqual([p.rel])
      for (const pr of props.filter((x) => q.prompt.includes(x.name))) expect(pr).toBeDefined()
      const target = zones.find((z) => z.id === p.target)!
      expect(target, q.id).toBeDefined()
      expect(target.rel, q.id).toBe(p.rel)
      if (p.rel === 'between') {
        for (const pr of props) expect(q.prompt, q.id).toContain(pr.name)
        expect(boxes.length, q.id).toBe(2)
      } else expect(q.prompt, q.id).toContain(props[target.of ?? 0].name)
      // 獨立判斷：每個位置的中心點，相對於家具成立哪些關係；問的那個關係只有目標位置成立
      const holds = (z: (typeof zones)[number]) => {
        const c = zoneBox(z, boxes, props)
        return relationsAt({ x: c.x, y: c.y }, boxes).some((r) => r.rel === p.rel && (p.rel === 'between' || r.of === (p.of ?? 0)))
      }
      expect(zones.filter(holds).map((z) => z.id), `${q.id} 只有一個位置符合`).toEqual([p.target])
      // 東西放上去之後也要在畫布內
      for (const z of zones) {
        const s = z.rel === 'inside' ? zoneBox(z, boxes, props) : subjectBox(z.rel, boxes, z.of ?? 0, props[z.of ?? 0])
        expect(s.x - s.w / 2, `${q.id} ${z.id}`).toBeGreaterThanOrEqual(-0.01)
        expect(s.x + s.w / 2, `${q.id} ${z.id}`).toBeLessThanOrEqual(SCENE_W + 0.01)
        expect(s.y - s.h / 2, `${q.id} ${z.id}`).toBeGreaterThanOrEqual(-0.01)
        expect(s.y + s.h / 2, `${q.id} ${z.id}`).toBeLessThanOrEqual(SCENE_H + 0.01)
      }
      // 圈圈（不含整個家具那個「裡面」）彼此不重疊，孩子好分辨
      const circles = zones.filter((z) => z.rel !== 'inside').map((z) => zoneBox(z, boxes, props))
      for (let a = 0; a < circles.length; a++)
        for (let b = a + 1; b < circles.length; b++) expect(Math.hypot(circles[a].x - circles[b].x, circles[a].y - circles[b].y), `${q.id} 圈圈重疊`).toBeGreaterThanOrEqual(SUBJECT * 0.9)
      // 「裡面」只有箱子、帳篷畫得出來
      if (zones.some((z) => z.rel === 'inside')) expect(props[0].inside, q.id).toBeDefined()
    }
  })
  it('各難度的位置：1 = 上下（裡面）；2 = 上下裡外、兩個家具；3 = 上下左右；4 = 排隊位置、兩個家具的中間', () => {
    for (const q of space.filter((x) => x.gentle)) {
      const rels = [...q.choices.map((c) => c.scene?.rel), ...(q.params?.zones ?? []).map((z) => z.rel)].filter(Boolean)
      expect(new Set(rels), q.id).toEqual(new Set(['above', 'below']))
    }
    for (const q of space.filter((x) => x.difficulty === 1 && !x.gentle)) {
      const rels = [...q.choices.map((c) => c.scene?.rel), ...(q.params?.zones ?? []).map((z) => z.rel)].filter(Boolean)
      expect(new Set(rels), q.id).toEqual(new Set(['above', 'below', 'inside']))
    }
    for (const q of space.filter((x) => x.difficulty === 2 && x.type === 'place')) expect(q.params!.anchors, q.id).toHaveLength(2)
    const d3 = space.filter((x) => x.difficulty === 3)
    expect(d3.some((q) => q.type === 'whereIs')).toBe(true)
    expect(d3.some((q) => q.type === 'place' && q.params!.zones!.some((z) => z.rel === 'left'))).toBe(true)
    const d4 = space.filter((x) => x.difficulty === 4)
    expect(new Set(d4.map((q) => q.type))).toEqual(new Set(['row', 'whereIs', 'place']))
    expect(d4.some((q) => q.type === 'place' && q.params!.rel === 'between')).toBe(true)
  })
})

describe('觀察與記憶（observe）', () => {
  const observe = QS.filter((q) => q.skill === 'observe')
  const GRID: Record<string, [number, number]> = { '1g': [2, 2], '1': [2, 2], '2': [3, 2], '3': [4, 2], '4': [4, 3] }
  it('翻牌：每種圖剛好兩張；格數 2×2 到 4×3（3×4），難度越高越多', () => {
    const flips = observe.filter((x) => x.type === 'flip')
    expect(flips.length).toBeGreaterThanOrEqual(40)
    for (const q of flips) {
      const faces = q.items.map((i) => i.obj as string)
      const count = new Map<string, number>()
      for (const f of faces) count.set(f, (count.get(f) ?? 0) + 1)
      expect([...count.values()].every((v) => v === 2), q.id).toBe(true)
      const [cols, rows] = GRID[q.gentle ? '1g' : String(q.difficulty)]
      expect([q.params!.cols, q.params!.rows], q.id).toEqual([cols, rows])
      expect(faces.length, q.id).toBe(cols * rows)
    }
    const sizes = DIFFICULTIES.map((d) => flips.find((q) => q.difficulty === d && !q.gentle)!.items.length)
    expect(sizes).toEqual([4, 6, 8, 12])
  })
  it('快閃記憶（recall）：恰好一個選項是剛剛出現過的，就是答案；選項沒有重複的東西', () => {
    for (const q of observe.filter((x) => x.type === 'recall')) {
      const shown = new Set(q.items.map((i) => i.obj))
      expect(q.items.length, q.id).toBe(q.difficulty === 2 ? 2 : 1)
      const hit = q.choices.filter((c) => shown.has(c.obj ?? null))
      expect(hit.map((c) => c.id), q.id).toEqual([q.answer])
      expect(new Set(q.choices.map((c) => c.obj)).size, q.id).toBe(q.choices.length)
      expect(q.params!.flash, q.id).toBeGreaterThanOrEqual(2000)
      expect(q.choices.length, q.id).toBe(q.gentle ? 2 : 3)
    }
  })
  it('什麼不見了（gone）：不見的那個就是答案；其他選項都沒出現過', () => {
    const gones = observe.filter((x) => x.type === 'gone')
    expect(gones.length).toBeGreaterThanOrEqual(20)
    for (const q of gones) {
      const objs = q.items.map((i) => i.obj as string)
      const goneAt = q.params!.goneAt!
      expect(goneAt, q.id).toBeGreaterThanOrEqual(0)
      expect(goneAt, q.id).toBeLessThan(objs.length)
      expect(q.choices.find((c) => c.id === q.answer)!.obj, q.id).toBe(objs[goneAt])
      expect(q.choices.filter((c) => objs.includes(c.obj as string)).map((c) => c.id), q.id).toEqual([q.answer])
      expect(new Set(objs).size, q.id).toBe(objs.length)
      expect(objs.length, q.id).toBe(q.difficulty === 3 ? 3 : 4)
      expect(q.choices.length, q.id).toBe(q.difficulty === 3 ? 3 : 4)
    }
  })
  it('找不一樣（spot）：恰好一張卡和別人不同，它就是答案；差異大小隨難度變小', () => {
    const spots = observe.filter((x) => x.type === 'spot')
    expect(spots.length).toBeGreaterThanOrEqual(40)
    for (const q of spots) {
      expect(new Set(q.choices.map((c) => c.obj)).size, q.id).toBe(1)
      const odd = q.choices.filter((c) => c.variant)
      expect(odd.map((c) => c.id), q.id).toEqual([q.answer])
      const v = odd[0].variant!
      const cell = q.gentle ? '1g' : String(q.difficulty)
      if (cell === '1' || cell === '1g') expect(v.gray === true || Math.abs(v.hue ?? 0) >= 120, q.id).toBe(true)
      if (cell === '2') expect(v, q.id).toEqual({ rot: 180 })
      if (cell === '3') expect(v.hue === 60 || Math.abs(v.rot ?? 0) === 90, q.id).toBe(true)
      if (cell === '4') expect(Math.abs(v.hue ?? v.rot ?? 0), q.id).toBe(35)
      // 題目的字：顏色 / 方向
      const color = v.hue !== undefined || v.gray === true
      expect(/顏色|灰色/.test(q.prompt), q.id).toBe(color)
      expect(/倒過來|頭朝下|轉了方向|歪/.test(q.prompt), q.id).toBe(!color)
    }
    const k: Record<string, number[]> = { '1g': [3], '1': [3], '2': [4], '3': [4, 5], '4': [5, 6] }
    for (const q of spots) expect(k[q.gentle ? '1g' : String(q.difficulty)], q.id).toContain(q.choices.length)
  })
  it('三種題型每格都有；幼幼專用題都是難度 1', () => {
    for (const cell of CELLS.filter((c) => c.startsWith('observe'))) {
      const types = new Set(inCell(cell).map((q) => q.type))
      expect(types.has('flip'), cell).toBe(true)
      expect(types.size, cell).toBeGreaterThanOrEqual(3)
    }
    for (const q of QS.filter((x) => x.gentle)) {
      expect(q.difficulty).toBe(1)
      expect(isGentleOk(q)).toBe(true)
    }
  })
})

describe('答案位置平均', () => {
  it('每格每種選項數：答案落在各個位置的比例都不偏（沒有「永遠點右邊」）', () => {
    for (const cell of CELLS) {
      const qs = inCell(cell).filter((q) => q.choices.length >= 2)
      for (const k of [2, 3, 4, 5, 6]) {
        const mine = qs.filter((q) => q.choices.length === k)
        if (mine.length < 10) continue
        const pos = Array(k).fill(0)
        for (const q of mine) pos[q.choices.findIndex((c) => c.id === q.answer)]++
        expect(Math.min(...pos), `${cell} k=${k} ${pos}`).toBeGreaterThanOrEqual(Math.floor((mine.length / k) * 0.6))
        expect(Math.max(...pos), `${cell} k=${k} ${pos}`).toBeLessThanOrEqual(Math.ceil((mine.length / k) * 1.5))
      }
    }
  })
})

describe('幼幼模式與出題顯示', () => {
  it('幼幼專用題：位置、比大小 2 選 1；找不一樣 3 張；難度 1 的幼幼題庫每技能 >= 36', () => {
    for (const q of QS.filter((x) => x.gentle && x.type !== 'spot' && !x.interaction)) expect(q.choices, q.id).toHaveLength(2)
    for (const s of MATH2_SKILLS) expect(questionsFor(s, 1, ALL, true).every((q) => q.gentle), s).toBe(true)
  })
  it('displayQuestion：幼幼模式縮成 2 選 1，但找不一樣一張都不能少；互動題原樣；洗牌不改變答案', () => {
    const spot = QS.find((q) => q.type === 'spot' && q.choices.length >= 3)!
    expect(displayQuestion(spot, 's', true).choices).toHaveLength(spot.choices.length)
    const bigger = QS.find((q) => q.type === 'bigger' && q.choices.length === 3)!
    const shown = displayQuestion(bigger, 's', true)
    expect(shown.choices).toHaveLength(2)
    expect(shown.choices.map((c) => c.id)).toContain(bigger.answer)
    for (const q of QS.filter((x) => (x.interaction ?? 'pick') !== 'pick').slice(0, 20)) expect(displayQuestion(q, 's', true)).toBe(q)
    // 縮成兩個之後，最大的還是最大（答案選項一定留著）
    for (const q of QS.filter((x) => x.type === 'bigger')) {
      const s = displayQuestion(q, 'seed', true)
      expect(s.choices.map((c) => c.id), q.id).toContain(q.answer)
    }
    // 同一個 seed 洗出來一樣
    expect(displayQuestion(bigger, 'x').choices.map((c) => c.id)).toEqual(displayQuestion(bigger, 'x').choices.map((c) => c.id))
  })
})

describe('教學示範（三種新互動）', () => {
  it('排序、放到位置、翻牌第一次出現時要教學；教學題是不在題庫裡的練習題，答案自己對得上', () => {
    for (const it of ['dragOrder', 'place', 'flip'] as const) {
      expect(needsTutorial(it, new Set())).toBe(true)
      expect(needsTutorial(it, new Set([it]))).toBe(false)
      const t = tutorialQuestion(it)
      expect(t.id.startsWith('tutorial-')).toBe(true)
      expect(getQuestion(t.id)).toBeUndefined()
      expect(t.interaction).toBe(it)
    }
    const order = tutorialQuestion('dragOrder')
    const scales = order.params!.itemOrder!.map((i) => order.items[i].scale as number)
    expect(scales).toEqual([...scales].sort((a, b) => a - b))
    const place = tutorialQuestion('place')
    expect(place.params!.zones!.find((z) => z.id === place.params!.target)!.rel).toBe('above')
    const flip = tutorialQuestion('flip')
    expect(flip.items.map((i) => i.obj).sort()).toEqual(['obj-apple', 'obj-apple', 'obj-fish', 'obj-fish'])
  })
})

describe('章節：水簾洞', () => {
  it('第 2 章：5 站（最後一站 Boss）、章末寶箱、花果山通關後才解鎖；章節資料可繼續加章', () => {
    expect(SHUILIANDONG).toMatchObject({ id: 'shuiliandong', name: '水簾洞', unlockAfter: 'huaguoshan' })
    expect(SHUILIANDONG.stations).toHaveLength(5)
    expect(SHUILIANDONG.stations[4].kind).toBe('boss')
    expect(SHUILIANDONG.stations[0].kind).toBe('tutorial')
    for (const s of SHUILIANDONG.stations) expect(s.slots).toHaveLength(5)
    expect(CHAPTERS.map((c) => c.id)).toEqual(['huaguoshan', 'shuiliandong', 'english-island', 'life-town', 'nature-forest'])
    expect(getChapter('shuiliandong')).toBe(SHUILIANDONG)
    expect(HUAGUOSHAN.unlockAfter).toBeUndefined()
    const math = SUBJECTS.find((s) => s.id === 'math')!
    expect(chaptersOf(math).map((c) => c.id)).toEqual(['huaguoshan', 'shuiliandong'])
    expect(subjectSkills(math)).toEqual(MATH_ALL_SKILLS)
    expect(subjectSkills(SUBJECTS.find((s) => s.id === 'english')!)).toEqual(['english'])
    expect(subjectOfChapter('shuiliandong')?.id).toBe('math')
    expect(resolveStage('shuiliandong', 3, '2026-10-27')).toMatchObject({ daily: false, subject: 'math', chapterName: '水簾洞', def: { name: '石桌石椅' } })
    expect(resolveStage('shuiliandong', 6, '2026-10-27')).toBeUndefined()
    // 三種新互動都有排進第 2 章的站裡
    const slots = SHUILIANDONG.stations.flatMap((s) => s.slots)
    for (const it of ['dragOrder', 'place', 'flip'] as const) expect(slots).toContain(it)
    // 每站最後一題固定是複習第 1 章（點選）
    for (const s of SHUILIANDONG.stations) expect(s.slots[4]).toBe('pick')
  })
  it('解鎖：只看花果山有沒有通關（5 站都過，或開過寶箱）；PM 預覽可以直接解鎖；其他章節不受影響', () => {
    const done = { stations: Array.from({ length: 5 }, () => ({ done: true, independent: 5, total: 5 })), completedRuns: 0 }
    const part = { stations: Array.from({ length: 5 }, (_, i) => ({ done: i < 4, independent: 5, total: 5 })), completedRuns: 0 }
    const reset = { stations: Array.from({ length: 5 }, () => ({ done: false, independent: 0, total: 0 })), completedRuns: 1 }
    expect(chapterCleared(undefined)).toBe(false)
    expect(chapterCleared(done)).toBe(true)
    expect(chapterCleared(part)).toBe(false)
    expect(chapterCleared(reset)).toBe(true) // 再玩一輪：關卡重置，但通關過就是通關過
    expect(chapterUnlocked(SHUILIANDONG, {})).toBe(false)
    expect(chapterUnlocked(SHUILIANDONG, { huaguoshan: part })).toBe(false)
    expect(chapterUnlocked(SHUILIANDONG, { huaguoshan: done })).toBe(true)
    expect(chapterUnlocked(SHUILIANDONG, { huaguoshan: reset })).toBe(true)
    expect(chapterUnlocked(SHUILIANDONG, {}, ['shuiliandong'])).toBe(true)
    expect(chapterUnlocked(HUAGUOSHAN, {})).toBe(true)
  })
})

describe('第 2 章出題：三個新技能 + 少量第 1 章複習', () => {
  const states = (d: Difficulty = 1) => Object.fromEntries(SKILLS.map((k) => [k, { ...initialSkillState(k, 0, d), total: 50 }])) as Record<SkillId, SkillState>
  const mix = skillsOfChapter('shuiliandong')!
  it('skillsOfChapter：第 2 章是三個新技能、最後一題第 1 章；第 1 章與英文維持原樣', () => {
    expect(mix).toEqual({ skills: MATH2_SKILLS, tail: MATH_SKILLS })
    expect(skillsOfChapter('huaguoshan')).toEqual({ skills: MATH_SKILLS })
    expect(skillsOfChapter('english-island')).toEqual({ skills: ['english'] })
    expect(skillsOfChapter('nope')).toBeUndefined()
  })
  it('每站 5 題：4 題新技能（三種都出現）、1 題第 1 章；第 1 章技能每站輪流', () => {
    const tails = new Set<SkillId>()
    for (let station = 0; station < 5; station++) {
      const plan = planStation({ stationIndex: station, states: states(), attempts: [], now: 1, rng: makeRng(station + 1), skills: mix.skills, tail: mix.tail, slots: SHUILIANDONG.stations[station].slots })
      expect(plan).toHaveLength(5)
      expect(new Set(plan.map((p) => p.question.id)).size).toBe(5)
      const skills = plan.map((p) => p.question.skill)
      expect(new Set(skills.slice(0, 4))).toEqual(new Set(MATH2_SKILLS))
      expect(MATH_SKILLS).toContain(skills[4])
      tails.add(skills[4])
    }
    expect(tails).toEqual(new Set(MATH_SKILLS))
  })
  it('站型的互動位置：難度夠的時候，站上指定的排序、放位置、翻牌都會出現（該技能沒有那種題就退回點選）', () => {
    for (let station = 0; station < 5; station++) {
      const slots = SHUILIANDONG.stations[station].slots
      const plan = planStation({ stationIndex: station, states: states(2), attempts: [], now: 1, rng: makeRng(7), skills: mix.skills, tail: mix.tail, slots })
      const got = plan.map((p) => p.question.interaction ?? 'pick')
      for (const [i, it] of slots.entries()) {
        const skill = SKILL_OF_INTERACTION[it]
        const wanted = skill && MATH2_SKILLS.includes(skill)
        // 同一個互動最多出現一次（同一技能在 4 個位置裡可能出兩次，第二次是點選）
        if (wanted && plan.some((p) => p.question.skill === skill)) expect(got.includes(it), `站 ${station + 1} 第 ${i + 1} 題 ${it}`).toBe(true)
      }
    }
  })
  it('到期的複習：新技能和第 1 章技能都可能被排進來（站上最多 1 題複習）', () => {
    const st = states(2)
    st.measure = { ...st.measure, mastered: { 1: { masteredAt: 0, reviews: 0 } } }
    const plan = planStation({ stationIndex: 0, states: st, attempts: [], now: 5 * 86_400_000, rng: makeRng(3), skills: mix.skills, tail: mix.tail })
    const rev = plan.filter((p) => p.review)
    expect(rev).toHaveLength(1)
    expect(rev[0].question).toMatchObject({ skill: 'measure', difficulty: 1 })
  })
  it('幼幼模式：第 2 章每一題都抽得出來（難度 1 用幼幼專用題）', () => {
    for (let station = 0; station < 5; station++) {
      const plan = planStation({ stationIndex: station, states: states(1), attempts: [], now: 1, rng: makeRng(station + 11), gentle: true, skills: mix.skills, tail: mix.tail, slots: SHUILIANDONG.stations[station].slots })
      expect(plan).toHaveLength(5)
    }
  })
})

describe('家長報告與新招', () => {
  it('報告有三個新技能的白話描述（四個難度都寫了）', () => {
    for (const s of MATH2_SKILLS) for (const d of DIFFICULTIES) expect(LEVEL_LABEL[s][d].length, `${s}${d}`).toBeGreaterThan(4)
    const r = buildReport([], Object.fromEntries(SKILLS.map((k) => [k, initialSkillState(k)])) as Record<SkillId, SkillState>, Date.now())
    expect(r.skills.map((x) => x.skill)).toEqual(expect.arrayContaining([...MATH2_SKILLS]))
    expect(r.skills.find((x) => x.skill === 'measure')!.name).toBe('比較與排序')
  })
  it('阿悟新增三招：量身高、捉迷藏、記憶魔術，各對應一個新技能；動畫腳本用現有姿勢', () => {
    const want = { height: 'measure', hide: 'space', memory: 'observe' } as const
    for (const [id, skill] of Object.entries(want)) {
      const t = TRICKS.find((x) => x.id === id)!
      expect(t.unlock).toEqual({ skill })
      const states = { [skill]: { difficulty: 2, mastered: {} } } as Parameters<typeof earnedTricks>[0]['states']
      expect(earnedTricks({ states, startDifficulty: 1, clearedChapters: [] })).toEqual([id])
      const scene = planBehavior(TRICK_BEHAVIOR[id as keyof typeof TRICK_BEHAVIOR], { rng: rng(1), childName: '小明', stage: 'adult', walk: null, centerWalk: null, ballWalk: null, wishIcons: [], tidyPath: [] })
      expect(scene.steps.length).toBeGreaterThan(5)
    }
    expect(TRICKS.map((t) => t.name)).toEqual(expect.arrayContaining(['量身高', '捉迷藏', '記憶魔術']))
  })
})

describe('語音：所有新句子都在句子清單裡', () => {
  it('每題的題目、提示、幼幼提示都有 key；新互動與章節的台詞都在固定台詞裡', () => {
    const lines = allLines(ALL)
    for (const q of QS) for (const l of questionLines(q)) expect(lines[l.key], l.key).toBe(l.text)
    const texts = new Set(staticLineList().map((l) => l.text))
    for (const t of [
      '這一格不是它喔，再想一想。',
      '排好了！',
      '不是這裡喔，再試試看。',
      '放好了！',
      '一樣！找到了！',
      '不一樣喔，記住它們在哪裡。',
      '全部都找到了！',
      '看我把最小的放在第一格。',
      '看我把它放到亮亮的位置。',
      '看我翻開兩張牌。',
      '水簾洞還沒開，先通關花果山喔',
      '水簾洞開門囉！',
      '阿悟學會了新本領：量身高！',
      '阿悟學會了新本領：捉迷藏！',
      '阿悟學會了新本領：記憶魔術！',
    ])
      expect(texts.has(t), t).toBe(true)
  })
  it('新招表演時阿悟說的話（pet/plan.ts 的 voice）都在句子清單裡，字一個不差', () => {
    const texts = new Set(staticLineList().map((l) => l.text))
    for (const id of ['height', 'hide', 'memory'] as const) {
      const scene = planBehavior(TRICK_BEHAVIOR[id], { rng: rng(1), childName: '小明', stage: 'adult', walk: null, centerWalk: null, ballWalk: null, wishIcons: [], tidyPath: [] })
      const said = scene.steps.filter((s) => s.act.do === 'voice').map((s) => (s.act as { text: string }).text)
      expect(said.length, id).toBeGreaterThan(0)
      for (const t of said) expect(texts.has(t), `${id}：${t}`).toBe(true)
    }
  })
  it('位置詞和家具名稱', () => {
    expect(PROPS.map((p) => p.name)).toEqual(['箱子', '桌子', '帳篷', '小床', '沙發'])
    expect(Object.values(REL_WORD)).toEqual(['上面', '下面', '裡面', '外面', '左邊', '右邊', '中間'])
    expect(REL_BY_WORD['上面']).toBe('above')
  })
})
