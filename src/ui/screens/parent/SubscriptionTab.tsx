import { useState } from 'react'
import { Modal } from '../../components/Modal'
import './learning.css'
import { usePetText } from '../../species'

const FREE = ['花果山第一章（5 站）', '每日任務與星星', '寵物阿悟與房間佈置', '著色本與基本學習報告']
const PAID = ['之後的章節：水簾洞、龍宮…', '更多題庫與難度', '進階學習報告（每週摘要）', '更多家具與阿悟的新造型']

/** 訂閱方案（樣品）。只放在家長區；Prototype 不接任何付款。 */
export function SubscriptionTab() {
  const pt = usePetText()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <section className="lt" data-testid="subscription-tab">
      <div className="card lt-sample">
        <span className="lt-flag">樣品畫面</span>
        <h2>訂閱方案</h2>
        <p className="lt-note">這是 Prototype 的示意頁面，用來和家長確認方案內容，不會真的扣款。</p>
        <div className="lt-plans">
          <div className="lt-plan">
            <h3>免費</h3>
            <p className="lt-price">NT$0</p>
            <ul>
              {FREE.map((f) => (
                <li key={f}>{pt(f)}</li>
              ))}
            </ul>
          </div>
          <div className="lt-plan paid">
            <h3>完整版</h3>
            <p className="lt-price">
              NT$149<small> / 月</small>
            </p>
            <p className="lt-price alt">
              NT$990<small> / 年（約 5.5 折優惠）</small>
            </p>
            <ul>
              <li>包含免費版全部內容</li>
              {PAID.map((f) => (
                <li key={f}>{pt(f)}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn primary" onClick={() => setMsg('Prototype 尚未開放付款')} data-testid="buy-month">訂閱月方案 NT$149</button>
          <button className="btn primary" onClick={() => setMsg('Prototype 尚未開放付款')} data-testid="buy-year">訂閱年方案 NT$990</button>
          <button className="btn" onClick={() => setMsg('Prototype 尚未開放付款，沒有可以恢復的購買')} data-testid="restore">恢復購買</button>
        </div>
        <h3 className="lt-h3">自動續訂與取消</h3>
        <ul className="lt-terms">
          <li>訂閱會在每個週期結束前 24 小時自動續訂，並向你的 App Store / Google Play 帳號扣款。</li>
          <li>隨時可以在裝置的「訂閱」設定中取消，取消後可使用到目前週期結束。</li>
          <li>換新手機時，按「恢復購買」即可找回已訂閱的內容。</li>
        </ul>
      </div>
      {msg && (
        <Modal title="提示" onClose={() => setMsg(null)}>
          <p className="lead" data-testid="subscription-msg">{msg}</p>
          <button className="btn primary wide" onClick={() => setMsg(null)}>知道了</button>
        </Modal>
      )}
    </section>
  )
}
