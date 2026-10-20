import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { localDateStr } from '../../../domain/date'
import { DAILY_LIMIT_OPTIONS, EXTEND_MINUTES, limitLabel, remainingSeconds } from '../../../learning/playtime'
import { useNow, useToast } from '../../hooks'
import { useLearningSettings } from '../../learningHooks'
import './learning.css'

const mins = (s: number) => `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`

/** 每日遊玩時間：15/20/30/45/不限；今天已玩多久；家長延長 10 分鐘 */
export function PlayTimeTab() {
  const toast = useToast()
  const now = useNow()
  const date = localDateStr(now)
  const { dailyLimitMin } = useLearningSettings()
  const pt = useLiveQuery(() => db.playTime.get(date).then((r) => r ?? null), [date])
  const rest = remainingSeconds(dailyLimitMin, pt ?? undefined)

  return (
    <section className="lt" data-testid="playtime-tab">
      <div className="card">
        <h2>每日遊玩時間</h2>
        <p className="lt-text">到時間，阿悟會打哈欠說「我想睡覺了」，學習與餵食會鎖住。只計算孩子在前景使用的時間，家長區不算。</p>
        <div className="lt-choices" role="radiogroup" aria-label="每日遊玩時間上限">
          {DAILY_LIMIT_OPTIONS.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={dailyLimitMin === m}
              className={`lt-choice ${dailyLimitMin === m ? 'on' : ''}`}
              onClick={async () => {
                const r = await repo.setLearningSettings({ dailyLimitMin: m })
                toast(r.ok ? `已設定：${limitLabel(m)}` : r.error, r.ok ? 'ok' : 'warn')
              }}
            >
              {limitLabel(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>今天</h2>
        <div className="lt-big">
          <div>
            <b data-testid="playtime-used">{mins(pt?.seconds ?? 0)}</b>
            <span>已經玩了</span>
          </div>
          <div>
            <b data-testid="playtime-rest">{rest === null ? '不限' : mins(rest)}</b>
            <span>還剩下</span>
          </div>
        </div>
        {(pt?.bonusSeconds ?? 0) > 0 && <p className="lt-note">今天已延長 {Math.round((pt?.bonusSeconds ?? 0) / 60)} 分鐘。</p>}
        <button
          className="btn primary"
          onClick={async () => {
            await repo.addBonusTime(date, EXTEND_MINUTES)
            toast(`今天多了 ${EXTEND_MINUTES} 分鐘`, 'ok')
          }}
          disabled={dailyLimitMin === 0}
          data-testid="extend-btn"
        >
          延長 {EXTEND_MINUTES} 分鐘
        </button>
        {dailyLimitMin === 0 && <p className="lt-note">目前設定為不限時間，不需要延長。</p>}
      </div>
    </section>
  )
}
