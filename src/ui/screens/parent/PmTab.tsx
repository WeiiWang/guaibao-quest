import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { pmAddFood, pmAddMaterials, pmAddStars, pmOwnAllDecor, pmSetHunger, pmSetStage } from '../../../db/pm'
import type { Stage } from '../../../domain/types'
import { useCelebrate, useToast } from '../../hooks'
import { Art } from '../../components/Art'
import './learning.css'

const STAGES: { id: Stage; label: string; art: string }[] = [
  { id: 'egg', label: '仙石蛋', art: 'pet-egg' },
  { id: 'baby', label: '小猴', art: 'pet-baby-happy' },
  { id: 'adult', label: '阿悟', art: 'pet-adult-happy' },
]

/** PM 預覽：切換寵物階段、補資源、觸發動畫，不用實際遊玩就能看各種狀態 */
export function PmTab({ onExit }: { onExit: () => void }) {
  const toast = useToast()
  const celebrate = useCelebrate()
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    await fn()
    toast(msg, 'ok')
  }
  if (!pet) return null

  return (
    <section className="lt pm-tab" data-testid="pm-tab">
      <div className="card">
        <h2>PM 預覽（測試用）</h2>
        <p className="lt-note">直接切換狀態來檢視畫面。會繞過每日星星上限；正式給測試家庭前會關掉這個分頁。</p>
      </div>

      <div className="card">
        <h2>寵物階段</h2>
        <p className="lt-note">目前：{STAGES.find((s) => s.id === pet.stage)?.label}（已餵 {pet.feedCount} 次）</p>
        <div className="pm-stages">
          {STAGES.map((s) => (
            <button key={s.id} className={`btn pm-stage ${pet.stage === s.id ? 'primary' : ''}`} onClick={() => run(() => pmSetStage(s.id), `已切換成${s.label}`)}>
              <Art name={s.art} alt={s.label} size={72} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
        <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => run(() => pmSetStage('egg', true), '已設成「再餵 1 次就孵化」，回首頁餵一次看看')}>快孵化（再餵 1 次）</button>
          <button className="btn" onClick={() => run(() => pmSetStage('baby', true), '已設成「再餵 1 次就長大」')}>快長大（再餵 1 次）</button>
          <button className="btn" onClick={() => celebrate({ petName: pet.name, from: 'egg', to: 'baby', feedCount: pet.feedCount })}>播放孵化慶祝</button>
          <button className="btn" onClick={() => celebrate({ petName: pet.name, from: 'baby', to: 'adult', feedCount: pet.feedCount })}>播放長大慶祝</button>
        </div>
      </div>

      <div className="card">
        <h2>飽足度</h2>
        <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => run(() => pmSetHunger(100), '飽足 100')}>吃飽（100）</button>
          <button className="btn" onClick={() => run(() => pmSetHunger(45), '飽足 45')}>普通（45）</button>
          <button className="btn" onClick={() => run(() => pmSetHunger(5), '飽足 5')}>好餓（5）</button>
        </div>
      </div>

      <div className="card">
        <h2>補資源</h2>
        <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => run(() => pmAddStars(100), '+100 星星')}>+100 星星</button>
          <button className="btn" onClick={() => run(() => pmAddMaterials(20), '每種材料 +20')}>材料各 +20</button>
          <button className="btn" onClick={() => run(async () => toast(`${await pmAddFood(5)} 種食物各 +5`, 'ok'), '')}>食物各 +5</button>
          <button className="btn" onClick={() => run(async () => toast(`擁有全部 ${await pmOwnAllDecor()} 件家具`, 'ok'), '')}>擁有全部家具</button>
        </div>
      </div>

      <div className="row-actions">
        <button className="btn primary" onClick={onExit}>回首頁看看</button>
      </div>
    </section>
  )
}
