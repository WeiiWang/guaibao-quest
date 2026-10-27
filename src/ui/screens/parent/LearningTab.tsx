import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { localDateStr } from '../../../domain/date'
import { buildReport } from '../../../learning/report'
import { SUBJECTS } from '../../../learning/subject'
import { MATERIAL_IDS, MATERIAL_NAMES } from '../../../learning/types'
import { useNow } from '../../hooks'
import './learning.css'

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

/** 學習報告：本週回合數、各技能無提示答對率、需要加強的技能、每日練習量；材料與星星分開統計 */
export function LearningTab() {
  const now = useNow()
  const data = useLiveQuery(async () => {
    const [attempts, states, mats, badges] = await Promise.all([db.attempts.toArray(), repo.getSkillStates(), db.materialLedger.toArray(), repo.listDailyBadges()])
    return { attempts, states, mats, badges }
  }, [])
  if (!data) return <p className="empty">載入中…</p>

  const report = buildReport(data.attempts, data.states, now)
  const week = new Set(report.daily.map((d) => d.date))
  const earned = Object.fromEntries(MATERIAL_IDS.map((m) => [m, 0])) as Record<string, number>
  const crafted = new Set<string>()
  for (const e of data.mats) {
    if (!week.has(localDateStr(e.at))) continue
    if (e.delta > 0) earned[e.material] += e.delta
    else if (e.kind === 'craft') crafted.add(e.refId ?? e.id)
  }
  const maxDay = Math.max(1, ...report.daily.map((d) => d.count))
  const weekBadges = data.badges.filter((b) => week.has(b.date))
  const weakest = report.skills.find((s) => s.skill === report.weakest)

  return (
    <section className="lt" data-testid="learning-report">
      <div className="card lt-summary">
        <h2>最近 7 天</h2>
        <div className="lt-big">
          <div>
            <b data-testid="report-sessions">{report.sessions}</b>
            <span>練習回合</span>
          </div>
          <div>
            <b data-testid="report-attempts">{report.totalAttempts}</b>
            <span>作答題數</span>
          </div>
        </div>
        <p className="lt-text" data-testid="report-summary">{report.summary}</p>
        <p className="lt-note">一個「回合」是孩子玩完（或玩到一半離開）的一站。「無提示答對」= 第一次就答對、沒有看提示。</p>
      </div>

      <div className="card">
        <h2>各項技能</h2>
        {SUBJECTS.map((subject) => {
          const rows = report.skills.filter((s) => subject.skills.includes(s.skill))
          return (
            <div key={subject.id} className="lt-subject" data-testid={`report-subject-${subject.id}`}>
              <h3 className="lt-h3">{subject.name}</h3>
              <ul className="lt-skills">
                {rows.map((s) => (
                  <li key={s.skill} className={s.skill === report.weakest ? 'weak' : ''} data-skill={s.skill}>
                    <div className="lt-skill-head">
                      <b>{s.name}</b>
                      <span className="lt-level">目前難度 {s.difficulty}：{s.levelLabel}</span>
                      {s.skill === report.weakest && <span className="lt-flag">需要加強</span>}
                    </div>
                    <div className="lt-bar" role="img" aria-label={s.rate === null ? '尚無作答' : `無提示答對率 ${Math.round(s.rate * 100)}%`}>
                      <i style={{ width: `${s.rate === null ? 0 : Math.round(s.rate * 100)}%` }} />
                    </div>
                    <div className="lt-skill-nums">
                      <span data-testid={`rate-${s.skill}`}>{s.rate === null ? '尚無作答' : `無提示答對率 ${Math.round(s.rate * 100)}%`}</span>
                      <span data-testid={`count-${s.skill}`}>{s.total} 題（{s.independent} 題無提示答對）</span>
                    </div>
                    <p className="lt-text">{s.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        {weakest && <p className="lt-advice">建議：這幾天多陪孩子玩「{weakest.name}」，{weakest.levelLabel}的題目可以拿家裡的東西一起練。</p>}
      </div>

      <div className="card" data-testid="report-daily">
        <h2>今日冒險</h2>
        <p className="lt-text">
          最近 7 天拿到 <b data-testid="report-badges">{weekBadges.length}</b> 個今日徽章（{SUBJECTS.map((s) => `${s.name} ${weekBadges.filter((b) => b.subject === s.id).length}`).join('、')}）；累計 {data.badges.length} 個。
        </p>
        <p className="lt-note">每個科目每天第一次完成「今日冒險」就有一個徽章；沒有連續天數的要求，漏掉幾天也不會有任何損失。</p>
      </div>

      <div className="card">
        <h2>每日練習題數</h2>
        <div className="lt-days" role="img" aria-label={`最近 7 天每日作答題數：${report.daily.map((d) => d.count).join('、')}`}>
          {report.daily.map((d) => {
            const wd = WEEKDAY[new Date(d.date.replace(/-/g, '/')).getDay()]
            return (
              <div key={d.date} className="lt-day">
                <span className="lt-day-n">{d.count || ''}</span>
                <div className="lt-day-bar">
                  <i style={{ height: `${(d.count / maxDay) * 100}%` }} />
                </div>
                <span className="lt-day-l">{wd}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <h2>材料（學習獎勵）</h2>
        <p className="lt-text">
          最近 7 天獲得：{MATERIAL_IDS.map((m) => `${MATERIAL_NAMES[m]} ${earned[m]}`).join('、')}；做了 {crafted.size} 件家具。
        </p>
        <p className="lt-note">材料來自學習冒險，和任務星星分開計算；星星請看「點數紀錄」。</p>
      </div>
    </section>
  )
}
