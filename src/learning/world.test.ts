import 'fake-indexeddb/auto'
import { spawnSync } from 'node:child_process'
import { beforeEach, describe, expect, it } from 'vitest'
import { GuaibaoDB } from '../db/db'
import { Repo } from '../db/repo'
import { earnedTricks, learnLine, TRICKS } from '../domain/tricks'
import { QUESTIONS, questionsFor } from './bank'
import { CHAPTERS, LIFE_TOWN, NATURE_FOREST } from './chapter'
import { WORLD_ART } from './lifeNature'
import { allLines, STATIC_LINES, wordKey } from './lines'
import { buildReport, LEVEL_LABEL } from './report'
import { makeRng } from './rng'
import { displayQuestion, planStation, skillForInteraction } from './select'
import { initialSkillState } from './skills'
import { dailyChapterId, SUBJECTS } from './subject'
import { DIFFICULTIES, SKILLS, SKILL_NAMES, type Question, type SkillState } from './types'

const LIFE = QUESTIONS.filter((q) => q.skill === 'life')
const NATURE = QUESTIONS.filter((q) => q.skill === 'nature')
const WORLD = [...LIFE, ...NATURE]
const cellOf = (q: Question) => `${q.skill}-${q.difficulty}${q.gentle ? 'g' : ''}`

// ---------- 獨立的對照表（不引用 lifeNature.ts；這是看過每張圖之後手寫的） ----------

/** 圖實際畫的是什麼。ok = false 的圖畫得不符合題意，不可以用在任何題目裡 */
const MEANING: Record<string, { what: string; good?: boolean; ok: boolean }> = {
  'life-wash-hands': { what: 'wash', good: true, ok: true },
  'life-dirty-hands': { what: 'dirty', good: false, ok: true },
  'life-tidy-toys': { what: 'tidy', good: true, ok: true },
  'life-messy-toys': { what: 'messy', good: false, ok: true },
  'life-queue': { what: 'stand-together', good: true, ok: true },
  'life-cut-line': { what: 'cut-line', good: false, ok: true },
  'life-thank-you': { what: 'gift', good: true, ok: true },
  'life-grab': { what: 'grab-ball', good: false, ok: true },
  'life-cross-green': { what: 'green-cross', good: true, ok: true },
  'life-wait-red': { what: 'wait-red', good: true, ok: true },
  'life-trash': { what: 'trash', good: true, ok: true },
  'life-litter': { what: 'litter', good: false, ok: true },
  'life-brush-teeth': { what: 'brush', good: true, ok: true },
  'life-eat-veg': { what: 'veg', good: true, ok: true },
  'life-cover-cough': { what: 'cough', good: true, ok: true },
  'life-bedtime': { what: 'sleep', good: true, ok: true },
  'nat-sunny': { what: 'sun', ok: true },
  'nat-rainy': { what: 'rain', ok: true },
  'nat-snowy': { what: 'snow', ok: true },
  'nat-windy': { what: 'wind', ok: true },
  'nat-spring': { what: 'spring', ok: true },
  'nat-summer': { what: 'summer', ok: true },
  'nat-autumn': { what: 'autumn', ok: true },
  'nat-winter': { what: 'winter', ok: true },
  'nat-sea': { what: 'sea', ok: true },
  'nat-forest': { what: 'forest', ok: true },
  'nat-farm': { what: 'farm', ok: true },
  'nat-seed': { what: 'seed', ok: true },
  'nat-sprout': { what: 'sprout', ok: true },
  'nat-bloom': { what: 'bloom', ok: true },
  'obj-fish': { what: 'fish', ok: true },
  'obj-chick': { what: 'chick', ok: true },
  'obj-rabbit': { what: 'rabbit', ok: true },
  'obj-cow': { what: 'cow', ok: true },
  'obj-bear': { what: 'bear', ok: true },
  'obj-octopus': { what: 'octopus', ok: true },
}
const what = (art: string | undefined): string => {
  expect(art && MEANING[art], `圖 ${art} 不在對照表裡`).toBeTruthy()
  return MEANING[art as string].what
}
const isGood = (art: string): boolean => MEANING[art].good === true

/** 題目文字裡的關鍵字 → 圖裡的動作（「哪一張是…？」的獨立解法） */
const SEE_KEYWORDS: [string, string][] = [
  ['洗手', 'wash'],
  ['髒', 'dirty'],
  ['收玩具', 'tidy'],
  ['插隊', 'cut-line'],
  ['禮物', 'gift'],
  ['垃圾桶', 'trash'],
  ['紅燈', 'wait-red'],
  ['牽著媽媽', 'green-cross'],
  ['散了一地', 'messy'],
  ['小雞在哭', 'grab-ball'],
  ['香蕉皮丟在地上', 'litter'],
  ['刷牙', 'brush'],
  ['青菜', 'veg'],
  ['咳嗽', 'cough'],
  ['睡覺', 'sleep'],
]

const HABITAT: Record<string, string> = { fish: 'sea', octopus: 'sea', bear: 'forest', cow: 'farm', chick: 'farm' }
const WEATHER_NAME: Record<string, string> = { sun: '晴天', rain: '下雨天', snow: '下雪天', wind: '刮風天' }
const SEASON_NAME: Record<string, string> = { spring: '春天', summer: '夏天', autumn: '秋天', winter: '冬天' }
const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter']
const PLANT_ORDER = ['seed', 'sprout', 'bloom']
const TRAIT_WHO: Record<string, string[]> = {
  moo: ['cow'],
  peep: ['chick'],
  ears: ['rabbit'],
  legs8: ['octopus'],
  milk: ['cow'],
  honey: ['bear'],
  water: ['fish', 'octopus'],
}
/** 步驟：每個流程由先到後的文字 */
const ROUTINE: Record<string, string[]> = {
  wash: ['把手弄濕', '擦上肥皂', '搓出泡泡', '用水沖乾淨', '用毛巾擦乾'],
  teeth: ['擠一點點牙膏', '把牙齒刷乾淨', '用水漱口', '擦擦嘴巴'],
  street: ['先停下來', '看看左右', '聽聽有沒有車', '牽好手慢慢走'],
  bed: ['洗香香', '刷牙', '換上睡衣', '上床睡覺'],
  meal: ['先洗手', '坐好', '說「我開動了」', '慢慢吃飯'],
}
const ROUTINE_TITLE: Record<string, string> = { wash: '洗手', teeth: '刷牙', street: '過馬路', bed: '睡覺前', meal: '吃飯前' }
/** 「為什麼」題：正確理由裡一定有的關鍵字，錯的理由一定沒有 */
const WHY_KEY: Record<string, string> = {
  wash: '細菌洗掉',
  queue: '輪流',
  teeth: '蛀蟲',
  trash: '乾乾淨淨',
  cough: '細菌飛到別人',
  veg: '壯壯',
  sleep: '長高',
  red: '安全',
  thanks: '感謝',
  toys: '找得到',
}
/** 這幾個「好不好」的文字故事，好不好是看過才標的 */
const STORY_GOOD: boolean[] = [false, false, false, true, true, true, true, true, true, false]

const fact = (q: Question): [string, ...string[]] => (q.params!.fact ?? '').split(':') as [string, ...string[]]
const choiceTexts = (q: Question) => q.choices.map((c) => c.text ?? '')

/** 獨立解題：不看 answer 欄位，從題幹與事實標記算出「說得通」的選項 id */
function solve(q: Question): string[] {
  const [kind, a] = fact(q)
  const ids = (f: (c: Question['choices'][number]) => boolean) => q.choices.filter(f).map((c) => c.id)
  switch (kind) {
    case 'see': {
      const acts = SEE_KEYWORDS.filter(([k]) => q.prompt.includes(k)).map(([, v]) => v)
      expect(acts, q.id).toHaveLength(1)
      return ids((c) => what(c.art) === acts[0])
    }
    case 'right':
      return ids((c) => isGood(c.art as string))
    case 'ok': {
      const good = isGood(q.params!.stem!.art as string)
      return ids((c) => c.id === (good ? 'yes' : 'no'))
    }
    case 'story':
      return ids((c) => c.id === (STORY_GOOD[Number(a)] ? 'yes' : 'no'))
    case 'say': {
      const t = q.prompt
      const word = /說「謝謝/.test(t) ? '不客氣' : t.includes('不小心') ? '對不起' : /想(玩|請|要)/.test(t) ? '請' : '謝謝'
      return ids((c) => c.text === word)
    }
    case 'light': {
      const red = q.params!.stem!.swatch === '#ef4b3f'
      expect(q.prompt.includes(red ? '紅' : '綠'), q.id).toBe(true)
      return ids((c) => c.id === (red ? 'stop' : 'go'))
    }
    case 'lightpic': {
      const art = q.prompt.includes('紅燈') ? 'life-wait-red' : 'life-cross-green'
      expect(q.prompt.includes('紅燈') !== q.prompt.includes('綠燈'), q.id).toBe(true)
      return ids((c) => c.id === art)
    }
    case 'step': {
      const rid = Object.keys(ROUTINE_TITLE).find((k) => q.prompt.startsWith(ROUTINE_TITLE[k]))
      expect(rid, q.id).toBeTruthy()
      const first = /先|第一步|最先/.test(q.prompt)
      const last = /最後/.test(q.prompt)
      expect(first !== last, q.id).toBe(true)
      const steps = ROUTINE[rid as string]
      const want = first ? steps[0] : steps[steps.length - 1]
      return ids((c) => c.text === want)
    }
    case 'why':
      return ids((c) => (c.text ?? '').includes(WHY_KEY[a]))
    case 'weather':
      return ids((c) => what(c.art) === a)
    case 'weatherName':
      return ids((c) => c.text === WEATHER_NAME[what(q.params!.stem!.art)])
    case 'bring': {
      const t = q.prompt
      const gear = /雨/.test(t) ? '雨傘' : /太陽/.test(t) ? '太陽眼鏡' : '外套'
      expect([/雨/, /太陽/, /冷/].filter((r) => r.test(t)), q.id).toHaveLength(1)
      const art = q.params!.stem?.art
      if (art) expect(what(art), q.id).toBe(gear === '雨傘' ? 'rain' : gear === '太陽眼鏡' ? 'sun' : 'snow')
      return ids((c) => c.text === gear)
    }
    case 'home': {
      const animal = what(q.params!.stem!.art)
      return ids((c) => what(c.art) === HABITAT[animal])
    }
    case 'seasonPic':
      return ids((c) => c.id === what(q.params!.stem!.art))
    case 'seasonName': {
      const s = Object.keys(SEASON_NAME).find((k) => q.prompt.includes(SEASON_NAME[k]))
      return ids((c) => what(c.art) === s)
    }
    case 'season': {
      const t = q.prompt
      const rules: [RegExp, string][] = [
        [/花/, 'spring'],
        [/熱|游泳|吃冰|汗/, 'summer'],
        [/樹葉|落葉/, 'autumn'],
        [/冷|外套|毛衣/, 'winter'],
      ]
      const hit = rules.filter(([r]) => r.test(t)).map(([, s]) => s)
      expect(hit, q.id).toHaveLength(1)
      return ids((c) => c.id === hit[0])
    }
    case 'snow':
      return ids((c) => c.id === 'winter')
    case 'plant':
      return ids((c) => what(c.art) === a)
    case 'need':
      return ids((c) => /水|陽光/.test(c.text ?? ''))
    case 'name':
      return ids((c) => what(c.art) === a.replace('obj-', ''))
    case 'trait':
      return ids((c) => TRAIT_WHO[a].includes(what(c.art)))
    default:
      throw new Error(`${q.id}：不認得的事實 ${q.params?.fact}`)
  }
}

const PICK = WORLD.filter((q) => !q.interaction || q.interaction === 'pick')

describe('生活與自然題庫完整性', () => {
  it('每格（含幼幼版）>= 24 題；id 不重複且以 <科目>-<難度>- 開頭', () => {
    for (const skill of ['life', 'nature'] as const) {
      for (const d of DIFFICULTIES) expect(questionsFor(skill, d).length, `${skill} d${d}`).toBeGreaterThanOrEqual(24)
      expect(questionsFor(skill, 1, QUESTIONS, true).length, `${skill} 幼幼`).toBeGreaterThanOrEqual(24)
    }
    expect(new Set(WORLD.map((q) => q.id)).size).toBe(WORLD.length)
    for (const q of WORLD) expect(q.id.startsWith(`${q.skill}-${q.difficulty}-`), q.id).toBe(true)
    expect(LIFE.every((q) => q.skill === 'life')).toBe(true)
  })
  it('每題恰好一個正解，且與獨立解題邏輯（另一份對照表）一致', () => {
    for (const q of PICK) expect(solve(q), q.id).toEqual([q.answer])
  })
  it('每題都有事實標記、提示，提示和題目不同；選項 id 不重複；答案在選項內', () => {
    for (const q of PICK) {
      expect(q.params?.fact, q.id).toBeTruthy()
      expect(q.hint.length, q.id).toBeGreaterThan(6)
      expect(q.hint, q.id).not.toBe(q.prompt)
      expect(new Set(q.choices.map((c) => c.id)).size, q.id).toBe(q.choices.length)
      expect(q.choices.map((c) => c.id), q.id).toContain(q.answer)
      expect(q.choices.length, q.id).toBeGreaterThanOrEqual(2)
      expect(q.choices.length, q.id).toBeLessThanOrEqual(4)
    }
  })
  it('答案位置平均', () => {
    for (const cellId of new Set(PICK.map(cellOf))) {
      for (const k of [2, 3, 4]) {
        const qs = PICK.filter((q) => cellOf(q) === cellId && q.choices.length === k)
        if (qs.length < 6) continue
        const pos = Array(k).fill(0)
        for (const q of qs) pos[q.choices.findIndex((c) => c.id === q.answer)]++
        expect(Math.min(...pos), `${cellId} k=${k} ${pos}`).toBeGreaterThanOrEqual(Math.floor((qs.length / k) * 0.5))
        expect(Math.max(...pos), `${cellId} k=${k} ${pos}`).toBeLessThanOrEqual(Math.ceil((qs.length / k) * 1.6))
      }
    }
  })
  it('同一格沒有重複的題面（題目 + 選項組合）', () => {
    for (const cellId of new Set(WORLD.map(cellOf))) {
      const sigs = WORLD.filter((q) => cellOf(q) === cellId).map((q) =>
        JSON.stringify([q.prompt, q.items, q.params?.stem, [...q.choices.map((c) => c.id)].sort(), q.interaction === 'stepOrder' ? q.choices.map((c) => c.id) : null]),
      )
      expect(new Set(sigs).size, cellId).toBe(sigs.length)
    }
  })
  it('各難度的題型：1 認圖與對的做法、2 好不好與紅綠燈、3 說對話與排序、4 多步驟與為什麼', () => {
    const types = (skill: 'life' | 'nature', d: number, gentle = false) => new Set(WORLD.filter((q) => q.skill === skill && q.difficulty === d && !!q.gentle === gentle).map((q) => q.type))
    expect(types('life', 1)).toEqual(new Set(['lifeSee', 'lifeRight']))
    expect(types('life', 1, true)).toEqual(new Set(['lifeSee', 'lifeRight', 'lifeSay']))
    expect(types('life', 2)).toEqual(new Set(['lifeRight', 'lifeOk', 'lifeLight', 'lifeSay']))
    expect(types('life', 3)).toEqual(new Set(['lifeSay', 'lifeStep', 'lifeOrder', 'lifeOk']))
    expect(types('life', 4)).toEqual(new Set(['lifeOrder', 'lifeWhy', 'lifeStep', 'lifeSay']))
    expect(types('nature', 1)).toEqual(new Set(['natWeather', 'natAnimal', 'natHome', 'natSeason', 'natPlant'])) // v7：第 1 章也有季節、動物的家、植物生長
    expect(types('nature', 2)).toEqual(new Set(['natBring', 'natHome', 'natSeason', 'natPlant', 'natWeather']))
    expect(types('nature', 3)).toEqual(new Set(['bins', 'natSeason', 'natOrder', 'natAnimal']))
    expect(types('nature', 4)).toEqual(new Set(['bins', 'natOrder', 'natSeason', 'natPlant', 'natAnimal']))
  })
  it('幼幼模式（3 歲）：只有 2 選 1 的配對、對錯與簡單的說話；一般模式不會抽到', () => {
    for (const q of WORLD.filter((x) => x.gentle)) {
      expect(q.difficulty).toBe(1)
      expect(q.choices, q.id).toHaveLength(2)
      expect(['lifeSee', 'lifeRight', 'lifeSay', 'natWeather', 'natAnimal', 'natHome']).toContain(q.type)
      if (q.type === 'lifeSay') expect(['thanks', 'sorry']).toContain(q.answer)
    }
    for (const s of ['life', 'nature'] as const) for (const d of DIFFICULTIES) expect(questionsFor(s, d).some((q) => q.gentle)).toBe(false)
    // 升到難度 2 以後，幼幼模式的 2 選 1 由 displayQuestion 縮出來，答案一定留著
    const say = LIFE.find((q) => q.type === 'lifeSay' && !q.gentle)!
    const g = displayQuestion(say, 's', true)
    expect(g.choices).toHaveLength(2)
    expect(g.choices.map((c) => c.id)).toContain(say.answer)
  })
})

describe('圖與題意對應表', () => {
  it('素材清單：每張新圖在對照表裡；程式的素材表（WORLD_ART）和這份獨立對照表的 ok 標記一致', () => {
    for (const [name, info] of Object.entries(WORLD_ART)) {
      expect(MEANING[name], name).toBeTruthy()
      expect(info.ok, name).toBe(MEANING[name].ok)
      expect(info.alt.length, name).toBeGreaterThanOrEqual(1)
      expect(info.emoji.length, name).toBeGreaterThan(0)
    }
    expect(Object.keys(MEANING).sort()).toEqual(Object.keys(WORLD_ART).sort())
  })
  it('畫得不符合題意（ok: false）的圖不可以出現在任何題目、排序卡片、籃子裡（目前 16 張生活圖和自然圖都畫對了）', () => {
    const bad = Object.entries(MEANING).filter(([, m]) => !m.ok).map(([n]) => n)
    expect(bad).toEqual([])
    const json = JSON.stringify(WORLD)
    for (const n of bad) expect(json.includes(n), n).toBe(false)
  })
  it('題目用到的每一張圖都在對照表、且是畫得對的圖', () => {
    const used = new Set<string>()
    for (const q of WORLD) {
      for (const c of q.choices) if (c.art) used.add(c.art)
      if (q.params?.stem?.art) used.add(q.params.stem.art)
      for (const b of q.params?.bins ?? []) if (b.art) used.add(b.art)
      for (const it of q.items) if (it.obj) used.add(it.obj)
    }
    for (const a of used) expect(MEANING[a]?.ok, a).toBe(true)
    // 每張畫得對的圖都至少出現在一題
    for (const [n, m] of Object.entries(MEANING)) if (m.ok) expect(used.has(n), `${n} 沒有出現在任何題目`).toBe(true)
  })
  it('「哪一張是…」題：題目說的動作，正好只有答案那張圖在做', () => {
    for (const q of LIFE.filter((x) => x.type === 'lifeSee')) {
      const acts = q.choices.map((c) => what(c.art))
      expect(new Set(acts).size, q.id).toBe(acts.length)
    }
  })
  it('排隊那張只畫了朋友站在一起，所以只出現在有插隊圖的題目裡', () => {
    for (const q of WORLD) {
      const arts = q.choices.map((c) => c.art)
      if (arts.includes('life-queue') && q.type !== 'lifeSee') expect(arts, q.id).toContain('life-cut-line')
    }
    // 排隊那張不單獨用在「這樣好不好」
    expect(LIFE.some((q) => q.type === 'lifeOk' && q.params?.stem?.art === 'life-queue')).toBe(false)
  })
})

describe('生活：語氣與內容', () => {
  it('不說壞孩子、不羞辱；「這樣好不好」一律用「阿悟這樣好不好呢？」來問', () => {
    const text = WORLD.map((q) => `${q.prompt}${q.hint}${q.choices.map((c) => c.text ?? '').join('')}`).join('\n')
    for (const bad of ['壞孩子', '壞小孩', '笨', '不乖', '丟臉', '羞羞臉', '討厭你']) expect(text.includes(bad), bad).toBe(false)
    const ok = LIFE.filter((q) => q.type === 'lifeOk')
    expect(ok.length).toBeGreaterThanOrEqual(20)
    for (const q of ok) {
      expect(q.prompt.endsWith('阿悟這樣好不好呢？'), q.id).toBe(true)
      expect(choiceTexts(q).sort()).toEqual(['不好', '好'])
    }
  })
  it('答錯的提示說明「為什麼」：不好的情境提示都有原因（細菌、會滑倒、朋友會難過…）', () => {
    const wash = LIFE.find((q) => q.params?.fact === 'ok:life-dirty-hands:no')!
    expect(wash.hint).toBe('手髒髒會有細菌跑進肚子，先洗手再吃喔。')
    for (const q of LIFE.filter((x) => x.type === 'lifeOk' && x.answer === 'no')) expect(q.hint, q.id).toMatch(/會|才|所以|因為|喔/)
    for (const q of LIFE.filter((x) => x.type === 'lifeWhy')) expect(q.hint.length, q.id).toBeGreaterThan(14)
  })
  it('文字選項（謝謝、對不起、請、不客氣…）都有圖示，而且選項的字都在 params.words（點一下會唸出來）', () => {
    for (const q of PICK.filter((x) => x.choices.every((c) => c.text !== undefined && !c.art))) {
      for (const c of q.choices) {
        expect(c.emoji, `${q.id} ${c.text}`).toBeTruthy()
        expect(q.params?.words, q.id).toContain(c.text)
      }
    }
    const say = LIFE.filter((q) => q.type === 'lifeSay')
    expect(new Set(say.flatMap((q) => q.choices.map((c) => c.text)))).toEqual(new Set(['謝謝', '對不起', '請', '不客氣']))
    for (const w of ['謝謝', '對不起', '請', '不客氣']) expect(allLines(QUESTIONS)[wordKey(w)]).toBe(w)
  })
  it('紅綠燈：紅燈要停、綠燈才走；步驟題的順序正確；為什麼題的錯誤理由明顯不對', () => {
    const lights = LIFE.filter((q) => q.params?.fact?.startsWith('light:'))
    expect(lights.some((q) => q.params!.fact === 'light:red:stop')).toBe(true)
    expect(lights.some((q) => q.params!.fact === 'light:green:go')).toBe(true)
    const whys = LIFE.filter((q) => q.type === 'lifeWhy')
    for (const q of whys) expect(q.choices.filter((c) => (c.text ?? '').includes(WHY_KEY[fact(q)[1]])), q.id).toHaveLength(1)
    expect(new Set(whys.map((q) => fact(q)[1])).size).toBe(10)
  })
})

describe('步驟排序（stepOrder）題', () => {
  const ORDER = WORLD.filter((q) => q.interaction === 'stepOrder')
  it('生活與自然都有；互動是 stepOrder、答案是 sorted；卡片打散、沒有一開始就排好', () => {
    expect(ORDER.filter((q) => q.skill === 'life').length).toBeGreaterThanOrEqual(20)
    expect(ORDER.filter((q) => q.skill === 'nature').length).toBeGreaterThanOrEqual(15)
    for (const q of ORDER) {
      expect(q.answer).toBe('sorted')
      expect(q.params!.order, q.id).toHaveLength(q.choices.length)
      expect(q.choices.map((c) => c.id), q.id).not.toEqual(q.params!.order)
      expect([...q.choices.map((c) => c.id)].sort(), q.id).toEqual([...q.params!.order!].sort())
      expect(q.choices.length, q.id).toBeGreaterThanOrEqual(3)
      expect(q.choices.length, q.id).toBeLessThanOrEqual(5)
    }
  })
  it('順序和獨立的對照表一致：生活依流程先後（可以跳步但不能倒過來）；四季春夏秋冬；植物種子發芽開花', () => {
    for (const q of ORDER) {
      const text = (id: string) => q.choices.find((c) => c.id === id)!.text!
      const ordered = q.params!.order!.map(text)
      const [, a] = fact(q)
      if (q.type === 'lifeOrder') {
        const steps = ROUTINE[a]
        const at = ordered.map((t) => steps.indexOf(t))
        expect(at.every((x) => x >= 0), q.id).toBe(true)
        expect(at, q.id).toEqual([...at].sort((x, y) => x - y))
        expect(q.prompt.includes(ROUTINE_TITLE[a]), q.id).toBe(true)
      } else if (a === 'season') {
        expect(q.params!.order).toEqual(SEASON_ORDER)
        expect(ordered).toEqual(SEASON_ORDER.map((s) => SEASON_NAME[s]))
        for (const c of q.choices) expect(SEASON_NAME[what(c.art)], q.id).toBe(c.text)
      } else {
        expect(q.params!.order).toEqual(PLANT_ORDER)
        expect(ordered).toEqual(['種子', '發芽', '開花'])
        for (const c of q.choices) expect(what(c.art)).toBe(c.id)
      }
    }
  })
  it('排序卡片的字（點放對時會唸）都在 params.words，所以會進預錄語音清單', () => {
    const zh = allLines(QUESTIONS)
    for (const q of ORDER) for (const c of q.choices) expect(zh[wordKey(c.text!)], `${q.id} ${c.text}`).toBe(c.text)
  })
})

describe('自然：動物的家、四季、天氣', () => {
  it('動物的家（拖曳歸類）：每個動物放進牠真正住的地方；沒有小兔子（有人說森林有人說農場，不唯一）', () => {
    const bins = NATURE.filter((q) => q.type === 'bins')
    expect(bins.length).toBeGreaterThanOrEqual(16)
    for (const q of bins) {
      expect(q.interaction).toBe('dragSort')
      expect(q.items.length, q.id).toBeGreaterThanOrEqual(2)
      const homeOf = (id: string) => q.params!.bins!.find((b) => b.id === id)!.art
      q.items.forEach((it, i) => {
        const animal = what(it.obj as string)
        expect(animal, q.id).not.toBe('rabbit')
        expect(what(homeOf(q.params!.targets![i])), `${q.id} ${animal}`).toBe(HABITAT[animal])
      })
      // 每個籃子至少放得進一個動物，籃子標籤對得上場景圖
      for (const b of q.params!.bins!) {
        expect(q.params!.targets!.includes(b.id), `${q.id} ${b.id}`).toBe(true)
        expect(b.label).toBe({ sea: '大海', forest: '森林', farm: '農場' }[what(b.art)])
      }
    }
  })
  it('下雪：台灣平地不下雪，所以只問「很冷很冷的地方」，提示說明', () => {
    const snow = NATURE.filter((q) => q.params?.fact === 'snow:winter')
    expect(snow.length).toBeGreaterThanOrEqual(3)
    for (const q of snow) {
      expect(q.prompt).toMatch(/很冷/)
      expect(q.hint).toMatch(/平地/)
    }
    for (const q of NATURE) if (/下雪|雪花/.test(q.prompt)) expect(q.prompt + q.hint, q.id).toMatch(/很冷|冷|冬天|雪人|雪花/)
  })
  it('天氣要帶什麼：下雨雨傘、大太陽太陽眼鏡、很冷外套，三種都有；圖示用 emoji（沒有專屬素材）', () => {
    const bring = NATURE.filter((q) => q.type === 'natBring')
    expect(new Set(bring.map((q) => q.answer))).toEqual(new Set(['umbrella', 'shades', 'jacket']))
    for (const q of bring) expect(q.choices.every((c) => c.emoji && !c.art), q.id).toBe(true)
  })
  it('四季題涵蓋春夏秋冬；每種動物特徵都有出現', () => {
    const seasons = NATURE.filter((q) => q.type === 'natSeason')
    for (const s of Object.keys(SEASON_NAME)) expect(seasons.some((q) => q.answer === s || q.answer === `nat-${s}`), s).toBe(true)
    expect(new Set(NATURE.filter((q) => q.params?.fact?.startsWith('trait:')).map((q) => fact(q)[1]))).toEqual(new Set(Object.keys(TRAIT_WHO)))
    expect(new Set(NATURE.filter((q) => q.params?.fact?.startsWith('name:')).map((q) => fact(q)[1].replace('obj-', '')))).toEqual(new Set(['fish', 'chick', 'rabbit', 'cow', 'bear', 'octopus']))
  })
})

describe('語音清單', () => {
  it('每一題的題目、提示、幼幼提示、要唸的字，都在中文語音清單；排序用的固定台詞也在', () => {
    const zh = allLines(QUESTIONS)
    for (const q of WORLD) {
      expect(zh[`q.${q.id}.prompt`], q.id).toBe(q.prompt)
      expect(zh[`q.${q.id}.hint`], q.id).toBe(q.hint)
      expect(zh[`q.${q.id}.hint.gentle`], q.id).toContain(q.hint)
      for (const w of q.params?.words ?? []) expect(zh[wordKey(w)], `${q.id} ${w}`).toBe(w)
    }
    expect(STATIC_LINES['order.done']).toBeTruthy()
    expect(zh['order.wrong']).toBeTruthy()
    expect(zh['ui.trick.learn.6']).toBe(learnLine('阿悟', '有禮貌地鞠躬'))
  })
  it('node scripts/export-speech-lines.mjs 匯出的清單含生活與自然的題目', () => {
    const r = spawnSync(process.execPath, ['scripts/export-speech-lines.mjs'], { encoding: 'utf8', cwd: process.cwd() })
    expect(r.status, r.stderr).toBe(0)
    const lines = JSON.parse(r.stdout) as Record<string, string>
    for (const q of [LIFE[0], LIFE[LIFE.length - 1], NATURE[0], NATURE[NATURE.length - 1]]) expect(lines[`q.${q.id}.prompt`]).toBe(q.prompt)
    expect(lines[wordKey('對不起')]).toBe('對不起')
  })
})

describe('科目、章節、技能', () => {
  it('兩個新科目各 1 章 5 站加寶箱，最後一站是 boss；生活小鎮與自然森林都在章節清單', () => {
    expect(SUBJECTS.map((s) => s.id)).toEqual(['math', 'english', 'life', 'nature'])
    for (const ch of [LIFE_TOWN, NATURE_FOREST]) {
      expect(ch.stations).toHaveLength(5)
      expect(ch.stations[4].kind).toBe('boss')
      expect(ch.chest).toEqual({ wood: 2, stone: 2, flower: 2 })
      expect(CHAPTERS).toContain(ch)
      for (const st of ch.stations) expect(st.slots).toHaveLength(5)
    }
    expect(SKILLS).toEqual(expect.arrayContaining(['life', 'nature']))
    expect(SKILL_NAMES.life).toBe('生活禮儀')
    expect(SKILL_NAMES.nature).toBe('自然常識')
  })
  it('單一技能的科目裡，拖曳歸類與排序都屬於它唯一的技能；數學不受影響', () => {
    expect(skillForInteraction('dragSort', ['nature'])).toBe('nature')
    expect(skillForInteraction('stepOrder', ['life'])).toBe('life')
    expect(skillForInteraction('pick', ['life'])).toBeUndefined()
    expect(skillForInteraction('dragSort', ['number', 'classify', 'pattern'])).toBe('classify')
    expect(skillForInteraction('tapN', ['number', 'classify', 'pattern'])).toBe('number')
  })
  it('一站的互動位置有效：自然難度 3 的「大草原」會出動物的家，難度 4 的排序位置出排序題；難度太低就退回點選', () => {
    const states = Object.fromEntries(SKILLS.map((s) => [s, initialSkillState(s, 0, 1)])) as Record<(typeof SKILLS)[number], SkillState>
    const at = (skill: 'life' | 'nature', d: 1 | 4 | 3) => ({ ...states, [skill]: { ...states[skill], difficulty: d } })
    const slots = NATURE_FOREST.stations[2].slots
    const hi = planStation({ stationIndex: 2, states: at('nature', 3), attempts: [], now: 0, rng: makeRng(1), slots, skills: ['nature'] })
    expect(hi.map((p) => p.question.interaction ?? 'pick')).toEqual(['pick', 'dragSort', 'pick', 'pick', 'pick'])
    const lo = planStation({ stationIndex: 2, states: at('nature', 1), attempts: [], now: 0, rng: makeRng(1), slots, skills: ['nature'] })
    expect(lo.every((p) => (p.question.interaction ?? 'pick') === 'pick' && p.question.skill === 'nature')).toBe(true)
    const life4 = planStation({ stationIndex: 1, states: at('life', 4), attempts: [], now: 0, rng: makeRng(2), slots: LIFE_TOWN.stations[1].slots, skills: ['life'] })
    expect(life4[2].question.interaction).toBe('stepOrder')
    expect(new Set(life4.map((p) => p.question.id)).size).toBe(5)
  })
})

describe('家長報告與阿悟的新招', () => {
  it('報告：生活與自然各有自己的技能列、白話難度說明；沒玩過是「尚無作答」', () => {
    for (const s of ['life', 'nature'] as const) for (const d of DIFFICULTIES) expect(LEVEL_LABEL[s][d].length).toBeGreaterThan(3)
    const states = Object.fromEntries(SKILLS.map((s) => [s, initialSkillState(s, 0, 1)])) as Record<(typeof SKILLS)[number], SkillState>
    const rep = buildReport([], states, Date.now())
    for (const name of ['生活禮儀', '自然常識']) expect(rep.skills.some((s) => s.name === name && s.rate === null)).toBe(true)
    for (const s of SUBJECTS) expect(rep.skills.filter((r) => s.skills.includes(r.skill)).length).toBe(s.skills.length)
  })
  it('新招「有禮貌地鞠躬」：生活技能升級就學會，自然技能升級不會；其他招不受影響', () => {
    expect(TRICKS.find((t) => t.id === 'bow')).toMatchObject({ name: '有禮貌地鞠躬', unlock: { skill: 'life' } })
    const base = { startDifficulty: 1 as const, clearedChapters: [] as string[] }
    expect(earnedTricks({ ...base, states: { life: { difficulty: 2, mastered: {} } } })).toEqual(['bow'])
    expect(earnedTricks({ ...base, states: { nature: { difficulty: 3, mastered: {} } } })).toEqual([])
    expect(earnedTricks({ ...base, states: { life: { difficulty: 1, mastered: {} } } })).toEqual([])
  })
})

describe('科目進度互相獨立（資料庫）', () => {
  const T0 = new Date(2026, 9, 27, 9, 0, 0).getTime()
  let n = 0
  let repo: Repo
  beforeEach(async () => {
    repo = new Repo(new GuaibaoDB(`world-${n++}`), () => T0)
    await repo.onboard({ pin: '1234', childName: '小明', petName: '' }, T0)
  })
  async function play(chapterId: string, station: number, now = T0) {
    const o = await repo.openStation(chapterId, station, now)
    for (const [i, p] of o.plan.entries()) {
      await repo.recordAttempt({ sessionId: o.sessionId, questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1500, review: p.review, followUp: p.followUp }, now + i)
    }
    return { o, r: await repo.completeStation({ chapterId, station, sessionId: o.sessionId }, now + 100) }
  }
  it('生活站只出生活題、自然站只出自然題；各自通關、各自的進度與難度，數學與英文都不受影響', async () => {
    const l = await play('life-town', 1)
    expect(l.o.plan.every((p) => p.question.skill === 'life')).toBe(true)
    expect(l.r.ok && l.r.material).toBe(LIFE_TOWN.stations[0].material)
    expect((await repo.getProgress('life-town')).stations.map((s) => s.done)).toEqual([true, false, false, false, false])
    for (const id of ['nature-forest', 'huaguoshan', 'english-island']) expect((await repo.getProgress(id)).stations.every((s) => !s.done), id).toBe(true)
    const nat = await play('nature-forest', 1)
    expect(nat.o.plan.every((p) => p.question.skill === 'nature')).toBe(true)
    expect((await repo.getProgress('nature-forest')).stations.map((s) => s.done)).toEqual([true, false, false, false, false])
    expect((await repo.getProgress('life-town')).stations.filter((s) => s.done)).toHaveLength(1)
    // 難度各自獨立：生活與自然升級，數學與英文都還在 1
    const st = await repo.getSkillStates()
    expect(st.life.difficulty).toBeGreaterThan(1)
    expect(st.nature.difficulty).toBeGreaterThan(1)
    expect([st.number.difficulty, st.classify.difficulty, st.pattern.difficulty, st.english.difficulty]).toEqual([1, 1, 1, 1])
    // 第 3 站要先過第 2 站
    const skip = await repo.openStation('life-town', 3, T0)
    for (const [i, p] of skip.plan.entries()) await repo.recordAttempt({ sessionId: skip.sessionId, questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
    expect((await repo.completeStation({ chapterId: 'life-town', station: 3, sessionId: skip.sessionId }, T0)).ok).toBe(false)
  })
  it('章末寶箱：生活通關 5 站才能開，只影響生活的進度', async () => {
    for (let s = 1; s <= 5; s++) expect((await play('life-town', s, T0 + s * 1000)).r.ok).toBe(true)
    const chest = await repo.claimChest('life-town', T0)
    expect(chest.ok && chest.rewards).toEqual(LIFE_TOWN.chest)
    expect((await repo.claimChest('nature-forest', T0)).ok).toBe(false)
    expect((await repo.startNextRun('life-town', T0)).ok).toBe(true)
    expect((await repo.getProgress('life-town')).run).toBe(2)
    expect((await repo.getProgress('nature-forest')).run).toBe(1)
  })
  it('每日冒險：生活與自然各有自己的 5 題與今日徽章；題目只來自自己的科目', async () => {
    for (const subject of ['life', 'nature'] as const) {
      const o = await repo.openStation(dailyChapterId(subject), 1, T0)
      expect(o.plan).toHaveLength(5)
      expect(o.plan.every((p) => p.question.skill === subject)).toBe(true)
      for (const [i, p] of o.plan.entries()) await repo.recordAttempt({ sessionId: o.sessionId, questionId: p.question.id, firstTryCorrect: true, hintsUsed: 0, durationMs: 1 }, T0 + i)
      const r = await repo.completeDaily({ chapterId: dailyChapterId(subject), sessionId: o.sessionId }, T0 + 50)
      expect(r.ok && r.badge).toBe(true)
    }
    expect((await repo.listDailyBadges()).map((b) => b.subject)).toEqual(['life', 'nature'])
    expect(await repo.db.progress.get('life-town')).toBeUndefined()
  })
  it('3 歲幼幼模式：生活與自然的難度 1 站只出幼幼題，2 選 1', async () => {
    await repo.setAgeBand('3')
    for (const ch of ['life-town', 'nature-forest']) {
      const o = await repo.openStation(ch, 1, T0)
      expect(o.plan.every((p) => p.question.gentle), ch).toBe(true)
      expect(o.plan.every((p) => p.question.choices.length === 2), ch).toBe(true)
    }
  })
})
