import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/db'
import { repo } from '../../../db/repo'
import { SHOP_ITEMS } from '../../../domain/constants'
import { giftFoodLine } from '../../../domain/giftLines'
import { localDateStr } from '../../../domain/date'
import { now as clockNow } from '../../../domain/clock'
import { parseChallengeId, resolveStage } from '../../../learning/subject'
import { englishAnswerParts, englishHintParts, englishPromptParts } from '../../../learning/englishSpeech'
import { STATION_SIZE } from '../../../learning/scoring'
import { hintDriven } from '../../../learning/hint'
import { gentleHintKey, gentleHintText, pickLine, questionKey } from '../../../learning/lines'
import { learnerProfileOf, type LearnerProfile } from '../../../learning/profile'
import { needsTutorial, tutorialQuestion } from '../../../learning/tutorial'
import { displayQuestion } from '../../../learning/select'
import { cancelSpeech, say, sayChain } from '../../../learning/speech'
import { playSfx } from '../../../learning/sfx'
import { MATERIAL_NAMES, type Interaction, type MaterialId, type SkillId } from '../../../learning/types'
import type { PlannedQuestion } from '../../../learning/select'
import { FOOD_EMOJI, MAT_EMOJI } from '../../../art/items'
import { Icon } from '../../components/Icon'
import { MaterialsChip } from '../../components/MaterialsChip'
import { useLearningSettings } from '../../learningHooks'
import { Companion, type Pose } from './Companion'
import { flySparks, sparkCount } from './sparkle'
import { EnglishView } from './EnglishView'
import { FlipView } from './FlipView'
import { GiveView } from './GiveView'
import { LifeNatureView } from './LifeNatureView'
import { OrderView } from './OrderView'
import { PlaceView } from './PlaceView'
import { StepOrderView } from './StepOrderView'
import { QuestionView, type HintStage } from './QuestionView'
import { ScenePick } from './ScenePick'
import { SortView } from './SortView'
import './adventure.css'
import './adventure-v4.css'
import './adventure-v5.css'
import './adventure-v7.css'

const AUTO_NEXT_MS = 1600
/** 食物 id 對應 lines.ts 的 ui.gift.food 句子順序（和 domain/giftLines.ts 的 GIFT_FOOD_PHRASE 同順序） */
const FOOD_LINE_ORDER = ['carrot', 'cookie', 'banana', 'apple', 'grape', 'milk', 'peach', 'riceball', 'watermelon']

/** 各互動教學時阿悟說的話（lines.ts 的 companion.tutorial.*） */
const TUTORIAL_LINE: Partial<Record<Interaction, string>> = {
  tapN: 'companion.tutorial.give',
  dragSort: 'companion.tutorial.bins',
  dragOrder: 'companion.tutorial.order',
  place: 'companion.tutorial.place',
  flip: 'companion.tutorial.flip',
}
/** 第 2 章（水簾洞）的點選題：用場景、縮放、記憶翻牌的畫法，不是一般的物件卡片 */
const SCENE_SKILLS: SkillId[] = ['measure', 'space', 'observe']

interface StationResult {
  independent: number
  total: number
  material: MaterialId
  qty: number
  chapterDone: boolean
  newlyMastered: SkillId[]
  /** 每日冒險：今天第一次完成，拿到今日徽章；挑戰站：第一次拿到章節徽章 */
  badge?: boolean
  /** v7：這一站掉落的食物（已經直接進背包） */
  foods: string[]
  /** v7 挑戰站：這次最高連對、歷來最高 */
  combo?: number
  best?: number
}

const foodName = (id: string): string => SHOP_ITEMS.find((i) => i.id === id)?.name ?? id

interface Props {
  chapterId: string
  station: number
  onExit: () => void
  onNextStation: (station: number) => void
  onCeremony: () => void
}

/** 關卡答題畫面：一站 5 題，混合三種技能 */
export function StageScreen({ chapterId, station, onExit, onNextStation, onCeremony }: Props) {
  // 一般的一站，或每日冒險（chapterId = daily:<科目>）
  const info = useMemo(() => resolveStage(chapterId, station, localDateStr(clockNow())), [chapterId, station])
  const def = info?.def
  const daily = !!info?.daily
  /** v7 挑戰站：連續答對有 combo 計數、不給提示、沒有時間壓力 */
  const challenge = !!info?.challenge
  const { soundOn, voiceOn } = useLearningSettings()
  // 寵物還是蛋時，生活題裡的主角不說成「阿悟」（G8）
  const petStage = useLiveQuery(() => db.pets.get('pet').then((p) => p?.stage), [])
  const kid = petStage === 'egg'
  const sessionId = useRef('')
  const [plan, setPlan] = useState<PlannedQuestion[] | null>(null)
  const [profile, setProfile] = useState<LearnerProfile>(learnerProfileOf(undefined))
  const [idx, setIdx] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const wrongs = useRef(0)
  /** 已經看過教學的互動 */
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set())
  const [introState, setIntroState] = useState<{ kind: Interaction | null; phase: 'demo' | 'play' | 'done' }>({ kind: null, phase: 'demo' })
  /** 連續獨立答對幾題（站內；只算獨立答對，中斷就歸零，不顯示任何東西） */
  const streak = useRef(0)
  const [combo, setCombo] = useState(0)
  /** v7 挑戰站：目前連對幾題（答錯歸零；畫面上一直顯示） */
  const [chain, setChain] = useState(0)
  /** 站開始時阿悟說的一句話 */
  const [opener, setOpener] = useState<{ key: string; text: string } | null>(null)
  const openerRef = useRef(false)
  /** 阿悟臨時的表情（例如多拿了 → 頭暈），換題或答對就清掉 */
  const [feel, setFeel] = useState<Pose | null>(null)
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
    Promise.all([repo.openStation(chapterId, station), repo.getLearnerProfile(), repo.getSeenIntros()])
      .then(([o, prof, intros]) => {
        if (cancelled) return
        sessionId.current = o.sessionId
        setProfile(prof)
        setSeen(new Set(intros))
        setPlan(o.plan)
        setIdx(o.idx)
        if (o.idx === 0 && !o.resumed) {
          const st = resolveStage(chapterId, station, localDateStr(clockNow()))
          setOpener(st?.challenge ? pickLine('challenge.open') : pickLine(st?.def.kind === 'boss' ? 'companion.boss.open' : 'companion.open', station))
          openerRef.current = true
        }
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

  // 結算：先演阿悟撿到食物（食物圖示留在畫面上，旁邊有一句阿悟說的話），再依序出現材料；圖示動畫結束後都停在原位，不飛走、不消失（見 adventure-v7.css）

  const current = plan?.[idx]
  // 實際給孩子看的題目：選項順序用 session + 題目 id 當種子洗牌（離開再回來順序不變）；幼幼模式縮成 2 選 1
  const q = useMemo(
    () => (current ? displayQuestion(current.question, sessionId.current, profile.gentle, kid) : undefined),
    [current, profile.gentle, kid],
  )

  // 第一次遇到新互動：阿悟先示範（不計分、不寫作答紀錄）。這是從題目直接算出來的，不會閃一下真的題目
  const qInteraction = q?.interaction
  const intro: Interaction | null = needsTutorial(qInteraction, seen) ? qInteraction : null
  const introPhase = introState.kind === intro ? introState.phase : 'demo'
  const setIntroPhase = (phase: 'demo' | 'play' | 'done') => setIntroState({ kind: intro, phase })

  // 站開始的那句話：顯示一下就收起來（題目字幕照舊）
  useEffect(() => {
    if (!opener) return
    say(opener.key, opener.text, { enabled: voiceOn })
    const id = window.setTimeout(() => setOpener(null), 2600)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opener])

  // 換題：重置狀態並唸題（教學示範時唸教學的話）
  useEffect(() => {
    if (!q) return
    startedAt.current = Date.now()
    solvedRef.current = false
    wrongs.current = 0
    if (intro) {
      const l = pickLine(TUTORIAL_LINE[intro] ?? 'companion.tutorial.bins', 0)
      const id = window.setTimeout(() => say(l.key, l.text, { enabled: voiceOn }), 350)
      return () => window.clearTimeout(id)
    }
    // 第一題前面有開場白：等它唸完再唸題目
    const delay = openerRef.current ? 2800 : 350
    openerRef.current = false
    // 英文題：中文題目唸完接著唸英文單字（見 englishSpeech.ts）
    const id = window.setTimeout(
      () => (q.skill === 'english' ? sayChain(englishPromptParts(q), { enabled: voiceOn }) : say(questionKey(q.id, 'prompt', q.kid), q.prompt, { enabled: voiceOn })),
      delay,
    )
    return () => window.clearTimeout(id)
    // 只在換題（或教學結束）時唸；語音開關變動不重唸
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id, intro])

  // v7 B1：答對時 3–5 顆小星光從答對的卡片飛向頂端進度點，進度點彈一下
  useEffect(() => {
    if (!solved) return
    const from = document.querySelector('.adv-qv [data-state="right"]') ?? document.querySelector('.adv-qv')
    const dots = document.querySelectorAll('.adv-dots .adv-dot')
    const target = dots[idx] ?? document.querySelector('.boss-bar')
    flySparks(from, target, { count: sparkCount(streak.current) })
    // 只在答對的那一刻放一次
  }, [solved, idx])

  const finish = useCallback(async () => {
    if (finishing.current) return
    finishing.current = true
    await Promise.all(writes.current)
    const r = challenge
      ? await repo.completeChallenge({ chapterId: parseChallengeId(chapterId)?.id ?? chapterId, sessionId: sessionId.current })
      : daily
        ? await repo.completeDaily({ chapterId, sessionId: sessionId.current })
        : await repo.completeStation({ chapterId, station, sessionId: sessionId.current })
    if (!r.ok) {
      setError(r.error)
      return
    }
    playSfx('reward', soundOn)
    const l = pickLine(challenge ? ((r as { badge?: boolean }).badge ? 'challenge.badge' : 'challenge.done') : daily ? ((r as { badge?: boolean }).badge ? 'daily.badge' : 'daily.done') : r.chapterDone ? 'chapter.done' : 'station.done')
    // 先唸過關，接著阿悟說撿到的食物（跟畫面上食物彈出的順序一樣）
    const foodLines = r.foods.map((f, i) => {
      const idx = FOOD_LINE_ORDER.indexOf(f)
      return idx >= 0 ? pickLine('ui.gift.food', idx) : { key: `food.${i}`, text: giftFoodLine(f) }
    })
    sayChain([{ key: l.key, text: l.text }, ...foodLines.slice(0, 1)], { enabled: voiceOn })
    setResult(r)
  }, [chapterId, station, daily, challenge, soundOn, voiceOn])

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
      setCombo(0)
      setFeel(null)
    } finally {
      advancing.current = false
    }
  }, [plan, idx, finish, chapterId, station])

  /** 答對：記錄作答（首次答對且沒用提示 = 獨立答對）。各互動元件自己判斷對錯後都走這裡 */
  const handleSolved = () => {
    if (!q || !current || solvedRef.current) return
    solvedRef.current = true
    setSolved(true)
    setFeel(null)
    // 連擊只算獨立答對；中斷時不顯示任何東西
    const independent = wrongs.current === 0
    streak.current = independent ? streak.current + 1 : 0
    setCombo(independent ? streak.current : 0)
    setChain(streak.current)
    const rnd = Math.floor(Math.random() * 7)
    const l =
      independent && streak.current === 5
        ? pickLine('companion.combo5', rnd)
        : independent && streak.current === 3
          ? pickLine('companion.combo3', rnd)
          : pickLine(profile.gentle ? 'praise.gentle' : 'praise', rnd)
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
    if (challenge) {
      // 挑戰站：不給提示。連對歸零，沒有任何責備；錯的卡片變灰，再點別的就好
      streak.current = 0
      setChain(0)
      return
    }
    const stage: HintStage = profile.gentle || wrongs.current >= 2 ? 2 : 1
    setHintStage(stage)
    if (q.skill === 'english') {
      // 英文題的提示：中文提示（幼幼模式加鼓勵）→ 英文單字；第二次錯標出答案時再唸一次英文
      sayChain(stage === 2 && !profile.gentle ? englishAnswerParts(q) : englishHintParts(q, profile.gentle), { enabled: voiceOn })
    } else if (profile.gentle) {
      if (hintDriven(q)) {
        const l = pickLine('gentle.wrong', Math.floor(Math.random() * 3))
        say(l.key, l.text, { enabled: voiceOn })
      } else say(q.kid ? `${gentleHintKey(q.id)}.kid` : gentleHintKey(q.id), gentleHintText(q.hint), { enabled: voiceOn })
    } else if (stage === 1) {
      if (!hintDriven(q)) say(questionKey(q.id, 'hint', q.kid), q.hint, { enabled: voiceOn })
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

  const pose: Pose = result
    ? result.independent >= result.total
      ? 'sing'
      : 'cheer'
    : solved
      ? combo >= 5
        ? 'sing'
        : combo >= 3
          ? 'dance'
          : 'cheer'
      : intro
        ? introPhase === 'demo'
          ? 'happy'
          : 'think'
        : feel ?? (hintStage === 2 ? 'shy' : hintStage === 1 ? 'think' : 'idle')

  // ---- 教學示範：練習題（不計分）----
  const tutorialQ = useMemo(() => (intro ? tutorialQuestion(intro) : null), [intro])
  const finishTutorial = (skip = false) => {
    if (!intro) return
    setIntroPhase('done')
    const l = pickLine(skip ? 'tutorial.skip' : 'tutorial.done')
    say(l.key, l.text, { enabled: voiceOn })
    void repo.markIntroSeen(intro)
    window.setTimeout(() => setSeen((s0) => new Set(s0).add(intro)), skip ? 0 : 1300)
  }

  const replay = () => {
    if (!q) return
    if (q.skill === 'english') sayChain(hintStage > 0 && !solved ? englishHintParts(q, false) : englishPromptParts(q), { enabled: true })
    else if (hintStage > 0 && !solved) say(questionKey(q.id, 'hint', q.kid), q.hint, { enabled: true })
    else say(questionKey(q.id, 'prompt', q.kid), q.prompt, { enabled: true })
  }

  const subtitle = useMemo(() => {
    if (!q) return ''
    if (intro) {
      if (introPhase === 'demo') return pickLine(TUTORIAL_LINE[intro] ?? 'companion.tutorial.bins', 0).text
      if (introPhase === 'play') return pickLine('tutorial.again').text
      return pickLine('tutorial.done').text
    }
    if (solved) return praise
    if (challenge) return q.prompt
    if (hintStage === 1) return q.hint
    if (hintStage === 2) return profile.gentle ? `${q.hint}答案在這裡，點點看。` : '答案在這裡，點點看。'
    return q.prompt
  }, [q, solved, hintStage, praise, profile.gentle, intro, introPhase, challenge])

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

  if (!info || !def) {
    return (
      <main className="adv adv-stage">
        <p className="adv-error">找不到這一站</p>
        <button className="adv-btn" onClick={onExit}>回地圖</button>
      </main>
    )
  }

  if (result) {
    const together = result.total - result.independent
    // 食物（可能 2 個，可能同一種）：依序彈出；材料接在食物後面
    const foodDelay = 0.25
    const matDelay = foodDelay + result.foods.length * 0.45 + 0.35
    const foodSummary = result.foods.map(foodName).join('、')
    return (
      <main className="adv adv-stage adv-result" data-testid="station-result">
        <header className="adv-top">
          <span />
          <MaterialsChip />
        </header>
        <div className="adv-result-card q7-result" ref={cardRef}>
          {def.kind === 'boss' && (
            <div className="adv-confetti" aria-hidden>
              {Array.from({ length: 16 }, (_, i) => (
                <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 5) * 0.12}s` }} />
              ))}
            </div>
          )}
          <Companion pose={pose} size="clamp(92px, 15dvh, 140px)" className="adv-result-pet" />
          <h1>{challenge ? '挑戰完成了！' : daily ? '今日冒險完成了！' : `第 ${station} 站過關了！`}</h1>
          <p className="adv-sub">{challenge ? `${info.chapterName}・挑戰站` : daily ? `${info.chapterName}・5 題新題目` : `${info.chapterName}・${def.name}`}</p>
          <p className="adv-sub adv-wrapup" data-testid="wrapup">{pickLine(def.kind === 'boss' ? 'companion.boss.done' : 'companion.wrapup', station).text}</p>
          <div className="q7-loot">
            <section className="q7-loot-col" aria-label={`阿悟撿到${foodSummary}`} data-testid="result-food">
              <div className="q7-loot-icons q7-food-icons">
                {result.foods.map((f, i) => (
                  <span key={i} className="q7-food" data-testid="result-food-item" data-food={f} style={{ animationDelay: `${foodDelay + i * 0.45}s` }}>
                    <Icon name={`food-${f}`} emoji={FOOD_EMOJI[f]} alt={foodName(f)} size={84} />
                  </span>
                ))}
              </div>
              <p className="q7-loot-text" data-testid="food-text">
                阿悟撿到 {foodSummary}
              </p>
            </section>
            <section className="q7-loot-col" aria-label={`獲得${MATERIAL_NAMES[result.material]} ${result.qty} 個`} data-testid="result-materials">
              <div className="q7-loot-icons adv-reward">
                {Array.from({ length: result.qty }, (_, i) => (
                  <span key={i} className="q7-mat" data-reward style={{ animationDelay: `${matDelay + i * 0.18}s` }}>
                    <Icon name={`mat-${result.material}`} emoji={MAT_EMOJI[result.material]} alt={MATERIAL_NAMES[result.material]} size={result.qty > 3 ? 60 : 72} />
                  </span>
                ))}
              </div>
              <p className="q7-loot-text adv-reward-text" data-testid="reward-text">
                獲得{MATERIAL_NAMES[result.material]} × {result.qty}
              </p>
            </section>
          </div>
          <p className="q7-food-line" data-testid="food-line" role="status" style={{ animationDelay: `${foodDelay + 0.2}s` }}>
            {result.foods[0] ? giftFoodLine(result.foods[0]) : ''}
          </p>
          <p className="adv-sub adv-credit" data-testid="result-credit">
            {challenge
              ? `最高連對 ${result.combo ?? 0} 題${result.best && result.best > (result.combo ?? 0) ? `，歷來最高 ${result.best} 題` : ''}`
              : result.independent >= result.total
                ? `${result.total} 題都是自己想出來的，好厲害！`
                : result.independent === 0
                  ? `跟阿悟一起想出 ${result.total} 題，好棒！`
                  : `自己想出 ${result.independent} 題，跟阿悟一起想出 ${together} 題！`}
          </p>
          {result.badge && (
            <div className="daily-got" data-testid={challenge ? 'challenge-badge' : 'daily-badge'}>
              <span className="daily-medal big" aria-hidden>{challenge ? '🏅' : '★'}</span>
              <b>{challenge ? '拿到章節徽章了！' : '拿到今日徽章了！'}</b>
            </div>
          )}
          <div className="adv-actions">
            {daily || challenge ? (
              <button className="adv-btn primary" onClick={onExit} data-testid="back-to-map">回地圖</button>
            ) : result.chapterDone ? (
              <button className="adv-btn primary" onClick={onCeremony} data-testid="open-chest">去開寶箱</button>
            ) : (
              <button className="adv-btn primary" onClick={() => onNextStation(station + 1)} data-testid="next-station">下一站</button>
            )}
            {!daily && !challenge && <button className="adv-btn" onClick={onExit} data-testid="back-to-map">回地圖</button>}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className={`adv adv-stage ${profile.gentle ? 'gentle' : ''} ${def.kind === 'boss' ? 'boss' : ''}`} data-testid="stage" data-kind={def.kind} data-station={station} data-daily={daily ? 'true' : undefined} data-challenge={challenge ? 'true' : undefined} data-subject={info.subject} data-gentle={profile.gentle ? 'true' : undefined}>
      <header className="adv-top">
        <button className="adv-btn small" onClick={askLeave} aria-label="離開關卡" data-testid="leave">←<span className="adv-leave-label"> 離開</span></button>
        {def.kind === 'boss' ? (
          <div className="boss-bar" role="progressbar" aria-valuemin={0} aria-valuemax={plan?.length ?? STATION_SIZE} aria-valuenow={Math.min(idx + (solved ? 1 : 0), STATION_SIZE)} aria-label={`${def.name}的進度`} data-testid="boss-bar">
            <i style={{ width: `${(Math.min(idx + (solved ? 1 : 0), plan?.length ?? STATION_SIZE) / (plan?.length ?? STATION_SIZE)) * 100}%` }} />
          </div>
        ) : (
        <div className="adv-dots" role="progressbar" aria-valuemin={0} aria-valuemax={STATION_SIZE} aria-valuenow={Math.min(idx + (solved ? 1 : 0), STATION_SIZE)} aria-label={daily ? `今日冒險，第 ${idx + 1} 題` : `第 ${station} 站，第 ${idx + 1} 題`}>
          {Array.from({ length: plan?.length ?? STATION_SIZE }, (_, i) => (
            <span key={i} className={`adv-dot ${i < idx || (i === idx && solved) ? 'done' : i === idx ? 'now' : ''}`} />
          ))}
        </div>
        )}
        {challenge ? (
          <span className="q7-chain" data-testid="chain" data-chain={chain} role="status" aria-label={`連續答對 ${chain} 題`}>
            <b>連對</b>
            <i key={chain} className={chain > 0 ? 'q7-pop' : ''}>{chain}</i>
          </span>
        ) : (
          <MaterialsChip />
        )}
      </header>

      {error && (
        <div className="adv-error" role="alert">
          {error}
          <button className="adv-btn small" onClick={onExit}>回地圖</button>
        </div>
      )}

      {!plan && !error && <p className="adv-loading">阿悟正在準備題目…</p>}

      {q && (
        <section className={`adv-board ${solved && combo >= 2 ? 'combo-glow' : ''}`} data-combo={solved && combo >= 2 ? combo : undefined}>
          {solved && (combo === 3 || combo === 5) && (
            <p className="adv-combo" data-testid="combo-tag" role="status">
              {pickLine(combo === 5 ? 'companion.combo5' : 'companion.combo3', 0).text}
            </p>
          )}
          <Companion pose={pose} size="var(--pet)" className="adv-say-pet" />
          <div className={`adv-bubble ${hintStage > 0 && !solved ? 'hint' : ''} ${solved ? 'ok' : ''}`} aria-live="polite">
            <div className="adv-bubble-body">
              {opener && (
                <span className="adv-opener" data-testid="opener" role="status">
                  {opener.text}
                </span>
              )}
              <p data-testid="subtitle">{subtitle}</p>
            </div>
            {current?.review && !solved && <span className="adv-tag">複習一下</span>}
          </div>
          <button type="button" className="adv-speaker" onClick={replay} aria-label="再聽一次" data-testid="replay">
            <span className="adv-speaker-icon" aria-hidden>🔊</span>
            <span className="adv-speaker-label">再聽一次</span>
          </button>
          <div className="adv-qv">
            {hintStage > 0 && !solved && !intro && <p className="adv-prompt-keep">{q.prompt}</p>}
            {intro && tutorialQ ? (
              <div className="tutorial" data-testid="tutorial" data-kind={intro} data-phase={introPhase}>
                <p className="tutorial-tag">阿悟教你</p>
                {intro === 'tapN' ? (
                  <GiveView
                    key="tutorial-give"
                    q={tutorialQ}
                    hintStage={0}
                    solved={introPhase === 'done'}
                    voiceOn={voiceOn}
                    demo={introPhase === 'demo'}
                    onDemoEnd={() => setIntroPhase('play')}
                    onWrong={() => setFeel('shy')}
                    onSolved={() => finishTutorial()}
                    onFeel={setFeel}
                  />
                ) : (
                  (() => {
                    // 拖曳歸類、排序、放到位置、翻牌：共用同一組教學參數
                    const View = intro === 'dragOrder' ? OrderView : intro === 'place' ? PlaceView : intro === 'flip' ? FlipView : SortView
                    return (
                      <View
                        key={`tutorial-${intro}`}
                        q={tutorialQ}
                        hintStage={0}
                        solved={introPhase === 'done'}
                        voiceOn={voiceOn}
                        demo={introPhase === 'demo'}
                        onDemoEnd={() => setIntroPhase('play')}
                        onWrong={() => setFeel('shy')}
                        onSolved={() => finishTutorial()}
                      />
                    )
                  })()
                )}
                {introPhase !== 'done' && (
                  <button type="button" className="adv-btn small tutorial-skip" onClick={() => finishTutorial(true)} data-testid="tutorial-skip">
                    跳過
                  </button>
                )}
              </div>
            ) : q.interaction === 'tapN' ? (
              <GiveView key={q.id} q={q} hintStage={hintStage} solved={solved} voiceOn={voiceOn} onWrong={handleWrong} onSolved={handleSolved} onFeel={setFeel} />
            ) : q.interaction === 'dragSort' ? (
              <SortView key={q.id} q={q} hintStage={hintStage} solved={solved} voiceOn={voiceOn} onWrong={handleWrong} onSolved={handleSolved} />
            ) : q.interaction === 'stepOrder' ? (
              <StepOrderView key={q.id} q={q} hintStage={hintStage} solved={solved} voiceOn={voiceOn} onWrong={handleWrong} onSolved={handleSolved} />
            ) : q.interaction === 'dragOrder' ? (
              <OrderView key={q.id} q={q} hintStage={hintStage} solved={solved} voiceOn={voiceOn} onWrong={handleWrong} onSolved={handleSolved} />
            ) : q.interaction === 'place' ? (
              <PlaceView key={q.id} q={q} hintStage={hintStage} solved={solved} voiceOn={voiceOn} onWrong={handleWrong} onSolved={handleSolved} />
            ) : q.interaction === 'flip' ? (
              <FlipView key={q.id} q={q} hintStage={hintStage} solved={solved} voiceOn={voiceOn} onWrong={handleWrong} onSolved={handleSolved} />
            ) : SCENE_SKILLS.includes(q.skill) ? (
              <ScenePick key={q.id} q={q} hintStage={hintStage} tapped={tapped} solved={solved} onPick={pick} voiceOn={voiceOn} startDelay={profile.gentle ? 2400 : 350} />
            ) : q.skill === 'life' || q.skill === 'nature' ? (
              <LifeNatureView key={q.id} q={q} hintStage={hintStage} tapped={tapped} solved={solved} voiceOn={voiceOn} onPick={pick} />
            ) : q.skill === 'english' ? (
              <EnglishView key={q.id} q={q} hintStage={hintStage} tapped={tapped} solved={solved} onPick={pick} />
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
