import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { getChapter, HUAGUOSHAN } from '../../../learning/chapter'
import { playSfx } from '../../../learning/sfx'
import { sayChain } from '../../../learning/speech'
import { nextChapterOf, subjectOfChapter } from '../../../learning/subject'
import { pickLine } from '../../../learning/lines'
import { MATERIAL_IDS, MATERIAL_NAMES, type MaterialCost } from '../../../learning/types'
import { MAT_EMOJI } from '../../../art/items'
import { Icon } from '../../components/Icon'
import { MaterialsChip } from '../../components/MaterialsChip'
import { useLearningSettings } from '../../learningHooks'
import { writeChapter } from './subjectPref'
import type { Screen } from '../../App'
import { Companion } from './Companion'
import './adventure.css'

/** 章末儀式：打開寶箱 → 阿悟歡呼 → 額外材料 → 「今天的冒險完成了！」（chapterId 是哪一章的寶箱，沒給就是花果山） */
export function Ceremony({ chapterId, onMap, go }: { chapterId?: string; onMap: () => void; go: (s: Screen) => void }) {
  const ch = (chapterId && getChapter(chapterId)) || HUAGUOSHAN
  // 通關後會開放的下一章（花果山 → 水簾洞）
  const next = nextChapterOf(ch.id)
  const { soundOn, voiceOn } = useLearningSettings()
  const prog = useLiveQuery(() => db.progress.get(ch.id), [])
  const [rewards, setRewards] = useState<MaterialCost | null>(null)
  const [error, setError] = useState('')
  const busy = useRef(false)

  // 這輪的寶箱已經開過（重新進來）：直接顯示結尾畫面
  const alreadyOpened = !!prog?.chestClaimed && !rewards

  const open = async () => {
    if (busy.current) return
    busy.current = true
    const r = await repo.claimChest(ch.id)
    busy.current = false
    if (!r.ok) {
      setError(r.error)
      return
    }
    setRewards(r.rewards)
  }

  const opened = !!rewards
  useEffect(() => {
    if (!opened) return
    playSfx('reward', soundOn)
    const l = pickLine('ceremony.done')
    const open = pickLine('ui.chapter', 1)
    sayChain([{ key: l.key, text: l.text }, ...(next ? [{ key: open.key, text: open.text }] : [])], { enabled: voiceOn })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])

  return (
    <main className="adv adv-ceremony" data-testid="ceremony">
      <div className="adv-cere-stage">
        <div className={`adv-chest ${opened ? 'open' : ''}`}>
          <Icon name="ui-chest" emoji="🎁" alt="寶箱" size={opened ? 150 : 170} />
        </div>
        <Companion pose={opened || alreadyOpened ? 'cheer' : 'happy'} size="clamp(120px, 22dvh, 180px)" className="adv-cere-pet" />
        {opened && (
          <div className="adv-confetti" aria-hidden>
            {Array.from({ length: 16 }, (_, i) => (
              <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 5) * 0.12}s` }} />
            ))}
          </div>
        )}
      </div>

      {!opened && !alreadyOpened && (
        <>
          <h1>{ch.name}全部通關了！</h1>
          <p className="adv-sub">寶箱裡有額外的材料，打開看看吧。</p>
          <button className="adv-btn primary big" onClick={open} data-testid="claim-chest">打開寶箱</button>
        </>
      )}

      {(opened || alreadyOpened) && (
        <>
          <h1 data-testid="ceremony-title">今天的冒險完成了！</h1>
          {rewards && (
            <div className="adv-cere-rewards" data-testid="chest-rewards">
              {MATERIAL_IDS.filter((m) => rewards[m] > 0).map((m, i) => (
                <span key={m} className="reward-pop" style={{ animationDelay: `${i * 0.25}s` }}>
                  <Icon name={`mat-${m}`} emoji={MAT_EMOJI[m]} alt={MATERIAL_NAMES[m]} size={72} />
                  <b>× {rewards[m]}</b>
                </span>
              ))}
            </div>
          )}
          {alreadyOpened && <p className="adv-sub">這一輪的寶箱已經打開囉。</p>}
          <MaterialsChip />
          {next && (
            <p className="adv-sub" data-testid="next-chapter-open">
              {next.name}開門囉！
            </p>
          )}
          <div className="adv-actions">
            {next && (
              <button
                className="adv-btn primary"
                onClick={() => {
                  const subject = subjectOfChapter(ch.id)
                  if (subject) writeChapter(subject.id, next.id)
                  onMap()
                }}
                data-testid="to-next-chapter"
              >
                去{next.name}
              </button>
            )}
            <button className={`adv-btn ${next ? '' : 'primary'}`} onClick={() => go({ name: 'workshop' })} data-testid="to-workshop">去工坊做家具</button>
            <button className="adv-btn" onClick={onMap} data-testid="back-to-map">回地圖</button>
          </div>
        </>
      )}
      {error && <p className="adv-error" role="alert">{error}</p>}
    </main>
  )
}
