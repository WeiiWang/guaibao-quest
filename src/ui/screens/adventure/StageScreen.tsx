import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { repo, newId } from '../../../db/repo'
import { getChapter } from '../../../learning/chapter'
import { STATION_SIZE } from '../../../learning/scoring'
import { cancelSpeech, speak } from '../../../learning/speech'
import { playSfx } from '../../../learning/sfx'
import { MATERIAL_NAMES, type MaterialId, type SkillId } from '../../../learning/types'
import type { PlannedQuestion } from '../../../learning/select'
import { MAT_EMOJI } from '../../../art/items'
import { Icon } from '../../components/Icon'
import { MaterialsChip } from '../../components/MaterialsChip'
import { flyOne } from '../../fly'
import { useLearningSettings } from '../../learningHooks'
import { Companion, type Pose } from './Companion'
import { QuestionView, type HintStage } from './QuestionView'
import './adventure.css'

const PRAISE = ['答對了！', '好棒喔！', '太厲害了！', '你真聰明！']
const AUTO_NEXT_MS = 1600

interface StationResult {
  independent: number
  total: number
  material: MaterialId
  qty: number
  chapterDone: boolean
  newlyMastered: SkillId[]
}

interface Props {
  chapterId: string
  station: number
  onExit: () => void
  onNextStation: (station: number) => void
  onCeremony: () => void
}

/** 關卡答題畫面：一站 5 題，混合三種技能 */
export function StageScreen({ chapterId, station, onExit, onNextStation, onCeremony }: Props) {
  const chapter = getChapter(chapterId)
  const def = chapter?.stations[station - 1]
  const { soundOn, voiceOn } = useLearningSettings()
  const sessionId = useRef(newId())
  const [plan, setPlan] = useState<PlannedQuestion[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [hintStage, setHintStage] = useState<HintStage>(0)
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set())
  const [solved, setSolved] = useState(false)
  const [praise, setPraise] = useState('')
  const [result, setResult] = useState<StationResult | null>(null)
  const [error, setError] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)
  const startedAt = useRef(Date.now())
  const solvedRef = useRef(false)
  const nextTimer = useRef<number | undefined>(undefined)
  const finishing = useRef(false)
  const writes = useRef<Promise<unknown>[]>([])

  // 載入這一站的題目
  useEffect(() => {
    let cancelled = false
    repo
      .planStation(station - 1)
      .then((p) => !cancelled && setPlan(p))
      .catch(() => !cancelled && setError('題目載入失敗，請回到地圖再試一次'))
    return () => {
      cancelled = true
    }
  }, [station])

  useEffect(
    () => () => {
      window.clearTimeout(nextTimer.current)
      cancelSpeech()
    },
    [],
  )

  // 結算：材料彈出後，一個一個飛進右上角的材料膠囊
  useEffect(() => {
    if (!result) return
    const timers: number[] = []
    const id = window.setTimeout(() => {
      const target = document.querySelector(`[data-materials-chip] [data-material="${result.material}"]`)
      cardRef.current?.querySelectorAll<HTMLElement>('[data-reward]').forEach((el, i) => {
        const r = el.getBoundingClientRect()
        const clone = el.cloneNode(true) as HTMLElement
        clone.style.cssText = 'display:grid;width:100%;height:100%;animation:none;visibility:visible'
        void flyOne({ rect: r, node: clone, hide: el }, target, { delay: i * 160, duration: 900 })
      })
    }, 1500)
    timers.push(id)
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [result])

  const current = plan?.[idx]
  const q = current?.question

  // 換題：重置狀態並唸題
  useEffect(() => {
    if (!q) return
    startedAt.current = Date.now()
    solvedRef.current = false
    const id = window.setTimeout(() => speak(q.prompt, { enabled: voiceOn }), 350)
    return () => window.clearTimeout(id)
    // 只在換題時唸；語音開關變動不重唸
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id])

  const finish = useCallback(async () => {
    if (finishing.current) return
    finishing.current = true
    await Promise.all(writes.current)
    const r = await repo.completeStation({ chapterId, station, sessionId: sessionId.current })
    if (!r.ok) {
      setError(r.error)
      return
    }
    playSfx('reward', soundOn)
    speak(r.chapterDone ? '太棒了，這一章全部通關了！' : '這一站過關了！', { enabled: voiceOn })
    setResult(r)
  }, [chapterId, station, soundOn, voiceOn])

  const advance = useCallback(() => {
    window.clearTimeout(nextTimer.current)
    if (!plan) return
    if (idx + 1 >= plan.length) {
      void finish()
      return
    }
    setIdx((i) => i + 1)
    setHintStage(0)
    setTapped(new Set())
    setSolved(false)
    setPraise('')
  }, [plan, idx, finish])

  const pick = (choiceId: string) => {
    if (!q || !current || solvedRef.current || tapped.has(choiceId)) return
    if (choiceId === q.answer) {
      solvedRef.current = true
      setSolved(true)
      const p = PRAISE[Math.floor(Math.random() * PRAISE.length)]
      setPraise(p)
      playSfx('correct', soundOn)
      speak(p, { enabled: voiceOn })
      const w = repo.recordAttempt({
        sessionId: sessionId.current,
        questionId: q.id,
        firstTryCorrect: hintStage === 0,
        hintsUsed: hintStage,
        durationMs: Date.now() - startedAt.current,
        review: current.review,
        followUp: current.followUp,
      })
      writes.current.push(w)
      nextTimer.current = window.setTimeout(advance, AUTO_NEXT_MS)
      return
    }
    // 答錯：不扣分。第一次給提示；第二次（或只剩一個選項）標出正確答案
    playSfx('wrong', soundOn)
    const nextTapped = new Set(tapped).add(choiceId)
    setTapped(nextTapped)
    const remaining = q.choices.filter((c) => !nextTapped.has(c.id)).length
    const stage: HintStage = hintStage >= 1 || remaining <= 1 ? 2 : 1
    setHintStage(stage)
    speak(stage === 1 ? q.hint : '答案在這裡，點點看。', { enabled: voiceOn })
  }

  const pose: Pose = result ? 'cheer' : solved ? 'cheer' : hintStage > 0 ? 'think' : 'idle'

  const replay = () => {
    if (!q) return
    speak(hintStage === 1 ? `${q.prompt} ${q.hint}` : q.prompt, { enabled: true })
  }

  const subtitle = useMemo(() => {
    if (!q) return ''
    if (solved) return praise
    if (hintStage === 1) return q.hint
    if (hintStage === 2) return '答案在這裡，點點看。'
    return q.prompt
  }, [q, solved, hintStage, praise])

  if (!chapter || !def) {
    return (
      <main className="adv adv-stage">
        <p className="adv-error">找不到這一站</p>
        <button className="adv-btn" onClick={onExit}>回地圖</button>
      </main>
    )
  }

  if (result) {
    const together = result.total - result.independent
    return (
      <main className="adv adv-stage adv-result" data-testid="station-result">
        <header className="adv-top">
          <span />
          <MaterialsChip />
        </header>
        <div className="adv-result-card" ref={cardRef}>
          <Companion pose="cheer" size="clamp(110px, 20dvh, 170px)" className="adv-result-pet" />
          <h1>第 {station} 站過關了！</h1>
          <p className="adv-sub">{chapter.name}・{def.name}</p>
          <div className="adv-reward" aria-label={`獲得${MATERIAL_NAMES[result.material]} ${result.qty} 個`}>
            {Array.from({ length: result.qty }, (_, i) => (
              <span key={i} className="reward-fly" data-reward style={{ animationDelay: `${i * 0.18}s` }}>
                <Icon name={`mat-${result.material}`} emoji={MAT_EMOJI[result.material]} alt={MATERIAL_NAMES[result.material]} size={72} />
              </span>
            ))}
          </div>
          <p className="adv-reward-text" data-testid="reward-text">
            獲得{MATERIAL_NAMES[result.material]} × {result.qty}
          </p>
          <p className="adv-sub adv-credit" data-testid="result-credit">
            {result.independent >= result.total
              ? `${result.total} 題都是自己想出來的，好厲害！`
              : result.independent === 0
                ? `跟阿悟一起想出 ${result.total} 題，好棒！`
                : `自己想出 ${result.independent} 題，跟阿悟一起想出 ${together} 題！`}
          </p>
          <div className="adv-actions">
            {result.chapterDone ? (
              <button className="adv-btn primary" onClick={onCeremony} data-testid="open-chest">去開寶箱</button>
            ) : (
              <button className="adv-btn primary" onClick={() => onNextStation(station + 1)} data-testid="next-station">下一站</button>
            )}
            <button className="adv-btn" onClick={onExit} data-testid="back-to-map">回地圖</button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="adv adv-stage" data-testid="stage" data-station={station}>
      <header className="adv-top">
        <button className="adv-btn small" onClick={onExit} aria-label="離開關卡">←<span className="adv-leave-label"> 離開</span></button>
        <div className="adv-dots" role="progressbar" aria-valuemin={0} aria-valuemax={STATION_SIZE} aria-valuenow={Math.min(idx + (solved ? 1 : 0), STATION_SIZE)} aria-label={`第 ${station} 站，第 ${idx + 1} 題`}>
          {Array.from({ length: plan?.length ?? STATION_SIZE }, (_, i) => (
            <span key={i} className={`adv-dot ${i < idx || (i === idx && solved) ? 'done' : i === idx ? 'now' : ''}`} />
          ))}
        </div>
        <MaterialsChip />
      </header>

      {error && (
        <div className="adv-error" role="alert">
          {error}
          <button className="adv-btn small" onClick={onExit}>回地圖</button>
        </div>
      )}

      {!plan && !error && <p className="adv-loading">阿悟正在準備題目…</p>}

      {q && (
        <section className="adv-board">
          <Companion pose={pose} size="var(--pet)" className="adv-say-pet" />
          <div className={`adv-bubble ${hintStage > 0 && !solved ? 'hint' : ''} ${solved ? 'ok' : ''}`} aria-live="polite">
            <p data-testid="subtitle">{subtitle}</p>
            {current?.review && !solved && <span className="adv-tag">複習一下</span>}
          </div>
          <button type="button" className="adv-speaker" onClick={replay} aria-label="再聽一次" data-testid="replay">
            <span className="adv-speaker-icon" aria-hidden>🔊</span>
            <span className="adv-speaker-label">再聽一次</span>
          </button>
          <div className="adv-qv">
            {hintStage > 0 && !solved && <p className="adv-prompt-keep">{q.prompt}</p>}
            <QuestionView key={q.id} q={q} hintStage={hintStage} tapped={tapped} solved={solved} onPick={pick} />
          </div>
          <div className="adv-foot">
            {solved && (
              <button className="adv-btn primary" onClick={advance} data-testid="next-question">
                {idx + 1 >= (plan?.length ?? STATION_SIZE) ? '完成這一站' : '下一題'}
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
