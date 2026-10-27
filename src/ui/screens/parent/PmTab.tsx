import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { pmAddFood, pmAddMaterials, pmAddStars, pmClearPoops, pmGrantGift, pmLockChapters, pmOwnAllDecor, pmQueueTrickCelebrations, pmSetHunger, pmSetStage, pmUnlockAllTricks, pmUnlockChapters } from '../../../db/pm'
import { repo } from '../../../db/repo'
import { TRICKS } from '../../../domain/tricks'
import { getFastSchedule, sendPetCommand, setFastSchedule, setTodMode, type PetCommand } from '../../../pet/bus'
import type { TodMode } from '../../../pet/daynight'
import { useTodMode } from '../../pet/hooks'
import type { Stage } from '../../../domain/types'
import { useCelebrate, useToast } from '../../hooks'
import { Art } from '../../components/Art'
import './learning.css'

const STAGES: { id: Stage; label: string; art: string }[] = [
  { id: 'egg', label: '仙石蛋', art: 'pet-egg' },
  { id: 'baby', label: '小猴', art: 'pet-baby-happy' },
  { id: 'adult', label: '阿悟', art: 'pet-adult-happy' },
]

/** 觸發寵物行為（SPEC-v3 A7）：按下後回首頁立刻執行 */
const BEHAVIORS: { cmd: PetCommand; label: string }[] = [
  { cmd: 'sing', label: '唱歌' },
  { cmd: 'dance', label: '跳舞' },
  { cmd: 'walk', label: '散步' },
  { cmd: 'sneeze', label: '打噴嚏' },
  { cmd: 'yawn', label: '打哈欠' },
  { cmd: 'gaze', label: '發呆看窗外' },
  { cmd: 'wave', label: '揮手' },
  { cmd: 'rubTummy', label: '摸肚子' },
  { cmd: 'pinchNose', label: '捏鼻子' },
  { cmd: 'poop', label: '大便' },
  { cmd: 'sleep', label: '睡覺' },
  { cmd: 'wake', label: '醒來' },
]
const TOD_OPTIONS: { id: TodMode; label: string }[] = [
  { id: 'auto', label: '跟隨真實時間' },
  { id: 'day', label: '白天' },
  { id: 'dusk', label: '傍晚' },
  { id: 'night', label: '晚上' },
]

/** PM 預覽：切換寵物階段、補資源、觸發動畫，不用實際遊玩就能看各種狀態 */
export function PmTab({ onExit }: { onExit: () => void }) {
  const toast = useToast()
  const tod = useTodMode()
  const [fast, setFast] = useState(getFastSchedule)
  const celebrate = useCelebrate()
  const pet = useLiveQuery(() => db.pets.get('pet'), [])
  const unlocks = useLiveQuery(() => repo.getChapterUnlocks(), [])
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

      <div className="card" data-testid="pm-behaviors">
        <h2>觸發寵物行為</h2>
        <p className="lt-note">按下後會回到首頁並立刻執行（要在首頁、非佈置模式才會演）。</p>
        <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {BEHAVIORS.map((b) => (
            <button
              key={b.cmd}
              className="btn"
              data-cmd={b.cmd}
              onClick={() => {
                sendPetCommand(b.cmd)
                onExit()
              }}
            >
              {b.label}
            </button>
          ))}
          <button className="btn" data-cmd="clear-poops" onClick={() => run(pmClearPoops, '已清空所有便便')}>清空便便</button>
        </div>
        <h2 style={{ marginTop: 16 }}>日夜</h2>
        <p className="lt-note">目前：{TOD_OPTIONS.find((o) => o.id === tod)?.label}。切到「晚上」阿悟會去睡覺；回首頁看窗外與房間變化。</p>
        <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {TOD_OPTIONS.map((o) => (
            <button key={o.id} className={`btn ${tod === o.id ? 'primary' : ''}`} data-tod={o.id} aria-pressed={tod === o.id} onClick={() => setTodMode(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        <h2 style={{ marginTop: 16 }}>自主行為</h2>
        <p className="lt-note">平常閒置 15–40 秒才會自己動一下。測試時可以加速成 2–4 秒。</p>
        <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
          <button
            className={`btn ${fast ? 'primary' : ''}`}
            data-testid="pm-fast"
            aria-pressed={fast}
            onClick={() => {
              setFastSchedule(!fast)
              setFast(!fast)
            }}
          >
            加速排程：{fast ? '開' : '關'}
          </button>
        </div>
      </div>

      <div className="card" data-testid="pm-tricks">
        <h2>新招與禮物</h2>
        <p className="lt-note">已學會：{pet.tricks?.length ? TRICKS.filter((t) => pet.tricks?.includes(t.id)).map((t) => t.name).join('、') : '還沒有'}。表演要回首頁、非佈置模式才會演（蛋不會表演）。</p>
        <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn" data-pm="unlock-tricks" onClick={() => run(async () => toast(`已解鎖全部 ${await pmUnlockAllTricks()} 招`, 'ok'), '')}>解鎖全部新招</button>
          <button className="btn" data-pm="celebrate-tricks" onClick={async () => { await pmQueueTrickCelebrations(); onExit() }}>重播新招慶祝（回首頁）</button>
          <button
            className="btn primary"
            data-cmd="trick:all"
            onClick={() => {
              sendPetCommand('trick:all')
              onExit()
            }}
          >
            表演每一招
          </button>
          <button className="btn" data-pm="gift" onClick={async () => { await pmGrantGift(); onExit() }}>送一份小禮物（回首頁）</button>
        </div>
        <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginTop: 8 }}>
          {TRICKS.map((t) => (
            <button
              key={t.id}
              className="btn"
              data-cmd={`trick:${t.id}`}
              onClick={() => {
                sendPetCommand(`trick:${t.id}` as PetCommand)
                onExit()
              }}
            >
              {t.emoji} {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="card" data-testid="pm-chapters">
        <h2>章節</h2>
        <p className="lt-note">
          水簾洞（數學第 2 章）：{unlocks?.shuiliandong ? '已開放' : '還沒開放，要先通關花果山'}。直接解鎖後，地圖上的章節選擇就能切到水簾洞。
        </p>
        <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn primary" data-pm="unlock-chapters" onClick={() => run(async () => toast(`已解鎖 ${await pmUnlockChapters()} 章`, 'ok'), '')}>解鎖水簾洞</button>
          <button className="btn" data-pm="lock-chapters" onClick={() => run(() => pmLockChapters(), '已把 PM 解鎖的章節鎖回去')}>鎖回去</button>
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
