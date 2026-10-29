import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PET_NAME } from '../../domain/constants'
import { AGE_CHOICES } from '../../domain/home7'
import { sayText } from '../../learning/speech'
import type { AgeBand } from '../../domain/types'
import { Icon } from '../components/Icon'
import { PetSprite } from '../components/PetSprite'
import { PinPad } from '../components/PinPad'
import '../j74.css'

type Step = 'pin1' | 'pin2' | 'child' | 'age' | 'pet' | 'egg'

interface Props {
  /** true = 全新安裝（要先設定全家共用的家長 PIN）；false = 簡化版（孩子已在名冊裡，例如重設之後），不問 PIN */
  withPin: boolean
  defaultName?: string
  /** 名冊裡已經知道這個孩子的年齡（例如重設之後）就不再問「幾歲」 */
  defaultAge?: AgeBand
  onFinish: (input: { pin?: string; childName: string; petName: string; ageBand?: AgeBand }) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function Onboarding({ withPin, defaultName = '', defaultAge, onFinish }: Props) {
  const [step, setStep] = useState<Step>(withPin ? 'pin1' : 'child')
  const [pin, setPin] = useState('')
  const [childName, setChildName] = useState(defaultName)
  const [petName, setPetName] = useState(DEFAULT_PET_NAME)
  const [age, setAge] = useState<AgeBand | undefined>(defaultAge)
  const advance = useRef<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const finish = async () => {
    setBusy(true)
    const r = await onFinish({ pin: withPin ? pin : undefined, childName, petName, ageBand: age })
    if (!r.ok) {
      setErr(r.error)
      setBusy(false)
    }
  }

  useEffect(() => () => window.clearTimeout(advance.current), [])
  // 進到「幾歲」那一頁：先唸一次問句
  useEffect(() => {
    if (step === 'age') sayText('你幾歲了？')
  }, [step])
  const pickAge = (band: AgeBand, say: string) => {
    setAge(band)
    sayText(say)
    window.clearTimeout(advance.current)
    advance.current = window.setTimeout(() => setStep('pet'), 750)
  }

  return (
    <main className="onboarding theme-cream">
      <div className="card onboard-card">
        <h1>乖寶任務</h1>
        {step === 'pin1' && (
          <>
            <p className="lead">先請爸媽設定 4 位數家長密碼（PIN）。小孩不要偷看喔。</p>
            <PinPad
              label="設定家長 PIN"
              onComplete={(p) => {
                setPin(p)
                setStep('pin2')
              }}
            />
          </>
        )}
        {step === 'pin2' && (
          <>
            <p className="lead">再輸入一次確認。</p>
            <PinPad
              label="再輸入一次 PIN"
              onComplete={(p) => {
                if (p !== pin) {
                  setStep('pin1')
                  setPin('')
                  return '兩次不一樣，請重新設定'
                }
                setStep('child')
              }}
            />
          </>
        )}
        {step === 'child' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (childName.trim()) setStep(defaultAge ? 'pet' : 'age')
            }}
          >
            <p className="lead">小朋友叫什麼名字？</p>
            <input
              className="input big"
              autoFocus
              value={childName}
              maxLength={10}
              placeholder="小朋友的名字"
              onChange={(e) => setChildName(e.target.value)}
            />
            <button className="btn primary" type="submit" disabled={!childName.trim()}>下一步</button>
          </form>
        )}
        {step === 'age' && (
          <div className="h7-age" data-testid="onboard-age">
            <p className="lead">{childName}幾歲了？</p>
            <div className="h7-age-grid" role="radiogroup" aria-label="孩子的年齡">
              {AGE_CHOICES.map((a) => (
                <button
                  key={a.band}
                  type="button"
                  role="radio"
                  aria-checked={age === a.band}
                  className={`h7-age-btn ${age === a.band ? 'on' : ''}`}
                  data-testid={`onboard-age-${a.band}`}
                  onClick={() => pickAge(a.band, a.say)}
                >
                  <Icon name={a.art} emoji={a.emoji} alt="" className="j74-age-icon" />
                  <span className="h7-age-label">{a.label}</span>
                </button>
              ))}
            </div>
            <p className="h7-age-note">年齡決定學習從哪裡開始；之後可以在家長區的「孩子們」修改。</p>
            <button type="button" className="h7-age-skip" data-testid="onboard-age-skip" onClick={() => setStep('pet')}>
              之後再設定
            </button>
          </div>
        )}
        {step === 'pet' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setStep('egg')
            }}
          >
            <p className="lead">幫小寵物取個名字吧！</p>
            <input
              className="input big"
              autoFocus
              value={petName}
              maxLength={10}
              placeholder={DEFAULT_PET_NAME}
              onChange={(e) => setPetName(e.target.value)}
            />
            <button className="btn primary" type="submit">下一步</button>
          </form>
        )}
        {step === 'egg' && (
          <div className="egg-step">
            <p className="lead">
              {childName}，這是{petName.trim() || DEFAULT_PET_NAME}的蛋！
              <br />
              完成冒險和任務，一起把牠孵出來吧。
            </p>
            <PetSprite pet={{ stage: 'egg', feedCount: 0, name: petName.trim() || DEFAULT_PET_NAME }} mood="happy" className="egg-big idle" />
            {err && <p className="form-error">{err}</p>}
            <button className="btn primary" disabled={busy} onClick={finish}>開始冒險</button>
          </div>
        )}
      </div>
    </main>
  )
}
