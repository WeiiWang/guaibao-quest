import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { sortAlbum } from '../../../domain/album'
import { localDateStr } from '../../../domain/date'
import { trickOf } from '../../../domain/tricks'
import { buildWeekly } from '../../../domain/weekly'
import { useProfiles } from '../../../profiles/context'
import { MemoryCard } from '../../components/MemoryCard'
import { PlayWeekly } from '../../play/PlayWeekly'
import { useNow } from '../../hooks'
import './learning.css'
import './weekly.css'

const md = (date: string) => {
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d}`
}

/** 家長週報：這一週（最近 7 天）練了幾天、各科目學會了什麼（白話）、阿悟學會的新招、在家這樣練，以及成長相簿 */
export function WeeklyTab() {
  const now = useNow()
  const profiles = useProfiles()
  const data = useLiveQuery(async () => {
    const [attempts, states, settings, pet] = await Promise.all([db.attempts.toArray(), repo.getSkillStates(), db.settings.get('main'), db.pets.get('pet')])
    return { attempts, states, album: settings?.album ?? [], childName: settings?.childName ?? '', petName: pet?.name ?? '阿悟' }
  }, [])
  if (!data) return <p className="empty">載入中…</p>

  const report = buildWeekly(data.attempts, data.states, data.album, now)
  const cards = sortAlbum(data.album)
  const many = (profiles?.children.length ?? 1) > 1
  const today = localDateStr(now)

  return (
    <section className="lt wk" data-testid="weekly-report">
      <div className="card wk-head">
        <h2 data-testid="weekly-child">{data.childName || '孩子'}的本週報告</h2>
        <p className="lt-note">{md(report.from)} 到 {md(report.to)}（最近 7 天，今天是 {md(today)}）</p>
        {many && (
          <p className="lt-tip" data-testid="weekly-switch-note">
            現在看的是「{data.childName}」。要看其他孩子的報告：點上方的孩子頭像就能切換，不用離開家長區。
          </p>
        )}
        <div className="lt-big">
          <div>
            <b data-testid="weekly-days">{report.practiceDays}</b>
            <span>練習天數（共 7 天）</span>
          </div>
          <div>
            <b data-testid="weekly-attempts">{report.attempts}</b>
            <span>作答題數</span>
          </div>
          <div>
            <b data-testid="weekly-tricks-count">{report.tricks.length}</b>
            <span>{data.petName}學會的新招</span>
          </div>
        </div>
        {report.empty && <p className="lt-text" data-testid="weekly-empty">這一週還沒有練習紀錄。孩子玩幾站冒險之後，這裡就會出現他學會了什麼。</p>}
      </div>

      <div className="card" data-testid="weekly-subjects">
        <h2>各科目學會了什麼</h2>
        {report.subjects.map((s) => (
          <div key={s.id} className="wk-subject" data-testid={`weekly-subject-${s.id}`} data-practiced={s.practiced}>
            <h3 className="lt-h3">{s.name}</h3>
            {!s.practiced ? (
              <p className="lt-note">這一週還沒有練習{s.name}。</p>
            ) : (
              <ul className="wk-skills">
                {s.skills
                  .filter((k) => k.total > 0)
                  .map((k) => (
                    <li key={k.skill} data-weekly-skill={k.skill} className={k.newlyMastered.length ? 'new' : ''}>
                      {k.newlyMastered.length > 0 && <span className="lt-flag wk-flag">新學會</span>}
                      <p className="lt-text">{k.text}</p>
                    </li>
                  ))}
              </ul>
            )}
            {s.practiced && s.skills.some((k) => k.total === 0) && (
              <p className="lt-note">還沒練：{s.skills.filter((k) => k.total === 0).map((k) => k.name).join('、')}</p>
            )}
          </div>
        ))}
      </div>

      <div className="card" data-testid="weekly-tricks">
        <h2>{data.petName}這週學會的新招</h2>
        {report.tricks.length === 0 ? (
          <p className="lt-note">這週沒有新招。孩子的技能進步或通關章節，{data.petName}就會學會新本領。</p>
        ) : (
          <ul className="wk-tricks">
            {report.tricks.map((c) => {
              const def = trickOf(c.id.replace(/^trick:/, ''))
              return (
                <li key={c.id} data-trick={c.id}>
                  <span className="wk-trick-emoji" aria-hidden>{def?.emoji ?? '🎪'}</span>
                  <div>
                    <b>{def?.name ?? c.caption}</b>
                    <p className="lt-note">{def?.hint ?? c.caption}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <PlayWeekly />

      <div className="card" data-testid="weekly-tips">
        <h2>在家這樣練</h2>
        <p className="lt-note">依孩子這週練過的技能挑選，需要加強的排前面。不用一次全做，挑一個今天順手的就好。</p>
        {report.homeTips.map((t) => (
          <div key={t.skill} className="wk-tip-group" data-tip-skill={t.skill}>
            <h3 className="lt-h3">{t.skill === 'generic' ? '一般建議' : t.name}</h3>
            <ul className="wk-tip-list">
              {t.tips.map((tip) => (
                <li key={tip} className="lt-text">{tip}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="card" data-testid="weekly-album">
        <h2>成長相簿</h2>
        {cards.length === 0 ? (
          <p className="lt-note">還沒有回憶卡。{data.petName}孵化、長大、學會新招、通關章節、得到第一頂帽子時，會自動留下一張。</p>
        ) : (
          <>
            <p className="lt-note">共 {cards.length} 張。孩子也能在首頁「更多」→「相簿」翻閱。</p>
            <ul className="wk-album">
              {cards.map((c) => (
                <li key={c.id}>
                  <MemoryCard card={c} petName={data.petName} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
