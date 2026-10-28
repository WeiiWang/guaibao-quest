import { useMemo, useRef, useState } from 'react'
import { repo } from '../../../db/repo'
import { placementQuestions } from '../../../db/quest7'
import { pickLine, questionKey } from '../../../learning/lines'
import { displayQuestion } from '../../../learning/select'
import { cancelSpeech, say } from '../../../learning/speech'
import { playSfx } from '../../../learning/sfx'
import { useLearningSettings } from '../../learningHooks'
import { Companion } from './Companion'
import { QuestionView } from './QuestionView'
import './adventure.css'
import './adventure-v7.css'

type Step = 'ask' | 'q' | 'done'

/**
 * 6–7 歲第一次進數學冒險：先做 3 題快速分級（數感、分類、規律各一題難度 3）。
 * 全對從難度 3 起跳；錯 1 題從 2 起跳；錯 2 題以上從 1 起跳。沒有計時、答錯不懲罰也不給提示，只是看一眼正確答案。
 * 之後還有自動降級保護（連錯 3 題降一級，見 skills.ts）。
 */
export function Placement({ onStart, onDone }: { onStart?: () => void; onDone: () => void }) {
  const { soundOn, voiceOn } = useLearningSettings()
  const qs = useMemo(() => placementQuestions().map((q) => displayQuestion(q, 'placement')), [])
  const [step, setStep] = useState<Step>('ask')
  const [idx, setIdx] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set())
  const [solved, setSolved] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [level, setLevel] = useState<number | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const wrongs = useRef(0)
  const q = qs[idx]

  const start = () => {
    onStart?.()
    setStep('q')
    const l = pickLine('placement.ask')
    say(l.key, l.text, { enabled: voiceOn })
    window.setTimeout(() => q && say(questionKey(q.id, 'prompt'), q.prompt, { enabled: voiceOn }), 2600)
  }
  const skip = async () => {
    cancelSpeech()
    await repo.skipPlacement()
    onDone()
  }
  const next = async (ok: boolean) => {
    const total = correct + (ok ? 1 : 0)
    if (idx + 1 >= qs.length) {
      const r = await repo.applyPlacement(total)
      if (r.ok) setLevel(r.level)
      const l = pickLine('placement.done')
      say(l.key, l.text, { enabled: voiceOn })
      setStep('done')
      return
    }
    setCorrect(total)
    setIdx(idx + 1)
    setTapped(new Set())
    setSolved(false)
    setReveal(false)
    wrongs.current = 0
    const nq = qs[idx + 1]
    if (nq) say(questionKey(nq.id, 'prompt'), nq.prompt, { enabled: voiceOn })
  }
  const pick = (id: string) => {
    if (!q || solved || tapped.has(id)) return
    window.clearTimeout(timer.current)
    if (id === q.answer) {
      const ok = wrongs.current === 0
      playSfx('correct', soundOn)
      setSolved(true)
      timer.current = window.setTimeout(() => void next(ok), 900)
      return
    }
    // 答錯：不懲罰、不給提示，只是亮出正確答案看一眼，再往下一題
    wrongs.current += 1
    playSfx('wrong', soundOn)
    setTapped(new Set(tapped).add(id))
    setReveal(true)
    timer.current = window.setTimeout(() => {
      setSolved(true)
      timer.current = window.setTimeout(() => void next(false), 1100)
    }, 700)
  }

  return (
    <div className="leave q7-place" role="dialog" aria-modal="true" aria-label="快速分級" data-testid="placement">
      <div className="leave-card q7-place-card">
        <Companion pose={step === 'done' ? 'cheer' : 'think'} size={96} />
        {step === 'ask' && (
          <>
            <h2>先玩三題，看看從哪裡開始</h2>
            <p>沒有時間壓力，不會就看看答案也沒關係。</p>
            <div className="leave-actions">
              <button className="adv-btn primary big" onClick={start} data-testid="placement-start" autoFocus>開始</button>
              <button className="adv-btn big" onClick={() => void skip()} data-testid="placement-skip">先不要</button>
            </div>
          </>
        )}
        {step === 'q' && q && (
          <>
            <p className="q7-place-count" data-testid="placement-count">第 {idx + 1} / {qs.length} 題</p>
            <h2 className="q7-place-prompt">{q.prompt}</h2>
            <div className="q7-place-q" data-testid="placement-q">
              <QuestionView key={q.id} q={q} hintStage={reveal && !solved ? 2 : 0} tapped={tapped} solved={solved} onPick={pick} voiceOn={voiceOn} />
            </div>
          </>
        )}
        {step === 'done' && (
          <>
            <h2 data-testid="placement-done">阿悟知道了！</h2>
            <p>從難度 {level ?? 2} 開始，之後會自己調整。</p>
            <button className="adv-btn primary big" onClick={onDone} data-testid="placement-go" autoFocus>出發</button>
          </>
        )}
      </div>
    </div>
  )
}
