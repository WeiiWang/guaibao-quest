import { localDateStr } from '../domain/date'
import type { Attempt, Difficulty, SkillId, SkillState } from './types'
import { isIndependent, MAX_DIFFICULTY, SKILLS, SKILL_NAMES } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

/** 各技能各難度的白話描述（家長報告用） */
export const LEVEL_LABEL: Record<SkillId, Record<Difficulty, string>> = {
  number: { 1: '數 1–5 個、拿出幾個', 2: '數 6–10 個、比較多寡', 3: '數 11–20 個、比多幾個', 4: '10 以內加法和數序' },
  classify: { 1: '依種類分類', 2: '依顏色和種類分類', 3: '找出不同類的那一個', 4: '雙屬性（黃色的水果）' },
  pattern: { 1: 'AB 規律', 2: 'AAB、ABB 規律和補中間', 3: 'ABC 規律和補中間缺的', 4: '顏色、種類規律和成長規律' },
  english: { 1: '聽英文單字選圖', 2: '顏色、數字和看圖選單字', 3: '聽中文選英文單字', 4: '簡單拼字（補上缺的字母）' },
  life: { 1: '認識好習慣、選出對的做法', 2: '判斷好不好、紅綠燈、說謝謝對不起', 3: '說對話、步驟先後與排序', 4: '多步驟排序、說出為什麼要這樣做' },
  nature: { 1: '認天氣、認識動物', 2: '天氣要帶什麼、動物住哪裡、四季與植物', 3: '動物的家（歸類）、季節的特徵、植物生長排序', 4: '四季排序、什麼季節下雪、植物需要什麼' },
}

/** 少於這個題數，不下「穩/不穩」的結論 */
export const MIN_ATTEMPTS_FOR_VERDICT = 3

export interface SkillReport {
  skill: SkillId
  name: string
  total: number
  independent: number
  /** 無提示答對率 0–1；沒有作答時為 null */
  rate: number | null
  difficulty: Difficulty
  levelLabel: string
  text: string
}

export interface DayCount {
  date: string
  /** 當天作答題數 */
  count: number
}

export interface LearningReport {
  /** 最近 7 天（含今天）的練習回合數 = 不同 sessionId 的數量 */
  sessions: number
  totalAttempts: number
  skills: SkillReport[]
  /** 需要加強的技能（有足夠題數且無提示答對率最低者）；全部都很穩或資料不足時為 null */
  weakest: SkillId | null
  daily: DayCount[]
  summary: string
}

function skillText(name: string, label: string, rate: number | null, total: number, difficulty: Difficulty): string {
  if (rate === null || total < MIN_ATTEMPTS_FOR_VERDICT) return `${name}：這週練習還不多，多玩幾站就能看出來。`
  const pct = Math.round(rate * 100)
  if (rate >= 0.8) {
    return difficulty === MAX_DIFFICULTY
      ? `${name}（${label}）已經很穩（${pct}%），可以請孩子自己說說想法。`
      : `${name}（${label}）已經很穩（${pct}%），可以多挑戰下一個難度。`
  }
  if (rate >= 0.5) return `${name}（${label}）大致會了（${pct}%），再多練習幾次會更穩。`
  return `${name}（${label}）還需要加強（${pct}%），可以用家裡的東西、日常生活陪孩子一起聊聊看。`
}

/** 由作答紀錄與技能狀態算出家長報告（純函式，數字和 attempts 一致） */
export function buildReport(
  attempts: Attempt[],
  states: Record<SkillId, SkillState>,
  now: number,
): LearningReport {
  // 以「日曆日」算最近 7 天：今天往前 6 天
  const days: string[] = []
  for (let i = 6; i >= 0; i--) days.push(localDateStr(now - i * DAY_MS))
  const inWindow = attempts.filter((a) => days.includes(localDateStr(a.at)))

  const skills: SkillReport[] = SKILLS.map((skill) => {
    const mine = inWindow.filter((a) => a.skill === skill)
    const independent = mine.filter(isIndependent).length
    const rate = mine.length ? independent / mine.length : null
    const difficulty = states[skill].difficulty
    const name = SKILL_NAMES[skill]
    const levelLabel = LEVEL_LABEL[skill][difficulty]
    return { skill, name, total: mine.length, independent, rate, difficulty, levelLabel, text: skillText(name, levelLabel, rate, mine.length, difficulty) }
  })

  const rated = skills.filter((s) => s.rate !== null && s.total >= MIN_ATTEMPTS_FOR_VERDICT)
  const lowest = rated.length ? rated.reduce((a, b) => ((b.rate as number) < (a.rate as number) ? b : a)) : null
  // 最低的也已經 >= 80% 就不特別標「需要加強」
  const weakest = lowest && (lowest.rate as number) < 0.8 ? lowest.skill : null

  const daily = days.map((date) => ({ date, count: inWindow.filter((a) => localDateStr(a.at) === date).length }))
  const sessions = new Set(inWindow.map((a) => a.sessionId)).size

  let summary: string
  if (inWindow.length === 0) summary = '最近 7 天還沒有練習紀錄。'
  else if (weakest) {
    const w = skills.find((s) => s.skill === weakest) as SkillReport
    summary = `最近 7 天練習了 ${sessions} 回合。${w.name}最需要加強：${w.text}`
  } else summary = `最近 7 天練習了 ${sessions} 回合，目前各項都不錯。`

  return { sessions, totalAttempts: inWindow.length, skills, weakest, daily, summary }
}
