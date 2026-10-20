import { useState } from 'react'
import { repo } from '../../../db/repo'
import { useBalance, useToast } from '../../hooks'
import { QuotaLine } from './ReviewTab'

export function PointsTab() {
  const toast = useToast()
  const balance = useBalance()
  const [amount, setAmount] = useState('10')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)

  const n = Number(amount)

  const give = async () => {
    const r = await repo.grantBonus(n, reason)
    if (!r.ok) return setMsg({ text: r.error, tone: 'warn' })
    if (r.granted === 0) setMsg({ text: '今日已達上限，沒有發放點數', tone: 'warn' })
    else if (r.capped) setMsg({ text: `今日已達上限，只發放了 ${r.granted} 點`, tone: 'warn' })
    else setMsg({ text: `已加 ${r.granted} 點`, tone: 'ok' })
    if (r.ok && r.granted > 0) toast(`+${r.granted} 點`, 'ok')
    setReason('')
  }
  const take = async () => {
    const r = await repo.applyPenalty(n, reason)
    if (!r.ok) return setMsg({ text: r.error, tone: 'warn' })
    setMsg({ text: `已扣 ${n} 點`, tone: 'ok' })
    setReason('')
  }

  return (
    <section className="card form">
      <p className="balance-line">目前餘額：<b>⭐ {balance}</b></p>
      <QuotaLine />
      <label className="field">
        點數
        <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
      </label>
      <div className="quick">
        {[5, 10, 20, 50].map((v) => (
          <button key={v} className="btn" onClick={() => setAmount(String(v))}>{v}</button>
        ))}
      </div>
      <label className="field">
        理由
        <input className="input" value={reason} maxLength={30} placeholder="例：今天很乖" onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="row-actions">
        <button className="btn danger" onClick={take} disabled={!(n > 0)}>扣點</button>
        <button className="btn primary" onClick={give} disabled={!(n > 0)}>加點</button>
      </div>
      {msg && <p className={`form-msg ${msg.tone}`} role="status">{msg.text}</p>}
    </section>
  )
}
