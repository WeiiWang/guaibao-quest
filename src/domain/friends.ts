// 圖鑑「我認識的朋友」（SPEC-v5 長期目標 10、SPEC-v7 B4）：答題時遇過的物件、動物、英文單字、生活與自然的圖自動收錄。純函式。
import { OBJECTS, type LearnObject } from '../learning/objects'
import type { Question } from '../learning/types'
import { EN_WORDS } from '../learning/english'
import { ANIMALS, HOMES, LIFE_PICS, PLANT_STAGES, SEASONS, WEATHERS, WORLD_ART } from '../learning/lifeNature'
import { PROPS } from '../learning/space'

/** 圖鑑分頁 */
export type FriendTab = 'animal' | 'food' | 'thing' | 'nature' | 'life' | 'english'
export const FRIEND_TABS: { id: FriendTab; name: string }[] = [
  { id: 'animal', name: '動物' },
  { id: 'food', name: '食物' },
  { id: 'thing', name: '交通與物品' },
  { id: 'nature', name: '天氣與自然' },
  { id: 'life', name: '生活' },
  { id: 'english', name: '英文' },
]

/** 圖鑑裡的格子。art = public/art 的圖名（也是物件 id）；英文單字沒有圖時用色塊（swatch）或數字（digit） */
export interface Friend {
  id: string
  name: string
  tab: FriendTab
  /** 英文名稱（有的話，點一下會再唸英文） */
  en?: string
  art?: string
  swatch?: string
  digit?: string
  /** 缺圖時的備援 emoji */
  emoji?: string
}

/** 英文名稱（key = 物件 id）：取自英文科目的單字表 */
export const FRIEND_ENGLISH: Record<string, string> = Object.fromEntries(
  EN_WORDS.filter((w) => w.kind === 'thing' && w.art).map((w) => [w.art as string, w.word]),
)
const EN_ZH: Record<string, string> = Object.fromEntries(EN_WORDS.filter((w) => w.kind === 'thing' && w.art).map((w) => [w.art as string, w.zh]))

const LIFE_NAMES: Record<string, string> = {
  'life-wash-hands': '洗手',
  'life-dirty-hands': '髒髒的手',
  'life-messy-toys': '亂亂的玩具',
  'life-grab': '搶玩具',
  'life-litter': '亂丟垃圾',
  'life-tidy-toys': '收玩具',
  'life-queue': '排隊',
  'life-cut-line': '插隊',
  'life-thank-you': '說謝謝',
  'life-trash': '丟垃圾',
  'life-wait-red': '等紅燈',
  'life-cross-green': '過馬路',
  'life-brush-teeth': '刷牙',
  'life-eat-veg': '吃青菜',
  'life-cover-cough': '遮住嘴巴咳嗽',
  'life-bedtime': '睡覺',
}

const objTab = (o: LearnObject): FriendTab => (o.category === 'animal' ? 'animal' : o.category === 'fruit' ? 'food' : o.category ? 'thing' : 'nature')

function build(): Friend[] {
  const out = new Map<string, Friend>()
  const add = (f: Friend) => {
    if (!out.has(f.id)) out.set(f.id, { ...f, ...(FRIEND_ENGLISH[f.id] ? { en: FRIEND_ENGLISH[f.id] } : {}) })
  }
  for (const o of OBJECTS) add({ id: o.id, name: o.name, tab: objTab(o), art: o.id })
  for (const a of ANIMALS) add({ id: a.id, name: a.name, tab: 'animal', art: a.id })
  // 英文單字表裡的物件（食物、家具）：和物件同一個朋友
  for (const w of EN_WORDS) if (w.kind === 'thing' && w.art) add({ id: w.art, name: w.zh, tab: w.art.startsWith('food-') ? 'food' : 'thing', art: w.art })
  for (const p of PROPS) add({ id: p.id, name: p.name, tab: 'thing', art: p.id })
  for (const w of WEATHERS) add({ id: w.art, name: w.name, tab: 'nature', art: w.art, emoji: WORLD_ART[w.art]?.emoji })
  for (const s of SEASONS) add({ id: s.art, name: s.name, tab: 'nature', art: s.art, emoji: s.emoji })
  for (const h of HOMES) add({ id: h.art, name: h.label, tab: 'nature', art: h.art, emoji: WORLD_ART[h.art]?.emoji })
  for (const st of PLANT_STAGES) add({ id: st.art, name: st.name, tab: 'nature', art: st.art, emoji: st.emoji })
  for (const p of LIFE_PICS) add({ id: p.art, name: LIFE_NAMES[p.art] ?? p.art, tab: 'life', art: p.art, emoji: WORLD_ART[p.art]?.emoji })
  // 英文單字（每個字一個朋友，id = en:<word>）
  for (const w of EN_WORDS) {
    add({
      id: `en:${w.word}`,
      name: w.zh,
      tab: 'english',
      en: w.word,
      ...(w.kind === 'thing' ? { art: w.art } : w.kind === 'color' ? { swatch: w.swatch } : { digit: w.digit }),
    })
  }
  return [...out.values()]
}

export const FRIENDS: Friend[] = build()
const FRIEND_IDS = new Set(FRIENDS.map((f) => f.id))
export const FRIEND_BY_ID: Record<string, Friend> = Object.fromEntries(FRIENDS.map((f) => [f.id, f]))
export const friendEnZh = (id: string): string | undefined => EN_ZH[id]

/** 圖鑑總格數 */
export const friendCount = (): number => FRIENDS.length

type QLike = Pick<Question, 'items' | 'choices' | 'params'> & Partial<Pick<Question, 'skill' | 'answer' | 'interaction'>>

/** 一題裡孩子看到的所有朋友 id（題幹、選項、拖曳歸類的物件與籃子、空間方位的場景、情境圖、英文單字） */
export function objectsInQuestion(q: QLike): string[] {
  const out = new Set<string>()
  const add = (id: string | undefined | null) => {
    if (id) out.add(id)
  }
  for (const it of q.items) add(it.obj)
  for (const c of q.choices) {
    add(c.obj)
    add(c.art)
    add(c.scene?.subject)
    add(c.scene?.anchor)
  }
  add(q.params?.obj)
  for (const b of q.params?.bins ?? []) {
    add(b.obj)
    add(b.art)
  }
  add(q.params?.subject)
  add(q.params?.scene?.subject)
  add(q.params?.scene?.anchor)
  for (const a of q.params?.anchors ?? []) add(a)
  add(q.params?.stem?.art)
  const ids = [...out].filter((id) => FRIEND_IDS.has(id))
  // 英文科目：這個單字本身
  if (q.skill === 'english' && q.params?.word) ids.push(`en:${q.params.word}`)
  return ids
}

/** 這一題問的是哪個朋友（答對一次就算那個朋友答對一次）。沒有明確對象的題型（排序、翻牌、分類）回傳 null */
export function answerFriendOf(q: QLike): string | null {
  const it = q.interaction ?? 'pick'
  if (it === 'tapN') return q.params?.obj && FRIEND_IDS.has(q.params.obj) ? q.params.obj : null
  if (it === 'place') return q.params?.subject && FRIEND_IDS.has(q.params.subject) ? q.params.subject : null
  if (it !== 'pick') return null
  if (q.skill === 'english') return q.params?.word ? `en:${q.params.word}` : null
  const c = q.choices.find((x) => x.id === q.answer)
  const id = c?.obj ?? c?.art
  return id && FRIEND_IDS.has(id) ? id : null
}

/** 從作答過的題目算出認識的朋友 id 集合 */
export function knownFriendIds(questions: Iterable<QLike>): Set<string> {
  const known = new Set<string>()
  for (const q of questions) for (const id of objectsInQuestion(q)) known.add(id)
  return known
}

/** 熟悉度：1 認識（遇過 1 次）、2 好朋友（答對 3 次，銀框）、3 超級好朋友（答對 10 次，金框閃光） */
export type Familiarity = 0 | 1 | 2 | 3
export const FRIEND_RIGHT_SILVER = 3
export const FRIEND_RIGHT_GOLD = 10
export const FAMILIARITY_NAMES: Record<Familiarity, string> = { 0: '還不認識', 1: '認識', 2: '好朋友', 3: '超級好朋友' }

export interface FriendStat {
  /** 遇過幾次（出現在幾次作答的題目裡） */
  seen: number
  /** 答對幾次（問的就是這個朋友、第一次就答對） */
  right: number
}

export function familiarityOf(s: FriendStat | undefined): Familiarity {
  if (!s || s.seen < 1) return 0
  return s.right >= FRIEND_RIGHT_GOLD ? 3 : s.right >= FRIEND_RIGHT_SILVER ? 2 : 1
}

/** 從作答紀錄算每個朋友的遇過與答對次數（題庫改版後找不到的題目略過） */
export function friendStats(
  attempts: Iterable<{ questionId: string; firstTryCorrect: boolean }>,
  lookup: (id: string) => QLike | undefined,
): Record<string, FriendStat> {
  const out: Record<string, FriendStat> = {}
  for (const a of attempts) {
    const q = lookup(a.questionId)
    if (!q) continue
    for (const id of objectsInQuestion(q)) (out[id] ??= { seen: 0, right: 0 }).seen++
    const ans = answerFriendOf(q)
    if (ans && a.firstTryCorrect) (out[ans] ??= { seen: 0, right: 0 }).right++
  }
  return out
}

/** 圖鑑每收集到總數的 1/8（至少 2 個）就送 1 份禮物，所以整個圖鑑至少有 8 份獎勵 */
export const collectionStep = (total: number = FRIENDS.length): number => Math.max(2, Math.floor(total / 8))
