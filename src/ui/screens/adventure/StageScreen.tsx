import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { repo } from '../../../db/repo'
import { getChapter } from '../../../learning/chapter'
import { STATION_SIZE } from '../../../learning/scoring'
import { hintDriven } from '../../../learning/hint'
import { gentleHintKey, gentleHintText, pickLine, questionKey } from '../../../learning/lines'
import { learnerProfileOf, type LearnerProfile } from '../../../learning/profile'
import { displayQuestion } from '../../../learning/select'
import { cancelSpeech, say } from '../../../learning/speech'
import { playSfx } from '../../../learning/sfx'
import { MATERIAL_NAMES, type MaterialId, type SkillId } from '../../../learning/types'
import type { PlannedQuestion } from '../../../learning/select'
import { MAT_EMOJI } from '../../../art/items'
import { Icon } from '../../components/Icon'
import { MaterialsChip } from '../../components/MaterialsChip'
import { flyOne } from '../../fly'
import { useLearningSettings } from '../../learningHooks'
import { Companion, type Pose } from './Companion'
import { GiveView } from './GiveView'
import { QuestionView, type HintStage } from './QuestionView'
import './adventure.css'

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
  const sessionId = useRef('')
  const [plan, setPlan] = useState<PlannedQuestion[] | null>(null)
  const [profile, setProfile] = useState<LearnerProfile>(learnerProfileOf(undefined))
  const [idx, setIdx] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const wrongs = useRef(0)
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
  const advancing = useRef(false)

  // 載入這一站的題目
  useEffect(() => {
    let cancelled = false
    Promise.all([repo.openStation(chapterId, station), repo.getLearnerProfile()])
      .then(([o, prof]) => {
        if (cancelled) return
        sessionId.current = o.sessionId
        setProfile(prof)
        setPlan(o.plan)
        setIdx(o.idx)
      })
      .catch(() => !cancelled && setError('題目載入失敗，請回到地圖再試一次'))
    return () => {
      cancelled = true
    }
  }, [chapterId, station])

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
  // 實際給孩子看的題目：選項順序用 session + 題目 id 當種子洗牌（離開再回來順序不變）；幼幼模式縮成 2 選 1
  const q = useMemo(
    () => (current ? displayQuestion(current.question, sessionId.current, profile.gentle) : undefined),
    [current, profile.gentle],
  )

  // 換題：重置狀態並唸題
  useEffect(() => {
    if (!q) return
    startedAt.current = Date.now()
    solvedRef.current = false
    wrongs.current = 0
    const id = window.setTimeout(() => say(questionKey(q.id, 'prompt'), q.prompt, { enabled: voiceOn }), 350)
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
    const l = pickLine(r.chapterDone ? 'chapter.done' : 'station.done')
    say(l.key, l.text, { enabled: voiceOn })
    setResult(r)
  }, [chapterId, station, soundOn, voiceOn])

  const advance = useCallback(async () => {
    window.clearTimeout(nextTimer.current)
    if (!plan || advancing.current) return
    advancing.current = true
    try {
      if (idx + 1 >= plan.length) {
        await finish()
        return
      }
      // 站中調整剩下的題：剛升級就改用新難度重抽；同技能連續 2 題第一次就答錯，下一題降 1 級
      await Promise.all(writes.current)
      const next = await repo.adaptStation({ chapterId, station, sessionId: sessionId.current, plan, from: idx + 1 })
      setPlan(next)
      setIdx((i) => i + 1)
      setHintStage(0)
      setTapped(new Set())
      setSolved(false)
      setPraise('')
    } finally {
      advancing.current = false
    }
  }, [plan, idx, finish, chapterId, station])

  /** 答對：記錄作答（首次答對且沒用提示 = 獨立答對）。各互動元件自己判斷對錯後都走這裡 */
  const handleSolved = () => {
    if (!q || !current || solvedRef.current) return
    solvedRef.current = true
    setSolved(true)
    const l = pickLine(profile.gentle ? 'praise.gentle' : 'praise', Math.floor(Math.random() * 4))
    setPraise(l.text)
    playSfx('correct', soundOn)
    say(l.key, l.text, { enabled: voiceOn })
    const w = repo.recordAttempt({
      sessionId: sessionId.current,
      questionId: q.id,
      firstTryCorrect: wrongs.current === 0,
      hintsUsed: Math.min(2, wrongs.current),
      durationMs: Date.now() - startedAt.current,
      review: current.review,
      followUp: current.followUp,
      interaction: q.interaction ?? 'pick',
    })
    writes.current.push(w)
    nextTimer.current = window.setTimeout(() => void advance(), AUTO_NEXT_MS)
  }

  /**
   * 答錯：不扣分。第一次給提示（動畫 + 語音）；第二次標出答案。
   * 幼幼模式：第一次就給提示動畫、語氣鼓勵，並直接示範答案。
   * 沒有「只剩一個選項就直接揭曉」的捷徑：2 選 1 答錯一次後，剩下的那個就是答案，孩子自己點。
   */
  const handleWrong = () => {
    if (!q || solvedRef.current) return
    wrongs.current += 1
    playSfx('wrong', soundOn)
    const stage: HintStage = profile.gentle || wrongs.current >= 2 ? 2 : 1
    setHintStage(stage)
    if (profile.gentle) {
      if (hintDriven(q)) {
        const l = pickLine('gentle.wrong', Math.floor(Math.random() * 3))
        say(l.key, l.text, { enabled: voiceOn })
      } else say(gentleHintKey(q.id), gentleHintText(q.hint), { enabled: voiceOn })
    } else if (stage === 1) {
      if (!hintDriven(q)) say(questionKey(q.id, 'hint'), q.hint, { enabled: voiceOn })
    } else {
      const l = pickLine('hint.answer')
      say(l.key, l.text, { enabled: voiceOn })
    }
  }

  const pick = (choiceId: string) => {
    if (!q || solvedRef.current || tapped.has(choiceId)) return
    if (choiceId === q.answer) return handleSolved()
    setTapped(new Set(tapped).add(choiceId))
    handleWrong()
  }

  const pose: Pose = result ? 'cheer' : solved ? 'cheer' : hintStage > 0 ? 'think' : 'idle'

  const replay = () => {
    if (!q) return
    if (hintStage > 0 && !solved) say(questionKey(q.id, 'hint'), q.hint, { enabled: true })
    else say(questionKey(q.id, 'prompt'), q.prompt, { enabled: true })
  }

  const subtitle = useMemo(() => {
    if (!q) return ''
    if (solved) return praise
    if (hintStage === 1) return q.hint
    if (hintStage === 2) return profile.gentle ? `${q.hint}答案在這裡，點點看。` : '答案在這裡，點點看。'
    return q.prompt
  }, [q, solved, hintStage, praise, profile.gentle])

  // 離開關卡：先確認；已答的題都已經記下來，回到同一站會接著玩
  const askLeave = () => {
    if (!plan || result) return onExit()
    setLeaving(true)
    const l = pickLine('leave.ask')
    say(l.key, l.text, { enabled: voiceOn })
  }
  const stayHere = () => {
    setLeaving(false)
    cancelSpeech()
  }

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
    <main className={`adv adv-stage ${profile.gentle ? 'gentle' : ''}`} data-testid="stage" data-station={station} data-gentle={profile.gentle ? 'true' : undefined}>
      <header className="adv-top">
        <button className="adv-btn small" onClick={askLeave} aria-label="離開關卡" data-testid="leave">←<span className="adv-leave-label"> 離開</span></button>
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
            {q.interaction === 'tapN' ? (
              <GiveView key={q.id} q={q} hintStage={hintStage} solved={solved} voiceOn={voiceOn} onWrong={handleWrong} onSolved={handleSolved} />
            ) : (
              <QuestionView key={q.id} q={q} hintStage={hintStage} tapped={tapped} solved={solved} onPick={pick} voiceOn={voiceOn} startDelay={profile.gentle ? 2400 : 350} />
            )}
          </div>
          <div className="adv-foot">
            {solved && (
              <button className="adv-btn primary" onClick={() => void advance()} data-testid="next-question">
                {idx + 1 >= (plan?.length ?? STATION_SIZE) ? '完成這一站' : '下一題'}
              </button>
            )}
          </div>
        </section>
      )}

      {leaving && (
        <div className="leave" role="dialog" aria-modal="true" aria-label="要離開嗎" data-testid="leave-dialog">
          <div className="leave-card">
            <Companion pose="think" size={110} />
            <h2>要先休息一下嗎？</h2>
            <p>阿悟會記得你玩到哪裡喔。</p>
            <div className="leave-actions">
              <button className="adv-btn primary big" onClick={stayHere} data-testid="leave-stay" autoFocus>
                繼續玩
              </button>
              <button className="adv-btn big" onClick={onExit} data-testid="leave-go">
                先離開
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
